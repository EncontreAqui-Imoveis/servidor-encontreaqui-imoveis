import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../src/errors/ApplicationError';

const {
  queryMock,
  getConnectionMock,
  txMock,
  notifyUsersMock,
  resolveUserNotificationRoleMock,
} = vi.hoisted(() => {
  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    queryMock: vi.fn(),
    getConnectionMock: vi.fn(),
    txMock: tx,
    notifyUsersMock: vi.fn(),
    resolveUserNotificationRoleMock: vi.fn(),
  };
});

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: queryMock,
    getConnection: getConnectionMock,
  },
}));

vi.mock('../../src/services/userNotificationService', () => ({
  notifyUsers: notifyUsersMock,
  resolveUserNotificationRole: resolveUserNotificationRoleMock,
}));

vi.mock('../../src/services/propertyEditRequestService', () => ({
  buildEditablePropertyState: vi.fn((property) => property),
  buildPropertyEditDbPatch: vi.fn((_current, patch) => patch),
  preparePropertyEditPatch: vi.fn((_patch, _current) => ({
    patch: _patch,
    before: {},
    after: {},
    diff: {},
  })),
}));

import {
  getPropertyEditRequestById,
  listPropertyEditRequests,
  rejectPropertyEditRequest,
  reviewPropertyEditRequest,
} from '../../src/services/adminPropertyEditRequestService';

describe('adminPropertyEditRequestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    resolveUserNotificationRoleMock.mockResolvedValue('broker');
    notifyUsersMock.mockResolvedValue(undefined);
  });

  it('lista solicitacoes de edicao com shape normalizado', async () => {
    queryMock
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([
        [
          {
            id: 901,
            property_id: 555,
            requester_user_id: 30016,
            requester_role: 'client',
            status: 'PENDING',
            before_json: '{"title":"Casa"}',
            after_json: '{"title":"Casa nova"}',
            diff_json: '{"title":{"before":"Casa","after":"Casa nova"}}',
            field_reviews_json: null,
            review_reason: null,
            reviewed_by: null,
            reviewed_at: null,
            created_at: new Date('2026-06-01T10:00:00Z'),
            updated_at: new Date('2026-06-01T10:00:00Z'),
            property_title: 'Casa',
            property_code: 'C-900',
            requester_name: 'Maria',
          },
        ],
      ]);

    const result = await listPropertyEditRequests({
      page: 1,
      limit: 10,
      status: 'PENDING',
    });

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: 901,
      propertyId: 555,
      requesterName: 'Maria',
      status: 'PENDING',
    });
  });

  it('busca solicitacao por id com 404 quando ausente', async () => {
    queryMock.mockResolvedValueOnce([[]]);

    await expect(getPropertyEditRequestById(999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('falha com input invalido ao buscar solicitacao', async () => {
    await expect(getPropertyEditRequestById(Number.NaN)).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('aprova solicitacao, persiste alteracao e atualiza status', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 901,
            property_id: 555,
            requester_user_id: 30016,
            requester_role: 'client',
            status: 'PENDING',
            before_json: '{"title":"Casa"}',
            after_json: '{"title":"Casa atualizada"}',
            diff_json: '{"title":{"before":"Casa","after":"Casa atualizada"}}',
            field_reviews_json: null,
            review_reason: null,
            reviewed_by: null,
            reviewed_at: null,
            created_at: new Date('2026-06-01T10:00:00Z'),
            updated_at: new Date('2026-06-01T10:00:00Z'),
            property_title: 'Casa',
            property_code: 'C-900',
            requester_name: 'Maria',
          },
        ],
      ])
      .mockResolvedValueOnce([[{ id: 555, broker_id: 30003 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await reviewPropertyEditRequest({
      requestId: 901,
      reviewerId: 12,
      body: { mode: 'approve_all' },
    });

    expect(result).toMatchObject({
      message: 'Solicitacao de edicao revisada com sucesso.',
      status: 'APPROVED',
    });
    expect(txMock.commit).toHaveBeenCalledTimes(1);
    expect(txMock.rollback).not.toHaveBeenCalled();
  });

  it('rejeita atualizacao de solicitacao que nao esta mais pendente', async () => {
    txMock.query.mockResolvedValueOnce([
      [
        {
          id: 903,
          property_id: 557,
          requester_user_id: 30018,
          requester_role: 'client',
          status: 'APPROVED',
          before_json: '{"title":"Casa"}',
          after_json: '{"title":"Casa atualizada"}',
          diff_json: '{"title":{"before":"Casa","after":"Casa atualizada"}}',
          field_reviews_json: null,
          review_reason: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: new Date('2026-06-01T10:00:00Z'),
          updated_at: new Date('2026-06-01T10:00:00Z'),
          property_title: 'Casa',
          property_code: 'C-902',
          requester_name: 'Carlos',
        },
      ],
    ]);

    await expect(
      reviewPropertyEditRequest({
        requestId: 903,
        reviewerId: 12,
        body: { mode: 'approve_all' },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejeita solicitacao e notifica o dono da negociação', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 902,
            property_id: 556,
            requester_user_id: 30017,
            requester_role: 'client',
            status: 'PENDING',
            before_json: '{"title":"Casa"}',
            after_json: '{"title":"Casa atualizada"}',
            diff_json: '{"title":{"before":"Casa","after":"Casa atualizada"}}',
            field_reviews_json: null,
            review_reason: null,
            reviewed_by: null,
            reviewed_at: null,
            created_at: new Date('2026-06-01T10:00:00Z'),
            updated_at: new Date('2026-06-01T10:00:00Z'),
            property_title: 'Casa Azul',
            property_code: 'C-901',
            requester_name: 'Joana',
          },
        ],
      ])
      .mockResolvedValueOnce([[{ id: 556, broker_id: 30004 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await rejectPropertyEditRequest({
      requestId: 902,
      reviewerId: 19,
      reason: 'Texto insuficiente',
    });

    expect(result.status).toBe('REJECTED');
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    expect(resolveUserNotificationRoleMock).toHaveBeenCalledWith(30004);
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });
});
