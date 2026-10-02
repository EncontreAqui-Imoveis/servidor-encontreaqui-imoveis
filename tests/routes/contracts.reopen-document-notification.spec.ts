import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createUserNotificationMock,
  getContractDbConnectionMock,
  reopenContractDocumentMock,
  reviewContractDocumentMock,
} = vi.hoisted(() => ({
  createUserNotificationMock: vi.fn(),
  getContractDbConnectionMock: vi.fn(),
  reopenContractDocumentMock: vi.fn(),
  reviewContractDocumentMock: vi.fn(),
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

vi.mock('../../src/services/contractDocumentReviewService', () => ({
  isContractDocumentReviewError: () => false,
  reviewContractDocument: reviewContractDocumentMock,
}));

import { contractController } from '../../src/controllers/ContractController';

const contract = {
  id: 'contract-uuid-interno',
  negotiation_id: 'negotiation-1',
  status: 'AWAITING_DOCS',
  property_title: 'Casa Teste',
  advertiser_id: 71,
  property_owner_id: 71,
  property_broker_id: 72,
  proposer_id: 73,
  initiator_side: 'seller',
  legal_buyer_user_id: 74,
};

function responseMock() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

describe('individual contract document notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createUserNotificationMock.mockResolvedValue(undefined);
    getContractDbConnectionMock.mockResolvedValue({
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    });
  });

  it('reabertura notifica apenas participantes seller deduplicados', async () => {
    reopenContractDocumentMock.mockResolvedValue({
      changed: true,
      message: 'Análise do documento reaberta com sucesso.',
      contract,
      document: { id: 19, side: 'seller', category: 'identidade' },
    });

    await contractController.reopenDocumentReview({
      params: { id: contract.id, documentId: '19' }, userId: 7, userRole: 'admin',
    } as any, responseMock() as any);
    await Promise.resolve();

    expect(createUserNotificationMock.mock.calls.map(([input]) => input.recipientId)).toEqual([71, 72, 73]);
    for (const [input] of createUserNotificationMock.mock.calls) {
      expect(input).toMatchObject({
        title: 'Nova versão necessária',
        message: 'A equipe responsável solicitou uma nova versão do documento Documento Pessoal do contrato do imóvel Casa Teste. Envie o arquivo atualizado para continuar o processo.',
        target: 'contract_details',
        metadata: { contractId: contract.id, negotiationId: contract.negotiation_id, documentId: 19 },
      });
      expect(input.message).not.toContain(contract.id);
    }
  });

  it('reabertura do buyer não notifica o proponente-locador', async () => {
    reopenContractDocumentMock.mockResolvedValue({
      changed: true,
      message: 'Análise do documento reaberta com sucesso.',
      contract,
      document: { id: 20, side: 'buyer', category: 'comprovante_renda' },
    });

    await contractController.reopenDocumentReview({
      params: { id: contract.id, documentId: '20' }, userId: 7, userRole: 'admin',
    } as any, responseMock() as any);
    await Promise.resolve();

    expect(createUserNotificationMock).toHaveBeenCalledTimes(1);
    expect(createUserNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: 74,
      message: 'A equipe responsável solicitou uma nova versão do documento Comprovante de Renda do contrato do imóvel Casa Teste. Envie o arquivo atualizado para continuar o processo.',
    }));
  });

  it('rejeição notifica somente o lado buyer e preserva o deep link', async () => {
    reviewContractDocumentMock.mockResolvedValue({
      message: 'Documento rejeitado e removido. Solicite um novo envio.',
      contract,
      rejectedDocument: {
        id: 21,
        side: 'buyer',
        category: 'comprovante_renda',
        documentType: 'comprovante_renda',
        originalFileName: 'renda.pdf',
        deletionJobId: null,
      },
    });

    await contractController.reviewDocument({
      params: { id: contract.id, documentId: '21' },
      body: { reason: 'Imagem ilegível' },
      userId: 7,
      userRole: 'admin',
    } as any, responseMock() as any);

    expect(createUserNotificationMock).toHaveBeenCalledTimes(1);
    expect(createUserNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: 74,
      title: 'Documento rejeitado',
      message: 'O documento Comprovante de Renda do contrato do imóvel Casa Teste foi rejeitado. Motivo: Imagem ilegível. Por favor, envie novamente.',
      target: 'contract_details',
      metadata: expect.objectContaining({ contractId: contract.id, documentId: 21 }),
    }));
  });

  it('rejeição notifica somente participantes seller', async () => {
    reviewContractDocumentMock.mockResolvedValue({
      message: 'Documento rejeitado e removido. Solicite um novo envio.',
      contract,
      rejectedDocument: {
        id: 22,
        side: 'seller',
        category: 'seguro_incendio',
        documentType: 'seguro_incendio',
        originalFileName: 'seguro.pdf',
        deletionJobId: null,
      },
    });

    await contractController.reviewDocument({
      params: { id: contract.id, documentId: '22' },
      body: { reason: 'Arquivo vencido' },
      userId: 7,
      userRole: 'admin',
    } as any, responseMock() as any);

    expect(createUserNotificationMock.mock.calls.map(([input]) => input.recipientId)).toEqual([71, 72, 73]);
    expect(createUserNotificationMock.mock.calls[0][0]).toMatchObject({
      message: 'O documento Apólice/Comprovante de Seguro Incêndio do contrato do imóvel Casa Teste foi rejeitado. Motivo: Arquivo vencido. Por favor, envie novamente.',
    });
  });
});
