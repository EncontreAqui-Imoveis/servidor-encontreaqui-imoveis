import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: queryMock,
  },
}));

import { loadAdminDashboardStats } from '../../src/services/adminDashboardService';

describe('adminDashboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('agrega métricas do dashboard', async () => {
    queryMock
      .mockResolvedValueOnce([[{ status: 'approved', count: 3 }]])
      .mockResolvedValueOnce([[{ date: '2026-06-01', count: 2 }]])
      .mockResolvedValueOnce([[{ totalProperties: 10, totalBrokers: 4, totalUsers: 20 }]]);

    const result = await loadAdminDashboardStats();

    expect(result.totalProperties).toBe(10);
    expect(result.totalBrokers).toBe(4);
    expect(result.totalUsers).toBe(20);
    expect(result.propertiesByStatus).toEqual([{ status: 'approved', count: 3 }]);
    expect(result.newPropertiesOverTime).toEqual([{ date: '2026-06-01', count: 2 }]);
  });
});
