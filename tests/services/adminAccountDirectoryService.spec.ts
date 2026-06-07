import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

import {
  listAdminBrokers,
  listAdminUsers,
  listPendingAdminBrokers,
} from '../../src/services/adminAccountDirectoryService';

describe('adminAccountDirectoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lista usuarios com filtro de corretor e busca aplicada', async () => {
    queryMock
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([
        [
          {
            id: 1,
            name: 'Ana',
            email: 'ana@example.com',
            phone: '66999999999',
            created_at: '2026-01-01',
            creci: null,
            role: 'client',
          },
        ],
      ]);

    const payload = await listAdminUsers({
      search: 'ana',
      includeBrokers: false,
      page: 1,
      limit: 10,
    });

    expect(payload.total).toBe(1);
    expect(payload.data).toHaveLength(1);
    const [countSql, countParams] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain("b.id IS NULL OR b.status IN ('rejected')");
    expect(countSql).toContain('u.name LIKE ? OR u.email LIKE ?');
    expect(countParams).toEqual(['%ana%', '%ana%']);
  });

  it('lista corretores pendentes com documentos completos', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 2,
          name: 'Bruno',
          email: 'bruno@example.com',
          phone: '66999999998',
          creci: '1234',
          status: 'pending_verification',
          creci_front_url: 'front.jpg',
          creci_back_url: 'back.jpg',
          selfie_url: 'selfie.jpg',
          document_status: 'pending',
          created_at: '2026-01-01',
        },
      ],
    ]);

    const payload = await listPendingAdminBrokers();

    expect(payload.data).toHaveLength(1);
    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).toContain('INNER JOIN broker_documents bd');
    expect(sql).toContain("bd.status IN ('pending', 'rejected')");
    expect(sql).toContain("NULLIF(TRIM(bd.creci_front_url), '') IS NOT NULL");
    expect(sql).toContain("b.status = 'pending_verification'");
  });

  it('lista corretores com paginação e mapeia documentos', async () => {
    queryMock
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([
        [
          {
            id: 3,
            name: 'Carla',
            email: 'carla@example.com',
            phone: '66999999997',
            creci: '9999',
            status: 'approved',
            created_at: '2026-01-01',
            agency_id: null,
            agency_name: null,
            agency_logo_url: null,
            agency_address: null,
            agency_city: null,
            agency_state: null,
            agency_phone: null,
            agency_email: null,
            creci_front_url: 'front-2.jpg',
            creci_back_url: 'back-2.jpg',
            selfie_url: 'selfie-2.jpg',
            property_count: 5,
          },
        ],
      ]);

    const payload = await listAdminBrokers({
      page: 1,
      limit: 10,
      status: 'approved',
      search: 'carla',
      sortBy: 'name',
      sortOrder: 'asc',
    });

    expect(payload.total).toBe(1);
    expect(payload.data[0]).toMatchObject({
      id: 3,
      documents: {
        creci_front_url: 'front-2.jpg',
        creci_back_url: 'back-2.jpg',
        selfie_url: 'selfie-2.jpg',
      },
    });
    const [countSql] = queryMock.mock.calls[0] as [string];
    const [sql] = queryMock.mock.calls[1] as [string];
    expect(countSql).toContain('COUNT(DISTINCT b.id) AS total');
    expect(sql).toContain('b.status = ?');
    expect(sql).toContain('ORDER BY u.name ASC');
  });
});
