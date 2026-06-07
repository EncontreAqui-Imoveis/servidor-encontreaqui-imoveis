import { describe, expect, it } from 'vitest';

import {
  calculateCommissionAmount,
  MAX_GENERIC_PROPERTY_TEXT_LENGTH,
  normalizeCepForPersistence,
  normalizeNumericCountField,
  normalizePropertyDescription,
  normalizeRecurrenceInterval,
  parseAreaWithUnit,
  parseDecimal,
  parseLocalizedDecimal,
  parseOptionalPrice,
  parsePrice,
  parsePromotionDate,
  parsePromotionDateTime,
  parsePromotionPercentage,
  resolveDealAmount,
  resolveRequiredField,
  validateMaxTextLength,
  validatePropertyNumericRange,
  validateAreaByInputUnit,
} from '../../src/services/propertyValidationCommon';

describe('propertyValidationCommon', () => {
  it('parses localized decimals and prices consistently', () => {
    expect(parseLocalizedDecimal('R$ 1.234,56')).toBe(1234.56);
    expect(parseDecimal('12,5')).toBe(12.5);
    expect(parsePrice('99,90')).toBe(99.9);
    expect(parseOptionalPrice('')).toBeNull();
    expect(resolveDealAmount('', 1500)).toBe(1500);
  });

  it('rejects invalid numeric values with explicit errors', () => {
    expect(() => parsePrice('-1')).toThrow('Preço inválido.');
    expect(() => parseDecimal('abc')).toThrow('Valor numérico inválido.');
  });

  it('validates text length and required field resolution', () => {
    expect(validateMaxTextLength('x'.repeat(MAX_GENERIC_PROPERTY_TEXT_LENGTH))).toBeNull();
    expect(validateMaxTextLength('x'.repeat(MAX_GENERIC_PROPERTY_TEXT_LENGTH + 1), 'Título')).toBe(
      'Título deve ter no máximo 120 caracteres.',
    );
    expect(resolveRequiredField({ title: '', description: 'x' })).toBe('title');
    expect(resolveRequiredField({ title: 'x', description: 'x', type: 'x', purpose: 'x', address: 'x', city: 'x', state: 'x' })).toBe('title');
  });

  it('normalizes property text, counts and CEP persistence', () => {
    expect(normalizePropertyDescription(' Linha 1\r\nLinha 2 ')).toBe('Linha 1\nLinha 2');
    expect(normalizeNumericCountField('sem', { label: 'Quartos', hasField: true })).toBe(0);
    expect(normalizeNumericCountField(3, { label: 'Quartos', hasField: true })).toBe(3);
    expect(normalizeCepForPersistence('12.345-678', 0)).toBe('12345678');
    expect(normalizeCepForPersistence('12.345-678', 1)).toBeNull();
  });

  it('handles promotion and recurrence helpers', () => {
    expect(parsePromotionPercentage('15')).toBe(15);
    expect(parsePromotionDateTime('2026-06-05T15:30:00-03:00')).toBe('2026-06-05 18:30:00');
    expect(parsePromotionDate('2026-06-05T15:30:00-03:00')).toBe('2026-06-05');
    expect(normalizeRecurrenceInterval('Monthly')).toBe('monthly');
    expect(calculateCommissionAmount(1000, 7.5)).toBe(75);
  });

  it('parses area with unit and validates area ranges', () => {
    const parsed = parseAreaWithUnit({ value: '2', unidade: 'hectares', label: 'Área do terreno' });

    expect(parsed).toEqual({
      valor: 2,
      unidade: 'hectare',
      m2: 20000,
    });
    expect(validateAreaByInputUnit(parsed, 'Área do terreno', { allowNull: false })).toBeNull();
    expect(validatePropertyNumericRange(10, 'Preço', { max: 20 })).toBeNull();
  });

  it('rejects invalid promotion input with the expected message', () => {
    expect(() => parsePromotionPercentage('0')).toThrow(
      'Percentual de promocao invalido. Use valor entre 0 e 100.',
    );
  });
});
