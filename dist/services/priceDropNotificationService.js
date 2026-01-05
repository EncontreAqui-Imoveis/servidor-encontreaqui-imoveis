"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyPriceDropIfNeeded = notifyPriceDropIfNeeded;
const connection_1 = __importDefault(require("../database/connection"));
const userNotificationService_1 = require("./userNotificationService");
const PRICE_DROP_THRESHOLD = 0.1;
const PRICE_DROP_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const PRICE_DROP_PREFIX = 'Preco reduzido';
function formatCurrency(value) {
    try {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    }
    catch (_) {
        return `R$ ${value.toFixed(2)}`;
    }
}
function calculateDrop(oldValue, newValue) {
    if (oldValue <= 0)
        return 0;
    return (oldValue - newValue) / oldValue;
}
async function notifyPriceDropIfNeeded({ propertyId, propertyTitle, previousSalePrice, newSalePrice, previousRentPrice, newRentPrice, }) {
    const saleDrop = previousSalePrice != null &&
        newSalePrice != null &&
        newSalePrice > 0 &&
        newSalePrice < previousSalePrice
        ? calculateDrop(previousSalePrice, newSalePrice)
        : 0;
    const rentDrop = previousRentPrice != null &&
        newRentPrice != null &&
        newRentPrice > 0 &&
        newRentPrice < previousRentPrice
        ? calculateDrop(previousRentPrice, newRentPrice)
        : 0;
    if (saleDrop < PRICE_DROP_THRESHOLD && rentDrop < PRICE_DROP_THRESHOLD) {
        return;
    }
    const [rows] = await connection_1.default.query('SELECT usuario_id FROM favoritos WHERE imovel_id = ?', [propertyId]);
    const recipients = (rows ?? [])
        .map((row) => Number(row.usuario_id))
        .filter((id) => Number.isFinite(id));
    if (recipients.length === 0) {
        return;
    }
    const cutoff = new Date(Date.now() - PRICE_DROP_COOLDOWN_MS);
    const allowedRecipients = await (0, userNotificationService_1.filterRecipientsByCooldown)(recipients, 'property', propertyId, PRICE_DROP_PREFIX, cutoff);
    if (allowedRecipients.length === 0) {
        return;
    }
    const title = propertyTitle?.trim() ? propertyTitle.trim() : `#${propertyId}`;
    let message = `${PRICE_DROP_PREFIX}: o imovel "${title}" ficou mais barato.`;
    if (saleDrop >= PRICE_DROP_THRESHOLD && rentDrop >= PRICE_DROP_THRESHOLD) {
        message += ` Venda: de ${formatCurrency(previousSalePrice)} para ${formatCurrency(newSalePrice)}.`;
        message += ` Aluguel: de ${formatCurrency(previousRentPrice)} para ${formatCurrency(newRentPrice)}.`;
    }
    else if (saleDrop >= PRICE_DROP_THRESHOLD) {
        message += ` Venda: de ${formatCurrency(previousSalePrice)} para ${formatCurrency(newSalePrice)}.`;
    }
    else if (rentDrop >= PRICE_DROP_THRESHOLD) {
        message += ` Aluguel: de ${formatCurrency(previousRentPrice)} para ${formatCurrency(newRentPrice)}.`;
    }
    await (0, userNotificationService_1.notifyUsers)({
        message,
        recipientIds: allowedRecipients,
        relatedEntityType: 'property',
        relatedEntityId: propertyId,
    });
}
