import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  notifyAdminsMock,
  notifyUsersMock,
  resolveUserNotificationRoleMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  notifyAdminsMock: vi.fn(),
  notifyUsersMock: vi.fn(),
  resolveUserNotificationRoleMock: vi.fn(),
}));

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: queryMock,
  },
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: notifyAdminsMock,
}));

vi.mock('../../src/services/userNotificationService', () => ({
  notifyUsers: notifyUsersMock,
  resolveUserNotificationRole: resolveUserNotificationRoleMock,
}));

import {
  approveProperty,
  getPropertyDetails,
  rejectProperty,
  updatePropertyStatus,
} from '../../src/services/adminPropertyReviewService';

describe('adminPropertyReviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyAdminsMock.mockResolvedValue(undefined);
    notifyUsersMock.mockResolvedValue(undefined);
    resolveUserNotificationRoleMock.mockResolvedValue('broker');
  });

  it('rejects invalid identifier when fetching details', async () => {
    await expect(getPropertyDetails(Number.NaN)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns not found when fetching missing property', async () => {
    queryMock.mockResolvedValueOnce([[]]);

    await expect(getPropertyDetails(123)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('maps property details with normalized images', async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          {
            id: 555,
            broker_id: null,
            owner_id: 30003,
            public_id: 'PUB-1',
            public_code: 'SC-1',
            owner_name: 'Ana',
            owner_phone: '64999990000',
            code: 'IM-555',
            title: 'Casa teste',
            description: 'Descricao',
            type: 'Casa',
            purpose: 'Venda',
            status: 'approved',
            is_promoted: 1,
            promotion_percentage: 10,
            promotional_rent_percentage: null,
            promotion_start: '2026-01-01',
            promotion_end: '2026-01-31',
            price: 250000,
            price_sale: 250000,
            price_rent: null,
            promotion_price: 225000,
            promotional_rent_price: null,
            address: 'Rua A',
            cep: '75900000',
            quadra: '1',
            lote: '2',
            numero: '123',
            bairro: 'Centro',
            complemento: 'Fundos',
            city: 'Cidade',
            state: 'GO',
            sem_numero: 0,
            sem_quadra: 0,
            sem_lote: 0,
            sem_cep: 0,
            bedrooms: 3,
            bathrooms: 2,
            area_construida: 100,
            area_terreno: 250,
            area_construida_m2: 100,
            area_terreno_m2: 250,
            area_construida_valor: 100,
            area_construida_unidade: 'm2',
            area_terreno_valor: 250,
            area_terreno_unidade: 'm2',
            garage_spots: 1,
            valor_condominio: 120,
            valor_iptu: 80,
            video_url: null,
            has_wifi: 1,
            tem_piscina: 0,
            tem_energia_solar: 0,
            tem_automacao: 0,
            tem_ar_condicionado: 0,
            eh_mobiliada: 0,
            amenities: JSON.stringify(['Wi-Fi', 'Piscina']),
            created_at: '2026-01-02 10:00:00',
            updated_at: '2026-01-03 10:00:00',
            images: null,
            broker_name: 'Corretora Ana',
            broker_phone: '64988887777',
            broker_status: 'approved',
            broker_creci: '12345',
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          { id: 1, image_url: 'https://img.test/1.jpg' },
          { id: 2, image_url: ' https://img.test/2.jpg ' },
          { id: 3, image_url: '' },
        ],
      ]);

    const result = await getPropertyDetails(555);

    expect(result).toMatchObject({
      id: 555,
      owner_id: 30003,
      public_code: 'SC-1',
      title: 'Casa teste',
      owner_name: 'Ana',
      broker_name: 'Corretora Ana',
      broker_creci: '12345',
    });
    expect(Array.isArray(result.images)).toBe(true);
    expect(result.images).toEqual([
      '1|https://img.test/1.jpg',
      '2|https://img.test/2.jpg',
    ]);
    expect(Array.isArray(result.amenities)).toBe(true);
  });

  it('approves property and notifies owner', async () => {
    queryMock
      .mockImplementationOnce(async (sql: string) => {
        expect(sql).toContain('UPDATE properties');
        return [{ affectedRows: 1 }];
      })
      .mockImplementationOnce(async (sql: string) => {
        expect(sql).toContain('SELECT broker_id, owner_id, title FROM properties WHERE id = ?');
        return [[{ broker_id: null, owner_id: 30003, title: 'Casa teste' }]];
      });

    const result = await approveProperty(555);

    expect(result).toMatchObject({ message: 'Imóvel aprovado com sucesso.' });
    expect(notifyAdminsMock).toHaveBeenCalledWith(
      'Imovel #555 aprovado pelo admin.',
      'property',
      555
    );
    expect(resolveUserNotificationRoleMock).toHaveBeenCalledWith(30003);
    expect(notifyUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Seu imovel "Casa teste" foi aprovado e ja esta disponivel no app.',
        recipientIds: [30003],
        recipientRole: 'broker',
        relatedEntityType: 'property',
        relatedEntityId: 555,
      })
    );
  });

  it('returns not found when approval does not find property', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(approveProperty(999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(notifyAdminsMock).not.toHaveBeenCalled();
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it('rejects property when reason is missing', async () => {
    await expect(rejectProperty(555, '')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects property and removes featured entry', async () => {
    queryMock
      .mockImplementationOnce(async (sql: string) => {
        expect(sql).toContain('SELECT broker_id, owner_id, title FROM properties WHERE id = ?');
        return [[{ broker_id: null, owner_id: 30004, title: 'Casa rejeitada' }]];
      })
      .mockImplementationOnce(async (sql: string) => {
        expect(sql).toContain('UPDATE properties');
        return [{ affectedRows: 1 }];
      })
      .mockImplementationOnce(async (sql: string) => {
        expect(sql).toContain('DELETE FROM featured_properties');
        return [{ affectedRows: 1 }];
      });

    const result = await rejectProperty(555, 'Documentacao incompleta');

    expect(result).toMatchObject({
      message: 'Imovel rejeitado. O anunciante pode corrigir e reenviar.',
      status: 'rejected',
    });
    expect(notifyAdminsMock).toHaveBeenCalledWith(
      'Imovel #555 rejeitado. Motivo (resumo): Documentacao incompleta',
      'property',
      555
    );
    expect(resolveUserNotificationRoleMock).toHaveBeenCalledWith(30004);
    expect(notifyUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Seu anuncio "Casa rejeitada" foi rejeitado. Resumo: Documentacao incompleta — edite e reenvie para analise em Meus imoveis.',
        recipientIds: [30004],
        recipientRole: 'broker',
        relatedEntityType: 'property',
        relatedEntityId: 555,
        pushAction: 'edit_rejected',
      })
    );
  });

  it('rejects invalid status update before querying the database', async () => {
    await expect(updatePropertyStatus(555, 123)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('updates property status and notifies owner when approved', async () => {
    queryMock
      .mockImplementationOnce(async (sql: string) => {
        expect(sql).toContain('UPDATE properties SET status = ? WHERE id = ?');
        return [{ affectedRows: 1 }];
      })
      .mockImplementationOnce(async (sql: string) => {
        expect(sql).toContain('SELECT broker_id, owner_id, title FROM properties WHERE id = ?');
        return [[{ broker_id: null, owner_id: 30005, title: 'Casa status' }]];
      });

    const result = await updatePropertyStatus(555, 'approved');

    expect(result).toMatchObject({
      message: 'Status do imovel atualizado com sucesso.',
      status: 'approved',
    });
    expect(notifyAdminsMock).toHaveBeenCalledWith(
      'Status do imovel #555 atualizado para approved.',
      'property',
      555
    );
    expect(resolveUserNotificationRoleMock).toHaveBeenCalledWith(30005);
    expect(notifyUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Seu imovel "Casa status" foi aprovado e ja esta disponivel no app.',
        recipientIds: [30005],
        recipientRole: 'broker',
        relatedEntityType: 'property',
        relatedEntityId: 555,
      })
    );
  });
});
