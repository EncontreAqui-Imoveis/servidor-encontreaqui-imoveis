import { describe, expect, it } from 'vitest';

import {
  buildPropertyOwnerListingFilters,
  normalizePropertyListingPurpose,
} from '../../src/services/propertyOwnerListingFilterService';

describe('propertyOwnerListingFilterService', () => {
  it('monta busca por título/código e finalidade de venda com parâmetros alinhados', () => {
    const result = buildPropertyOwnerListingFilters({
      ownerColumn: 'p.owner_id',
      ownerId: 42,
      search: '  Casa QA ',
      purpose: 'sale',
    });

    expect(result.whereSql).toBe(
      "p.owner_id = ? AND (p.title LIKE ? OR p.code LIKE ?) AND LOWER(COALESCE(p.purpose, '')) LIKE ?",
    );
    expect(result.params).toEqual([42, '%Casa QA%', '%Casa QA%', '%vend%']);
  });

  it('mantém o escopo do corretor e aceita apenas finalidades canônicas', () => {
    const rent = buildPropertyOwnerListingFilters({
      ownerColumn: 'p.broker_id',
      ownerId: 7,
      purpose: 'rent',
    });
    const ignored = buildPropertyOwnerListingFilters({
      ownerColumn: 'p.broker_id',
      ownerId: 7,
      purpose: 'qualquer-coisa',
    });

    expect(rent.params).toEqual([7, '%alug%']);
    expect(ignored).toEqual({ whereSql: 'p.broker_id = ?', params: [7] });
    expect(normalizePropertyListingPurpose(' RENT ')).toBe('rent');
    expect(normalizePropertyListingPurpose('venda')).toBeNull();
  });
});
