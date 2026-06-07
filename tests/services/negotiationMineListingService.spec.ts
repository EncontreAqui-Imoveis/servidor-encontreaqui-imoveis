import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

vi.mock('../../src/services/negotiationPersistenceService', () => ({
  queryNegotiationRows: vi.fn(),
}));

import { listMine } from '../../src/services/negotiationMineListingService';
import { queryNegotiationRows } from '../../src/services/negotiationPersistenceService';

type FnMock = ReturnType<typeof vi.fn>;
type MockResponse = Response & {
  status: FnMock;
  json: FnMock;
};

function createMockResponse(): MockResponse {
  const res: Partial<MockResponse> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as MockResponse;
}

describe('negotiationMineListingService.listMine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns schema-aware negotiations for authenticated user', async () => {
    vi.mocked(queryNegotiationRows)
      .mockResolvedValueOnce([
        { column_name: 'buyer_client_id' },
        { column_name: 'seller_client_id' },
        { column_name: 'client_name' },
        { column_name: 'client_cpf' },
        { column_name: 'updated_at' },
        { column_name: 'payment_details' },
        { column_name: 'last_draft_edit_at' },
        { column_name: 'final_value' },
      ] as any)
      .mockResolvedValueOnce([
        {
          id: 'neg-1',
          property_id: 101,
          property_title: 'Casa Central',
          property_city: 'Rio Verde',
          property_state: 'GO',
          property_image: 'https://res.cloudinary.com/demo/image/upload/casa.jpg',
          status: 'DOCUMENTATION_PHASE',
          client_name: 'Cliente 1',
          client_cpf: '11122233344',
          proposal_validity_date: '2026-03-20 10:00:00',
          created_at: '2026-03-10 10:00:00',
          updated_at: '2026-03-11 12:00:00',
          payment_details: JSON.stringify({
            validadeDias: 12,
            details: {
              clientName: 'Cliente 1',
              clientCpf: '11122233344',
              dinheiro: 100000,
              permuta: 0,
              financiamento: 400000,
              outros: 0,
            },
          }),
          capturing_broker_id: 30003,
          selling_broker_id: 30004,
          seller_client_id: 90001,
          buyer_client_id: 90002,
          last_draft_edit_at: '2026-03-11 11:59:45',
          final_value: 500000,
          signed_proposal_count: 1,
          property_broker_id: 45555,
          contract_id: 'ctr-1',
          contract_status: 'IN_SIGNATURE',
          buyer_approval_status: 'APPROVED',
          seller_approval_status: 'PENDING',
        },
      ] as any);

    const req = { userId: 90002 } as any;
    const res = createMockResponse();

    await listMine(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id: 'neg-1',
          propertyId: 101,
          propertyTitle: 'Casa Central',
          clientName: 'Cliente 1',
          clientCpf: '11122233344',
          hasSignedProposal: true,
          validadeDias: 12,
          proposalValue: 500000,
          paymentBreakdown: {
            dinheiro: 100000,
            permuta: 0,
            financiamento: 400000,
            outros: 0,
          },
          sellerClientId: 90001,
          buyerApprovalStatus: 'APPROVED',
          sellerApprovalStatus: 'PENDING',
        }),
      ],
    });
  });

  it('returns 401 when user is not authenticated', async () => {
    const req = { userId: 0 } as any;
    const res = createMockResponse();

    await listMine(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Usuário não autenticado.' })
    );
    expect(queryNegotiationRows).not.toHaveBeenCalled();
  });

  it('returns empty data when no negotiations are found', async () => {
    vi.mocked(queryNegotiationRows)
      .mockResolvedValueOnce([{ column_name: 'updated_at' }] as any)
      .mockResolvedValueOnce([] as any);

    const req = { userId: 30003 } as any;
    const res = createMockResponse();

    await listMine(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: [] });
  });
});
