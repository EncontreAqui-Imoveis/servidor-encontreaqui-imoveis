import type { NextFunction, Request, Response } from 'express';

// Remove caracteres de controle perigosos sem alterar espaços/saltos de linha válidos.
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function sanitizeString(value: string): string {
  return value.replace(CONTROL_CHAR_REGEX, '');
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUnknown(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    output[key] = sanitizeUnknown(entry, depth + 1);
  }
  return output;
}

function sanitizeDigitField(
  payload: Record<string, unknown>,
  field: string
): void {
  const value = payload[field];
  if (value == null || value === '') return;
  payload[field] = String(value).replace(/\D/g, '');
}

function sanitizeDecimalField(
  payload: Record<string, unknown>,
  field: string
): void {
  const value = payload[field];
  if (value == null || value === '') return;
  const normalized = String(value);
  const match = normalized.match(/-?\d+(?:[.,]\d+)?/);
  payload[field] = match ? match[0] : '';
}

function sanitizeEnumField(
  payload: Record<string, unknown>,
  field: string,
  allowedValues: readonly string[]
): void {
  const value = payload[field];
  if (value == null || value === '') return;
  const normalized = String(value).trim().toLowerCase();
  payload[field] = allowedValues.includes(normalized) ? normalized : '';
}

function sanitizePropertyPayload(payload: Record<string, unknown>): void {
  sanitizeDigitField(payload, 'cep');
  sanitizeDigitField(payload, 'owner_phone');
  sanitizeDigitField(payload, 'broker_phone');
  sanitizeDigitField(payload, 'bedrooms');
  sanitizeDigitField(payload, 'bathrooms');
  sanitizeDigitField(payload, 'garage_spots');

  sanitizeDecimalField(payload, 'price');
  sanitizeDecimalField(payload, 'price_sale');
  sanitizeDecimalField(payload, 'price_rent');
  sanitizeDecimalField(payload, 'area_construida');
  sanitizeDecimalField(payload, 'area_terreno');
  sanitizeEnumField(payload, 'tipo_lote', ['meio', 'inteiro']);
}

export function requestSanitizer(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  req.query = sanitizeUnknown(req.query) as Request['query'];
  req.params = sanitizeUnknown(req.params) as Request['params'];
  req.body = sanitizeUnknown(req.body) as Request['body'];

  if (req.body && typeof req.body === 'object') {
    sanitizePropertyPayload(req.body as Record<string, unknown>);
  }

  next();
}
