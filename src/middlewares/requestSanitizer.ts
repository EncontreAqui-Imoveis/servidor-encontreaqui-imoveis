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

function replaceObjectContents(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  for (const key of Object.keys(target)) {
    delete target[key];
  }

  for (const [key, value] of Object.entries(source)) {
    target[key] = value;
  }
}

function sanitizeDigitField(
  payload: Record<string, unknown>,
  field: string,
  options: { allowNegative?: boolean } = {}
): void {
  const value = payload[field];
  if (value == null || value === '') return;
  const regex = options.allowNegative ? /[^0-9-]/g : /\D/g;
  payload[field] = String(value).replace(regex, '');
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

function sanitizePropertyPayload(payload: Record<string, unknown>): void {
  sanitizeDigitField(payload, 'cep');
  sanitizeDigitField(payload, 'owner_phone');
  sanitizeDigitField(payload, 'broker_phone');
  sanitizeDigitField(payload, 'bedrooms', { allowNegative: true });
  sanitizeDigitField(payload, 'bathrooms', { allowNegative: true });
  sanitizeDigitField(payload, 'garage_spots', { allowNegative: true });

  sanitizeDecimalField(payload, 'price');
  sanitizeDecimalField(payload, 'price_sale');
  sanitizeDecimalField(payload, 'price_rent');
  sanitizeDecimalField(payload, 'area_construida');
  sanitizeDecimalField(payload, 'area_terreno');
}

export function requestSanitizer(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  if (req.query && typeof req.query === 'object') {
    replaceObjectContents(
      req.query as Record<string, unknown>,
      sanitizeUnknown(req.query) as Record<string, unknown>
    );
  }

  if (req.params && typeof req.params === 'object') {
    replaceObjectContents(
      req.params as Record<string, unknown>,
      sanitizeUnknown(req.params) as Record<string, unknown>
    );
  }

  req.body = sanitizeUnknown(req.body) as Request['body'];

  if (req.body && typeof req.body === 'object') {
    sanitizePropertyPayload(req.body as Record<string, unknown>);
  }

  next();
}
