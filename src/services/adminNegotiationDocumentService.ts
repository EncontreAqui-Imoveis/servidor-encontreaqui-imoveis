import type { RowDataPacket } from 'mysql2/promise';

import { adminDb } from './adminPersistenceService';
import {
  deleteNegotiationDocumentObject,
  readNegotiationDocumentObject,
} from './negotiationDocumentStorageService';
import { saveNegotiationSignedProposalDocument } from './negotiationPersistenceService';

type NegotiationResponsibleRow = RowDataPacket & {
  user_id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  profile_type: string | null;
};

type AdminNegotiationDocumentRow = RowDataPacket & {
  id: number;
  type: string | null;
  document_type: string | null;
  metadata_json: unknown;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  storage_content_type: string | null;
  storage_size_bytes: number | null;
  storage_etag: string | null;
};

let negotiationResponsiblesTableCache: boolean | null = null;

function parseJsonObjectSafe(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

async function hasNegotiationResponsiblesTable(): Promise<boolean> {
  if (negotiationResponsiblesTableCache != null) {
    return negotiationResponsiblesTableCache;
  }

  try {
    const [rows] = await adminDb.query<RowDataPacket[]>(
      `
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = 'negotiation_responsibles'
        LIMIT 1
      `
    );
    negotiationResponsiblesTableCache = rows.length > 0;
  } catch {
    negotiationResponsiblesTableCache = false;
  }

  return negotiationResponsiblesTableCache;
}

export async function listNegotiationResponsibles(negotiationId: string): Promise<{
  negotiationId: string;
  responsibles: Array<{
    userId: number;
    name: string | null;
    email: string | null;
    phone: string | null;
    role: 'broker' | 'auxiliary_administrative';
  }>;
  schemaFallback?: boolean;
}> {
  const normalizedNegotiationId = String(negotiationId ?? '').trim();
  if (!normalizedNegotiationId) {
    throw Object.assign(new Error('ID de negociação inválido.'), { statusCode: 400 });
  }

  const hasTable = await hasNegotiationResponsiblesTable();
  if (!hasTable) {
    return {
      negotiationId: normalizedNegotiationId,
      responsibles: [],
      schemaFallback: true,
    };
  }

  const [rows] = await adminDb.query<NegotiationResponsibleRow[]>(
    `
      SELECT
        nr.user_id,
        u.name,
        u.email,
        u.phone,
        COALESCE(b.profile_type, 'BROKER') AS profile_type
      FROM negotiation_responsibles nr
      JOIN users u ON u.id = nr.user_id
      LEFT JOIN brokers b ON b.id = nr.user_id
      WHERE nr.negotiation_id = ?
      ORDER BY nr.created_at ASC, nr.id ASC
    `,
    [normalizedNegotiationId]
  );

  return {
    negotiationId: normalizedNegotiationId,
    responsibles: rows.map((row) => ({
      userId: Number(row.user_id),
      name: row.name ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
      role:
        String(row.profile_type ?? '').toUpperCase() === 'AUXILIARY_ADMINISTRATIVE'
          ? 'auxiliary_administrative'
          : 'broker',
    })),
  };
}

export async function updateNegotiationResponsibles(params: {
  negotiationId: string;
  responsibleIds: number[];
  actorId: number | null;
}): Promise<{ negotiationId: string; responsibleIds: number[] }> {
  const normalizedNegotiationId = String(params.negotiationId ?? '').trim();
  if (!normalizedNegotiationId) {
    throw Object.assign(new Error('ID de negociação inválido.'), { statusCode: 400 });
  }

  const normalizedIds = Array.from(new Set(params.responsibleIds)).filter(
    (value) => Number.isInteger(value) && value > 0
  );
  if (normalizedIds.length > 5) {
    throw Object.assign(new Error('Máximo de 5 responsáveis por negociação.'), { statusCode: 400 });
  }

  const hasTable = await hasNegotiationResponsiblesTable();
  if (!hasTable) {
    throw Object.assign(new Error('Estrutura de banco desatualizada para responsáveis da negociação.'), {
      statusCode: 503,
      code: 'SCHEMA_OUTDATED',
    });
  }

  const tx = await adminDb.getConnection();
  try {
    await tx.beginTransaction();

    const [negotiationRows] = await tx.query<RowDataPacket[]>(
      `
        SELECT id
        FROM negotiations
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [normalizedNegotiationId]
    );
    if (negotiationRows.length === 0) {
      await tx.rollback();
      throw Object.assign(new Error('Negociação não encontrada.'), { statusCode: 404 });
    }

    if (normalizedIds.length > 0) {
      const [eligibleRows] = await tx.query<RowDataPacket[]>(
        `
          SELECT b.id
          FROM brokers b
          WHERE b.id IN (${normalizedIds.map(() => '?').join(', ')})
            AND b.status = 'approved'
            AND COALESCE(b.profile_type, 'BROKER') IN ('BROKER', 'AUXILIARY_ADMINISTRATIVE')
        `,
        normalizedIds
      );
      const eligible = new Set(eligibleRows.map((row) => Number(row.id)));
      const invalid = normalizedIds.filter((id) => !eligible.has(id));
      if (invalid.length > 0) {
        await tx.rollback();
        throw Object.assign(new Error('Somente corretores/auxiliares administrativos aprovados podem ser responsáveis.'), {
          statusCode: 400,
          invalidUserIds: invalid,
        });
      }
    }

    await tx.query('DELETE FROM negotiation_responsibles WHERE negotiation_id = ?', [normalizedNegotiationId]);

    if (normalizedIds.length > 0) {
      const valuesClause = normalizedIds.map(() => '(?, ?, ?)').join(', ');
      const paramsValues: Array<string | number> = [];
      const assignedBy = Number(params.actorId ?? 0);
      for (const responsibleUserId of normalizedIds) {
        paramsValues.push(normalizedNegotiationId, responsibleUserId, assignedBy);
      }
      await tx.query(
        `
          INSERT INTO negotiation_responsibles (
            negotiation_id,
            user_id,
            assigned_by
          ) VALUES ${valuesClause}
        `,
        paramsValues
      );
    }

    await tx.commit();
    return {
      negotiationId: normalizedNegotiationId,
      responsibleIds: normalizedIds,
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

export async function downloadSignedProposal(negotiationId: string): Promise<{
  fileContent: Buffer;
  filename: string;
}> {
  const normalizedNegotiationId = String(negotiationId ?? '').trim();
  if (!normalizedNegotiationId) {
    throw Object.assign(new Error('ID de negociação inválido.'), { statusCode: 400 });
  }

  const [rows] = await adminDb.query<AdminNegotiationDocumentRow[]>(
    `
      SELECT
        id,
        type,
        document_type,
        metadata_json,
        storage_provider,
        storage_bucket,
        storage_key,
        storage_content_type,
        storage_size_bytes,
        storage_etag
      FROM negotiation_documents
      WHERE negotiation_id = ?
        AND type = 'other'
        AND document_type = 'contrato_assinado'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [normalizedNegotiationId]
  );

  const document = rows[0];
  if (!document) {
    throw Object.assign(new Error('Proposta assinada não encontrada.'), { statusCode: 404 });
  }

  const fileContent = await readNegotiationDocumentObject(document);
  const metadata = parseJsonObjectSafe(document.metadata_json);
  const originalFileName = String(metadata.originalFileName ?? '').trim();
  const fallbackType = String(document.document_type ?? document.type ?? 'proposta_assinada')
    .trim()
    .toLowerCase();
  const filename =
    originalFileName || `${fallbackType || 'proposta_assinada'}_${normalizedNegotiationId}.pdf`;

  return { fileContent, filename };
}

export async function downloadProposalDraft(negotiationId: string): Promise<{
  fileContent: Buffer;
  filename: string;
}> {
  const normalizedNegotiationId = String(negotiationId ?? '').trim();
  if (!normalizedNegotiationId) {
    throw Object.assign(new Error('ID de negociação inválido.'), { statusCode: 400 });
  }

  const [rows] = await adminDb.query<AdminNegotiationDocumentRow[]>(
    `
      SELECT
        id,
        type,
        document_type,
        metadata_json,
        storage_provider,
        storage_bucket,
        storage_key,
        storage_content_type,
        storage_size_bytes,
        storage_etag
      FROM negotiation_documents
      WHERE negotiation_id = ?
        AND type = 'proposal'
        AND document_type = 'contrato_minuta'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [normalizedNegotiationId]
  );

  const document = rows[0];
  if (!document) {
    throw Object.assign(new Error('Minuta não encontrada.'), { statusCode: 404 });
  }

  const fileContent = await readNegotiationDocumentObject(document);
  const metadata = parseJsonObjectSafe(document.metadata_json);
  const originalFileName = String(metadata.originalFileName ?? '').trim();
  const fallbackType = String(document.document_type ?? document.type ?? 'proposta_minuta')
    .trim()
    .toLowerCase();
  const filename =
    originalFileName || `${fallbackType || 'proposta_minuta'}_${normalizedNegotiationId}.pdf`;

  return { fileContent, filename };
}

export async function uploadSignedProposal(params: {
  negotiationId: string;
  actorId: number;
  file: { buffer: Buffer; mimetype?: string; originalname?: string };
}): Promise<{
  negotiationId: string;
  documentId: number;
  signedDocumentId: number;
  signedDocumentFileName: string;
}> {
  const negotiationId = String(params.negotiationId ?? '').trim();
  const actorId = Number(params.actorId);
  if (!negotiationId) {
    throw Object.assign(new Error('ID de negociação inválido.'), { statusCode: 400 });
  }
  if (!actorId) {
    throw Object.assign(new Error('Administrador não autenticado.'), { statusCode: 401 });
  }

  const uploadedFile = params.file;
  if (!uploadedFile || !uploadedFile.buffer || uploadedFile.buffer.length === 0) {
    throw Object.assign(new Error('PDF assinado não enviado.'), { statusCode: 400 });
  }
  const mime = String(uploadedFile.mimetype ?? '').toLowerCase();
  if (mime && mime !== 'application/pdf') {
    throw Object.assign(new Error('Arquivo inválido. Envie apenas PDF assinado.'), { statusCode: 400 });
  }

  const tx = await adminDb.getConnection();
  let previousDocumentToDelete: AdminNegotiationDocumentRow | null = null;
  try {
    await tx.beginTransaction();
    const [negotiationRows] = await tx.query<RowDataPacket[]>(
      `
        SELECT id, status
        FROM negotiations
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [negotiationId]
    );
    if (negotiationRows.length === 0) {
      await tx.rollback();
      throw Object.assign(new Error('Negociação não encontrada.'), { statusCode: 404 });
    }

    const currentStatus = String(negotiationRows[0]?.status ?? '').trim().toUpperCase();
    if (
      currentStatus === 'CANCELLED' ||
      currentStatus === 'REFUSED' ||
      currentStatus === 'SOLD' ||
      currentStatus === 'RENTED'
    ) {
      await tx.rollback();
      throw Object.assign(new Error('Não é possível enviar PDF assinado para uma negociação encerrada.'), {
        statusCode: 400,
      });
    }

    const [existingRows] = await tx.query<AdminNegotiationDocumentRow[]>(
      `
        SELECT
          id,
          type,
          document_type,
          metadata_json,
          storage_provider,
          storage_bucket,
          storage_key,
          storage_content_type,
          storage_size_bytes,
          storage_etag
        FROM negotiation_documents
        WHERE negotiation_id = ?
          AND type = 'other'
          AND document_type = 'contrato_assinado'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `,
      [negotiationId]
    );
    const existingDocument = existingRows[0];
    if (existingDocument) {
      await tx.query('DELETE FROM negotiation_documents WHERE id = ?', [existingDocument.id]);
      previousDocumentToDelete = existingDocument;
    }

    const originalFileName = uploadedFile.originalname ?? 'proposta_assinada_admin.pdf';
    const documentId = await saveNegotiationSignedProposalDocument(
      negotiationId,
      uploadedFile.buffer,
      tx,
      {
        originalFileName,
        uploadedBy: actorId,
        uploadedByRole: 'admin',
        uploadedAt: new Date().toISOString(),
        source: 'admin_panel',
      }
    );

    await tx.commit();
    if (previousDocumentToDelete) {
      await deleteNegotiationDocumentObject(previousDocumentToDelete).catch((storageError) => {
        console.error('Falha ao excluir PDF assinado anterior no storage:', storageError);
      });
    }
    return {
      negotiationId,
      documentId,
      signedDocumentId: documentId,
      signedDocumentFileName: originalFileName,
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

export async function deleteSignedProposal(params: {
  negotiationId: string;
  actorId: number;
}): Promise<{ negotiationId: string }> {
  const negotiationId = String(params.negotiationId ?? '').trim();
  const actorId = Number(params.actorId);
  if (!negotiationId) {
    throw Object.assign(new Error('ID de negociação inválido.'), { statusCode: 400 });
  }
  if (!actorId) {
    throw Object.assign(new Error('Administrador não autenticado.'), { statusCode: 401 });
  }

  const tx = await adminDb.getConnection();
  let documentToDelete: AdminNegotiationDocumentRow | null = null;
  try {
    await tx.beginTransaction();
    const [rows] = await tx.query<AdminNegotiationDocumentRow[]>(
      `
        SELECT
          id,
          type,
          document_type,
          metadata_json,
          storage_provider,
          storage_bucket,
          storage_key,
          storage_content_type,
          storage_size_bytes,
          storage_etag
        FROM negotiation_documents
        WHERE negotiation_id = ?
          AND type = 'other'
          AND document_type = 'contrato_assinado'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `,
      [negotiationId]
    );
    const document = rows[0];
    if (!document) {
      await tx.rollback();
      throw Object.assign(new Error('Proposta assinada não encontrada.'), { statusCode: 404 });
    }

    await tx.query('DELETE FROM negotiation_documents WHERE id = ?', [document.id]);
    documentToDelete = document;

    await tx.commit();

    if (documentToDelete) {
      await deleteNegotiationDocumentObject(documentToDelete).catch((storageError) => {
        console.error('Falha ao excluir arquivo no storage da proposta assinada:', storageError);
      });
    }

    return { negotiationId };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

export async function deleteProposalDraft(params: {
  negotiationId: string;
  actorId: number;
}): Promise<{ negotiationId: string }> {
  const negotiationId = String(params.negotiationId ?? '').trim();
  const actorId = Number(params.actorId);
  if (!negotiationId) {
    throw Object.assign(new Error('ID de negociação inválido.'), { statusCode: 400 });
  }
  if (!actorId) {
    throw Object.assign(new Error('Administrador não autenticado.'), { statusCode: 401 });
  }

  const tx = await adminDb.getConnection();
  let documentToDelete: AdminNegotiationDocumentRow | null = null;
  try {
    await tx.beginTransaction();
    const [rows] = await tx.query<AdminNegotiationDocumentRow[]>(
      `
        SELECT
          id,
          type,
          document_type,
          metadata_json,
          storage_provider,
          storage_bucket,
          storage_key,
          storage_content_type,
          storage_size_bytes,
          storage_etag
        FROM negotiation_documents
        WHERE negotiation_id = ?
          AND type = 'proposal'
          AND document_type = 'contrato_minuta'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `,
      [negotiationId]
    );
    const document = rows[0];
    if (!document) {
      await tx.rollback();
      throw Object.assign(new Error('Minuta não encontrada.'), { statusCode: 404 });
    }

    await tx.query('DELETE FROM negotiation_documents WHERE id = ?', [document.id]);
    documentToDelete = document;

    await tx.commit();

    if (documentToDelete) {
      await deleteNegotiationDocumentObject(documentToDelete).catch((storageError) => {
        console.error('Falha ao excluir arquivo no storage da minuta:', storageError);
      });
    }

    return { negotiationId };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}
