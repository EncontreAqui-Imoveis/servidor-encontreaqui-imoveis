import type { Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { queryNegotiationRows } from './negotiationPersistenceService';

interface NegotiationColumnFlags {
  hasUpdatedAt: boolean;
  hasCreatedAt: boolean;
}

interface ClientLookupRow extends RowDataPacket {
  client_name: string | null;
  client_cpf: string | null;
  client_phone: string | null;
}

async function getNegotiationColumnFlags(): Promise<NegotiationColumnFlags> {
  const rows = await queryNegotiationRows<RowDataPacket>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'negotiations'
        AND column_name IN ('updated_at', 'created_at')
    `,
    []
  );
  const names = new Set(
    rows.map((row) => String((row as { column_name?: string }).column_name ?? '').toLowerCase())
  );
  return {
    hasUpdatedAt: names.has('updated_at'),
    hasCreatedAt: names.has('created_at'),
  };
}

export async function lookupClientByCpf(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  if (!req.userId) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  const role = String(req.userRole ?? '').toLowerCase();
  if (role !== 'broker') {
    return res.status(200).json({ found: false, clientName: null, clientPhone: null });
  }

  const cpfKey = String(req.query.cpf ?? req.query.cpfRaw ?? '').replace(/\D/g, '');
  if (cpfKey.length !== 11) {
    return res.status(400).json({ error: 'CPF inválido. Informe 11 dígitos.' });
  }

  const userId = Number(req.userId);
  const cpfExpr = `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(n.client_cpf, ''), '.', ''), '-', ''), '/', ''), ' ', '')`;
  const flags = await getNegotiationColumnFlags();
  const updatedAtSort = flags.hasUpdatedAt ? 'n.updated_at DESC,' : '';
  const createdAtSort = flags.hasCreatedAt ? 'n.created_at DESC,' : '';

  const rows = await queryNegotiationRows<ClientLookupRow>(
    `
      SELECT
        n.client_name,
        n.client_cpf,
        u.phone AS client_phone
      FROM negotiations n
      LEFT JOIN users u ON u.id = n.buyer_client_id
      WHERE n.capturing_broker_id = ?
        AND ${cpfExpr} = ?
      ORDER BY ${updatedAtSort} ${createdAtSort} n.id DESC
      LIMIT 1
    `,
    [userId, cpfKey]
  );

  const row = rows[0];
  if (!row) {
    return res.status(200).json({ found: false, clientName: null, clientPhone: null });
  }

  const name = String(row.client_name ?? '').trim();
  if (!name) {
    return res.status(200).json({ found: false, clientName: null, clientPhone: null });
  }

  return res.status(200).json({
    found: true,
    clientName: name,
    clientPhone: row.client_phone != null ? String(row.client_phone) : null,
  });
}
