import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runPropertyQueryMock,
  propertyQueryExecutorMock,
  notifyAdminsMock,
  notifyPriceDropIfNeededMock,
  notifyPromotionStartedMock,
} = vi.hoisted(() => {
  const executor = {
    query: vi.fn(),
  };

  return {
    runPropertyQueryMock: vi.fn(),
    propertyQueryExecutorMock: executor,
    notifyAdminsMock: vi.fn(),
    notifyPriceDropIfNeededMock: vi.fn(),
    notifyPromotionStartedMock: vi.fn(),
  };
});

vi.mock('../../src/services/propertyPersistenceService', () => ({
  runPropertyQuery: runPropertyQueryMock,
  propertyQueryExecutor: propertyQueryExecutorMock,
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: notifyAdminsMock,
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: notifyPriceDropIfNeededMock,
  notifyPromotionStarted: notifyPromotionStartedMock,
}));

import { applyPropertyUpdateEffects } from '../../src/services/propertyUpdateEffectsService';

describe('propertyUpdateEffectsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runPropertyQueryMock.mockResolvedValue([]);
    propertyQueryExecutorMock.query.mockResolvedValue([{}, undefined]);
    notifyAdminsMock.mockResolvedValue(undefined);
    notifyPriceDropIfNeededMock.mockResolvedValue(undefined);
    notifyPromotionStartedMock.mockResolvedValue(undefined);
  });

  it('retorna none quando não há mudança terminal nem efeitos de preço/promoção', async () => {
    const result = await applyPropertyUpdateEffects({
      propertyId: 10,
      property: {
        title: 'Casa teste',
        status: 'approved',
        broker_id: 30003,
        price_sale: 500000,
        price_rent: null,
        price: 500000,
        commission_rate: 5,
        valor_iptu: 100,
        valor_condominio: 200,
      },
      body: {},
      brokerId: 30003,
      nextStatus: null,
      previousPromotionFlag: false,
      nextPromotionFlag: 0,
      saleTouched: false,
      rentTouched: false,
      nextSalePrice: 500000,
      nextRentPrice: 500000,
      nextPromotionPercentage: null,
    });

    expect(result).toEqual({ kind: 'none' });
    expect(notifyAdminsMock).not.toHaveBeenCalled();
    expect(propertyQueryExecutorMock.query).not.toHaveBeenCalled();
  });

  it('retorna 403 quando tenta fechar negócio sem broker', async () => {
    const result = await applyPropertyUpdateEffects({
      propertyId: 10,
      property: {
        title: 'Casa teste',
        status: 'approved',
        broker_id: null,
        price_sale: 500000,
        price_rent: null,
        price: 500000,
        commission_rate: 5,
        valor_iptu: 100,
        valor_condominio: 200,
      },
      body: { amount: '500000' },
      brokerId: null,
      nextStatus: 'sold',
      previousPromotionFlag: false,
      nextPromotionFlag: 0,
      saleTouched: false,
      rentTouched: false,
      nextSalePrice: 500000,
      nextRentPrice: 500000,
      nextPromotionPercentage: null,
    });

    expect(result.kind).toBe('http_error');
    if (result.kind === 'http_error') {
      expect(result.statusCode).toBe(403);
    }
    expect(notifyAdminsMock).not.toHaveBeenCalled();
    expect(propertyQueryExecutorMock.query).not.toHaveBeenCalled();
  });

  it('notifica promoção e queda de preço sem fechar negócio', async () => {
    const result = await applyPropertyUpdateEffects({
      propertyId: 10,
      property: {
        title: 'Casa teste',
        status: 'approved',
        broker_id: 30003,
        price_sale: 600000,
        price_rent: null,
        price: 600000,
        commission_rate: 5,
        valor_iptu: 100,
        valor_condominio: 200,
      },
      body: { promotion_percentage: 15 },
      brokerId: 30003,
      nextStatus: null,
      previousPromotionFlag: false,
      nextPromotionFlag: 1,
      saleTouched: true,
      rentTouched: false,
      nextSalePrice: 550000,
      nextRentPrice: 600000,
      nextPromotionPercentage: 15,
    });

    expect(result).toEqual({ kind: 'none' });
    expect(notifyPriceDropIfNeededMock).toHaveBeenCalledTimes(1);
    expect(notifyPromotionStartedMock).toHaveBeenCalledTimes(1);
    expect(notifyAdminsMock).not.toHaveBeenCalled();
    expect(propertyQueryExecutorMock.query).not.toHaveBeenCalled();
  });

  it('fecha negócio, grava sale e atualiza valores da propriedade', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([{ id: 1 }]);
    propertyQueryExecutorMock.query.mockResolvedValueOnce([{}, undefined]).mockResolvedValueOnce([
      { affectedRows: 1 },
      undefined,
    ]);

    const result = await applyPropertyUpdateEffects({
      propertyId: 10,
      property: {
        title: 'Casa teste',
        status: 'approved',
        broker_id: 30003,
        price_sale: 500000,
        price_rent: null,
        price: 500000,
        commission_rate: 5,
        valor_iptu: 100,
        valor_condominio: 200,
      },
      body: {
        amount: '550000',
        commission_rate: '6',
        commission_cycles: '2',
        recurrence_interval: 'monthly',
      },
      brokerId: 30003,
      nextStatus: 'sold',
      previousPromotionFlag: false,
      nextPromotionFlag: 0,
      saleTouched: true,
      rentTouched: false,
      nextSalePrice: 550000,
      nextRentPrice: 500000,
      nextPromotionPercentage: null,
    });

    expect(result.kind).toBe('terminal');
    if (result.kind === 'terminal') {
      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual(
        expect.objectContaining({
          message: 'Negócio fechado com sucesso.',
          status: 'sold',
        })
      );
    }
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
    expect(runPropertyQueryMock).toHaveBeenCalledWith(
      'SELECT id FROM sales WHERE property_id = ? LIMIT 1',
      [10]
    );
    expect(propertyQueryExecutorMock.query).toHaveBeenCalled();
  });

  it('retorna 400 quando o valor do negócio é inválido', async () => {
    const result = await applyPropertyUpdateEffects({
      propertyId: 10,
      property: {
        title: 'Casa teste',
        status: 'approved',
        broker_id: 30003,
        price_sale: 500000,
        price_rent: null,
        price: 500000,
        commission_rate: 5,
        valor_iptu: 100,
        valor_condominio: 200,
      },
      body: { amount: '-1' },
      brokerId: 30003,
      nextStatus: 'sold',
      previousPromotionFlag: false,
      nextPromotionFlag: 0,
      saleTouched: false,
      rentTouched: false,
      nextSalePrice: 500000,
      nextRentPrice: 500000,
      nextPromotionPercentage: null,
    });

    expect(result.kind).toBe('http_error');
    if (result.kind === 'http_error') {
      expect(result.statusCode).toBe(400);
      expect(String(result.body.error)).toContain('Valor do negocio invalido');
    }
  });
});
