import { describe, expect, it } from 'vitest';

import { toRows } from '../../../src/modules/negotiations/infra/sqlResultHelpers';

describe('sqlResultHelpers', () => {
  it('unwraps mysql tuple results into rows', () => {
    expect(toRows([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(toRows([[{ id: 2 }], { warningStatus: 0 } as never])).toEqual([{ id: 2 }]);
  });
});
