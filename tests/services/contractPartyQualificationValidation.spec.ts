import { describe, expect, it } from 'vitest';

import {
  normalizeContractPartyQualification,
  validateDifferentPartyCpfs,
} from '../../src/services/contractPartyQualificationValidation';

describe('contractPartyQualificationValidation', () => {
  it('normaliza telefone e aceita e-mail válido', () => {
    const party = { telefone: '(11) 99999-4444', email: 'contato@example.com' };
    expect(normalizeContractPartyQualification(party, 'sellerInfo')).toEqual({});
    expect(party.telefone).toBe('11999994444');
  });

  it('rejeita CPF, telefone e e-mail inválidos com erros por campo', () => {
    const fields = normalizeContractPartyQualification(
      { cpf: '111.111.111-11', telefone: '11999', email: 'aads@' },
      'buyerInfo',
    );
    expect(fields).toMatchObject({
      'buyerInfo.cpf': 'Informe um CPF válido.',
      'buyerInfo.telefone': 'Informe um telefone válido com DDD.',
      'buyerInfo.email': 'Informe um e-mail válido.',
    });
  });

  it('rejeita excedentes sem truncar', () => {
    const fields = normalizeContractPartyQualification({ profissao: 'x'.repeat(81) }, 'sellerInfo');
    expect(fields['sellerInfo.profissao']).toContain('80 caracteres');
  });

  it('impede CPF igual entre as partes', () => {
    expect(validateDifferentPartyCpfs({ cpf: '52998224725' }, { cpf: '529.982.247-25' }))
      .toMatchObject({ 'sellerInfo.cpf': expect.any(String), 'buyerInfo.cpf': expect.any(String) });
  });
});
