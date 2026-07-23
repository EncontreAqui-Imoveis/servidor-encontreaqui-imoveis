import { describe, expect, it } from 'vitest';

import {
  buildPropertyOwnerListingFilters,
  normalizePropertyListingMarketStage,
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
      "p.owner_id = ? AND (p.title LIKE ? OR COALESCE(p.public_code, '') LIKE ? OR COALESCE(p.code, '') LIKE ?) AND LOWER(COALESCE(p.purpose, '')) LIKE ?",
    );
    expect(result.params).toEqual([42, '%Casa QA%', '%Casa QA%', '%Casa QA%', '%vend%']);
  });

  it('filtra lançamentos sem alterar a ordem dos parâmetros da query', () => {
    const result = buildPropertyOwnerListingFilters({
      ownerColumn: 'p.owner_id',
      ownerId: 42,
      marketStage: 'launch',
    });

    expect(result).toEqual({
      whereSql: "p.owner_id = ? AND COALESCE(p.market_stage, 'STANDARD') = 'LAUNCH'",
      params: [42],
    });
    expect(normalizePropertyListingMarketStage(' LAUNCH ')).toBe('LAUNCH');
    expect(normalizePropertyListingMarketStage('standard')).toBeNull();
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

  it('mantém no escopo do corretor imóveis vinculados por broker ou proprietário', () => {
    const result = buildPropertyOwnerListingFilters({
      ownerColumns: ['p.broker_id', 'p.owner_id'],
      ownerId: 7,
      purpose: 'rent',
    });

    expect(result.whereSql).toBe(
      "(p.broker_id = ? OR p.owner_id = ?) AND LOWER(COALESCE(p.purpose, '')) LIKE ?",
    );
    expect(result.params).toEqual([7, 7, '%alug%']);
  });
});
