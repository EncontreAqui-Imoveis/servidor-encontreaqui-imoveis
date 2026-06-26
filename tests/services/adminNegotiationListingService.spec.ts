import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: queryMock,
  },
}));

import {
  isInvalidNegotiationStatusFilter,
  listNegotiationRequestSummary,
  listNegotiationRequestsByProperty,
  listNegotiations,
  parseNegotiationStatusFilter,
} from '../../src/services/adminNegotiationListingService';

describe('adminNegotiationListingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normaliza filtros de status e rejeita valores inválidos', () => {
    expect(parseNegotiationStatusFilter('rejected')).toBe('REFUSED');
    expect(parseNegotiationStatusFilter(' proposal_signed ')).toBe('PROPOSAL_SIGNED');
    expect(parseNegotiationStatusFilter('')).toBeNull();
    expect(isInvalidNegotiationStatusFilter('invalid')).toBe(true);
    expect(isInvalidNegotiationStatusFilter(null)).toBe(false);
  });

  it('lista negociações com mapeamento de payload e status', async () => {
    queryMock
      .mockResolvedValueOnce([[{ column_name: 'client_name' }, { column_name: 'payment_details' }]])
      .mockResolvedValueOnce([[{ column_name: 'created_at' }]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-1',
            negotiation_status: 'DOCUMENTATION_PHASE',
            property_id: 101,
            capturing_broker_id: 7,
            selling_broker_id: 8,
            seller_client_id: 9,
            property_status: 'negociacao',
            property_code: 'EA-101',
            property_title: 'Casa Alto Padrão',
            property_address: 'Rua A, 10',
            property_image_url: 'https://img.test/1.jpg',
            property_value: 900000,
            final_value: 850000,
            proposal_validity_date: '2026-05-02',
            created_at: '2026-04-22T09:30:00.000Z',
            capturing_broker_name: 'Carlos Broker',
            selling_broker_name: 'Ana Broker',
            seller_client_name: 'Maria Cliente',
            client_name: 'Maria Cliente',
            client_cpf: '11122233344',
            payment_dinheiro: 200000,
            payment_permuta: 0,
            payment_financiamento: 650000,
            payment_outros: 0,
            last_event_at: '2026-04-22T10:00:00.000Z',
            approved_at: '2026-04-22T11:00:00.000Z',
            signed_document_id: 33,
            signed_document_metadata_json: JSON.stringify({
              originalFileName: 'proposta-assinada-maria.pdf',
            }),
          },
        ],
      ]);

    const result = await listNegotiations({
      statusFilter: 'APPROVED',
      page: 1,
      limit: 20,
    });

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: 'neg-1',
      status: 'APPROVED',
        internalStatus: 'DOCUMENTATION_PHASE',
        propertyId: 101,
      brokerName: 'Carlos Broker',
      sellerClientName: 'Maria Cliente',
      propertyValue: 900000,
        createdAt: '2026-04-22T09:30:00.000Z',
        signedDocumentId: 33,
        hasSignedProposalDocument: true,
        signedDocumentFileName: 'proposta-assinada-maria.pdf',
        payment: {
          dinheiro: 200000,
        permuta: 0,
        financiamento: 650000,
        outros: 0,
      },
    });
  });

  it('inclui DOCUMENTATION_PHASE sem assinatura na fila de propostas enviadas', async () => {
    queryMock
      .mockResolvedValueOnce([[{ column_name: 'client_name' }, { column_name: 'payment_details' }]])
      .mockResolvedValueOnce([[{ column_name: 'created_at' }]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[]]);

    await listNegotiations({
      statusFilter: 'PROPOSAL_UNSIGNED',
      page: 1,
      limit: 20,
    });

    const sqlCalls = queryMock.mock.calls
      .map(([sql]) => String(sql))
      .filter((sql) => sql.includes("PROPOSAL_SENT") || sql.includes("DOCUMENTATION_PHASE"));

    expect(sqlCalls.some((sql) => sql.includes("n.status IN ('PROPOSAL_SENT', 'DOCUMENTATION_PHASE')"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("NOT EXISTS (SELECT 1 FROM negotiation_documents"))).toBe(true);
  });

  it('mantem listagem funcional quando a descoberta de schema falha', async () => {
    queryMock
      .mockImplementationOnce(async () => {
        throw new Error('schema indisponivel');
      })
      .mockResolvedValueOnce([[{ column_name: 'created_at' }]])
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([[]]);

    const result = await listNegotiations({
      statusFilter: null,
      page: 1,
      limit: 10,
    });

    expect(result.total).toBe(0);
    expect(result.data).toHaveLength(0);
  });

  it('lista resumo por imóvel com proposta principal', async () => {
    queryMock
      .mockResolvedValueOnce([
        [{ column_name: 'client_name' }, { column_name: 'client_cpf' }, { column_name: 'payment_details' }],
      ])
      .mockResolvedValueOnce([
        [{ column_name: 'updated_at' }],
      ])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([
        [
          {
            property_id: 101,
            property_code: 'EA-101',
            property_title: 'Casa Alto Padrão',
            property_address: 'Rua A, 10',
            property_value: 900000,
            proposal_count: 3,
            latest_updated_at: '2026-04-22T10:00:00.000Z',
            property_image_url: 'https://img.test/1.jpg',
            top_negotiation_id: 'neg-1',
            top_proposal_value: 850000,
            top_client_name: 'Maria Compradora',
            top_created_at: '2026-04-22T09:00:00.000Z',
          },
        ],
      ]);

    const result = await listNegotiationRequestSummary({
      statusFilter: 'UNDER_REVIEW',
      page: 1,
      limit: 10,
    });

    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      propertyId: 101,
      propertyCode: 'EA-101',
      proposalCount: 3,
      propertyValue: 900000,
      topProposal: {
        negotiationId: 'neg-1',
        value: 850000,
        clientName: 'Maria Compradora',
      },
    });
  });

  it('retorna resumo vazio quando nao ha propostas', async () => {
    queryMock
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([[]]);

    const result = await listNegotiationRequestSummary({
      statusFilter: 'UNDER_REVIEW',
      page: 1,
      limit: 10,
    });

    expect(result.total).toBe(0);
    expect(result.data).toHaveLength(0);
  });

  it('lista solicitações por imóvel com status normalizado', async () => {
    queryMock
      .mockResolvedValueOnce([
        [{ column_name: 'client_name' }, { column_name: 'client_cpf' }, { column_name: 'payment_details' }],
      ])
      .mockResolvedValueOnce([
        [{ column_name: 'created_at' }],
      ])
      .mockResolvedValueOnce([[{ total: 2 }]])
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-1',
            negotiation_status: 'PROPOSAL_SENT',
            property_id: 101,
            capturing_broker_id: 7,
            selling_broker_id: 8,
            seller_client_id: null,
            property_status: 'pending_approval',
            property_code: 'EA-101',
            property_title: 'Casa Alto Padrão',
            property_address: 'Rua A, 10',
            property_image_url: 'https://img.test/1.jpg',
            property_value: 900000,
            final_value: 850000,
            proposal_validity_date: '2026-05-02',
            created_at: '2026-04-22T08:45:00.000Z',
            capturing_broker_name: 'Carlos Broker',
            selling_broker_name: null,
            seller_client_name: null,
            client_name: 'Maria Cliente',
            client_cpf: '11122233344',
            payment_dinheiro: 200000,
            payment_permuta: 0,
            payment_financiamento: 650000,
            payment_outros: 0,
            last_event_at: '2026-04-22T10:00:00.000Z',
            approved_at: null,
            signed_document_id: null,
            signed_document_metadata_json: null,
          },
        ],
      ]);

    const result = await listNegotiationRequestsByProperty({
      propertyId: 101,
      statusFilter: 'UNDER_REVIEW',
      page: 1,
      limit: 10,
    });

    expect(result.propertyId).toBe(101);
    expect(result.total).toBe(2);
    expect(result.data[0]).toMatchObject({
      id: 'neg-1',
      status: 'UNDER_REVIEW',
      propertyId: 101,
      clientName: 'Maria Cliente',
      createdAt: '2026-04-22T08:45:00.000Z',
      propertyImageUrl: 'https://img.test/1.jpg',
      propertyValue: 900000,
    });
  });

  it('retorna lista vazia por imóvel quando nao ha propostas', async () => {
    queryMock
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([[]]);

    const result = await listNegotiationRequestsByProperty({
      propertyId: 101,
      statusFilter: 'UNDER_REVIEW',
      page: 1,
      limit: 10,
    });

    expect(result.total).toBe(0);
    expect(result.propertyId).toBe(101);
    expect(result.data).toHaveLength(0);
  });
});
