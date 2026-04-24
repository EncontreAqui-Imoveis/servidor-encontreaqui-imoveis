import { describe, expect, it } from 'vitest';
import { stripExpiredPromotionFromPublicPayload } from '../../src/utils/promotionPublicWindow';

describe('stripExpiredPromotionFromPublicPayload', () => {
  it('keeps owner payloads unchanged', () => {
    const p = { is_promoted: true, promotion_price: 100, id: 1 };
    const out = stripExpiredPromotionFromPublicPayload(p, true);
    expect(out).toBe(p);
  });

  it('strips public promo when end is in the past', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const p = {
      is_promoted: true,
      promotion_price: 50,
      promotion_start: '2020-01-01T00:00:00.000Z',
      promotion_end: past,
    };
    const out = stripExpiredPromotionFromPublicPayload(p, false);
    expect(out.is_promoted).toBe(false);
    expect(out.promotion_price).toBeNull();
  });

  it('keeps public promo when now is inside window', () => {
    const start = new Date(Date.now() - 86_400_000).toISOString();
    const end = new Date(Date.now() + 86_400_000).toISOString();
    const p = {
      is_promoted: true,
      promotion_price: 50,
      promotion_start: start,
      promotion_end: end,
    };
    const out = stripExpiredPromotionFromPublicPayload(p, false);
    expect(out.is_promoted).toBe(true);
    expect(out.promotion_price).toBe(50);
  });
});
