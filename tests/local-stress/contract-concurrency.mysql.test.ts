import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const enabled = process.env.LOCAL_CONCURRENCY_TESTS === '1';
const describeLocal = enabled ? describe : describe.skip;

type LocalConcurrencyConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

function resolveLocalConfig(): LocalConcurrencyConfig {
  const host = String(process.env.LOCAL_CONCURRENCY_DB_HOST ?? '127.0.0.1').trim();
  const database = String(process.env.LOCAL_CONCURRENCY_DB_DATABASE ?? '').trim();
  const port = Number(process.env.LOCAL_CONCURRENCY_DB_PORT ?? '4000');
  const user = String(process.env.LOCAL_CONCURRENCY_DB_USER ?? '').trim();
  const password = String(process.env.LOCAL_CONCURRENCY_DB_PASSWORD ?? '');

  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Os testes locais de concorrencia aceitam somente localhost ou 127.0.0.1.');
  }
  if (!/^[A-Za-z0-9_]+_test$/.test(database)) {
    throw new Error('LOCAL_CONCURRENCY_DB_DATABASE deve terminar em _test.');
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('LOCAL_CONCURRENCY_DB_PORT invalida.');
  }
  if (!user) {
    throw new Error('LOCAL_CONCURRENCY_DB_USER e obrigatoria.');
  }

  return { host, port, user, password, database };
}

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function beginPessimisticTransaction(tx: PoolConnection): Promise<void> {
  await tx.query("SET SESSION tidb_txn_mode = 'pessimistic'");
  await tx.beginTransaction();
}

async function acquireNegotiationLock(tx: PoolConnection, negotiationId: string): Promise<void> {
  const [rows] = await tx.query<Array<{ id: string }>>(
    `SELECT id FROM security_concurrency_negotiations WHERE id = ? FOR UPDATE`,
    [negotiationId]
  );
  expect(rows).toHaveLength(1);
}

async function acquireContractLock(
  tx: PoolConnection,
  negotiationId: string
): Promise<Array<{ negotiation_id: string; contract_id: string; status: string; commission_data: string | null }>> {
  const [rows] = await tx.query<Array<{
    negotiation_id: string;
    contract_id: string;
    status: string;
    commission_data: string | null;
  }>>(
    `
      SELECT negotiation_id, contract_id, status, commission_data
      FROM security_concurrency_contracts
      WHERE negotiation_id = ?
      FOR UPDATE
    `,
    [negotiationId]
  );
  return rows;
}

describeLocal('local MySQL concurrency controls', () => {
  let config: LocalConcurrencyConfig;
  let pool: Pool;

  beforeAll(async () => {
    config = resolveLocalConfig();
    const bootstrap = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      waitForConnections: true,
      connectionLimit: 1,
    });
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(config.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await bootstrap.end();

    pool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: 4,
      queueLimit: 0,
      charset: 'utf8mb4',
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_concurrency_negotiations (
        id VARCHAR(64) NOT NULL PRIMARY KEY
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_concurrency_contracts (
        negotiation_id VARCHAR(64) NOT NULL PRIMARY KEY,
        contract_id VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        commission_data TEXT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_concurrency_allocations (
        contract_id VARCHAR(64) NOT NULL PRIMARY KEY,
        amount_cents BIGINT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_concurrency_approval_history (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        negotiation_id VARCHAR(64) NOT NULL,
        action VARCHAR(64) NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_concurrency_documents (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        contract_id VARCHAR(64) NOT NULL,
        document_type VARCHAR(64) NOT NULL
      )
    `);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM security_concurrency_documents');
    await pool.query('DELETE FROM security_concurrency_approval_history');
    await pool.query('DELETE FROM security_concurrency_allocations');
    await pool.query('DELETE FROM security_concurrency_contracts');
    await pool.query('DELETE FROM security_concurrency_negotiations');
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DROP TABLE IF EXISTS security_concurrency_documents');
    await pool.query('DROP TABLE IF EXISTS security_concurrency_approval_history');
    await pool.query('DROP TABLE IF EXISTS security_concurrency_allocations');
    await pool.query('DROP TABLE IF EXISTS security_concurrency_contracts');
    await pool.query('DROP TABLE IF EXISTS security_concurrency_negotiations');
    await pool.end();
  });

  it('serializes simultaneous contract creation and preserves one contract per negotiation', async () => {
    await pool.query('INSERT INTO security_concurrency_negotiations (id) VALUES (?)', ['neg-concurrent-1']);
    let releaseFirstTransaction!: () => void;
    const firstCanCommit = new Promise<void>((resolve) => {
      releaseFirstTransaction = resolve;
    });
    let firstHasLock!: () => void;
    const firstLocked = new Promise<void>((resolve) => {
      firstHasLock = resolve;
    });

    const first = (async () => {
      const tx = await pool.getConnection();
      try {
        await beginPessimisticTransaction(tx);
        await acquireNegotiationLock(tx, 'neg-concurrent-1');
        const existing = await acquireContractLock(tx, 'neg-concurrent-1');
        expect(existing).toHaveLength(0);
        firstHasLock();
        await firstCanCommit;
        await tx.query(
          `INSERT INTO security_concurrency_contracts (negotiation_id, contract_id, status) VALUES (?, ?, 'AWAITING_DOCS')`,
          ['neg-concurrent-1', 'contract-1']
        );
        await tx.commit();
        return { created: true };
      } finally {
        tx.release();
      }
    })();

    await firstLocked;
    let secondHasLock = false;
    const second = (async () => {
      const tx = await pool.getConnection();
      try {
        await beginPessimisticTransaction(tx);
        await acquireNegotiationLock(tx, 'neg-concurrent-1');
        const existing = await acquireContractLock(tx, 'neg-concurrent-1');
        secondHasLock = true;
        if (existing.length > 0) {
          await tx.rollback();
          return { created: false, contractId: existing[0].contract_id };
        }
        await tx.query(
          `INSERT INTO security_concurrency_contracts (negotiation_id, contract_id, status) VALUES (?, ?, 'AWAITING_DOCS')`,
          ['neg-concurrent-1', 'contract-2']
        );
        await tx.commit();
        return { created: true, contractId: 'contract-2' };
      } finally {
        tx.release();
      }
    })();

    await delay(100);
    expect(secondHasLock).toBe(false);
    releaseFirstTransaction();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ created: true });
    expect(secondResult).toEqual({ created: false, contractId: 'contract-1' });
    const [rows] = await pool.query<Array<{ total: number }>>(
      'SELECT COUNT(*) AS total FROM security_concurrency_contracts WHERE negotiation_id = ?',
      ['neg-concurrent-1']
    );
    expect(rows[0].total).toBe(1);
  });

  it('serializes simultaneous approval and records the decision only once', async () => {
    await pool.query('INSERT INTO security_concurrency_negotiations (id) VALUES (?)', ['neg-approval-1']);
    let releaseFirstTransaction!: () => void;
    const firstCanCommit = new Promise<void>((resolve) => {
      releaseFirstTransaction = resolve;
    });
    let firstLocked!: () => void;
    const firstHasLock = new Promise<void>((resolve) => {
      firstLocked = resolve;
    });

    const approve = async (holdLock: boolean) => {
      const tx = await pool.getConnection();
      try {
        await beginPessimisticTransaction(tx);
        await acquireNegotiationLock(tx, 'neg-approval-1');
        const [negotiations] = await tx.query<Array<{ status: string }>>(
          `
            SELECT status
            FROM security_concurrency_contracts
            WHERE negotiation_id = ?
            FOR UPDATE
          `,
          ['neg-approval-1']
        );

        if (negotiations.length > 0) {
          await tx.rollback();
          return { idempotent: true };
        }

        if (holdLock) {
          firstLocked();
          await firstCanCommit;
        }
        await tx.query(
          `
            INSERT INTO security_concurrency_contracts (negotiation_id, contract_id, status)
            VALUES (?, ?, 'AWAITING_DOCS')
          `,
          ['neg-approval-1', 'contract-approval-1']
        );
        await tx.query(
          `
            INSERT INTO security_concurrency_approval_history (negotiation_id, action)
            VALUES (?, 'admin_approved')
          `,
          ['neg-approval-1']
        );
        await tx.commit();
        return { idempotent: false };
      } finally {
        tx.release();
      }
    };

    const first = approve(true);
    await firstHasLock;
    let secondCompleted = false;
    const second = approve(false).then((result) => {
      secondCompleted = true;
      return result;
    });

    await delay(100);
    expect(secondCompleted).toBe(false);
    releaseFirstTransaction();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect([firstResult, secondResult].filter((result) => result.idempotent)).toHaveLength(1);
    const [historyRows] = await pool.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total FROM security_concurrency_approval_history WHERE negotiation_id = ?`,
      ['neg-approval-1']
    );
    expect(historyRows[0].total).toBe(1);
  });

  it('serializes replacement and prevents two requests from replacing the same document', async () => {
    await pool.query(
      `
        INSERT INTO security_concurrency_contracts (negotiation_id, contract_id, status)
        VALUES (?, ?, 'AWAITING_SIGNATURES')
      `,
      ['neg-document-1', 'contract-document-1']
    );
    await pool.query(
      `
        INSERT INTO security_concurrency_documents (id, contract_id, document_type)
        VALUES (?, ?, 'contrato_assinado')
      `,
      ['document-old', 'contract-document-1']
    );

    let releaseFirstTransaction!: () => void;
    const firstCanCommit = new Promise<void>((resolve) => {
      releaseFirstTransaction = resolve;
    });
    let firstLocked!: () => void;
    const firstHasLock = new Promise<void>((resolve) => {
      firstLocked = resolve;
    });

    const replace = async (holdLock: boolean) => {
      const tx = await pool.getConnection();
      try {
        await beginPessimisticTransaction(tx);
        const [contractRows] = await tx.query<Array<{ contract_id: string }>>(
          `
            SELECT contract_id
            FROM security_concurrency_contracts
            WHERE contract_id = ?
            FOR UPDATE
          `,
          ['contract-document-1']
        );
        expect(contractRows).toHaveLength(1);
        const [documentRows] = await tx.query<Array<{ id: string }>>(
          `
            SELECT id
            FROM security_concurrency_documents
            WHERE id = ? AND contract_id = ?
            FOR UPDATE
          `,
          ['document-old', 'contract-document-1']
        );
        if (documentRows.length === 0) {
          await tx.rollback();
          return { replaced: false };
        }

        if (holdLock) {
          firstLocked();
          await firstCanCommit;
        }
        await tx.query('DELETE FROM security_concurrency_documents WHERE id = ?', ['document-old']);
        await tx.query(
          `
            INSERT INTO security_concurrency_documents (id, contract_id, document_type)
            VALUES (?, ?, 'contrato_assinado')
          `,
          ['document-new', 'contract-document-1']
        );
        await tx.commit();
        return { replaced: true };
      } finally {
        tx.release();
      }
    };

    const first = replace(true);
    await firstHasLock;
    let secondCompleted = false;
    const second = replace(false).then((result) => {
      secondCompleted = true;
      return result;
    });

    await delay(100);
    expect(secondCompleted).toBe(false);
    releaseFirstTransaction();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect([firstResult, secondResult].filter((result) => result.replaced)).toHaveLength(1);
    const [documentRows] = await pool.query<Array<{ id: string }>>(
      'SELECT id FROM security_concurrency_documents WHERE contract_id = ?',
      ['contract-document-1']
    );
    expect(documentRows).toEqual([{ id: 'document-new' }]);
  });

  it('serializes finalization and makes the second equal request an idempotent replay', async () => {
    const commissionData = JSON.stringify({
      valorBaseComissao: 10000,
      comissaoCaptador: 5000,
      comissaoVendedor: 3000,
      taxaPlataforma: 2000,
    });
    await pool.query(
      `
        INSERT INTO security_concurrency_contracts (negotiation_id, contract_id, status, commission_data)
        VALUES (?, ?, 'AWAITING_SIGNATURES', NULL)
      `,
      ['neg-concurrent-2', 'contract-2']
    );

    const finalize = async () => {
      const tx = await pool.getConnection();
      try {
        await beginPessimisticTransaction(tx);
        const [contract] = await acquireContractLock(tx, 'neg-concurrent-2');
        if (contract.status === 'FINALIZED') {
          expect(JSON.parse(contract.commission_data ?? '{}')).toEqual(JSON.parse(commissionData));
          await tx.rollback();
          return { idempotent: true };
        }
        await tx.query(
          `UPDATE security_concurrency_contracts SET status = 'FINALIZED', commission_data = ? WHERE negotiation_id = ?`,
          [commissionData, 'neg-concurrent-2']
        );
        await tx.query(
          `INSERT INTO security_concurrency_allocations (contract_id, amount_cents) VALUES (?, ?)`,
          ['contract-2', 1000000]
        );
        await tx.commit();
        return { idempotent: false };
      } finally {
        tx.release();
      }
    };

    const [first, second] = await Promise.all([finalize(), finalize()]);
    expect([first, second].filter((result) => result.idempotent)).toHaveLength(1);
    const [allocations] = await pool.query<Array<{ total: number }>>(
      'SELECT COUNT(*) AS total FROM security_concurrency_allocations WHERE contract_id = ?',
      ['contract-2']
    );
    expect(allocations[0].total).toBe(1);
  });
});
