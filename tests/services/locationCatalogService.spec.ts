import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../../src/database/connection', () => ({
  default: {
    query: queryMock,
  },
}));

import {
  listLocationCities,
  normalizeLocationCatalogName,
} from '../../src/services/locationCatalogService';
import { loadBrazilianCityCatalog } from '../../src/services/locationCatalogSeedService';

describe('location catalog', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('normalizes accents and extra spaces for catalog searches', () => {
    expect(normalizeLocationCatalogName('  Goiânia  ')).toBe('goiania');
    expect(normalizeLocationCatalogName('Carmo   do Rio Verde')).toBe(
      'carmo do rio verde'
    );
  });

  it('loads the complete versioned municipality catalog', () => {
    const cities = loadBrazilianCityCatalog();

    expect(cities).toHaveLength(5595);
    expect(cities).toContainEqual(
      expect.objectContaining({ name: 'Carmo do Rio Verde', state: 'GO' })
    );
    expect(cities).toContainEqual(
      expect.objectContaining({ name: 'São Paulo', state: 'SP' })
    );
  });

  it('filters city autocomplete by UF while preserving pagination', async () => {
    queryMock.mockResolvedValueOnce([
      [{ id: 12, name: 'Goiânia', state: 'GO' }],
    ]);

    const page = await listLocationCities({
      search: 'Goiania',
      state: 'go',
      limit: '10',
    });

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('state = ?'),
      ['goiania%', 'GO', 11, 0]
    );
    expect(page.data).toEqual([{ id: 12, name: 'Goiânia', state: 'GO' }]);
    expect(page.hasMore).toBe(false);
  });
});
