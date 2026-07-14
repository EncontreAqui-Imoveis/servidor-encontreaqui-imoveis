import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import { requireEnv } from '../config/env';
import type { AuthRequest } from '../middlewares/auth';
import type { ContractRow } from '../controllers/ContractController';
import { appendWorkflowAuditEvent } from './contractWorkflowMetadata';

const MAX_HANDSHAKE_ATTEMPTS = 5;

export type ContractHandshakeStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

type HandshakeRow = RowDataPacket & {
  legal_buyer_user_id: number | null;
  handshake_pin: string | null;
  handshake_status: ContractHandshakeStatus | null;
  handshake_attempts: number | null;
};

export class ContractBuyerHandshakeError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

function handshakeError(
  statusCode: number,
  code: string,
  message: string,
  body: Record<string, unknown> = {}
): ContractBuyerHandshakeError {
  return new ContractBuyerHandshakeError(statusCode, code, message, body);
}

function normalizePositiveId(value: unknown): number | null {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizePin(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^\d{4}$/.test(normalized) ? normalized : null;
}

function readHandshakeSecret(): string {
  // JWT_SECRET is already mandatory for the authenticated API. A dedicated
  // secret can replace it without changing persisted PIN digests.
  return String(process.env.CONTRACT_HANDSHAKE_PIN_SECRET ?? '').trim() || requireEnv('JWT_SECRET');
}

function digestPin(pin: string): string {
  return createHmac('sha256', readHandshakeSecret()).update(pin).digest('hex');
}

function safeDigestEquals(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function normalizeStatus(value: unknown): ContractHandshakeStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'VERIFIED' || normalized === 'REJECTED' ? normalized : 'PENDING';
}

async function fetchHandshakeForUpdate(
  tx: PoolConnection,
  negotiationId: string
): Promise<HandshakeRow | null> {
  const [rows] = await tx.query<HandshakeRow[]>(
    `
      SELECT legal_buyer_user_id, handshake_pin, handshake_status, handshake_attempts
      FROM negotiations
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [negotiationId]
  );
  return rows[0] ?? null;
}

async function appendHandshakeAudit(
  tx: PoolConnection,
  contract: Pick<ContractRow, 'id' | 'workflow_metadata'>,
  req: AuthRequest,
  action: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  const metadata = appendWorkflowAuditEvent(contract.workflow_metadata, {
    action,
    at: new Date().toISOString(),
    by: normalizePositiveId(req.userId),
    role: String(req.userRole ?? '').trim() || null,
    details,
  });
  await tx.query(
    `
      UPDATE contracts
      SET workflow_metadata = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [JSON.stringify(metadata), contract.id]
  );
}

function assertLinkedBuyer(req: AuthRequest, row: HandshakeRow): number {
  const requesterId = normalizePositiveId(req.userId);
  const linkedBuyerId = normalizePositiveId(row.legal_buyer_user_id);
  if (!requesterId || !linkedBuyerId || requesterId !== linkedBuyerId) {
    throw handshakeError(403, 'CONTRACT_HANDSHAKE_FORBIDDEN', 'Acesso negado à confirmação do contrato.');
  }
  return requesterId;
}

export function createBuyerHandshake(): { pin: string; pinHash: string } {
  const pin = String(randomInt(0, 10_000)).padStart(4, '0');
  return { pin, pinHash: digestPin(pin) };
}

export function shouldCreateBuyerHandshake(input: {
  initiatorSide: string | null | undefined;
  legalBuyerUserId: number | null | undefined;
}): boolean {
  return String(input.initiatorSide ?? '').trim().toLowerCase() === 'seller' &&
    normalizePositiveId(input.legalBuyerUserId) != null;
}

export async function verifyBuyerHandshakePin(
  tx: PoolConnection,
  params: {
    req: AuthRequest;
    contract: ContractRow;
    pin: unknown;
  }
): Promise<{ status: 'VERIFIED'; attemptsRemaining: number }> {
  const pin = normalizePin(params.pin);
  if (!pin) {
    throw handshakeError(400, 'INVALID_HANDSHAKE_PIN', 'Informe um PIN numérico de 4 dígitos.');
  }

  const handshake = await fetchHandshakeForUpdate(tx, params.contract.negotiation_id);
  if (!handshake) {
    throw handshakeError(404, 'CONTRACT_HANDSHAKE_NOT_FOUND', 'Vínculo de contrato não encontrado.');
  }
  assertLinkedBuyer(params.req, handshake);

  const status = normalizeStatus(handshake.handshake_status);
  const pinHash = String(handshake.handshake_pin ?? '').trim();
  if (!pinHash) {
    throw handshakeError(409, 'CONTRACT_HANDSHAKE_UNAVAILABLE', 'Este contrato não possui uma confirmação pendente.');
  }
  if (status === 'REJECTED') {
    throw handshakeError(409, 'CONTRACT_HANDSHAKE_REJECTED', 'A associação deste comprador foi recusada.');
  }
  if (status === 'VERIFIED') {
    return { status: 'VERIFIED', attemptsRemaining: MAX_HANDSHAKE_ATTEMPTS };
  }

  const attempts = Math.max(0, Number(handshake.handshake_attempts ?? 0));
  if (attempts >= MAX_HANDSHAKE_ATTEMPTS) {
    throw handshakeError(429, 'CONTRACT_HANDSHAKE_LOCKED', 'Limite de tentativas do PIN atingido. Solicite correção administrativa.');
  }

  if (!safeDigestEquals(digestPin(pin), pinHash)) {
    const nextAttempts = Math.min(MAX_HANDSHAKE_ATTEMPTS, attempts + 1);
    await tx.query(
      `UPDATE negotiations SET handshake_attempts = ? WHERE id = ?`,
      [nextAttempts, params.contract.negotiation_id]
    );
    await appendHandshakeAudit(tx, params.contract, params.req, 'legal_buyer_handshake_failed', {
      attempts: nextAttempts,
    });
    const attemptsRemaining = Math.max(0, MAX_HANDSHAKE_ATTEMPTS - nextAttempts);
    throw handshakeError(
      attemptsRemaining === 0 ? 429 : 403,
      attemptsRemaining === 0 ? 'CONTRACT_HANDSHAKE_LOCKED' : 'INVALID_HANDSHAKE_PIN',
      attemptsRemaining === 0
        ? 'Limite de tentativas do PIN atingido. Solicite correção administrativa.'
        : 'PIN inválido.',
      { attemptsRemaining }
    );
  }

  await tx.query(
    `
      UPDATE negotiations
      SET handshake_status = 'VERIFIED'
      WHERE id = ?
    `,
    [params.contract.negotiation_id]
  );
  await appendHandshakeAudit(tx, params.contract, params.req, 'legal_buyer_handshake_verified');
  return { status: 'VERIFIED', attemptsRemaining: MAX_HANDSHAKE_ATTEMPTS - attempts };
}

export async function rejectBuyerHandshakeAssociation(
  tx: PoolConnection,
  params: { req: AuthRequest; contract: ContractRow }
): Promise<{ sellerRecipientIds: number[] }> {
  const handshake = await fetchHandshakeForUpdate(tx, params.contract.negotiation_id);
  if (!handshake) {
    throw handshakeError(404, 'CONTRACT_HANDSHAKE_NOT_FOUND', 'Vínculo de contrato não encontrado.');
  }
  assertLinkedBuyer(params.req, handshake);
  if (normalizeStatus(handshake.handshake_status) !== 'PENDING') {
    throw handshakeError(409, 'CONTRACT_HANDSHAKE_NOT_PENDING', 'A associação não está pendente de confirmação.');
  }

  await tx.query(
    `
      UPDATE negotiations
      SET
        legal_buyer_user_id = NULL,
        handshake_pin = NULL,
        handshake_status = 'REJECTED',
        handshake_attempts = 0
      WHERE id = ?
    `,
    [params.contract.negotiation_id]
  );
  await appendHandshakeAudit(tx, params.contract, params.req, 'legal_buyer_handshake_rejected');

  return {
    sellerRecipientIds: Array.from(
      new Set(
        [params.contract.advertiser_id, params.contract.proposer_id]
          .map(normalizePositiveId)
          .filter((id): id is number => id != null)
      )
    ),
  };
}

export function isContractBuyerHandshakeError(
  error: unknown
): error is ContractBuyerHandshakeError {
  return error instanceof ContractBuyerHandshakeError;
}
