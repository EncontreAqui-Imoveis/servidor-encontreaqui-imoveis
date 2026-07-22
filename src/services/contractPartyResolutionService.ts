export type ContractInitiatorSide = 'buyer' | 'seller' | null;

export type ContractPartyProfile = {
  id: number;
  name: string | null;
  email: string | null;
  cpf: string | null;
  phone: string | null;
};

export type ContractPartyResolutionInput = {
  negotiation: {
    initiatorSide: ContractInitiatorSide;
    proposerId: number | null;
    advertiserId: number | null;
    legalBuyerUserId: number | null;
    buyerName: string | null;
    buyerCpf: string | null;
    buyerEmail: string | null;
  };
  property: {
    ownerId: number | null;
    ownerName: string | null;
    ownerPhone: string | null;
  };
  relatedUsers: {
    proposer: ContractPartyProfile | null;
    owner: ContractPartyProfile | null;
    legalBuyer: ContractPartyProfile | null;
  };
};

type PartyIdentityCapability = {
  canEditName: boolean;
  canEditCpf: boolean;
};

export type ContractPartyResolution = {
  sellerInfo: Record<string, string | null>;
  buyerInfo: Record<string, string | null>;
  legalBuyerUserId: number | null;
  metadata: {
    partyResolution: {
      initiatorSide: ContractInitiatorSide;
      legalBuyerUserId: number | null;
      seller: { nameSource: string; cpfSource: string };
      buyer: { nameSource: string; cpfSource: string; profileLinkedBy: 'verified_email' | null };
      identityCapabilities: {
        seller: PartyIdentityCapability;
        buyer: PartyIdentityCapability;
      };
    };
  };
};

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function profileInfo(profile: ContractPartyProfile | null): Record<string, string | null> {
  return {
    nome: text(profile?.name),
    cpf: text(profile?.cpf),
    email: text(profile?.email),
    telefone: text(profile?.phone),
  };
}

/** Resolves legal qualification only. Access is decided separately by contractAccessResolver. */
export function resolveContractParties(
  input: ContractPartyResolutionInput,
): ContractPartyResolution {
  const sellerInitiated = input.negotiation.initiatorSide === 'seller';
  const sellerProfile = sellerInitiated ? input.relatedUsers.proposer : input.relatedUsers.owner;
  const sellerFromProfile = profileInfo(sellerProfile);
  const sellerInfo = {
    ...sellerFromProfile,
    nome: sellerFromProfile.nome ?? text(input.property.ownerName),
    telefone: sellerFromProfile.telefone ?? text(input.property.ownerPhone),
  };

  if (!sellerInitiated) {
    const buyerFromProfile = profileInfo(input.relatedUsers.proposer);
    const buyerName = text(input.negotiation.buyerName) ?? buyerFromProfile.nome;
    return {
      sellerInfo,
      buyerInfo: {
        ...buyerFromProfile,
        // The proposal defines the legal buyer; the profile only identifies access.
        nome: buyerName,
      },
      legalBuyerUserId: input.negotiation.legalBuyerUserId,
      metadata: {
        partyResolution: {
          initiatorSide: input.negotiation.initiatorSide,
          legalBuyerUserId: input.negotiation.legalBuyerUserId,
          seller: {
            nameSource: sellerFromProfile.nome ? 'property_owner_profile' : 'property_legal_data',
            cpfSource: sellerFromProfile.cpf ? 'property_owner_profile' : 'missing',
          },
          buyer: {
            nameSource: text(input.negotiation.buyerName)
              ? 'proposal_legal_data'
              : buyerFromProfile.nome
                ? 'proposer_profile'
                : 'missing',
            cpfSource: buyerFromProfile.cpf ? 'proposer_profile' : 'missing',
            profileLinkedBy: null,
          },
          identityCapabilities: {
            seller: { canEditName: !sellerFromProfile.nome, canEditCpf: !sellerFromProfile.cpf },
            buyer: {
              canEditName: text(input.negotiation.buyerName)
                ? true
                : !buyerFromProfile.nome,
              canEditCpf: !buyerFromProfile.cpf,
            },
          },
        },
      },
    };
  }

  const buyerFromProfile = profileInfo(input.relatedUsers.legalBuyer);
  const linked = input.relatedUsers.legalBuyer != null;
  const buyerInfo = {
    // The e-mail lookup links an account but cannot replace the legal name.
    nome: text(input.negotiation.buyerName) ?? buyerFromProfile.nome,
    cpf: buyerFromProfile.cpf ?? text(input.negotiation.buyerCpf),
    email: buyerFromProfile.email ?? text(input.negotiation.buyerEmail),
    telefone: buyerFromProfile.telefone,
  };

  return {
    sellerInfo,
    buyerInfo,
    legalBuyerUserId: linked ? input.relatedUsers.legalBuyer!.id : null,
    metadata: {
      partyResolution: {
        initiatorSide: input.negotiation.initiatorSide,
        legalBuyerUserId: linked ? input.relatedUsers.legalBuyer!.id : null,
        seller: {
          nameSource: sellerFromProfile.nome ? 'proposer_profile' : 'property_legal_data',
          cpfSource: sellerFromProfile.cpf ? 'proposer_profile' : 'missing',
        },
        buyer: {
            nameSource: text(input.negotiation.buyerName)
              ? 'proposal_legal_data'
              : buyerFromProfile.nome
                ? 'verified_email_profile'
                : 'missing',
          cpfSource: buyerFromProfile.cpf ? 'verified_email_profile' : 'proposal_legal_data',
          profileLinkedBy: linked ? 'verified_email' : null,
        },
        identityCapabilities: {
          seller: { canEditName: !sellerFromProfile.nome, canEditCpf: !sellerFromProfile.cpf },
          buyer: {
            canEditName: text(input.negotiation.buyerName)
              ? true
              : !buyerFromProfile.nome,
            canEditCpf: !buyerFromProfile.cpf,
          },
        },
      },
    },
  };
}
