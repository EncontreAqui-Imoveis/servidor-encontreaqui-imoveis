import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageState = vi.hoisted(() => ({
  puts: 0,
}));

vi.mock('@aws-sdk/client-s3', () => {
  class PutObjectCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  class GetObjectCommand {
    constructor(_input: Record<string, unknown>) {}
  }

  class DeleteObjectCommand {
    constructor(_input: Record<string, unknown>) {}
  }

  class HeadObjectCommand {
    constructor(_input: Record<string, unknown>) {}
  }

  class ListObjectsV2Command {
    constructor(_input: Record<string, unknown>) {}
  }

  class S3Client {
    async send(command: unknown) {
      if (command instanceof PutObjectCommand) {
        storageState.puts += 1;
        return { ETag: '"test-etag"' };
      }
      return {};
    }
  }

  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
  };
});

describe('negotiation document storage content integrity', () => {
  beforeEach(() => {
    vi.resetModules();
    storageState.puts = 0;
    process.env.NODE_ENV = 'test';
    process.env.R2_ACCOUNT_ID = 'local-account';
    process.env.R2_ACCESS_KEY_ID = 'local-key';
    process.env.R2_SECRET_ACCESS_KEY = 'local-secret';
    process.env.R2_BUCKET = 'local-bucket';
    process.env.R2_ENDPOINT = 'http://127.0.0.1:9000';
    process.env.R2_REGION = 'auto';
    process.env.R2_PREFIX = 'security-tests';
  });

  it('rejects a non-PDF payload declared as a PDF before storage is touched', async () => {
    const { storeNegotiationDocumentToR2 } = await import(
      '../../src/services/negotiationDocumentStorageService'
    );

    await expect(
      storeNegotiationDocumentToR2({
        executor: { execute: vi.fn() },
        negotiationId: 'neg-security-1',
        type: 'contract',
        documentType: 'contrato_assinado',
        content: Buffer.from('<html>not a pdf</html>'),
        contentType: 'application/pdf',
        metadataJson: { originalFileName: 'contrato.pdf' },
      })
    ).rejects.toMatchObject({
      code: 'DOCUMENT_CONTENT_TYPE_MISMATCH',
      statusCode: 422,
    });
    expect(storageState.puts).toBe(0);
  });

  it('rejects a non-image payload declared as JPEG before storage is touched', async () => {
    const { storeNegotiationDocumentToR2 } = await import(
      '../../src/services/negotiationDocumentStorageService'
    );

    await expect(
      storeNegotiationDocumentToR2({
        executor: { execute: vi.fn() },
        negotiationId: 'neg-security-2',
        type: 'other',
        documentType: 'documento_pessoal',
        content: Buffer.from('%PDF-1.7 but declared as image'),
        contentType: 'image/jpeg',
        metadataJson: { originalFileName: 'documento.jpg' },
      })
    ).rejects.toMatchObject({ code: 'DOCUMENT_CONTENT_TYPE_MISMATCH' });
    expect(storageState.puts).toBe(0);
  });

  it('stores a PDF whose binary signature matches the declared content type', async () => {
    const { storeNegotiationDocumentToR2 } = await import(
      '../../src/services/negotiationDocumentStorageService'
    );
    const execute = vi.fn().mockResolvedValue([{ insertId: 91 }, {}]);

    const documentId = await storeNegotiationDocumentToR2({
      executor: { execute },
      negotiationId: 'neg-security-3',
      type: 'contract',
      documentType: 'contrato_minuta',
      content: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj'),
      contentType: 'application/pdf',
      metadataJson: { originalFileName: 'minuta.pdf' },
    });

    expect(documentId).toBe(91);
    expect(storageState.puts).toBe(1);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('rejects an insecure R2 endpoint in production before a document is stored', async () => {
    process.env.NODE_ENV = 'production';
    const { storeNegotiationDocumentToR2 } = await import(
      '../../src/services/negotiationDocumentStorageService'
    );

    await expect(
      storeNegotiationDocumentToR2({
        executor: { execute: vi.fn() },
        negotiationId: 'neg-security-4',
        type: 'contract',
        documentType: 'contrato_minuta',
        content: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj'),
        contentType: 'application/pdf',
        metadataJson: { originalFileName: 'minuta.pdf' },
      })
    ).rejects.toThrow('R2_ENDPOINT deve usar HTTPS em produção');
    expect(storageState.puts).toBe(0);
  });
});
