import type { DealType } from './states/NegotiationState';

export const PROPOSAL_TEMPLATE_VERSION = '1';

export function buildProposalTemplateMetadata(dealType: DealType): Record<string, string> {
  return {
    documentKind: 'proposal_draft',
    dealType,
    templateKey: dealType === 'rent' ? 'rental_proposal_v1' : 'sale_proposal_v1',
    templateVersion: PROPOSAL_TEMPLATE_VERSION,
  };
}

export function buildGeneratedProposalDocumentMetadata(
  dealType: DealType,
  source: string
): Record<string, string | boolean> {
  return {
    originalFileName: 'proposta.pdf',
    generated: true,
    source,
    ...buildProposalTemplateMetadata(dealType),
  };
}
