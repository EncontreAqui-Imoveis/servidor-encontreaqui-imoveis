import { describe, expect, it } from 'vitest';

import { isContractSideApproved } from './contractSideApprovalGuard';

describe('isContractSideApproved', () => {
  it.each([
    ['seller', 'APPROVED', 'PENDING', true],
    ['seller', 'APPROVED_WITH_RES', 'PENDING', true],
    ['buyer', 'PENDING', 'APPROVED', true],
    ['buyer', 'APPROVED', 'REJECTED', false],
    ['seller', 'PENDING', 'APPROVED_WITH_RES', false],
  ] as const)('isolates the %s side', (side, sellerStatus, buyerStatus, expected) => {
    expect(isContractSideApproved({
      seller_approval_status: sellerStatus,
      buyer_approval_status: buyerStatus,
    }, side)).toBe(expected);
  });
});
