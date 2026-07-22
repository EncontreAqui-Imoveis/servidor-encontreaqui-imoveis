import { RowDataPacket } from 'mysql2';
import { queryContractRows } from './contractPersistenceService';

interface CommissionContractRow extends RowDataPacket {
  id: string;
  negotiation_id: string;
  property_id: number;
  commission_data: unknown;
  finalized_at: Date | string | null;
  property_title: string | null;
  property_code: string | null;
  property_purpose: string | null;
  signed_proposal_document_id: number | null;
  capturing_allocation_base_amount: number | string | null;
  capturing_allocation_amount: number | string | null;
  selling_allocation_amount: number | string | null;
  capturing_broker_name: string | null;
  selling_broker_name: string | null;
}

type CommissionSummaryResponse = {
  month: number;
  year: number;
  summary: {
    totalVGV: number;
    totalCaptadores: number;
    totalVendedores: number;
    totalPlataforma: number;
  };
  transactions: Array<{
    contractId: string;
    negotiationId: string;
    propertyId: number;
    propertyTitle: string | null;
    propertyCode: string | null;
    propertyPurpose: string | null;
    capturingBrokerName: string | null;
    sellingBrokerName: string | null;
    finalizedAt: string | null;
    signedProposalDocumentId: number | null;
    signedProposalDocumentSource: 'negotiation_documents' | null;
    commissionData: {
      valorBaseComissao: number;
      valorVenda: number;
      comissaoCaptador: number;
      comissaoVendedor: number;
      taxaPlataforma: number;
    };
  }>;
};

function parseStoredJsonObject(value: unknown): Record<string, unknown> {
  if (value == null) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function readCommissionValue(
  commissionData: Record<string, unknown>,
  key: string,
): number {
  const raw = commissionData[key];
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readAllocationValue(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoString(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export async function listCommissionSummary(
  monthInput: unknown,
  yearInput: unknown,
): Promise<CommissionSummaryResponse> {
  const now = new Date();
  const month = monthInput ? Number(monthInput) : now.getMonth() + 1;
  const year = yearInput ? Number(yearInput) : now.getFullYear();

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Mês inválido. Use valores entre 1 e 12.');
  }

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('Ano inválido. Use um valor entre 2000 e 2100.');
  }

  const rows = await queryContractRows<CommissionContractRow>(
    `
      SELECT
        c.id,
        c.negotiation_id,
        c.property_id,
        c.commission_data,
        COALESCE(c.finalized_at, c.updated_at) AS finalized_at,
        p.title AS property_title,
        p.code AS property_code,
        p.purpose AS property_purpose,
        capturing_allocation.base_amount AS capturing_allocation_base_amount,
        capturing_allocation.amount AS capturing_allocation_amount,
        selling_allocation.amount AS selling_allocation_amount,
        capturing_broker_user.name AS capturing_broker_name,
        selling_broker_user.name AS selling_broker_name,
        (
          SELECT nd.id
          FROM negotiation_documents nd
          WHERE nd.negotiation_id = c.negotiation_id
            AND nd.type = 'other'
            AND nd.document_type = 'contrato_assinado'
          ORDER BY nd.created_at DESC, nd.id DESC
          LIMIT 1
        ) AS signed_proposal_document_id
      FROM contracts c
      JOIN properties p ON p.id = c.property_id
      LEFT JOIN contract_commission_allocations capturing_allocation
        ON capturing_allocation.contract_id = c.id
        AND capturing_allocation.role = 'CAPTURING'
        AND capturing_allocation.status = 'RECORDED'
      LEFT JOIN users capturing_broker_user
        ON capturing_broker_user.id = capturing_allocation.broker_id
      LEFT JOIN contract_commission_allocations selling_allocation
        ON selling_allocation.contract_id = c.id
        AND selling_allocation.role = 'SELLING'
        AND selling_allocation.status = 'RECORDED'
      LEFT JOIN users selling_broker_user
        ON selling_broker_user.id = selling_allocation.broker_id
      WHERE c.status = 'FINALIZED'
        AND YEAR(COALESCE(c.finalized_at, c.updated_at)) = ?
        AND MONTH(COALESCE(c.finalized_at, c.updated_at)) = ?
      ORDER BY COALESCE(c.finalized_at, c.updated_at) DESC, c.id DESC
    `,
    [year, month],
  );

  let totalVGV = 0;
  let totalCaptadores = 0;
  let totalVendedores = 0;
  let totalPlataforma = 0;

  const transactions = rows.flatMap((row) => {
    const commissionData = parseStoredJsonObject(row.commission_data);
    // The allocation projection is the financial source of truth after a
    // contract is finalized. JSON remains only as a read fallback for records
    // finalized before the projection migration existed.
    const legacyBase = readCommissionValue(
      commissionData,
      'valorBaseComissao'
    ) || readCommissionValue(commissionData, 'valorVenda');
    const allocationBase = readAllocationValue(row.capturing_allocation_base_amount);
    const valorBaseComissao = allocationBase != null && allocationBase > 0
      ? allocationBase
      : legacyBase;
    const allocationCapturing = readAllocationValue(row.capturing_allocation_amount);
    const allocationSelling = readAllocationValue(row.selling_allocation_amount);
    const comissaoCaptador = allocationCapturing != null
      ? allocationCapturing
      : readCommissionValue(commissionData, 'comissaoCaptador');
    const comissaoVendedor = allocationSelling != null
      ? allocationSelling
      : readCommissionValue(commissionData, 'comissaoVendedor');
    const taxaPlataforma = readCommissionValue(commissionData, 'taxaPlataforma');

    if (valorBaseComissao <= 0) {
      return [];
    }

    totalVGV += valorBaseComissao;
    totalCaptadores += comissaoCaptador;
    totalVendedores += comissaoVendedor;
    totalPlataforma += taxaPlataforma;

    const signedId = row.signed_proposal_document_id;
    return [{
      contractId: row.id,
      negotiationId: row.negotiation_id,
      propertyId: Number(row.property_id),
      propertyTitle: row.property_title ?? null,
      propertyCode: row.property_code ?? null,
      propertyPurpose: row.property_purpose ?? null,
      capturingBrokerName: row.capturing_broker_name ?? null,
      sellingBrokerName: row.selling_broker_name ?? null,
      finalizedAt: toIsoString(row.finalized_at),
      signedProposalDocumentId:
        signedId != null && Number.isFinite(Number(signedId)) ? Number(signedId) : null,
      signedProposalDocumentSource:
        signedId != null && Number.isFinite(Number(signedId))
          ? ('negotiation_documents' as const)
          : null,
      commissionData: {
        valorBaseComissao,
        // Mantém a resposta legível para consumidores que ainda usam este nome.
        valorVenda: valorBaseComissao,
        comissaoCaptador,
        comissaoVendedor,
        taxaPlataforma,
      },
    }];
  });

  return {
    month,
    year,
    summary: {
      totalVGV: Number(totalVGV.toFixed(2)),
      totalCaptadores: Number(totalCaptadores.toFixed(2)),
      totalVendedores: Number(totalVendedores.toFixed(2)),
      totalPlataforma: Number(totalPlataforma.toFixed(2)),
    },
    transactions,
  };
}
