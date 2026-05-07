import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, createAdminNotificationMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  createAdminNotificationMock: vi.fn(),
}));

process.env.JWT_SECRET ||= 'test-secret';

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

vi.mock('../../src/services/notificationService', () => ({
  createAdminNotification: createAdminNotificationMock,
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.userId = 4100;
    req.userRole = 'client';
    next();
  },
}));

describe('POST /users/support-request', () => {
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

  it('registra solicitacao do cliente como aviso com prazo de 24h', async () => {
    queryMock
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ name: 'Cliente Teste', email: 'cliente@test.com', phone: '(64) 99999-0000' }]])
      ;

    createAdminNotificationMock.mockResolvedValue(undefined);

    const response = await request(app).post('/users/support-request');

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ message: 'Solicitacao enviada.' });
    expect(createAdminNotificationMock).toHaveBeenCalledTimes(1);
    expect(createAdminNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'announcement',
        title: 'Solicitacao de contato do cliente',
        relatedEntityId: 4100,
        metadata: expect.objectContaining({
          source: 'support_request',
          userId: 4100,
          name: 'Cliente Teste',
          email: 'cliente@test.com',
          phone: '(64) 99999-0000',
          phoneDigits: '64999990000',
          responseWindowHours: 24,
        }),
      }),
    );
  });
});

