export const NOTIFICATION_TARGETS = [
  'property_details',
  'proposal_list',
  'proposal_details',
  'contracts_tab',
  'contract_details',
] as const;

export type NotificationTarget = (typeof NOTIFICATION_TARGETS)[number];

export type NotificationDeepLinkMetadata = Record<
  | 'schema_version'
  | 'target'
  | 'entity_id'
  | 'property_id'
  | 'negotiation_id'
  | 'contract_id'
  | 'notification_id',
  string
>;

export interface NotificationDeepLinkInput {
  target?: unknown;
  entityId?: unknown;
  propertyId?: unknown;
  negotiationId?: unknown;
  contractId?: unknown;
  metadata?: Record<string, unknown> | null;
  relatedEntityType?: string | null;
  relatedEntityId?: unknown;
}

const targetSet = new Set<string>(NOTIFICATION_TARGETS);
const identifierPattern = /^[A-Za-z0-9_-]{1,128}$/;

function readIdentifier(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }

  const normalized = String(value).trim();
  return identifierPattern.test(normalized) ? normalized : '';
}

function readMetadataIdentifier(metadata: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = readIdentifier(metadata[key]);
    if (value) return value;
  }
  return '';
}

function defaultTarget(relatedEntityType: string | null | undefined): NotificationTarget {
  switch ((relatedEntityType ?? '').trim()) {
    case 'property':
      return 'property_details';
    case 'negotiation':
      return 'proposal_details';
    default:
      return 'proposal_list';
  }
}

export function resolveNotificationTarget(
  target: unknown,
  relatedEntityType?: string | null,
): NotificationTarget {
  if (target == null || String(target).trim() === '') {
    return defaultTarget(relatedEntityType);
  }

  const normalized = String(target).trim();
  if (!targetSet.has(normalized)) {
    throw new Error(`Invalid notification target: ${normalized}`);
  }
  return normalized as NotificationTarget;
}

/**
 * Produces the only metadata shape that may reach the database or FCM.
 * Unknown fields are deliberately discarded to prevent private data leaks.
 */
export function buildNotificationDeepLinkMetadata(
  input: NotificationDeepLinkInput,
): NotificationDeepLinkMetadata {
  const metadata = input.metadata ?? {};
  const target = resolveNotificationTarget(
    input.target ?? metadata.target,
    input.relatedEntityType,
  );
  const propertyId =
    readIdentifier(input.propertyId) ||
    readMetadataIdentifier(metadata, 'property_id', 'propertyId');
  const negotiationId =
    readIdentifier(input.negotiationId) ||
    readMetadataIdentifier(metadata, 'negotiation_id', 'negotiationId');
  const contractId =
    readIdentifier(input.contractId) ||
    readMetadataIdentifier(metadata, 'contract_id', 'contractId');
  const routedEntityId =
    target === 'contract_details'
      ? contractId
      : target === 'proposal_details'
        ? negotiationId
        : target === 'property_details'
          ? propertyId
          : '';
  const entityId =
    readIdentifier(input.entityId) ||
    readMetadataIdentifier(metadata, 'entity_id', 'entityId') ||
    routedEntityId ||
    readIdentifier(input.relatedEntityId) ||
    contractId ||
    negotiationId ||
    propertyId;

  return {
    schema_version: '1',
    target,
    entity_id: entityId,
    property_id: propertyId,
    negotiation_id: negotiationId,
    contract_id: contractId,
    notification_id: '',
  };
}

export function withNotificationId(
  metadata: NotificationDeepLinkMetadata,
  notificationId: unknown,
): NotificationDeepLinkMetadata {
  const normalizedId = readIdentifier(notificationId);
  if (!normalizedId) {
    throw new Error('Invalid persisted notification id.');
  }

  return { ...metadata, notification_id: normalizedId };
}
