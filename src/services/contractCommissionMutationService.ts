import type { PoolConnection } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { resolveContractStatus, type ContractRow } from '../controllers/ContractController';

interface UpdateCommissionDataBody {
  commission_data?: unknown;
  commissionData?: unknown;
}

interface NormalizedCommissionData {
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
  const valorVenda = parseNonNegativeNumber(payload.valorVenda, 'valorVenda');
  if (valorVenda <= 0) {
    throw new Error('valorVenda deve ser maior que zero.');
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
  if (totalSplits > valorVenda) {
    throw new Error(
      'Dados financeiros inconsistentes: soma de comissões e taxa não pode exceder valorVenda.'
    );
  }

  return {
    valorVenda,
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
      SELECT *
      FROM contracts
      WHERE id = ?
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

  const normalizedPurpose = String(contract.property_purpose ?? '')
    .trim()
    .toLowerCase();
  const isRentalOnly =
    normalizedPurpose.includes('alug') && !normalizedPurpose.includes('venda');
  if (!isRentalOnly) {
    const totalSplits = Number(
      (
        commissionData.comissaoCaptador +
        commissionData.comissaoVendedor +
        commissionData.taxaPlataforma
      ).toFixed(2)
    );
    if (Math.abs(totalSplits - commissionData.valorVenda) > 0.01) {
      throw mutationError(
        400,
        'Na venda, a soma de comissões e taxa precisa fechar exatamente 100% do valor.'
      );
    }
  }

  await tx.query(
    `
      UPDATE contracts
      SET commission_data = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [JSON.stringify(commissionData), params.contractId]
  );

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

  return {
    contract: await fetchContractForUpdate(tx, params.contractId),
  };
}

export function isContractCommissionMutationError(
  error: unknown
): error is ContractCommissionMutationError {
  return error instanceof ContractCommissionMutationError;
}
