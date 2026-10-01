import { normalizeValidCpf } from './contractPartyResolutionService';

export const contractPartyFieldLimits = {
  name: 120,
  profession: 80,
  email: 254,
  cpfDigits: 11,
  phoneDigits: 11,
  bankDetails: 500,
} as const;

const maritalStatusOptions = new Set([
  'Solteiro(a)',
  'Casado(a)',
  'Divorciado(a)',
  'Viúvo(a)',
  'União Estável',
]);

const rentalGuaranteeOptions = new Set(['Fiador', 'Seguro Fiança', 'Caução']);

export type ContractPartyValidationFields = Record<string, string>;

function addError(fields: ContractPartyValidationFields, key: string, message: string): void {
  if (!fields[key]) fields[key] = message;
}

function normalizeText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeTextField(
  source: Record<string, unknown>,
  key: string,
  fieldName: string,
  limit: number,
  label: string,
  fields: ContractPartyValidationFields,
): void {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  const value = normalizeText(source[key]);
  source[key] = value;
  if (value != null && value.length > limit) {
    addError(fields, `${fieldName}.${key}`, `${label} deve ter no máximo ${limit} caracteres.`);
  }
}

function normalizeCpfField(
  source: Record<string, unknown>,
  key: string,
  fieldName: string,
  fields: ContractPartyValidationFields,
): void {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  if (source[key] == null || String(source[key]).trim() === '') {
    source[key] = null;
    return;
  }
  const cpf = normalizeValidCpf(source[key]);
  if (!cpf) {
    addError(fields, `${fieldName}.${key}`, 'Informe um CPF válido.');
    return;
  }
  source[key] = cpf;
}

function normalizePhoneField(
  source: Record<string, unknown>,
  key: string,
  fieldName: string,
  fields: ContractPartyValidationFields,
): void {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  if (source[key] == null || String(source[key]).trim() === '') {
    source[key] = null;
    return;
  }
  const digits = String(source[key]).replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 11) {
    addError(fields, `${fieldName}.${key}`, 'Informe um telefone válido com DDD.');
    return;
  }
  source[key] = digits;
}

function normalizeEmailField(
  source: Record<string, unknown>,
  fieldName: string,
  fields: ContractPartyValidationFields,
): void {
  if (!Object.prototype.hasOwnProperty.call(source, 'email')) return;
  const email = normalizeText(source.email);
  source.email = email;
  if (email == null) return;
  if (email.length > contractPartyFieldLimits.email) {
    addError(fields, `${fieldName}.email`, `E-mail deve ter no máximo ${contractPartyFieldLimits.email} caracteres.`);
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    addError(fields, `${fieldName}.email`, 'Informe um e-mail válido.');
  }
}

function normalizeSelectField(
  source: Record<string, unknown>,
  keys: readonly string[],
  fieldName: string,
  options: ReadonlySet<string>,
  message: string,
  fields: ContractPartyValidationFields,
): void {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = normalizeText(source[key]);
    source[key] = value;
    if (value != null && !options.has(value)) {
      addError(fields, `${fieldName}.${key}`, message);
    }
  }
}

/** Validates only values present in a draft patch; completeness is checked by readiness. */
export function normalizeContractPartyQualification(
  source: Record<string, unknown>,
  fieldName: string,
): ContractPartyValidationFields {
  const fields: ContractPartyValidationFields = {};

  for (const key of ['nome', 'name', 'fullName', 'full_name', 'clientName', 'conjuge_nome', 'conjugeNome', 'spouse_name', 'spouseName']) {
    normalizeTextField(source, key, fieldName, contractPartyFieldLimits.name, 'Nome', fields);
  }
  for (const key of ['profissao', 'conjuge_profissao', 'conjugeProfissao', 'spouse_profession', 'spouseProfession']) {
    normalizeTextField(source, key, fieldName, contractPartyFieldLimits.profession, 'Profissão', fields);
  }
  for (const key of ['dados_bancarios', 'dadosBancarios']) {
    normalizeTextField(source, key, fieldName, contractPartyFieldLimits.bankDetails, 'Dados bancários', fields);
  }
  for (const key of ['cpf', 'clientCpf', 'conjuge_cpf', 'conjugeCpf', 'spouse_cpf', 'spouseCpf']) {
    normalizeCpfField(source, key, fieldName, fields);
  }
  for (const key of ['telefone', 'phone']) {
    normalizePhoneField(source, key, fieldName, fields);
  }
  normalizeEmailField(source, fieldName, fields);
  normalizeSelectField(
    source,
    ['estado_civil', 'estadoCivil'],
    fieldName,
    maritalStatusOptions,
    'Selecione um estado civil válido.',
    fields,
  );
  normalizeSelectField(
    source,
    ['garantia_locacao', 'garantiaLocacao'],
    fieldName,
    rentalGuaranteeOptions,
    'Selecione uma garantia de locação válida.',
    fields,
  );

  return fields;
}

export function validateDifferentPartyCpfs(
  sellerInfo: Record<string, unknown>,
  buyerInfo: Record<string, unknown>,
): ContractPartyValidationFields {
  const sellerCpf = normalizeValidCpf(sellerInfo.cpf);
  const buyerCpf = normalizeValidCpf(buyerInfo.cpf ?? buyerInfo.clientCpf);
  if (!sellerCpf || !buyerCpf || sellerCpf !== buyerCpf) return {};
  return {
    'sellerInfo.cpf': 'O CPF do locador e do locatário deve ser diferente.',
    'buyerInfo.cpf': 'O CPF do locador e do locatário deve ser diferente.',
  };
}
