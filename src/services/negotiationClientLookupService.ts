import type { Response } from 'express';
import type { AuthRequest } from '../middlewares/auth';

export async function lookupClientByCpf(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  if (!req.userId) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  // This compatibility endpoint intentionally never searches legal CPF data.
  // A qualification record must not be usable to discover another account's history.
  return res.status(200).json({
    found: false,
    clientName: null,
    clientPhone: null,
  });
}
