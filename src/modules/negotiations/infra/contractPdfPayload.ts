import type { ContractDealType } from '../../contracts/domain/contract.types';

export const CONTRACT_DRAFT_TEMPLATE_VERSION = '1';

export function resolveContractDraftTemplate(dealType: ContractDealType): {
  templateKey: 'sale_contract_v1' | 'rental_contract_v1';
  templateVersion: string;
} {
  return {
    templateKey: dealType === 'rent' ? 'rental_contract_v1' : 'sale_contract_v1',
    templateVersion: CONTRACT_DRAFT_TEMPLATE_VERSION,
  };
}

export type ContractDraftPdfInput = {
  contractId: string;
  dealType: ContractDealType;
  propertyTitle: string;
  propertyAddress: string;
  seller: { name: string; cpf?: string | null; email?: string | null; phone?: string | null };
  buyer: { name: string; cpf?: string | null; email?: string | null; phone?: string | null };
  saleTerms: { cash: number; tradeIn: number; financing: number; others: number };
  rentalTerms: {
    monthlyRent: number;
    guaranteeType?: string | null;
    guaranteeAmount?: number | null;
    leaseTermMonths?: number | null;
    expectedStartDate?: string | null;
    monthlyDueDay?: number | null;
    condominiumResponsibility?: string | null;
    propertyTaxResponsibility?: string | null;
    observations?: string | null;
  };
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function nonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function party(source: ContractDraftPdfInput['seller']) {
  return {
    name: text(source.name),
    cpf: text(source.cpf),
    email: text(source.email),
    phone: text(source.phone),
  };
}

export function buildContractPdfPayload(data: ContractDraftPdfInput): Record<string, unknown> {
  return {
    contract_id: text(data.contractId),
    deal_type: data.dealType,
    property_title: text(data.propertyTitle),
    property_address: text(data.propertyAddress),
    seller: party(data.seller),
    buyer: party(data.buyer),
    sale_terms: {
      cash: nonNegative(data.saleTerms.cash),
      trade_in: nonNegative(data.saleTerms.tradeIn),
      financing: nonNegative(data.saleTerms.financing),
      others: nonNegative(data.saleTerms.others),
    },
    rental_terms: {
      monthly_rent: nonNegative(data.rentalTerms.monthlyRent),
      guarantee_type: text(data.rentalTerms.guaranteeType),
      guarantee_amount: nonNegative(data.rentalTerms.guaranteeAmount),
      lease_term_months: Math.trunc(nonNegative(data.rentalTerms.leaseTermMonths)),
      expected_start_date: text(data.rentalTerms.expectedStartDate),
      monthly_due_day: Math.trunc(nonNegative(data.rentalTerms.monthlyDueDay)),
      condominium_responsibility: text(data.rentalTerms.condominiumResponsibility),
      property_tax_responsibility: text(data.rentalTerms.propertyTaxResponsibility),
      observations: text(data.rentalTerms.observations),
    },
  };
}
