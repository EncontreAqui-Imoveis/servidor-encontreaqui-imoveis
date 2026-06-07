import { ProposalData } from '../modules/negotiations/domain/states/NegotiationState';

export interface ProposalBody {
  clientName?: unknown;
  client_name?: unknown;
  clientCpf?: unknown;
  client_cpf?: unknown;
  propertyAddress?: unknown;
  property_address?: unknown;
  brokerName?: unknown;
  broker_name?: unknown;
  sellingBrokerName?: unknown;
  selling_broker_name?: unknown;
  value?: unknown;
  paymentMethod?: unknown;
  payment_method?: unknown;
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
  validadeDias?: unknown;
  proposalValidityDate?: unknown;
  proposal_validity_date?: unknown;
  proposalValidUntil?: unknown;
  proposal_valid_until?: unknown;
  sellerBrokerId?: unknown;
  proposalValue?: unknown;
  valorProposta?: unknown;
  pagamento?: {
    dinheiro?: unknown;
    permuta?: unknown;
    financiamento?: unknown;
    outros?: unknown;
  };
}

export interface ParsedProposalWizard {
  propertyId: number;
  clientName: string;
  clientCpf: string;
  validadeDias: number;
  sellerBrokerId: number | null;
  pagamento: {
    dinheiro: number;
    permuta: number;
    financiamento: number;
    outros: number;
  };
}

interface PropertyRow {
  address: string | null;
  numero: string | null;
  quadra: string | null;
  lote: string | null;
  bairro: string | null;
  city: string | null;
  state: string | null;
  price: number | null;
  price_sale: number | null;
  price_rent: number | null;
  broker_id?: number | null;
  owner_id?: number | null;
}

export function toCents(value: number): number {
  return Math.round(value * 100);
}

export function parsePositiveNumber(input: unknown, fieldName: string): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} deve ser um numero maior ou igual a zero.`);
  }
  return parsed;
}

export function normalizeProposalCpfKey(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '');
}

export function parseProposalData(body: ProposalBody): ProposalData {
  const clientName = String(body.clientName ?? body.client_name ?? '').trim();
  const clientCpf = String(body.clientCpf ?? body.client_cpf ?? '').trim();
  const propertyAddress = String(body.propertyAddress ?? body.property_address ?? '').trim();
  const brokerName = String(body.brokerName ?? body.broker_name ?? '').trim();
  const numericValue = Number(body.value);
  const paymentMethod = String(body.paymentMethod ?? body.payment_method ?? '').trim();
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
      'Campos obrigatorios ausentes. Informe client_name, client_cpf, property_address e broker_name.'
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
  const clientCpfDigits = String(body.clientCpf ?? '').replace(/\D/g, '');
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

  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    throw new Error('propertyId invalido.');
  }

  if (!clientName) {
    throw new Error('clientName e obrigatorio.');
  }

  if (clientCpfDigits.length != 11) {
    throw new Error('clientCpf invalido. Informe 11 digitos.');
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
    validadeDias,
    sellerBrokerId: null,
    pagamento: {
      dinheiro,
      permuta,
      financiamento,
      outros,
    },
  };
}

export function resolvePropertyAddress(row: PropertyRow): string {
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

export function resolvePropertyValue(row: PropertyRow): number {
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
