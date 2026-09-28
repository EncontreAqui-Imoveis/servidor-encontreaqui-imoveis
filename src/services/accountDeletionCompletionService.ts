import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import admin from '../config/firebaseAdmin';
import connection from '../database/connection';
import {
  BrokerVerificationDocumentDeletionError,
  removeBrokerVerificationDocuments,
} from './brokerVerificationDocumentDeletionService';

const ACCOUNT_DELETION_COMPLETED = 'ACCOUNT_DELETION_COMPLETED';
const ACCOUNT_DELETION_FINALIZATION_FAILED = 'ACCOUNT_DELETION_FINALIZATION_FAILED';
const FIREBASE_USER_DELETE_FAILED = 'FIREBASE_USER_DELETE_FAILED';
const CLAIM_LEASE_MINUTES = 15;

type AccountDeletionClaimRow = RowDataPacket & {
  request_id: string;
  user_id: number;
  firebase_uid: string | null;
  attempt_count: number;
};

type AccountDeletionFinalizationRow = RowDataPacket & {
  request_id: string;
  user_id: number;
};

export type ProcessOneDueAccountDeletionResult = {
  claimed: boolean;
  completed: boolean;
  failureCode?: string;
};

class AccountDeletionCompletionError extends Error {
  constructor(readonly code: typeof FIREBASE_USER_DELETE_FAILED) {
    super('Não foi possível concluir a exclusão da conta.');
    this.name = 'AccountDeletionCompletionError';
  }
}

function normalizeFirebaseUid(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isFirebaseUserNotFound(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'auth/user-not-found'
  );
}

function anonymizedName(userId: number): string {
  return `Conta excluída ${userId}`;
}

function anonymizedEmail(userId: number): string {
  return `deleted-account-${userId}@account.invalid`;
}

function failureCodeFor(error: unknown): string {
  if (error instanceof BrokerVerificationDocumentDeletionError) {
    return error.code;
  }
  if (error instanceof AccountDeletionCompletionError) {
    return error.code;
  }
  return ACCOUNT_DELETION_FINALIZATION_FAILED;
}

async function claimOneDueAccountDeletion(
  tx: PoolConnection,
): Promise<AccountDeletionClaimRow | null> {
  const [rows] = await tx.query<AccountDeletionClaimRow[]>(
    `
      SELECT
        request.id AS request_id,
        request.requester_user_id AS user_id,
        user.firebase_uid,
        request.attempt_count
      FROM privacy_requests request
      INNER JOIN users user ON user.id = request.requester_user_id
      WHERE request.request_type = 'DELETION'
        AND request.status IN ('PENDING', 'IN_REVIEW')
        AND request.scheduled_for <= CURRENT_TIMESTAMP
        AND request.resolved_at IS NULL
        AND user.deletion_requested_at IS NOT NULL
        AND user.deletion_completed_at IS NULL
        AND (
          request.processing_started_at IS NULL
          OR request.processing_started_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${CLAIM_LEASE_MINUTES} MINUTE)
        )
      ORDER BY request.scheduled_for ASC, request.requested_at ASC, request.id ASC
      LIMIT 1
      FOR UPDATE
    `,
  );
  const claim = rows[0];
  if (!claim) return null;

  await tx.query(
    `
      UPDATE privacy_requests
      SET
        processing_started_at = CURRENT_TIMESTAMP,
        attempt_count = attempt_count + 1
      WHERE id = ?
    `,
    [claim.request_id],
  );

  return {
    ...claim,
    attempt_count: Number(claim.attempt_count ?? 0) + 1,
  };
}

async function claimNextDueAccountDeletion(): Promise<AccountDeletionClaimRow | null> {
  const tx = await connection.getConnection();
  try {
    await tx.beginTransaction();
    const claim = await claimOneDueAccountDeletion(tx);
    await tx.commit();
    return claim;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

async function deleteFirebaseUser(firebaseUid: string | null): Promise<void> {
  const normalizedFirebaseUid = normalizeFirebaseUid(firebaseUid);
  if (!normalizedFirebaseUid) return;

  try {
    await admin.auth().deleteUser(normalizedFirebaseUid);
  } catch (error) {
    if (isFirebaseUserNotFound(error)) return;
    throw new AccountDeletionCompletionError(FIREBASE_USER_DELETE_FAILED);
  }
}

async function finalizeAccountDeletion(
  requestId: string,
): Promise<boolean> {
  const tx = await connection.getConnection();
  try {
    await tx.beginTransaction();
    const [rows] = await tx.query<AccountDeletionFinalizationRow[]>(
      `
        SELECT
          request.id AS request_id,
          request.requester_user_id AS user_id
        FROM privacy_requests request
        INNER JOIN users user ON user.id = request.requester_user_id
        WHERE request.id = ?
          AND request.request_type = 'DELETION'
          AND request.status IN ('PENDING', 'IN_REVIEW')
          AND request.resolved_at IS NULL
          AND user.deletion_requested_at IS NOT NULL
          AND user.deletion_completed_at IS NULL
        LIMIT 1
        FOR UPDATE
      `,
      [requestId],
    );
    const target = rows[0];
    if (!target) {
      await tx.commit();
      return false;
    }

    await tx.query(
      `
        UPDATE users
        SET
          name = ?,
          email = ?,
          firebase_uid = NULL,
          email_verified_at = NULL,
          password_hash = NULL,
          phone = NULL,
          street = NULL,
          number = NULL,
          complement = NULL,
          bairro = NULL,
          city = NULL,
          state = NULL,
          cep = NULL,
          cpf = NULL,
          cpf_ciphertext = NULL,
          cpf_lookup_hash = NULL,
          cpf_last4 = NULL,
          cpf_key_version = NULL,
          deletion_completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [anonymizedName(target.user_id), anonymizedEmail(target.user_id), target.user_id],
    );
    await tx.query('UPDATE brokers SET creci = NULL WHERE id = ?', [target.user_id]);
    await tx.query(
      `
        UPDATE privacy_requests
        SET
          status = 'COMPLETED',
          resolved_at = CURRENT_TIMESTAMP,
          resolution_code = ?,
          processing_started_at = NULL,
          last_error_code = NULL
        WHERE id = ?
      `,
      [ACCOUNT_DELETION_COMPLETED, requestId],
    );
    await tx.commit();
    return true;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

async function releaseClaimAfterFailure(requestId: string, failureCode: string): Promise<void> {
  await connection.query(
    `
      UPDATE privacy_requests
      SET
        status = 'IN_REVIEW',
        processing_started_at = NULL,
        last_error_code = ?
      WHERE id = ?
        AND resolved_at IS NULL
    `,
    [failureCode, requestId],
  );
}

/**
 * Claims and processes at most one due account-deletion request. External work
 * runs after the claim transaction commits, so a retry can safely resume after
 * a partial failure.
 */
export async function processOneDueAccountDeletionRequest(): Promise<ProcessOneDueAccountDeletionResult> {
  const claim = await claimNextDueAccountDeletion();
  if (!claim) {
    return { claimed: false, completed: false };
  }

  try {
    await removeBrokerVerificationDocuments(claim.user_id);
    await deleteFirebaseUser(claim.firebase_uid);
    const completed = await finalizeAccountDeletion(claim.request_id);
    return { claimed: true, completed };
  } catch (error) {
    const failureCode = failureCodeFor(error);
    try {
      await releaseClaimAfterFailure(claim.request_id, failureCode);
    } catch {
      console.warn('Falha ao registrar retentativa da exclusão de conta.', {
        code: 'ACCOUNT_DELETION_FAILURE_RECORD_FAILED',
      });
    }
    console.warn('Falha ao concluir exclusão de conta; solicitação permanecerá em revisão.', {
      code: failureCode,
    });
    return { claimed: true, completed: false, failureCode };
  }
}
