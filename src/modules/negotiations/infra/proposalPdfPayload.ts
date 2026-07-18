import { ValidationError } from '../domain/errors/ValidationError';
import type { ProposalData } from '../domain/states/NegotiationState';

function toRequiredText(value: unknown, fieldName: string): string {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new ValidationError(`${fieldName} is required to generate proposal PDF.`);
  }
  return text;
}

function toRequiredNumber(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`${fieldName} is required to generate proposal PDF.`);
  }
  return parsed;
}

function toOptionalText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function toOptionalNumber(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(`${fieldName} must be a non-negative number to generate proposal PDF.`);
  }
  return parsed;
}

export function buildProposalPdfPayload(data: ProposalData): {
  clientName: string;
  clientCpf: string;
  property_address: string;
  deal_type: string | null;
  broker_name: string;
  selling_broker_name: string | null;
  payment_method: string | null;
  value: number;
  payment: {
    cash: number;
    trade_in: number;
    financing: number;
    others: number;
  };
  validity_days: number;
  rental_terms?: {
    monthly_rent: number;
    guarantee_type: string | null;
    guarantee_amount: number | null;
    lease_term_months: number | null;
    expected_start_date: string | null;
    monthly_due_day: number | null;
    condominium_responsibility: string | null;
    property_tax_responsibility: string | null;
    observations: string | null;
  };
} {
  const payment = data.payment ?? {};
  const rentalTerms = data.rentalTerms ?? null;
  const isRental = data.dealType === 'rent';

  return {
    clientName: toRequiredText(data.clientName, 'clientName'),
    clientCpf: toRequiredText(data.clientCpf, 'clientCpf'),
    property_address: toRequiredText(data.propertyAddress, 'propertyAddress'),
    deal_type: data.dealType ?? null,
    broker_name: toRequiredText(data.brokerName, 'brokerName'),
    selling_broker_name: toOptionalText(data.sellingBrokerName),
    payment_method: toOptionalText(data.paymentMethod),
    value: toRequiredNumber(data.value, 'value'),
    payment: {
      cash: toRequiredNumber(payment.cash, 'payment.cash'),
      trade_in: toRequiredNumber(payment.tradeIn, 'payment.tradeIn'),
      financing: toRequiredNumber(payment.financing, 'payment.financing'),
      others: toRequiredNumber(payment.others, 'payment.others'),
    },
    validity_days: toRequiredNumber(data.validityDays, 'validityDays'),
    ...(isRental
      ? {
          rental_terms: {
            // Existing rental proposals only persisted the amount. Keep them renderable.
            monthly_rent: toOptionalNumber(rentalTerms?.monthlyRent, 'rentalTerms.monthlyRent') ??
              toRequiredNumber(data.value, 'value'),
            guarantee_type: toOptionalText(rentalTerms?.guaranteeType),
            guarantee_amount: toOptionalNumber(rentalTerms?.guaranteeAmount, 'rentalTerms.guaranteeAmount'),
            lease_term_months: toOptionalNumber(
              rentalTerms?.leaseTermMonths,
              'rentalTerms.leaseTermMonths'
            ),
            expected_start_date: toOptionalText(rentalTerms?.expectedStartDate),
            monthly_due_day: toOptionalNumber(rentalTerms?.monthlyDueDay, 'rentalTerms.monthlyDueDay'),
            condominium_responsibility: toOptionalText(rentalTerms?.condominiumResponsibility),
            property_tax_responsibility: toOptionalText(rentalTerms?.propertyTaxResponsibility),
            observations: toOptionalText(rentalTerms?.observations),
          },
        }
      : {}),
  };
}
