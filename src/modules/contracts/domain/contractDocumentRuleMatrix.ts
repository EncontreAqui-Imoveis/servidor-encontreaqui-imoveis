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
  const sellerMarital = resolveMaritalBucket(input.sellerInfo);
  const buyerMarital = resolveMaritalBucket(input.buyerInfo);
  const marital = input.side === 'seller' ? sellerMarital : buyerMarital;

  const conjuge = conjugeRequirementForMarital(marital);

  if (input.side === 'seller') {
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
      {
        category: 'docs_imovel',
        applicability: 'required',
        required: true,
        reasonCode: 'DOCS_IMOVEL_REQUIRED',
      },
      {
        category: 'outro',
        applicability: 'optional',
        required: false,
        reasonCode: 'OUTRO_OPTIONAL',
      },
    ];
  }

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
    {
      category: 'comprovante_renda',
      applicability: 'required',
      required: true,
      reasonCode: 'COMPROVANTE_RENDA_REQUIRED',
    },
    {
      category: 'outro',
      applicability: 'optional',
      required: false,
      reasonCode: 'OUTRO_OPTIONAL',
    },
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
