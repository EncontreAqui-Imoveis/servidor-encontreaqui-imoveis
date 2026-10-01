import { describe, expect, it, vi } from 'vitest';

const {
  createUserNotificationMock,
  getContractDbConnectionMock,
  reopenContractDocumentMock,
} = vi.hoisted(() => ({
  createUserNotificationMock: vi.fn().mockResolvedValue(undefined),
  getContractDbConnectionMock: vi.fn(),
  reopenContractDocumentMock: vi.fn(),
}));

vi.mock('../../src/services/notificationService', () => ({
  createAdminNotification: vi.fn(),
  createUserNotification: createUserNotificationMock,
}));

vi.mock('../../src/services/contractPersistenceService', () => ({
  getContractDbConnection: getContractDbConnectionMock,
  queryContractRows: vi.fn(),
}));

vi.mock('../../src/services/contractDocumentReopenService', () => ({
  isContractDocumentReopenError: () => false,
  reopenContractDocument: reopenContractDocumentMock,
}));

import { contractController } from '../../src/controllers/ContractController';

describe('ContractController.reopenDocumentReview notification', () => {
  it('notifies the document owner with the new-version copy and preserves the document deep link', async () => {
    const tx = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    getContractDbConnectionMock.mockResolvedValue(tx);
    reopenContractDocumentMock.mockResolvedValue({
      changed: true,
      message: 'Análise do documento reaberta com sucesso.',
      contract: {
        id: 'contract-1',
        negotiation_id: 'negotiation-1',
        status: 'AWAITING_DOCS',
        advertiser_id: 71,
      },
      document: { id: 19, side: 'seller', category: 'identidade', uploadedByUserId: 45 },
    });
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await contractController.reopenDocumentReview({
      params: { id: 'contract-1', documentId: '19' },
      userId: 7,
      userRole: 'admin',
    } as any, response as any);
    await Promise.resolve();

    expect(createUserNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Nova versão necessária',
      message: 'A equipe responsável solicitou uma nova versão do documento Documento Pessoal. Envie o arquivo atualizado para continuar o processo.',
      target: 'contract_details',
      metadata: {
        contractId: 'contract-1',
        negotiationId: 'negotiation-1',
        documentId: 19,
      },
    }));
  });
});
