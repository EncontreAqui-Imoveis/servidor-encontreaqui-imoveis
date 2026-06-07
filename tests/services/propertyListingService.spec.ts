import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runPropertyQueryMock } = vi.hoisted(() => ({
  runPropertyQueryMock: vi.fn(),
}));

vi.mock('../../src/services/propertyPersistenceService', () => ({
  runPropertyQuery: runPropertyQueryMock,
}));

import {
  PropertyListingError,
  isPropertyListingError,
  listPublicProperties,
  listUserProperties,
} from '../../src/services/propertyListingService';

describe('propertyListingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('identifica erro de listagem', () => {
    const err = new PropertyListingError(400, 'Tipo de imóvel inválido.');
    expect(isPropertyListingError(err)).toBe(true);
    expect(isPropertyListingError(new Error('x'))).toBe(false);
  });

  it('retorna lista pública vazia com paginação padrão', async () => {
    runPropertyQueryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }]);

    const result = await listPublicProperties({});

    expect(result.properties).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(0);
  });

  it('aplica filtros públicos e paginação', async () => {
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
          images: 'a.jpg',
          amenities: JSON.stringify([]),
          area_construida_unidade: 'm2',
          area_terreno_unidade: 'm2',
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const result = await listPublicProperties({
      page: '2',
      limit: '1',
      purpose: 'venda',
      city: 'Rio',
      minPriceParam: '100000',
      maxPriceParam: '600000',
    });

    expect(result.total).toBe(1);
    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(1);
    expect(result.properties).toHaveLength(1);
    expect(runPropertyQueryMock).toHaveBeenCalledTimes(2);
  });

  it('rejeita filtro de tipo inválido', async () => {
    await expect(
      listPublicProperties({
        type: 'inexistente',
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Tipo de imóvel inválido.',
    });
  });

  it('lista imóveis do usuário com shape esperado', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([
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
        images: 'a.jpg',
        amenities: JSON.stringify([]),
        area_construida_unidade: 'm2',
        area_terreno_unidade: 'm2',
      },
    ]);

    const result = await listUserProperties(10);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 1,
      title: 'Casa A',
      status: 'approved',
    });
    expect(runPropertyQueryMock).toHaveBeenCalledTimes(1);
  });
});
