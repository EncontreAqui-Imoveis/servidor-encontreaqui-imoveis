import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, getConnectionMock, runFeaturedPropertiesScopeMigrationMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getConnectionMock: vi.fn(),
  runFeaturedPropertiesScopeMigrationMock: vi.fn(),
}));

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: queryMock,
    getConnection: getConnectionMock,
  },
}));

vi.mock('../../src/database/migrations', () => ({
  runFeaturedPropertiesScopeMigration: runFeaturedPropertiesScopeMigrationMock,
}));

import {
  listFeaturedProperties,
  listPropertiesWithBrokers,
  updateFeaturedProperties,
} from '../../src/services/adminPropertyCatalogService';

describe('adminPropertyCatalogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mantém a busca numérica por código em properties-with-brokers', async () => {
    queryMock
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([[]]);

    await listPropertiesWithBrokers({
      search: '0000007',
      searchColumn: 'p.code',
    });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toContain('CAST(p.code AS UNSIGNED)');
    expect(String(sql)).toContain('REGEXP');
    expect(params).toContain(7);
  });

  it('separa destaques por venda e aluguel', async () => {
    runFeaturedPropertiesScopeMigrationMock.mockResolvedValueOnce(undefined);
    queryMock.mockResolvedValueOnce([
      [
        { id: 1, position: 1, scope: 'sale', title: 'Casa A', city: 'A', state: 'GO' },
        { id: 2, position: 1, scope: 'rent', title: 'Casa B', city: 'B', state: 'GO' },
      ],
    ]);

    const result = await listFeaturedProperties();

    expect(runFeaturedPropertiesScopeMigrationMock).toHaveBeenCalledTimes(1);
    expect(result.data.sale).toHaveLength(1);
    expect(result.data.rent).toHaveLength(1);
    expect(result.data.sale[0]).toMatchObject({ id: 1, scope: 'sale' });
    expect(result.data.rent[0]).toMatchObject({ id: 2, scope: 'rent' });
  });

  it('rejeita destaques com imóvel não aprovado', async () => {
    queryMock.mockResolvedValueOnce([[]]);

    await expect(
      updateFeaturedProperties({
        salePropertyIds: [1],
      }),
    ).rejects.toThrow('Alguns imoveis não estão aprovados.');
  });
});
