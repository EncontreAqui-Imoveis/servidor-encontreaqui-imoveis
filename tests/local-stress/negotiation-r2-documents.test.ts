import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageState = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class PutObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  class GetObjectCommand {
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

  class HeadObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  class S3Client {
    async send(command: { input: Record<string, unknown> }) {
      const key = String(command.input.Key ?? '');
      const bucket = String(command.input.Bucket ?? '');
      const composedKey = `${bucket}/${key}`;

      if (command instanceof PutObjectCommand) {
        storageState.objects.set(composedKey, Buffer.from(command.input.Body as Buffer));
        return { ETag: '"fake-etag"' };
      }

      if (command instanceof GetObjectCommand) {
        const body = storageState.objects.get(composedKey);
        return {
          Body: {
            async transformToByteArray() {
              return Uint8Array.from(body ?? Buffer.alloc(0));
            },
          },
        };
      }

      if (command instanceof DeleteObjectCommand) {
        storageState.objects.delete(composedKey);
        return {};
      }

      if (command instanceof HeadObjectCommand) {
        if (!storageState.objects.has(composedKey)) {
          throw new Error('Object not found');
        }
        return {};
      }

      throw new Error('Unsupported S3 command in local stress test.');
    }
  }

  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
  };
});

describe('local stress: negotiation R2 documents', () => {
  beforeEach(() => {
    vi.resetModules();
    storageState.objects.clear();
    process.env.R2_ACCOUNT_ID = 'local-account';
    process.env.R2_ACCESS_KEY_ID = 'local-key';
    process.env.R2_SECRET_ACCESS_KEY = 'local-secret';
    process.env.R2_BUCKET = 'local-bucket';
    process.env.R2_ENDPOINT = 'http://localhost:9000';
    process.env.R2_REGION = 'auto';
    process.env.R2_PREFIX = 'stress-negotiation-docs';
  });

  it('handles repeated writes, concurrent reads, batch deletes and replay reads locally', async () => {
    const {
      storeNegotiationDocumentToR2,
      readNegotiationDocumentObject,
      deleteNegotiationDocumentObject,
    } = await import('../../src/services/negotiationDocumentStorageService');

    let nextInsertId = 1;
    const insertedRows: Array<{
      id: number;
      storage_provider: string;
      storage_bucket: string;
      storage_key: string;
    }> = [];

    const executor = {
      async execute(_sql: string, params?: unknown[]) {
        const row = {
          id: nextInsertId++,
          storage_provider: String(params?.[4] ?? 'R2'),
          storage_bucket: String(params?.[5] ?? 'local-bucket'),
          storage_key: String(params?.[6] ?? ''),
        };
        insertedRows.push(row);
        return [{ insertId: row.id }, {}];
      },
    };

    const startedAt = Date.now();
    for (let index = 0; index < 40; index += 1) {
      await storeNegotiationDocumentToR2({
        executor,
        negotiationId: `neg-stress-${index % 5}`,
        type: 'proposal',
        documentType: 'contrato_minuta',
        content: Buffer.from(`pdf-${index}`),
        metadataJson: {
          originalFileName: `proposal-${index}.pdf`,
        },
      });
    }
    const writeDurationMs = Date.now() - startedAt;

    expect(insertedRows).toHaveLength(40);
    expect(storageState.objects.size).toBe(40);

    const replayTarget = insertedRows[0];
    const replayResults = await Promise.all(
      Array.from({ length: 25 }, () =>
        readNegotiationDocumentObject(replayTarget)
      )
    );
    expect(replayResults.every((buffer) => buffer.length > 0)).toBe(true);

    const readResults = await Promise.all(
      insertedRows.map((row) => readNegotiationDocumentObject(row))
    );
    expect(readResults).toHaveLength(40);

    await Promise.all(
      insertedRows.map((row) => deleteNegotiationDocumentObject(row))
    );

    expect(storageState.objects.size).toBe(0);

    console.info('local stress r2 documents metrics', {
      writes: insertedRows.length,
      replayReads: replayResults.length,
      concurrentReads: readResults.length,
      writeDurationMs,
    });
  });
});
