export type PropertyListingPurpose = 'sale' | 'rent' | null;
export type PropertyListingMarketStage = 'LAUNCH' | null;

export type PropertyOwnerListingFilters = {
  whereSql: string;
  params: Array<string | number>;
};

export function normalizePropertyListingPurpose(value: unknown): PropertyListingPurpose {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'sale') return 'sale';
  if (normalized === 'rent') return 'rent';
  return null;
}

export function normalizePropertyListingMarketStage(value: unknown): PropertyListingMarketStage {
  return String(value ?? '').trim().toUpperCase() === 'LAUNCH' ? 'LAUNCH' : null;
}

export function buildPropertyOwnerListingFilters(input: {
  ownerColumn?: 'p.owner_id' | 'p.broker_id';
  ownerColumns?: Array<'p.owner_id' | 'p.broker_id'>;
  ownerId: number;
  search?: unknown;
  purpose?: unknown;
  marketStage?: unknown;
}): PropertyOwnerListingFilters {
  const columns = input.ownerColumns ?? (input.ownerColumn ? [input.ownerColumn] : ['p.owner_id']);
  const ownerClause =
    columns.length > 1
      ? `(${columns.map((col) => `${col} = ?`).join(' OR ')})`
      : `${columns[0]} = ?`;
  const whereClauses = [ownerClause];
  const params: Array<string | number> = columns.map(() => input.ownerId);
  const search = String(input.search ?? '').trim();
  const purpose = normalizePropertyListingPurpose(input.purpose);
  const marketStage = normalizePropertyListingMarketStage(input.marketStage);

  if (search) {
    const like = `%${search}%`;
    whereClauses.push("(p.title LIKE ? OR COALESCE(p.public_code, '') LIKE ? OR COALESCE(p.code, '') LIKE ?)");
    params.push(like, like, like);
  }
  if (purpose === 'sale') {
    whereClauses.push("LOWER(COALESCE(p.purpose, '')) LIKE ?");
    params.push('%vend%');
  } else if (purpose === 'rent') {
    whereClauses.push("LOWER(COALESCE(p.purpose, '')) LIKE ?");
    params.push('%alug%');
  }
  if (marketStage === 'LAUNCH') {
    whereClauses.push("COALESCE(p.market_stage, 'STANDARD') = 'LAUNCH'");
  }

  return { whereSql: whereClauses.join(' AND '), params };
}
