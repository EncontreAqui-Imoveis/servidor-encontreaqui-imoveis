import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET ??= 'test-secret';

const { startAccountDeletionMock } = vi.hoisted(() => ({
  startAccountDeletionMock: vi.fn(),
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { userId?: number }).userId = 42;
    next();
  },
}));

vi.mock('../../src/services/accountDeletionRequestService', () => ({
  startAccountDeletion: startAccountDeletionMock,
}));

describe('POST /users/me/deletion', () => {
  let app: express.Express;

  beforeAll(async () => {
    const { default: userRoutes } = await import('../../src/routes/user.routes');
    app = express();
    app.use(express.json());
    app.use('/users', userRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 202 com o agendamento da exclusão', async () => {
    startAccountDeletionMock.mockResolvedValueOnce({
      requestId: 'deletion-request-1',
      status: 'IN_REVIEW',
      scheduledFor: '2026-10-23T12:00:00.000Z',
    });

    const response = await request(app).post('/users/me/deletion').send({
      currentPassword: 'SenhaAtual123',
    });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      requestId: 'deletion-request-1',
      status: 'IN_REVIEW',
      scheduledFor: '2026-10-23T12:00:00.000Z',
    });
    expect(startAccountDeletionMock).toHaveBeenCalledWith({
      userId: 42,
      currentPassword: 'SenhaAtual123',
      firebaseIdToken: undefined,
    });
  });
});
