import {
  CONTRACT_DOCUMENT_CATEGORY_LABELS,
  type ContractDocumentCategoryCode,
} from '../modules/contracts/domain/contract.types';

export function resolveContractDocumentNotificationPropertyTitle(
  contract: { property_title?: unknown }
): string {
  return String(contract.property_title ?? '').trim() || 'seu imóvel';
}

export function resolveContractDocumentNotificationCategoryLabel(
  category: ContractDocumentCategoryCode | null | undefined
): string {
  return category ? CONTRACT_DOCUMENT_CATEGORY_LABELS[category] : 'Documento';
}
