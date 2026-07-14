import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

vi.mock('../../src/services/negotiationPersistenceService', () => ({
  queryNegotiationRows: vi.fn(),
}));

import { lookupClientByCpf } from '../../src/services/negotiationClientLookupService';
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

describe('negotiationClientLookupService.lookupClientByCpf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose client data through CPF lookup', async () => {
    vi.mocked(queryNegotiationRows)
      .mockResolvedValueOnce([{ column_name: 'updated_at' }, { column_name: 'created_at' }] as any)
      .mockResolvedValueOnce([
        {
          client_name: 'Cliente Teste',
          client_phone: '(64) 99999-0000',
        },
      ] as any);

    const req = {
      userId: 30003,
      userRole: 'broker',
      query: { cpf: '529.982.247-25' },
    } as any;
    const res = createMockResponse();

    await lookupClientByCpf(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ found: false, clientName: null, clientPhone: null });
    expect(queryNegotiationRows).not.toHaveBeenCalled();
  });

  it('returns found false when role is not broker', async () => {
    const req = {
      userId: 30003,
      userRole: 'client',
      query: { cpf: '529.982.247-25' },
    } as any;
    const res = createMockResponse();

    await lookupClientByCpf(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      found: false,
      clientName: null,
      clientPhone: null,
    });
    expect(queryNegotiationRows).not.toHaveBeenCalled();
  });

  it('keeps a neutral response for any CPF value', async () => {
    const req = {
      userId: 30003,
      userRole: 'broker',
      query: { cpf: '123' },
    } as any;
    const res = createMockResponse();

    await lookupClientByCpf(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ found: false, clientName: null, clientPhone: null });
  });
});
