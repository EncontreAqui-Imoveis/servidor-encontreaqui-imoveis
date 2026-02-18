"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyAdmins = notifyAdmins;
exports.createAdminNotification = createAdminNotification;
const connection_1 = __importDefault(require("../database/connection"));
const RELATED_ENTITY_TYPES = new Set([
    'property',
    'broker',
    'agency',
    'user',
    'announcement',
    'negotiation',
    'other',
]);
function isValidRelatedEntityType(value) {
    return RELATED_ENTITY_TYPES.has(value);
}
async function notifyAdmins(message, relatedEntityType, relatedEntityId) {
    if (!isValidRelatedEntityType(relatedEntityType)) {
        throw new Error(`Invalid related entity type: ${relatedEntityType}`);
    }
    const [rows] = await connection_1.default.query('SELECT id FROM admins');
    const adminIds = rows.map((row) => row.id);
    if (adminIds.length === 0) {
        return;
    }
    const values = adminIds.map((adminId) => [
        null,
        message,
        relatedEntityType,
        relatedEntityId,
        null,
        adminId,
        'admin',
        'admin',
    ]);
    await insertNotifications(values);
}
async function createAdminNotification({ type, title, message, relatedEntityId = null, metadata = null, }) {
    if (!isValidRelatedEntityType(type)) {
        throw new Error(`Invalid related entity type: ${type}`);
    }
    const trimmedTitle = title.trim();
    const trimmedMessage = message.trim();
    if (!trimmedTitle || !trimmedMessage) {
        return;
    }
    const [rows] = await connection_1.default.query('SELECT id FROM admins');
    const adminIds = rows.map((row) => row.id);
    if (adminIds.length === 0) {
        return;
    }
    const normalizedEntityId = relatedEntityId != null && Number.isFinite(relatedEntityId)
        ? Number(relatedEntityId)
        : null;
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    const values = adminIds.map((adminId) => [
        trimmedTitle,
        trimmedMessage,
        type,
        normalizedEntityId,
        metadataJson,
        adminId,
        'admin',
        'admin',
    ]);
    await insertNotifications(values);
}
async function insertNotifications(values) {
    try {
        await connection_1.default.query(`
        INSERT INTO notifications (
          title,
          message,
          related_entity_type,
          related_entity_id,
          metadata_json,
          recipient_id,
          recipient_type,
          recipient_role
        )
        VALUES ?
      `, [values]);
    }
    catch (error) {
        if (error?.code !== 'ER_BAD_FIELD_ERROR') {
            throw error;
        }
        const fallbackValues = values.map((row) => [
            row[1],
            row[2],
            row[3],
            row[5],
            row[6],
            row[7],
        ]);
        await connection_1.default.query(`
        INSERT INTO notifications (
          message,
          related_entity_type,
          related_entity_id,
          recipient_id,
          recipient_type,
          recipient_role
        )
        VALUES ?
      `, [fallbackValues]);
    }
}
