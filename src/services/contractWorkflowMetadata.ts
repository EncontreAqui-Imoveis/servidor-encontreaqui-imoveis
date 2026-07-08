export type ContractWorkflowAuditEvent = {
  action: string;
  at: string;
  by: number | null;
  role: string | null;
  details?: Record<string, unknown>;
};

const WORKFLOW_METADATA_RESET_KEYS = [
  'signatureMethod',
  'signatureMethodDeclaredAt',
  'signatureMethodDeclaredBy',
  'signatureMethodDeclaredByName',
  'signedContractUploadedOnlineAt',
  'signedContractUploadedOnlineBy',
  'agencySignedContractReceivedAt',
  'agencySignedContractReceivedBy',
] as const;

export function parseWorkflowMetadata(value: unknown): Record<string, unknown> {
  if (value == null) {
    return {};
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }

  if (typeof value !== 'string') {
    return {};
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    // Mantém compatibilidade com metadados legados inválidos.
  }

  return {};
}

export function mergeWorkflowMetadata(
  source: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...parseWorkflowMetadata(source),
    ...patch,
  };
}

export function appendWorkflowAuditEvent(
  source: unknown,
  event: ContractWorkflowAuditEvent
): Record<string, unknown> {
  const metadata = parseWorkflowMetadata(source);
  const current = Array.isArray(metadata.contractAuditTrail)
    ? metadata.contractAuditTrail
    : [];
  return {
    ...metadata,
    contractAuditTrail: [...current, event],
  };
}

export function resetWorkflowMetadata(
  source: unknown,
  keysToRemove: readonly string[] = WORKFLOW_METADATA_RESET_KEYS
): Record<string, unknown> | null {
  const metadata = parseWorkflowMetadata(source);
  const nextMetadata = { ...metadata };

  for (const key of keysToRemove) {
    delete nextMetadata[key];
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
}

