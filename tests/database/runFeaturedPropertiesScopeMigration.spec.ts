import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RowDataPacket } from 'mysql2';

const queryMock = vi.fn();

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

describe('runFeaturedPropertiesScopeMigration', () => {
  beforeEach(() => {
    queryMock.mockReset();
    vi.resetModules();
  });

  it('encerra cedo se a tabela não existir', async () => {
    const { runFeaturedPropertiesScopeMigration } = await import(
      '../../src/database/migrations'
    );
    queryMock.mockResolvedValueOnce([[]] as [RowDataPacket[], unknown]);
    await runFeaturedPropertiesScopeMigration();
    expect(queryMock).toHaveBeenCalledTimes(1);
    const sqlCalls = queryMock.mock.calls.map((c) => String(c[0]).trim());
    expect(sqlCalls[0]).toMatch(/information_schema\.tables/);
  });

  it('encerra cedo se a coluna scope já existir (sem ALTER)', async () => {
    const { runFeaturedPropertiesScopeMigration } = await import(
      '../../src/database/migrations'
    );
    queryMock
      .mockResolvedValueOnce([
        [{ '1': 1 }],
      ] as [RowDataPacket[], unknown])
      .mockResolvedValueOnce([
        [{ '1': 1 }],
      ] as [RowDataPacket[], unknown]);
    await runFeaturedPropertiesScopeMigration();
    const second = String(queryMock.mock.calls[1][0] ?? '');
    expect(second).toMatch(/information_schema\.columns/);
    const hasAlter = queryMock.mock.calls.some((c) => String(c[0]).includes('ALTER TABLE featured_properties'));
    expect(hasAlter).toBe(false);
  });
});
