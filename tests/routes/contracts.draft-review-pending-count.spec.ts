import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthRequest } from '../../src/middlewares/auth';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: { query: queryMock },
}));

vi.mock('../../src/middlewares/auth', async (importOriginal) => {
  vi.stubEnv('JWT_SECRET', 'pending-count-test-secret');
  const actual = await importOriginal<typeof import('../../src/middlewares/auth')>();
  return {
    ...actual,
    authMiddleware: (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
      const role = req.header('x-test-role');
      if (!role) return res.status(401).json({ error: 'Não autenticado.' });
      req.userId = 9001;
      req.userRole = role === 'client' ? 'client' : 'admin';
      req.adminValidated = role !== 'client' && role !== 'unvalidated';
      req.adminRole = role === 'document_operator' ? 'document_operator'
        : role === 'operational_assistant' ? 'operational_assistant' : 'admin';
      return next();
    },
  };
});

import contractRoutes from '../../src/routes/contract.routes';

describe('GET /admin/contracts/draft-review-requests/pending-count', () => {
  const path = '/admin/contracts/draft-review-requests/pending-count';
  const app = express();
  app.use(contractRoutes);
  let database: DatabaseSync;

  // Execute the actual COUNT SQL against relational fixtures, rather than
  // returning a canned count. These joins use the SQL subset shared by TiDB
  // and SQLite; this does not replace a production-database integration test.
  beforeEach(() => {
    vi.clearAllMocks();
    database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE contracts (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE contract_draft_revisions (
        id INTEGER PRIMARY KEY, contract_id TEXT NOT NULL, is_active INTEGER NOT NULL
      );
      CREATE TABLE contract_draft_reviews (
        id INTEGER PRIMARY KEY, contract_id TEXT NOT NULL, revision_id INTEGER NOT NULL,
        reviewer_side TEXT NOT NULL, decision TEXT NOT NULL
      );
      CREATE TABLE contract_draft_review_resolutions (
        id INTEGER PRIMARY KEY, change_request_review_id INTEGER NOT NULL UNIQUE,
        resolution TEXT NOT NULL
      );
      INSERT INTO contracts VALUES ('contract-1', 'AWAITING_MINUTE_REVIEW');
      INSERT INTO contract_draft_revisions VALUES (91, 'contract-1', 1);
    `);
    queryMock.mockImplementation(async (sql: string, params: []) =>
      [database.prepare(sql).all(...params)]);
  });

  afterEach(() => database.close());
  afterAll(() => vi.unstubAllEnvs());

  function addRequest(id = 1, side = 'seller', revisionId = 91, decision = 'CHANGES_REQUESTED') {
    database.prepare('INSERT INTO contract_draft_reviews VALUES (?, ?, ?, ?, ?)')
      .run(id, 'contract-1', revisionId, side, decision);
  }

  async function expectTotal(total: number, role = 'admin') {
    const response = await request(app).get(path).set('x-test-role', role);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ total });
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql.match(/\bSELECT\b/gi)).toHaveLength(1);
    expect(sql).toMatch(/SELECT COUNT\(\*\) AS total/);
    expect(params).toEqual([]);
  }

  it('returns zero with no requests', async () => {
    await expectTotal(0);
  });

  it('counts an unresolved request on the active revision', async () => {
    addRequest();
    await expectTotal(1);
  });

  it('counts two sides as two requests even on the same contract', async () => {
    addRequest();
    addRequest(2, 'buyer');
    await expectTotal(2);
  });

  it('excludes requests resolved with KEPT_CURRENT_DRAFT and retains newer pending requests', async () => {
    addRequest();
    database.exec("INSERT INTO contract_draft_review_resolutions VALUES (1, 1, 'KEPT_CURRENT_DRAFT')");
    await expectTotal(0);
    queryMock.mockClear();
    addRequest(2);
    await expectTotal(1);
  });

  it('excludes inactive revisions after replacement', async () => {
    addRequest();
    database.exec(`
      UPDATE contract_draft_revisions SET is_active = 0 WHERE id = 91;
      INSERT INTO contract_draft_revisions VALUES (92, 'contract-1', 1);
    `);
    await expectTotal(0);
  });

  it.each(['AWAITING_DOCS', 'IN_DRAFT', 'AWAITING_SIGNATURES', 'FINALIZED'])(
    'excludes contracts in %s', async (status) => {
      addRequest();
      database.prepare('UPDATE contracts SET status = ?').run(status);
      await expectTotal(0);
    }
  );

  it('does not count consent decisions', async () => {
    addRequest(1, 'seller', 91, 'CONSENTED');
    await expectTotal(0);
  });

  it('allows operational assistants with manage_contract_workflow', async () => {
    addRequest();
    await expectTotal(1, 'operational_assistant');
  });

  it('denies admins without manage_contract_workflow before querying', async () => {
    const response = await request(app).get(path).set('x-test-role', 'document_operator');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ADMIN_CAPABILITY_DENIED');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it.each(['client', 'unvalidated'])('denies %s before querying', async (role) => {
    const response = await request(app).get(path).set('x-test-role', role);
    expect(response.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    expect((await request(app).get(path)).status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns the normal server error when counting fails', async () => {
    queryMock.mockRejectedValueOnce(new Error('Database unavailable'));
    expect((await request(app).get(path).set('x-test-role', 'admin')).status).toBe(500);
  });
});
