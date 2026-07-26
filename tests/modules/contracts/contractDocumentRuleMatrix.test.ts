import { describe, expect, it } from 'vitest';

import {
  buildContractDocumentProgress,
  buildDocumentSlots,
  mapDocument,
} from '../../../src/controllers/ContractController';
import {
  isUploadBlockedForNotApplicableCategory,
  resolveDocumentRequirementMatrixForContract,
  resolveDocumentRequirements,
  resolveMaritalBucket,
} from '../../../src/modules/contracts/domain/contractDocumentRuleMatrix';

describe('contractDocumentRuleMatrix', () => {
  const sellerInfo = { estado_civil: 'Solteiro(a)' };
  const buyerInfo = { estado_civil: 'Solteiro(a)' };

  it('resolveMaritalBucket: casado e união estável', () => {
    expect(resolveMaritalBucket({ estado_civil: 'Casado(a)' })).toBe('married');
    expect(resolveMaritalBucket({ estadoCivil: 'União Estável' })).toBe('stable_union');
    expect(resolveMaritalBucket({ estado_civil: 'Solteiro' })).toBe('single');
    expect(resolveMaritalBucket({})).toBe('unknown');
  });

  it('usa exclusivamente dealType para a renda do locatário', () => {
    const sale = resolveDocumentRequirements({
      side: 'buyer',
      dealType: 'sale',
      sellerInfo,
      buyerInfo,
    });
    const rent = resolveDocumentRequirements({
      side: 'buyer',
      dealType: 'rent',
      sellerInfo,
      buyerInfo,
    });

    expect(sale.find((item) => item.category === 'comprovante_renda')).toMatchObject({
      applicability: 'not_applicable',
      required: false,
    });
    expect(rent.find((item) => item.category === 'comprovante_renda')).toMatchObject({
      applicability: 'required',
      required: true,
    });
  });

  it('separa as certidões do vendedor conforme a modalidade canônica', () => {
    const sale = resolveDocumentRequirements({
      side: 'seller',
      dealType: 'sale',
      sellerInfo,
      buyerInfo,
    });
    const rent = resolveDocumentRequirements({
      side: 'seller',
      dealType: 'rent',
      sellerInfo,
      buyerInfo,
    });

    expect(sale.find((item) => item.category === 'certidao_inteiro_teor_escritura')).toMatchObject({
      applicability: 'required',
      required: true,
    });
    expect(sale.find((item) => item.category === 'certidao_onus_acoes')).toMatchObject({
      applicability: 'required',
      required: true,
    });
    expect(rent.find((item) => item.category === 'certidao_inteiro_teor_escritura')).toMatchObject({
      applicability: 'required',
      required: true,
    });
    expect(rent.find((item) => item.category === 'certidao_onus_acoes')).toMatchObject({
      applicability: 'not_applicable',
      required: false,
      reasonCode: 'CERTIDAO_ONUS_ACOES_NA_RENTAL_ONLY',
    });
  });

  it('não infere modalidade para contratos legados sem dealType', () => {
    const seller = resolveDocumentRequirements({
      side: 'seller',
      dealType: null,
      sellerInfo,
      buyerInfo,
    });
    const buyer = resolveDocumentRequirements({
      side: 'buyer',
      dealType: null,
      sellerInfo,
      buyerInfo,
    });

    expect(seller.find((item) => item.category === 'certidao_inteiro_teor_escritura')).toMatchObject({
      applicability: 'not_applicable',
      reasonCode: 'CERTIDAO_INTEIRO_TEOR_NA_DEAL_TYPE_UNRESOLVED',
    });
    expect(buyer.find((item) => item.category === 'comprovante_renda')).toMatchObject({
      applicability: 'not_applicable',
      reasonCode: 'COMPROVANTE_RENDA_NA_DEAL_TYPE_UNRESOLVED',
    });
  });

  it('dados bancários são obrigatórios apenas para o vendedor', () => {
    const base = { dealType: 'sale' as const, sellerInfo, buyerInfo };
    expect(resolveDocumentRequirements({ ...base, side: 'seller' }).find(
      (item) => item.category === 'dados_bancarios'
    )).toMatchObject({ applicability: 'required', required: true });
    expect(resolveDocumentRequirements({ ...base, side: 'buyer' }).find(
      (item) => item.category === 'dados_bancarios'
    )).toBeUndefined();
  });

  it('cônjuge é exigido apenas para casado ou união estável', () => {
    const married = resolveDocumentRequirements({
      side: 'buyer',
      dealType: 'sale',
      sellerInfo,
      buyerInfo: { estado_civil: 'Casado(a)' },
    });
    const single = resolveDocumentRequirements({
      side: 'buyer',
      dealType: 'sale',
      sellerInfo,
      buyerInfo,
    });
    expect(married.find((item) => item.category === 'conjuge_documentos')?.required).toBe(true);
    expect(single.find((item) => item.category === 'conjuge_documentos')?.required).toBe(false);
  });

  it('bloqueia upload do ônus em locação', () => {
    const rentContext = { dealType: 'rent' as const, sellerInfo, buyerInfo };
    expect(isUploadBlockedForNotApplicableCategory(
      'seller', 'certidao_onus_acoes', rentContext
    )).toEqual(expect.objectContaining({ blocked: true }));
  });

  it('exige seguro incêndio apenas do vendedor em locação', () => {
    const rentalSeller = resolveDocumentRequirements({
      side: 'seller',
      dealType: 'rent',
      sellerInfo,
      buyerInfo,
    });
    const saleSeller = resolveDocumentRequirements({
      side: 'seller',
      dealType: 'sale',
      sellerInfo,
      buyerInfo,
    });
    const rentalBuyer = resolveDocumentRequirements({
      side: 'buyer',
      dealType: 'rent',
      sellerInfo,
      buyerInfo,
    });

    expect(rentalSeller.find((item) => item.category === 'seguro_incendio')).toMatchObject({
      applicability: 'required',
      required: true,
      reasonCode: 'SEGURO_INCENDIO_REQUIRED_RENTAL',
    });
    expect(saleSeller.find((item) => item.category === 'seguro_incendio')).toMatchObject({
      applicability: 'not_applicable',
      required: false,
    });
    expect(rentalBuyer.find((item) => item.category === 'seguro_incendio')).toBeUndefined();
  });

  it('expõe slots independentes e normaliza o rótulo de inteiro teor', () => {
    const matrix = resolveDocumentRequirementMatrixForContract({
      dealType: 'sale',
      sellerInfo,
      buyerInfo,
    });
    const slots = buildDocumentSlots(matrix, []);

    expect(slots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        side: 'seller',
        documentCategory: 'certidao_inteiro_teor_escritura',
        documentType: 'certidao_inteiro_teor',
        label: 'Certidão de Inteiro Teor/Escritura',
        required: true,
      }),
      expect.objectContaining({
        side: 'seller',
        documentCategory: 'certidao_onus_acoes',
        documentType: 'certidao_onus_acoes',
        required: true,
      }),
      expect.objectContaining({ side: 'seller', documentCategory: 'outro', required: false }),
      expect.objectContaining({ side: 'buyer', documentCategory: 'outro', required: false }),
    ]));
  });

  it('separa pendências de envio de documentos enviados em análise', () => {
    const matrix = resolveDocumentRequirementMatrixForContract({
      dealType: 'sale',
      sellerInfo,
      buyerInfo,
    });
    const submittedIdentity = mapDocument({
      id: 43,
      type: 'other',
      document_type: 'doc_identidade',
      metadata_json: JSON.stringify({
        owner_side: 'seller',
        documentCategory: 'identidade',
        originalFileName: 'identidade.pdf',
        status: 'PENDING',
      }),
      created_at: '2026-07-24T10:00:00.000Z',
    } as never);

    const progress = buildContractDocumentProgress(
      [{ ...submittedIdentity, metadata: { documentCategory: 'identidade' } }],
      { dealType: 'sale', sellerInfo, buyerInfo }
    );

    expect(progress.seller.totals.submitted).toBe(1);
    expect(progress.seller.totals.rejected).toBe(0);
  });

  it('normaliza o metadado legado docs_imovel sem perder o documento armazenado', () => {
    const document = mapDocument({
      id: 42,
      type: 'other',
      document_type: 'certidao_inteiro_teor',
      metadata_json: JSON.stringify({
        owner_side: 'seller',
        documentCategory: 'docs_imovel',
        originalFileName: 'escritura.pdf',
      }),
      created_at: '2026-07-17T10:00:00.000Z',
    } as never);

    expect(document).toMatchObject({
      id: 42,
      documentType: 'certidao_inteiro_teor',
      documentCategory: 'certidao_inteiro_teor_escritura',
      originalFileName: 'escritura.pdf',
    });
  });
});
