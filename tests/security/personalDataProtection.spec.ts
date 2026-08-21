import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decryptCpf,
  decryptPersonalValue,
  encryptPersonalValue,
  hashCpfForLookup,
  maskCpf,
  matchesCpfLookupHash,
  normalizeCpf,
  protectCpf,
  protectCpfFieldsInJson,
  hydrateCpfFieldsInJson,
  resolveStoredCpf,
} from '../../src/security/personalDataProtection';

const originalEncryptionKey = process.env.PII_ENCRYPTION_KEY_V1;
const originalLookupKey = process.env.PII_LOOKUP_HMAC_KEY_V1;

describe('personalDataProtection', () => {
  beforeEach(() => {
    process.env.PII_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 17).toString('base64');
    process.env.PII_LOOKUP_HMAC_KEY_V1 = Buffer.alloc(32, 29).toString('base64');
  });

  afterEach(() => {
    if (originalEncryptionKey == null) delete process.env.PII_ENCRYPTION_KEY_V1;
    else process.env.PII_ENCRYPTION_KEY_V1 = originalEncryptionKey;
    if (originalLookupKey == null) delete process.env.PII_LOOKUP_HMAC_KEY_V1;
    else process.env.PII_LOOKUP_HMAC_KEY_V1 = originalLookupKey;
  });

  it('normaliza, cifra e decifra CPF com contexto autenticado', () => {
    const protectedCpf = protectCpf('123.456.789-09', 'users:cpf');

    expect(normalizeCpf('123.456.789-09')).toBe('12345678909');
    expect(protectedCpf?.ciphertext).not.toContain('12345678909');
    expect(decryptCpf(protectedCpf?.ciphertext, 'users:cpf')).toBe('12345678909');
    expect(maskCpf('123.456.789-09')).toBe('***.***.***-09');
  });

  it('recusa decriptar valor deslocado para outro contexto', () => {
    const encrypted = encryptPersonalValue('12345678909', 'users:cpf');
    expect(() => decryptPersonalValue(encrypted, 'contracts:buyer_info')).toThrow(
      'Nao foi possivel decifrar',
    );
  });

  it('gera busca deterministica sem persistir o CPF original', () => {
    const hash = hashCpfForLookup('123.456.789-09');
    expect(hash).toMatch(/^v1:[a-f0-9]{64}$/);
    expect(matchesCpfLookupHash('12345678909', hash)).toBe(true);
    expect(matchesCpfLookupHash('98765432100', hash)).toBe(false);
  });

  it('rejeita CPF incompleto sem cifrar ou hashear', () => {
    expect(protectCpf('123', 'users:cpf')).toBeNull();
    expect(hashCpfForLookup('123')).toBeNull();
  });

  it('mantem leitura compativel somente enquanto existir coluna legada', () => {
    expect(resolveStoredCpf(null, '123.456.789-09', 'users:cpf')).toBe('12345678909');
  });

  it('protege CPFs aninhados em JSON sem alterar os demais campos', () => {
    const stored = protectCpfFieldsInJson(
      { clientCpf: '123.456.789-09', name: 'Pessoa', spouse: { cpf: '98765432100' } },
      'negotiations:payment_details',
    ) as Record<string, unknown>;

    expect(stored.clientCpf).toBeNull();
    expect(stored.clientCpf_ciphertext).toBeTypeOf('string');
    expect(JSON.stringify(stored)).not.toContain('12345678909');
    expect(stored.name).toBe('Pessoa');

    expect(
      hydrateCpfFieldsInJson(stored, 'negotiations:payment_details'),
    ).toMatchObject({
      clientCpf: '12345678909',
      spouse: { cpf: '98765432100' },
    });
  });
});
