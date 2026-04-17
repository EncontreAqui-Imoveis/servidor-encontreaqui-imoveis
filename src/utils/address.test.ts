import { describe, expect, it } from 'vitest';

import { sanitizeAddressInput, sanitizePartialAddressInput } from './address';

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
      expect(result.value.number).toBe('123');
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

  it('fails when number has no digits', () => {
    const result = sanitizeAddressInput({
      street: 'Rua A',
      number: 'ABC',
      bairro: 'Centro',
      city: 'Goiania',
      state: 'GO',
      cep: '74000000',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
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

  it('accepts address without number when without_number is true', () => {
    const result = sanitizeAddressInput({
      street: 'Rua A',
      number: '',
      without_number: true,
      bairro: 'Centro',
      city: 'Goiania',
      state: 'GO',
      cep: '74000000',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.number).toBe('S/N');
    }
  });

  it('accepts address without complement (optional)', () => {
    const result = sanitizeAddressInput({
      street: 'Rua A',
      number: '10',
      bairro: 'Centro',
      city: 'Goiania',
      state: 'GO',
      cep: '74000000',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.complement).toBeNull();
    }
  });

  it('fails when without_number is false and number is missing', () => {
    const result = sanitizeAddressInput({
      street: 'Rua A',
      number: '',
      without_number: false,
      bairro: 'Centro',
      city: 'Goiania',
      state: 'GO',
      cep: '74000000',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('number');
    }
  });
});

describe('sanitizePartialAddressInput', () => {
  it('sets number to S/N when without_number is true', () => {
    const result = sanitizePartialAddressInput({
      without_number: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.number).toBe('S/N');
    }
  });

  it('requires number when without_number is false', () => {
    const result = sanitizePartialAddressInput({
      without_number: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('number');
    }
  });
});
