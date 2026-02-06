import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import admin from '../config/firebaseAdmin';
import { requireEnv } from '../config/env';
import connection from '../database/connection';
import { sendPasswordResetEmail } from '../services/emailService';
import { sanitizeAddressInput } from '../utils/address';

const jwtSecret = requireEnv('JWT_SECRET');

type ProfileType = 'client' | 'broker';

function buildUserPayload(row: any, profileType: ProfileType) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    street: row.street ?? null,
    number: row.number ?? null,
    complement: row.complement ?? null,
    bairro: row.bairro ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    cep: row.cep ?? null,
    role: profileType,
    broker_status: row.broker_status ?? null,
  };
}

function hasCompleteProfile(row: any) {
  return !!(
    row.phone &&
    row.street &&
    row.number &&
    row.bairro &&
    row.city &&
    row.state &&
    row.cep
  );
}

function signToken(id: number, role: ProfileType) {
  return jwt.sign(
    { id, role },
    jwtSecret,
    { expiresIn: '7d' },
  );
}

function hashResetCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateResetCode(): string {
  const number = crypto.randomInt(100000, 1000000);
  return String(number);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout while waiting for ${label}`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

class AuthController {
  async checkEmail(req: Request, res: Response) {
    const email = String(req.query.email ?? req.body?.email ?? '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email e obrigatorio.' });
    }

    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT id, firebase_uid, password_hash FROM users WHERE email = ? LIMIT 1',
        [email],
      );
      const exists = rows.length > 0;
      const hasFirebaseUid = exists && rows[0].firebase_uid != null;
      const hasPassword = exists && !!rows[0].password_hash;
      return res.status(200).json({ exists, hasFirebaseUid, hasPassword });
    } catch (error) {
      console.error('Erro ao verificar email:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async requestPasswordReset(req: Request, res: Response) {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email e obrigatorio.' });
    }

    try {
      // 1. Check if user exists in SQL
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, firebase_uid FROM users WHERE email = ? LIMIT 1',
        [email],
      );

      if (rows.length === 0) {
        // Security: Don't reveal if user doesn't exist, but for now we follow existing pattern
        return res.status(404).json({ error: 'Email nao encontrado.' });
      }

      const user = rows[0];

      // 2. If user is Legacy (no firebase_uid), migrate them NOW.
      if (!user.firebase_uid) {
        try {
          // Check if user already exists in Firebase (edge case: registered in Firebase but not linked in SQL)
          let firebaseUser;
          try {
            firebaseUser = await admin.auth().getUserByEmail(email);
          } catch (e: any) {
            if (e.code === 'auth/user-not-found') {
              // Create user in Firebase
              firebaseUser = await admin.auth().createUser({
                email: email,
                emailVerified: true, // We trust our SQL verification or just assume true for legacy
                displayName: user.name,
              });
            } else {
              throw e;
            }
          }

          // Update SQL with new UID
          await connection.query(
            'UPDATE users SET firebase_uid = ? WHERE id = ?',
            [firebaseUser.uid, user.id],
          );
          console.log(`[Migration] User ${user.id} migrated to Firebase UID ${firebaseUser.uid}`);
        } catch (migrationError) {
          console.error('Erro na migracao para Firebase:', migrationError);
          return res.status(500).json({ error: 'Erro ao preparar conta para recuperacao.' });
        }
      }

      // 3. Respond OK so Frontend can trigger the Firebase SDK email
      return res.status(200).json({ message: 'Usuario pronto para reset via Firebase.' });
    } catch (error) {
      console.error('Erro ao solicitar reset de senha:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  // confirmPasswordReset deprecated/removed as Firebase handles the UI.

  async register(req: Request, res: Response) {
    const {
      name,
      email,
      password,
      phone,
      street,
      number,
      complement,
      bairro,
      city,
      state,
      cep,
      profileType,
      creci,
    } = req.body as Record<string, string>;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha s??o obrigat??rios.' });
    }

    const normalizedProfile: ProfileType =
      profileType === 'broker' ? 'broker' : 'client';
    const brokerCreci = (creci ?? '').toString().trim();
    if (normalizedProfile === 'broker' && !brokerCreci) {
      return res.status(400).json({ error: 'CRECI e obrigatorio para corretores.' });
    }

    try {
      const [existingUserRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ?',
        [email],
      );
      if (existingUserRows.length > 0) {
        return res.status(409).json({ error: 'Este email já está em uso.' });
      }

      const addressResult = sanitizeAddressInput({
        street,
        number,
        complement,
        bairro,
        city,
        state,
        cep,
      });
      if (!addressResult.ok) {
        return res.status(400).json({
          error: 'Endereco incompleto ou invalido.',
          fields: addressResult.errors,
        });
      }

      const passwordHash = await bcrypt.hash(password, 8);
      const [userResult] = await connection.query<ResultSetHeader>(
        `
          INSERT INTO users (name, email, password_hash, phone, street, number, complement, bairro, city, state, cep)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          name,
          email,
          passwordHash,
          phone ?? null,
          addressResult.value.street,
          addressResult.value.number,
          addressResult.value.complement,
          addressResult.value.bairro,
          addressResult.value.city,
          addressResult.value.state,
          addressResult.value.cep,
        ],
      );

      const userId = userResult.insertId;

      if (normalizedProfile === 'broker') {
        await connection.query(
          'INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)',
          [userId, brokerCreci, 'pending_documents'],
        );
      }

      const token = signToken(userId, normalizedProfile);

      return res.status(201).json({
        user: buildUserPayload(
          {
            id: userId,
            name,
            email,
            phone,
            street: addressResult.value.street,
            number: addressResult.value.number,
            complement: addressResult.value.complement,
            bairro: addressResult.value.bairro,
            city: addressResult.value.city,
            state: addressResult.value.state,
            cep: addressResult.value.cep,
            broker_status: normalizedProfile === 'broker' ? 'pending_documents' : null,
          },
          normalizedProfile,
        ),
        token,
        needsCompletion: !hasCompleteProfile({
          phone,
          street: addressResult.value.street,
          number: addressResult.value.number,
          bairro: addressResult.value.bairro,
          city: addressResult.value.city,
          state: addressResult.value.state,
          cep: addressResult.value.cep,
        }),
        requiresDocuments: normalizedProfile === 'broker',
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
          SELECT u.id, u.name, u.email, u.password_hash, u.phone, u.street, u.number, u.complement, u.bairro, u.city, u.state, u.cep,
                 CASE
                   WHEN b.id IS NOT NULL AND b.status IN ('approved', 'pending_verification', 'pending_documents') THEN 'broker'
                   ELSE 'client'
                 END AS role,
                 b.status AS broker_status,
                 bd.status AS broker_documents_status
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          LEFT JOIN broker_documents bd ON b.id = bd.broker_id
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
      const brokerDocsStatus = String(user.broker_documents_status ?? '').trim().toLowerCase();
      const requiresDocuments =
        profile === 'broker' && (brokerDocsStatus.length === 0 || brokerDocsStatus == 'rejected');
      const token = signToken(user.id, profile);

      return res.json({
        user: buildUserPayload(user, profile),
        token,
        needsCompletion: !hasCompleteProfile(user),
        requiresDocuments,
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
      const decoded = await withTimeout(
        admin.auth().verifyIdToken(idToken),
        8000,
        'firebase token verification',
      );
      const uid = decoded.uid;
      const email = decoded.email;
      const displayName = decoded.name || decoded.email?.split('@')[0] || `User-${uid}`;

      if (!email) {
        return res.status(400).json({ error: 'Email não disponível no token do Google.' });
      }

      const [existingRows] = await connection.query<RowDataPacket[]>(
        `SELECT u.id, u.name, u.email, u.phone, u.street, u.number, u.complement, u.bairro, u.city, u.state, u.cep, u.firebase_uid,
                b.id AS broker_id, b.status AS broker_status,
                bd.status AS broker_documents_status
           FROM users u
           LEFT JOIN brokers b ON u.id = b.id
           LEFT JOIN broker_documents bd ON u.id = bd.broker_id
          WHERE u.firebase_uid = ? OR u.email = ?
          LIMIT 1`,
        [uid, email],
      );

      let userId: number;
      let userName = displayName;
      let phone: string | null = null;
      let street: string | null = null;
      let number: string | null = null;
      let complement: string | null = null;
      let bairro: string | null = null;
      let city: string | null = null;
      let state: string | null = null;
      let cep: string | null = null;
      let hasBrokerRow = false;
      let createdNow = false;
      let blockedBrokerRequest = false;
      let effectiveProfile: ProfileType = 'client';
      let requiresDocuments = false;
      let roleLocked = false;
      let brokerStatus: string | null = null;
      let brokerDocumentsStatus: string | null = null;
      let hasBrokerDocuments = false;

      if (existingRows.length > 0) {
        const row = existingRows[0];
        userId = row.id;
        userName = row.name || displayName;
        phone = row.phone ?? null;
        street = row.street ?? null;
        number = row.number ?? null;
        complement = row.complement ?? null;
        bairro = row.bairro ?? null;
        city = row.city ?? null;
        state = row.state ?? null;
        cep = row.cep ?? null;
        hasBrokerRow = !!row.broker_id;
        brokerStatus = row.broker_status ?? null;
        brokerDocumentsStatus = row.broker_documents_status ?? null;
        hasBrokerDocuments = brokerDocumentsStatus != null;
        blockedBrokerRequest =
          brokerStatus === 'rejected' || brokerStatus === 'suspended';
        if (hasBrokerRow && !blockedBrokerRequest) {
          effectiveProfile = 'broker';
        } else {
          effectiveProfile = 'client';
          requiresDocuments = hasBrokerRow;
        }

        if (!row.firebase_uid) {
          await connection.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, userId]);
        }
      } else {
        if (autoMode) {
          return res.json({
            requiresProfileChoice: true,
            pending: { email, name: displayName },
            isNewUser: true,
            roleLocked: false,
            needsCompletion: true,
            requiresDocuments: false,
          });
        }
        const [result] = await connection.query<ResultSetHeader>(
          'INSERT INTO users (firebase_uid, email, name) VALUES (?, ?, ?)',
          [uid, email, displayName],
        );
        userId = result.insertId;
        createdNow = true;
        effectiveProfile = requestedProfile === 'broker' ? 'broker' : 'client';
        if (requestedProfile === 'broker') {
          await connection.query(
            'INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)',
            [userId, null, 'pending_documents'],
          );
          brokerStatus = 'pending_documents';
          hasBrokerRow = true;
          requiresDocuments = true;
        }
      }

      if (!autoMode && requestedProfile === 'broker') {
        if (blockedBrokerRequest) {
          effectiveProfile = 'client';
          roleLocked = true;
          requiresDocuments = true;
        } else {
          effectiveProfile = 'broker';
          roleLocked = false;
          if (!hasBrokerRow) {
            await connection.query(
              'INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)',
              [userId, null, 'pending_documents'],
            );
            brokerStatus = 'pending_documents';
            hasBrokerRow = true;
          }
          requiresDocuments = (brokerStatus ?? '') !== 'approved';
        }
      } else if (!autoMode && requestedProfile === 'client') {
        effectiveProfile = blockedBrokerRequest ? 'client' : effectiveProfile;
        roleLocked = blockedBrokerRequest;
      } else if (autoMode) {
        roleLocked = blockedBrokerRequest || effectiveProfile === 'broker';
        requiresDocuments =
          effectiveProfile === 'broker' && (brokerStatus ?? '') !== 'approved';
        if (effectiveProfile === 'broker' && blockedBrokerRequest) {
          effectiveProfile = 'client';
        }
      }

      const needsCompletion = !hasCompleteProfile({ phone, street, number, bairro, city, state, cep });
      const brokerDocsRequired =
        effectiveProfile === 'broker' &&
        (!hasBrokerDocuments || brokerDocumentsStatus === 'rejected');
      requiresDocuments = brokerDocsRequired;

      const token = signToken(userId, effectiveProfile);

      return res.json({
        user: buildUserPayload(
          {
            id: userId,
            name: userName,
            email,
            phone,
            street,
            number,
            complement,
            bairro,
            city,
            state,
            cep,
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
    } catch (error: any) {
      console.error('Google auth error:', error);
      const details = error?.sqlMessage || error?.message || String(error);
      const message = String(details).toLowerCase();
      const status = message.includes('timeout') ? 504 : 500;
      return res.status(status).json({
        error: 'Erro ao autenticar com Google.',
        details,
      });
    }
  }
}

export const authController = new AuthController();
