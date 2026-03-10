import { randomUUID } from 'crypto';
import path from 'path';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

type DocumentStorageProvider = 'R2';

type StorageExecutor = {
  execute<T = unknown>(sql: string, params?: unknown[]): Promise<T | [T, unknown]>;
};

type InsertResult = {
  insertId?: number;
};

export type StoredNegotiationDocumentRow = {
  id?: number;
  negotiation_id: string;
  type: string;
  document_type: string | null;
  metadata_json: unknown;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  storage_content_type: string | null;
  storage_size_bytes: number | null;
  storage_etag: string | null;
  file_content?: Buffer | Uint8Array | null;
};

type UploadNegotiationDocumentParams = {
  executor: StorageExecutor;
  negotiationId: string;
  type: string;
  documentType: string | null;
  content: Buffer;
  metadataJson?: Record<string, unknown> | null;
};

type StoredObjectDescriptor = {
  provider: DocumentStorageProvider;
  bucket: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  etag: string | null;
};

let cachedR2Client: S3Client | null = null;

function parseJsonObjectSafe(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`${name} não configurado para armazenamento R2.`);
  }
  return value;
}

function getR2Config() {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
  const bucket = requireEnv('R2_BUCKET');
  const region = String(process.env.R2_REGION ?? 'auto').trim() || 'auto';
  const prefix = String(process.env.R2_PREFIX ?? 'negotiation-docs')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const endpoint =
    String(process.env.R2_ENDPOINT ?? '').trim() ||
    `https://${accountId}.r2.cloudflarestorage.com`;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    region,
    prefix,
    endpoint,
  };
}

function getR2Client(): S3Client {
  if (cachedR2Client) {
    return cachedR2Client;
  }

  const config = getR2Config();
  cachedR2Client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });

  return cachedR2Client;
}

function sanitizePathPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function resolveFileExtension(
  metadata: Record<string, unknown>,
  contentType: string
): string {
  const originalFileName = String(metadata.originalFileName ?? '').trim();
  const fromName = path.extname(originalFileName).replace(/^\./, '').toLowerCase();
  if (fromName) return fromName;

  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'bin';
}

function resolveContentType(
  type: string,
  documentType: string | null,
  metadata: Record<string, unknown>
): string {
  const originalFileName = String(metadata.originalFileName ?? '').trim().toLowerCase();
  const ext = path.extname(originalFileName).replace(/^\./, '');
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';

  const normalizedType = String(type ?? '').trim().toLowerCase();
  const normalizedDocumentType = String(documentType ?? '').trim().toLowerCase();
  if (
    normalizedType === 'proposal' ||
    normalizedType === 'contract' ||
    normalizedDocumentType === 'contrato_minuta' ||
    normalizedDocumentType === 'contrato_assinado'
  ) {
    return 'application/pdf';
  }

  return 'application/octet-stream';
}

function buildStorageKey(params: {
  negotiationId: string;
  documentType: string | null;
  metadata: Record<string, unknown>;
  contentType: string;
}): string {
  const config = getR2Config();
  const documentType = sanitizePathPart(
    String(params.documentType ?? 'documento').trim().toLowerCase() || 'documento'
  );
  const contractId = sanitizePathPart(String(params.metadata.contractId ?? '').trim());
  const extension = resolveFileExtension(params.metadata, params.contentType);
  const uniqueName = `${randomUUID()}.${extension}`;
  const parts = [config.prefix, 'negotiations', sanitizePathPart(params.negotiationId)];

  if (contractId) {
    parts.push('contracts', contractId);
  }

  parts.push(documentType, uniqueName);
  return parts.filter(Boolean).join('/');
}

async function putObject(params: {
  key: string;
  content: Buffer;
  contentType: string;
}): Promise<StoredObjectDescriptor> {
  const config = getR2Config();
  const client = getR2Client();
  const response = await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: params.key,
      Body: params.content,
      ContentType: params.contentType,
    })
  );

  return {
    provider: 'R2',
    bucket: config.bucket,
    key: params.key,
    contentType: params.contentType,
    sizeBytes: params.content.length,
    etag: response.ETag ?? null,
  };
}

export async function headNegotiationDocumentObject(row: Pick<
  StoredNegotiationDocumentRow,
  'storage_bucket' | 'storage_key'
>): Promise<void> {
  const bucket = String(row.storage_bucket ?? '').trim();
  const key = String(row.storage_key ?? '').trim();
  if (!bucket || !key) {
    throw new Error('Documento sem localização R2.');
  }

  const client = getR2Client();
  await client.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

export async function readNegotiationDocumentObject(
  row: Pick<
    StoredNegotiationDocumentRow,
    'storage_provider' | 'storage_bucket' | 'storage_key'
  >
): Promise<Buffer> {
  const provider = String(row.storage_provider ?? '').trim().toUpperCase();
  if (provider !== 'R2') {
    throw new Error('Documento sem storage R2 configurado.');
  }

  const bucket = String(row.storage_bucket ?? '').trim();
  const key = String(row.storage_key ?? '').trim();
  if (!bucket || !key) {
    throw new Error('Documento sem localização R2.');
  }

  const client = getR2Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  const bytes = await response.Body?.transformToByteArray?.();
  if (!bytes) {
    throw new Error('Falha ao ler documento no R2.');
  }

  return Buffer.from(bytes);
}

export async function deleteNegotiationDocumentObject(
  row: Pick<
    StoredNegotiationDocumentRow,
    'storage_provider' | 'storage_bucket' | 'storage_key'
  >
): Promise<void> {
  const provider = String(row.storage_provider ?? '').trim().toUpperCase();
  if (provider !== 'R2') {
    return;
  }

  const bucket = String(row.storage_bucket ?? '').trim();
  const key = String(row.storage_key ?? '').trim();
  if (!bucket || !key) {
    return;
  }

  const client = getR2Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

export async function storeNegotiationDocumentToR2(
  params: UploadNegotiationDocumentParams
): Promise<number> {
  const metadata = { ...(params.metadataJson ?? {}) };
  const contentType = resolveContentType(params.type, params.documentType, metadata);
  const storageKey = buildStorageKey({
    negotiationId: params.negotiationId,
    documentType: params.documentType,
    metadata,
    contentType,
  });

  const objectDescriptor = await putObject({
    key: storageKey,
    content: params.content,
    contentType,
  });

  try {
    const result = await params.executor.execute<InsertResult>(
      `
        INSERT INTO negotiation_documents (
          negotiation_id,
          type,
          document_type,
          metadata_json,
          file_content,
          storage_provider,
          storage_bucket,
          storage_key,
          storage_content_type,
          storage_size_bytes,
          storage_etag
        ) VALUES (?, ?, ?, CAST(? AS JSON), NULL, ?, ?, ?, ?, ?, ?)
      `,
      [
        params.negotiationId,
        params.type,
        params.documentType,
        JSON.stringify(metadata),
        objectDescriptor.provider,
        objectDescriptor.bucket,
        objectDescriptor.key,
        objectDescriptor.contentType,
        objectDescriptor.sizeBytes,
        objectDescriptor.etag,
      ]
    );

    const header = Array.isArray(result) ? result[0] : result;
    return Number(header?.insertId ?? 0);
  } catch (error) {
    await deleteNegotiationDocumentObject({
      storage_provider: objectDescriptor.provider,
      storage_bucket: objectDescriptor.bucket,
      storage_key: objectDescriptor.key,
    }).catch(() => undefined);
    throw error;
  }
}

export function parseNegotiationDocumentMetadata(value: unknown): Record<string, unknown> {
  return parseJsonObjectSafe(value);
}
