import { describe, expect, it } from 'vitest';

import {
  assertParticipantMutationAllowed,
  isContractWorkflowGuardError,
} from '../../src/services/contractWorkflowGuard';
import { resolveContractAccessContext } from '../../src/utils/contractAccessResolver';

const contract = {
  id: 'contract-1',
  advertiser_id: 10,
  proposer_id: 20,
  responsible_user_ids: null,
};

describe('contractWorkflowGuard', () => {
  it('permite participante somente em AWAITING_DOCS', () => {
    const context = resolveContractAccessContext(
      { id: 20, role: 'client' },
      { ...contract, status: 'AWAITING_DOCS' }
    );

    expect(() =>
      assertParticipantMutationAllowed({ status: 'AWAITING_DOCS' }, context, 'data_update')
    ).not.toThrow();
  });

  it('rejeita participante em confecção com CONTRACT_READ_ONLY', () => {
    const context = resolveContractAccessContext(
      { id: 20, role: 'client' },
      { ...contract, status: 'IN_DRAFT' }
    );

    try {
      assertParticipantMutationAllowed({ status: 'IN_DRAFT' }, context, 'document_upload');
      throw new Error('A guarda deveria rejeitar a mutação.');
    } catch (error) {
      expect(isContractWorkflowGuardError(error)).toBe(true);
      if (isContractWorkflowGuardError(error)) {
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe('CONTRACT_READ_ONLY');
      }
    }
  });

  it('mantém bypass explícito do administrador', () => {
    const admin = resolveContractAccessContext(
      { id: 1, role: 'admin' },
      { ...contract, status: 'FINALIZED' }
    );

    expect(() =>
      assertParticipantMutationAllowed({ status: 'FINALIZED' }, admin, 'document_delete')
    ).not.toThrow();
  });
});
