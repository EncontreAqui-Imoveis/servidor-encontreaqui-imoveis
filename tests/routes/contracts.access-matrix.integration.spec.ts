import express from 'express';
import { createHmac } from 'crypto';
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
  propertyOwner: { id: 11, role: 'client', cpf: '10101010101' },
  buyer: { id: 20, role: 'client', cpf: '22222222222' },
  legalBuyer: { id: 21, role: 'client', cpf: '21212121212' },
  responsible1: { id: 30, role: 'broker', cpf: '33333333330' },
  responsible2: { id: 31, role: 'broker', cpf: '33333333331' },
  responsible3: { id: 32, role: 'broker', cpf: '33333333332' },
  responsible4: { id: 33, role: 'broker', cpf: '33333333333' },
  responsible5: { id: 34, role: 'broker', cpf: '33333333334' },
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
  legalBuyerUserId?: number | null;
  handshakeStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED' | null;
  handshakePin?: string | null;
  handshakeAttempts?: number;
  propertyOwnerId?: number;
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
    advertiser_id: 10,
    proposer_id: 20,
    seller_cpf: '11111111111',
    buyer_cpf: '22222222222',
    client_name: 'Comprador',
    property_title: 'Casa da Matriz',
    property_purpose: 'Venda',
    property_code: 'MAT-101',
    property_image_url: null,
    property_owner_id: state.propertyOwnerId ?? 10,
    property_owner_name: 'Vendedor',
    property_owner_phone: '11999999999',
    proposal_initiator_user_id: 20,
    capturing_broker_name: 'Captador sem vínculo',
    selling_broker_name: 'Corretor legado',
    seller_client_name: 'Vendedor',
    buyer_client_name: 'Comprador',
    capturing_agency_name: null,
    capturing_agency_address: null,
    responsible_user_ids: '30,31,32,33,34',
    legal_buyer_user_id: state.legalBuyerUserId ?? null,
    handshake_status: state.handshakeStatus ?? null,
    handshake_pin: state.handshakePin ?? null,
    handshake_attempts: state.handshakeAttempts ?? 0,
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
  let transaction: {
    beginTransaction: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };

  const asActor = (actor: keyof typeof actors) => ({
    'x-contract-test-actor': actor,
  });

  const updateData = (actor: keyof typeof actors, side: 'seller' | 'buyer') =>
    request(app)
      .put('/contracts/contract-matrix-1/data')
      .set(asActor(actor))
      .send(
        side === 'seller'
          ? { side, sellerInfo: { profissao: `seller-${actor}` } }
          : { side, buyerInfo: { profissao: `buyer-${actor}` } },
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

    transaction = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('information_schema.tables')) return [[{ has_table: 1 }]];
        if (sql.includes('SELECT legal_buyer_user_id, handshake_pin, handshake_status, handshake_attempts')) {
          return [[{
            legal_buyer_user_id: state.legalBuyerUserId ?? null,
            handshake_pin: state.handshakePin ?? null,
            handshake_status: state.handshakeStatus ?? null,
            handshake_attempts: state.handshakeAttempts ?? 0,
          }]];
        }
        if (sql.includes('UPDATE negotiations') && sql.includes('handshake_status = \'REJECTED\'')) {
          state.legalBuyerUserId = null;
          state.handshakePin = null;
          state.handshakeStatus = 'REJECTED';
          state.handshakeAttempts = Number(params[0] ?? 0);
          return [{ affectedRows: 1 }];
        }
        if (sql.includes('UPDATE negotiations SET handshake_attempts')) {
          state.handshakeAttempts = Number(params[0] ?? 0);
          return [{ affectedRows: 1 }];
        }
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
    getConnectionMock.mockResolvedValue(transaction);
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
    expect(details.body.contract.buyerInfo).toEqual(
      expect.objectContaining({ profissao: 'buyer-buyer' })
    );
    expect(details.body.documents).toEqual([
      expect.objectContaining({ ownerSide: 'buyer' }),
    ]);

    expectForbidden(await updateData('buyer', 'seller'));
    expectForbidden(await uploadDocument('buyer', 'seller'));
    expectForbidden(await deleteDocument('buyer'));
    expect(enqueueNegotiationDocumentDeletionMock).not.toHaveBeenCalled();
  });

  it('entrega ao anunciante somente o lado do vendedor', async () => {
    const details = await request(app)
      .get('/contracts/contract-matrix-1')
      .set(asActor('seller'));

    expect(details.status).toBe(200);
    expect(details.body.contract.viewerSide).toBe('seller');
    expect(details.body.contract.sellerInfo).toEqual(
      expect.objectContaining({ privateSellerField: 'seller-only' }),
    );
    expect(details.body.contract.buyerInfo).toEqual({});
    expect(details.body.documents).toEqual([
      expect.objectContaining({ ownerSide: 'seller' }),
    ]);
  });

  it('entrega ao comprador legal verificado somente o lado do comprador', async () => {
    state.legalBuyerUserId = actors.legalBuyer.id;
    state.handshakeStatus = 'VERIFIED';

    const details = await request(app)
      .get('/contracts/contract-matrix-1')
      .set(asActor('legalBuyer'));

    expect(details.status).toBe(200);
    expect(details.body.contract.viewerSide).toBe('buyer');
    expect(details.body.contract.sellerInfo).toEqual({});
    expect(details.body.contract.buyerInfo).toEqual(
      expect.objectContaining({ privateBuyerField: 'buyer-only' }),
    );
    expect(details.body.documents).toEqual([
      expect.objectContaining({ ownerSide: 'buyer' }),
    ]);
  });

  it('permite que o proprietário distinto do anunciante veja apenas o lado vendedor', async () => {
    state.propertyOwnerId = actors.propertyOwner.id;

    const details = await request(app)
      .get('/contracts/contract-matrix-1')
      .set(asActor('propertyOwner'));

    expect(details.status).toBe(200);
    expect(details.body.contract.viewerSide).toBe('seller');
    expect(details.body.contract.sellerInfo).toEqual(
      expect.objectContaining({ privateSellerField: 'seller-only' }),
    );
    expect(details.body.contract.buyerInfo).toEqual({});
  });

  it('redige PII bilateral para comprador legal enquanto o handshake está pendente', async () => {
    state.legalBuyerUserId = actors.legalBuyer.id;
    state.handshakeStatus = 'PENDING';
    state.handshakePin = 'hash-do-pin-pendente';
    state.sellerInfo = { nome: 'Vendedor Privado', cpf: '11111111111', telefone: '11999999999' };
    state.buyerInfo = { nome: 'Comprador Privado', cpf: '22222222222', telefone: '11888888888' };

    const details = await request(app)
      .get('/contracts/contract-matrix-1')
      .set(asActor('legalBuyer'));

    expect(details.status).toBe(200);
    expect(details.body.contract.sellerInfo).toEqual({});
    expect(details.body.contract.buyerInfo).toEqual({});
    expect(details.body.documents).toEqual([]);
    expect(details.body.contract.capabilities).toMatchObject({
      requiresHandshakeVerification: true,
      canReadSeller: false,
      canReadBuyer: false,
      canEditSeller: false,
      canEditBuyer: false,
    });
  });

  it('bloqueia a sexta tentativa de PIN após revogar o vínculo na quinta falha', async () => {
    const secret = 'matrix-handshake-secret';
    process.env.CONTRACT_HANDSHAKE_PIN_SECRET = secret;
    state.legalBuyerUserId = actors.legalBuyer.id;
    state.handshakeStatus = 'PENDING';
    state.handshakeAttempts = 0;
    state.handshakePin = createHmac('sha256', secret).update('1234').digest('hex');

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await request(app)
        .post('/contracts/contract-matrix-1/verify-pin')
        .set(asActor('legalBuyer'))
        .send({ pin: '0000' });

      expect(response.status).toBe(attempt === 5 ? 429 : 403);
      expect(response.body.code).toBe(
        attempt === 5 ? 'CONTRACT_HANDSHAKE_LOCKED' : 'INVALID_HANDSHAKE_PIN'
      );
    }

    expect(state.handshakeStatus).toBe('REJECTED');
    expect(state.legalBuyerUserId).toBeNull();
    expect(state.handshakeAttempts).toBe(5);

    const sixthAttempt = await request(app)
      .post('/contracts/contract-matrix-1/verify-pin')
      .set(asActor('legalBuyer'))
      .send({ pin: '0000' });
    expectForbidden(sixthAttempt);
    expect(transaction.commit).toHaveBeenCalledTimes(5);
  });

  it('permite vendedor apenas no próprio lado', async () => {
    expect((await updateData('seller', 'seller')).status).toBe(200);
    expect((await uploadDocument('seller', 'seller')).status).toBe(201);
    expectForbidden(await updateData('seller', 'buyer'));
    expectForbidden(await uploadDocument('seller', 'buyer'));
  });

  it('bloqueia comprador legal de alterar owner_data do vendedor', async () => {
    state.legalBuyerUserId = actors.legalBuyer.id;
    state.handshakeStatus = 'VERIFIED';
    state.sellerInfo = { profissao: 'Vendedor original' };

    expectForbidden(
      await request(app)
        .put('/contracts/contract-matrix-1/data')
        .set(asActor('legalBuyer'))
        .send({ side: 'seller', sellerInfo: { profissao: 'Tentativa indevida' } })
    );
    expect(state.sellerInfo).toEqual({ profissao: 'Vendedor original' });
  });

  it('permite cada um dos cinco responsáveis vinculados nos dois lados durante AWAITING_DOCS', async () => {
    for (const actor of [
      'responsible1',
      'responsible2',
      'responsible3',
      'responsible4',
      'responsible5',
    ] as const) {
      expect((await updateData(actor, 'seller')).status).toBe(200);
      expect((await updateData(actor, 'buyer')).status).toBe(200);
      expect((await uploadDocument(actor, 'seller')).status).toBe(201);
      expect((await uploadDocument(actor, 'buyer')).status).toBe(201);
    }
  });

  it('isola qualificações cadastrais e não persiste tentativa cruzada', async () => {
    state.sellerInfo = {
      estado_civil: 'Casado',
      profissao: 'Vendedor',
      regime_bens: 'Comunhão parcial',
      conjuge_nome: 'Cônjuge vendedor',
    };
    state.buyerInfo = {
      estado_civil: 'Solteiro',
      profissao: 'Comprador',
    };

    const buyerQualification = {
      estado_civil: 'Casado',
      profissao: 'Analista',
      regime_bens: 'Separação total',
      conjuge_nome: 'Cônjuge comprador',
      conjuge_cpf: '22222222222',
      conjuge_profissao: 'Arquiteta',
    };
    const ownSide = await request(app)
      .put('/contracts/contract-matrix-1/data')
      .set(asActor('buyer'))
      .send({ side: 'buyer', buyerInfo: buyerQualification });

    expect(ownSide.status).toBe(200);
    expect(state.buyerInfo).toEqual(
      expect.objectContaining(buyerQualification)
    );
    expect(state.sellerInfo).toEqual({
      estado_civil: 'Casado',
      profissao: 'Vendedor',
      regime_bens: 'Comunhão parcial',
      conjuge_nome: 'Cônjuge vendedor',
    });

    expectForbidden(
      await request(app)
        .put('/contracts/contract-matrix-1/data')
        .set(asActor('buyer'))
        .send({
          side: 'seller',
          sellerInfo: { regime_bens: 'Tentativa indevida' },
        })
    );
    expect(state.sellerInfo.regime_bens).toBe('Comunhão parcial');

    const malformedCrossSide = await request(app)
      .put('/contracts/contract-matrix-1/data')
      .set(asActor('buyer'))
      .send({
        side: 'buyer',
        buyerInfo: { seller_regime_bens: 'Tentativa indevida' },
      });
    expect(malformedCrossSide.status).toBe(400);
    expect(malformedCrossSide.body.error).toContain('vendedor');
    expect(state.buyerInfo).toEqual(
      expect.objectContaining(buyerQualification)
    );
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

      for (const actor of [
        'seller',
        'buyer',
        'responsible1',
        'responsible2',
        'responsible3',
        'responsible4',
        'responsible5',
      ] as const) {
        const side = actor === 'buyer' ? 'buyer' : 'seller';
        expectForbidden(await updateData(actor, side));
        expectForbidden(await uploadDocument(actor, side));
      }

      expect((await updateData('admin', 'seller')).status).toBe(200);
      expect((await uploadDocument('admin', 'seller')).status).toBe(201);
    },
  );

  it('mantém cada responsável em consulta de status sem PII ou arquivos após a etapa documental', async () => {
    state.status = 'AWAITING_SIGNATURES';
    state.sellerInfo = { nome: 'Vendedor privado', cpf: '11111111111' };
    state.buyerInfo = { nome: 'Comprador privado', cpf: '22222222222' };

    for (const actor of [
      'responsible1',
      'responsible2',
      'responsible3',
      'responsible4',
      'responsible5',
    ] as const) {
      const details = await request(app)
        .get('/contracts/contract-matrix-1')
        .set(asActor(actor));

      expect(details.status).toBe(200);
      expect(details.body.contract.sellerInfo).toEqual({});
      expect(details.body.contract.buyerInfo).toEqual({});
      expect(details.body.documents).toEqual([]);
      expect(details.body.documentSlots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: null,
            originalFileName: null,
            downloadUrl: null,
          }),
        ]),
      );
      expect(details.body.contract.capabilities).toMatchObject({
        canReadDocumentStatus: true,
        canReadDocumentFiles: false,
        canMutateDocuments: false,
      });
    }
  });
});
