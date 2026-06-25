import { Response, Request } from 'express';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { createAdminNotification } from './notificationService';
import {
  findLatestNegotiationDocumentByType,
  getNegotiationDbConnection,
  saveNegotiationSignedProposalDocument,
  queryNegotiationRows,
} from './negotiationPersistenceService';

interface NegotiationUploadRow extends RowDataPacket {
  id: string;
  property_id: number;
  status: string;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  seller_client_id: number | null;
  buyer_client_id: number | null;
  property_title: string | null;
  broker_name: string | null;
}

interface NegotiationAccessRow extends RowDataPacket {
  id: string;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  seller_client_id: number | null;
  buyer_client_id: number | null;
}

const SIGNED_PROPOSAL_REVIEW_STATUS = 'DOCUMENTATION_PHASE';
const SIGNED_PROPOSAL_ALLOWED_CURRENT_STATUS = new Set([
  'PROPOSAL_SENT',
  'AWAITING_SIGNATURES',
]);

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

function canManageOwnProposal(
  userId: number,
  role: string,
  negotiation: NegotiationAccessRow
): boolean {
  const normalizedRole = String(role ?? '').trim().toLowerCase();
  if (normalizedRole === 'client') {
    return (
      userId === Number(negotiation.buyer_client_id ?? 0) ||
      userId === Number(negotiation.seller_client_id ?? 0)
    );
  }
  if (normalizedRole === 'broker') {
    return userId === Number(negotiation.capturing_broker_id ?? 0);
  }
  return canAccessNegotiationByOwnership(userId, negotiation);
}

function handleUnauthenticated(res: Response): Response {
  return res.status(401).json({ error: 'Usuario nao autenticado.' });
}

export async function uploadSignedProposal(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  if (!req.userId) {
    return handleUnauthenticated(res);
  }

  const negotiationId = String(req.params.id ?? '').trim();
  if (!negotiationId) {
    return res.status(400).json({ error: 'ID de negociação inválido.' });
  }

  const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
  if (!uploadedFile || !uploadedFile.buffer || uploadedFile.buffer.length === 0) {
    return res.status(400).json({ error: 'PDF assinado não enviado.' });
  }

  const mime = String(uploadedFile.mimetype ?? '').toLowerCase();
  if (mime && mime !== 'application/pdf') {
    return res.status(400).json({ error: 'Arquivo inválido. Envie apenas PDF assinado.' });
  }

  let tx: PoolConnection | null = null;
  try {
    tx = await getNegotiationDbConnection();
    await tx.beginTransaction();

    const [negotiationRows] = await tx.query<NegotiationUploadRow[]>(
      `
        SELECT
          n.id,
          n.property_id,
          n.status,
          n.capturing_broker_id,
          n.selling_broker_id,
          n.buyer_client_id,
          p.title AS property_title,
          u.name AS broker_name
        FROM negotiations n
        JOIN properties p ON p.id = n.property_id
        LEFT JOIN users u ON u.id = n.capturing_broker_id
        WHERE n.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [negotiationId]
    );

    const negotiation = negotiationRows[0];
    if (!negotiation) {
      await tx.rollback();
      return res.status(404).json({ error: 'Negociação não encontrada.' });
    }

      if (
        !canManageOwnProposal(
          Number(req.userId),
          String(req.userRole ?? ''),
          negotiation as unknown as NegotiationAccessRow
        )
      ) {
      await tx.rollback();
      return res
        .status(403)
        .json({ error: 'Você não possui permissão para enviar esta proposta.' });
    }

    const currentStatus = String(negotiation.status ?? '').trim().toUpperCase();
    if (!SIGNED_PROPOSAL_ALLOWED_CURRENT_STATUS.has(currentStatus)) {
      await tx.rollback();
      return res.status(400).json({
        error: 'A proposta assinada só pode ser enviada enquanto aguarda assinatura.',
      });
    }

    const documentId = await saveNegotiationSignedProposalDocument(
      negotiationId,
      uploadedFile.buffer,
      tx,
      {
        originalFileName: uploadedFile.originalname ?? 'proposta_assinada.pdf',
        uploadedBy: Number(req.userId ?? 0) || null,
        uploadedAt: new Date().toISOString(),
      }
    );

    await tx.execute(
      `
        UPDATE negotiations
        SET status = ?, version = version + 1
        WHERE id = ?
      `,
      [SIGNED_PROPOSAL_REVIEW_STATUS, negotiationId]
    );

    await tx.execute(
      `
        INSERT INTO negotiation_history (
          id,
          negotiation_id,
          from_status,
          to_status,
          actor_id,
          metadata_json,
          created_at
        )
        VALUES (UUID(), ?, ?, ?, ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
      `,
      [
        negotiationId,
        currentStatus,
        SIGNED_PROPOSAL_REVIEW_STATUS,
        req.userId,
        JSON.stringify({
          action: 'signed_proposal_uploaded',
          documentId,
          filename: uploadedFile.originalname ?? null,
        }),
      ]
    );

    await tx.commit();

    const propertyTitle = String(negotiation.property_title ?? '').trim() || 'Imóvel sem título';
    const brokerName = String(negotiation.broker_name ?? `#${req.userId}`);
    await createAdminNotification({
      type: 'negotiation',
      title: `Proposta Enviada: ${propertyTitle}`,
      message: `O corretor ${brokerName} enviou uma proposta assinada para o imóvel ${propertyTitle}.`,
      relatedEntityId: Number(negotiation.property_id),
      metadata: {
        negotiationId,
        propertyId: Number(negotiation.property_id),
        brokerId: req.userId,
        documentId,
      },
    });

    return res.status(201).json({
      message: 'Proposta assinada enviada com sucesso. Em análise.',
      status: 'UNDER_REVIEW',
      negotiationId,
      documentId,
      hasSignedProposalDocument: true,
    });
  } catch (error) {
    if (tx) {
      await tx.rollback();
    }
    console.error('Erro ao enviar proposta assinada:', error);
    return res.status(500).json({ error: 'Falha ao enviar proposta assinada.' });
  } finally {
    tx?.release();
  }
}

export async function downloadLatestProposal(
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

    if (role !== 'admin' && !canManageOwnProposal(userId, role, negotiation)) {
      return res.status(403).json({ error: 'Acesso negado à proposta.' });
    }

    const document = await findLatestNegotiationDocumentByType(negotiationId, 'proposal');
    if (!document) {
      return res.status(404).json({ error: 'Nenhuma proposta encontrada para esta negociação.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="proposta.pdf"');
    res.setHeader('Content-Length', document.fileContent.length.toString());
    res.setHeader('X-Document-Id', String(document.id));

    res.end(document.fileContent);
    return res;
  } catch (error) {
    console.error('Erro ao baixar proposta da negociação:', error);
    return res.status(500).json({ error: 'Falha ao baixar proposta.' });
  }
}
