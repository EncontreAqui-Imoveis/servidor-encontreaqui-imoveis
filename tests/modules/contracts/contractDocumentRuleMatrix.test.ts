import { describe, expect, it } from 'vitest';

import { buildDocumentSlots } from '../../../src/controllers/ContractController';
import {
  isUploadBlockedForNotApplicableCategory,
  resolveDocumentRequirementMatrixForContract,
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

  it('comprovante de renda: obrigatório no comprador em aluguel e N/A em venda', () => {
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

  it('docs_imovel: obrigatório no vendedor em venda e N/A em aluguel', () => {
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

  it('comprovante de garantia: obrigatório no comprador em aluguel e N/A em venda', () => {
    const base = {
      side: 'buyer' as const,
      sellerInfo: {},
      buyerInfo: { estado_civil: 'Solteiro' },
    };
    const sale = resolveDocumentRequirements({ ...base, propertyPurpose: 'Venda' });
    const rent = resolveDocumentRequirements({ ...base, propertyPurpose: 'Locação' });

    expect(sale.find((item) => item.category === 'comprovante_garantia')).toMatchObject({
      applicability: 'not_applicable',
      required: false,
    });
    expect(rent.find((item) => item.category === 'comprovante_garantia')).toMatchObject({
      applicability: 'required',
      required: true,
    });
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

  it('não bloqueia upload em comprovante_renda para comprador solteiro em aluguel', () => {
    const ctx = {
      propertyPurpose: 'Aluguel',
      sellerInfo: { estado_civil: 'Solteiro' },
      buyerInfo: { estado_civil: 'Solteiro' },
    };
    const blocked = isUploadBlockedForNotApplicableCategory(
      'buyer',
      'comprovante_renda',
      ctx
    );
    expect(blocked).toEqual(
      expect.objectContaining({ blocked: false })
    );
  });

  it('bloqueia renda do comprador em venda', () => {
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
      expect.objectContaining({ blocked: true, reasonCode: 'COMPROVANTE_RENDA_NA_SALE_ONLY' })
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

  it('resolveDocumentRequirementMatrixForContract expõe tipos aceitos por lado', () => {
    const matrix = resolveDocumentRequirementMatrixForContract({
      propertyPurpose: 'Aluguel',
      sellerInfo: { estado_civil: 'Casado' },
      buyerInfo: { estado_civil: 'Solteiro' },
    });

    const sellerIdentity = matrix.seller.find((item) => item.category === 'identidade');
    const buyerRent = matrix.buyer.find((item) => item.category === 'comprovante_renda');
    const sellerDocsImovel = matrix.seller.find((item) => item.category === 'docs_imovel');

    expect(sellerIdentity?.acceptedDocumentTypes).toEqual(
      expect.arrayContaining(['doc_identidade', 'cliente_cnh', 'cliente_identidade'])
    );
    expect(sellerIdentity?.preferredDocumentType).toBe('doc_identidade');
    expect(buyerRent?.required).toBe(true);
    expect(sellerDocsImovel?.applicability).toBe('not_applicable');
    expect(sellerDocsImovel?.acceptedDocumentTypes).toEqual(
      expect.arrayContaining(['certidao_inteiro_teor', 'certidao_onus_acoes'])
    );
  });

  it('expõe ônus e ações ao vendedor em venda e outro opcional para os dois lados', () => {
    const matrix = resolveDocumentRequirementMatrixForContract({
      propertyPurpose: 'Venda',
      sellerInfo: { estado_civil: 'Solteiro(a)' },
      buyerInfo: { estado_civil: 'Solteiro(a)' },
    });
    const slots = buildDocumentSlots(matrix, []);

    expect(slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          side: 'seller',
          documentCategory: 'docs_imovel',
          documentType: 'certidao_inteiro_teor',
          required: true,
        }),
        expect.objectContaining({
          side: 'seller',
          documentCategory: 'docs_imovel',
          documentType: 'certidao_onus_acoes',
          required: true,
        }),
        expect.objectContaining({
          side: 'seller',
          documentCategory: 'outro',
          documentType: 'outro',
          applicability: 'optional',
          required: false,
        }),
        expect.objectContaining({
          side: 'buyer',
          documentCategory: 'outro',
          documentType: 'outro',
          applicability: 'optional',
          required: false,
        }),
      ])
    );
  });
});
