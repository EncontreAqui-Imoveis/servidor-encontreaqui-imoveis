import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createBuyerHandshake,
  isContractBuyerHandshakeError,
  rejectBuyerHandshakeAssociation,
  verifyBuyerHandshakePin,
} from '../../src/services/contractBuyerHandshakeService';

const tx = {
  query: vi.fn(),
};

const contract = {
  id: 'contract-1',
  negotiation_id: 'neg-1',
  property_id: 101,
  advertiser_id: 10,
  proposer_id: 10,
  workflow_metadata: {},
} as any;

const buyerRequest = { userId: 20, userRole: 'client' } as any;

describe('contractBuyerHandshakeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CONTRACT_HANDSHAKE_PIN_SECRET', 'test-handshake-secret');
  });

  it('persists only a digest for a generated four-digit PIN', () => {
    const handshake = createBuyerHandshake();

    expect(handshake.pin).toMatch(/^\d{4}$/);
    expect(handshake.pinHash).toMatch(/^[a-f0-9]{64}$/);
    expect(handshake.pinHash).not.toContain(handshake.pin);
  });

  it('increments a failed attempt without exposing the expected PIN', async () => {
    tx.query
      .mockResolvedValueOnce([[{
        legal_buyer_user_id: 20,
        handshake_pin: createBuyerHandshake().pinHash,
        handshake_status: 'PENDING',
        handshake_attempts: 1,
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(
      verifyBuyerHandshakePin(tx as any, { req: buyerRequest, contract, pin: '0000' })
    ).rejects.toSatisfy((error: unknown) => {
      expect(isContractBuyerHandshakeError(error)).toBe(true);
      expect((error as any).statusCode).toBe(403);
      expect((error as any).body).toEqual({ attemptsRemaining: 3 });
      return true;
    });
    expect(tx.query.mock.calls[1]?.[1]).toEqual([2, 'neg-1']);
  });

  it('verifies the linked buyer only after the correct PIN', async () => {
    const handshake = createBuyerHandshake();
    tx.query
      .mockResolvedValueOnce([[{
        legal_buyer_user_id: 20,
        handshake_pin: handshake.pinHash,
        handshake_status: 'PENDING',
        handshake_attempts: 0,
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(
      verifyBuyerHandshakePin(tx as any, { req: buyerRequest, contract, pin: handshake.pin })
    ).resolves.toEqual({ status: 'VERIFIED', attemptsRemaining: 5 });
    expect(String(tx.query.mock.calls[1]?.[0])).toContain("handshake_status = 'VERIFIED'");
  });

  it('revokes the association on the fifth invalid PIN attempt', async () => {
    const handshake = createBuyerHandshake();
    const invalidPin = handshake.pin === '0000' ? '9999' : '0000';
    tx.query
      .mockResolvedValueOnce([[{
        legal_buyer_user_id: 20,
        handshake_pin: handshake.pinHash,
        handshake_status: 'PENDING',
        handshake_attempts: 4,
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(
      verifyBuyerHandshakePin(tx as any, { req: buyerRequest, contract, pin: invalidPin })
    ).rejects.toSatisfy((error: unknown) => {
      expect(isContractBuyerHandshakeError(error)).toBe(true);
      expect((error as any).statusCode).toBe(429);
      expect((error as any).code).toBe('CONTRACT_HANDSHAKE_LOCKED');
      expect((error as any).body).toEqual({ attemptsRemaining: 0 });
      return true;
    });

    expect(String(tx.query.mock.calls[1]?.[0])).toContain('legal_buyer_user_id = NULL');
    expect(String(tx.query.mock.calls[1]?.[0])).toContain("handshake_status = 'REJECTED'");
    expect(tx.query.mock.calls[1]?.[1]).toEqual([5, 'neg-1']);
  });

  it('rejects the association by unlinking the legal buyer and auditing the event', async () => {
    tx.query
      .mockResolvedValueOnce([[{
        legal_buyer_user_id: 20,
        handshake_pin: createBuyerHandshake().pinHash,
        handshake_status: 'PENDING',
        handshake_attempts: 0,
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(
      rejectBuyerHandshakeAssociation(tx as any, { req: buyerRequest, contract })
    ).resolves.toEqual({ sellerRecipientIds: [10] });
    expect(String(tx.query.mock.calls[1]?.[0])).toContain('legal_buyer_user_id = NULL');
  });
});
