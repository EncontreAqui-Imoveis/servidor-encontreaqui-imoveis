import {
  resolveDocumentRequirementsForContract,
  resolveMaritalBucket,
  type ContractDocumentRuleContext,
} from '../modules/contracts/domain/contractDocumentRuleMatrix';
import type { ContractDocumentCategoryCode } from '../modules/contracts/domain/contract.types';

type ContractSide = 'seller' | 'buyer';

export interface ContractReadinessDocument {
  side: ContractSide | null;
  documentCategory: ContractDocumentCategoryCode | null;
  categoryStatus: string | null;
}

export interface ContractReadinessInput extends ContractDocumentRuleContext {
  documents?: readonly ContractReadinessDocument[];
}

export interface ContractSideReadiness {
  complete: boolean;
  missingFields: string[];
  missingDocumentCategories: ContractDocumentCategoryCode[];
}

export interface ContractReadiness {
  seller: ContractSideReadiness;
  buyer: ContractSideReadiness;
  eligibleForAdminApproval: boolean;
}

function hasText(source: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => typeof source[key] === 'string' && source[key].trim().length > 0);
}

function missingQualificationFields(
  side: ContractSide,
  info: Record<string, unknown>,
  propertyPurpose: string | null
): string[] {
  const missing: string[] = [];
  const common: Array<[string, string[]]> = [
    ['profissao', ['profissao']],
    ['email', ['email']],
    ['telefone', ['telefone', 'phone']],
    ['estado_civil', ['estado_civil', 'estadoCivil']],
  ];
  const fields = side === 'seller'
    ? [...common, ['dados_bancarios', ['dados_bancarios', 'dadosBancarios']] as [string, string[]]]
    : [...common, ['dados_bancarios', ['dados_bancarios', 'dadosBancarios']] as [string, string[]]];

  for (const [field, aliases] of fields) {
    if (!hasText(info, aliases)) missing.push(field);
  }

  const isRental = /alug|loca|rent/i.test(String(propertyPurpose ?? ''));
  if (side === 'buyer' && isRental && !hasText(info, ['garantia_locacao', 'garantiaLocacao'])) {
    missing.push('garantia_locacao');
  }

  const marital = resolveMaritalBucket(info);
  if (marital === 'married' || marital === 'stable_union') {
    for (const [field, aliases] of [
      ['conjuge_nome', ['conjuge_nome', 'conjugeNome', 'spouse_name', 'spouseName']],
      ['conjuge_cpf', ['conjuge_cpf', 'conjugeCpf', 'spouse_cpf', 'spouseCpf']],
      ['conjuge_profissao', ['conjuge_profissao', 'conjugeProfissao', 'spouse_profession', 'spouseProfession']],
    ] as Array<[string, string[]]>) {
      if (!hasText(info, aliases)) missing.push(field);
    }
  }
  return missing;
}

function missingDocuments(
  side: ContractSide,
  input: ContractReadinessInput
): ContractDocumentCategoryCode[] {
  const documents = input.documents ?? [];
  return resolveDocumentRequirementsForContract(input)
    [side]
    .filter((requirement) => requirement.required)
    .filter((requirement) => !documents.some((document) =>
      document.side === side &&
      document.documentCategory === requirement.category &&
      ['APPROVED', 'APPROVED_WITH_RES'].includes(
        String(document.categoryStatus ?? '').trim().toUpperCase()
      )
    ))
    .map((requirement) => requirement.category);
}

/**
 * Informational only: draft updates must never call this as a write blocker.
 * Administrative approval can use eligibleForAdminApproval as its strict gate.
 */
export function calculateContractReadiness(input: ContractReadinessInput): ContractReadiness {
  const buildSide = (side: ContractSide, info: Record<string, unknown>): ContractSideReadiness => {
    const missingFields = missingQualificationFields(side, info, input.propertyPurpose);
    const missingDocumentCategories = missingDocuments(side, input);
    return {
      complete: missingFields.length === 0 && missingDocumentCategories.length === 0,
      missingFields,
      missingDocumentCategories,
    };
  };
  const seller = buildSide('seller', input.sellerInfo);
  const buyer = buildSide('buyer', input.buyerInfo);
  return {
    seller,
    buyer,
    eligibleForAdminApproval: seller.complete && buyer.complete,
  };
}
