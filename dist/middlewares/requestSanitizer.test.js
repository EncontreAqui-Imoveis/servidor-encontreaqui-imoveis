"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const requestSanitizer_1 = require("./requestSanitizer");
(0, vitest_1.describe)('requestSanitizer', () => {
    (0, vitest_1.it)('remove caracteres de controle e normaliza campos numéricos de imóvel', () => {
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
        };
        const res = {};
        let nextCalled = false;
        const next = (() => {
            nextCalled = true;
        });
        (0, requestSanitizer_1.requestSanitizer)(req, res, next);
        (0, vitest_1.expect)(nextCalled).toBe(true);
        (0, vitest_1.expect)(req.query.search).toBe('casa');
        (0, vitest_1.expect)(req.params.id).toBe('12');
        (0, vitest_1.expect)(req.body.title).toBe('Casa Nova');
        (0, vitest_1.expect)(req.body.cep).toBe('75935000');
        (0, vitest_1.expect)(req.body.owner_phone).toBe('64999990000');
        (0, vitest_1.expect)(req.body.bedrooms).toBe('3');
        (0, vitest_1.expect)(req.body.area_construida).toBe('126,50');
    });
    (0, vitest_1.it)('limpa payload malicioso em campos numéricos sem quebrar campos textuais', () => {
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
        };
        const res = {};
        let nextCalled = false;
        const next = (() => {
            nextCalled = true;
        });
        (0, requestSanitizer_1.requestSanitizer)(req, res, next);
        (0, vitest_1.expect)(nextCalled).toBe(true);
        (0, vitest_1.expect)(req.query.page).toBe('1 OR 1=1');
        (0, vitest_1.expect)(req.params.propertyId).toBe('33;DROP TABLE properties;');
        (0, vitest_1.expect)(req.body.owner_phone).toBe('5564999999999');
        (0, vitest_1.expect)(req.body.bedrooms).toBe('2');
        (0, vitest_1.expect)(req.body.bathrooms).toBe('31');
        (0, vitest_1.expect)(req.body.garage_spots).toBe('1');
        (0, vitest_1.expect)(req.body.area_terreno).toBe('450.70');
        (0, vitest_1.expect)(req.body.tipo_lote).toBe('');
        (0, vitest_1.expect)(req.body.title).toBe("Casa ' OR 1=1 --");
    });
});
