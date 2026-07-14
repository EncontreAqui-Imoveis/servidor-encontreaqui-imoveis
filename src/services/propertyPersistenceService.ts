import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';

import connection from '../database/connection';

export type PropertyQueryExecutor = {
  query<T extends RowDataPacket[] | ResultSetHeader = RowDataPacket[]>(
    sql: string,
    values?: unknown[]
  ): Promise<[T, unknown]>;
};

export class PropertyQueryParameterMismatchError extends Error {
  readonly placeholderCount: number;
  readonly parameterCount: number;

  constructor(placeholderCount: number, parameterCount: number) {
    super(
      `Consulta de imoveis possui ${placeholderCount} placeholders, mas recebeu ${parameterCount} parametros.`
    );
    this.name = 'PropertyQueryParameterMismatchError';
    this.placeholderCount = placeholderCount;
    this.parameterCount = parameterCount;
  }
}

/** Counts bind placeholders while ignoring SQL literals and comments. */
export function countPropertyQueryPlaceholders(sql: string): number {
  let count = 0;
  let index = 0;
  let state: 'normal' | 'singleQuote' | 'doubleQuote' | 'backtick' | 'lineComment' | 'blockComment' = 'normal';

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (state === 'normal') {
      if (current === "'") state = 'singleQuote';
      else if (current === '"') state = 'doubleQuote';
      else if (current === '`') state = 'backtick';
      else if (current === '-' && next === '-') {
        state = 'lineComment';
        index += 1;
      } else if (current === '#') state = 'lineComment';
      else if (current === '/' && next === '*') {
        state = 'blockComment';
        index += 1;
      } else if (current === '?') count += 1;
    } else if (state === 'singleQuote' || state === 'doubleQuote') {
      const quote = state === 'singleQuote' ? "'" : '"';
      if (current === '\\') index += 1;
      else if (current === quote && next === quote) index += 1;
      else if (current === quote) state = 'normal';
    } else if (state === 'backtick') {
      if (current === '`' && next === '`') index += 1;
      else if (current === '`') state = 'normal';
    } else if (state === 'lineComment') {
      if (current === '\n' || current === '\r') state = 'normal';
    } else if (state === 'blockComment' && current === '*' && next === '/') {
      state = 'normal';
      index += 1;
    }

    index += 1;
  }

  return count;
}

export function assertPropertyQueryParameterArity(sql: string, params: readonly unknown[]): void {
  const placeholderCount = countPropertyQueryPlaceholders(sql);
  if (placeholderCount !== params.length) {
    throw new PropertyQueryParameterMismatchError(placeholderCount, params.length);
  }
}

export const propertyQueryExecutor: PropertyQueryExecutor = {
  query(sql, values) {
    assertPropertyQueryParameterArity(sql, values ?? []);
    return connection.query(sql, values as unknown[]) as Promise<[any, unknown]>;
  },
};

export async function runPropertyQuery<T extends RowDataPacket[] | ResultSetHeader = RowDataPacket[]>(
  sql: string,
  params: unknown[]
): Promise<T> {
  assertPropertyQueryParameterArity(sql, params);
  const result = await (connection.query as unknown as (
    querySql: string,
    queryParams: unknown[]
  ) => Promise<unknown>)(sql, params as unknown[]);

  if (Array.isArray(result)) {
    return result[0] as T;
  }

  return result as T;
}

export function getPropertyDbConnection(): Promise<PoolConnection> {
  return connection.getConnection();
}
