import { describe, expect, it } from 'vitest';

import {
  resolveAdvertiserIdFromProperty,
  resolveNegotiationInitiatorSide,
} from '../../src/utils/negotiationActorResolution';

describe('negotiationActorResolution', () => {
  it('uses the listing broker as advertiser, with owner as an explicit fallback', () => {
    expect(resolveAdvertiserIdFromProperty({ brokerId: 2, ownerId: 10 })).toBe(2);
    expect(resolveAdvertiserIdFromProperty({ brokerId: null, ownerId: 10 })).toBe(10);
    expect(resolveAdvertiserIdFromProperty({ brokerId: null, ownerId: null })).toBeNull();
  });

  it('maps a proposal started by either seller actor to the seller side', () => {
    expect(
      resolveNegotiationInitiatorSide({ proposerId: 2, advertiserId: 2, propertyOwnerId: 10 })
    ).toBe('seller');
    expect(
      resolveNegotiationInitiatorSide({ proposerId: 10, advertiserId: 2, propertyOwnerId: 10 })
    ).toBe('seller');
    expect(
      resolveNegotiationInitiatorSide({ proposerId: 20, advertiserId: 2, propertyOwnerId: 10 })
    ).toBe('buyer');
  });
});
