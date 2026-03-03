import connection from '../database/connection';

type QueryExecutor = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

export async function getCurrentBrokerTerms(
  executor: QueryExecutor = connection,
) {
  const [terms] = (await executor.query(
    'SELECT * FROM broker_terms WHERE active = TRUE ORDER BY created_at DESC LIMIT 1'
  )) as any[];

  return terms;
}

export async function recordBrokerTermsAcceptance(
  brokerId: number,
  termsId: number,
  executor: QueryExecutor = connection,
) {
  await executor.query(
    'INSERT INTO broker_acceptances (broker_id, terms_id) VALUES (?, ?)',
    [brokerId, termsId],
  );
}
