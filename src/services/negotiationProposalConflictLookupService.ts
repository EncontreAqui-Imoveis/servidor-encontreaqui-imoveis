import type { Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { queryNegotiationRows } from './negotiationPersistenceService';
import { isValidCpf, normalizeCpfDigits } from '../utils/cpfValidator';

interface ProposalConflictRow extends RowDataPacket {
  id: string;
  property_id: number;
  property_title: string | null;
  status: string;
  client_name: string | null;
  client_cpf: string | null;
  buyer_client_id: number | null;
  seller_client_id: number | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
}

const PROPOSAL_BLOCKING_STATUSES = [
  'PROPOSAL_DRAFT',
  'PROPOSAL_SENT',
  'IN_NEGOTIATION',
] as const;

export async function lookupProposalConflict(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  if (!req.userId) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  const propertyId = Number(req.query.propertyId ?? req.query.property_id ?? 0);
  if (!Number.isFinite(propertyId) || propertyId <= 0) {
    return res.status(400).json({ error: 'propertyId inválido.' });
  }

  const cpfKey = normalizeCpfDigits(String(req.query.cpf ?? req.query.clientCpf ?? ''));
  if (!isValidCpf(cpfKey)) {
    return res.status(400).json({ error: 'CPF inválido. Informe um CPF válido.' });
  }

  const normalizedCpfExpr = `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(n.client_cpf, ''), '.', ''), '-', ''), '/', ''), ' ', '')`;
  const rows = await queryNegotiationRows<ProposalConflictRow>(
    `
      SELECT
        n.id,
        n.property_id,
        p.title AS property_title,
        n.status,
        n.client_name,
        n.client_cpf,
        n.buyer_client_id,
        n.seller_client_id,
        n.created_at,
        n.updated_at
      FROM negotiations n
      LEFT JOIN properties p ON p.id = n.property_id
      WHERE n.property_id = ?
        AND n.status IN (${PROPOSAL_BLOCKING_STATUSES.map(() => '?').join(', ')})
        AND ${normalizedCpfExpr} = ?
      ORDER BY n.updated_at DESC, n.created_at DESC, n.id DESC
      LIMIT 1
    `,
    [propertyId, ...PROPOSAL_BLOCKING_STATUSES, cpfKey]
  );

  const row = rows[0];
  if (!row) {
    return res.status(200).json({ found: false, conflict: null });
  }

  return res.status(200).json({
    found: true,
    conflict: {
      id: String(row.id),
      propertyId: Number(row.property_id),
      propertyTitle: row.property_title != null ? String(row.property_title) : null,
      status: String(row.status ?? '').trim(),
      clientName: row.client_name != null ? String(row.client_name) : null,
      clientCpf: row.client_cpf != null ? String(row.client_cpf) : null,
      buyerClientId:
        row.buyer_client_id != null && Number.isFinite(Number(row.buyer_client_id))
          ? Number(row.buyer_client_id)
          : null,
      sellerClientId:
        row.seller_client_id != null && Number.isFinite(Number(row.seller_client_id))
          ? Number(row.seller_client_id)
          : null,
      createdAt: row.created_at != null ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at != null ? new Date(row.updated_at).toISOString() : null,
    },
  });
}
