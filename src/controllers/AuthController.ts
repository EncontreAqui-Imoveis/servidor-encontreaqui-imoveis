import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import admin from '../config/firebaseAdmin';
import connection from '../database/connection';

type ProfileType = 'client' | 'broker';

function buildUserPayload(row: any, profileType: ProfileType) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    address: row.address ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    role: profileType,
    broker_status: row.broker_status ?? null,
  };
}

function hasCompleteProfile(row: any) {
  return !!(row.phone && row.city && row.state && row.address);
}

function signToken(id: number, role: ProfileType) {
  return jwt.sign(
    { id, role },
    process.env.JWT_SECRET || 'default_secret',
    { expiresIn: '7d' },
  );
}

class AuthController {
  async register(req: Request, res: Response) {
    const {
      name,
      email,
      password,
      phone,
      address,
      city,
      state,
      profileType,
    } = req.body as Record<string, string>;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });
    }

    const normalizedProfile: ProfileType =
      profileType === 'broker' ? 'broker' : 'client';

    try {
      const [existingUserRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ?',
        [email],
      );
      if (existingUserRows.length > 0) {
        return res.status(409).json({ error: 'Este email já está em uso.' });
      }

      const passwordHash = await bcrypt.hash(password, 8);
      const [userResult] = await connection.query<ResultSetHeader>(
        `
          INSERT INTO users (name, email, password_hash, phone, address, city, state)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [name, email, passwordHash, phone ?? null, address ?? null, city ?? null, state ?? null],
      );

      const userId = userResult.insertId;

      if (normalizedProfile === 'broker') {
        await connection.query(
          'INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)',
          [userId, req.body.creci ?? '', 'pending_verification'],
        );
      }

      const token = signToken(userId, normalizedProfile);

      return res.status(201).json({
        user: buildUserPayload(
          { id: userId, name, email, phone, address, city, state },
          normalizedProfile,
        ),
        token,
        needsCompletion: !hasCompleteProfile({ phone, city, state, address }),
      });
    } catch (error) {
      console.error('Erro no registro:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async login(req: Request, res: Response) {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        `
          SELECT u.id, u.name, u.email, u.password_hash, u.phone, u.address, u.city, u.state,
                 CASE WHEN b.id IS NOT NULL THEN 'broker' ELSE 'client' END AS role,
                 b.status AS broker_status
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE u.email = ?
        `,
        [email],
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Credenciais inválidas.' });
      }

      const user = rows[0];
      const isPasswordCorrect = await bcrypt.compare(password, String(user.password_hash));

      if (!isPasswordCorrect) {
        return res.status(401).json({ error: 'Credenciais inválidas.' });
      }

      const profile: ProfileType = user.role === 'broker' ? 'broker' : 'client';
      const token = signToken(user.id, profile);

      return res.json({
        user: buildUserPayload(user, profile),
        token,
        needsCompletion: !hasCompleteProfile(user),
      });
    } catch (error) {
      console.error('Erro no login:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async google(req: Request, res: Response) {
    const { idToken, profileType } = req.body as { idToken?: string; profileType?: string };

    if (!idToken) {
      return res.status(400).json({ error: 'idToken do Google é obrigatório.' });
    }

    const requestedProfile: ProfileType | 'auto' =
      profileType === 'broker' ? 'broker' : profileType === 'client' ? 'client' : 'auto';
    const autoMode = requestedProfile === 'auto';

    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;
      const email = decoded.email;
      const displayName = decoded.name || decoded.email?.split('@')[0] || `User-${uid}`;

      if (!email) {
        return res.status(400).json({ error: 'Email não disponível no token do Google.' });
      }

      let requiresProfileChoice = false;
      const [existingRows] = await connection.query<RowDataPacket[]>(
        `SELECT u.id, u.name, u.email, u.phone, u.address, u.city, u.state, u.firebase_uid, u.role,
                b.id AS broker_id, b.status AS broker_status
           FROM users u
           LEFT JOIN brokers b ON u.id = b.id
          WHERE u.firebase_uid = ? OR u.email = ?
          LIMIT 1`,
        [uid, email],
      );

      let userId: number;
      let userName = displayName;
      let phone: string | null = null;
      let address: string | null = null;
      let city: string | null = null;
      let state: string | null = null;
      let hasBrokerRow = false;
      let createdNow = false;
      let blockedBrokerRequest = false;
      let effectiveProfile: ProfileType = requestedProfile === 'broker' ? 'broker' : 'client';
      let requiresDocuments = false;
      let roleLocked = false;
      let brokerStatus: string | null = null;

      if (existingRows.length > 0) {
        const row = existingRows[0];
        userId = row.id;
        userName = row.name || displayName;
        phone = row.phone ?? null;
        address = row.address ?? null;
        city = row.city ?? null;
        state = row.state ?? null;
        hasBrokerRow = !!row.broker_id;
        brokerStatus = row.broker_status ?? null;
        effectiveProfile = hasBrokerRow ? 'broker' : row.role === 'broker' ? 'broker' : 'client';
        blockedBrokerRequest = brokerStatus === 'rejected';

        if (!row.firebase_uid) {
          await connection.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, userId]);
        }
      } else {
        if (autoMode) {
          requiresProfileChoice = true;
        }
        const initialRole: ProfileType = requestedProfile === 'broker' ? 'broker' : 'client';
        const [result] = await connection.query<ResultSetHeader>(
          'INSERT INTO users (firebase_uid, email, name, role) VALUES (?, ?, ?, ?)',
          [uid, email, displayName, initialRole],
        );
        userId = result.insertId;
        createdNow = true;
        effectiveProfile = initialRole;
        if (initialRole === 'broker') {
          await connection.query(
            'INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)',
            [userId, null, 'pending_verification'],
          );
          brokerStatus = 'pending_verification';
          hasBrokerRow = true;
          requiresDocuments = true;
        }
      }

      if (!autoMode && requestedProfile === 'broker') {
        if (blockedBrokerRequest) {
          effectiveProfile = 'client';
          roleLocked = true;
        } else {
          effectiveProfile = 'broker';
          roleLocked = false;
          await connection.query('UPDATE users SET role = ? WHERE id = ?', [effectiveProfile, userId]);
          if (!hasBrokerRow) {
            await connection.query(
              'INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)',
              [userId, null, 'pending_verification'],
            );
            brokerStatus = 'pending_verification';
          } else {
            brokerStatus = brokerStatus ?? 'pending_verification';
          }
          requiresDocuments = (brokerStatus ?? '') !== 'approved';
        }
      } else if (!autoMode && requestedProfile === 'client') {
        effectiveProfile = 'client';
        roleLocked = false;
        await connection.query('UPDATE users SET role = ? WHERE id = ?', [effectiveProfile, userId]);
      } else if (autoMode) {
        roleLocked = true;
        requiresDocuments =
          effectiveProfile === 'broker' && (brokerStatus ?? '') !== 'approved';
      }

      const needsCompletion = !hasCompleteProfile({ phone, city, state, address });
      requiresDocuments =
        requiresDocuments ||
        (effectiveProfile === 'broker' && (brokerStatus ?? '') !== 'approved');

      if (autoMode && requiresProfileChoice) {
        return res.json({
          requiresProfileChoice: true,
          isNewUser: true,
          roleLocked,
          needsCompletion: true,
          requiresDocuments,
          pending: { email, name: displayName },
        });
      }

      const token = signToken(userId, effectiveProfile);

      return res.json({
        user: buildUserPayload(
          {
            id: userId,
            name: userName,
            email,
            phone,
            address,
            city,
            state,
            broker_status: brokerStatus,
          },
          effectiveProfile,
        ),
        token,
        needsCompletion,
        requiresDocuments,
        blockedBrokerRequest,
        roleLocked,
        isNewUser: createdNow,
      });
    } catch (error) {
      console.error('Erro no login com Google:', error);
      return res.status(401).json({ error: 'Token do Google inválido.' });
    }
  }
}

export const authController = new AuthController();
