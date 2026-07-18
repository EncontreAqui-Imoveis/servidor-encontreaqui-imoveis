import connection from '../src/database/connection';
import type { RowDataPacket } from 'mysql2';

type UnknownDealTypeRow = RowDataPacket & {
  contract_id: string;
  negotiation_id: string;
  contract_status: string;
  contract_deal_type: string | null;
  negotiation_deal_type: string | null;
  property_purpose: string | null;
  created_at: Date | string | null;
};

/**
 * Read-only release audit. Ambiguous legacy records are reported, never
 * inferred or modified, before enabling rental/sale flows in an environment.
 */
async function auditContractDealTypes(): Promise<void> {
  const [rows] = await connection.query<UnknownDealTypeRow[]>(`
    SELECT
      c.id AS contract_id,
      c.negotiation_id,
      c.status AS contract_status,
      c.deal_type AS contract_deal_type,
      n.deal_type AS negotiation_deal_type,
      p.purpose AS property_purpose,
      c.created_at
    FROM contracts c
    LEFT JOIN negotiations n ON n.id = c.negotiation_id
    LEFT JOIN properties p ON p.id = c.property_id
    WHERE c.deal_type IS NULL
       OR c.deal_type NOT IN ('sale', 'rent')
    ORDER BY c.created_at DESC, c.id DESC
  `);

  if (rows.length === 0) {
    console.log('Auditoria concluida: nenhum contrato sem modalidade canonica.');
    return;
  }

  console.log(`Auditoria concluida: ${rows.length} contrato(s) sem modalidade canonica.`);
  console.table(
    rows.map((row) => ({
      contractId: row.contract_id,
      negotiationId: row.negotiation_id,
      status: row.contract_status,
      contractDealType: row.contract_deal_type,
      negotiationDealType: row.negotiation_deal_type,
      propertyPurpose: row.property_purpose,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    }))
  );
  process.exitCode = 2;
}

auditContractDealTypes()
  .catch((error) => {
    console.error('Falha na auditoria de modalidade dos contratos:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
