import { describe, expect, it } from 'vitest';

import {
  isUploadBlockedForNotApplicableCategory,
  resolveDocumentRequirements,
  resolveMaritalBucket,
} from '../../../src/modules/contracts/domain/contractDocumentRuleMatrix';

describe('contractDocumentRuleMatrix', () => {
  it('resolveMaritalBucket: casado e união estável', () => {
    expect(resolveMaritalBucket({ estado_civil: 'Casado(a)' })).toBe('married');
    expect(
      resolveMaritalBucket({ estadoCivil: 'União Estável' })
    ).toBe('stable_union');
    expect(resolveMaritalBucket({ estado_civil: 'Solteiro' })).toBe('single');
    expect(resolveMaritalBucket({})).toBe('unknown');
  });

  it('comprovante de renda: obrigatório aluguel, N/A venda (comprador)', () => {
    const sale = resolveDocumentRequirements({
      side: 'buyer',
      propertyPurpose: 'Venda de imóvel',
      sellerInfo: {},
      buyerInfo: { estado_civil: 'Solteiro' },
    });
    const rent = resolveDocumentRequirements({
      side: 'buyer',
      propertyPurpose: 'Aluguel',
      sellerInfo: {},
      buyerInfo: { estado_civil: 'Solteiro' },
    });
    const crSale = sale.find((r) => r.category === 'comprovante_renda');
    const crRent = rent.find((r) => r.category === 'comprovante_renda');
    expect(crSale?.applicability).toBe('not_applicable');
    expect(crRent?.applicability).toBe('required');
  });

  it('docs_imovel: venda exige, aluguel N/A (vendedor)', () => {
    const sale = resolveDocumentRequirements({
      side: 'seller',
      propertyPurpose: 'Venda',
      sellerInfo: { estado_civil: 'Solteiro' },
      buyerInfo: {},
    });
    const rent = resolveDocumentRequirements({
      side: 'seller',
      propertyPurpose: 'aluguel',
      sellerInfo: { estado_civil: 'Solteiro' },
      buyerInfo: {},
    });
    expect(sale.find((r) => r.category === 'docs_imovel')?.applicability).toBe('required');
    expect(rent.find((r) => r.category === 'docs_imovel')?.applicability).toBe('not_applicable');
  });

  it('cônjuge: obrigatório só casado/união; solteiro N/A; unknown N/A cônjuge', () => {
    const married = resolveDocumentRequirements({
      side: 'buyer',
      propertyPurpose: 'Venda',
      sellerInfo: {},
      buyerInfo: { estado_civil: 'casado' },
    });
    const single = resolveDocumentRequirements({
      side: 'buyer',
      propertyPurpose: 'Venda',
      sellerInfo: {},
      buyerInfo: { estado_civil: 'Solteiro' },
    });
    const unk = resolveDocumentRequirements({
      side: 'buyer',
      propertyPurpose: 'Venda',
      sellerInfo: {},
      buyerInfo: {},
    });
    const m = married.find((r) => r.category === 'conjuge_documentos');
    const s = single.find((r) => r.category === 'conjuge_documentos');
    const u = unk.find((r) => r.category === 'conjuge_documentos');
    expect(m?.applicability).toBe('required');
    expect(s?.applicability).toBe('not_applicable');
    expect(u?.applicability).toBe('not_applicable');
  });

  it('bloqueia upload em categoria N/A', () => {
    const ctx = {
      propertyPurpose: 'Venda',
      sellerInfo: { estado_civil: 'Solteiro' },
      buyerInfo: { estado_civil: 'Solteiro' },
    };
    const blocked = isUploadBlockedForNotApplicableCategory(
      'buyer',
      'comprovante_renda',
      ctx
    );
    expect(blocked).toEqual(
      expect.objectContaining({ blocked: true, reasonCode: expect.any(String) })
    );
  });

  it('solteiro: cônjuge não entra no gate (required false)', () => {
    const req = resolveDocumentRequirements({
      side: 'buyer',
      propertyPurpose: 'Venda de imóvel',
      sellerInfo: {},
      buyerInfo: { estado_civil: 'Solteiro' },
    });
    const conj = req.find((r) => r.category === 'conjuge_documentos');
    expect(conj?.required).toBe(false);
  });
});
