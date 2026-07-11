import type { Response } from 'express';
import type { AuthRequest } from '../middlewares/auth';

export async function lookupProposalConflict(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  if (!req.userId) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  const propertyId = Number(req.query.propertyId ?? req.query.property_id ?? 0);
  if (!Number.isFinite(propertyId) || propertyId <= 0) {
    return res.status(400).json({ error: 'propertyId inválido.' });
  }

  // Legal CPF is not an access key and may legitimately recur across proposals.
  // Keeping this compatibility response prevents CPF-based enumeration.
  return res.status(200).json({
    found: false,
    conflict: null,
  });
}
