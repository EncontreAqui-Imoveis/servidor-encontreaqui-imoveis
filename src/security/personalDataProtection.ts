import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const CIPHER_VERSION = 'v1';
const AES_ALGORITHM = 'aes-256-gcm';
const AES_KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;

export type ProtectedCpf = {
  ciphertext: string;
  lookupHash: string;
  last4: string;
  keyVersion: typeof CIPHER_VERSION;
};

const CPF_FIELD_NAMES = new Set([
  'cpf',
  'clientcpf',
  'spousecpf',
  'spouse_cpf',
  'conjugecpf',
  'conjuge_cpf',
]);

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function readBase64Key(name: string, minimumBytes: number): Buffer {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    if (process.env.NODE_ENV === 'test') {
      // Test-only deterministic material keeps tests self-contained. Runtime
      // environments must always provide independently managed secrets.
      return Buffer.alloc(minimumBytes, name === 'PII_ENCRYPTION_KEY_V1' ? 71 : 83);
    }
    throw new Error(`${name} deve ser configurada para proteger dados pessoais.`);
  }

  let key: Buffer;
  try {
    key = Buffer.from(value, 'base64');
  } catch {
    throw new Error(`${name} deve ser uma chave codificada em base64.`);
  }

  if (key.length < minimumBytes) {
    throw new Error(`${name} deve possuir ao menos ${minimumBytes} bytes.`);
  }

  return key.length === minimumBytes ? key : key.subarray(0, minimumBytes);
}

function readEncryptionKey(): Buffer {
  return readBase64Key('PII_ENCRYPTION_KEY_V1', AES_KEY_BYTES);
}

function readLookupKey(): Buffer {
  return readBase64Key('PII_LOOKUP_HMAC_KEY_V1', AES_KEY_BYTES);
}

export function normalizeCpf(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

export function maskCpf(value: unknown): string | null {
  const cpf = normalizeCpf(value);
  return cpf ? `***.***.***-${cpf.slice(-2)}` : null;
}

export function hashCpfForLookup(value: unknown): string | null {
  const cpf = normalizeCpf(value);
  if (!cpf) {
    return null;
  }

  const digest = createHmac('sha256', readLookupKey()).update(cpf).digest('hex');
  return `${CIPHER_VERSION}:${digest}`;
}

export function encryptPersonalValue(value: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGORITHM, readEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CIPHER_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptPersonalValue(ciphertext: string, context: string): string {
  const [version, ivEncoded, tagEncoded, valueEncoded, ...unexpected] = String(ciphertext).split(':');
  if (
    version !== CIPHER_VERSION ||
    !ivEncoded ||
    !tagEncoded ||
    !valueEncoded ||
    unexpected.length > 0
  ) {
    throw new Error('Formato de dado pessoal protegido invalido.');
  }

  try {
    const decipher = createDecipheriv(
      AES_ALGORITHM,
      readEncryptionKey(),
      Buffer.from(ivEncoded, 'base64url'),
      { authTagLength: AUTH_TAG_BYTES },
    );
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(valueEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Nao foi possivel decifrar o dado pessoal protegido.');
  }
}

export function protectCpf(value: unknown, context: string): ProtectedCpf | null {
  const cpf = normalizeCpf(value);
  if (!cpf) {
    return null;
  }

  return {
    ciphertext: encryptPersonalValue(cpf, context),
    lookupHash: hashCpfForLookup(cpf) as string,
    last4: cpf.slice(-4),
    keyVersion: CIPHER_VERSION,
  };
}

export function decryptCpf(ciphertext: string | null | undefined, context: string): string | null {
  if (!ciphertext) {
    return null;
  }
  return normalizeCpf(decryptPersonalValue(ciphertext, context));
}

/**
 * Keeps reads compatible only while the audited backfill has not cleared the
 * legacy column. New writes must never populate `legacyCpf`.
 */
export function resolveStoredCpf(
  ciphertext: string | null | undefined,
  legacyCpf: string | null | undefined,
  context: string,
): string | null {
  if (ciphertext) {
    return decryptCpf(ciphertext, context);
  }
  return normalizeCpf(legacyCpf);
}

export function matchesCpfLookupHash(value: unknown, lookupHash: string | null | undefined): boolean {
  const expected = hashCpfForLookup(value);
  if (!expected || !lookupHash) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(lookupHash, 'utf8');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function isCpfField(field: string): boolean {
  return CPF_FIELD_NAMES.has(field.trim().toLowerCase());
}

function encryptedCpfField(field: string): string {
  return `${field}_ciphertext`;
}

/**
 * Replaces only CPF values inside a JSON DTO. The original key remains with a
 * null value so legacy SQL JSON paths cannot accidentally expose the value.
 */
export function protectCpfFieldsInJson<T>(value: T, context: string): T {
  const visit = (current: JsonValue, path: string): JsonValue => {
    if (Array.isArray(current)) {
      return current.map((item, index) => visit(item, `${path}[${index}]`));
    }
    if (current == null || typeof current !== 'object') {
      return current;
    }

    const result: { [key: string]: JsonValue } = {};
    for (const [field, fieldValue] of Object.entries(current)) {
      if (field.endsWith('_ciphertext')) {
        result[field] = fieldValue;
        continue;
      }

      const fieldPath = `${path}.${field}`;
      if (isCpfField(field)) {
        const protectedCpf = protectCpf(fieldValue, fieldPath);
        result[field] = null;
        if (protectedCpf) {
          result[encryptedCpfField(field)] = protectedCpf.ciphertext;
        }
        continue;
      }
      result[field] = visit(fieldValue, fieldPath);
    }
    return result;
  };

  return visit(value as JsonValue, context) as T;
}

/** Restores CPF fields only after the surrounding record has passed access checks. */
export function hydrateCpfFieldsInJson<T>(value: T, context: string): T {
  const visit = (current: JsonValue, path: string): JsonValue => {
    if (Array.isArray(current)) {
      return current.map((item, index) => visit(item, `${path}[${index}]`));
    }
    if (current == null || typeof current !== 'object') {
      return current;
    }

    const result: { [key: string]: JsonValue } = {};
    for (const [field, fieldValue] of Object.entries(current)) {
      if (field.endsWith('_ciphertext')) {
        continue;
      }

      const fieldPath = `${path}.${field}`;
      if (isCpfField(field)) {
        const encryptedValue = current[encryptedCpfField(field)];
        result[field] =
          typeof encryptedValue === 'string'
            ? decryptCpf(encryptedValue, fieldPath)
            : fieldValue;
        continue;
      }
      result[field] = visit(fieldValue, fieldPath);
    }
    return result;
  };

  return visit(value as JsonValue, context) as T;
}
