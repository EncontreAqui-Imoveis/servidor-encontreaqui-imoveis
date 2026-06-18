import { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import { deleteCloudinaryAsset } from '../config/cloudinary';
import {
  getContractDbConnection,
} from './contractPersistenceService';
import { enqueueNegotiationDocumentDeletion } from './negotiationDocumentDeletionService';
import {
  isContractStatus,
  type ContractStatus,
} from '../modules/contracts/domain/contract.types';

export interface ContractWorkflowRow extends RowDataPacket {
  id: string;
  negotiation_id: string;
  status: string;
  workflow_metadata: unknown;
  seller_approval_status: string;
  buyer_approval_status: string;
}

export type LoadContractForUpdate = (
  tx: PoolConnection,
  contractId: string
) => Promise<ContractWorkflowRow | null>;

type ContractDocumentForDeleteRow = RowDataPacket & {
  id: number | string;
  type: string | null;
  document_type: string | null;
  metadata_json: unknown;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
};

type ContractWorkflowTransitionInput = {
  contractIdInput: unknown;
  directionInput: unknown;
  loadContractForUpdate: LoadContractForUpdate;
};

type ContractWorkflowTransitionResult = {
  message: string;
  contract: ContractWorkflowRow | null;
};

class ContractWorkflowError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function contractWorkflowError(statusCode: number, message: string): ContractWorkflowError {
  return new ContractWorkflowError(statusCode, message);
}

export function isContractWorkflowError(error: unknown): error is ContractWorkflowError {
  return error instanceof ContractWorkflowError;
}

const CONTRACT_STATUS_FLOW: ContractStatus[] = [
  'AWAITING_DOCS',
  'IN_DRAFT',
  'AWAITING_SIGNATURES',
  'FINALIZED',
];

function parseStoredJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }

  if (typeof value !== 'string') {
    return {};
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}

function readMetadataText(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = String(metadata[key] ?? '').trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function resolveContractStatus(value: unknown): ContractStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  return isContractStatus(normalized) ? normalized : 'AWAITING_DOCS';
}

function toDocumentCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resetWorkflowMetadataForStepBack(value: unknown): Record<string, unknown> | null {
  const metadata = parseStoredJsonObject(value);
  const nextMetadata = { ...metadata };
  const keysToRemove = [
    'signatureMethod',
    'signatureMethodDeclaredAt',
    'signatureMethodDeclaredBy',
    'signatureMethodDeclaredByName',
    'signedContractUploadedOnlineAt',
    'signedContractUploadedOnlineBy',
    'agencySignedContractReceivedAt',
    'agencySignedContractReceivedBy',
  ];

  for (const key of keysToRemove) {
    delete nextMetadata[key];
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
}

function resolveRollbackDocumentTypes(targetStatus: ContractStatus): string[] {
  if (targetStatus === 'IN_DRAFT') {
    return ['contrato_assinado', 'comprovante_pagamento', 'boleto_vistoria', 'outro'];
  }

  if (targetStatus === 'AWAITING_DOCS') {
    return [
      'contrato_minuta',
      'contrato_assinado',
      'comprovante_pagamento',
      'boleto_vistoria',
      'outro',
    ];
  }

  return [];
}

function extractCloudinaryAssetReference(
  document: Pick<ContractDocumentForDeleteRow, 'metadata_json'>
): { publicId: string | null; url: string | null; resourceType: string | null } | null {
  const metadata = parseStoredJsonObject(document.metadata_json);
  const publicId = readMetadataText(metadata, [
    'cloudinaryPublicId',
    'cloudinary_public_id',
    'publicId',
    'public_id',
  ]);
  const url = readMetadataText(metadata, [
    'cloudinaryUrl',
    'cloudinary_url',
    'secureUrl',
    'secure_url',
    'fileUrl',
    'file_url',
    'url',
  ]);
  const resourceType = readMetadataText(metadata, [
    'cloudinaryResourceType',
    'cloudinary_resource_type',
    'resourceType',
    'resource_type',
  ]);

  if (!publicId && !url) {
    return null;
  }

  return {
    publicId,
    url,
    resourceType,
  };
}

async function fetchDocumentsForStepBackCleanup(
  tx: PoolConnection,
  contract: Pick<ContractWorkflowRow, 'id' | 'negotiation_id'>,
  targetStatus: ContractStatus
): Promise<ContractDocumentForDeleteRow[]> {
  const documentTypes = resolveRollbackDocumentTypes(targetStatus);
  if (documentTypes.length === 0) {
    return [];
  }

  const placeholders = documentTypes.map(() => '?').join(', ');
  const [rows] = await tx.query<ContractDocumentForDeleteRow[]>(
    `
      SELECT
        id,
        type,
        document_type,
        metadata_json,
        storage_provider,
        storage_bucket,
        storage_key
      FROM negotiation_documents
      WHERE negotiation_id = ?
        AND COALESCE(document_type, '') IN (${placeholders})
        AND COALESCE(type, '') <> 'proposal'
        AND (
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
          OR (
            JSON_EXTRACT(metadata_json, '$.contractId') IS NULL
            AND COALESCE(document_type, '') <> 'outro'
          )
        )
      ORDER BY id DESC
    `,
    [contract.negotiation_id, ...documentTypes, contract.id]
  );

  return rows;
}

async function fetchContractDocumentGateCounts(
  tx: PoolConnection,
  contract: Pick<ContractWorkflowRow, 'id' | 'negotiation_id'>
): Promise<{
  draftTotal: number;
  signedContractTotal: number;
  paymentReceiptTotal: number;
  inspectionBoletoTotal: number;
}> {
  const [rows] = await tx.query<RowDataPacket[]>(
    `
      SELECT
        SUM(
          CASE
            WHEN document_type = 'contrato_minuta'
              AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
              AND UPPER(
                COALESCE(
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
                  'APPROVED'
                )
              ) <> 'REJECTED'
            THEN 1 ELSE 0
          END
        ) AS draft_total,
        SUM(
          CASE
            WHEN document_type = 'contrato_assinado'
              AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
              AND UPPER(
                COALESCE(
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
                  'APPROVED'
                )
              ) <> 'REJECTED'
            THEN 1 ELSE 0
          END
        ) AS signed_contract_total,
        SUM(
          CASE
            WHEN document_type = 'comprovante_pagamento'
              AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
              AND UPPER(
                COALESCE(
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
                  'APPROVED'
                )
              ) <> 'REJECTED'
            THEN 1 ELSE 0
          END
        ) AS payment_receipt_total,
        SUM(
          CASE
            WHEN document_type = 'boleto_vistoria'
              AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
              AND UPPER(
                COALESCE(
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
                  'APPROVED'
                )
              ) <> 'REJECTED'
            THEN 1 ELSE 0
          END
        ) AS inspection_boleto_total
      FROM negotiation_documents
      WHERE negotiation_id = ?
    `,
    [
      contract.id,
      contract.id,
      contract.id,
      contract.id,
      contract.negotiation_id,
    ]
  );

  const row = rows[0] ?? {};
  return {
    draftTotal: toDocumentCount(row.draft_total),
    signedContractTotal: toDocumentCount(row.signed_contract_total),
    paymentReceiptTotal: toDocumentCount(row.payment_receipt_total),
    inspectionBoletoTotal: toDocumentCount(row.inspection_boleto_total),
  };
}

async function cleanupContractDocumentAssets(
  documents: ContractDocumentForDeleteRow[],
  context: {
    action: string;
    contractId: string;
    negotiationId: string;
  }
): Promise<void> {
  const cleanupTx = await getContractDbConnection();
  try {
    await cleanupTx.beginTransaction();
    for (const document of documents) {
      const hasNegotiationObject =
        String(document.storage_provider ?? '').trim().toUpperCase() === 'R2' &&
        String(document.storage_bucket ?? '').trim().length > 0 &&
        String(document.storage_key ?? '').trim().length > 0;
      const assetReference = extractCloudinaryAssetReference(document);

      if (hasNegotiationObject) {
        try {
          await enqueueNegotiationDocumentDeletion(cleanupTx, document, {
            negotiationId: context.negotiationId,
            requestSource: 'contract_step_back_cleanup',
          });
        } catch (error) {
          console.error('Falha ao excluir objeto R2 do documento do contrato:', {
            action: context.action,
            contractId: context.contractId,
            negotiationId: context.negotiationId,
            documentId: Number(document.id ?? 0),
            documentType: document.document_type ?? null,
            storageKey: String(document.storage_key ?? ''),
            error,
          });
        }
      }

      if (assetReference) {
        try {
          await deleteCloudinaryAsset({
            publicId: assetReference.publicId,
            url: assetReference.url,
            resourceType: assetReference.resourceType,
            invalidate: true,
          });
        } catch (error) {
          console.error('Falha ao excluir asset externo do documento do contrato:', {
            action: context.action,
            contractId: context.contractId,
            negotiationId: context.negotiationId,
            documentId: Number(document.id ?? 0),
            documentType: document.document_type ?? null,
            error,
          });
        }
      }
    }
    await cleanupTx.commit();
  } catch (error) {
    await cleanupTx.rollback();
    throw error;
  } finally {
    cleanupTx.release();
  }
}

function buildTransitionMessage(direction: 'next' | 'previous', nextStatus: ContractStatus): string {
  if (direction === 'previous' && nextStatus === 'AWAITING_DOCS') {
    return 'Contrato atualizado para a aba de documentos pendentes.';
  }

  if (direction === 'previous' && nextStatus === 'IN_DRAFT') {
    return 'Contrato atualizado para a aba de confecção da minuta.';
  }

  return `Contrato atualizado para ${nextStatus}.`;
}

export async function transitionContractStatus(
  input: ContractWorkflowTransitionInput
): Promise<ContractWorkflowTransitionResult> {
  const contractId = String(input.contractIdInput ?? '').trim();
  if (!contractId) {
    throw contractWorkflowError(400, 'ID do contrato inválido.');
  }

  const direction = String(input.directionInput ?? '').trim().toLowerCase();
  if (direction !== 'next' && direction !== 'previous') {
    throw contractWorkflowError(400, 'Direção inválida. Use next ou previous.');
  }

  const tx = await getContractDbConnection();
  try {
    await tx.beginTransaction();

    const contract = await input.loadContractForUpdate(tx, contractId);
    if (!contract) {
      await tx.rollback();
      throw contractWorkflowError(404, 'Contrato não encontrado.');
    }

    const currentStatus = resolveContractStatus(contract.status);
    const currentIndex = CONTRACT_STATUS_FLOW.indexOf(currentStatus);
    if (currentIndex < 0) {
      await tx.rollback();
      throw contractWorkflowError(400, 'Status atual do contrato inválido.');
    }

    if (currentStatus === 'FINALIZED' && direction === 'previous') {
      await tx.rollback();
      throw contractWorkflowError(
        400,
        'Retrocesso de contratos finalizados está bloqueado por segurança financeira.'
      );
    }

    if (currentStatus === 'AWAITING_DOCS' && direction === 'next') {
      await tx.rollback();
      throw contractWorkflowError(
        400,
        'Use a avaliação por lado para avançar de AWAITING_DOCS para IN_DRAFT.'
      );
    }

    const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (targetIndex < 0 || targetIndex >= CONTRACT_STATUS_FLOW.length) {
      await tx.rollback();
      throw contractWorkflowError(
        400,
        direction === 'next'
          ? 'Contrato já está na etapa final.'
          : 'Contrato já está na primeira etapa.'
      );
    }

    const nextStatus = CONTRACT_STATUS_FLOW[targetIndex];
    const documentsToCleanup =
      direction === 'previous'
        ? await fetchDocumentsForStepBackCleanup(tx, contract, nextStatus)
        : [];

    if (nextStatus === 'FINALIZED') {
      await tx.rollback();
      throw contractWorkflowError(
        400,
        'Use o endpoint de finalização para concluir o contrato com validações obrigatórias.'
      );
    }

    if (nextStatus === 'AWAITING_SIGNATURES') {
      const documentCounts = await fetchContractDocumentGateCounts(tx, contract);
      if (documentCounts.draftTotal <= 0) {
        await tx.rollback();
        throw contractWorkflowError(
          400,
          'Transição bloqueada: anexe uma minuta válida (contrato_minuta) vinculada a este contrato antes de avançar.'
        );
      }
    }

    await tx.query(
      `
        UPDATE contracts
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [nextStatus, contractId]
    );

    if (direction === 'previous' && nextStatus === 'AWAITING_DOCS') {
      await tx.query(
        `
          UPDATE contracts
          SET
            seller_approval_status = 'PENDING',
            buyer_approval_status = 'PENDING',
            seller_approval_reason = NULL,
            buyer_approval_reason = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [contractId]
      );
    }

    if (direction === 'previous' && documentsToCleanup.length > 0) {
      const placeholders = documentsToCleanup.map(() => '?').join(', ');
      await tx.query(
        `
          DELETE FROM negotiation_documents
          WHERE id IN (${placeholders})
        `,
        documentsToCleanup.map((document) => Number(document.id))
      );
    }

    if (direction === 'previous') {
      const nextWorkflowMetadata = resetWorkflowMetadataForStepBack(
        contract.workflow_metadata
      );

      if (nextWorkflowMetadata) {
        await tx.query(
          `
            UPDATE contracts
            SET workflow_metadata = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [JSON.stringify(nextWorkflowMetadata), contractId]
        );
      } else {
        await tx.query(
          `
            UPDATE contracts
            SET workflow_metadata = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [contractId]
        );
      }
    }

    const updated = await input.loadContractForUpdate(tx, contractId);
    await tx.commit();

    if (direction === 'previous' && documentsToCleanup.length > 0) {
      await cleanupContractDocumentAssets(documentsToCleanup, {
        action: 'contract_step_back_cleanup',
        contractId,
        negotiationId: contract.negotiation_id,
      });
    }

    return {
      message: buildTransitionMessage(direction, nextStatus),
      contract: updated,
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}
