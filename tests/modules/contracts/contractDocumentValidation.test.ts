import { describe, expect, it } from 'vitest';

import {
  resolveDocumentCategoryFromType,
  validateContractDocumentUpload,
} from '../../../src/modules/contracts/domain/contractDocumentValidation';

describe('contractDocumentValidation', () => {
  it('resolve categoria por tipo conhecido', () => {
    expect(resolveDocumentCategoryFromType('doc_identidade')).toBe('identidade');
    expect(resolveDocumentCategoryFromType('certidao_onus_acoes')).toBe('docs_imovel');
    expect(resolveDocumentCategoryFromType('dados_bancarios')).toBe('dados_bancarios');
  });

  it('valida upload com erros estruturados', () => {
    const result = validateContractDocumentUpload({
      file: {
        mimetype: 'text/plain',
        originalname: 'doc.txt',
        size: 100,
      },
      documentType: 'doc_identidade',
      category: 'identidade',
      side: null,
      requiresSide: true,
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('REJECTED');
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(['SIDE_REQUIRED', 'EXTENSION_INVALID', 'MIME_INVALID', 'FILE_TOO_SMALL'])
    );
  });

  it.each(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])(
    'aceita o MIME documental %s',
    (mimetype) => {
      const extension = mimetype === 'application/pdf' ? 'pdf' : mimetype.split('/')[1];
      const result = validateContractDocumentUpload({
        file: { mimetype, originalname: `documento.${extension}`, size: 1024 },
        documentType: 'doc_identidade',
        category: 'identidade',
        side: 'buyer',
        requiresSide: true,
      });

      expect(result.isValid).toBe(true);
    }
  );

  it('rejeita imagens fora da lista explícita de MIME', () => {
    const result = validateContractDocumentUpload({
      file: { mimetype: 'image/gif', originalname: 'documento.gif', size: 1024 },
      documentType: 'doc_identidade',
      category: 'identidade',
      side: 'buyer',
      requiresSide: true,
    });

    expect(result.isValid).toBe(false);
    expect(result.issues.map((item) => item.code)).toContain('MIME_INVALID');
  });
});
