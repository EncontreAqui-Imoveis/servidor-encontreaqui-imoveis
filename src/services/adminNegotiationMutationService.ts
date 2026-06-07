import type { RowDataPacket } from 'mysql2';

import {
  ConflictError,
  InternalError,
  InvalidInputError,
  NotFoundError,
} from '../errors/ApplicationError';
import { adminDb } from './adminPersistenceService';
import { createUserNotification } from './notificationService';
import { sendPushNotifications } from './pushNotificationService';

type DecisionNegotiationRow = RowDataPacket & {
  id: string;
  status: string | null;
  property_id: number | string;
  property_broker_id: number | string | null;
  capturing_broker_id: number | string | null;
  responsible_broker_id: number | string | null;
  buyer_client_id?: number | string | null;
  property_title: string | null;
  property_code: string | null;
  property_address: string | null;
  property_status: string | null;
  lifecycle_status: string | null;
};

type ExistingContractByNegotiationRow = RowDataPacket & {
  id: string;
};

type PendingProposalCountRow = RowDataPacket & {
  cnt: number | string | null;
};

type BrokerAssignmentRow = RowDataPacket & {
  id: string;
  status: string | null;
  capturing_broker_id: number | string | null;
  selling_broker_id: number | string | null;
};

const NEGOTIATION_INTERNAL_STATUSES = new Set([
  'PROPOSAL_DRAFT',
  'PROPOSAL_SENT',
  'PROPOSAL_SIGNED',
  'IN_NEGOTIATION',
  'DOCUMENTATION_PHASE',
  'CONTRACT_DRAFTING',
  'AWAITING_SIGNATURES',
  'SOLD',
  'RENTED',
  'CANCELLED',
  'REFUSED',
]);

function resolveNegotiationPropertyTitle(value: unknown): string {
  const title = String(value ?? '').trim();
  return title || 'o imóvel';
}

function normalizeNegotiationStatus(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function resolveOperationalBrokerId(row: DecisionNegotiationRow): number {
  return Number(
    row.capturing_broker_id ?? row.property_broker_id ?? row.responsible_broker_id ?? 0
  );
}

async function loadDecisionNegotiationRow(
  tx: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  negotiationId: string,
  includeBuyerClientId = false
): Promise<DecisionNegotiationRow | null> {
  const buyerClientSelect = includeBuyerClientId ? ', n.buyer_client_id' : '';
  const [rows] = (await tx.query(
    `
      SELECT
        n.id,
        n.status,
        n.property_id,
        p.broker_id AS property_broker_id,
        n.capturing_broker_id,
        (
          SELECT nr.user_id
          FROM negotiation_responsibles nr
          JOIN brokers b ON b.id = nr.user_id
          WHERE nr.negotiation_id = n.id
            AND b.status = 'approved'
            AND COALESCE(b.profile_type, 'BROKER') IN ('BROKER', 'AUXILIARY_ADMINISTRATIVE')
          ORDER BY nr.created_at ASC, nr.id ASC
          LIMIT 1
        ) AS responsible_broker_id
        ${buyerClientSelect},
        p.title AS property_title,
        p.code AS property_code,
        CONCAT_WS(', ', p.address, p.numero, p.bairro, p.city, p.state) AS property_address,
        p.status AS property_status,
        p.lifecycle_status
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      WHERE n.id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [negotiationId]
  )) as [DecisionNegotiationRow[]];
  return rows[0] ?? null;
}

function buildAdminIdMetadata(adminId: number): Record<string, unknown> {
  return { adminId };
}

export async function approveNegotiation(params: {
  negotiationId: string;
  actorId: number;
}): Promise<{ message: string; id: string; status: 'APPROVED'; internalStatus: 'IN_NEGOTIATION' }> {
  const { negotiationId, actorId } = params;
  const tx = await adminDb.getConnection();
  try {
    await tx.beginTransaction();

    const negotiation = await loadDecisionNegotiationRow(tx, negotiationId);
    if (!negotiation) {
      await tx.rollback();
      throw new NotFoundError('Negociação não encontrada.');
    }

    const currentStatus = normalizeNegotiationStatus(negotiation.status);
    const resolvedSellingBrokerId = resolveOperationalBrokerId(negotiation);
    if (!resolvedSellingBrokerId) {
      await tx.rollback();
      throw new InvalidInputError(
        'Não foi possível identificar o responsável operacional da negociação.'
      );
    }

    if (['CANCELLED', 'REFUSED', 'SOLD', 'RENTED'].includes(currentStatus)) {
      await tx.rollback();
      throw new ConflictError('Não é possível aprovar uma negociação encerrada.');
    }

    const [signedProposalRows] = await tx.query<RowDataPacket[]>(
      `
        SELECT id
        FROM negotiation_documents
        WHERE negotiation_id = ?
          AND type = 'other'
          AND document_type = 'contrato_assinado'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `,
      [negotiationId]
    );
    if (signedProposalRows.length === 0) {
      await tx.rollback();
      throw new InvalidInputError(
        'Não é possível aprovar sem PDF assinado. Envie a proposta assinada antes de aprovar.',
        { code: 'SIGNED_PROPOSAL_REQUIRED' }
      );
    }

    await tx.query(
      `
        UPDATE negotiations
        SET
          status = 'IN_NEGOTIATION',
          selling_broker_id = ?,
          version = version + 1
        WHERE id = ?
      `,
      [resolvedSellingBrokerId, negotiationId]
    );

    await tx.query(
      `
        INSERT INTO negotiation_history (
          id,
          negotiation_id,
          from_status,
          to_status,
          actor_id,
          metadata_json,
          created_at
        ) VALUES (UUID(), ?, ?, 'IN_NEGOTIATION', ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
      `,
      [
        negotiationId,
        currentStatus,
        null,
        JSON.stringify({
          action: 'admin_approved',
          adminId: actorId,
        }),
      ]
    );

    await tx.query(
      `
        UPDATE properties
        SET status = 'negociacao', visibility = 'HIDDEN', lifecycle_status = 'AVAILABLE'
        WHERE id = ?
      `,
      [negotiation.property_id]
    );

    const [existingContractRows] = await tx.query<ExistingContractByNegotiationRow[]>(
      `
        SELECT id
        FROM contracts
        WHERE negotiation_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [negotiationId]
    );

    if (existingContractRows.length === 0) {
      await tx.query(
        `
          INSERT INTO contracts (
            id,
            negotiation_id,
            property_id,
            status,
            seller_approval_status,
            buyer_approval_status,
            created_at,
            updated_at
          ) VALUES (
            UUID(),
            ?,
            ?,
            'AWAITING_DOCS',
            'PENDING',
            'PENDING',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `,
        [negotiationId, negotiation.property_id]
      );
    }

    const [competingRows] = await tx.query<RowDataPacket[]>(
      `
        SELECT id, status
        FROM negotiations
        WHERE property_id = ?
          AND id <> ?
          AND UPPER(TRIM(status)) IN (
            'PROPOSAL_SENT',
            'PROPOSAL_DRAFT',
            'DOCUMENTATION_PHASE',
            'CONTRACT_DRAFTING',
            'AWAITING_SIGNATURES'
          )
        FOR UPDATE
      `,
      [negotiation.property_id, negotiationId]
    );

    await tx.query(
      `
        UPDATE negotiations
        SET status = 'REFUSED', version = version + 1
        WHERE property_id = ?
          AND id <> ?
          AND UPPER(TRIM(status)) IN (
            'PROPOSAL_SENT',
            'PROPOSAL_DRAFT',
            'DOCUMENTATION_PHASE',
            'CONTRACT_DRAFTING',
            'AWAITING_SIGNATURES'
          )
      `,
      [negotiation.property_id, negotiationId]
    );

    if (competingRows.length > 0) {
      const valuesClause = competingRows
        .map(() => '(UUID(), ?, ?, ?, ?, CAST(? AS JSON), CURRENT_TIMESTAMP)')
        .join(', ');
      const historyParams: Array<string | number | null> = [];
      for (const row of competingRows) {
        const rawComp = String(row.status ?? '').trim().toUpperCase();
        const fromCompeting = NEGOTIATION_INTERNAL_STATUSES.has(rawComp) ? rawComp : 'PROPOSAL_SENT';
        historyParams.push(
          String(row.id ?? ''),
          fromCompeting,
          'REFUSED',
          null,
          JSON.stringify({
            action: 'admin_approved_other_negotiation',
            adminId: actorId,
            approvedNegotiationId: negotiationId,
            propertyId: Number(negotiation.property_id),
          })
        );
      }
      await tx.query(
        `
          INSERT INTO negotiation_history (
            id,
            negotiation_id,
            from_status,
            to_status,
            actor_id,
            metadata_json,
            created_at
          ) VALUES ${valuesClause}
        `,
        historyParams
      );
    }

    await tx.commit();

    const recipientBrokerId = Number(negotiation.capturing_broker_id ?? 0);
    if (Number.isFinite(recipientBrokerId) && recipientBrokerId > 0) {
      const propertyTitle = resolveNegotiationPropertyTitle(negotiation.property_title);
      try {
        await createUserNotification({
          type: 'negotiation',
          title: 'Proposta Aprovada!',
          message:
            'Sua proposta foi aprovada! Acesse a aba Contratos no aplicativo para enviar a documentação.',
          recipientId: recipientBrokerId,
          relatedEntityId: Number(negotiation.property_id),
          metadata: {
            negotiationId,
            propertyId: Number(negotiation.property_id),
            status: 'APPROVED',
            propertyTitle,
            ...buildAdminIdMetadata(actorId),
          },
        });
      } catch (notifyError) {
        console.error('Erro ao notificar corretor sobre aprovação da proposta:', notifyError);
      }
    }

    return {
      message: 'Negociação aprovada com sucesso.',
      id: negotiationId,
      status: 'APPROVED',
      internalStatus: 'IN_NEGOTIATION',
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

export async function rejectNegotiation(params: {
  negotiationId: string;
  actorId: number;
  reason: string;
}): Promise<{ message: string; id: string; status: 'REFUSED' }> {
  const { negotiationId, actorId, reason } = params;
  const tx = await adminDb.getConnection();
  try {
    await tx.beginTransaction();

    const negotiation = await loadDecisionNegotiationRow(tx, negotiationId, true);
    if (!negotiation) {
      await tx.rollback();
      throw new NotFoundError('Negociação não encontrada.');
    }

    const currentStatus = normalizeNegotiationStatus(negotiation.status);
    const fromStatusForHistory = NEGOTIATION_INTERNAL_STATUSES.has(currentStatus)
      ? currentStatus
      : 'PROPOSAL_SENT';
    const resolvedSellingBrokerId = resolveOperationalBrokerId(negotiation);
    if (!resolvedSellingBrokerId) {
      await tx.rollback();
      throw new InvalidInputError(
        'Não foi possível identificar o responsável operacional da negociação.'
      );
    }

    if (currentStatus === 'SOLD' || currentStatus === 'RENTED') {
      await tx.rollback();
      throw new ConflictError('Negociação já finalizada, rejeição não permitida.');
    }

    const [pendingBeforeRows] = await tx.query<PendingProposalCountRow[]>(
      `
        SELECT COUNT(*) AS cnt
        FROM negotiations
        WHERE property_id = ?
          AND UPPER(TRIM(status)) IN ('PROPOSAL_SENT', 'PROPOSAL_DRAFT', 'DOCUMENTATION_PHASE')
      `,
      [negotiation.property_id]
    );
    const pendingProposalCount = Number(pendingBeforeRows[0]?.cnt ?? 0);

    await tx.query(`DELETE FROM negotiation_proposal_idempotency WHERE negotiation_id = ?`, [
      negotiationId,
    ]);
    await tx.query(
      `
        UPDATE negotiations
        SET
          status = 'REFUSED',
          selling_broker_id = ?,
          version = version + 1
        WHERE id = ?
      `,
      [resolvedSellingBrokerId, negotiationId]
    );

    await tx.query(
      `
        INSERT INTO negotiation_history (
          id,
          negotiation_id,
          from_status,
          to_status,
          actor_id,
          metadata_json,
          created_at
        ) VALUES (UUID(), ?, ?, 'REFUSED', ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
      `,
      [
        negotiationId,
        fromStatusForHistory,
        null,
        JSON.stringify({
          action: 'admin_rejected',
          reason,
          adminId: actorId,
        }),
      ]
    );

    if (pendingProposalCount <= 1) {
      await tx.query(
        `
          UPDATE properties
          SET status = 'approved', visibility = 'PUBLIC', lifecycle_status = 'AVAILABLE'
          WHERE id = ?
            AND lifecycle_status NOT IN ('SOLD', 'RENTED')
            AND status NOT IN ('sold', 'rented')
        `,
        [negotiation.property_id]
      );
    }

    await tx.commit();

    const propertyTitle = resolveNegotiationPropertyTitle(negotiation.property_title);
    const recipientBrokerId = Number(negotiation.capturing_broker_id ?? 0);
    const recipientClientId = Number(negotiation.buyer_client_id ?? 0);

    const notifyIds = new Set<number>();
    if (Number.isFinite(recipientBrokerId) && recipientBrokerId > 0) {
      notifyIds.add(recipientBrokerId);
    }
    if (Number.isFinite(recipientClientId) && recipientClientId > 0) {
      notifyIds.add(recipientClientId);
    }

    for (const recipientId of notifyIds) {
      try {
        await createUserNotification({
          type: 'negotiation',
          title: 'Proposta rejeitada',
          message: `Sua proposta para o imóvel ${propertyTitle} foi rejeitada. Motivo: ${reason}.`,
          recipientId,
          relatedEntityId: Number(negotiation.property_id),
          metadata: {
            negotiationId,
            propertyId: Number(negotiation.property_id),
            reason,
            status: 'REJECTED',
            ...buildAdminIdMetadata(actorId),
          },
        });
      } catch (notifyError) {
        console.error('Erro ao notificar sobre rejeição da proposta:', notifyError);
      }
    }

    return {
      message: 'Negociação recusada e mantida em histórico.',
      id: negotiationId,
      status: 'REFUSED',
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

export async function cancelNegotiation(params: {
  negotiationId: string;
  actorId: number;
  reason: string;
}): Promise<{ message: string; id: string; status: 'CANCELLED' }> {
  const { negotiationId, actorId, reason } = params;
  const tx = await adminDb.getConnection();
  try {
    await tx.beginTransaction();

    const [rows] = await tx.query<DecisionNegotiationRow[]>(
      `
        SELECT
          n.id,
          n.status,
          n.property_id,
          n.capturing_broker_id,
          p.title AS property_title,
          p.code AS property_code,
          CONCAT_WS(', ', p.address, p.numero, p.bairro, p.city, p.state) AS property_address,
          p.status AS property_status,
          p.lifecycle_status
        FROM negotiations n
        JOIN properties p ON p.id = n.property_id
        WHERE n.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [negotiationId]
    );

    if (!rows.length) {
      await tx.rollback();
      throw new NotFoundError('Negociação não encontrada.');
    }

    const negotiation = rows[0];
    const currentStatus = normalizeNegotiationStatus(negotiation.status);
    const propertyStatus = String(negotiation.property_status ?? '').toLowerCase();

    if (currentStatus === 'SOLD' || currentStatus === 'RENTED') {
      await tx.rollback();
      throw new ConflictError('Negociação já finalizada, cancelamento não permitido.');
    }

    if (currentStatus !== 'IN_NEGOTIATION' || propertyStatus !== 'negociacao') {
      await tx.rollback();
      throw new InvalidInputError('Somente negociações em andamento podem ser canceladas.');
    }

    await tx.query(
      `
        UPDATE negotiations
        SET status = 'CANCELLED', version = version + 1
        WHERE id = ?
      `,
      [negotiationId]
    );

    await tx.query(
      `
        INSERT INTO negotiation_history (
          id,
          negotiation_id,
          from_status,
          to_status,
          actor_id,
          metadata_json,
          created_at
        ) VALUES (UUID(), ?, ?, 'CANCELLED', ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
      `,
      [
        negotiationId,
        currentStatus,
        null,
        JSON.stringify({
          action: 'admin_cancelled',
          reason,
          adminId: actorId,
        }),
      ]
    );

    await tx.query(
      `
        UPDATE properties
        SET status = 'approved', visibility = 'PUBLIC', lifecycle_status = 'AVAILABLE'
        WHERE id = ?
          AND lifecycle_status NOT IN ('SOLD', 'RENTED')
          AND status NOT IN ('sold', 'rented')
      `,
      [negotiation.property_id]
    );

    await tx.commit();

    const recipientBrokerId = Number(negotiation.capturing_broker_id ?? 0);
    if (Number.isFinite(recipientBrokerId) && recipientBrokerId > 0) {
      const propertyTitle = resolveNegotiationPropertyTitle(negotiation.property_title);
      const brokerMessage = `A negociação para o imóvel ${propertyTitle} foi cancelada. O imóvel voltou para a vitrine. Motivo: ${reason}.`;

      try {
        await createUserNotification({
          type: 'negotiation',
          title: 'Negociação Cancelada ⚠️',
          message: brokerMessage,
          recipientId: recipientBrokerId,
          relatedEntityId: Number(negotiation.property_id),
          recipientRole: 'broker',
          metadata: {
            negotiationId,
            propertyId: Number(negotiation.property_id),
            reason,
            status: 'CANCELLED',
            ...buildAdminIdMetadata(actorId),
          },
        });

        await sendPushNotifications({
          message: brokerMessage,
          recipientIds: [recipientBrokerId],
          relatedEntityType: 'negotiation',
          relatedEntityId: Number(negotiation.property_id),
        });
      } catch (notifyError) {
        console.error('Erro ao notificar corretor sobre cancelamento da negociação:', notifyError);
      }
    }

    return {
      message: 'Negociação cancelada e imóvel devolvido para disponível.',
      id: negotiationId,
      status: 'CANCELLED',
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

export async function updateNegotiationSellingBroker(params: {
  negotiationId: string;
  actorId: number;
  sellingBrokerIdRaw: unknown;
}): Promise<{
  message: string;
  negotiationId: string;
  capturingBrokerId: number;
  sellingBrokerId: number;
  sameAsCapturing: true;
  sellingBrokerName: string | null;
}> {
  const { negotiationId, actorId, sellingBrokerIdRaw } = params;
  const parsedSellerBrokerId =
    sellingBrokerIdRaw === undefined || sellingBrokerIdRaw === null || sellingBrokerIdRaw === ''
      ? null
      : Number(sellingBrokerIdRaw);

  if (
    parsedSellerBrokerId !== null &&
    (!Number.isInteger(parsedSellerBrokerId) || parsedSellerBrokerId <= 0)
  ) {
    throw new InvalidInputError('ID do responsável operacional inválido.');
  }

  const tx = await adminDb.getConnection();
  try {
    await tx.beginTransaction();
    const [rows] = await tx.query<BrokerAssignmentRow[]>(
      `
        SELECT id, status, capturing_broker_id, selling_broker_id
        FROM negotiations
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [negotiationId]
    );
    const negotiation = rows[0];
    if (!negotiation) {
      await tx.rollback();
      throw new NotFoundError('Negociação não encontrada.');
    }

    const capturingBrokerId = Number(negotiation.capturing_broker_id ?? 0);
    if (!Number.isInteger(capturingBrokerId) || capturingBrokerId <= 0) {
      await tx.rollback();
      throw new InvalidInputError('Corretor captador inválido na negociação.');
    }

    const currentStatus = normalizeNegotiationStatus(negotiation.status);
    if (['CANCELLED', 'REFUSED', 'SOLD', 'RENTED'].includes(currentStatus)) {
      await tx.rollback();
      throw new ConflictError(
        'Não é possível alterar o responsável operacional em uma negociação encerrada.'
      );
    }

    if (parsedSellerBrokerId != null && parsedSellerBrokerId !== capturingBrokerId) {
      console.warn('Ignorando atualização legada de papel secundário no admin.', {
        negotiationId,
        actorId,
        requestedSellingBrokerId: parsedSellerBrokerId,
        capturingBrokerId,
      });
    }
    const newSellerBrokerId = capturingBrokerId;
    const [capturingRows] = await tx.query<RowDataPacket[]>(
      `SELECT name FROM users WHERE id = ? LIMIT 1`,
      [capturingBrokerId]
    );
    const newSellerBrokerName = String(capturingRows[0]?.name ?? '').trim() || '';

    await tx.query(
      `
        UPDATE negotiations
        SET selling_broker_id = ?, version = version + 1
        WHERE id = ?
      `,
      [newSellerBrokerId, negotiationId]
    );

    await tx.commit();
    return {
      message: 'Responsável operacional sincronizado com o captador.',
      negotiationId,
      capturingBrokerId,
      sellingBrokerId: newSellerBrokerId,
      sameAsCapturing: true,
      sellingBrokerName: newSellerBrokerName || null,
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}
