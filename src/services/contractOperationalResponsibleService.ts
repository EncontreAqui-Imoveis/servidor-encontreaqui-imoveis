import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import {
  CONTRACT_SELECT_BASE_SQL,
  resolveContractStatus,
  type ContractRow,
} from '../controllers/ContractController';
import { resolveContractAccessContext } from '../utils/contractIdentity';

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
  const includeResponsibles = await hasNegotiationResponsiblesTable(tx);
  const responsibleUsersSelect = includeResponsibles
    ? `(
      SELECT GROUP_CONCAT(nr.user_id ORDER BY nr.created_at ASC, nr.id ASC SEPARATOR ',')
      FROM negotiation_responsibles nr
      WHERE nr.negotiation_id = c.negotiation_id
    ) AS responsible_user_ids`
    : 'NULL AS responsible_user_ids';
  const contractSelectSql = CONTRACT_SELECT_BASE_SQL.replace(
    '__RESPONSIBLE_USERS_SELECT__',
    responsibleUsersSelect
  );
  const [rows] = await tx.query<ContractRow[]>(
    `
      ${contractSelectSql}
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
  const context = resolveContractAccessContext(params.req, contract, false);
  const canAccess =
    context != null &&
    (context.isAdmin ||
      (context.role === 'client'
        ? context.isBuyerSide || context.isSellerSide
        : context.role === 'broker' || context.role === 'auxiliary_administrative'
          ? context.isCapturingBroker || context.isSellingBroker || context.isBuyerSide || context.isSellerSide
          : false));

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
let negotiationResponsiblesTableCache: boolean | null = null;

async function hasNegotiationResponsiblesTable(tx: PoolConnection): Promise<boolean> {
  if (negotiationResponsiblesTableCache != null) {
    return negotiationResponsiblesTableCache;
  }

  const [rows] = await tx.query<Array<RowDataPacket & { has_table: number }>>(
    `
      SELECT 1 AS has_table
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'negotiation_responsibles'
      LIMIT 1
    `
  );
  negotiationResponsiblesTableCache = rows.length > 0;
  return negotiationResponsiblesTableCache;
}
