import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  deleteUserMock,
  getConnectionMock,
  poolQueryMock,
  removeBrokerVerificationDocumentsMock,
  txMock,
} = vi.hoisted(() => {
  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
  return {
    deleteUserMock: vi.fn(),
    getConnectionMock: vi.fn(),
    poolQueryMock: vi.fn(),
    removeBrokerVerificationDocumentsMock: vi.fn(),
    txMock: tx,
  };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    getConnection: getConnectionMock,
    query: poolQueryMock,
  },
}));

vi.mock('../../src/config/firebaseAdmin', () => ({
  __esModule: true,
  default: {
    auth: () => ({ deleteUser: deleteUserMock }),
  },
}));

vi.mock('../../src/services/brokerVerificationDocumentDeletionService', () => ({
  BROKER_DOCUMENT_ASSET_DELETE_FAILED: 'BROKER_DOCUMENT_ASSET_DELETE_FAILED',
  BROKER_DOCUMENTS_CHANGED_DURING_DELETION: 'BROKER_DOCUMENTS_CHANGED_DURING_DELETION',
  BrokerVerificationDocumentDeletionError: class BrokerVerificationDocumentDeletionError extends Error {
    code: string;

    constructor(code: string) {
      super('broker document deletion failed');
      this.code = code;
    }
  },
  removeBrokerVerificationDocuments: removeBrokerVerificationDocumentsMock,
}));

import {
  processOneDueAccountDeletionRequest,
} from '../../src/services/accountDeletionCompletionService';
import {
  BROKER_DOCUMENT_ASSET_DELETE_FAILED,
  BrokerVerificationDocumentDeletionError,
} from '../../src/services/brokerVerificationDocumentDeletionService';

const claim = {
  request_id: 'deletion-request-1',
  user_id: 42,
  firebase_uid: 'firebase-uid-42',
  attempt_count: 0,
};

function arrangeProcessing(options: {
  claim?: typeof claim | null;
  finalizationTarget?: { request_id: string; user_id: number } | null;
} = {}): void {
  const claimed = options.claim === undefined ? claim : options.claim;
  const finalizationTarget = options.finalizationTarget === undefined
    ? { request_id: claim.request_id, user_id: claim.user_id }
    : options.finalizationTarget;

  txMock.query.mockImplementation(async (sql: string) => {
    if (sql.includes('scheduled_for <= CURRENT_TIMESTAMP')) {
      return [claimed ? [claimed] : []];
    }
    if (sql.includes('WHERE request.id = ?')) {
      return [finalizationTarget ? [finalizationTarget] : []];
    }
    return [{ affectedRows: 1 }];
  });
}

describe('processOneDueAccountDeletionRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    poolQueryMock.mockResolvedValue([{ affectedRows: 1 }]);
    removeBrokerVerificationDocumentsMock.mockResolvedValue({ removed: true });
    deleteUserMock.mockResolvedValue(undefined);
    arrangeProcessing();
  });

  it('não processa quando não há solicitação vencida', async () => {
    arrangeProcessing({ claim: null });

    await expect(processOneDueAccountDeletionRequest()).resolves.toEqual({
      claimed: false,
      completed: false,
    });
    expect(removeBrokerVerificationDocumentsMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('faz claim transacional de uma solicitação vencida e incrementa a tentativa', async () => {
    await expect(processOneDueAccountDeletionRequest()).resolves.toMatchObject({
      claimed: true,
      completed: true,
    });

    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining("request.request_type = 'DELETION'"),
    );
    const claimQuery = txMock.query.mock.calls.find(([sql]) =>
      String(sql).includes('scheduled_for <= CURRENT_TIMESTAMP'),
    )?.[0] as string;
    expect(claimQuery).toContain("request.status IN ('PENDING', 'IN_REVIEW')");
    expect(claimQuery).toContain('request.resolved_at IS NULL');
    expect(claimQuery).toContain('user.deletion_requested_at IS NOT NULL');
    expect(claimQuery).toContain('user.deletion_completed_at IS NULL');
    expect(claimQuery).toContain('FOR UPDATE');
    expect(claimQuery).toContain('processing_started_at < DATE_SUB');
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('attempt_count = attempt_count + 1'),
      [claim.request_id],
    );
  });

  it('não processa solicitação futura, pois o claim exige scheduled_for vencido', async () => {
    arrangeProcessing({ claim: null });

    await expect(processOneDueAccountDeletionRequest()).resolves.toEqual({
      claimed: false,
      completed: false,
    });
    const claimQuery = txMock.query.mock.calls.find(([sql]) =>
      String(sql).includes('scheduled_for <= CURRENT_TIMESTAMP'),
    )?.[0] as string;
    expect(claimQuery).toContain('scheduled_for <= CURRENT_TIMESTAMP');
  });

  it('remove documentos de verificação e apaga a identidade Firebase', async () => {
    await processOneDueAccountDeletionRequest();

    expect(removeBrokerVerificationDocumentsMock).toHaveBeenCalledWith(42);
    expect(deleteUserMock).toHaveBeenCalledWith('firebase-uid-42');
  });

  it('considera Firebase user-not-found como sucesso idempotente', async () => {
    deleteUserMock.mockRejectedValueOnce(Object.assign(new Error('not found'), {
      code: 'auth/user-not-found',
    }));

    await expect(processOneDueAccountDeletionRequest()).resolves.toMatchObject({
      claimed: true,
      completed: true,
    });
  });

  it('mantém IN_REVIEW quando Firebase falha', async () => {
    deleteUserMock.mockRejectedValueOnce(new Error('firebase uid should not be logged'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(processOneDueAccountDeletionRequest()).resolves.toEqual({
      claimed: true,
      completed: false,
      failureCode: 'FIREBASE_USER_DELETE_FAILED',
    });

    expect(poolQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'IN_REVIEW'"),
      ['FIREBASE_USER_DELETE_FAILED', claim.request_id],
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('firebase-uid-42');
    warnSpy.mockRestore();
  });

  it('mantém IN_REVIEW quando a remoção de documentos falha', async () => {
    removeBrokerVerificationDocumentsMock.mockRejectedValueOnce(
      new BrokerVerificationDocumentDeletionError(BROKER_DOCUMENT_ASSET_DELETE_FAILED),
    );

    await expect(processOneDueAccountDeletionRequest()).resolves.toEqual({
      claimed: true,
      completed: false,
      failureCode: BROKER_DOCUMENT_ASSET_DELETE_FAILED,
    });
    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(poolQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('processing_started_at = NULL'),
      [BROKER_DOCUMENT_ASSET_DELETE_FAILED, claim.request_id],
    );
  });

  it('anonimiza somente os campos aprovados e preserva users.id', async () => {
    await processOneDueAccountDeletionRequest();

    const userUpdate = txMock.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE users'),
    );
    expect(userUpdate).toEqual([
      expect.stringContaining('deletion_completed_at = CURRENT_TIMESTAMP'),
      ['Conta excluída 42', 'deleted-account-42@account.invalid', 42],
    ]);
    const userSql = String(userUpdate?.[0]);
    expect(userSql).toContain('firebase_uid = NULL');
    expect(userSql).toContain('password_hash = NULL');
    expect(userSql).toContain('cpf_ciphertext = NULL');
    expect(userSql).toContain('WHERE id = ?');
    expect(userSql).not.toContain('DELETE FROM users');
    expect(txMock.query).toHaveBeenCalledWith('UPDATE brokers SET creci = NULL WHERE id = ?', [42]);
  });

  it('conclui a solicitação e limpa o lease e erro técnico', async () => {
    await processOneDueAccountDeletionRequest();

    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'COMPLETED'"),
      ['ACCOUNT_DELETION_COMPLETED', claim.request_id],
    );
    const completionSql = String(txMock.query.mock.calls.find(([sql]) =>
      String(sql).includes("status = 'COMPLETED'"),
    )?.[0]);
    expect(completionSql).toContain('resolved_at = CURRENT_TIMESTAMP');
    expect(completionSql).toContain('processing_started_at = NULL');
    expect(completionSql).toContain('last_error_code = NULL');
  });

  it('permite retentativa após falha parcial', async () => {
    deleteUserMock
      .mockRejectedValueOnce(new Error('temporary Firebase failure'))
      .mockResolvedValueOnce(undefined);

    await expect(processOneDueAccountDeletionRequest()).resolves.toMatchObject({
      completed: false,
      failureCode: 'FIREBASE_USER_DELETE_FAILED',
    });
    await expect(processOneDueAccountDeletionRequest()).resolves.toMatchObject({
      claimed: true,
      completed: true,
    });
    expect(removeBrokerVerificationDocumentsMock).toHaveBeenCalledTimes(2);
    expect(deleteUserMock).toHaveBeenCalledTimes(2);
  });

  it('não conclui a mesma solicitação duas vezes em execuções concorrentes', async () => {
    let claims = 0;
    txMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('scheduled_for <= CURRENT_TIMESTAMP')) {
        claims += 1;
        return [claims === 1 ? [claim] : []];
      }
      if (sql.includes('WHERE request.id = ?')) {
        return [[{ request_id: claim.request_id, user_id: claim.user_id }]];
      }
      return [{ affectedRows: 1 }];
    });

    const [first, second] = await Promise.all([
      processOneDueAccountDeletionRequest(),
      processOneDueAccountDeletionRequest(),
    ]);

    expect([first, second].filter((result) => result.completed)).toHaveLength(1);
    expect(removeBrokerVerificationDocumentsMock).toHaveBeenCalledTimes(1);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
  });
});
