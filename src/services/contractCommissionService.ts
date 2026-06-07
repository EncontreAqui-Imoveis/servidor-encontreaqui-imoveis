import { RowDataPacket } from 'mysql2';
import { queryContractRows } from './contractPersistenceService';

interface CommissionContractRow extends RowDataPacket {
  id: string;
  negotiation_id: string;
  property_id: number;
  commission_data: unknown;
  updated_at: Date | string | null;
  property_title: string | null;
  property_code: string | null;
  property_purpose: string | null;
  signed_proposal_document_id: number | null;
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
    finalizedAt: string | null;
    signedProposalDocumentId: number | null;
    signedProposalDocumentSource: 'negotiation_documents' | null;
    commissionData: {
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
        c.updated_at,
        p.title AS property_title,
        p.code AS property_code,
        p.purpose AS property_purpose,
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
      WHERE c.status = 'FINALIZED'
        AND YEAR(c.updated_at) = ?
        AND MONTH(c.updated_at) = ?
      ORDER BY c.updated_at DESC, c.id DESC
    `,
    [year, month],
  );

  let totalVGV = 0;
  let totalCaptadores = 0;
  let totalVendedores = 0;
  let totalPlataforma = 0;

  const transactions = rows.flatMap((row) => {
    const commissionData = parseStoredJsonObject(row.commission_data);
    const valorVenda = readCommissionValue(commissionData, 'valorVenda');
    const comissaoCaptador = readCommissionValue(commissionData, 'comissaoCaptador');
    const comissaoVendedor = readCommissionValue(commissionData, 'comissaoVendedor');
    const taxaPlataforma = readCommissionValue(commissionData, 'taxaPlataforma');

    if (valorVenda <= 0) {
      return [];
    }

    totalVGV += valorVenda;
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
      finalizedAt: toIsoString(row.updated_at),
      signedProposalDocumentId:
        signedId != null && Number.isFinite(Number(signedId)) ? Number(signedId) : null,
      signedProposalDocumentSource:
        signedId != null && Number.isFinite(Number(signedId))
          ? ('negotiation_documents' as const)
          : null,
      commissionData: {
        valorVenda,
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
