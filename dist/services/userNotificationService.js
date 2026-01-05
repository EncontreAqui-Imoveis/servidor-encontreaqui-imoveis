"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyUsers = notifyUsers;
exports.filterRecipientsByCooldown = filterRecipientsByCooldown;
exports.splitRecipientsByRole = splitRecipientsByRole;
exports.resolveUserNotificationRole = resolveUserNotificationRole;
const connection_1 = __importDefault(require("../database/connection"));
const pushNotificationService_1 = require("./pushNotificationService");
const ACTIVE_BROKER_STATUSES = new Set(['pending_verification', 'approved']);
async function notifyUsers({ message, recipientIds, recipientRole, relatedEntityType, relatedEntityId = null, sendPush = true, }) {
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
        'user',
        recipientRole,
    ]);
    const batchSize = 500;
    for (let i = 0; i < values.length; i += batchSize) {
        const chunk = values.slice(i, i + batchSize);
        await connection_1.default.query(`
        INSERT INTO notifications (message, related_entity_type, related_entity_id, recipient_id, recipient_type, recipient_role)
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
async function filterRecipientsByCooldown(recipientIds, relatedEntityType, relatedEntityId, messagePrefix, cutoff, recipientRole) {
    const uniqueRecipients = Array.from(new Set(recipientIds));
    if (uniqueRecipients.length === 0) {
        return [];
    }
    const placeholders = uniqueRecipients.map(() => '?').join(', ');
    const [rows] = await connection_1.default.query(`
      SELECT DISTINCT recipient_id
      FROM notifications
      WHERE recipient_id IN (${placeholders})
        AND recipient_type = 'user'
        AND recipient_role = ?
        AND related_entity_type = ?
        AND related_entity_id = ?
        AND message LIKE ?
        AND created_at >= ?
    `, [...uniqueRecipients, recipientRole, relatedEntityType, relatedEntityId, `${messagePrefix}%`, cutoff]);
    const blocked = new Set((rows ?? []).map((row) => Number(row.recipient_id)).filter((id) => Number.isFinite(id)));
    return uniqueRecipients.filter((id) => !blocked.has(id));
}
async function splitRecipientsByRole(recipientIds) {
    const uniqueIds = Array.from(new Set(recipientIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))));
    if (uniqueIds.length === 0) {
        return { clientIds: [], brokerIds: [] };
    }
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const [rows] = await connection_1.default.query(`SELECT id, status FROM brokers WHERE id IN (${placeholders})`, uniqueIds);
    const brokerIds = new Set();
    for (const row of rows ?? []) {
        const brokerId = Number(row.id);
        if (!Number.isFinite(brokerId)) {
            continue;
        }
        const status = String(row.status ?? '').trim();
        if (ACTIVE_BROKER_STATUSES.has(status)) {
            brokerIds.add(brokerId);
        }
    }
    const clientIds = uniqueIds.filter((id) => !brokerIds.has(id));
    return { clientIds, brokerIds: Array.from(brokerIds) };
}
async function resolveUserNotificationRole(userId) {
    if (!Number.isFinite(userId)) {
        return 'client';
    }
    const [rows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ? LIMIT 1', [userId]);
    if (!rows || rows.length === 0) {
        return 'client';
    }
    const status = String(rows[0].status ?? '').trim();
    return ACTIVE_BROKER_STATUSES.has(status) ? 'broker' : 'client';
}
