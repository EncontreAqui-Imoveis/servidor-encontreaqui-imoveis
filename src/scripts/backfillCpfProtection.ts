import { ResultSetHeader, RowDataPacket } from 'mysql2';

import connection from '../database/connection';
import {
  protectCpf,
  protectCpfFieldsInJson,
} from '../security/personalDataProtection';

const BATCH_SIZE = 100;
const APPLY_CONFIRMATION = 'APPLY_CPF_BACKFILL';
const ERASE_CONFIRMATION = 'ERASE_LEGACY_CPF';

type JsonObject = Record<string, unknown>;

type UserCpfRow = RowDataPacket & {
  id: number;
  cpf: string | null;
};

type NegotiationCpfRow = RowDataPacket & {
  id: string;
  payment_details: unknown;
};

type ContractCpfRow = RowDataPacket & {
  id: string;
  seller_info: unknown;
  buyer_info: unknown;
};

function parseObject(value: unknown): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {};
  } catch {
    return {};
  }
}

function hasPlaintextCpf(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasPlaintextCpf);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.entries(value as JsonObject).some(([key, nestedValue]) => {
    const normalized = key.replace(/[_-]/g, '').toLowerCase();
    if (
      ['cpf', 'clientcpf', 'spousecpf', 'conjugecpf'].includes(normalized) &&
      typeof nestedValue === 'string' &&
      nestedValue.trim().length > 0
    ) {
      return true;
    }
    return hasPlaintextCpf(nestedValue);
  });
}

function readFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function assertMode(): { apply: boolean; eraseLegacy: boolean } {
  const apply = readFlag('--apply');
  const eraseLegacy = readFlag('--erase-legacy');
  const confirmation = String(process.env.CPF_BACKFILL_CONFIRM ?? '').trim();

  if (apply && confirmation !== APPLY_CONFIRMATION && confirmation !== ERASE_CONFIRMATION) {
    throw new Error(
      `Para gravar, defina CPF_BACKFILL_CONFIRM=${APPLY_CONFIRMATION} e execute com --apply.`,
    );
  }
  if (eraseLegacy && (!apply || confirmation !== ERASE_CONFIRMATION)) {
    throw new Error(
      `A limpeza definitiva exige --apply --erase-legacy e CPF_BACKFILL_CONFIRM=${ERASE_CONFIRMATION}.`,
    );
  }

  return { apply, eraseLegacy };
}

async function migrateUsers(apply: boolean): Promise<number> {
  // Cursor pagination avoids skipping rows after an applied batch no longer
  // matches `cpf_ciphertext IS NULL`.
  let lastId = 0;
  let migrated = 0;
  while (true) {
    const [rows] = await connection.query<UserCpfRow[]>(
      `
        SELECT id, cpf
        FROM users
        WHERE id > ?
          AND cpf IS NOT NULL
          AND TRIM(cpf) <> ''
          AND cpf_ciphertext IS NULL
        ORDER BY id ASC
        LIMIT ?
      `,
      [lastId, BATCH_SIZE],
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      lastId = Number(row.id);
      migrated += 1;
      if (!apply) continue;
      const protectedCpf = protectCpf(row.cpf, 'users:cpf');
      if (!protectedCpf) continue;
      await connection.query(
        `
          UPDATE users
          SET cpf_ciphertext = ?, cpf_lookup_hash = ?, cpf_last4 = ?, cpf_key_version = ?
          WHERE id = ? AND cpf_ciphertext IS NULL
        `,
        [
          protectedCpf.ciphertext,
          protectedCpf.lookupHash,
          protectedCpf.last4,
          protectedCpf.keyVersion,
          row.id,
        ],
      );
    }
  }
  return migrated;
}

async function migrateNegotiations(apply: boolean): Promise<number> {
  let offset = 0;
  let migrated = 0;
  while (true) {
    const [rows] = await connection.query<NegotiationCpfRow[]>(
      'SELECT id, payment_details FROM negotiations ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?',
      [BATCH_SIZE, offset],
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      const original = parseObject(row.payment_details);
      if (!hasPlaintextCpf(original)) continue;
      migrated += 1;
      if (!apply) continue;
      const protectedJson = protectCpfFieldsInJson(original, 'negotiations:payment_details');
      await connection.query(
        'UPDATE negotiations SET payment_details = CAST(? AS JSON) WHERE id = ?',
        [JSON.stringify(protectedJson), row.id],
      );
    }
    offset += rows.length;
  }
  return migrated;
}

async function migrateContracts(apply: boolean): Promise<number> {
  let offset = 0;
  let migrated = 0;
  while (true) {
    const [rows] = await connection.query<ContractCpfRow[]>(
      'SELECT id, seller_info, buyer_info FROM contracts ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?',
      [BATCH_SIZE, offset],
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      const sellerInfo = parseObject(row.seller_info);
      const buyerInfo = parseObject(row.buyer_info);
      const sellerNeedsMigration = hasPlaintextCpf(sellerInfo);
      const buyerNeedsMigration = hasPlaintextCpf(buyerInfo);
      if (!sellerNeedsMigration && !buyerNeedsMigration) continue;
      migrated += 1;
      if (!apply) continue;
      await connection.query(
        `
          UPDATE contracts
          SET seller_info = CAST(? AS JSON), buyer_info = CAST(? AS JSON)
          WHERE id = ?
        `,
        [
          JSON.stringify(
            sellerNeedsMigration
              ? protectCpfFieldsInJson(sellerInfo, 'contracts:seller_info')
              : sellerInfo,
          ),
          JSON.stringify(
            buyerNeedsMigration
              ? protectCpfFieldsInJson(buyerInfo, 'contracts:buyer_info')
              : buyerInfo,
          ),
          row.id,
        ],
      );
    }
    offset += rows.length;
  }
  return migrated;
}

async function eraseLegacyUserCpf(): Promise<number> {
  const [result] = await connection.query<ResultSetHeader>(
    `
      UPDATE users
      SET cpf = NULL
      WHERE cpf IS NOT NULL AND TRIM(cpf) <> '' AND cpf_ciphertext IS NOT NULL
    `,
  );
  return Number(result.affectedRows ?? 0);
}

async function main(): Promise<void> {
  const { apply, eraseLegacy } = assertMode();
  const mode = eraseLegacy ? 'APPLY + ERASE LEGADO' : apply ? 'APPLY' : 'DRY-RUN';
  console.log(`Backfill de CPF iniciado em modo ${mode}. Nenhum CPF e exibido nos logs.`);

  const users = await migrateUsers(apply);
  const negotiations = await migrateNegotiations(apply);
  const contracts = await migrateContracts(apply);
  const erasedUsers = eraseLegacy ? await eraseLegacyUserCpf() : 0;

  console.log(JSON.stringify({ users, negotiations, contracts, erasedUsers, apply, eraseLegacy }));
  if (!apply) {
    console.log(
      `Dry-run concluido. Para aplicar: CPF_BACKFILL_CONFIRM=${APPLY_CONFIRMATION} node dist/scripts/backfillCpfProtection.js --apply`,
    );
  }
}

main()
  .catch((error) => {
    console.error('Falha no backfill de CPF:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
