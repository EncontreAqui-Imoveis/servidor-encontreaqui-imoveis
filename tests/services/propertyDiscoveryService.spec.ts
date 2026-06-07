import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runPropertyQueryMock } = vi.hoisted(() => ({
  runPropertyQueryMock: vi.fn(),
}));

vi.mock('../../src/services/propertyPersistenceService', () => ({
  runPropertyQuery: runPropertyQueryMock,
}));

import {
  getAvailableBairrosWithCount,
  getAvailableCities,
  getAvailableCitiesWithCount,
  listFeaturedProperties,
  mapProperty,
  resolvePublicPropertyLookupValue,
} from '../../src/services/propertyDiscoveryService';

describe('propertyDiscoveryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolve public lookup by id, public id, public code and code', () => {
    expect(resolvePublicPropertyLookupValue('10')).toEqual({ kind: 'id', value: 10 });
    expect(resolvePublicPropertyLookupValue('123e4567-e89b-12d3-a456-426614174000')).toEqual({
      kind: 'public_id',
      value: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(resolvePublicPropertyLookupValue('abc123')).toEqual({ kind: 'public_code', value: 'ABC123' });
    expect(resolvePublicPropertyLookupValue('Rua das Flores')).toEqual({
      kind: 'public_code',
      value: 'FLORES',
    });
    expect(resolvePublicPropertyLookupValue('')).toBeNull();
  });

  it('lists available cities only from approved public properties', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([{ city: 'Rio Verde' }, { city: 'Goiânia' }]);

    const result = await getAvailableCities();

    expect(result).toEqual(['Rio Verde', 'Goiânia']);
    expect(runPropertyQueryMock).toHaveBeenCalledTimes(1);
    expect(String(runPropertyQueryMock.mock.calls[0][0])).toContain("status = 'approved'");
  });

  it('lists cities with counts and blocks negotiation statuses', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([
      { city: 'Rio Verde', total: 2 },
      { city: 'Goiânia', total: 1 },
    ]);

    const result = await getAvailableCitiesWithCount();

    expect(result).toEqual([
      { city: 'Rio Verde', total: 2 },
      { city: 'Goiânia', total: 1 },
    ]);
    expect(String(runPropertyQueryMock.mock.calls[0][0])).toContain('NOT EXISTS');
    expect(String(runPropertyQueryMock.mock.calls[0][0])).toContain('IN (?, ?, ?, ?, ?, ?)');
  });

  it('lists bairros with city filter and counts', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([
      { bairro: 'Centro', city: 'Rio Verde', total: 3 },
    ]);

    const result = await getAvailableBairrosWithCount('Rio');

    expect(result).toEqual([
      { bairro: 'Centro', city: 'Rio Verde', total: 3 },
    ]);
    expect(String(runPropertyQueryMock.mock.calls[0][0])).toContain('p.city LIKE ?');
    expect(runPropertyQueryMock.mock.calls[0][1]).toContain('%Rio%');
  });

  it('maps featured properties and totals', async () => {
    runPropertyQueryMock
      .mockResolvedValueOnce([
        {
          id: 1,
          title: 'Casa A',
          description: 'Descricao',
          type: 'Casa',
          purpose: 'Venda',
          status: 'approved',
          price: 500000,
          address: 'Rua A',
          city: 'Rio Verde',
          state: 'GO',
          broker_id: 10,
          broker_name: 'Broker A',
          broker_phone: '(64) 9999-0000',
          broker_email: 'broker@example.com',
          images: 'a.jpg,b.jpg',
          amenities: JSON.stringify(['Wi-Fi']),
          area_construida_unidade: 'm2',
          area_terreno_unidade: 'm2',
          is_promoted: 1,
          promotion_price: null,
          price_sale: 500000,
          price_rent: null,
          visibility: 'PUBLIC',
          lifecycle_status: 'AVAILABLE',
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const result = await listFeaturedProperties({ scope: 'sale', limit: 5, page: 1 });

    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.properties).toHaveLength(1);
    expect(result.properties[0]).toMatchObject({
      id: 1,
      title: 'Casa A',
      broker_name: 'Broker A',
      images: ['a.jpg', 'b.jpg'],
    });
  });

  it('maps property payload with owner info and amenities', () => {
    const result = mapProperty(
      {
        id: 1,
        broker_id: 10,
        owner_id: 20,
        title: 'Casa A',
        description: 'Descricao',
        type: 'Casa',
        purpose: 'Venda',
        status: 'approved',
        price: 500000,
        address: 'Rua A',
        city: 'Rio Verde',
        state: 'GO',
        amenities: JSON.stringify(['Wi-Fi']),
        has_wifi: 1,
        images: 'a.jpg',
        area_construida_unidade: 'm2',
        area_terreno_unidade: 'm2',
      } as any,
      true
    );

    expect(result.owner_name).toBeNull();
    expect(result.amenities).toEqual(['Wi-Fi']);
    expect(result.images).toEqual(['a.jpg']);
  });
});
