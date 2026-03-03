import { describe, expect, it, vi } from 'vitest';

import { loadDashboardStats } from './dashboardStatsService';

describe('dashboardStatsService', () => {
  it('loads totals for properties, brokers and users in sequence', async () => {
    const executor = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[{ total: 31 }]])
        .mockResolvedValueOnce([[{ total: 7 }]])
        .mockResolvedValueOnce([[{ total: 128 }]]),
    };

    const stats = await loadDashboardStats(executor);

    expect(executor.query).toHaveBeenNthCalledWith(
      1,
      'SELECT COUNT(*) as total FROM properties'
    );
    expect(executor.query).toHaveBeenNthCalledWith(
      2,
      'SELECT COUNT(*) as total FROM brokers'
    );
    expect(executor.query).toHaveBeenNthCalledWith(
      3,
      'SELECT COUNT(*) as total FROM users'
    );
    expect(stats).toEqual({
      totalProperties: 31,
      totalBrokers: 7,
      totalUsers: 128,
    });
  });
});
