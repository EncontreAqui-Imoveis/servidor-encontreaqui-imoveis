type JsonRecord = Record<string, unknown>;

export type BuyerLegalNameAuditInput = {
  buyerInfo: unknown;
  workflowMetadata: unknown;
  proposalBuyerName: string | null;
  profileBuyerName: string | null;
};

export type BuyerLegalNameCorrection = {
  buyerInfo: JsonRecord;
  workflowMetadata: JsonRecord;
  previousName: string;
  legalName: string;
};

function asRecord(value: unknown): JsonRecord {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as JsonRecord) }
    : {};
}

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');
}

function readBuyerName(buyerInfo: JsonRecord): string {
  return String(buyerInfo.nome ?? buyerInfo.clientName ?? buyerInfo.name ?? '').trim();
}

/**
 * Identifies only legacy, profile-derived names that can be safely replaced by
 * the legal buyer name already recorded in the proposal. Manual corrections
 * and ambiguous legacy records are intentionally left untouched.
 */
export function buildBuyerLegalNameCorrection(
  input: BuyerLegalNameAuditInput,
): BuyerLegalNameCorrection | null {
  const buyerInfo = asRecord(input.buyerInfo);
  const workflowMetadata = asRecord(input.workflowMetadata);
  const partyResolution = asRecord(workflowMetadata.partyResolution);
  const buyerResolution = asRecord(partyResolution.buyer);
  const nameSource = String(buyerResolution.nameSource ?? '').trim();
  const storedName = readBuyerName(buyerInfo);
  const legalName = String(input.proposalBuyerName ?? '').trim();
  const profileName = String(input.profileBuyerName ?? '').trim();

  if (
    !['proposer_profile', 'verified_email_profile'].includes(nameSource) ||
    !storedName ||
    !legalName ||
    !profileName ||
    normalizeName(storedName) !== normalizeName(profileName) ||
    normalizeName(storedName) === normalizeName(legalName)
  ) {
    return null;
  }

  const identityCapabilities = asRecord(partyResolution.identityCapabilities);
  const buyerCapabilities = asRecord(identityCapabilities.buyer);
  const correctedBuyerResolution = {
    ...buyerResolution,
    nameSource: 'proposal_legal_data',
    nameCorrectedAt: new Date().toISOString(),
    nameCorrectedBy: 'audit-contract-buyer-legal-names',
  };

  return {
    buyerInfo: { ...buyerInfo, nome: legalName },
    workflowMetadata: {
      ...workflowMetadata,
      partyResolution: {
        ...partyResolution,
        buyer: correctedBuyerResolution,
        identityCapabilities: {
          ...identityCapabilities,
          buyer: { ...buyerCapabilities, canEditName: true },
        },
      },
    },
    previousName: storedName,
    legalName,
  };
}
