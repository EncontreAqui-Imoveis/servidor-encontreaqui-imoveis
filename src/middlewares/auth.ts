import { Request, Response, NextFunction } from 'express';
import connection from '../database/connection';
import { RowDataPacket } from 'mysql2';
import jwt from 'jsonwebtoken';
import { requireEnv } from '../config/env';

interface UserFromDB extends RowDataPacket {
  id: number;
  role: string;
  broker_status?: string;
}

interface AdminFromDB extends RowDataPacket {
  id: number;
  is_active?: number | boolean | null;
  token_version?: number | string | null;
}

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
  firebase_uid?: string;
  adminValidated?: boolean;
}

const jwtSecret = requireEnv('JWT_SECRET');

function isAdminRoute(req: Request): boolean {
  const baseUrl = String(req.baseUrl ?? '');
  const path = String(req.path ?? '');
  const originalUrl = String(req.originalUrl ?? '');
  return (
    baseUrl.startsWith('/admin') ||
    path.startsWith('/admin') ||
    originalUrl.startsWith('/admin')
  );
}

async function validateAdminAccount(
  adminId: number
): Promise<{ exists: boolean; isActive: boolean; tokenVersion: number }> {
  try {
    const [adminRows] = await connection.query<AdminFromDB[]>(
      'SELECT id, is_active, token_version FROM admins WHERE id = ? LIMIT 1',
      [adminId]
    );

    if (adminRows.length === 0) {
      return { exists: false, isActive: false, tokenVersion: 0 };
    }

    const admin = adminRows[0];
    const rawIsActive = admin.is_active;
    const isActive =
      rawIsActive == null ||
      rawIsActive === true ||
      rawIsActive === 1 ||
      String(rawIsActive).trim() === '1';
    const tokenVersionCandidate = Number(admin.token_version);
    const tokenVersion =
      Number.isFinite(tokenVersionCandidate) && tokenVersionCandidate > 0
        ? Math.trunc(tokenVersionCandidate)
        : 1;

    return { exists: true, isActive, tokenVersion };
  } catch (error: any) {
    if (error?.code !== 'ER_BAD_FIELD_ERROR') {
      throw error;
    }

    // Backward compatibility with legacy schema where admins.is_active does not exist.
    const [adminRows] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM admins WHERE id = ? LIMIT 1',
      [adminId]
    );

    if (adminRows.length === 0) {
      return { exists: false, isActive: false, tokenVersion: 0 };
    }

    return { exists: true, isActive: true, tokenVersion: 1 };
  }
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const { authorization } = req.headers;

  if (!authorization) {
    return res.status(401).json({ error: 'Token não fornecido.' });
  }

  const [scheme, token] = authorization.split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) {
    return res.status(401).json({ error: 'Token mal formatado.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as {
      id: number;
      role: string;
      token_version?: number;
    };

    const decodedId = Number(decoded.id);
    const decodedRole = String(decoded.role ?? '').trim().toLowerCase();

    if (!Number.isFinite(decodedId) || decodedId <= 0 || !decodedRole) {
      return res.status(401).json({ error: 'Token inválido.' });
    }

    req.userId = decodedId;
    req.userRole = decodedRole;
    req.adminValidated = false;

    if (decodedRole === 'admin') {
      const decodedTokenVersion = Number(decoded.token_version);
      const normalizedTokenVersion =
        Number.isFinite(decodedTokenVersion) && decodedTokenVersion > 0
          ? Math.trunc(decodedTokenVersion)
          : 0;
      if (normalizedTokenVersion <= 0) {
        return res.status(401).json({
          error: 'Token administrativo invalido.',
        });
      }

      const adminAccount = await validateAdminAccount(decodedId);
      if (!adminAccount.exists) {
        return res.status(403).json({
          error: 'Acesso negado. Administrador inválido.',
        });
      }
      if (!adminAccount.isActive) {
        return res.status(403).json({
          error: 'Acesso negado. Administrador desativado.',
        });
      }
      if (normalizedTokenVersion !== adminAccount.tokenVersion) {
        return res.status(401).json({
          error: 'Sessao administrativa revogada. Faca login novamente.',
        });
      }

      req.adminValidated = true;
      return next();
    }

    if (isAdminRoute(req)) {
      return res.status(403).json({
        error: 'Acesso negado. Rota exclusiva para administradores.',
      });
    }

    const [userRows] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE id = ? LIMIT 1',
      [decodedId]
    );
    if (userRows.length === 0) {
      return res.status(401).json({
        error: 'Sessao invalida. Faca login novamente.',
      });
    }

    if (decodedRole === 'broker') {
      const [brokerRows] = await connection.query(
        'SELECT status FROM brokers WHERE id = ?',
        [decodedId]
      );
      const brokers = brokerRows as any[];
      if (brokers.length > 0 && brokers[0].status === 'rejected') {
        return res.status(403).json({
          error:
            'Sua conta de corretor foi rejeitada. Para se registrar como cliente, use um email diferente.',
        });
      }
    }

    return next();
  } catch (error) {
    console.error('Erro de autenticação:', error);
    return res.status(401).json({ error: 'Token inválido.' });
  }
}

export async function isBroker(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    const [brokerRows] = await connection.query(
      'SELECT status FROM brokers WHERE id = ?',
      [req.userId]
    );
    const brokers = brokerRows as any[];

    if (brokers.length === 0) {
      const roleFromToken = String(req.userRole ?? '').trim().toLowerCase();
      if (roleFromToken === 'broker') {
        // Mantem compatibilidade com tokens antigos quando a linha de broker ainda nao existe.
        await connection.query(
          'INSERT IGNORE INTO brokers (id, creci, status) VALUES (?, ?, ?)',
          [req.userId, null, 'approved']
        );
        req.userRole = 'broker';
        return next();
      }

      return res.status(403).json({
        error: 'Acesso negado. Rota exclusiva para corretores.',
      });
    }

    if (brokers[0].status !== 'approved') {
      return res.status(403).json({
        error:
          'Acesso negado. Sua conta de corretor n??o foi aprovada ou foi rejeitada. Para se registrar como cliente, use um email diferente.',
      });
    }

    req.userRole = 'broker';
    return next();
  } catch (error) {
    console.error('Erro ao verificar status do corretor:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}

export function isAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (req.userRole !== 'admin' || req.adminValidated !== true) {
    return res.status(403).json({
      error: 'Acesso negado. Rota exclusiva para administradores.',
    });
  }
  return next();
}

export function isClient(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (req.userRole !== 'client') {
    return res.status(403).json({
      error: 'Acesso negado. Rota exclusiva para clientes.',
    });
  }
  return next();
}

export default AuthRequest;
