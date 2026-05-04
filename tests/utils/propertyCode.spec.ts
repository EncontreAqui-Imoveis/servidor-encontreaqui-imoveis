import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, randomIntMock, randomUUIDMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  randomIntMock: vi.fn(),
  randomUUIDMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

vi.mock('node:crypto', () => ({
  randomInt: randomIntMock,
  randomUUID: randomUUIDMock,
}));

describe('propertyCode utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    randomUUIDMock.mockReturnValue('123e4567-e89b-12d3-a456-426614174000');
    randomIntMock.mockReturnValue(0);
  });

  it('generate and return unique public identifiers for new properties', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT 1 FROM properties WHERE public_code')) {
        return [[]];
      }
      return [[]];
    });

    const { allocatePublicPropertyIdentifiers, PUBLIC_PROPERTY_CODE_REGEX } = await import(
      '../../src/utils/propertyCode'
    );

    const result = await allocatePublicPropertyIdentifiers();

    expect(result.publicId).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(PUBLIC_PROPERTY_CODE_REGEX.test(result.publicCode)).toBe(true);
    expect(randomUUIDMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith(
      'SELECT 1 FROM properties WHERE public_code = ? LIMIT 1',
      [result.publicCode]
    );
  });

  it('retries until a unique public_code is available', async () => {
    let isFirstAttempt = true;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT 1 FROM properties WHERE public_code')) {
        if (isFirstAttempt) {
          isFirstAttempt = false;
          return [[{ id: 1 }]];
        }
        return [[]];
      }
      return [[]];
    });

    const { allocateNextPublicPropertyCode } = await import('../../src/utils/propertyCode');

    const publicCode = await allocateNextPublicPropertyCode();

    expect(publicCode).toBe('222222');
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('backfills legacy rows without public identifiers', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT id, public_id, public_code FROM properties')) {
        return [
          [
            {
              id: 11,
              public_id: null,
              public_code: null,
            },
          ],
        ];
      }

      if (sql.includes('SELECT 1 FROM properties WHERE public_code')) {
        return [[]];
      }

      if (sql.includes('UPDATE properties SET public_id = ?')) {
        return [{ affectedRows: 1 }];
      }

      return [[]];
    });

    const { ensurePublicPropertyIdentifiersForLegacyRows } = await import(
      '../../src/utils/propertyCode'
    );

    await ensurePublicPropertyIdentifiersForLegacyRows(100);

    const calls = queryMock.mock.calls.map(([query]) => String(query));
    expect(
      calls.some((query) =>
        query.includes('SELECT id, public_id, public_code FROM properties WHERE public_id IS NULL OR public_code IS NULL LIMIT ?')
      )
    ).toBe(true);
    expect(
      calls.some((query) =>
        query.includes('UPDATE properties SET public_id = ?, public_code = ? WHERE id = ?')
      )
    ).toBe(true);
  });
});
