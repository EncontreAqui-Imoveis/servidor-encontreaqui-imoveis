"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushNotifications = sendPushNotifications;
const crypto_1 = __importDefault(require("crypto"));
const firebaseAdmin_1 = __importDefault(require("../config/firebaseAdmin"));
const connection_1 = __importDefault(require("../database/connection"));
const PUSH_BATCH_LIMIT = 500;
function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}
async function fetchDeviceTokens(recipientIds) {
    const params = [];
    let sql = 'SELECT DISTINCT fcm_token FROM user_device_tokens';
    if (recipientIds && recipientIds.length > 0) {
        const placeholders = recipientIds.map(() => '?').join(', ');
        sql += ` WHERE user_id IN (${placeholders})`;
        params.push(...recipientIds);
    }
    const [rows] = await connection_1.default.query(sql, params);
    return (rows ?? [])
        .map((row) => (row.fcm_token ?? '').trim())
        .filter((token) => token.length > 0);
}
async function removeInvalidTokens(tokens) {
    if (tokens.length === 0) {
        return;
    }
    await connection_1.default.query('DELETE FROM user_device_tokens WHERE fcm_token IN (?)', [tokens]);
}
async function sendPushNotifications(payload) {
    const tokens = await fetchDeviceTokens(payload.recipientIds);
    const errorCodes = new Set();
    const summary = {
        requested: tokens.length,
        success: 0,
        failure: 0,
        errorCodes: [],
    };
    if (tokens.length === 0) {
        return summary;
    }
    const batches = chunkArray(tokens, PUSH_BATCH_LIMIT);
    const notificationTag = crypto_1.default
        .createHash('sha1')
        .update(`${payload.relatedEntityType}:${payload.relatedEntityId ?? ''}:${payload.message}`)
        .digest('hex')
        .slice(0, 24);
    for (const batch of batches) {
        const response = await firebaseAdmin_1.default.messaging().sendEachForMulticast({
            tokens: batch,
            notification: {
                title: 'Mais Imóveis',
                body: payload.message,
            },
            android: {
                priority: 'high',
                collapseKey: notificationTag,
                notification: {
                    channelId: 'default_channel',
                    tag: notificationTag,
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                    },
                },
            },
            data: {
                message: payload.message,
                related_entity_type: payload.relatedEntityType,
                related_entity_id: payload.relatedEntityId != null ? String(payload.relatedEntityId) : '',
            },
        });
        const invalidTokens = [];
        response.responses.forEach((item, index) => {
            if (item.success) {
                return;
            }
            const code = item.error?.code ?? '';
            if (code) {
                errorCodes.add(code);
            }
            if (code === 'messaging/invalid-registration-token' ||
                code === 'messaging/registration-token-not-registered') {
                invalidTokens.push(batch[index]);
            }
        });
        if (response.failureCount > 0) {
            const batchErrorCodes = response.responses
                .map((item) => item.error?.code)
                .filter((code) => Boolean(code));
            console.warn('Falhas ao enviar push:', {
                failures: response.failureCount,
                codes: batchErrorCodes,
            });
        }
        if (invalidTokens.length > 0) {
            await removeInvalidTokens(invalidTokens);
        }
        summary.success += response.successCount;
        summary.failure += response.failureCount;
    }
    summary.errorCodes = Array.from(errorCodes);
    return summary;
}
