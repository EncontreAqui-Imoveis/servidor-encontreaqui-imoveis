"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeAddressInput = sanitizeAddressInput;
exports.sanitizePartialAddressInput = sanitizePartialAddressInput;
const MAX_STREET = 255;
const MAX_NUMBER = 50;
const MAX_COMPLEMENT = 255;
const MAX_BAIRRO = 255;
const MAX_CITY = 100;
const CEP_LENGTH = 8;
const STATE_LENGTH = 2;
function normalizeText(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const text = String(value).trim().replace(/\s+/g, ' ');
    return text.length > 0 ? text : null;
}
function normalizeState(value) {
    const text = normalizeText(value);
    if (!text)
        return null;
    const normalized = text.toUpperCase().replace(/[^A-Z]/g, '');
    return normalized.length == STATE_LENGTH ? normalized : null;
}
function normalizeNumber(value) {
    const text = normalizeText(value);
    if (!text)
        return null;
    const normalized = text.replace(/\D/g, '');
    return normalized.length > 0 ? normalized : null;
}
function normalizeCep(value) {
    const text = normalizeText(value);
    if (!text)
        return null;
    const digits = text.replace(/\D/g, '');
    return digits.length == CEP_LENGTH ? digits : null;
}
function withinLimit(value, limit) {
    return value.length <= limit;
}
function sanitizeAddressInput(input) {
    const errors = [];
    const street = normalizeText(input.street);
    if (!street)
        errors.push('street');
    const number = normalizeNumber(input.number);
    if (!number)
        errors.push('number');
    const bairro = normalizeText(input.bairro);
    if (!bairro)
        errors.push('bairro');
    const city = normalizeText(input.city);
    if (!city)
        errors.push('city');
    const state = normalizeState(input.state);
    if (!state)
        errors.push('state');
    const cep = normalizeCep(input.cep);
    if (!cep)
        errors.push('cep');
    const complement = normalizeText(input.complement);
    if (street && !withinLimit(street, MAX_STREET))
        errors.push('street');
    if (number && !withinLimit(number, MAX_NUMBER))
        errors.push('number');
    if (bairro && !withinLimit(bairro, MAX_BAIRRO))
        errors.push('bairro');
    if (city && !withinLimit(city, MAX_CITY))
        errors.push('city');
    if (complement && !withinLimit(complement, MAX_COMPLEMENT))
        errors.push('complement');
    if (errors.length > 0) {
        return { ok: false, errors: Array.from(new Set(errors)) };
    }
    return {
        ok: true,
        value: {
            street: street,
            number: number,
            complement: complement ?? null,
            bairro: bairro,
            city: city,
            state: state,
            cep: cep,
        },
    };
}
function sanitizePartialAddressInput(input) {
    const errors = [];
    const value = {};
    if ('street' in input) {
        const street = normalizeText(input.street);
        if (!street || !withinLimit(street, MAX_STREET)) {
            errors.push('street');
        }
        else {
            value.street = street;
        }
    }
    if ('number' in input) {
        const number = normalizeNumber(input.number);
        if (!number || !withinLimit(number, MAX_NUMBER)) {
            errors.push('number');
        }
        else {
            value.number = number;
        }
    }
    if ('bairro' in input) {
        const bairro = normalizeText(input.bairro);
        if (!bairro || !withinLimit(bairro, MAX_BAIRRO)) {
            errors.push('bairro');
        }
        else {
            value.bairro = bairro;
        }
    }
    if ('city' in input) {
        const city = normalizeText(input.city);
        if (!city || !withinLimit(city, MAX_CITY)) {
            errors.push('city');
        }
        else {
            value.city = city;
        }
    }
    if ('state' in input) {
        const state = normalizeState(input.state);
        if (!state) {
            errors.push('state');
        }
        else {
            value.state = state;
        }
    }
    if ('cep' in input) {
        const cep = normalizeCep(input.cep);
        if (!cep) {
            errors.push('cep');
        }
        else {
            value.cep = cep;
        }
    }
    if ('complement' in input) {
        const complement = normalizeText(input.complement);
        if (complement && !withinLimit(complement, MAX_COMPLEMENT)) {
            errors.push('complement');
        }
        else {
            value.complement = complement ?? null;
        }
    }
    if (errors.length > 0) {
        return { ok: false, errors: Array.from(new Set(errors)) };
    }
    return { ok: true, value };
}
