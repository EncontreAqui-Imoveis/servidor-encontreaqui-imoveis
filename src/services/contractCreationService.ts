import { RowDataPacket } from 'mysql2';
import type { AuthRequest } from '../middlewares/auth';
import { getContractDbConnection } from './contractPersistenceService';
import type { ContractRow } from '../controllers/ContractController';

type CreatedContractResult = {
  contract: ContractRow;
  created: boolean;
};

class ContractCreationError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function contractCreationError(statusCode: number, message: string) {
  return new ContractCreationError(statusCode, message);
}

function normalizePositiveId(value: unknown): number | null {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
): Promise<CreatedContractResult> {
  const negotiationId = String(negotiationIdInput ?? '').trim();
  if (!negotiationId) {
    throw contractCreationError(400, 'ID da negociação inválido.');
  }

  const tx = await getContractDbConnection();
  try {
    await tx.beginTransaction();

    const [negotiationRows] = await tx.query<Array<RowDataPacket & {
      id: string;
      property_id: number;
      status: string;
      capturing_broker_id: number | null;
      selling_broker_id: number | null;
      proposer_id: number | null;
      advertiser_id: number | null;
      client_name: string | null;
      buyer_legal_cpf: string | null;
      property_title: string | null;
      property_owner_name: string | null;
      property_owner_phone: string | null;
      property_owner_cpf: string | null;
    }>>(
      `
        SELECT
          n.id,
          n.property_id,
          n.status,
          n.capturing_broker_id,
          n.selling_broker_id,
          n.proposer_id,
          n.advertiser_id,
          n.client_name,
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.clientCpf')) AS buyer_legal_cpf,
          p.title AS property_title,
          COALESCE(owner_user.name, p.owner_name) AS property_owner_name,
          p.owner_phone AS property_owner_phone,
          owner_user.cpf AS property_owner_cpf
        FROM negotiations n
        JOIN properties p ON p.id = n.property_id
        LEFT JOIN users owner_user ON owner_user.id = p.owner_id
        WHERE n.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [negotiationId],
    );

    const negotiation = negotiationRows[0];
    if (!negotiation) {
      await tx.rollback();
      throw contractCreationError(404, 'Negociação não encontrada.');
    }

    const proposalInitiatorUserId = normalizePositiveId(negotiation.proposer_id);

    const [existingRows] = await tx.query<Array<RowDataPacket & ContractRow>>(
      `
        SELECT
          c.id,
          c.negotiation_id,
          c.property_id,
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
      await tx.commit();
      return { contract: existingRows[0], created: false };
    }

    const negotiationStatus = String(negotiation.status ?? '').toUpperCase();
    if (!ALLOWED_NEGOTIATION_STATUSES_FOR_CONTRACT.has(negotiationStatus)) {
      await tx.rollback();
      throw contractCreationError(400, 'A negociação precisa estar aprovada antes da criação do contrato.');
    }

    await tx.query(
      `
        INSERT INTO contracts (
          id,
          negotiation_id,
          property_id,
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
          'AWAITING_DOCS',
          CAST(JSON_OBJECT('nome', ?, 'cpf', ?, 'telefone', ?) AS JSON),
          CAST(JSON_OBJECT('nome', ?, 'cpf', ?) AS JSON),
          NULL,
          'PENDING',
          'PENDING',
          NULL,
          NULL,
          CAST(JSON_OBJECT('proposalInitiatorUserId', ?) AS JSON),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `,
      [
        negotiationId,
        negotiation.property_id,
        negotiation.property_owner_name,
        negotiation.property_owner_cpf,
        negotiation.property_owner_phone,
        negotiation.client_name,
        negotiation.buyer_legal_cpf,
        proposalInitiatorUserId,
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

    await tx.commit();
    if (!createdRows[0]) {
      throw contractCreationError(500, 'Falha ao criar contrato.');
    }
    return { contract: createdRows[0], created: true };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

export function isContractCreationError(error: unknown): error is ContractCreationError {
  return error instanceof ContractCreationError;
}
