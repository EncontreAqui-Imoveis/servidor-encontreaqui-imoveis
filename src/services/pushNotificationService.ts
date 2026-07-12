import { RowDataPacket } from 'mysql2';
import crypto from 'crypto';
import admin from '../config/firebaseAdmin';
import connection from '../database/connection';
import type { NotificationDeepLinkMetadata } from './notificationDeepLinkMetadata';

const PUSH_BATCH_LIMIT = 500;

interface DeviceTokenRow extends RowDataPacket {
  user_id: number;
  fcm_token: string | null;
}

export interface PushNotificationRecipient {
  recipientId: number;
  metadata: NotificationDeepLinkMetadata;
}

export interface PushNotificationPayload {
  message: string;
  recipients: PushNotificationRecipient[];
  title?: string | null;
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

async function fetchDeviceTokens(recipientIds: number[]): Promise<Map<number, string[]>> {
  const uniqueRecipientIds = Array.from(new Set(recipientIds));
  if (uniqueRecipientIds.length === 0) return new Map();

  const placeholders = uniqueRecipientIds.map(() => '?').join(', ');
  const [rows] = await connection.query<DeviceTokenRow[]>(
    `SELECT user_id, fcm_token FROM user_device_tokens WHERE user_id IN (${placeholders})`,
    uniqueRecipientIds,
  );
  const tokensByRecipient = new Map<number, string[]>();
  for (const row of rows ?? []) {
    const recipientId = Number(row.user_id);
    const token = (row.fcm_token ?? '').trim();
    if (!Number.isFinite(recipientId) || !token) continue;
    const tokens = tokensByRecipient.get(recipientId) ?? [];
    tokens.push(token);
    tokensByRecipient.set(recipientId, tokens);
  }
  return tokensByRecipient;
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
  const recipients = payload.recipients.filter(
    (recipient) => Number.isFinite(Number(recipient.recipientId)),
  );
  const tokensByRecipient = await fetchDeviceTokens(
    recipients.map((recipient) => Number(recipient.recipientId)),
  );
  const errorCodes = new Set<string>();
  const summary: PushNotificationResult = {
    requested: 0,
    success: 0,
    failure: 0,
    errorCodes: [],
  };

  const requestedTokens = Array.from(tokensByRecipient.values()).reduce(
    (total, tokens) => total + tokens.length,
    0,
  );
  summary.requested = requestedTokens;
  if (requestedTokens === 0) {
    console.info('push_dispatch_skipped_no_tokens', {
      recipientCount: recipients.length,
    });
    return summary;
  }

  console.info('push_dispatch_started', {
    requestedTokens,
    recipientCount: recipients.length,
  });
  for (const recipient of recipients) {
    const tokens = tokensByRecipient.get(Number(recipient.recipientId)) ?? [];
    const notificationTag = crypto
      .createHash('sha1')
      .update(`${recipient.metadata.notification_id}:${payload.message}`)
      .digest('hex')
      .slice(0, 24);

    for (const batch of chunkArray(tokens, PUSH_BATCH_LIMIT)) {
      const response = await admin.messaging().sendEachForMulticast({
        tokens: batch,
        notification: {
          title: (payload.title ?? '').trim() || 'Encontre Aqui',
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
        // FCM permits string values only. This object is the canonical deep-link contract.
        data: recipient.metadata,
      });

      const invalidTokens: string[] = [];
      response.responses.forEach((item, index) => {
        if (item.success) return;
        const code = item.error?.code ?? '';
        if (code) errorCodes.add(code);
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
        const onlyStaleTokens = response.responses.every((item) => {
          if (item.success) return true;
          const code = item.error?.code ?? '';
          return code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered';
        });
        if (onlyStaleTokens) {
          console.info('push_stale_tokens_pruned', { batchFailures: response.failureCount, codes: batchErrorCodes });
        } else {
          console.warn('Falhas ao enviar push:', {
            failures: response.failureCount,
            codes: batchErrorCodes,
          });
        }
      }

      if (invalidTokens.length > 0) {
        await removeInvalidTokens(invalidTokens);
      }

      summary.success += response.successCount;
      summary.failure += response.failureCount;
    }
  }

  summary.errorCodes = Array.from(errorCodes);
  console.info('push_dispatch_finished', {
    requested: summary.requested,
    success: summary.success,
    failure: summary.failure,
    errorCodes: summary.errorCodes,
  });
  return summary;
}
