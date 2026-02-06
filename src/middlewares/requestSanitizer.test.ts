import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { requestSanitizer } from './requestSanitizer';

describe('requestSanitizer', () => {
  it('remove caracteres de controle e normaliza campos numéricos de imóvel', () => {
    const req = {
      query: { search: 'ca\0sa' },
      params: { id: '12\0' },
      body: {
        title: 'Casa\0 Nova',
        cep: '75935-000',
        owner_phone: '(64) 99999-0000',
        bedrooms: '3 quartos',
        area_construida: '126,50m2',
      },
    } as unknown as Request;
    const res = {} as Response;
    let nextCalled = false;
    const next = (() => {
      nextCalled = true;
    }) as NextFunction;

    requestSanitizer(req, res, next);

    expect(nextCalled).toBe(true);
    expect(req.query.search).toBe('casa');
    expect(req.params.id).toBe('12');
    expect((req.body as any).title).toBe('Casa Nova');
    expect((req.body as any).cep).toBe('75935000');
    expect((req.body as any).owner_phone).toBe('64999990000');
    expect((req.body as any).bedrooms).toBe('3');
    expect((req.body as any).area_construida).toBe('126,50');
  });
});
