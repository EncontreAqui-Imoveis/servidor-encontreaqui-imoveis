import type { PoolConnection } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { resolveContractStatus, type ContractRow } from '../controllers/ContractController';

class ContractOperationalResponsibleError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function mutationError(statusCode: number, message: string): ContractOperationalResponsibleError {
  return new ContractOperationalResponsibleError(statusCode, message);
}

async function fetchContractByNegotiationIdForUpdate(
  tx: PoolConnection,
  negotiationId: string
): Promise<ContractRow | null> {
  const [rows] = await tx.query<ContractRow[]>(
    `
      SELECT *
      FROM contracts c
      WHERE c.negotiation_id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [negotiationId]
  );

  return rows[0] ?? null;
}

export async function updateContractOperationalResponsible(
  tx: PoolConnection,
  params: {
    req: AuthRequest;
    negotiationId: string;
    body: {
      sameAsCapturing?: unknown;
      sellingBrokerId?: unknown;
      sellerBrokerId?: unknown;
      selling_broker_id?: unknown;
    };
  }
): Promise<{
  contract: ContractRow | null;
}> {
  const sameAsCapturing =
    params.body.sameAsCapturing === true ||
    String(params.body.sameAsCapturing ?? '').toLowerCase() === 'true';
  const sellingBrokerIdRaw =
    params.body.sellingBrokerId ?? params.body.sellerBrokerId ?? params.body.selling_broker_id;

  const userId = Number(params.req.userId ?? 0);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw mutationError(401, 'Usuário não autenticado.');
  }

  const contract = await fetchContractByNegotiationIdForUpdate(tx, params.negotiationId);
  if (!contract) {
    throw mutationError(404, 'Contrato não encontrado para esta negociação.');
  }

  const role = String(params.req.userRole ?? '').toLowerCase();
  const canAccess =
    role === 'admin' ||
    (role === 'client'
      ? userId === Number(contract.buyer_client_id ?? 0) ||
        userId === Number(contract.property_owner_id ?? 0) ||
        userId === Number(contract.seller_client_id ?? 0)
      : role === 'broker' || role === 'auxiliary_administrative'
        ? userId === Number(contract.capturing_broker_id ?? 0) ||
          userId === Number(contract.selling_broker_id ?? 0) ||
          userId === Number(contract.seller_client_id ?? 0)
        : false);

  if (!canAccess) {
    throw mutationError(403, 'Acesso negado ao contrato.');
  }

  const capturingId = Number(contract.capturing_broker_id ?? 0);
  if (userId !== capturingId) {
    throw mutationError(
      403,
      'Somente o corretor captador pode ajustar o responsável operacional.'
    );
  }

  const contractStatus = resolveContractStatus(contract.status);
  if (contractStatus !== 'AWAITING_DOCS' && contractStatus !== 'IN_DRAFT') {
    throw mutationError(
      400,
      'O responsável operacional só pode ser alterado na fase de documentação.'
    );
  }

  if (!sameAsCapturing || sellingBrokerIdRaw != null) {
    console.warn('Ignorando configuração legada de papel secundário.', {
      negotiationId: params.negotiationId,
      userId,
      requestedSellingBrokerId: sellingBrokerIdRaw ?? null,
    });
  }

  await tx.query(
    `
      UPDATE negotiations
      SET selling_broker_id = ?, version = version + 1
      WHERE id = ?
    `,
    [capturingId, params.negotiationId]
  );

  const updated = await fetchContractByNegotiationIdForUpdate(tx, params.negotiationId);
  return { contract: updated };
}

export function isContractOperationalResponsibleError(
  error: unknown
): error is ContractOperationalResponsibleError {
  return error instanceof ContractOperationalResponsibleError;
}
