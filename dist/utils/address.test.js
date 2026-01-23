"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const address_1 = require("./address");
(0, vitest_1.describe)('sanitizeAddressInput', () => {
    (0, vitest_1.it)('sanitizes and validates required fields', () => {
        const result = (0, address_1.sanitizeAddressInput)({
            street: '  Rua Central ',
            number: ' 123A ',
            complement: ' Apt 12 ',
            bairro: ' Centro ',
            city: ' Goiania ',
            state: 'go',
            cep: '74.000-000',
        });
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (result.ok) {
            (0, vitest_1.expect)(result.value.street).toBe('Rua Central');
            (0, vitest_1.expect)(result.value.number).toBe('123A');
            (0, vitest_1.expect)(result.value.complement).toBe('Apt 12');
            (0, vitest_1.expect)(result.value.bairro).toBe('Centro');
            (0, vitest_1.expect)(result.value.city).toBe('Goiania');
            (0, vitest_1.expect)(result.value.state).toBe('GO');
            (0, vitest_1.expect)(result.value.cep).toBe('74000000');
        }
    });
    (0, vitest_1.it)('fails when required fields are missing', () => {
        const result = (0, address_1.sanitizeAddressInput)({
            street: '',
            number: '',
            bairro: 'Centro',
            city: 'Goiania',
            state: 'GO',
            cep: '74000000',
        });
        (0, vitest_1.expect)(result.ok).toBe(false);
        if (!result.ok) {
            (0, vitest_1.expect)(result.errors).toContain('street');
            (0, vitest_1.expect)(result.errors).toContain('number');
        }
    });
    (0, vitest_1.it)('fails when cep is invalid', () => {
        const result = (0, address_1.sanitizeAddressInput)({
            street: 'Rua A',
            number: '10',
            bairro: 'Centro',
            city: 'Goiania',
            state: 'GO',
            cep: '12345',
        });
        (0, vitest_1.expect)(result.ok).toBe(false);
        if (!result.ok) {
            (0, vitest_1.expect)(result.errors).toContain('cep');
        }
    });
    (0, vitest_1.it)('fails when state is invalid', () => {
        const result = (0, address_1.sanitizeAddressInput)({
            street: 'Rua A',
            number: '10',
            bairro: 'Centro',
            city: 'Goiania',
            state: 'Goi',
            cep: '74000000',
        });
        (0, vitest_1.expect)(result.ok).toBe(false);
        if (!result.ok) {
            (0, vitest_1.expect)(result.errors).toContain('state');
        }
    });
});
