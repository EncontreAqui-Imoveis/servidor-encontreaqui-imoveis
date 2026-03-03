import connection from '../database/connection';

type QueryExecutor = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

export interface DashboardStats {
  totalProperties: number;
  totalBrokers: number;
  totalUsers: number;
}

export async function loadDashboardStats(
  executor: QueryExecutor = connection,
): Promise<DashboardStats> {
  const [propertiesResult] = (await executor.query(
    'SELECT COUNT(*) as total FROM properties'
  )) as any[];
  const [brokersResult] = (await executor.query(
    'SELECT COUNT(*) as total FROM brokers'
  )) as any[];
  const [usersResult] = (await executor.query(
    'SELECT COUNT(*) as total FROM users'
  )) as any[];

  return {
    totalProperties: (propertiesResult as any[])[0].total,
    totalBrokers: (brokersResult as any[])[0].total,
    totalUsers: (usersResult as any[])[0].total,
  };
}
