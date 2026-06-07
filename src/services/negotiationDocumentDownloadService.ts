import { Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import {
  findNegotiationDocumentById,
  queryNegotiationRows,
} from './negotiationPersistenceService';

interface NegotiationAccessRow extends RowDataPacket {
  id: string;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  seller_client_id: number | null;
  buyer_client_id: number | null;
}

interface NegotiationDocumentRow {
  id: number;
  negotiationId: string;
  fileContent: Buffer;
  type?: string | null;
  documentType?: string | null;
  metadataJson?: unknown;
}

function parseJsonObjectSafe(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function sanitizeDownloadFilename(value: string): string {
  const sanitized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) {
    return 'documento.pdf';
  }
  return sanitized;
}

function buildAttachmentDisposition(filename: string): string {
  const safe = sanitizeDownloadFilename(filename);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function canAccessNegotiationByOwnership(
  userId: number,
  negotiation: NegotiationAccessRow
): boolean {
  return (
    userId === Number(negotiation.capturing_broker_id ?? 0) ||
    userId === Number(negotiation.selling_broker_id ?? 0) ||
    userId === Number(negotiation.seller_client_id ?? 0) ||
    userId === Number(negotiation.buyer_client_id ?? 0)
  );
}

export async function downloadDocument(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  const negotiationId = String(req.params.id ?? '').trim();
  if (!negotiationId) {
    return res.status(400).json({ error: 'ID de negociação inválido.' });
  }

  const userId = Number(req.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  const role = String(req.userRole ?? '').trim().toLowerCase();
  const documentId = Number(req.params.documentId);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return res.status(400).json({ error: 'ID de documento invalido.' });
  }

  try {
    const negotiationRows = await queryNegotiationRows<NegotiationAccessRow>(
      `
        SELECT id, capturing_broker_id, selling_broker_id, seller_client_id, buyer_client_id
        FROM negotiations
        WHERE id = ?
        LIMIT 1
      `,
      [negotiationId]
    );
    const negotiation = negotiationRows[0];
    if (!negotiation) {
      return res.status(404).json({ error: 'Negociação não encontrada.' });
    }

    if (role !== 'admin' && !canAccessNegotiationByOwnership(userId, negotiation)) {
      return res.status(403).json({ error: 'Acesso negado ao documento.' });
    }

    const document = (await findNegotiationDocumentById(documentId)) as
      | NegotiationDocumentRow
      | null;
    if (!document) {
      return res.status(404).json({ error: 'Documento nao encontrado.' });
    }

    if (String(document.negotiationId) !== negotiationId) {
      return res.status(404).json({ error: 'Documento nao encontrado.' });
    }

    const contentType =
      document.type === 'proposal' || document.type === 'contract'
        ? 'application/pdf'
        : 'application/octet-stream';

    const metadata = parseJsonObjectSafe(document.metadataJson);
    const originalFileName = String(metadata.originalFileName ?? '').trim();
    const fallbackPrefix = String(document.documentType ?? document.type ?? 'documento')
      .trim()
      .toLowerCase();
    const extension = contentType === 'application/pdf' ? '.pdf' : '';
    const fallbackName = `${fallbackPrefix || 'documento'}_${documentId}${extension}`;
    const filename = originalFileName || fallbackName;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', buildAttachmentDisposition(filename));
    res.setHeader('Content-Length', document.fileContent.length.toString());

    res.end(document.fileContent);
    return res;
  } catch (error) {
    console.error('Erro ao baixar documento da negociacao:', error);
    return res.status(500).json({ error: 'Falha ao baixar documento.' });
  }
}
