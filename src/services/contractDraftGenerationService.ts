import { RowDataPacket } from 'mysql2';

import {
  isContractDealType,
  type ContractDealType,
} from '../modules/contracts/domain/contract.types';
import { ExternalPdfService } from '../modules/negotiations/infra/ExternalPdfService';
import {
  resolveContractDraftTemplate,
  type ContractDraftPdfInput,
} from '../modules/negotiations/infra/contractPdfPayload';
import {
  getContractDbConnection,
} from './contractPersistenceService';
import { storeNegotiationDocumentToR2 } from './negotiationDocumentStorageService';
import {
  appendWorkflowAuditEvent,
  parseWorkflowMetadata,
} from './contractWorkflowMetadata';

type ContractDraftRow = RowDataPacket & {
  id: string;
  negotiation_id: string;
  deal_type: string | null;
  status: string;
  seller_info: unknown;
  buyer_info: unknown;
  workflow_metadata: unknown;
  payment_details: unknown;
  property_title: string | null;
  address: string | null;
  numero: string | null;
  bairro: string | null;
  city: string | null;
  state: string | null;
};

type DraftDocumentRow = RowDataPacket & {
  id: number;
  metadata_json: unknown;
};

export type ContractDraftGenerationResult = {
  contractId: string;
  documentId: number | null;
  generated: boolean;
  dealType: ContractDealType;
  templateKey: string;
  templateVersion: string;
};

export class ContractDraftGenerationError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export function isContractDraftGenerationError(
  error: unknown
): error is ContractDraftGenerationError {
  return error instanceof ContractDraftGenerationError;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function firstText(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return '';
}

function resolveParty(source: unknown): ContractDraftPdfInput['seller'] {
  const info = parseJsonObject(source);
  return {
    name: firstText(info, ['nome', 'name']),
    cpf: firstText(info, ['cpf']),
    email: firstText(info, ['email']),
    phone: firstText(info, ['telefone', 'phone']),
  };
}

function resolvePropertyAddress(row: ContractDraftRow): string {
  const address = text(row.address);
  const numberPart = text(row.numero);
  const neighborhood = text(row.bairro);
  const city = text(row.city);
  const state = text(row.state);
  return [address, numberPart && `Nº ${numberPart}`, neighborhood, city, state]
    .filter(Boolean)
    .join(', ');
}

function resolvePaymentInput(row: ContractDraftRow, dealType: ContractDealType): Pick<
  ContractDraftPdfInput,
  'saleTerms' | 'rentalTerms'
> {
  const paymentDetails = parseJsonObject(row.payment_details);
  const details = parseJsonObject(paymentDetails.details);
  const rental = parseJsonObject(details.rentalTerms ?? details.rental_terms);

  return {
    saleTerms: {
      cash: number(details.dinheiro ?? details.paymentDinheiro ?? paymentDetails.dinheiro),
      tradeIn: number(details.permuta ?? details.paymentPermuta ?? paymentDetails.permuta),
      financing: number(details.financiamento ?? details.paymentFinanciamento ?? paymentDetails.financiamento),
      others: number(details.outros ?? details.paymentOutros ?? paymentDetails.outros),
    },
    rentalTerms: {
      monthlyRent: number(
        rental.monthlyRent ?? rental.monthly_rent ?? paymentDetails.amount ?? details.amount
      ),
      guaranteeType: text(rental.guaranteeType ?? rental.guarantee_type) || null,
      guaranteeAmount: number(rental.guaranteeAmount ?? rental.guarantee_amount),
      leaseTermMonths: number(rental.leaseTermMonths ?? rental.lease_term_months),
      expectedStartDate: text(rental.expectedStartDate ?? rental.expected_start_date) || null,
      monthlyDueDay: number(rental.monthlyDueDay ?? rental.monthly_due_day),
      condominiumResponsibility:
        text(rental.condominiumResponsibility ?? rental.condominium_responsibility) || null,
      propertyTaxResponsibility:
        text(rental.propertyTaxResponsibility ?? rental.property_tax_responsibility) || null,
      observations: text(rental.observations) || null,
    },
  };
}

function resolveDealType(value: unknown): ContractDealType | null {
  const normalized = text(value).toLowerCase();
  return isContractDealType(normalized) ? normalized : null;
}

export function buildContractDraftDocumentMetadata(input: {
  contractId: string;
  dealType: ContractDealType;
  generatedVia: 'automatic' | 'admin_upload';
  originalFileName: string;
  generationRevision: number;
}): Record<string, unknown> {
  const template = resolveContractDraftTemplate(input.dealType);
  return {
    contractId: input.contractId,
    owner_side: 'seller',
    side: 'seller',
    originalFileName: input.originalFileName,
    documentKind: 'contract_draft',
    dealType: input.dealType,
    templateKey: template.templateKey,
    templateVersion: template.templateVersion,
    generated: input.generatedVia === 'automatic',
    generatedVia: input.generatedVia,
    isActiveContractDraft: true,
    generationRevision: input.generationRevision,
    generatedAt: new Date().toISOString(),
  };
}

export function isCanonicalContractDraftMetadata(
  value: unknown,
  contractId: string,
  dealType: ContractDealType
): boolean {
  const metadata = parseJsonObject(value);
  const template = resolveContractDraftTemplate(dealType);
  const status = text(
    metadata.status ?? metadata.reviewStatus ?? metadata.validationStatus ?? 'APPROVED'
  ).toUpperCase();
  return (
    text(metadata.contractId) === contractId &&
    text(metadata.documentKind) === 'contract_draft' &&
    text(metadata.dealType).toLowerCase() === dealType &&
    text(metadata.templateKey) === template.templateKey &&
    text(metadata.templateVersion) === template.templateVersion &&
    metadata.isActiveContractDraft === true &&
    status !== 'REJECTED'
  );
}

function nextGenerationRevision(workflowMetadata: unknown): number {
  const current = Number(parseWorkflowMetadata(workflowMetadata).contractDraftGenerationRevision);
  return Number.isFinite(current) && current >= 0 ? Math.trunc(current) + 1 : 1;
}

/**
 * Generates exactly one active canonical minute per contract and modality.
 * The contract row remains locked across generation to prevent duplicate
 * requests from creating competing active drafts.
 */
export async function ensureContractDraftGenerated(
  contractIdInput: unknown,
  options: { forceRegenerate?: boolean } = {}
): Promise<ContractDraftGenerationResult> {
  const contractId = text(contractIdInput);
  if (!contractId) {
    throw new ContractDraftGenerationError(400, 'ID do contrato inválido.');
  }

  const tx = await getContractDbConnection();
  try {
    await tx.beginTransaction();
    const [rows] = await tx.query<ContractDraftRow[]>(
      `
        SELECT
          c.id,
          c.negotiation_id,
          c.deal_type,
          c.status,
          c.seller_info,
          c.buyer_info,
          c.workflow_metadata,
          n.payment_details,
          p.title AS property_title,
          p.address,
          p.numero,
          p.bairro,
          p.city,
          p.state
        FROM contracts c
        JOIN negotiations n ON n.id = c.negotiation_id
        JOIN properties p ON p.id = c.property_id
        WHERE c.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [contractId]
    );
    const contract = rows[0];
    if (!contract) {
      throw new ContractDraftGenerationError(404, 'Contrato não encontrado.');
    }
    if (text(contract.status).toUpperCase() !== 'IN_DRAFT') {
      throw new ContractDraftGenerationError(
        409,
        'A minuta automática só pode ser gerada em IN_DRAFT.'
      );
    }

    const dealType = resolveDealType(contract.deal_type);
    if (!dealType) {
      throw new ContractDraftGenerationError(
        422,
        'Contrato sem modalidade comercial canônica; a minuta não pode ser gerada.'
      );
    }
    const template = resolveContractDraftTemplate(dealType);

    const [draftRows] = await tx.query<DraftDocumentRow[]>(
      `
        SELECT id, metadata_json
        FROM negotiation_documents
        WHERE negotiation_id = ?
          AND document_type = 'contrato_minuta'
      `,
      [contract.negotiation_id]
    );
    const activeDraft = draftRows.find((row) =>
      isCanonicalContractDraftMetadata(row.metadata_json, contractId, dealType)
    );
    if (activeDraft && !options.forceRegenerate) {
      await tx.commit();
      return {
        contractId,
        documentId: Number(activeDraft.id),
        generated: false,
        dealType,
        ...template,
      };
    }

    if (options.forceRegenerate && activeDraft) {
      await tx.query(
        `
          UPDATE negotiation_documents
          SET metadata_json = JSON_SET(
            COALESCE(metadata_json, JSON_OBJECT()),
            '$.isActiveContractDraft', FALSE,
            '$.supersededAt', ?
          )
          WHERE id = ?
        `,
        [new Date().toISOString(), activeDraft.id]
      );
    }

    const seller = resolveParty(contract.seller_info);
    const buyer = resolveParty(contract.buyer_info);
    const propertyTitle = text(contract.property_title);
    const propertyAddress = resolvePropertyAddress(contract);
    if (!seller.name || !buyer.name || !propertyTitle || !propertyAddress) {
      throw new ContractDraftGenerationError(
        422,
        'Dados essenciais das partes ou do imóvel estão incompletos para gerar a minuta.'
      );
    }

    const payment = resolvePaymentInput(contract, dealType);
    if (dealType === 'rent' && payment.rentalTerms.monthlyRent <= 0) {
      throw new ContractDraftGenerationError(
        422,
        'A locação precisa ter valor mensal válido antes da geração da minuta.'
      );
    }
    const pdf = await new ExternalPdfService().generateContract({
      contractId,
      dealType,
      propertyTitle,
      propertyAddress,
      seller,
      buyer,
      ...payment,
    });

    const revision = nextGenerationRevision(contract.workflow_metadata);
    const originalFileName =
      dealType === 'rent' ? 'minuta-contrato-locacao.pdf' : 'minuta-contrato-compra-venda.pdf';
    const documentId = await storeNegotiationDocumentToR2({
      executor: tx,
      negotiationId: contract.negotiation_id,
      type: 'contract',
      documentType: 'contrato_minuta',
      content: pdf,
      contentType: 'application/pdf',
      metadataJson: buildContractDraftDocumentMetadata({
        contractId,
        dealType,
        generatedVia: 'automatic',
        originalFileName,
        generationRevision: revision,
      }),
    });

    const nextMetadata = appendWorkflowAuditEvent(contract.workflow_metadata, {
      action: 'contract_draft_generated',
      at: new Date().toISOString(),
      by: null,
      role: 'system',
      details: {
        documentId,
        dealType,
        templateKey: template.templateKey,
        templateVersion: template.templateVersion,
        generationRevision: revision,
        regenerated: options.forceRegenerate === true,
      },
    });
    nextMetadata.contractDraftGenerationRevision = revision;
    nextMetadata.contractDraft = {
      documentId,
      dealType,
      templateKey: template.templateKey,
      templateVersion: template.templateVersion,
      generatedAt: new Date().toISOString(),
      active: true,
    };
    await tx.query(
      `
        UPDATE contracts
        SET workflow_metadata = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [JSON.stringify(nextMetadata), contractId]
    );

    await tx.commit();
    return {
      contractId,
      documentId,
      generated: true,
      dealType,
      ...template,
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}
