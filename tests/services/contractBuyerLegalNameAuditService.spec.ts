import { describe, expect, it } from 'vitest';

import { buildBuyerLegalNameCorrection } from '../../src/services/contractBuyerLegalNameAuditService';

describe('contractBuyerLegalNameAuditService', () => {
  it('corrige somente o nome legado ainda idêntico ao perfil de acesso', () => {
    const correction = buildBuyerLegalNameCorrection({
      buyerInfo: { nome: 'Conta do Proponente', email: 'conta@example.com' },
      workflowMetadata: {
        partyResolution: {
          buyer: { nameSource: 'proposer_profile' },
          identityCapabilities: { buyer: { canEditName: false, canEditCpf: false } },
        },
      },
      proposalBuyerName: 'Comprador Jurídico',
      profileBuyerName: 'Conta do Proponente',
    });

    expect(correction?.buyerInfo.nome).toBe('Comprador Jurídico');
    expect(correction?.workflowMetadata).toMatchObject({
      partyResolution: {
        buyer: { nameSource: 'proposal_legal_data' },
        identityCapabilities: { buyer: { canEditName: true, canEditCpf: false } },
      },
    });
  });

  it('preserva correções manuais e registros sem fonte segura', () => {
    const base = {
      workflowMetadata: { partyResolution: { buyer: { nameSource: 'verified_email_profile' } } },
      proposalBuyerName: 'Comprador Jurídico',
      profileBuyerName: 'Conta vinculada',
    };

    expect(buildBuyerLegalNameCorrection({ ...base, buyerInfo: { nome: 'Correção manual' } })).toBeNull();
    expect(buildBuyerLegalNameCorrection({
      ...base,
      buyerInfo: { nome: 'Conta vinculada' },
      workflowMetadata: { partyResolution: { buyer: { nameSource: 'proposal_legal_data' } } },
    })).toBeNull();
  });
});
