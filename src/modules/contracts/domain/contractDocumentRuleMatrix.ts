import type { ContractDocumentCategoryCode } from './contract.types';

export type MaritalBucket =
  | 'single'
  | 'married'
  | 'stable_union'
  | 'divorced'
  | 'widowed'
  | 'unknown';

export type CategoryApplicability = 'required' | 'optional' | 'not_applicable';

export interface CategoryRequirement {
  category: ContractDocumentCategoryCode;
  applicability: CategoryApplicability;
  /** Gate: exige documento aprovado quando true. */
  required: boolean;
  reasonCode: string;
}

export interface ContractDocumentRuleContext {
  propertyPurpose: string | null;
  sellerInfo: Record<string, unknown>;
  buyerInfo: Record<string, unknown>;
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function propertyPurposeFlags(purpose: string | null | undefined): {
  isSale: boolean;
  isRent: boolean;
  isUnknown: boolean;
} {
  const raw = (purpose ?? '').trim().toLowerCase();
  if (!raw) {
    return { isSale: true, isRent: true, isUnknown: true };
  }
  const isRent = raw.includes('alug') || raw.includes('rent');
  const isSale = raw.includes('venda') || raw.includes('sale');
  if (isSale && isRent) {
    return { isSale: true, isRent: true, isUnknown: false };
  }
  if (isRent) {
    return { isSale: false, isRent: true, isUnknown: false };
  }
  if (isSale) {
    return { isSale: true, isRent: false, isUnknown: false };
  }
  return { isSale: true, isRent: true, isUnknown: true };
}

/**
 * Lê estado civil a partir de `estado_civil` / `estadoCivil`.
 * `unknown`: preencher estado civil e/ou certidão antes de exigir documentos do cônjuge.
 */
export function resolveMaritalBucket(info: Record<string, unknown>): MaritalBucket {
  const raw = String(
    info.estado_civil ?? info.estadoCivil ?? info['estado civil'] ?? ''
  ).trim();
  if (!raw) {
    return 'unknown';
  }
  const s = stripDiacritics(raw.toLowerCase());

  if (/(^|[^a-z0-9])solteir/.test(s) || s === 'solteiro' || s === 'solteira') {
    return 'single';
  }
  if (s.includes('uni') && s.includes('estav')) {
    return 'stable_union';
  }
  if (s.includes('casad') || s.includes('matrim')) {
    return 'married';
  }
  if (s.includes('divorci')) {
    return 'divorced';
  }
  if (s.includes('viuv') || s.includes('viuvo')) {
    return 'widowed';
  }
  if (s.includes('separad')) {
    return 'unknown';
  }

  return 'unknown';
}

function conjugeRequirementForMarital(marital: MaritalBucket): CategoryRequirement {
  if (marital === 'married' || marital === 'stable_union') {
    return {
      category: 'conjuge_documentos',
      applicability: 'required',
      required: true,
      reasonCode: 'CONJUGE_REQUIRED_MARRIED_OR_STABLE',
    };
  }
  return {
    category: 'conjuge_documentos',
    applicability: 'not_applicable',
    required: false,
    reasonCode:
      marital === 'unknown'
        ? 'CONJUGE_NA_MARITAL_UNKNOWN'
        : 'CONJUGE_NA_MARITAL_SINGLE_OR_EQUIVALENT',
  };
}

/**
 * Matriz condicional por lado, finalidade e estado civil (por lado).
 */
export function resolveDocumentRequirements(input: {
  side: 'seller' | 'buyer';
  propertyPurpose: string | null;
  sellerInfo: Record<string, unknown>;
  buyerInfo: Record<string, unknown>;
}): CategoryRequirement[] {
  const flags = propertyPurposeFlags(input.propertyPurpose);
  const sellerMarital = resolveMaritalBucket(input.sellerInfo);
  const buyerMarital = resolveMaritalBucket(input.buyerInfo);
  const marital = input.side === 'seller' ? sellerMarital : buyerMarital;

  const conjuge = conjugeRequirementForMarital(marital);

  if (input.side === 'seller') {
    const docsImovel: CategoryRequirement =
      flags.isSale || flags.isUnknown
        ? {
            category: 'docs_imovel',
            applicability: 'required',
            required: true,
            reasonCode: 'DOCS_IMOVEL_REQUIRED_SALE_OR_UNKNOWN',
          }
        : {
            category: 'docs_imovel',
            applicability: 'not_applicable',
            required: false,
            reasonCode: 'DOCS_IMOVEL_NA_RENTAL',
          };

    return [
      {
        category: 'identidade',
        applicability: 'required',
        required: true,
        reasonCode: 'IDENTIDADE_REQUIRED',
      },
      {
        category: 'dados_bancarios',
        applicability: 'required',
        required: true,
        reasonCode: 'DADOS_BANCARIOS_REQUIRED',
      },
      {
        category: 'comprovante_endereco',
        applicability: 'required',
        required: true,
        reasonCode: 'ENDERECO_REQUIRED',
      },
      {
        category: 'estado_civil',
        applicability: 'required',
        required: true,
        reasonCode: 'ESTADO_CIVIL_REQUIRED',
      },
      conjuge,
      docsImovel,
    ];
  }

  const comprovanteRenda: CategoryRequirement =
    flags.isRent || flags.isUnknown
      ? {
          category: 'comprovante_renda',
          applicability: 'required',
          required: true,
          reasonCode: 'COMPROVANTE_RENDA_REQUIRED_RENT_OR_UNKNOWN',
        }
      : {
          category: 'comprovante_renda',
          applicability: 'not_applicable',
          required: false,
          reasonCode: 'COMPROVANTE_RENDA_NA_SALE',
        };

  return [
    {
      category: 'identidade',
      applicability: 'required',
      required: true,
      reasonCode: 'IDENTIDADE_REQUIRED',
    },
    {
      category: 'comprovante_endereco',
      applicability: 'required',
      required: true,
      reasonCode: 'ENDERECO_REQUIRED',
    },
    {
      category: 'estado_civil',
      applicability: 'required',
      required: true,
      reasonCode: 'ESTADO_CIVIL_REQUIRED',
    },
    conjuge,
    comprovanteRenda,
  ];
}

export function resolveDocumentRequirementsForContract(
  context: ContractDocumentRuleContext
): { seller: CategoryRequirement[]; buyer: CategoryRequirement[] } {
  const base = {
    propertyPurpose: context.propertyPurpose,
    sellerInfo: context.sellerInfo,
    buyerInfo: context.buyerInfo,
  };
  return {
    seller: resolveDocumentRequirements({ side: 'seller', ...base }),
    buyer: resolveDocumentRequirements({ side: 'buyer', ...base }),
  };
}

export function findCategoryRequirement(
  side: 'seller' | 'buyer',
  category: ContractDocumentCategoryCode,
  context: ContractDocumentRuleContext
): CategoryRequirement | undefined {
  const list = resolveDocumentRequirements({
    side,
    propertyPurpose: context.propertyPurpose,
    sellerInfo: context.sellerInfo,
    buyerInfo: context.buyerInfo,
  });
  return list.find((item) => item.category === category);
}

export function isUploadBlockedForNotApplicableCategory(
  side: 'seller' | 'buyer',
  category: ContractDocumentCategoryCode,
  context: ContractDocumentRuleContext
): { blocked: true; reasonCode: string } | { blocked: false } {
  const req = findCategoryRequirement(side, category, context);
  if (!req) {
    return { blocked: true, reasonCode: 'CATEGORY_NOT_IN_MATRIX' };
  }
  if (req.applicability === 'not_applicable') {
    return { blocked: true, reasonCode: req.reasonCode };
  }
  return { blocked: false };
}
