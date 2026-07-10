import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getConnectionMock,
  queryMock,
  storeNegotiationDocumentToR2Mock,
  enqueueNegotiationDocumentDeletionMock,
} = vi.hoisted(() => {
  const tx = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    query: vi.fn(),
  };

  return {
    getConnectionMock: vi.fn(),
    queryMock: vi.fn(),
    storeNegotiationDocumentToR2Mock: vi.fn(),
    enqueueNegotiationDocumentDeletionMock: vi.fn(),
    tx,
  };
});

const actors = {
  seller: { id: 10, role: 'client', cpf: '11111111111' },
  buyer: { id: 20, role: 'client', cpf: '22222222222' },
  responsible: { id: 30, role: 'broker', cpf: '33333333333' },
  captor: { id: 40, role: 'broker', cpf: '44444444444' },
  stranger: { id: 50, role: 'client', cpf: '55555555555' },
  admin: { id: 1, role: 'admin', cpf: null },
} as const;

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    getConnection: getConnectionMock,
    query: queryMock,
    execute: vi.fn(),
  },
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const actorName = String(req.header('x-contract-test-actor') ?? '');
    const actor = actors[actorName as keyof typeof actors];
    if (!actor) {
      return res.status(401).json({ error: 'Ator de teste ausente.' });
    }
    (req as any).userId = actor.id;
    (req as any).userRole = actor.role;
    (req as any).userCpf = actor.cpf;
    return next();
  },
  isAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if ((req as any).userRole !== 'admin') {
      return res.status(403).json({ error: 'Acesso administrativo obrigatório.' });
    }
    return next();
  },
}));

vi.mock('../../src/services/negotiationDocumentStorageService', () => ({
  storeNegotiationDocumentToR2: storeNegotiationDocumentToR2Mock,
  readNegotiationDocumentObject: vi.fn(),
  deleteNegotiationDocumentObject: vi.fn(),
  parseNegotiationDocumentMetadata: (value: unknown) =>
    value && typeof value === 'object' ? value : {},
}));

vi.mock('../../src/services/negotiationDocumentDeletionService', () => ({
  enqueueNegotiationDocumentDeletion: enqueueNegotiationDocumentDeletionMock,
}));

import contractRoutes from '../../src/routes/contract.routes';

type ContractState = {
  status: 'AWAITING_DOCS' | 'AWAITING_SIGNATURES' | 'FINALIZED';
  sellerInfo: Record<string, unknown>;
  buyerInfo: Record<string, unknown>;
  workflowMetadata: Record<string, unknown> | null;
};

function createContractRow(state: ContractState) {
  return {
    id: 'contract-matrix-1',
    negotiation_id: 'neg-matrix-1',
    property_id: 101,
    status: state.status,
    seller_info: state.sellerInfo,
    buyer_info: state.buyerInfo,
    commission_data: { internal: true },
    workflow_metadata: state.workflowMetadata,
    seller_approval_status: 'PENDING',
    buyer_approval_status: 'PENDING',
    seller_approval_reason: null,
    buyer_approval_reason: null,
    created_at: '2026-07-10 10:00:00',
    updated_at: '2026-07-10 10:00:00',
    capturing_broker_id: 40,
    selling_broker_id: 99,
    seller_client_id: 10,
    buyer_client_id: 20,
    seller_cpf: '11111111111',
    buyer_cpf: '22222222222',
    client_name: 'Comprador',
    client_cpf: '22222222222',
    property_title: 'Casa da Matriz',
    property_purpose: 'Venda',
    property_code: 'MAT-101',
    property_image_url: null,
    property_owner_id: 10,
    property_owner_name: 'Vendedor',
    property_owner_phone: '11999999999',
    proposal_initiator_user_id: 20,
    capturing_broker_name: 'Captador sem vínculo',
    selling_broker_name: 'Corretor legado',
    seller_client_name: 'Vendedor',
    buyer_client_name: 'Comprador',
    capturing_agency_name: null,
    capturing_agency_address: null,
    responsible_user_ids: '30',
  };
}

function expectForbidden(response: request.Response): void {
  expect(response.status).toBe(403);
  expect(response.body.error).toEqual(expect.any(String));
  expect(response.body.error.length).toBeGreaterThan(8);
}

describe('Contract access matrix HTTP integration', () => {
  const app = express();
  app.use(express.json());
  app.use(contractRoutes);

  let state: ContractState;

  const asActor = (actor: keyof typeof actors) => ({
    'x-contract-test-actor': actor,
  });

  const updateData = (actor: keyof typeof actors, side: 'seller' | 'buyer') =>
    request(app)
      .put('/contracts/contract-matrix-1/data')
      .set(asActor(actor))
      .send(
        side === 'seller'
          ? { side, sellerInfo: { editedBy: actor } }
          : { side, buyerInfo: { editedBy: actor } },
      );

  const uploadDocument = (actor: keyof typeof actors, side: 'seller' | 'buyer') =>
    request(app)
      .post('/contracts/contract-matrix-1/documents')
      .set(asActor(actor))
      .field('side', side)
      .field('documentType', 'doc_identidade')
      .field('documentCategory', 'identidade')
      .attach('file', Buffer.alloc(2048, 'a'), `${actor}-${side}.pdf`);

  const deleteDocument = (actor: keyof typeof actors) =>
    request(app)
      .delete('/contracts/contract-matrix-1/documents/7001')
      .set(asActor(actor));

  beforeEach(() => {
    vi.clearAllMocks();
    state = {
      status: 'AWAITING_DOCS',
      sellerInfo: { privateSellerField: 'seller-only' },
      buyerInfo: { privateBuyerField: 'buyer-only' },
      workflowMetadata: null,
    };

    const tx = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('information_schema.tables')) return [[{ has_table: 1 }]];
        if (sql.includes('FROM contracts c') && sql.includes('FOR UPDATE')) {
          return [[createContractRow(state)]];
        }
        if (sql.includes('FROM negotiation_documents') && sql.includes('FOR UPDATE')) {
          return [[{
            id: 7001,
            type: 'other',
            document_type: 'doc_identidade',
            metadata_json: { owner_side: 'seller', documentCategory: 'identidade' },
            storage_provider: 'R2',
            storage_bucket: 'test',
            storage_key: 'contracts/seller.pdf',
            storage_content_type: 'application/pdf',
            storage_size_bytes: 2048,
            storage_etag: null,
            created_at: '2026-07-10 10:00:00',
          }]];
        }
        if (sql.includes('UPDATE contracts') && sql.includes('seller_info')) {
          state.sellerInfo = JSON.parse(String(params[0] ?? '{}'));
          state.buyerInfo = JSON.parse(String(params[1] ?? '{}'));
          return [{ affectedRows: 1 }];
        }
        if (sql.includes('UPDATE contracts') && sql.includes('workflow_metadata')) {
          state.workflowMetadata = JSON.parse(String(params[0] ?? '{}'));
          return [{ affectedRows: 1 }];
        }
        return [[]];
      }),
    };
    getConnectionMock.mockResolvedValue(tx);
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) return [[{ has_table: 1 }]];
      if (sql.includes('FROM negotiation_documents')) {
        return [[
          {
            id: 1,
            type: 'other',
            document_type: 'doc_identidade',
            metadata_json: { owner_side: 'seller', documentCategory: 'identidade' },
            created_at: '2026-07-10 10:00:00',
          },
          {
            id: 2,
            type: 'other',
            document_type: 'doc_identidade',
            metadata_json: { owner_side: 'buyer', documentCategory: 'identidade' },
            created_at: '2026-07-10 10:00:00',
          },
        ]];
      }
      if (sql.includes('FROM contracts c')) return [[createContractRow(state)]];
      return [[]];
    });
    storeNegotiationDocumentToR2Mock.mockResolvedValue(9001);
    enqueueNegotiationDocumentDeletionMock.mockResolvedValue(undefined);
  });

  it('permite comprador no próprio lado e oculta dados e documentos do vendedor', async () => {
    expect((await updateData('buyer', 'buyer')).status).toBe(200);
    expect((await uploadDocument('buyer', 'buyer')).status).toBe(201);

    const details = await request(app)
      .get('/contracts/contract-matrix-1')
      .set(asActor('buyer'));
    expect(details.status).toBe(200);
    expect(details.body.contract.sellerInfo).toEqual({});
    expect(details.body.contract.buyerInfo).toEqual(expect.objectContaining({ editedBy: 'buyer' }));
    expect(details.body.documents).toEqual([
      expect.objectContaining({ ownerSide: 'buyer' }),
    ]);

    expectForbidden(await updateData('buyer', 'seller'));
    expectForbidden(await uploadDocument('buyer', 'seller'));
    expectForbidden(await deleteDocument('buyer'));
    expect(enqueueNegotiationDocumentDeletionMock).not.toHaveBeenCalled();
  });

  it('permite vendedor apenas no próprio lado', async () => {
    expect((await updateData('seller', 'seller')).status).toBe(200);
    expect((await uploadDocument('seller', 'seller')).status).toBe(201);
    expectForbidden(await updateData('seller', 'buyer'));
    expectForbidden(await uploadDocument('seller', 'buyer'));
  });

  it('permite corretor responsável nos dois lados', async () => {
    expect((await updateData('responsible', 'seller')).status).toBe(200);
    expect((await updateData('responsible', 'buyer')).status).toBe(200);
    expect((await uploadDocument('responsible', 'seller')).status).toBe(201);
    expect((await uploadDocument('responsible', 'buyer')).status).toBe(201);
  });

  it('bloqueia corretor captador sem pivot e usuário sem vínculo antes do controller', async () => {
    for (const actor of ['captor', 'stranger'] as const) {
      expectForbidden(
        await request(app).get('/contracts/contract-matrix-1').set(asActor(actor)),
      );
      expectForbidden(await updateData(actor, 'seller'));
    }
  });

  it('permite admin nos dois lados e em documentos', async () => {
    expect((await updateData('admin', 'seller')).status).toBe(200);
    expect((await updateData('admin', 'buyer')).status).toBe(200);
    expect((await uploadDocument('admin', 'seller')).status).toBe(201);
  });

  it.each(['AWAITING_SIGNATURES', 'FINALIZED'] as const)(
    'congela dados e documentos para papéis comuns em %s, mantendo correção administrativa',
    async (status) => {
      state.status = status;

      for (const actor of ['seller', 'buyer', 'responsible'] as const) {
        const side = actor === 'buyer' ? 'buyer' : 'seller';
        expectForbidden(await updateData(actor, side));
        expectForbidden(await uploadDocument(actor, side));
      }

      expect((await updateData('admin', 'seller')).status).toBe(200);
      expect((await uploadDocument('admin', 'seller')).status).toBe(201);
    },
  );
});
