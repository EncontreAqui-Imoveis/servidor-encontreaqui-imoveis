import type { PoolConnection } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { resolveContractStatus, type ContractRow } from '../controllers/ContractController';
import {
  assertCommissionAllocationPolicy,
  cancelContractCommissionAllocations,
  syncContractCommissionAllocations,
} from './contractCommissionAllocationService';

interface UpdateCommissionDataBody {
  commission_data?: unknown;
  commissionData?: unknown;
}

interface NormalizedCommissionData {
  /** Base canônica: preço de venda ou aluguel mensal, conforme a modalidade. */
  valorBaseComissao: number;
  /** @deprecated Mantido em dados já gravados e consumidores legados. */
  valorVenda: number;
  comissaoCaptador: number;
  comissaoVendedor: number;
  taxaPlataforma: number;
}

class ContractCommissionMutationError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function mutationError(statusCode: number, message: string): ContractCommissionMutationError {
  return new ContractCommissionMutationError(statusCode, message);
}

function parseNonNegativeNumber(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} deve ser um número não negativo.`);
  }
  return Number(parsed.toFixed(2));
}

function normalizeCommissionData(value: unknown): NormalizedCommissionData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('commission_data inválido.');
  }

  const payload = value as Record<string, unknown>;
  const valorBaseComissao = parseNonNegativeNumber(
    payload.valorBaseComissao ?? payload.valorVenda,
    'valorBaseComissao'
  );
  if (valorBaseComissao <= 0) {
    throw new Error('valorBaseComissao deve ser maior que zero.');
  }

  const comissaoCaptador = parseNonNegativeNumber(
    payload.comissaoCaptador,
    'comissaoCaptador'
  );
  const comissaoVendedor = parseNonNegativeNumber(
    payload.comissaoVendedor,
    'comissaoVendedor'
  );
  const taxaPlataforma = parseNonNegativeNumber(
    payload.taxaPlataforma,
    'taxaPlataforma'
  );

  const totalSplits = Number(
    (comissaoCaptador + comissaoVendedor + taxaPlataforma).toFixed(2)
  );
  if (totalSplits > valorBaseComissao) {
    throw new Error(
      'Dados financeiros inconsistentes: soma de comissões e taxa não pode exceder valorBaseComissao.'
    );
  }

  return {
    valorBaseComissao,
    // Compatibilidade para relatórios e contratos finalizados antes da migração.
    valorVenda: valorBaseComissao,
    comissaoCaptador,
    comissaoVendedor,
    taxaPlataforma,
  };
}

async function fetchContractForUpdate(
  tx: PoolConnection,
  contractId: string
): Promise<ContractRow | null> {
  const [rows] = await tx.query<ContractRow[]>(
    `
      SELECT
        c.*,
        n.capturing_broker_id,
        n.selling_broker_id,
        p.purpose AS property_purpose
      FROM contracts c
      JOIN negotiations n ON n.id = c.negotiation_id
      JOIN properties p ON p.id = c.property_id
      WHERE c.id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [contractId]
  );

  return rows[0] ?? null;
}

function validateFinalizedContract(contract: ContractRow): void {
  if (resolveContractStatus(contract.status) !== 'FINALIZED') {
    throw mutationError(400, 'Somente contratos finalizados podem alterar o VGV.');
  }
}

export async function updateContractCommissionData(
  tx: PoolConnection,
  params: {
    req: AuthRequest;
    contractId: string;
    body: UpdateCommissionDataBody;
  }
): Promise<{ contract: ContractRow | null; commissionData: NormalizedCommissionData }> {
  const rawCommissionData = params.body.commission_data ?? params.body.commissionData;
  let commissionData: NormalizedCommissionData;
  try {
    commissionData = normalizeCommissionData(rawCommissionData);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'commission_data inválido.';
    throw mutationError(400, message);
  }

  const contract = await fetchContractForUpdate(tx, params.contractId);
  if (!contract) {
    throw mutationError(404, 'Contrato não encontrado.');
  }

  validateFinalizedContract(contract);

  try {
    assertCommissionAllocationPolicy(contract, commissionData);
  } catch (error) {
    throw mutationError(
      400,
      error instanceof Error ? error.message : 'Dados de comissão inválidos.',
    );
  }

  await tx.query(
    `
      UPDATE contracts
      SET commission_data = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [JSON.stringify(commissionData), params.contractId]
  );

  await syncContractCommissionAllocations(tx, contract, commissionData);

  return {
    contract: await fetchContractForUpdate(tx, params.contractId),
    commissionData,
  };
}

export async function deleteContractCommissionData(
  tx: PoolConnection,
  params: {
    contractId: string;
  }
): Promise<{ contract: ContractRow | null }> {
  const contract = await fetchContractForUpdate(tx, params.contractId);
  if (!contract) {
    throw mutationError(404, 'Contrato não encontrado.');
  }

  validateFinalizedContract(contract);

  await tx.query(
    `
      UPDATE contracts
      SET commission_data = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [params.contractId]
  );

  await cancelContractCommissionAllocations(tx, params.contractId);

  return {
    contract: await fetchContractForUpdate(tx, params.contractId),
  };
}

export function isContractCommissionMutationError(
  error: unknown
): error is ContractCommissionMutationError {
  return error instanceof ContractCommissionMutationError;
}
