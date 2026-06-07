import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

const {
  runPropertyQueryMock,
  applyPropertyUpdateEffectsMock,
} = vi.hoisted(() => {
  return {
    runPropertyQueryMock: vi.fn(),
    applyPropertyUpdateEffectsMock: vi.fn(),
  };
});

vi.mock('../../src/services/propertyPersistenceService', () => ({
  runPropertyQuery: runPropertyQueryMock,
}));

vi.mock('../../src/services/propertyUpdateEffectsService', () => ({
  applyPropertyUpdateEffects: applyPropertyUpdateEffectsMock,
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: vi.fn(),
}));

vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: vi.fn(),
  deleteCloudinaryAsset: vi.fn(),
}));

import { updateProperty } from '../../src/services/propertyUpdateService';

type FnMock = ReturnType<typeof vi.fn>;
type MockResponse = Response & {
  status: FnMock;
  json: FnMock;
};

function createMockResponse(): MockResponse {
  const res: Partial<MockResponse> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as MockResponse;
}

function createPropertyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    broker_id: 30003,
    owner_id: null,
    status: 'approved',
    title: 'Casa Teste',
    description: 'Descricao valida de teste',
    type: 'Casa',
    purpose: 'Venda',
    address: 'Rua A',
    city: 'Rio Verde',
    state: 'GO',
    bairro: 'Centro',
    code: 'CASA-001',
    owner_name: 'Dono',
    owner_phone: '64999999999',
    price: 500000,
    price_sale: 500000,
    price_rent: null,
    promotion_price: null,
    promotional_rent_price: null,
    promotional_rent_percentage: null,
    promo_percentage: null,
    promotion_percentage: null,
    is_promoted: 0,
    area_construida: 100,
    area_construida_valor: 100,
    area_construida_m2: 100,
    area_construida_unidade: 'm2',
    area_terreno: 150,
    area_terreno_valor: 150,
    area_terreno_m2: 150,
    area_terreno_unidade: 'm2',
    valor_iptu: 100,
    valor_condominio: 200,
    sem_numero: 0,
    sem_cep: 0,
    numero: '100',
    complemento: '',
    quadra: 'Q1',
    lote: 'L1',
    garage_spots: 1,
    bedrooms: 2,
    bathrooms: 2,
    amenities: JSON.stringify([]),
    ...overrides,
  };
}

describe('propertyUpdateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyPropertyUpdateEffectsMock.mockResolvedValue({ kind: 'none' });
  });

  it('retorna 401 quando não há autenticação', async () => {
    const req = {
      params: { id: '10' },
      body: {},
    } as any;
    const res = createMockResponse();

    await updateProperty(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(runPropertyQueryMock).not.toHaveBeenCalled();
  });

  it('retorna 403 para cliente', async () => {
    const req = {
      params: { id: '10' },
      userId: 999,
      userRole: 'client',
      body: {},
    } as any;
    const res = createMockResponse();

    await updateProperty(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(runPropertyQueryMock).not.toHaveBeenCalled();
  });

  it('retorna 400 para id inválido', async () => {
    const req = {
      params: { id: 'abc' },
      userId: 30003,
      userRole: 'broker',
      body: {},
    } as any;
    const res = createMockResponse();

    await updateProperty(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(runPropertyQueryMock).not.toHaveBeenCalled();
  });

  it('retorna 404 quando imóvel não existe', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([]);

    const req = {
      params: { id: '10' },
      userId: 30003,
      userRole: 'broker',
      body: {},
    } as any;
    const res = createMockResponse();

    await updateProperty(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(runPropertyQueryMock).toHaveBeenCalledTimes(1);
  });

  it('retorna 409 quando imóvel está pendente de aprovação', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([createPropertyRow({ status: 'pending_approval' })]);

    const req = {
      params: { id: '10' },
      userId: 30003,
      userRole: 'broker',
      body: {},
    } as any;
    const res = createMockResponse();

    await updateProperty(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(runPropertyQueryMock).toHaveBeenCalledTimes(1);
  });

  it('retorna 400 quando não há dados para atualizar', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([createPropertyRow()]);

    const req = {
      params: { id: '10' },
      userId: 30003,
      userRole: 'broker',
      body: {},
    } as any;
    const res = createMockResponse();

    await updateProperty(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'PROPERTY_NO_UPDATE_DATA',
      })
    );
    expect(applyPropertyUpdateEffectsMock).not.toHaveBeenCalled();
  });

  it('atualiza imóvel com sucesso no caminho simples', async () => {
    runPropertyQueryMock
      .mockResolvedValueOnce([createPropertyRow()])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const req = {
      params: { id: '10' },
      userId: 30003,
      userRole: 'broker',
      body: { title: 'Casa atualizada' },
    } as any;
    const res = createMockResponse();

    await updateProperty(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Imóvel atualizado com sucesso.' })
    );
    expect(runPropertyQueryMock).toHaveBeenCalledTimes(2);
    expect(applyPropertyUpdateEffectsMock).toHaveBeenCalledTimes(1);
  });
});
