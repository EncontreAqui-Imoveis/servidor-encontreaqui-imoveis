import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { txMock, getConnectionMock, createAdminNotificationMock, createUserNotificationMock } = vi.hoisted(() => {
  const tx = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    query: vi.fn(),
  };
  return {
    txMock: tx,
    getConnectionMock: vi.fn(),
    createAdminNotificationMock: vi.fn(),
    createUserNotificationMock: vi.fn(),
    tx,
  };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: { getConnection: getConnectionMock, query: vi.fn(), execute: vi.fn() },
}));

vi.mock('../../src/services/notificationService', () => ({
  createAdminNotification: createAdminNotificationMock,
  createUserNotification: createUserNotificationMock,
  notifyAdmins: vi.fn(),
}));

import { contractController } from '../../src/controllers/ContractController';

type Decision = {
  id: number;
  side: 'seller' | 'buyer';
  decision: 'CONSENTED' | 'CHANGES_REQUESTED';
  reason: string | null;
  sequence: number;
  reviewerUserId: number;
};

type Resolution = { id: number; reviewId: number; reason: string };

describe('draft review change-request resolution', () => {
  const app = express();
  app.use(express.json());
  app.post('/contracts/:id/draft-review/:side', (req, res) => {
    const side = req.params.side === 'seller' ? 'seller' : 'buyer';
    (req as any).userId = side === 'seller' ? 101 : 202;
    (req as any).contractContext = {
      userRole: side,
      canReadMeta: true,
      canReadSeller: side === 'seller',
      canReadBuyer: side === 'buyer',
      canEditSeller: false,
      canEditBuyer: false,
      isReadOnly: true,
      requiresHandshakeVerification: false,
    };
    return contractController.reviewDraft(req as any, res);
  });
  app.post('/admin/contracts/:id/draft-review-requests/:reviewId/keep', (req, res) => {
    (req as any).userId = 9001;
    (req as any).userRole = 'admin';
    return contractController.keepCurrentDraft(req as any, res);
  });

  let status: 'AWAITING_MINUTE_REVIEW' | 'AWAITING_SIGNATURES';
  let decisions: Decision[];
  let resolutions: Resolution[];
  let nextDecisionId: number;
  let nextResolutionId: number;

  const contractRow = () => {
    const latest = (side: 'seller' | 'buyer') =>
      decisions.filter((entry) => entry.side === side).sort((a, b) => b.sequence - a.sequence)[0];
    const latestChange = (side: 'seller' | 'buyer') =>
      decisions
        .filter((entry) => entry.side === side && entry.decision === 'CHANGES_REQUESTED')
        .sort((a, b) => b.sequence - a.sequence)[0];
    const seller = latest('seller');
    const buyer = latest('buyer');
    const sellerChange = latestChange('seller');
    const buyerChange = latestChange('buyer');
    const sellerResolution = resolutions.find((entry) => entry.reviewId === sellerChange?.id);
    const buyerResolution = resolutions.find((entry) => entry.reviewId === buyerChange?.id);
    return {
      id: 'contract-review-1',
      negotiation_id: 'neg-review-1',
      property_id: 901,
      deal_type: 'rent',
      status,
      seller_info: {}, buyer_info: {}, commission_data: {}, workflow_metadata: {},
      seller_approval_status: 'APPROVED', buyer_approval_status: 'APPROVED',
      seller_approval_reason: null, buyer_approval_reason: null,
      created_at: '2026-10-05 10:00:00', updated_at: '2026-10-05 10:00:00',
      capturing_broker_id: null, selling_broker_id: null, advertiser_id: 101,
      proposer_id: 202, initiator_side: 'buyer', legal_buyer_user_id: 202,
      handshake_status: null, handshake_pin: null, handshake_attempts: 0,
      property_title: 'Apartamento', property_purpose: 'Aluguel', property_code: 'R-901',
      property_image_url: null, property_owner_id: 101, property_owner_name: 'Locador',
      property_owner_phone: null, proposal_initiator_user_id: 202,
      capturing_broker_name: null, selling_broker_name: null, seller_client_name: 'Locador',
      proposer_name: 'Locatário', buyer_client_name: 'Locatário', capturing_agency_name: null,
      capturing_agency_address: null, responsible_user_ids: null,
      draft_review_revision_id: 7001, draft_review_revision_number: 4,
      draft_review_document_id: 8001, draft_review_original_file_name: 'minuta.pdf',
      draft_review_created_at: '2026-10-05 10:00:00',
      seller_draft_review_decision: seller?.decision ?? null,
      seller_draft_review_reason: seller?.reason ?? null,
      seller_draft_review_at: seller ? '2026-10-05 10:01:00' : null,
      seller_draft_change_request_id: sellerChange?.id ?? null,
      seller_draft_change_request_reason: sellerChange?.reason ?? null,
      seller_draft_change_request_at: sellerChange ? '2026-10-05 10:01:00' : null,
      seller_draft_resolution_id: sellerResolution?.id ?? null,
      seller_draft_resolution: sellerResolution ? 'KEPT_CURRENT_DRAFT' : null,
      seller_draft_resolution_reason: sellerResolution?.reason ?? null,
      seller_draft_resolution_at: sellerResolution ? '2026-10-05 10:03:00' : null,
      seller_draft_resolution_admin_id: sellerResolution ? 9001 : null,
      buyer_draft_review_decision: buyer?.decision ?? null,
      buyer_draft_review_reason: buyer?.reason ?? null,
      buyer_draft_review_at: buyer ? '2026-10-05 10:01:00' : null,
      buyer_draft_change_request_id: buyerChange?.id ?? null,
      buyer_draft_change_request_reason: buyerChange?.reason ?? null,
      buyer_draft_change_request_at: buyerChange ? '2026-10-05 10:01:00' : null,
      buyer_draft_resolution_id: buyerResolution?.id ?? null,
      buyer_draft_resolution: buyerResolution ? 'KEPT_CURRENT_DRAFT' : null,
      buyer_draft_resolution_reason: buyerResolution?.reason ?? null,
      buyer_draft_resolution_at: buyerResolution ? '2026-10-05 10:03:00' : null,
      buyer_draft_resolution_admin_id: buyerResolution ? 9001 : null,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    status = 'AWAITING_MINUTE_REVIEW';
    decisions = [];
    resolutions = [];
    nextDecisionId = 1;
    nextResolutionId = 1;
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    createAdminNotificationMock.mockResolvedValue(undefined);
    createUserNotificationMock.mockResolvedValue(undefined);
    txMock.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM contracts c') && sql.includes('FOR UPDATE')) {
        return [[contractRow()]];
      }
      if (sql.includes('SELECT id FROM contract_draft_revisions') && sql.includes('is_active = 1')) {
        return [[{ id: 7001 }]];
      }
      if (sql.includes('ORDER BY decision_sequence DESC')) {
        const side = String(params[1]) as 'seller' | 'buyer';
        const latest = decisions
          .filter((entry) => entry.side === side)
          .sort((a, b) => b.sequence - a.sequence)[0];
        return [latest ? [{ id: latest.id, decision: latest.decision, decision_sequence: latest.sequence }] : []];
      }
      if (sql.includes('WHERE change_request_review_id = ?')) {
        const reviewId = Number(params[0]);
        const resolution = resolutions.find((entry) => entry.reviewId === reviewId);
        return [resolution ? [{ id: resolution.id, resolution: 'KEPT_CURRENT_DRAFT' }] : []];
      }
      if (sql.includes('INSERT INTO contract_draft_reviews')) {
        const id = nextDecisionId++;
        decisions.push({
          id,
          side: String(params[3]) as 'seller' | 'buyer',
          decision: String(params[4]) as 'CONSENTED' | 'CHANGES_REQUESTED',
          reason: params[5] == null ? null : String(params[5]),
          sequence: Number(params[6]),
          reviewerUserId: Number(params[2]),
        });
        return [{ insertId: id, affectedRows: 1 }];
      }
      if (sql.includes('SELECT COUNT(*) AS consent_count')) {
        const latestBySide = new Map<'seller' | 'buyer', Decision>();
        for (const decision of decisions) {
          const previous = latestBySide.get(decision.side);
          if (!previous || previous.sequence < decision.sequence) latestBySide.set(decision.side, decision);
        }
        const consentCount = Array.from(latestBySide.values())
          .filter((entry) => entry.decision === 'CONSENTED').length;
        return [[{ consent_count: consentCount }]];
      }
      if (sql.includes("SET status = 'AWAITING_SIGNATURES'")) {
        status = 'AWAITING_SIGNATURES';
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('WHERE id = ?') && sql.includes("decision = 'CHANGES_REQUESTED'")) {
        const request = decisions.find((entry) =>
          entry.id === Number(params[0]) && entry.decision === 'CHANGES_REQUESTED'
        );
        return [request ? [{
          id: request.id,
          reviewer_user_id: request.reviewerUserId,
          reviewer_side: request.side,
          decision_sequence: request.sequence,
        }] : []];
      }
      if (sql.includes('decision_sequence > ?')) {
        const hasLater = decisions.some((entry) =>
          entry.side === params[1] && entry.sequence > Number(params[2])
        );
        return [hasLater ? [{ id: 999 }] : []];
      }
      if (sql.includes('INSERT INTO contract_draft_review_resolutions')) {
        const id = nextResolutionId++;
        resolutions.push({ id, reviewId: Number(params[2]), reason: String(params[5]) });
        return [{ insertId: id, affectedRows: 1 }];
      }
      return [[]];
    });
  });

  const requestReview = (side: 'seller' | 'buyer', body: Record<string, unknown>) =>
    request(app).post(`/contracts/contract-review-1/draft-review/${side}`).send(body);

  it.each([
    { label: 'não-string', reason: 123 },
    { label: 'curto após trim', reason: '  ab  ' },
    { label: 'sem três caracteres úteis', reason: ' a b ' },
    { label: 'acima do limite', reason: 'a'.repeat(5001) },
  ])('rejects motivo $label com 422', async ({ reason }) => {
    const response = await requestReview('seller', {
      decision: 'CHANGES_REQUESTED',
      reason,
    });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('DRAFT_REVIEW_REASON_INVALID');
    expect(decisions).toEqual([]);
  });

  it('stores 5000-character text literally without truncation', async () => {
    const reason = `  ${"'\";--"}${'x'.repeat(4995)}  `;
    expect(Array.from(reason.trim())).toHaveLength(5000);
    const response = await requestReview('seller', {
      decision: 'CHANGES_REQUESTED',
      reason,
    });
    expect(response.status).toBe(200);
    expect(decisions[0]).toMatchObject({ decision: 'CHANGES_REQUESTED', reason: reason.trim() });
  });

  it('preserves the other consent and permits only the requester to decide again after keep', async () => {
    expect((await requestReview('buyer', { decision: 'CONSENTED' })).status).toBe(200);
    expect((await requestReview('seller', {
      decision: 'CHANGES_REQUESTED', reason: 'Corrigir a cláusula de prazo.',
    })).status).toBe(200);
    const requestId = decisions.find((entry) => entry.side === 'seller')!.id;

    const beforeResolution = await requestReview('seller', { decision: 'CONSENTED' });
    expect(beforeResolution.status).toBe(409);
    expect(beforeResolution.body.code).toBe('DRAFT_CHANGE_REQUEST_PENDING_RESOLUTION');

    const keep = await request(app)
      .post(`/admin/contracts/contract-review-1/draft-review-requests/${requestId}/keep`)
      .send({ reason: 'A redação atual corresponde ao acordo aprovado.' });
    expect(keep.status).toBe(200);
    expect(resolutions).toHaveLength(1);
    expect(status).toBe('AWAITING_MINUTE_REVIEW');
    expect(keep.body.contract.draftReview).toMatchObject({
      revisionId: 7001,
      sellerDecision: 'CHANGES_REQUESTED',
      sellerEffectiveDecision: null,
      sellerChangeRequest: {
        id: requestId,
        pendingResolution: false,
        resolution: {
          resolution: 'KEPT_CURRENT_DRAFT',
          reason: 'A redação atual corresponde ao acordo aprovado.',
        },
      },
      buyerDecision: 'CONSENTED',
      buyerEffectiveDecision: 'CONSENTED',
      allConsented: false,
    });
    expect(decisions.filter((entry) => entry.side === 'buyer')).toHaveLength(1);
    expect(decisions.find((entry) => entry.side === 'buyer')).toMatchObject({ decision: 'CONSENTED' });
    expect(createUserNotificationMock).toHaveBeenCalledTimes(1);
    expect(createUserNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: 101,
      title: 'Solicitação de correção analisada',
      message: 'A imobiliária decidiu manter a minuta atual. Consulte os detalhes.',
      metadata: expect.objectContaining({ draftRevisionId: 7001, draftReviewId: requestId }),
    }));

    const sellerConsent = await requestReview('seller', { decision: 'CONSENTED' });
    expect(sellerConsent.status).toBe(200);
    expect(status).toBe('AWAITING_SIGNATURES');
    expect(decisions.filter((entry) => entry.side === 'seller')).toHaveLength(2);
    expect(decisions.find((entry) => entry.id === requestId)).toMatchObject({
      decision: 'CHANGES_REQUESTED',
      reason: 'Corrigir a cláusula de prazo.',
    });
  });

  it('blocks a second or stale keep operation', async () => {
    await requestReview('seller', {
      decision: 'CHANGES_REQUESTED', reason: 'Corrigir a identificação do imóvel.',
    });
    const requestId = decisions[0].id;
    expect((await request(app)
      .post(`/admin/contracts/contract-review-1/draft-review-requests/${requestId}/keep`)
      .send({ reason: 'O dado confere com a matrícula.' })).status).toBe(200);

    const duplicate = await request(app)
      .post(`/admin/contracts/contract-review-1/draft-review-requests/${requestId}/keep`)
      .send({ reason: 'Tentativa posterior.' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('DRAFT_CHANGE_REQUEST_ALREADY_RESOLVED');

    const inactive = await request(app)
      .post('/admin/contracts/contract-review-1/draft-review-requests/999/keep')
      .send({ reason: 'Não existe nesta revisão.' });
    expect(inactive.status).toBe(409);
    expect(inactive.body.code).toBe('DRAFT_CHANGE_REQUEST_NOT_FOUND');
  });

  it('applies the same reason validation to the administrative resolution', async () => {
    await requestReview('seller', {
      decision: 'CHANGES_REQUESTED', reason: 'Corrigir a identificação do imóvel.',
    });

    const response = await request(app)
      .post('/admin/contracts/contract-review-1/draft-review-requests/1/keep')
      .send({ reason: ['não é texto'] });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('DRAFT_REVIEW_REASON_INVALID');
    expect(resolutions).toEqual([]);
  });
});
