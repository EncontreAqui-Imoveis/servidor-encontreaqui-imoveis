import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import {
  CONTRACT_SELECT_BASE_SQL,
  resolveContractStatus,
  type ContractRow,
} from '../controllers/ContractController';
import { mergeWorkflowMetadata } from './contractWorkflowMetadata';
import { resolveContractAccessContext } from '../utils/contractAccessResolver';

interface SignatureMethodBody {
  method?: unknown;
}

class ContractSignatureMethodError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function mutationError(statusCode: number, message: string): ContractSignatureMethodError {
  return new ContractSignatureMethodError(statusCode, message);
}

function parseSignatureMethodInput(value: unknown): 'in_person' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'in_person' ? 'in_person' : null;
}

async function fetchContractForUpdate(
  tx: PoolConnection,
  contractId: string
): Promise<ContractRow | null> {
  const includeResponsibles = await hasNegotiationResponsiblesTable(tx);
  const responsibleUsersSelect = includeResponsibles
    ? `(
      SELECT GROUP_CONCAT(nr.user_id ORDER BY nr.created_at ASC, nr.id ASC SEPARATOR ',')
      FROM negotiation_responsibles nr
      JOIN brokers responsible_broker ON responsible_broker.id = nr.user_id
      WHERE nr.negotiation_id = c.negotiation_id
        AND responsible_broker.status = 'approved'
        AND COALESCE(responsible_broker.profile_type, 'BROKER') IN ('BROKER', 'AUXILIARY_ADMINISTRATIVE')
    ) AS responsible_user_ids`
    : 'NULL AS responsible_user_ids';
  const contractSelectSql = CONTRACT_SELECT_BASE_SQL.replace(
    '__RESPONSIBLE_USERS_SELECT__',
    responsibleUsersSelect
  );
  const [rows] = await tx.query<ContractRow[]>(
    `
      ${contractSelectSql}
      WHERE c.id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [contractId]
  );

  return rows[0] ?? null;
}

function resolveActingBrokerName(req: AuthRequest): string {
  const userId = Number(req.userId ?? 0);
  return userId > 0 ? `Responsável #${userId}` : 'Responsável';
}

export async function setContractSignatureMethod(
  tx: PoolConnection,
  params: {
    req: AuthRequest;
    contractId: string;
    body: SignatureMethodBody;
  }
): Promise<{
  contract: ContractRow | null;
  notification: {
    type: 'negotiation';
    title: string;
    message: string;
    relatedEntityId: number;
    metadata: Record<string, unknown>;
  };
}> {
  const method = parseSignatureMethodInput(params.body.method);
  if (method == null) {
    throw mutationError(400, 'Método de assinatura inválido. Use method: "in_person".');
  }

  const contract = await fetchContractForUpdate(tx, params.contractId);
  if (!contract) {
    throw mutationError(404, 'Contrato não encontrado.');
  }

  const context = resolveContractAccessContext(
    { id: params.req.userId, role: params.req.userRole },
    contract
  );
  params.req.contractContext = context;
  if (context.userRole !== 'admin') {
    throw mutationError(403, 'Acesso negado ao contrato.');
  }

  if (resolveContractStatus(contract.status) !== 'AWAITING_SIGNATURES') {
    throw mutationError(
      400,
      'A escolha do método de assinatura só pode ser feita em AWAITING_SIGNATURES.'
    );
  }

  const brokerName = resolveActingBrokerName(params.req);
  const nextWorkflowMetadata = mergeWorkflowMetadata(contract.workflow_metadata, {
    signatureMethod: method,
    signatureMethodDeclaredAt: new Date().toISOString(),
    signatureMethodDeclaredBy: Number(params.req.userId ?? 0) || null,
    signatureMethodDeclaredByName: brokerName,
  });

  await tx.query(
    `
      UPDATE contracts
      SET
        workflow_metadata = CAST(? AS JSON),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [JSON.stringify(nextWorkflowMetadata), params.contractId]
  );

  const updatedContract = await fetchContractForUpdate(tx, params.contractId);

  return {
    contract: updatedContract,
    notification: {
      type: 'negotiation',
      title: 'Assinatura presencial informada',
      message: `O corretor ${brokerName} informou que o contrato ${params.contractId} será assinado presencialmente.`,
      relatedEntityId: Number(contract.property_id),
      metadata: {
        contractId: params.contractId,
        negotiationId: contract.negotiation_id,
        brokerId: Number(params.req.userId ?? 0) || null,
        method,
      },
    },
  };
}

export function isContractSignatureMethodError(
  error: unknown
): error is ContractSignatureMethodError {
  return error instanceof ContractSignatureMethodError;
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
