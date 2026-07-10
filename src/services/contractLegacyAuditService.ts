import type { RowDataPacket } from 'mysql2';

import { normalizeCpfDigits } from '../utils/cpfValidator';

export interface LegacyContractAuditDb {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
  getConnection(): Promise<LegacyContractAuditTransaction>;
}

export interface LegacyContractAuditTransaction {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}

export type LegacyContractManualReviewReason =
  | 'DUAL_PARTICIPANT_IDENTITY'
  | 'MISSING_SELLING_BROKER'
  | 'INVALID_SELLING_BROKER';

export interface LegacyContractIdentityFinding {
  contractId: string;
  negotiationId: string;
  sellerClientId: string | null;
  buyerClientId: string | null;
  sameUserId: boolean;
  sameCpf: boolean;
}

export interface LegacyContractResponsibleCandidate {
  contractId: string;
  negotiationId: string;
  sellingBrokerId: string;
}

export interface LegacyContractManualReviewFinding {
  contractId: string;
  negotiationId: string;
  reasons: LegacyContractManualReviewReason[];
  sellingBrokerId: string | null;
}

export interface LegacyContractBackfillSkip {
  contractId: string;
  negotiationId: string;
  reason: LegacyContractManualReviewReason | 'RESPONSIBLE_ALREADY_ASSIGNED';
}

export interface LegacyContractAuditReport {
  version: 1;
  mode: 'audit' | 'apply';
  generatedAt: string;
  summary: {
    totalContractsScanned: number;
    contractsWithResponsible: number;
    dualParticipantIdentity: number;
    eligibleResponsibleBackfills: number;
    manualReviewRequired: number;
    responsibleBackfillsInserted: number;
    responsibleBackfillsSkipped: number;
  };
  dualParticipantIdentityContracts: LegacyContractIdentityFinding[];
  eligibleResponsibleBackfills: LegacyContractResponsibleCandidate[];
  manualReviewContracts: LegacyContractManualReviewFinding[];
  appliedResponsibleBackfills: LegacyContractResponsibleCandidate[];
  skippedResponsibleBackfills: LegacyContractBackfillSkip[];
}

interface LegacyContractAuditRow extends RowDataPacket {
  contract_id: string | number;
  negotiation_id: string | number;
  seller_client_id: string | number | null;
  buyer_client_id: string | number | null;
  seller_cpf: string | null;
  buyer_cpf: string | null;
  selling_broker_id: string | number | null;
  responsible_count: string | number | null;
  selling_broker_is_assignable: string | number | null;
}

const LEGACY_CONTRACT_AUDIT_SQL = `
  SELECT
    c.id AS contract_id,
    c.negotiation_id,
    n.seller_client_id,
    n.buyer_client_id,
    n.selling_broker_id,
    COALESCE(NULLIF(TRIM(seller_client_user.cpf), ''), NULLIF(TRIM(owner_user.cpf), '')) AS seller_cpf,
    COALESCE(NULLIF(TRIM(n.client_cpf), ''), NULLIF(TRIM(buyer_user.cpf), '')) AS buyer_cpf,
    COALESCE(responsibles.responsible_count, 0) AS responsible_count,
    CASE
      WHEN selling_broker.id IS NOT NULL
        AND selling_broker_user.id IS NOT NULL
        AND selling_broker.status = 'approved'
        AND COALESCE(selling_broker.profile_type, 'BROKER')
          IN ('BROKER', 'AUXILIARY_ADMINISTRATIVE')
      THEN 1
      ELSE 0
    END AS selling_broker_is_assignable
  FROM contracts c
  JOIN negotiations n ON n.id = c.negotiation_id
  LEFT JOIN properties p ON p.id = c.property_id
  LEFT JOIN users seller_client_user ON seller_client_user.id = n.seller_client_id
  LEFT JOIN users owner_user ON owner_user.id = p.owner_id
  LEFT JOIN users buyer_user ON buyer_user.id = n.buyer_client_id
  LEFT JOIN users selling_broker_user ON selling_broker_user.id = n.selling_broker_id
  LEFT JOIN brokers selling_broker ON selling_broker.id = n.selling_broker_id
  LEFT JOIN (
    SELECT negotiation_id, COUNT(DISTINCT user_id) AS responsible_count
    FROM negotiation_responsibles
    GROUP BY negotiation_id
  ) responsibles ON responsibles.negotiation_id = n.id
  ORDER BY c.id ASC
`;

const LOCKED_CONTRACT_SQL = `
  SELECT
    c.id AS contract_id,
    c.negotiation_id,
    n.seller_client_id,
    n.buyer_client_id,
    n.selling_broker_id,
    COALESCE(NULLIF(TRIM(seller_client_user.cpf), ''), NULLIF(TRIM(owner_user.cpf), '')) AS seller_cpf,
    COALESCE(NULLIF(TRIM(n.client_cpf), ''), NULLIF(TRIM(buyer_user.cpf), '')) AS buyer_cpf,
    CASE
      WHEN selling_broker.id IS NOT NULL
        AND selling_broker_user.id IS NOT NULL
        AND selling_broker.status = 'approved'
        AND COALESCE(selling_broker.profile_type, 'BROKER')
          IN ('BROKER', 'AUXILIARY_ADMINISTRATIVE')
      THEN 1
      ELSE 0
    END AS selling_broker_is_assignable
  FROM contracts c
  JOIN negotiations n ON n.id = c.negotiation_id
  LEFT JOIN properties p ON p.id = c.property_id
  LEFT JOIN users seller_client_user ON seller_client_user.id = n.seller_client_id
  LEFT JOIN users owner_user ON owner_user.id = p.owner_id
  LEFT JOIN users buyer_user ON buyer_user.id = n.buyer_client_id
  LEFT JOIN users selling_broker_user ON selling_broker_user.id = n.selling_broker_id
  LEFT JOIN brokers selling_broker ON selling_broker.id = n.selling_broker_id
  WHERE c.id = ?
  LIMIT 1
  FOR UPDATE
`;

function toNullableId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

function isTruthyDatabaseFlag(value: unknown): boolean {
  return Number(value ?? 0) === 1;
}

function normalizeComparableCpf(value: unknown): string | null {
  const cpf = normalizeCpfDigits(String(value ?? ''));
  return cpf.length === 11 ? cpf : null;
}

function getIdentityFinding(row: LegacyContractAuditRow): LegacyContractIdentityFinding | null {
  const sellerClientId = toNullableId(row.seller_client_id);
  const buyerClientId = toNullableId(row.buyer_client_id);
  const sellerCpf = normalizeComparableCpf(row.seller_cpf);
  const buyerCpf = normalizeComparableCpf(row.buyer_cpf);
  const sameUserId = sellerClientId !== null && sellerClientId === buyerClientId;
  const sameCpf = sellerCpf !== null && sellerCpf === buyerCpf;

  if (!sameUserId && !sameCpf) return null;

  return {
    contractId: String(row.contract_id),
    negotiationId: String(row.negotiation_id),
    sellerClientId,
    buyerClientId,
    sameUserId,
    sameCpf,
  };
}

function getManualReviewReason(row: LegacyContractAuditRow): LegacyContractManualReviewReason {
  return toNullableId(row.selling_broker_id) === null
    ? 'MISSING_SELLING_BROKER'
    : 'INVALID_SELLING_BROKER';
}

function toCandidate(row: LegacyContractAuditRow): LegacyContractResponsibleCandidate {
  return {
    contractId: String(row.contract_id),
    negotiationId: String(row.negotiation_id),
    sellingBrokerId: String(row.selling_broker_id),
  };
}

async function assertNegotiationResponsiblesTableExists(db: LegacyContractAuditDb): Promise<void> {
  const [rows] = await db.query(
    `
      SELECT 1 AS table_exists
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'negotiation_responsibles'
      LIMIT 1
    `,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      'A tabela negotiation_responsibles nao existe. Execute as migracoes antes da auditoria legada.',
    );
  }
}

async function applyResponsibleBackfill(
  db: LegacyContractAuditDb,
  candidate: LegacyContractResponsibleCandidate,
): Promise<{ applied?: LegacyContractResponsibleCandidate; skipped?: LegacyContractBackfillSkip }> {
  const tx = await db.getConnection();

  try {
    await tx.beginTransaction();
    const [lockedRows] = await tx.query(LOCKED_CONTRACT_SQL, [candidate.contractId]);
    const lockedContract = Array.isArray(lockedRows)
      ? (lockedRows[0] as LegacyContractAuditRow | undefined)
      : undefined;

    if (!lockedContract) {
      await tx.commit();
      return {
        skipped: {
          contractId: candidate.contractId,
          negotiationId: candidate.negotiationId,
          reason: 'INVALID_SELLING_BROKER',
        },
      };
    }

    const identityFinding = getIdentityFinding(lockedContract);
    if (identityFinding) {
      await tx.commit();
      return {
        skipped: {
          contractId: candidate.contractId,
          negotiationId: candidate.negotiationId,
          reason: 'DUAL_PARTICIPANT_IDENTITY',
        },
      };
    }

    const currentSellingBrokerId = toNullableId(lockedContract.selling_broker_id);
    if (!currentSellingBrokerId) {
      await tx.commit();
      return {
        skipped: {
          contractId: candidate.contractId,
          negotiationId: candidate.negotiationId,
          reason: 'MISSING_SELLING_BROKER',
        },
      };
    }

    if (!isTruthyDatabaseFlag(lockedContract.selling_broker_is_assignable)) {
      await tx.commit();
      return {
        skipped: {
          contractId: candidate.contractId,
          negotiationId: candidate.negotiationId,
          reason: 'INVALID_SELLING_BROKER',
        },
      };
    }

    // The indexed locking read prevents a concurrent panel assignment from being overwritten.
    const [existingResponsibleRows] = await tx.query(
      'SELECT id FROM negotiation_responsibles WHERE negotiation_id = ? FOR UPDATE',
      [lockedContract.negotiation_id],
    );
    if (Array.isArray(existingResponsibleRows) && existingResponsibleRows.length > 0) {
      await tx.commit();
      return {
        skipped: {
          contractId: candidate.contractId,
          negotiationId: candidate.negotiationId,
          reason: 'RESPONSIBLE_ALREADY_ASSIGNED',
        },
      };
    }

    await tx.query(
      `
        INSERT INTO negotiation_responsibles (negotiation_id, user_id, assigned_by)
        VALUES (?, ?, NULL)
      `,
      [lockedContract.negotiation_id, currentSellingBrokerId],
    );
    await tx.commit();

    return {
      applied: {
        contractId: String(lockedContract.contract_id),
        negotiationId: String(lockedContract.negotiation_id),
        sellingBrokerId: currentSellingBrokerId,
      },
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

export async function auditLegacyContracts(
  db: LegacyContractAuditDb,
  options: { apply?: boolean } = {},
): Promise<LegacyContractAuditReport> {
  await assertNegotiationResponsiblesTableExists(db);
  const [rows] = await db.query(LEGACY_CONTRACT_AUDIT_SQL);
  const contractRows = Array.isArray(rows) ? (rows as LegacyContractAuditRow[]) : [];
  const dualParticipantIdentityContracts: LegacyContractIdentityFinding[] = [];
  const eligibleResponsibleBackfills: LegacyContractResponsibleCandidate[] = [];
  const manualReviewContracts: LegacyContractManualReviewFinding[] = [];
  let contractsWithResponsible = 0;

  for (const row of contractRows) {
    const identityFinding = getIdentityFinding(row);
    const hasResponsible = Number(row.responsible_count ?? 0) > 0;
    if (hasResponsible) contractsWithResponsible += 1;

    if (identityFinding) {
      dualParticipantIdentityContracts.push(identityFinding);
      manualReviewContracts.push({
        contractId: identityFinding.contractId,
        negotiationId: identityFinding.negotiationId,
        reasons: ['DUAL_PARTICIPANT_IDENTITY'],
        sellingBrokerId: toNullableId(row.selling_broker_id),
      });
      continue;
    }

    if (hasResponsible) continue;

    if (isTruthyDatabaseFlag(row.selling_broker_is_assignable)) {
      eligibleResponsibleBackfills.push(toCandidate(row));
      continue;
    }

    manualReviewContracts.push({
      contractId: String(row.contract_id),
      negotiationId: String(row.negotiation_id),
      reasons: [getManualReviewReason(row)],
      sellingBrokerId: toNullableId(row.selling_broker_id),
    });
  }

  const appliedResponsibleBackfills: LegacyContractResponsibleCandidate[] = [];
  const skippedResponsibleBackfills: LegacyContractBackfillSkip[] = [];
  if (options.apply) {
    for (const candidate of eligibleResponsibleBackfills) {
      const result = await applyResponsibleBackfill(db, candidate);
      if (result.applied) appliedResponsibleBackfills.push(result.applied);
      if (result.skipped) skippedResponsibleBackfills.push(result.skipped);
    }
  }

  return {
    version: 1,
    mode: options.apply ? 'apply' : 'audit',
    generatedAt: new Date().toISOString(),
    summary: {
      totalContractsScanned: contractRows.length,
      contractsWithResponsible,
      dualParticipantIdentity: dualParticipantIdentityContracts.length,
      eligibleResponsibleBackfills: eligibleResponsibleBackfills.length,
      manualReviewRequired: manualReviewContracts.length,
      responsibleBackfillsInserted: appliedResponsibleBackfills.length,
      responsibleBackfillsSkipped: skippedResponsibleBackfills.length,
    },
    dualParticipantIdentityContracts,
    eligibleResponsibleBackfills,
    manualReviewContracts,
    appliedResponsibleBackfills,
    skippedResponsibleBackfills,
  };
}
