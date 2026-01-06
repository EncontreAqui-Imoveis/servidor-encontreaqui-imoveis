import { RowDataPacket } from 'mysql2';
import crypto from 'crypto';
import admin from '../config/firebaseAdmin';
import connection from '../database/connection';

const PUSH_BATCH_LIMIT = 500;

interface DeviceTokenRow extends RowDataPacket {
  fcm_token: string | null;
}

export interface PushNotificationPayload {
  message: string;
  recipientIds: number[] | null;
  relatedEntityType: string;
  relatedEntityId: number | null;
}

export interface PushNotificationResult {
  requested: number;
  success: number;
  failure: number;
  errorCodes: string[];
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchDeviceTokens(recipientIds: number[] | null): Promise<string[]> {
  const params: Array<number> = [];
  let sql = 'SELECT DISTINCT fcm_token FROM user_device_tokens';

  if (recipientIds && recipientIds.length > 0) {
    const placeholders = recipientIds.map(() => '?').join(', ');
    sql += ` WHERE user_id IN (${placeholders})`;
    params.push(...recipientIds);
  }

  const [rows] = await connection.query<DeviceTokenRow[]>(sql, params);
  return (rows ?? [])
    .map((row) => (row.fcm_token ?? '').trim())
    .filter((token) => token.length > 0);
}

async function removeInvalidTokens(tokens: string[]) {
  if (tokens.length === 0) {
    return;
  }
  await connection.query('DELETE FROM user_device_tokens WHERE fcm_token IN (?)', [tokens]);
}

export async function sendPushNotifications(
  payload: PushNotificationPayload,
): Promise<PushNotificationResult> {
  const tokens = await fetchDeviceTokens(payload.recipientIds);
  const errorCodes = new Set<string>();
  const summary: PushNotificationResult = {
    requested: tokens.length,
    success: 0,
    failure: 0,
    errorCodes: [],
  };

  if (tokens.length === 0) {
    return summary;
  }

  const batches = chunkArray(tokens, PUSH_BATCH_LIMIT);
  const notificationTag = crypto
    .createHash('sha1')
    .update(`${payload.relatedEntityType}:${payload.relatedEntityId ?? ''}:${payload.message}`)
    .digest('hex')
    .slice(0, 24);
  for (const batch of batches) {
    const response = await admin.messaging().sendEachForMulticast({
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

    const invalidTokens: string[] = [];
    response.responses.forEach((item, index) => {
      if (item.success) {
        return;
      }
      const code = item.error?.code ?? '';
      if (code) {
        errorCodes.add(code);
      }
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      ) {
        invalidTokens.push(batch[index]);
      }
    });

    if (response.failureCount > 0) {
      const batchErrorCodes = response.responses
        .map((item) => item.error?.code)
        .filter((code): code is string => Boolean(code));
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
