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
      notification_id: '99',
    });
  });

  it('rejects navigation targets outside the allowlist', () => {
    expect(() => resolveNotificationTarget('https://private.example', 'property')).toThrow(
      'Invalid notification target'
    );
  });
});
