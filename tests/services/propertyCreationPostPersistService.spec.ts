import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdminNotificationMock, notifyAdminsMock, notifyPromotionStartedMock, runPropertyQueryMock } = vi.hoisted(() => ({
  createAdminNotificationMock: vi.fn(),
  notifyAdminsMock: vi.fn(),
  notifyPromotionStartedMock: vi.fn(),
  runPropertyQueryMock: vi.fn(),
}));

vi.mock('../../src/services/notificationService', () => ({
  createAdminNotification: createAdminNotificationMock,
  notifyAdmins: notifyAdminsMock,
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPromotionStarted: notifyPromotionStartedMock,
}));

vi.mock('../../src/services/propertyPersistenceService', () => ({
  runPropertyQuery: runPropertyQueryMock,
}));

import { runPropertyCreationPostPersistEffects } from '../../src/services/propertyCreationPostPersistService';

describe('propertyCreationPostPersistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notifies admins for broker flow and promotion started when flagged', async () => {
    await runPropertyCreationPostPersistEffects({
      flow: 'broker',
      propertyId: 9001,
      title: 'Casa Destaque',
      promotionFlag: 1,
      promotionPercentage: 12,
      ownerPhone: '(64) 99999-0000',
      ownerName: 'Cliente Destaque',
      actorId: 321,
    });

    expect(notifyPromotionStartedMock).toHaveBeenCalledWith({
      propertyId: 9001,
      propertyTitle: 'Casa Destaque',
      promotionPercentage: 12,
    });
    expect(notifyAdminsMock).toHaveBeenCalledWith(
      "Um novo imóvel 'Casa Destaque' foi adicionado e aguarda aprovação.",
      'property',
      9001
    );
    expect(createAdminNotificationMock).not.toHaveBeenCalled();
    expect(runPropertyQueryMock).not.toHaveBeenCalled();
  });

  it('builds client admin notification metadata with email lookup and phone normalization', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([{ email: 'cliente@example.com' }]);

    await runPropertyCreationPostPersistEffects({
      flow: 'client',
      propertyId: 9002,
      title: 'Casa Cliente',
      promotionFlag: 0,
      promotionPercentage: null,
      ownerPhone: '64999998888',
      ownerName: 'Cliente Teste',
      actorId: 654,
    });

    expect(runPropertyQueryMock).toHaveBeenCalledWith(
      'SELECT email FROM users WHERE id = ? LIMIT 1',
      [654]
    );
    expect(createAdminNotificationMock).toHaveBeenCalledTimes(1);
    expect(createAdminNotificationMock.mock.calls[0][0]).toMatchObject({
      type: 'property',
      title: 'Aviso: cliente tentou anunciar imóvel',
      message: "Novo imóvel enviado por cliente: 'Casa Cliente'.",
      relatedEntityId: 9002,
      metadata: expect.objectContaining({
        source: 'client_property_create',
        propertyId: 9002,
        propertyTitle: 'Casa Cliente',
        clientId: 654,
        clientName: 'Cliente Teste',
        clientEmail: 'cliente@example.com',
        clientPhoneRaw: '64999998888',
        clientPhone: '64999998888',
        whatsappUrl: 'https://wa.me/5564999998888',
      }),
    });
    expect(notifyAdminsMock).not.toHaveBeenCalled();
    expect(notifyPromotionStartedMock).not.toHaveBeenCalled();
  });
});
