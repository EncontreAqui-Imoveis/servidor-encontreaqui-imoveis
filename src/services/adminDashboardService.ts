import { RowDataPacket } from 'mysql2';
import { adminDb } from './adminPersistenceService';

export type AdminDashboardStatsPayload = {
  totalProperties: number;
  totalBrokers: number;
  totalUsers: number;
  propertiesByStatus: RowDataPacket[];
  newPropertiesOverTime: RowDataPacket[];
};

export async function loadAdminDashboardStats(): Promise<AdminDashboardStatsPayload> {
  const propertiesByStatusQuery = `
    SELECT
      status,
      COUNT(*) AS count
    FROM properties
    GROUP BY status
  `;

  const newPropertiesQuery = `
    SELECT
      DATE(created_at) AS date,
      COUNT(*) AS count
    FROM properties
    WHERE created_at >= CURDATE() - INTERVAL 30 DAY
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

  const totalsQuery = `
    SELECT
      (SELECT COUNT(*) FROM properties) AS totalProperties,
      (SELECT COUNT(*) FROM brokers) AS totalBrokers,
      (SELECT COUNT(*) FROM users) AS totalUsers
  `;

  const [propertiesByStatusResult, newPropertiesResult, totalsResult] = await Promise.all([
    adminDb.query<RowDataPacket[]>(propertiesByStatusQuery),
    adminDb.query<RowDataPacket[]>(newPropertiesQuery),
    adminDb.query<RowDataPacket[]>(totalsQuery),
  ]);

  const [propertiesByStatusRows] = propertiesByStatusResult;
  const [newPropertiesRows] = newPropertiesResult;
  const [totalsRow] = totalsResult;
  const totals = Array.isArray(totalsRow) && totalsRow[0] ? totalsRow[0] : null;

  return {
    totalProperties: Number(totals?.totalProperties ?? 0),
    totalBrokers: Number(totals?.totalBrokers ?? 0),
    totalUsers: Number(totals?.totalUsers ?? 0),
    propertiesByStatus: propertiesByStatusRows ?? [],
    newPropertiesOverTime: newPropertiesRows ?? [],
  };
}
