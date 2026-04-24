import { describe, expect, it } from 'vitest';

import {
  resolveDocumentCategoryFromType,
  validateContractDocumentUpload,
} from '../../../src/modules/contracts/domain/contractDocumentValidation';

describe('contractDocumentValidation', () => {
  it('resolve categoria por tipo conhecido', () => {
    expect(resolveDocumentCategoryFromType('doc_identidade')).toBe('identidade');
    expect(resolveDocumentCategoryFromType('certidao_onus_acoes')).toBe('docs_imovel');
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
});
