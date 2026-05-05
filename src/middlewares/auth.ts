import { Request, Response, NextFunction } from 'express';
import connection from '../database/connection';
import { RowDataPacket } from 'mysql2';
import jwt from 'jsonwebtoken';
import { requireEnv } from '../config/env';

interface UserFromDB extends RowDataPacket {
  id: number;
  role: string;
  broker_status?: string;
  token_version?: number | string | null;
}

interface BrokerRoleRow extends RowDataPacket {
  status: string;
  profile_type?: string | null;
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

function normalizeTokenVersion(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.trunc(parsed);
}

function isTokenExpiredError(error: unknown): error is jwt.TokenExpiredError {
  if (error instanceof jwt.TokenExpiredError) {
    return true;
  }

  if (typeof error !== 'object' || error === null) {
    return false;
  }

  return (error as { name?: unknown }).name === 'TokenExpiredError';
}

function isAdminRoute(req: Request): boolean {
  const baseUrl = String(req.baseUrl ?? '');
  const path = String(req.path ?? '');
  const originalUrl = String(req.originalUrl ?? '');

  // Ignorar rotas de webhook que moram sob /admin
  if (originalUrl.includes('/webhook/')) {
    return false;
  }

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
    try {
      const [adminRows] = await connection.query<AdminFromDB[]>(
        'SELECT id, token_version FROM admins WHERE id = ? LIMIT 1',
        [adminId],
      );

      if (adminRows.length === 0) {
        return { exists: false, isActive: false, tokenVersion: 0 };
      }

      return {
        exists: true,
        isActive: true,
        tokenVersion: normalizeTokenVersion(adminRows[0].token_version),
      };
    } catch (fallbackError: any) {
      if (fallbackError?.code !== 'ER_BAD_FIELD_ERROR') {
        throw fallbackError;
      }

      const [adminRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM admins WHERE id = ? LIMIT 1',
        [adminId],
      );

      if (adminRows.length === 0) {
        return { exists: false, isActive: false, tokenVersion: 0 };
      }

      return { exists: true, isActive: true, tokenVersion: 1 };
    }
  }
}

async function validateUserSession(
  userId: number
): Promise<{ exists: boolean; tokenVersion: number }> {
  try {
    const [userRows] = await connection.query<UserFromDB[]>(
      'SELECT id, token_version FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (userRows.length === 0) {
      return { exists: false, tokenVersion: 0 };
    }

    return {
      exists: true,
      tokenVersion: normalizeTokenVersion(userRows[0].token_version),
    };
  } catch (error: any) {
    if (error?.code !== 'ER_BAD_FIELD_ERROR') {
      throw error;
    }

    const [userRows] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (userRows.length === 0) {
      return { exists: false, tokenVersion: 0 };
    }

    return { exists: true, tokenVersion: 1 };
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
    const rawDecodedRole = String(decoded.role ?? '').trim().toLowerCase();
    const decodedRole = rawDecodedRole === 'user' ? 'client' : rawDecodedRole;

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

    const decodedTokenVersion = Number(decoded.token_version);
    const normalizedTokenVersion =
      Number.isFinite(decodedTokenVersion) && decodedTokenVersion > 0
        ? Math.trunc(decodedTokenVersion)
        : 0;
    if (normalizedTokenVersion <= 0) {
      return res.status(401).json({
        error: 'Token invalido. Faca login novamente.',
      });
    }

    const userSession = await validateUserSession(decodedId);
    if (!userSession.exists) {
      return res.status(401).json({
        error: 'Sessao invalida. Faca login novamente.',
      });
    }
    if (normalizedTokenVersion !== userSession.tokenVersion) {
      return res.status(401).json({
        error: 'Sessao revogada. Faca login novamente.',
      });
    }

    if (decodedRole === 'broker' || decodedRole === 'auxiliary_administrative') {
      const [brokerRows] = await connection.query<BrokerRoleRow[]>(
        'SELECT status, profile_type FROM brokers WHERE id = ?',
        [decodedId]
      );
      const brokers = brokerRows;
      if (brokers.length > 0 && brokers[0].status === 'rejected') {
        return res.status(403).json({
          error:
            'Sua conta de corretor foi rejeitada. Voce pode enviar nova solicitacao de corretor pelo app.',
        });
      }
      if (brokers.length > 0) {
        const profileType = String(brokers[0].profile_type ?? 'BROKER').toUpperCase();
        if (profileType === 'AUXILIARY_ADMINISTRATIVE') {
          req.userRole = 'auxiliary_administrative';
        } else {
          req.userRole = 'broker';
        }
      }
    }

    return next();
  } catch (error) {
    if (isTokenExpiredError(error)) {
      return res.status(401).json({ error: 'Token inválido.' });
    }

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

    const [brokerRows] = await connection.query<BrokerRoleRow[]>(
      'SELECT status, profile_type FROM brokers WHERE id = ?',
      [req.userId]
    );
    const brokers = brokerRows;

    if (brokers.length === 0) {
      return res.status(403).json({
        error: 'Acesso negado. Rota exclusiva para corretores.',
      });
    }

    if (brokers[0].status !== 'approved') {
      return res.status(403).json({
        error:
          'Acesso negado. Conta de corretor nao aprovada. Se estiver rejeitada, envie nova solicitacao de corretor.',
      });
    }

    const profileType = String(brokers[0].profile_type ?? 'BROKER').toUpperCase();
    req.userRole = profileType === 'AUXILIARY_ADMINISTRATIVE' ? 'auxiliary_administrative' : 'broker';
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
