import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/database/connection', () => ({
  default: { query },
}));

import {
  createPrivacyRequest,
  listOwnPrivacyRequests,
  PrivacyRequestValidationError,
} from '../../src/services/privacyRequestService';

describe('privacyRequestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registra uma solicitacao sem aceitar texto livre ou PII no payload', async () => {
    query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await createPrivacyRequest({ requesterUserId: 17, type: 'deletion' });

    expect(result.type).toBe('DELETION');
    expect(result.status).toBe('PENDING');
    expect(query.mock.calls[1][1]).toEqual([result.id, 17, 'DELETION']);
  });

  it('reutiliza solicitacao aberta do mesmo titular e tipo', async () => {
    query.mockResolvedValueOnce([[{
      id: 'f4b64a3b-5a81-4af5-9772-1b72f5f2f1ce',
      request_type: 'ACCESS',
      status: 'PENDING',
      resolution_code: null,
      requested_at: new Date('2026-07-31T12:00:00.000Z'),
      resolved_at: null,
    }]]);

    const result = await createPrivacyRequest({ requesterUserId: 17, type: 'ACCESS' });

    expect(result.id).toBe('f4b64a3b-5a81-4af5-9772-1b72f5f2f1ce');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('recusa tipo invalido', async () => {
    await expect(createPrivacyRequest({ requesterUserId: 17, type: 'EXPORT_ALL' }))
      .rejects.toBeInstanceOf(PrivacyRequestValidationError);
  });

  it('lista somente solicitacoes do titular autenticado', async () => {
    query.mockResolvedValueOnce([[{
      id: 'f4b64a3b-5a81-4af5-9772-1b72f5f2f1ce',
      request_type: 'ACCESS',
      status: 'COMPLETED',
      resolution_code: 'DELIVERED',
      requested_at: new Date('2026-07-31T12:00:00.000Z'),
      resolved_at: new Date('2026-07-31T13:00:00.000Z'),
    }]]);

    const result = await listOwnPrivacyRequests(17);

    expect(result).toHaveLength(1);
    expect(query.mock.calls[0][1]).toEqual([17]);
  });
});
