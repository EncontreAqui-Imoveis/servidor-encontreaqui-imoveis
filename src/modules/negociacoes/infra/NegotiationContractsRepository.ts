import { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import connection from '../../../database/connection';
import { NegotiationContractRow } from './types';

export class NegotiationContractsRepository {

  async create(
    data: {
      negotiation_id: number;
      version: number;
      contract_url: string;
      uploaded_by_admin_id: number;
    },
    conn?: PoolConnection
  ): Promise<number> {
    const db = conn || connection;
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO negotiation_contracts 
       (negotiation_id, version, contract_url, uploaded_by_admin_id)
       VALUES (?, ?, ?, ?)`,
      [data.negotiation_id, data.version, data.contract_url, data.uploaded_by_admin_id]
    );
    return result.insertId;
  }

  async findLatestByNegotiationId(negotiationId: number): Promise<NegotiationContractRow | null> {
    const [rows] = await connection.query<any[]>(
      'SELECT * FROM negotiation_contracts WHERE negotiation_id = ? ORDER BY version DESC LIMIT 1',
      [negotiationId]
    );
    if (rows.length === 0) return null;
    return rows[0] as NegotiationContractRow;
  }
}
