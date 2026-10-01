import { describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

import { findApprovedContractDocument } from './contractApprovedDocumentInvariant';

function createTx(rows: Array<Record<string, unknown>>) {
  return {
    query: vi.fn().mockResolvedValue([rows, []]),
  } as unknown as PoolConnection;
}

function documentRow(
  overrides: {
    id?: number;
    documentType?: string;
    side?: 'seller' | 'buyer';
    category?: string;
    status?: string;
  } = {}
) {
  return {
    id: overrides.id ?? 11,
    document_type: overrides.documentType ?? 'doc_identidade',
    metadata_json: {
      contractId: 'contract-1',
      owner_side: overrides.side ?? 'seller',
      documentCategory: overrides.category ?? 'identidade',
      categoryStatus: overrides.status ?? 'APPROVED',
    },
  };
}

function find(rows: Array<Record<string, unknown>>, overrides = {}) {
  return findApprovedContractDocument(createTx(rows), {
    contractId: 'contract-1',
    negotiationId: 'negotiation-1',
    side: 'seller',
    category: 'identidade',
    documentType: 'doc_identidade',
    ...overrides,
  });
}

describe('findApprovedContractDocument', () => {
  it('permite categoria sem documento, pendente ou rejeitado', async () => {
    await expect(find([])).resolves.toBeNull();
    await expect(find([documentRow({ status: 'PENDING' })])).resolves.toBeNull();
    await expect(find([documentRow({ status: 'REJECTED' })])).resolves.toBeNull();
  });

  it('encontra documento aprovado da mesma categoria e lado', async () => {
    await expect(find([documentRow({ id: 24 })])).resolves.toBe(24);
  });

  it('não confunde categoria, lado ou slot Outro diferentes', async () => {
    await expect(
      find([documentRow({ category: 'comprovante_endereco', documentType: 'comprovante_endereco' })])
    ).resolves.toBeNull();
    await expect(find([documentRow({ side: 'buyer' })])).resolves.toBeNull();
    await expect(
      find(
        [documentRow({ category: 'outro', documentType: 'cliente_outro_02' })],
        { category: 'outro', documentType: 'cliente_outro_01' }
      )
    ).resolves.toBeNull();
  });

  it('ignora o próprio documento durante a revisão', async () => {
    await expect(find([documentRow({ id: 24 })], { excludeDocumentId: 24 })).resolves.toBeNull();
  });
});
