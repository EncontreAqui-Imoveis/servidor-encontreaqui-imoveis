export type PropertyListingPurpose = 'sale' | 'rent' | null;

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

/** Builds only parameterized, owner-scoped filters for the private property listing. */
export function buildPropertyOwnerListingFilters(input: {
  ownerColumn: 'p.owner_id' | 'p.broker_id';
  ownerId: number;
  search?: unknown;
  purpose?: unknown;
}): PropertyOwnerListingFilters {
  const whereClauses = [`${input.ownerColumn} = ?`];
  const params: Array<string | number> = [input.ownerId];
  const search = String(input.search ?? '').trim();
  const purpose = normalizePropertyListingPurpose(input.purpose);

  if (search) {
    const like = `%${search}%`;
    whereClauses.push('(p.title LIKE ? OR p.code LIKE ?)');
    params.push(like, like);
  }
  if (purpose === 'sale') {
    whereClauses.push("LOWER(COALESCE(p.purpose, '')) LIKE ?");
    params.push('%vend%');
  } else if (purpose === 'rent') {
    whereClauses.push("LOWER(COALESCE(p.purpose, '')) LIKE ?");
    params.push('%alug%');
  }

  return { whereSql: whereClauses.join(' AND '), params };
}
