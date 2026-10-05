import { describe, expect, it } from 'vitest';
import {
  buildNotificationDeepLinkMetadata,
  resolveNotificationTarget,
  withNotificationId,
} from '../../src/services/notificationDeepLinkMetadata';

describe('notificationDeepLinkMetadata', () => {
  it('keeps only route IDs and canonical string fields for contract notifications', () => {
    const draft = buildNotificationDeepLinkMetadata({
      target: 'contract_details',
      relatedEntityType: 'negotiation',
      relatedEntityId: 42,
      metadata: {
        contractId: 'contract-7',
        negotiationId: 'negotiation-8',
        propertyId: 42,
        documentId: 501,
        draftRevisionId: 701,
        draftReviewId: 702,
        draftReviewResolutionId: 703,
        cpf: '12345678901',
        name: 'Dado privado',
        signedUrl: 'https://private.example/document.pdf',
      },
    });

    expect(withNotificationId(draft, 99)).toEqual({
      schema_version: '1',
      target: 'contract_details',
      entity_id: 'contract-7',
      property_id: '42',
      negotiation_id: 'negotiation-8',
      contract_id: 'contract-7',
      document_id: '501',
      draft_revision_id: '701',
      draft_review_id: '702',
      draft_review_resolution_id: '703',
      notification_id: '99',
      route: '/contracts/contract-7',
    });
  });

  it('rejects navigation targets outside the allowlist', () => {
    expect(() => resolveNotificationTarget('https://private.example', 'property')).toThrow(
      'Invalid notification target'
    );
  });

  it.each([
    ['none', ''],
    ['home', '/'],
    ['notifications', '/notifications'],
  ] as const)('builds canonical metadata for administrative target %s', (target, route) => {
    expect(buildNotificationDeepLinkMetadata({ target })).toEqual({
      schema_version: '1',
      target,
      entity_id: '',
      property_id: '',
      negotiation_id: '',
      contract_id: '',
      document_id: '',
      draft_revision_id: '',
      draft_review_id: '',
      draft_review_resolution_id: '',
      notification_id: '',
      route,
    });
  });

  it('builds property_details metadata from the explicit property_id', () => {
    expect(buildNotificationDeepLinkMetadata({
      target: 'property_details',
      metadata: { property_id: '42' },
    })).toMatchObject({
      target: 'property_details',
      entity_id: '42',
      property_id: '42',
      route: '/properties/42',
    });
  });

  it('preserves automatic notification target defaults', () => {
    expect(resolveNotificationTarget(undefined, 'property')).toBe('property_details');
    expect(resolveNotificationTarget(undefined, 'negotiation')).toBe('proposal_details');
    expect(resolveNotificationTarget(undefined, 'announcement')).toBe('proposal_list');
  });
});
