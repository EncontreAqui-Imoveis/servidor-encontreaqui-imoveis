"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROPERTY_TYPE_LEGACY_UPDATES = exports.PROPERTY_TYPES = void 0;
exports.normalizePropertyType = normalizePropertyType;
exports.PROPERTY_TYPES = [
    'Casa',
    'Apartamento',
    'Terreno',
    'Flat',
    'Condomínio Fechado',
    'Área rural',
    'Rancho',
    'Galpão / Barracão',
    'Chácara',
    'Imóvel comercial',
    'Área comercial',
    'Cobertura / Penthouse',
    'Sobrado',
    'Kitnet',
    'Sala comercial',
    'Empresa',
    'Prédio',
];
const LEGACY_TYPE_MAP = {
    propriedaderural: 'Área rural',
    propriedadecomercial: 'Imóvel comercial',
    arearural: 'Área rural',
    areacomercial: 'Área comercial',
    imovelcomercial: 'Imóvel comercial',
    condominiofechado: 'Condomínio Fechado',
    galpao: 'Galpão / Barracão',
    barracao: 'Galpão / Barracão',
    galpaobarracao: 'Galpão / Barracão',
    chacara: 'Chácara',
    coberturapenthouse: 'Cobertura / Penthouse',
    penthouse: 'Cobertura / Penthouse',
};
function normalizeTypeKey(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}0-9]/gu, '')
        .toLowerCase();
}
function normalizePropertyType(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const direct = exports.PROPERTY_TYPES.find((type) => type === trimmed);
    if (direct) {
        return direct;
    }
    const key = normalizeTypeKey(trimmed);
    if (LEGACY_TYPE_MAP[key]) {
        return LEGACY_TYPE_MAP[key];
    }
    const normalizedDirect = exports.PROPERTY_TYPES.find((type) => normalizeTypeKey(type) === key);
    return normalizedDirect ?? null;
}
exports.PROPERTY_TYPE_LEGACY_UPDATES = [
    { from: 'Propriedade Rural', to: 'Área rural' },
    { from: 'Propriedade Comercial', to: 'Imóvel comercial' },
];
