import { describe, expect, it } from 'vitest';

import {
  buildGeneratedProposalDocumentMetadata,
  buildProposalTemplateMetadata,
} from '../../../src/modules/negotiations/domain/proposalTemplateMetadata';

describe('proposalTemplateMetadata', () => {
  it.each([
    ['sale', 'sale_proposal_v1'],
    ['rent', 'rental_proposal_v1'],
  ] as const)('uses the immutable %s template key', (dealType, templateKey) => {
    expect(buildProposalTemplateMetadata(dealType)).toEqual({
      documentKind: 'proposal_draft',
      dealType,
      templateKey,
      templateVersion: '1',
    });
  });

  it('keeps the generated proposal file metadata alongside its template identity', () => {
    expect(buildGeneratedProposalDocumentMetadata('rent', 'mobile_proposal_wizard')).toEqual({
      originalFileName: 'proposta.pdf',
      generated: true,
      source: 'mobile_proposal_wizard',
      documentKind: 'proposal_draft',
      dealType: 'rent',
      templateKey: 'rental_proposal_v1',
      templateVersion: '1',
    });
  });
});
