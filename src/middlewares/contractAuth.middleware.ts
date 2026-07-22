import type { NextFunction, Response } from 'express';
import type { RowDataPacket } from 'mysql2';

import connection from '../database/connection';
import type { AuthRequest } from './auth';
import {
  resolveContractAccessContext,
  type ContractAccessRecord,
} from '../utils/contractAccessResolver';

interface ContractAccessRow extends RowDataPacket, ContractAccessRecord {}

let responsiblesTableExists: boolean | null = null;

async function hasNegotiationResponsiblesTable(): Promise<boolean> {
  if (responsiblesTableExists != null) {
    return responsiblesTableExists;
  }

  const [rows] = await connection.query<RowDataPacket[]>(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'negotiation_responsibles'
      LIMIT 1
    `
  );
  responsiblesTableExists = rows.length > 0;
  return responsiblesTableExists;
}

async function findContractForAuthorization(
  field: 'id' | 'negotiation_id',
  value: string
): Promise<ContractAccessRow | null> {
  const includeResponsibles = await hasNegotiationResponsiblesTable();
  const responsibleUsersSelect = includeResponsibles
    ? `(
      SELECT GROUP_CONCAT(nr.user_id ORDER BY nr.created_at ASC, nr.id ASC SEPARATOR ',')
      FROM negotiation_responsibles nr
      JOIN brokers responsible_broker ON (responsible_broker.user_id = nr.user_id OR responsible_broker.id = nr.user_id)
      WHERE nr.negotiation_id = c.negotiation_id
        AND responsible_broker.status = 'approved'
        AND COALESCE(responsible_broker.profile_type, 'BROKER') IN ('BROKER', 'AUXILIARY_ADMINISTRATIVE')
      ) AS responsible_user_ids`
    : 'NULL AS responsible_user_ids';
  const [rows] = await connection.query<ContractAccessRow[]>(
    `
      SELECT
        c.id,
        c.status,
        n.advertiser_id,
        n.proposer_id,
        n.initiator_side,
        n.legal_buyer_user_id,
        n.handshake_pin,
        n.handshake_status,
        n.handshake_attempts,
        p.owner_id AS property_owner_id,
        ${responsibleUsersSelect}
      FROM contracts c
      JOIN negotiations n ON n.id = c.negotiation_id
      JOIN properties p ON p.id = c.property_id
      WHERE c.${field} = ?
      LIMIT 1
    `,
    [value]
  );
  return rows[0] ?? null;
}

/** Resolves and attaches contract authorization before endpoint execution. */
export async function contractAuthMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const contractId = String(req.params.id ?? '').trim();
  const negotiationId = String(req.params.negotiationId ?? '').trim();
  const field = contractId ? 'id' : negotiationId ? 'negotiation_id' : null;
  const value = contractId || negotiationId;
  if (!field || !value) {
    res.status(400).json({ error: 'Identificador do contrato inválido.' });
    return;
  }

  try {
    const contract = await findContractForAuthorization(field, value);
    if (!contract) {
      res.status(404).json({ error: 'Contrato não encontrado.' });
      return;
    }

    // Cancelled contracts remain available to the administrative backoffice for
    // audit, but must not be reachable by a participant through a stale URL or
    // notification deep link.
    const isCancelled = String(contract.status ?? '').trim().toUpperCase() === 'CANCELLED';
    const isAdmin = String(req.userRole ?? '').trim().toLowerCase() === 'admin';
    if (isCancelled && !isAdmin) {
      res.status(404).json({ error: 'Contrato não encontrado.' });
      return;
    }

    const context = resolveContractAccessContext(
      { id: req.userId, role: req.userRole },
      contract
    );
    if (context.userRole === 'none') {
      res.status(403).json({ error: 'Acesso negado ao contrato.' });
      return;
    }

    req.contractContext = context;
    next();
  } catch (error) {
    console.error('Erro ao resolver autorização do contrato:', error);
    res.status(500).json({ error: 'Falha ao validar acesso ao contrato.' });
  }
}
