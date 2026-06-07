import { describe, expect, it } from 'vitest';

import {
  isTerrainAreaRequiredForType,
  resolveValidationFieldFromMessage,
  validateAreaByInputUnit,
} from '../../src/services/propertyCreationValidationService';

describe('propertyCreationValidationService', () => {
  it('resolves validation fields from friendly error messages', () => {
    expect(resolveValidationFieldFromMessage('Área construída é obrigatória.')).toBe('area_construida');
    expect(resolveValidationFieldFromMessage('Preço promocional de aluguel inválido.')).toBe(
      'promotional_rent_price'
    );
    expect(resolveValidationFieldFromMessage('Código não encontrado.')).toBe('code');
    expect(resolveValidationFieldFromMessage('Mensagem desconhecida')).toBeUndefined();
  });

  it('validates area by unit and returns null when the unit is not bounded', () => {
    expect(
      validateAreaByInputUnit(
        { valor: 120, unidade: 'm2', m2: 120 },
        'Área construída',
        { allowNull: false }
      )
    ).toBeNull();
  });

  it('identifies property types that require land area', () => {
    expect(isTerrainAreaRequiredForType('Terreno')).toBe(true);
    expect(isTerrainAreaRequiredForType('Chácara')).toBe(true);
    expect(isTerrainAreaRequiredForType('Apartamento')).toBe(false);
    expect(isTerrainAreaRequiredForType(null)).toBe(false);
  });
});
