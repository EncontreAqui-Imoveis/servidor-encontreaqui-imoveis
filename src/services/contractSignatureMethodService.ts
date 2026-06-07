import type { PoolConnection } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { resolveContractStatus, type ContractRow } from '../controllers/ContractController';

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

function mergeStoredJsonObject(
  source: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    return {
      ...(source as Record<string, unknown>),
      ...patch,
    };
  }

  if (typeof source === 'string') {
    try {
      const parsed = JSON.parse(source) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          ...(parsed as Record<string, unknown>),
          ...patch,
        };
      }
    } catch {
      // fall through
    }
  }

  return { ...patch };
}

async function fetchContractForUpdate(
  tx: PoolConnection,
  contractId: string
): Promise<ContractRow | null> {
  const [rows] = await tx.query<ContractRow[]>(
    `
      SELECT *
      FROM contracts c
      WHERE c.id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [contractId]
  );

  return rows[0] ?? null;
}

function resolveActingBrokerName(req: AuthRequest, contract: ContractRow): string {
  const userId = Number(req.userId ?? 0);
  if (userId > 0 && userId === Number(contract.capturing_broker_id ?? 0)) {
    const name = String(contract.capturing_broker_name ?? '').trim();
    if (name) return name;
  }
  return userId > 0 ? `Corretor #${userId}` : 'Corretor';
}

function isNegotiationResponsibleUser(contract: ContractRow, userId: number): boolean {
  if (!Number.isFinite(userId) || userId <= 0) {
    return false;
  }
  const raw = String(contract.responsible_user_ids ?? '').trim();
  if (!raw) {
    return false;
  }
  return raw
    .split(',')
    .map((value) => Number(value))
    .some((value) => Number.isInteger(value) && value === userId);
}

function canAccessContract(req: AuthRequest, contract: ContractRow): boolean {
  const role = String(req.userRole ?? '').toLowerCase();
  if (role === 'admin') {
    return true;
  }

  const userId = Number(req.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return false;
  }

  const isResponsible = isNegotiationResponsibleUser(contract, userId);
  if (isResponsible && (role === 'broker' || role === 'auxiliary_administrative')) {
    return true;
  }

  if (role === 'client') {
    return (
      userId === Number(contract.buyer_client_id ?? 0) ||
      userId === Number(contract.property_owner_id ?? 0) ||
      userId === Number(contract.seller_client_id ?? 0)
    );
  }

  if (role !== 'broker' && role !== 'auxiliary_administrative') {
    return false;
  }

  return (
    userId === Number(contract.capturing_broker_id ?? 0) ||
    userId === Number(contract.selling_broker_id ?? 0) ||
    userId === Number(contract.seller_client_id ?? 0)
  );
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

  if (!canAccessContract(params.req, contract)) {
    throw mutationError(403, 'Acesso negado ao contrato.');
  }

  if (resolveContractStatus(contract.status) !== 'AWAITING_SIGNATURES') {
    throw mutationError(
      400,
      'A escolha do método de assinatura só pode ser feita em AWAITING_SIGNATURES.'
    );
  }

  const brokerName = resolveActingBrokerName(params.req, contract);
  const nextWorkflowMetadata = mergeStoredJsonObject(contract.workflow_metadata, {
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
