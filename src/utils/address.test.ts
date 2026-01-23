import { describe, expect, it } from 'vitest';

import { sanitizeAddressInput } from './address';

describe('sanitizeAddressInput', () => {
  it('sanitizes and validates required fields', () => {
    const result = sanitizeAddressInput({
      street: '  Rua Central ',
      number: ' 123A ',
      complement: ' Apt 12 ',
      bairro: ' Centro ',
      city: ' Goiania ',
      state: 'go',
      cep: '74.000-000',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.street).toBe('Rua Central');
      expect(result.value.number).toBe('123A');
      expect(result.value.complement).toBe('Apt 12');
      expect(result.value.bairro).toBe('Centro');
      expect(result.value.city).toBe('Goiania');
      expect(result.value.state).toBe('GO');
      expect(result.value.cep).toBe('74000000');
    }
  });

  it('fails when required fields are missing', () => {
    const result = sanitizeAddressInput({
      street: '',
      number: '',
      bairro: 'Centro',
      city: 'Goiania',
      state: 'GO',
      cep: '74000000',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('street');
      expect(result.errors).toContain('number');
    }
  });

  it('fails when cep is invalid', () => {
    const result = sanitizeAddressInput({
      street: 'Rua A',
      number: '10',
      bairro: 'Centro',
      city: 'Goiania',
      state: 'GO',
      cep: '12345',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('cep');
    }
  });

  it('fails when state is invalid', () => {
    const result = sanitizeAddressInput({
      street: 'Rua A',
      number: '10',
      bairro: 'Centro',
      city: 'Goiania',
      state: 'Goi',
      cep: '74000000',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('state');
    }
  });
});
