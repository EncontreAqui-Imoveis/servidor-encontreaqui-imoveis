import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: vi.fn(),
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: vi.fn(),
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: vi.fn(),
  notifyPromotionStarted: vi.fn(),
}));

describe('GET /public/properties/:id', () => {
  let app: express.Express;

  beforeAll(async () => {
    const { default: publicRoutes } = await import('../../src/routes/public.routes');
    app = express();
    app.use(express.json());
    app.use(publicRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies approved/public filters and returns 404 when the property is not publicly visible', async () => {
    queryMock.mockResolvedValueOnce([[]]);

    const response = await request(app).get('/public/properties/30102');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Imóvel não encontrado.' });

    const executedSql = String(queryMock.mock.calls[0]?.[0] ?? '');
    expect(executedSql).toContain("p.status = 'approved'");
    expect(executedSql).toContain("COALESCE(p.visibility, 'PUBLIC') = 'PUBLIC'");
  });
});
