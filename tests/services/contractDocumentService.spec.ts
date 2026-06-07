import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, readNegotiationDocumentObjectMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  readNegotiationDocumentObjectMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
    execute: vi.fn(),
    getConnection: vi.fn(),
  },
}));

vi.mock('../../src/services/negotiationDocumentStorageService', () => ({
  __esModule: true,
  readNegotiationDocumentObject: readNegotiationDocumentObjectMock,
}));

import {
  buildContractDocumentPayload,
  buildContractDocumentsZip,
} from '../../src/services/contractDocumentService';

describe('contractDocumentService', () => {
  const contract = {
    id: 'contract-1',
    negotiation_id: 'neg-1',
    property_id: 101,
    status: 'AWAITING_DOCS',
    seller_info: JSON.stringify({ nome: 'Proprietário', dados_bancarios: 'segredo' }),
    buyer_info: JSON.stringify({ nome: 'Comprador' }),
    commission_data: JSON.stringify({ saleValue: 350000 }),
    workflow_metadata: JSON.stringify({}),
    seller_approval_status: 'PENDING',
    buyer_approval_status: 'PENDING',
    seller_approval_reason: null,
    buyer_approval_reason: null,
    created_at: '2026-03-01 10:00:00',
    updated_at: '2026-03-01 10:00:00',
    capturing_broker_id: 30003,
    selling_broker_id: 30004,
    seller_client_id: null,
    buyer_client_id: 90001,
    property_title: 'Casa Centro',
    property_purpose: 'Venda',
    property_code: 'RV-101',
    property_image_url: null,
    property_owner_id: 80001,
    property_owner_name: 'Proprietário',
    capturing_broker_name: 'Captador',
    selling_broker_name: 'Vendedor',
    seller_client_name: null,
    buyer_client_name: 'Comprador',
    capturing_agency_name: 'Encontre Aqui',
    capturing_agency_address: 'Rua Central, 100',
    responsible_user_ids: '30003,30005',
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('monta o payload de documentos excluindo proposal e filtrando documento sensível para cliente', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM negotiation_documents')) {
        return [[
          {
            id: 1,
            type: 'proposal',
            document_type: 'proposal',
            metadata_json: JSON.stringify({
              side: 'seller',
              originalFileName: 'proposta.pdf',
            }),
            created_at: '2026-03-01 10:01:00',
          },
          {
            id: 2,
            type: 'other',
            document_type: 'dados_bancarios',
            metadata_json: JSON.stringify({
              side: 'seller',
              documentCategory: 'dados_bancarios',
              originalFileName: 'banco.pdf',
            }),
            created_at: '2026-03-01 10:02:00',
          },
          {
            id: 3,
            type: 'other',
            document_type: 'doc_identidade',
            metadata_json: JSON.stringify({
              side: 'buyer',
              documentCategory: 'identidade',
              originalFileName: 'id.pdf',
            }),
            created_at: '2026-03-01 10:03:00',
          },
        ]];
      }

      return [[]];
    });

    const payload = await buildContractDocumentPayload(contract as never, {
      userId: 90001,
      userRole: 'client',
    } as never);

    expect(payload.contract).toMatchObject({
      id: 'contract-1',
      negotiationId: 'neg-1',
      documentProgress: expect.any(Object),
    });
    expect(payload.documents).toHaveLength(1);
    expect(payload.documents[0]).toMatchObject({
      id: 3,
      documentType: 'doc_identidade',
      side: 'buyer',
      originalFileName: 'id.pdf',
      downloadUrl: '/negotiations/neg-1/documents/3/download',
    });
  });

  it('gera ZIP com arquivos visíveis e nomes originais', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('storage_provider')) {
        return [[
          {
            id: 11,
            type: 'other',
            document_type: 'doc_identidade',
            metadata_json: JSON.stringify({
              side: 'seller',
              originalFileName: 'identidade.pdf',
            }),
            created_at: '2026-03-01 10:03:00',
            storage_provider: 'R2',
            storage_bucket: 'bucket',
            storage_key: 'key-11',
            storage_content_type: 'application/pdf',
            storage_size_bytes: 10,
            storage_etag: null,
          },
          {
            id: 12,
            type: 'other',
            document_type: 'doc_endereco',
            metadata_json: JSON.stringify({
              side: 'buyer',
              originalFileName: 'endereco.pdf',
            }),
            created_at: '2026-03-01 10:04:00',
            storage_provider: 'R2',
            storage_bucket: 'bucket',
            storage_key: 'key-12',
            storage_content_type: 'application/pdf',
            storage_size_bytes: 11,
            storage_etag: null,
          },
        ]];
      }

      return [[]];
    });

    readNegotiationDocumentObjectMock.mockImplementation(async (row: { storage_key: string }) =>
      Buffer.from(`document-${row.storage_key}`)
    );

    const zipPayload = await buildContractDocumentsZip(contract as never, {
      userId: 30003,
      userRole: 'broker',
    } as never);

    expect(zipPayload).not.toBeNull();
    expect(zipPayload?.fileNameBase).toBe('RV-101');

    const zip = await JSZip.loadAsync(zipPayload?.fileBuffer as Buffer);
    expect(Object.keys(zip.files).sort()).toEqual(['endereco.pdf', 'identidade.pdf']);
    await expect(zip.file('identidade.pdf')?.async('nodebuffer')).resolves.toEqual(
      Buffer.from('document-key-11')
    );
    await expect(zip.file('endereco.pdf')?.async('nodebuffer')).resolves.toEqual(
      Buffer.from('document-key-12')
    );
  });

  it('retorna null quando não há documentos visíveis', async () => {
    queryMock.mockImplementation(async () => [[ ]]);

    const zipPayload = await buildContractDocumentsZip(contract as never, {
      userId: 30003,
      userRole: 'broker',
    } as never);

    expect(zipPayload).toBeNull();
  });
});
