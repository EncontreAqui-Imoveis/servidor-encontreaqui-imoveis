import { describe, expect, it, vi } from 'vitest';
import {
  assertAccountNameAvailable,
  DuplicateAccountNameError,
  normalizeAccountName,
} from '../../src/services/userAccountNameService';

describe('userAccountNameService', () => {
  it('normaliza apenas bordas e caixa do nome', () => {
    expect(normalizeAccountName('  Maria da Silva  ')).toBe('maria da silva');
  });

  it('consulta pelo nome normalizado e bloqueia uma conta já existente', async () => {
    const query = vi.fn().mockResolvedValue([[{ id: 7 }], undefined]);

    await expect(assertAccountNameAvailable({ query }, '  MARIA DA SILVA ')).rejects.toBeInstanceOf(
      DuplicateAccountNameError,
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(TRIM(name)) = ?'),
      ['maria da silva', 0, 0],
    );
  });

  it('permite o próprio nome durante uma atualização de perfil', async () => {
    const query = vi.fn().mockResolvedValue([[], undefined]);

    await expect(assertAccountNameAvailable({ query }, 'Maria da Silva', 7)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.any(String), ['maria da silva', 7, 7]);
  });
});
