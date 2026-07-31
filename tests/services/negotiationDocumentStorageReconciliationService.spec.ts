import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  objects: [] as Array<Record<string, unknown>>,
  deletedKeys: [] as string[],
}));

vi.mock('../../src/database/connection', () => ({
  default: {
    query: vi.fn(async () => [state.rows, {}]),
  },
}));

vi.mock('@aws-sdk/client-s3', () => {
  class PutObjectCommand {
    constructor(_input: Record<string, unknown>) {}
  }
  class GetObjectCommand {
    constructor(_input: Record<string, unknown>) {}
  }
  class HeadObjectCommand {
    constructor(_input: Record<string, unknown>) {}
  }
  class ListObjectsV2Command {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class DeleteObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class S3Client {
    async send(command: unknown) {
      if (command instanceof ListObjectsV2Command) {
        return { Contents: state.objects, IsTruncated: false };
      }
      if (command instanceof DeleteObjectCommand) {
        state.deletedKeys.push(String(command.input.Key));
        return {};
      }
      return { ETag: 'test' };
    }
  }
  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    DeleteObjectCommand,
  };
});

describe('negotiation document storage reconciliation', () => {
  beforeEach(() => {
    vi.resetModules();
    state.rows = [];
    state.objects = [];
    state.deletedKeys = [];
    delete process.env.R2_RECONCILIATION_CONFIRM;
    process.env.NODE_ENV = 'test';
    process.env.R2_ACCOUNT_ID = 'local-account';
    process.env.R2_ACCESS_KEY_ID = 'local-key';
    process.env.R2_SECRET_ACCESS_KEY = 'local-secret';
    process.env.R2_BUCKET = 'documents-private';
    process.env.R2_ENDPOINT = 'http://127.0.0.1:9000';
    process.env.R2_REGION = 'auto';
    process.env.R2_PREFIX = 'negotiation-docs';
  });

  it('reports missing objects and orphans without exposing raw storage keys', async () => {
    state.rows = [
      {
        id: 10,
        negotiation_id: 'neg-1',
        storage_bucket: 'documents-private',
        storage_key: 'negotiation-docs/negotiations/neg-1/identidade/missing.pdf',
      },
      {
        id: 11,
        negotiation_id: 'neg-1',
        storage_bucket: 'documents-private',
        storage_key: 'negotiation-docs/negotiations/neg-1/identidade/exists.pdf',
      },
    ];
    state.objects = [
      {
        Key: 'negotiation-docs/negotiations/neg-1/identidade/exists.pdf',
        Size: 100,
      },
      {
        Key: 'negotiation-docs/negotiations/neg-2/outro/orphan.pdf',
        Size: 200,
      },
    ];

    const { reconcileNegotiationDocumentStorage } = await import(
      '../../src/services/negotiationDocumentStorageReconciliationService'
    );
    const result = await reconcileNegotiationDocumentStorage();

    expect(result.databaseReferences).toBe(2);
    expect(result.storageObjects).toBe(2);
    expect(result.missingStorageObjects).toEqual([
      expect.objectContaining({ documentId: 10, negotiationId: 'neg-1' }),
    ]);
    expect(result.missingStorageObjects[0].storageKeyFingerprint).not.toContain('missing.pdf');
    expect(result.orphanStorageObjects).toEqual([
      expect.objectContaining({ sizeBytes: 200 }),
    ]);
    expect(state.deletedKeys).toEqual([]);
  });

  it('deletes only an orphan within the managed R2 prefix when explicitly requested', async () => {
    state.rows = [
      {
        id: 12,
        negotiation_id: 'neg-2',
        storage_bucket: 'documents-private',
        storage_key: 'negotiation-docs/negotiations/neg-2/outro/exists.pdf',
      },
    ];
    state.objects = [
      {
        Key: 'negotiation-docs/negotiations/neg-2/outro/exists.pdf',
        Size: 100,
      },
      {
        Key: 'negotiation-docs/negotiations/neg-2/outro/orphan.pdf',
        Size: 200,
      },
    ];

    process.env.R2_RECONCILIATION_CONFIRM = 'DELETE_ORPHANS';
    const { reconcileNegotiationDocumentStorage } = await import(
      '../../src/services/negotiationDocumentStorageReconciliationService'
    );
    const result = await reconcileNegotiationDocumentStorage({ deleteOrphans: true });

    expect(result.deletedOrphanObjects).toBe(1);
    expect(result.failedOrphanDeletions).toBe(0);
    expect(state.deletedKeys).toEqual([
      'negotiation-docs/negotiations/neg-2/outro/orphan.pdf',
    ]);
  });

  it('refuses destructive reconciliation without the explicit operational confirmation', async () => {
    state.objects = [
      {
        Key: 'negotiation-docs/negotiations/neg-2/outro/orphan.pdf',
        Size: 200,
      },
    ];
    const { reconcileNegotiationDocumentStorage } = await import(
      '../../src/services/negotiationDocumentStorageReconciliationService'
    );

    await expect(reconcileNegotiationDocumentStorage({ deleteOrphans: true })).rejects.toThrow(
      'R2_RECONCILIATION_CONFIRM=DELETE_ORPHANS'
    );
    expect(state.deletedKeys).toEqual([]);
  });

  it('refuses to delete an entire managed prefix when the database has no document references', async () => {
    state.objects = [
      {
        Key: 'negotiation-docs/negotiations/neg-2/outro/orphan.pdf',
        Size: 200,
      },
    ];
    process.env.R2_RECONCILIATION_CONFIRM = 'DELETE_ORPHANS';
    const { reconcileNegotiationDocumentStorage } = await import(
      '../../src/services/negotiationDocumentStorageReconciliationService'
    );

    await expect(reconcileNegotiationDocumentStorage({ deleteOrphans: true })).rejects.toThrow(
      'o banco não possui referências de documentos'
    );
    expect(state.deletedKeys).toEqual([]);
  });
});
