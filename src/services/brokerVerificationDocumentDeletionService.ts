import type { RowDataPacket } from 'mysql2';

import { deleteCloudinaryAsset } from '../config/cloudinary';
import { InvalidInputError } from '../errors/ApplicationError';
import { adminDb } from './adminPersistenceService';

export const BROKER_DOCUMENT_ASSET_DELETE_FAILED = 'BROKER_DOCUMENT_ASSET_DELETE_FAILED';
export const BROKER_DOCUMENTS_CHANGED_DURING_DELETION =
  'BROKER_DOCUMENTS_CHANGED_DURING_DELETION';

type BrokerDocumentsRow = RowDataPacket & {
  broker_id: number;
  creci_front_url: string | null;
  creci_back_url: string | null;
  selfie_url: string | null;
};

export class BrokerVerificationDocumentDeletionError extends Error {
  readonly code:
    | typeof BROKER_DOCUMENT_ASSET_DELETE_FAILED
    | typeof BROKER_DOCUMENTS_CHANGED_DURING_DELETION;

  constructor(
    code:
      | typeof BROKER_DOCUMENT_ASSET_DELETE_FAILED
      | typeof BROKER_DOCUMENTS_CHANGED_DURING_DELETION,
  ) {
    super('Não foi possível concluir a remoção dos documentos de verificação do corretor.');
    this.name = 'BrokerVerificationDocumentDeletionError';
    this.code = code;
  }
}

export type RemoveBrokerVerificationDocumentsResult = {
  removed: boolean;
};

function normalizeUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasSameDocumentUrls(
  current: BrokerDocumentsRow,
  expected: BrokerDocumentsRow,
): boolean {
  return (
    normalizeUrl(current.creci_front_url) === normalizeUrl(expected.creci_front_url)
    && normalizeUrl(current.creci_back_url) === normalizeUrl(expected.creci_back_url)
    && normalizeUrl(current.selfie_url) === normalizeUrl(expected.selfie_url)
  );
}

/**
 * Removes all Cloudinary verification assets for a broker and then removes its
 * broker_documents row. Broker IDs are also the associated users.id values.
 */
export async function removeBrokerVerificationDocuments(
  brokerIdInput: number,
): Promise<RemoveBrokerVerificationDocumentsResult> {
  const brokerId = Number(brokerIdInput);
  if (!Number.isInteger(brokerId) || brokerId <= 0) {
    throw new InvalidInputError('Identificador de corretor inválido.');
  }

  const [rows] = await adminDb.query<BrokerDocumentsRow[]>(
    `
      SELECT broker_id, creci_front_url, creci_back_url, selfie_url
      FROM broker_documents
      WHERE broker_id = ?
      LIMIT 1
    `,
    [brokerId],
  );
  const documents = rows[0];
  if (!documents) {
    return { removed: false };
  }

  const urls = [
    documents.creci_front_url,
    documents.creci_back_url,
    documents.selfie_url,
  ].map(normalizeUrl);

  try {
    for (const url of urls) {
      if (url) {
        await deleteCloudinaryAsset({ url, invalidate: true });
      }
    }
  } catch {
    throw new BrokerVerificationDocumentDeletionError(
      BROKER_DOCUMENT_ASSET_DELETE_FAILED,
    );
  }

  const db = await adminDb.getConnection();
  try {
    await db.beginTransaction();
    const [currentRows] = await db.query<BrokerDocumentsRow[]>(
      `
        SELECT broker_id, creci_front_url, creci_back_url, selfie_url
        FROM broker_documents
        WHERE broker_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [brokerId],
    );
    const currentDocuments = currentRows[0];

    if (!currentDocuments) {
      await db.commit();
      return { removed: true };
    }

    if (!hasSameDocumentUrls(currentDocuments, documents)) {
      throw new BrokerVerificationDocumentDeletionError(
        BROKER_DOCUMENTS_CHANGED_DURING_DELETION,
      );
    }

    await db.query('DELETE FROM broker_documents WHERE broker_id = ?', [brokerId]);
    await db.commit();
    return { removed: true };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}
