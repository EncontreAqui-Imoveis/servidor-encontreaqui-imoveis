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

  it('limpa payload malicioso em campos numéricos sem quebrar campos textuais', () => {
    const req = {
      query: { page: '1 OR 1=1' },
      params: { propertyId: '33;DROP TABLE properties;' },
      body: {
        owner_phone: '+55 (64) 99999-9999 --',
        bedrooms: '2; DELETE FROM users;',
        bathrooms: '3<script>alert(1)</script>',
        garage_spots: '1 union select',
        area_terreno: '450.70m2',
        tipo_lote: 'onmyown',
        title: "Casa ' OR 1=1 --",
      },
    } as unknown as Request;
    const res = {} as Response;
    let nextCalled = false;
    const next = (() => {
      nextCalled = true;
    }) as NextFunction;

    requestSanitizer(req, res, next);

    expect(nextCalled).toBe(true);
    expect(req.query.page).toBe('1 OR 1=1');
    expect(req.params.propertyId).toBe('33;DROP TABLE properties;');
    expect((req.body as any).owner_phone).toBe('5564999999999');
    expect((req.body as any).bedrooms).toBe('2');
    expect((req.body as any).bathrooms).toBe('31');
    expect((req.body as any).garage_spots).toBe('1');
    expect((req.body as any).area_terreno).toBe('450.70');
    expect((req.body as any).tipo_lote).toBe('');
    expect((req.body as any).title).toBe("Casa ' OR 1=1 --");
  });
});
