import type { Express } from 'express';

import {
  CLIENTE_OUTRO_SLOT_TYPES,
  type ContractDocumentCategoryCode,
  type ContractDocumentCategoryStatus,
  type ContractDocumentType,
  type ContractDocumentValidationCode,
} from './contract.types';

export type ContractDocumentSide = 'seller' | 'buyer';

export interface ContractDocumentValidationIssue {
  code: ContractDocumentValidationCode;
  message: string;
  field?: string;
  expected?: string;
  received?: string;
}

export interface ContractDocumentValidationResult {
  isValid: boolean;
  status: ContractDocumentCategoryStatus;
  issues: ContractDocumentValidationIssue[];
}

export const BUYER_REQUIRED_DOCUMENT_CATEGORIES: ContractDocumentCategoryCode[] = [
  'identidade',
  'comprovante_endereco',
  'estado_civil',
  'conjuge_documentos',
  'comprovante_renda',
];

export const SELLER_REQUIRED_DOCUMENT_CATEGORIES: ContractDocumentCategoryCode[] = [
  'identidade',
  'dados_bancarios',
  'comprovante_endereco',
  'estado_civil',
  'conjuge_documentos',
  'docs_imovel',
];

const ALLOWED_FILE_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf'];
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MIN_FILE_BYTES = 512;

const CATEGORY_DOCUMENT_TYPES: Record<
  ContractDocumentCategoryCode,
  ReadonlySet<ContractDocumentType>
> = {
  identidade: new Set([
    'doc_identidade',
    'cliente_cnh',
    'cliente_identidade',
  ]),
  comprovante_endereco: new Set(['comprovante_endereco']),
  estado_civil: new Set(['certidao_casamento_nascimento']),
  conjuge_documentos: new Set(['outro']),
  comprovante_renda: new Set(['comprovante_renda']),
  dados_bancarios: new Set(['outro']),
  outro: new Set(['outro', ...CLIENTE_OUTRO_SLOT_TYPES]),
  docs_imovel: new Set(['certidao_inteiro_teor', 'certidao_onus_acoes']),
};

export function resolveDocumentCategoryFromType(
  documentType: ContractDocumentType
): ContractDocumentCategoryCode | null {
  for (const [category, allowedTypes] of Object.entries(CATEGORY_DOCUMENT_TYPES)) {
    if (allowedTypes.has(documentType)) {
      return category as ContractDocumentCategoryCode;
    }
  }
  return null;
}

export function resolveFallbackDocumentTypeByCategory(
  category: ContractDocumentCategoryCode
): ContractDocumentType {
  switch (category) {
    case 'identidade':
      return 'doc_identidade';
    case 'comprovante_endereco':
      return 'comprovante_endereco';
    case 'estado_civil':
      return 'certidao_casamento_nascimento';
    case 'conjuge_documentos':
      return 'outro';
    case 'comprovante_renda':
      return 'comprovante_renda';
    case 'dados_bancarios':
      return 'outro';
    case 'outro':
      return 'outro';
    case 'docs_imovel':
      return 'certidao_inteiro_teor';
  }
}

export function validateContractDocumentUpload(input: {
  file: Pick<Express.Multer.File, 'mimetype' | 'originalname' | 'size'>;
  documentType: ContractDocumentType;
  category: ContractDocumentCategoryCode | null;
  side: ContractDocumentSide | null;
  requiresSide: boolean;
  requiresCategory?: boolean;
}): ContractDocumentValidationResult {
  const issues: ContractDocumentValidationIssue[] = [];
  const requiresCategory = input.requiresCategory !== false;

  if (requiresCategory && !input.category) {
    issues.push({
      code: 'CATEGORY_REQUIRED',
      field: 'documentCategory',
      message: 'Categoria documental obrigatória para validação.',
    });
  }

  if (input.requiresSide && !input.side) {
    issues.push({
      code: 'SIDE_REQUIRED',
      field: 'side',
      message: 'Lado do documento obrigatório (seller|buyer).',
    });
  }

  const allowedByCategory = input.category
    ? CATEGORY_DOCUMENT_TYPES[input.category]
    : null;
  if (requiresCategory && allowedByCategory && !allowedByCategory.has(input.documentType)) {
    issues.push({
      code: 'TYPE_CATEGORY_MISMATCH',
      field: 'documentType',
      message: 'Tipo de documento não compatível com a categoria enviada.',
      expected: Array.from(allowedByCategory).join(','),
      received: input.documentType,
    });
  }

  const extension = input.file.originalname.split('.').pop()?.trim().toLowerCase() ?? '';
  if (!ALLOWED_FILE_EXTENSIONS.has(extension)) {
    issues.push({
      code: 'EXTENSION_INVALID',
      field: 'file',
      message: 'Extensão inválida. Use PDF, JPG, JPEG, PNG ou WEBP.',
      received: extension || 'sem_extensao',
    });
  }

  const mime = String(input.file.mimetype ?? '').trim().toLowerCase();
  if (!ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    issues.push({
      code: 'MIME_INVALID',
      field: 'file',
      message: 'Tipo MIME inválido para documentação contratual.',
      received: mime || 'desconhecido',
    });
  }

  if (input.file.size < MIN_FILE_BYTES) {
    issues.push({
      code: 'FILE_TOO_SMALL',
      field: 'file',
      message: 'Arquivo muito pequeno para validação.',
      expected: `>=${MIN_FILE_BYTES}`,
      received: String(input.file.size),
    });
  }

  if (input.file.size > MAX_FILE_BYTES) {
    issues.push({
      code: 'FILE_TOO_LARGE',
      field: 'file',
      message: 'Arquivo excede o limite máximo permitido (15MB).',
      expected: `<=${MAX_FILE_BYTES}`,
      received: String(input.file.size),
    });
  }

  return {
    isValid: issues.length === 0,
    status: issues.length === 0 ? 'PENDING' : 'REJECTED',
    issues,
  };
}

export function requiredCategoriesBySide(
  side: ContractDocumentSide
): ContractDocumentCategoryCode[] {
  return side === 'seller'
    ? SELLER_REQUIRED_DOCUMENT_CATEGORIES
    : BUYER_REQUIRED_DOCUMENT_CATEGORIES;
}
