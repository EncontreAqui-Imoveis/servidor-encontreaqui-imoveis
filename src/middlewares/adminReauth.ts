import { NextFunction, Response } from 'express';
import { RowDataPacket } from 'mysql2';
import connection from '../database/connection';
import type { AuthRequest } from './auth';
import { verifyAdminReauthToken } from '../services/adminControllerSupport';

function extractReauthHeader(req: AuthRequest): string {
  const raw =
    req.header('x-admin-reauth') ??
    req.header('x-admin-reauth-token') ??
    '';
  return raw.trim();
}

export async function requireAdminReauth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const token = extractReauthHeader(req);
  if (!token) {
    return res.status(401).json({
      error: 'Reautenticacao administrativa obrigatoria para esta acao.',
    });
  }

  try {
    const payload = verifyAdminReauthToken(token);
    const adminId = Number(req.userId);
    const payloadId = Number(payload.id);

    if (!Number.isFinite(adminId) || adminId <= 0 || payload.role !== 'admin') {
      return res.status(401).json({ error: 'Administrador nao autenticado.' });
    }

    if (payloadId !== adminId || payload.purpose !== 'destructive_action') {
      return res.status(403).json({ error: 'Token de reautenticacao invalido.' });
    }

    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT token_version FROM admins WHERE id = ? LIMIT 1',
      [adminId],
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Administrador nao encontrado.' });
    }

    const dbTokenVersion = Number(rows[0].token_version);
    if (!Number.isFinite(dbTokenVersion) || dbTokenVersion <= 0) {
      return res.status(401).json({ error: 'Sessao administrativa invalida.' });
    }

    if (dbTokenVersion !== Number(payload.token_version)) {
      return res.status(401).json({
        error: 'Reautenticacao expirada. Confirme sua senha novamente.',
      });
    }

    return next();
  } catch (error) {
    console.error('Erro ao validar reautenticacao administrativa:', error);
    return res.status(401).json({
      error: 'Reautenticacao invalida ou expirada. Confirme sua senha novamente.',
    });
  }
}
