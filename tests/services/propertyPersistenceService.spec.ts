import { describe, expect, it } from 'vitest';

import {
  assertPropertyQueryParameterArity,
  countPropertyQueryPlaceholders,
  PropertyQueryParameterMismatchError,
} from '../../src/services/propertyPersistenceService';

describe('propertyPersistenceService', () => {
  it('counts only bind placeholders, ignoring SQL literals and comments', () => {
    const sql = `
      SELECT '?' AS text_value, \`?\` AS identifier
      FROM properties
      WHERE city = ? -- ? ignored
        AND note = 'escaped \\'?\\''
        /* ? ignored */
        AND status = ?
    `;

    expect(countPropertyQueryPlaceholders(sql)).toBe(2);
    expect(() => assertPropertyQueryParameterArity(sql, ['Rio Verde', 'approved'])).not.toThrow();
  });

  it('rejects mismatched property query parameters before execution', () => {
    expect(() => assertPropertyQueryParameterArity('SELECT * FROM properties WHERE id = ? AND city = ?', [1]))
      .toThrow(PropertyQueryParameterMismatchError);

    try {
      assertPropertyQueryParameterArity('SELECT * FROM properties WHERE id = ? AND city = ?', [1]);
    } catch (error) {
      expect(error).toMatchObject({ placeholderCount: 2, parameterCount: 1 });
    }
  });
});
