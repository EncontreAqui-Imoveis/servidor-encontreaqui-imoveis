import { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import type { AuthRequest } from '../middlewares/auth';
import { getContractDbConnection } from './contractPersistenceService';
import type { ContractRow } from '../controllers/ContractController';
import {
  resolveContractParties,
  type ContractInitiatorSide,
} from './contractPartyResolutionService';
import {
  createBuyerHandshake,
  shouldCreateBuyerHandshake,
} from './contractBuyerHandshakeService';
import {
  isContractDealType,
  type ContractDealType,
} from '../modules/contracts/domain/contract.types';
import {
  hydrateCpfFieldsInJson,
  protectCpfFieldsInJson,
  resolveStoredCpf,
} from '../security/personalDataProtection';

type CreatedContractResult = {
  contract: ContractRow;
  created: boolean;
  /** Returned only to the admin creation flow; never persisted in plain text. */
  handshakePin: string | null;
};

class ContractCreationError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, message: string, code = 'CONTRACT_CREATION_FAILED') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function contractCreationError(statusCode: number, message: string, code?: string) {
  return new ContractCreationError(statusCode, message, code);
}

function normalizePositiveId(value: unknown): number | null {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveApprovedNegotiationDealType(value: unknown): ContractDealType | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return isContractDealType(normalized) ? normalized : null;
}

function parseStoredPaymentDetails(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

const ALLOWED_NEGOTIATION_STATUSES_FOR_CONTRACT = new Set([
  'IN_NEGOTIATION',
  'DOCUMENTATION_PHASE',
  'CONTRACT_DRAFTING',
  'AWAITING_SIGNATURES',
]);

export async function createContractFromApprovedNegotiation(
  negotiationIdInput: unknown,
  req: AuthRequest | null = null,
  transaction?: PoolConnection,
): Promise<CreatedContractResult> {
  const negotiationId = String(negotiationIdInput ?? '').trim();
  if (!negotiationId) {
    throw contractCreationError(400, 'ID da negociação inválido.');
  }

  // Administrative approval can pass its locked transaction so the status
  // transition and the canonical contract creation are committed atomically.
  const tx = transaction ?? await getContractDbConnection();
  const managesTransaction = transaction == null;
  try {
    if (managesTransaction) {
      await tx.beginTransaction();
    }

    const [negotiationRows] = await tx.query<Array<RowDataPacket & {
      id: string;
      property_id: number;
      deal_type: string | null;
      status: string;
      capturing_broker_id: number | null;
      selling_broker_id: number | null;
      proposer_id: number | null;
      advertiser_id: number | null;
      initiator_side: ContractInitiatorSide;
      legal_buyer_user_id: number | null;
      handshake_pin: string | null;
      handshake_status: 'PENDING' | 'VERIFIED' | 'REJECTED' | null;
      handshake_attempts: number | null;
      client_name: string | null;
      payment_details: unknown;
      buyer_legal_cpf: string | null;
      buyer_legal_email: string | null;
      property_title: string | null;
      property_owner_name: string | null;
      property_owner_phone: string | null;
      property_owner_cpf: string | null;
      property_owner_cpf_ciphertext: string | null;
      property_broker_id: number | null;
      proposer_user_id: number | null;
      proposer_user_name: string | null;
      proposer_user_email: string | null;
      proposer_user_cpf: string | null;
      proposer_user_cpf_ciphertext: string | null;
      proposer_user_phone: string | null;
      owner_user_id: number | null;
      owner_user_name: string | null;
      owner_user_email: string | null;
      owner_user_cpf: string | null;
      owner_user_cpf_ciphertext: string | null;
      owner_user_phone: string | null;
      legal_buyer_user_id_resolved: number | null;
      legal_buyer_user_name: string | null;
      legal_buyer_user_email: string | null;
      legal_buyer_user_cpf: string | null;
      legal_buyer_user_cpf_ciphertext: string | null;
      legal_buyer_user_phone: string | null;
    }>>(
      `
        SELECT
          n.id,
          n.property_id,
          n.deal_type,
          n.status,
          n.capturing_broker_id,
          n.selling_broker_id,
          n.proposer_id,
          n.advertiser_id,
          n.initiator_side,
          n.legal_buyer_user_id,
          n.handshake_pin,
          n.handshake_status,
          n.handshake_attempts,
          n.client_name,
          n.payment_details,
          NULL AS buyer_legal_cpf,
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.clientEmail')) AS buyer_legal_email,
          p.title AS property_title,
          COALESCE(owner_user.name, p.owner_name) AS property_owner_name,
          p.owner_phone AS property_owner_phone,
          owner_user.cpf AS property_owner_cpf,
          owner_user.cpf_ciphertext AS property_owner_cpf_ciphertext,
          p.broker_id AS property_broker_id,
          proposer_user.id AS proposer_user_id,
          proposer_user.name AS proposer_user_name,
          proposer_user.email AS proposer_user_email,
          proposer_user.cpf AS proposer_user_cpf,
          proposer_user.cpf_ciphertext AS proposer_user_cpf_ciphertext,
          proposer_user.phone AS proposer_user_phone,
          owner_user.id AS owner_user_id,
          owner_user.name AS owner_user_name,
          owner_user.email AS owner_user_email,
          owner_user.cpf AS owner_user_cpf,
          owner_user.cpf_ciphertext AS owner_user_cpf_ciphertext,
          owner_user.phone AS owner_user_phone,
          COALESCE(linked_buyer_user.id, email_buyer_user.id) AS legal_buyer_user_id_resolved,
          COALESCE(linked_buyer_user.name, email_buyer_user.name) AS legal_buyer_user_name,
          COALESCE(linked_buyer_user.email, email_buyer_user.email) AS legal_buyer_user_email,
          COALESCE(linked_buyer_user.cpf, email_buyer_user.cpf) AS legal_buyer_user_cpf,
          COALESCE(linked_buyer_user.cpf_ciphertext, email_buyer_user.cpf_ciphertext) AS legal_buyer_user_cpf_ciphertext,
          COALESCE(linked_buyer_user.phone, email_buyer_user.phone) AS legal_buyer_user_phone
        FROM negotiations n
        JOIN properties p ON p.id = n.property_id
        LEFT JOIN users owner_user ON owner_user.id = p.owner_id
        LEFT JOIN users proposer_user ON proposer_user.id = n.proposer_id
        LEFT JOIN users linked_buyer_user
          ON linked_buyer_user.id = n.legal_buyer_user_id
          AND linked_buyer_user.email_verified_at IS NOT NULL
        LEFT JOIN users email_buyer_user
          ON n.legal_buyer_user_id IS NULL
          AND email_buyer_user.email_verified_at IS NOT NULL
          AND LOWER(TRIM(email_buyer_user.email)) = LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.clientEmail'))))
        WHERE n.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [negotiationId],
    );

    const negotiation = negotiationRows[0];
    if (!negotiation) {
      throw contractCreationError(404, 'Negociação não encontrada.');
    }
    const protectedPaymentDetails = hydrateCpfFieldsInJson(
      parseStoredPaymentDetails(negotiation.payment_details),
      'negotiations:payment_details',
    ) as { details?: { clientCpf?: string | null } };
    negotiation.buyer_legal_cpf = protectedPaymentDetails.details?.clientCpf ?? null;
    negotiation.property_owner_cpf = resolveStoredCpf(
      negotiation.property_owner_cpf_ciphertext,
      negotiation.property_owner_cpf,
      'users:cpf',
    );
    negotiation.proposer_user_cpf = resolveStoredCpf(
      negotiation.proposer_user_cpf_ciphertext,
      negotiation.proposer_user_cpf,
      'users:cpf',
    );
    negotiation.owner_user_cpf = resolveStoredCpf(
      negotiation.owner_user_cpf_ciphertext,
      negotiation.owner_user_cpf,
      'users:cpf',
    );
    negotiation.legal_buyer_user_cpf = resolveStoredCpf(
      negotiation.legal_buyer_user_cpf_ciphertext,
      negotiation.legal_buyer_user_cpf,
      'users:cpf',
    );

    if (
      normalizePositiveId(negotiation.advertiser_id) === null &&
      normalizePositiveId(negotiation.owner_user_id) === null
    ) {
      throw contractCreationError(
        422,
        'A negociação não possui anunciante ou proprietário vinculado para o lado vendedor.',
        'CONTRACT_SELLER_ACTOR_MISSING'
      );
    }

    const proposalInitiatorUserId = normalizePositiveId(negotiation.proposer_id);

    const partyResolution = resolveContractParties({
      negotiation: {
        initiatorSide: negotiation.initiator_side,
        proposerId: normalizePositiveId(negotiation.proposer_id),
        advertiserId: normalizePositiveId(negotiation.advertiser_id),
        legalBuyerUserId: normalizePositiveId(negotiation.legal_buyer_user_id_resolved),
        buyerName: negotiation.client_name,
        buyerCpf: negotiation.buyer_legal_cpf,
        buyerEmail: negotiation.buyer_legal_email,
      },
      property: {
        ownerId: normalizePositiveId(negotiation.owner_user_id),
        ownerName: negotiation.property_owner_name,
        ownerPhone: negotiation.property_owner_phone,
      },
      relatedUsers: {
        proposer: negotiation.proposer_user_id
          ? {
              id: negotiation.proposer_user_id,
              name: negotiation.proposer_user_name,
              email: negotiation.proposer_user_email,
              cpf: negotiation.proposer_user_cpf,
              phone: negotiation.proposer_user_phone,
            }
          : null,
        owner: negotiation.owner_user_id
          ? {
              id: negotiation.owner_user_id,
              name: negotiation.owner_user_name,
              email: negotiation.owner_user_email,
              cpf: negotiation.owner_user_cpf,
              phone: negotiation.owner_user_phone,
            }
          : null,
        legalBuyer: negotiation.legal_buyer_user_id_resolved
          ? {
              id: negotiation.legal_buyer_user_id_resolved,
              name: negotiation.legal_buyer_user_name,
              email: negotiation.legal_buyer_user_email,
              cpf: negotiation.legal_buyer_user_cpf,
              phone: negotiation.legal_buyer_user_phone,
            }
          : null,
      },
    });
    const shouldPersistLegalBuyerLink =
      partyResolution.legalBuyerUserId !== null &&
      partyResolution.legalBuyerUserId !== normalizePositiveId(negotiation.legal_buyer_user_id);

    const [existingRows] = await tx.query<Array<RowDataPacket & ContractRow>>(
      `
        SELECT
          c.id,
          c.negotiation_id,
          c.property_id,
          c.deal_type,
          c.status,
          c.seller_info,
          c.buyer_info,
          c.commission_data,
          c.workflow_metadata,
          COALESCE(
            CAST(
              NULLIF(
                JSON_UNQUOTE(
                  JSON_EXTRACT(c.workflow_metadata, '$.proposalInitiatorUserId')
                ),
                ''
              ) AS UNSIGNED
            ),
            (
              SELECT MIN(npi.user_id)
              FROM negotiation_proposal_idempotency npi
              WHERE npi.negotiation_id = c.negotiation_id
            )
          ) AS proposal_initiator_user_id,
          c.seller_approval_status,
          c.buyer_approval_status,
          c.seller_approval_reason,
          c.buyer_approval_reason,
          c.created_at,
          c.updated_at,
          n.capturing_broker_id,
          n.selling_broker_id,
          n.advertiser_id,
          n.proposer_id,
          n.initiator_side,
          n.legal_buyer_user_id,
          n.handshake_pin,
          n.handshake_status,
          n.handshake_attempts,
          n.client_name,
          p.title AS property_title,
          p.purpose AS property_purpose,
          p.code AS property_code,
          NULL AS property_image_url,
          p.owner_id AS property_owner_id,
          p.owner_name AS property_owner_name,
          p.owner_phone AS property_owner_phone,
          NULL AS capturing_broker_name,
          NULL AS selling_broker_name,
          NULL AS seller_client_name,
          NULL AS buyer_client_name,
          NULL AS capturing_agency_name,
          NULL AS capturing_agency_address,
          NULL AS responsible_user_ids
        FROM contracts c
        JOIN negotiations n ON n.id = c.negotiation_id
        JOIN properties p ON p.id = c.property_id
        WHERE c.negotiation_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [negotiationId],
    );

    if (existingRows.length > 0) {
      if (shouldPersistLegalBuyerLink) {
        await tx.query(
          `UPDATE negotiations SET legal_buyer_user_id = ? WHERE id = ? AND legal_buyer_user_id IS NULL`,
          [partyResolution.legalBuyerUserId, negotiationId],
        );
      }
      if (managesTransaction) {
        await tx.commit();
      }
      return { contract: existingRows[0], created: false, handshakePin: null };
    }

    const negotiationStatus = String(negotiation.status ?? '').toUpperCase();
    if (!ALLOWED_NEGOTIATION_STATUSES_FOR_CONTRACT.has(negotiationStatus)) {
      throw contractCreationError(400, 'A negociação precisa estar aprovada antes da criação do contrato.');
    }

    const dealType = resolveApprovedNegotiationDealType(negotiation.deal_type);
    if (!dealType) {
      throw contractCreationError(
        422,
        'A negociação aprovada não possui uma modalidade comercial válida.',
        'CONTRACT_DEAL_TYPE_MISSING'
      );
    }

    const buyerHandshake = shouldCreateBuyerHandshake({
      initiatorSide: negotiation.initiator_side,
      legalBuyerUserId: partyResolution.legalBuyerUserId,
    })
      ? createBuyerHandshake()
      : null;

    if (shouldPersistLegalBuyerLink || buyerHandshake) {
      await tx.query(
        `
          UPDATE negotiations
          SET
            legal_buyer_user_id = COALESCE(legal_buyer_user_id, ?),
            handshake_pin = ?,
            handshake_status = ?,
            handshake_attempts = ?
          WHERE id = ?
        `,
        [
          partyResolution.legalBuyerUserId,
          buyerHandshake?.pinHash ?? negotiation.handshake_pin,
          buyerHandshake ? 'PENDING' : negotiation.handshake_status ?? 'PENDING',
          buyerHandshake ? 0 : Number(negotiation.handshake_attempts ?? 0),
          negotiationId,
        ],
      );
    }

    const workflowMetadata = {
      proposalInitiatorUserId,
      dealType,
      ...partyResolution.metadata,
    };

    await tx.query(
      `
        INSERT INTO contracts (
          id,
          negotiation_id,
          property_id,
          deal_type,
          status,
          seller_info,
          buyer_info,
          commission_data,
          seller_approval_status,
          buyer_approval_status,
          seller_approval_reason,
          buyer_approval_reason,
          workflow_metadata,
          created_at,
          updated_at
        ) VALUES (
          UUID(),
          ?,
          ?,
          ?,
          'AWAITING_DOCS',
          CAST(? AS JSON),
          CAST(? AS JSON),
          NULL,
          'PENDING',
          'PENDING',
          NULL,
          NULL,
          CAST(? AS JSON),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `,
      [
        negotiationId,
        negotiation.property_id,
        dealType,
        JSON.stringify(protectCpfFieldsInJson(partyResolution.sellerInfo, 'contracts:seller_info')),
        JSON.stringify(protectCpfFieldsInJson(partyResolution.buyerInfo, 'contracts:buyer_info')),
        JSON.stringify(workflowMetadata),
      ],
    );

    await tx.query(
      `
        UPDATE negotiations
        SET status = 'CONTRACT_DRAFTING', version = COALESCE(version, 0) + 1
        WHERE id = ?
      `,
      [negotiationId],
    );

    const [createdRows] = await tx.query<Array<RowDataPacket & ContractRow>>(
      `
        SELECT
          c.id,
          c.negotiation_id,
          c.property_id,
          c.deal_type,
          c.status,
          c.seller_info,
          c.buyer_info,
          c.commission_data,
          c.workflow_metadata,
          COALESCE(
            CAST(
              NULLIF(
                JSON_UNQUOTE(
                  JSON_EXTRACT(c.workflow_metadata, '$.proposalInitiatorUserId')
                ),
                ''
              ) AS UNSIGNED
            ),
            (
              SELECT MIN(npi.user_id)
              FROM negotiation_proposal_idempotency npi
              WHERE npi.negotiation_id = c.negotiation_id
            )
          ) AS proposal_initiator_user_id,
          c.seller_approval_status,
          c.buyer_approval_status,
          c.seller_approval_reason,
          c.buyer_approval_reason,
          c.created_at,
          c.updated_at,
          n.capturing_broker_id,
          n.selling_broker_id,
          n.advertiser_id,
          n.proposer_id,
          n.initiator_side,
          n.legal_buyer_user_id,
          n.handshake_pin,
          n.handshake_status,
          n.handshake_attempts,
          n.client_name,
          p.title AS property_title,
          p.purpose AS property_purpose,
          p.code AS property_code,
          NULL AS property_image_url,
          p.owner_id AS property_owner_id,
          p.owner_name AS property_owner_name,
          p.owner_phone AS property_owner_phone,
          NULL AS capturing_broker_name,
          NULL AS selling_broker_name,
          NULL AS seller_client_name,
          NULL AS buyer_client_name,
          NULL AS capturing_agency_name,
          NULL AS capturing_agency_address,
          NULL AS responsible_user_ids
        FROM contracts c
        JOIN negotiations n ON n.id = c.negotiation_id
        JOIN properties p ON p.id = c.property_id
        WHERE c.negotiation_id = ?
        LIMIT 1
      `,
      [negotiationId],
    );

    if (!createdRows[0]) {
      throw contractCreationError(500, 'Falha ao criar contrato.');
    }
    if (managesTransaction) {
      await tx.commit();
    }
    return {
      contract: createdRows[0],
      created: true,
      handshakePin: buyerHandshake?.pin ?? null,
    };
  } catch (error) {
    if (managesTransaction) {
      await tx.rollback();
    }
    throw error;
  } finally {
    if (managesTransaction) {
      tx.release();
    }
  }
}

export function isContractCreationError(error: unknown): error is ContractCreationError {
  return error instanceof ContractCreationError;
}
