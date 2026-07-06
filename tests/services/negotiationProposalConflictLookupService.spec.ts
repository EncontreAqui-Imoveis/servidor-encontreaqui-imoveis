import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

vi.mock('../../src/services/negotiationPersistenceService', () => ({
  queryNegotiationRows: vi.fn(),
}));

import { lookupProposalConflict } from '../../src/services/negotiationProposalConflictLookupService';
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

describe('negotiationProposalConflictLookupService.lookupProposalConflict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the active conflict for matching property and cpf', async () => {
    vi.mocked(queryNegotiationRows).mockResolvedValueOnce([
      {
        id: 'neg-1',
        property_id: 90001,
        property_title: 'Casa Região Norte',
        status: 'PROPOSAL_SENT',
        client_name: 'Cliente',
        client_cpf: '09169443106',
        buyer_client_id: null,
        seller_client_id: null,
        created_at: '2026-07-04T10:58:19.000Z',
        updated_at: '2026-07-04T10:58:19.000Z',
      },
    ] as any);

    const req = {
      userId: 30003,
      query: { propertyId: '90001', cpf: '091.694.431-06' },
    } as any;
    const res = createMockResponse();

    await lookupProposalConflict(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      found: true,
      conflict: expect.objectContaining({
        id: 'neg-1',
        propertyId: 90001,
        propertyTitle: 'Casa Região Norte',
        status: 'PROPOSAL_SENT',
        clientName: 'Cliente',
        clientCpf: '09169443106',
      }),
    });
  });

  it('returns found false when there is no blocking proposal', async () => {
    vi.mocked(queryNegotiationRows).mockResolvedValueOnce([] as any);

    const req = {
      userId: 30003,
      query: { propertyId: '90001', cpf: '09169443106' },
    } as any;
    const res = createMockResponse();

    await lookupProposalConflict(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ found: false, conflict: null });
  });

  it('returns 400 for invalid cpf', async () => {
    const req = {
      userId: 30003,
      query: { propertyId: '90001', cpf: '123' },
    } as any;
    const res = createMockResponse();

    await lookupProposalConflict(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'CPF inválido. Informe um CPF válido.' })
    );
  });
});
