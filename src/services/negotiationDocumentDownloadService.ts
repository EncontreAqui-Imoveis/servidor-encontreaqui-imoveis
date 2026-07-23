import { Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import {
  findNegotiationDocumentById,
  queryNegotiationRows,
} from './negotiationPersistenceService';
import { isNegotiationActor, isNegotiationAdmin } from '../utils/negotiationActorAccess';
import { resolveContractAccessContext } from '../utils/contractAccessResolver';
import { isContractSharedDocumentType } from '../modules/contracts/domain/contract.types';

interface NegotiationAccessRow extends RowDataPacket {
  id: string;
  proposer_id: number | null;
  advertiser_id: number | null;
  legal_buyer_user_id: number | null;
  handshake_pin: string | null;
  handshake_status: 'PENDING' | 'VERIFIED' | 'REJECTED' | null;
  contract_id: string | null;
  contract_status: string | null;
  property_owner_id: number | null;
  responsible_user_ids: string | null;
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

function readDocumentOwnerSide(metadata: Record<string, unknown>): 'seller' | 'buyer' | null {
  const side = String(metadata.owner_side ?? metadata.side ?? '').trim().toLowerCase();
  return side === 'seller' || side === 'buyer' ? side : null;
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
        SELECT
          n.id,
          n.proposer_id,
          n.advertiser_id,
          n.legal_buyer_user_id,
          n.handshake_pin,
          n.handshake_status,
          c.id AS contract_id,
          c.status AS contract_status,
          p.owner_id AS property_owner_id,
          (
            SELECT GROUP_CONCAT(nr.user_id ORDER BY nr.created_at ASC, nr.id ASC SEPARATOR ',')
            FROM negotiation_responsibles nr
            JOIN brokers responsible_broker ON responsible_broker.id = nr.user_id
            WHERE nr.negotiation_id = n.id
              AND responsible_broker.status = 'approved'
              AND COALESCE(responsible_broker.profile_type, 'BROKER') IN ('BROKER', 'AUXILIARY_ADMINISTRATIVE')
          ) AS responsible_user_ids
        FROM negotiations n
        JOIN properties p ON p.id = n.property_id
        LEFT JOIN contracts c ON c.negotiation_id = n.id
        WHERE n.id = ?
        LIMIT 1
      `,
      [negotiationId]
    );
    const negotiation = negotiationRows[0];
    if (!negotiation) {
      return res.status(404).json({ error: 'Negociação não encontrada.' });
    }

    const isVerifiedLegalBuyer =
      Number(negotiation.legal_buyer_user_id) === userId &&
      String(negotiation.handshake_pin ?? '').trim().length > 0 &&
      String(negotiation.handshake_status ?? '').trim().toUpperCase() === 'VERIFIED';
    const contractAccess = negotiation.contract_id
      ? resolveContractAccessContext(
          { id: userId, role },
          {
            id: negotiation.contract_id,
            status: negotiation.contract_status,
            advertiser_id: negotiation.advertiser_id,
            property_owner_id: negotiation.property_owner_id,
            proposer_id: negotiation.proposer_id,
            legal_buyer_user_id: negotiation.legal_buyer_user_id,
            handshake_pin: negotiation.handshake_pin,
            handshake_status: negotiation.handshake_status,
            responsible_user_ids: negotiation.responsible_user_ids,
          }
        )
      : null;
    if (
      !isNegotiationAdmin(role) &&
      !isNegotiationActor(userId, negotiation) &&
      !isVerifiedLegalBuyer &&
      (!contractAccess || contractAccess.userRole === 'none')
    ) {
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

    if (contractAccess) {
      if (!contractAccess.canReadDocumentFiles) {
        return res.status(403).json({ error: 'Documentos disponíveis apenas para consulta de status nesta etapa.' });
      }

      const metadata = parseJsonObjectSafe(document.metadataJson);
      const documentType = String(document.documentType ?? '').trim().toLowerCase();
      const isSharedArtifact =
        isContractSharedDocumentType(documentType) ||
        String(metadata.visibility ?? '').trim().toUpperCase() === 'CONTRACT_SHARED';
      const ownerSide = readDocumentOwnerSide(metadata);

      // A direct download URL must enforce the same bilateral boundary as the
      // contract detail response. Shared contractual artifacts are the only
      // exception and remain readable by both authorized parties.
      if (!isSharedArtifact) {
        if (ownerSide === 'seller' && !contractAccess.canReadSeller) {
          return res.status(403).json({ error: 'Acesso negado ao documento do vendedor.' });
        }
        if (ownerSide === 'buyer' && !contractAccess.canReadBuyer) {
          return res.status(403).json({ error: 'Acesso negado ao documento do comprador.' });
        }
        if (ownerSide == null && documentType !== 'proposal') {
          return res.status(403).json({ error: 'Documento sem proprietário verificável.' });
        }
      }
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
