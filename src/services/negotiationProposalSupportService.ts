import {
  ProposalData,
  type DealType,
  type RentalProposalTerms,
} from '../modules/negotiations/domain/states/NegotiationState';
import { isValidCpf, normalizeCpfDigits } from '../utils/cpfValidator';

export interface ProposalBody {
  clientName?: unknown;
  client_name?: unknown;
  clientCpf?: unknown;
  propertyAddress?: unknown;
  property_address?: unknown;
  brokerName?: unknown;
  broker_name?: unknown;
  sellingBrokerName?: unknown;
  selling_broker_name?: unknown;
  value?: unknown;
  paymentMethod?: unknown;
  payment_method?: unknown;
  dealType?: unknown;
  deal_type?: unknown;
  payment?: {
    cash?: unknown;
    tradeIn?: unknown;
    trade_in?: unknown;
    financing?: unknown;
    others?: unknown;
    dinheiro?: unknown;
    permuta?: unknown;
    financiamento?: unknown;
    outros?: unknown;
  };
  validityDays?: unknown;
  validity_days?: unknown;
}

export interface ProposalWizardBody {
  propertyId?: unknown;
  clientName?: unknown;
  clientCpf?: unknown;
  buyerEmail?: unknown;
  buyer_email?: unknown;
  clientEmail?: unknown;
  client_email?: unknown;
  buyerUserId?: unknown;
  buyer_user_id?: unknown;
  validadeDias?: unknown;
  proposalValidityDate?: unknown;
  proposal_validity_date?: unknown;
  proposalValidUntil?: unknown;
  proposal_valid_until?: unknown;
  sellerBrokerId?: unknown;
  proposalValue?: unknown;
  valorProposta?: unknown;
  dealType?: unknown;
  deal_type?: unknown;
  pagamento?: {
    dinheiro?: unknown;
    permuta?: unknown;
    financiamento?: unknown;
    outros?: unknown;
  };
  rentalTerms?: RentalTermsBody;
  rental_terms?: RentalTermsBody;
}

interface RentalTermsBody {
  monthlyRent?: unknown;
  monthly_rent?: unknown;
  guaranteeType?: unknown;
  guarantee_type?: unknown;
  guaranteeAmount?: unknown;
  guarantee_amount?: unknown;
  leaseTermMonths?: unknown;
  lease_term_months?: unknown;
  expectedStartDate?: unknown;
  expected_start_date?: unknown;
  monthlyDueDay?: unknown;
  monthly_due_day?: unknown;
  condominiumResponsibility?: unknown;
  condominium_responsibility?: unknown;
  propertyTaxResponsibility?: unknown;
  property_tax_responsibility?: unknown;
  observations?: unknown;
}

export interface ParsedProposalWizard {
  propertyId: number;
  clientName: string;
  clientCpf: string;
  buyerEmail: string | null;
  dealType: DealType;
  buyerUserId: number | null;
  validadeDias: number;
  sellerBrokerId: number | null;
  pagamento: {
    dinheiro: number;
    permuta: number;
    financiamento: number;
    outros: number;
  };
  rentalTerms: RentalProposalTerms | null;
}

interface PropertyAddressRow {
  address: string | null;
  numero: string | null;
  quadra: string | null;
  lote: string | null;
  bairro: string | null;
  city: string | null;
  state: string | null;
}

interface PropertyValueRow {
  price: number | null;
  price_sale: number | null;
  price_rent: number | null;
}

export function toCents(value: number): number {
  return Math.round(value * 100);
}

function parseLocalizedDecimal(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/R\$\s*/gi, '').replace(/[^\d.,+-]/g, '');
  if (!normalized) {
    return null;
  }

  const hasMinus = normalized.startsWith('-');
  const unsigned = hasMinus || normalized.startsWith('+') ? normalized.slice(1) : normalized;
  const hasComma = unsigned.includes(',');
  const hasDot = unsigned.includes('.');

  let numericLike = unsigned;
  if (hasComma && hasDot) {
    const commaIndex = unsigned.lastIndexOf(',');
    const dotIndex = unsigned.lastIndexOf('.');
    const decimalSeparator = commaIndex > dotIndex ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    numericLike = unsigned
      .split(thousandsSeparator)
      .join('')
      .replace(decimalSeparator, '.');
  } else if (hasComma) {
    numericLike = unsigned.includes(',') && unsigned.split(',').length === 2
      ? unsigned.replace(',', '.')
      : unsigned.split(',').join('');
  }

  const signed = hasMinus ? `-${numericLike}` : numericLike;
  const parsed = Number(signed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parsePositiveNumber(input: unknown, fieldName: string): number {
  const parsed = parseLocalizedDecimal(input);
  if (parsed === null || parsed < 0) {
    throw new Error(`${fieldName} deve ser um numero maior ou igual a zero.`);
  }
  return parsed;
}

function parseOptionalText(input: unknown, fieldName: string, maxLength: number): string | null {
  if (input === undefined || input === null) {
    return null;
  }

  const value = String(input).trim();
  if (!value) {
    return null;
  }
  if (value.length > maxLength) {
    throw new Error(`${fieldName} excede o limite de ${maxLength} caracteres.`);
  }
  return value;
}

function parseOptionalNonNegativeNumber(input: unknown, fieldName: string): number | null {
  if (input === undefined || input === null || String(input).trim() === '') {
    return null;
  }
  return parsePositiveNumber(input, fieldName);
}

function parseOptionalPositiveInteger(input: unknown, fieldName: string): number | null {
  const value = parseOptionalNonNegativeNumber(input, fieldName);
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} deve ser um inteiro maior que zero.`);
  }
  return value;
}

function parseOptionalDueDay(input: unknown): number | null {
  const value = parseOptionalPositiveInteger(input, 'rentalTerms.monthlyDueDay');
  if (value !== null && value > 31) {
    throw new Error('rentalTerms.monthlyDueDay deve estar entre 1 e 31.');
  }
  return value;
}

function parseOptionalIsoDate(input: unknown): string | null {
  const value = parseOptionalText(input, 'rentalTerms.expectedStartDate', 10);
  if (value === null) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('rentalTerms.expectedStartDate deve usar o formato YYYY-MM-DD.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error('rentalTerms.expectedStartDate deve ser uma data válida.');
  }
  return value;
}

function parseRentalTerms(body: ProposalWizardBody, dealType: DealType): RentalProposalTerms | null {
  if (dealType !== 'rent') {
    return null;
  }

  const raw = body.rentalTerms ?? body.rental_terms ?? {};
  return {
    monthlyRent: parseOptionalNonNegativeNumber(raw.monthlyRent ?? raw.monthly_rent, 'rentalTerms.monthlyRent'),
    guaranteeType: parseOptionalText(raw.guaranteeType ?? raw.guarantee_type, 'rentalTerms.guaranteeType', 80),
    guaranteeAmount: parseOptionalNonNegativeNumber(
      raw.guaranteeAmount ?? raw.guarantee_amount,
      'rentalTerms.guaranteeAmount'
    ),
    leaseTermMonths: parseOptionalPositiveInteger(
      raw.leaseTermMonths ?? raw.lease_term_months,
      'rentalTerms.leaseTermMonths'
    ),
    expectedStartDate: parseOptionalIsoDate(raw.expectedStartDate ?? raw.expected_start_date),
    monthlyDueDay: parseOptionalDueDay(raw.monthlyDueDay ?? raw.monthly_due_day),
    condominiumResponsibility: parseOptionalText(
      raw.condominiumResponsibility ?? raw.condominium_responsibility,
      'rentalTerms.condominiumResponsibility',
      80
    ),
    propertyTaxResponsibility: parseOptionalText(
      raw.propertyTaxResponsibility ?? raw.property_tax_responsibility,
      'rentalTerms.propertyTaxResponsibility',
      80
    ),
    observations: parseOptionalText(raw.observations, 'rentalTerms.observations', 1000),
  };
}

export function normalizeProposalCpfKey(raw: string): string {
  return normalizeCpfDigits(String(raw ?? ''));
}

export function normalizeDealType(value: unknown): DealType | null {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!normalized) return null;
  if (normalized.includes('alug') || normalized.includes('rent')) return 'rent';
  if (normalized.includes('vend') || normalized.includes('sale')) return 'sale';
  return null;
}

export function inferDealTypeFromPurpose(purpose: unknown): DealType {
  const normalized = String(purpose ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalized.includes('alug') || normalized.includes('rent') ? 'rent' : 'sale';
}

export function parseProposalData(body: ProposalBody): ProposalData {
  const clientName = String(body.clientName ?? body.client_name ?? '').trim();
  const clientCpf = String(body.clientCpf ?? '').trim();
  const propertyAddress = String(body.propertyAddress ?? body.property_address ?? '').trim();
  const brokerName = String(body.brokerName ?? body.broker_name ?? '').trim();
  const numericValue = Number(body.value);
  const paymentMethod = String(body.paymentMethod ?? body.payment_method ?? '').trim();
  const dealType = normalizeDealType(body.dealType ?? body.deal_type) ?? undefined;
  const validityDays = Number(body.validityDays ?? body.validity_days ?? 10);
  const payment = body.payment ?? {};

  const parsePaymentField = (fieldName: string, ...values: unknown[]): number => {
    const firstDefined = values.find(
      (value) => value !== undefined && value !== null && String(value).trim() !== ''
    );
    if (firstDefined === undefined) {
      return 0;
    }
    return parsePositiveNumber(firstDefined, fieldName);
  };

  let cash = parsePaymentField('payment.cash', payment.cash, payment.dinheiro);
  const tradeIn = parsePaymentField('payment.trade_in', payment.trade_in, payment.tradeIn, payment.permuta);
  const financing = parsePaymentField(
    'payment.financing',
    payment.financing,
    payment.financiamento
  );
  const others = parsePaymentField('payment.others', payment.others, payment.outros);

  if (!clientName || !clientCpf || !propertyAddress || !brokerName) {
    throw new Error(
      'Campos obrigatorios ausentes. Informe clientName, clientCpf, propertyAddress e brokerName.'
    );
  }

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error('Campo value deve ser um numero maior que zero.');
  }

  if (!Number.isInteger(validityDays) || validityDays <= 0) {
    throw new Error('Campo validity_days deve ser um inteiro maior que zero.');
  }

  let paymentTotal = cash + tradeIn + financing + others;
  if (paymentTotal <= 0) {
    cash = numericValue;
    paymentTotal = numericValue;
  }

  if (toCents(paymentTotal) !== toCents(numericValue)) {
    throw new Error('payment breakdown must match total value');
  }

  return {
    clientName,
    clientCpf,
    propertyAddress,
    dealType,
    brokerName,
    sellingBrokerName: brokerName,
    value: numericValue,
    payment: {
      cash,
      tradeIn,
      financing,
      others,
    },
    paymentMethod: paymentMethod || undefined,
    validityDays,
  };
}

export function parseProposalWizardBody(body: ProposalWizardBody): ParsedProposalWizard {
  const propertyId = Number(body.propertyId);
  const clientName = String(body.clientName ?? '').trim();
  const clientCpfDigits = normalizeCpfDigits(String(body.clientCpf ?? ''));
  const buyerEmailRaw = String(
    body.buyerEmail ?? body.buyer_email ?? body.clientEmail ?? body.client_email ?? ''
  ).trim();
  const buyerEmail = buyerEmailRaw ? buyerEmailRaw.toLowerCase() : null;
  const dealType = normalizeDealType(body.dealType ?? body.deal_type) ?? 'sale';
  const buyerUserId = normalizeOptionalPositiveId(body.buyerUserId ?? body.buyer_user_id);
  const validadeDiasRaw = body.validadeDias ?? 10;
  const validadeDias = Number(validadeDiasRaw);
  const pagamento = body.pagamento ?? {};
  const dinheiro = parsePositiveNumber(pagamento.dinheiro ?? 0, 'pagamento.dinheiro');
  const permuta = parsePositiveNumber(pagamento.permuta ?? 0, 'pagamento.permuta');
  const financiamento = parsePositiveNumber(
    pagamento.financiamento ?? 0,
    'pagamento.financiamento'
  );
  const outros = parsePositiveNumber(pagamento.outros ?? 0, 'pagamento.outros');
  const rentalTerms = parseRentalTerms(body, dealType);

  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    throw new Error('propertyId invalido.');
  }

  if (!clientName) {
    throw new Error('clientName e obrigatorio.');
  }

  if (!isValidCpf(clientCpfDigits)) {
    throw new Error('clientCpf invalido. Informe um CPF valido.');
  }

  if (buyerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    throw new Error('buyerEmail invalido.');
  }

  if (!Number.isInteger(validadeDias) || validadeDias <= 0) {
    throw new Error('validadeDias deve ser um inteiro maior que zero.');
  }

  const explicitValidityDateRaw =
    body.proposalValidityDate ??
    body.proposal_validity_date ??
    body.proposalValidUntil ??
    body.proposal_valid_until;
  if (
    explicitValidityDateRaw !== undefined &&
    explicitValidityDateRaw !== null &&
    String(explicitValidityDateRaw).trim() !== ''
  ) {
    const explicitValidityDate = new Date(String(explicitValidityDateRaw).trim());
    if (Number.isNaN(explicitValidityDate.getTime())) {
      throw new Error('proposal_validity_date invalida.');
    }
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    explicitValidityDate.setHours(0, 0, 0, 0);
    if (explicitValidityDate.getTime() < startOfToday.getTime()) {
      throw new Error('proposal_validity_date nao pode ser anterior a hoje.');
    }
  }

  return {
    propertyId,
    clientName,
    clientCpf: clientCpfDigits,
    buyerEmail,
    dealType,
    buyerUserId,
    validadeDias,
    sellerBrokerId: null,
    pagamento: {
      dinheiro,
      permuta,
      financiamento,
      outros,
    },
    rentalTerms,
  };
}

export function resolvePropertyAddress(row: PropertyAddressRow): string {
  const parts = [
    row.address,
    row.numero ? `Nº ${row.numero}` : null,
    row.bairro,
    row.city,
    row.state,
    row.quadra ? `Quadra ${row.quadra}` : null,
    row.lote ? `Lote ${row.lote}` : null,
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);

  return parts.join(', ');
}

export function resolvePropertyValue(row: PropertyValueRow): number {
  const sale = Number(row.price_sale ?? 0);
  const rent = Number(row.price_rent ?? 0);
  const fallback = Number(row.price ?? 0);
  const resolved = sale > 0 ? sale : rent > 0 ? rent : fallback;
  return Number.isFinite(resolved) && resolved > 0 ? resolved : 0;
}

export function normalizeOptionalPositiveId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isBrokerLikeRole(role: unknown): boolean {
  const normalized = String(role ?? '').trim().toLowerCase();
  return normalized === 'broker' || normalized === 'auxiliary_administrative';
}

export function buildProposalValidityDate(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() + days);
  const yyyy = now.getFullYear().toString().padStart(4, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function assertProposalValidityDateNotPast(value: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('proposal_validity_date invalida.');
  }
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  if (parsed.getTime() < startOfToday.getTime()) {
    throw new Error('proposal_validity_date nao pode ser anterior a hoje.');
  }
}
