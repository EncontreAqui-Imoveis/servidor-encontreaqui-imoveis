import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: { query: queryMock },
}));

import locationRoutes from '../../src/routes/location.routes';

describe('GET /locations catalog autocomplete', () => {
  const app = express();
  app.use('/locations', locationRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a bounded, prefix-filtered city page', async () => {
    queryMock.mockResolvedValueOnce([[
      { id: 1, name: 'Goiânia', state: 'GO' },
      { id: 2, name: 'Goiatuba', state: 'GO' },
      { id: 3, name: 'Goiás', state: 'GO' },
    ]]);

    const response = await request(app).get('/locations/cities?search=GoI&limit=2&page=3');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [
        { id: 1, name: 'Goiânia', state: 'GO' },
        { id: 2, name: 'Goiatuba', state: 'GO' },
      ],
      page: 3,
      limit: 2,
      hasMore: true,
    });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('normalized_name LIKE ?'),
      ['goi%', 3, 4]
    );
  });

  it('requires cityId before querying neighborhoods', async () => {
    const response = await request(app).get('/locations/neighborhoods?search=centro');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('cityId');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('caps the neighborhood page size and scopes the query to the city', async () => {
    queryMock.mockResolvedValueOnce([[
      { id: 10, city_id: 7, name: 'Centro' },
    ]]);

    const response = await request(app).get('/locations/neighborhoods?cityId=7&search=ce&limit=99');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [{ id: 10, cityId: 7, name: 'Centro' }],
      page: 1,
      limit: 15,
      hasMore: false,
    });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('city_id = ?'),
      [7, 'ce%', 16, 0]
    );
  });
});
