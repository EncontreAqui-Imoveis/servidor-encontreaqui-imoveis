"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyUsers = notifyUsers;
exports.filterRecipientsByCooldown = filterRecipientsByCooldown;
const connection_1 = __importDefault(require("../database/connection"));
const pushNotificationService_1 = require("./pushNotificationService");
async function notifyUsers({ message, recipientIds, relatedEntityType, relatedEntityId = null, sendPush = true, }) {
    const trimmed = message.trim();
    if (!trimmed) {
        return null;
    }
    const uniqueRecipients = Array.from(new Set(recipientIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id))));
    if (uniqueRecipients.length === 0) {
        return null;
    }
    const values = uniqueRecipients.map((rid) => [
        trimmed,
        relatedEntityType,
        relatedEntityId,
        rid,
    ]);
    const batchSize = 500;
    for (let i = 0; i < values.length; i += batchSize) {
        const chunk = values.slice(i, i + batchSize);
        await connection_1.default.query(`
        INSERT INTO notifications (message, related_entity_type, related_entity_id, recipient_id)
        VALUES ?
      `, [chunk]);
    }
    if (!sendPush) {
        return null;
    }
    return (0, pushNotificationService_1.sendPushNotifications)({
        message: trimmed,
        recipientIds: uniqueRecipients,
        relatedEntityType,
        relatedEntityId,
    });
}
async function filterRecipientsByCooldown(recipientIds, relatedEntityType, relatedEntityId, messagePrefix, cutoff) {
    const uniqueRecipients = Array.from(new Set(recipientIds));
    if (uniqueRecipients.length === 0) {
        return [];
    }
    const placeholders = uniqueRecipients.map(() => '?').join(', ');
    const [rows] = await connection_1.default.query(`
      SELECT DISTINCT recipient_id
      FROM notifications
      WHERE recipient_id IN (${placeholders})
        AND related_entity_type = ?
        AND related_entity_id = ?
        AND message LIKE ?
        AND created_at >= ?
    `, [...uniqueRecipients, relatedEntityType, relatedEntityId, `${messagePrefix}%`, cutoff]);
    const blocked = new Set((rows ?? []).map((row) => Number(row.recipient_id)).filter((id) => Number.isFinite(id)));
    return uniqueRecipients.filter((id) => !blocked.has(id));
}
