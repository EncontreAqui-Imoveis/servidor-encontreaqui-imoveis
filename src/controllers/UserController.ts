import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import connection from '../database/connection';
import AuthRequest from '../middlewares/auth';
import admin from '../config/firebaseAdmin';

interface FavoriteRow extends RowDataPacket {
  id: number;
  title: string;
  description: string;
  type: string;
  purpose: string;
  status: string;
  price: number | string;
  code?: string | null;
  address: string;
  quadra?: string | null;
  lote?: string | null;
  numero?: string | null;
  bairro?: string | null;
  complemento?: string | null;
  tipo_lote?: string | null;
  city: string;
  state: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area_construida?: number | string | null;
  area_terreno?: number | string | null;
  garage_spots?: number | null;
  has_wifi?: number | boolean | null;
  tem_piscina?: number | boolean | null;
  tem_energia_solar?: number | boolean | null;
  tem_automacao?: number | boolean | null;
  tem_ar_condicionado?: number | boolean | null;
  eh_mobiliada?: number | boolean | null;
  valor_condominio?: number | string | null;
  valor_iptu?: number | string | null;
  video_url?: string | null;
  images?: string | null;
  favorited_at?: Date;
  agency_id?: number | null;
  agency_name?: string | null;
  agency_logo_url?: string | null;
  agency_address?: string | null;
  agency_city?: string | null;
  agency_state?: string | null;
  agency_phone?: string | null;
}

function toBoolean(value: unknown): boolean {
  return value === 1 || value === '1' || value === true;
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const asString = String(value).trim();
  return asString.length > 0 ? asString : null;
}

function mapFavorite(row: FavoriteRow) {
  const images = row.images ? row.images.split(',').filter(Boolean) : [];
  const agency = row.agency_id
    ? {
        id: Number(row.agency_id),
        name: row.agency_name,
        logo_url: row.agency_logo_url,
        address: row.agency_address,
        city: row.agency_city,
        state: row.agency_state,
        phone: row.agency_phone,
      }
    : null;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    purpose: row.purpose,
    status: row.status,
    price: Number(row.price),
    code: row.code ?? null,
    address: row.address,
    quadra: row.quadra ?? null,
    lote: row.lote ?? null,
    numero: row.numero ?? null,
    bairro: row.bairro ?? null,
    complemento: row.complemento ?? null,
    tipo_lote: row.tipo_lote ?? null,
    city: row.city,
    state: row.state,
    bedrooms: row.bedrooms != null ? Number(row.bedrooms) : null,
    bathrooms: row.bathrooms != null ? Number(row.bathrooms) : null,
    area_construida: row.area_construida != null ? Number(row.area_construida) : null,
    area_terreno: row.area_terreno != null ? Number(row.area_terreno) : null,
    garage_spots: row.garage_spots != null ? Number(row.garage_spots) : null,
    has_wifi: toBoolean(row.has_wifi),
    tem_piscina: toBoolean(row.tem_piscina),
    tem_energia_solar: toBoolean(row.tem_energia_solar),
    tem_automacao: toBoolean(row.tem_automacao),
    tem_ar_condicionado: toBoolean(row.tem_ar_condicionado),
    eh_mobiliada: toBoolean(row.eh_mobiliada),
    valor_condominio: toNullableNumber(row.valor_condominio),
    valor_iptu: toNullableNumber(row.valor_iptu),
    video_url: row.video_url ?? null,
    images,
    agency,
    favorited_at: row.favorited_at ?? null,
  };
}

class UserController {
  async register(req: Request, res: Response) {
    const { name, email, password, phone, address, city, state } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha sao obrigatorios.' });
    }

    try {
      const [existingUserRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ?',
        [email]
      );

      if (existingUserRows.length > 0) {
        return res.status(409).json({ error: 'Este email ja esta em uso.' });
      }

      const passwordHash = await bcrypt.hash(password, 8);

      await connection.query(
        `
          INSERT INTO users (name, email, password_hash, phone, address, city, state, role)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'client')
        `,
        [name, email, passwordHash, stringOrNull(phone), stringOrNull(address), stringOrNull(city), stringOrNull(state)]
      );

      return res.status(201).json({ message: 'Usuario criado com sucesso!' });
    } catch (error) {
      console.error('Erro no registro do usuario:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async login(req: Request, res: Response) {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha sao obrigatorios.' });
    }

    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, email, password_hash FROM users WHERE email = ?',
        [email]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Credenciais invalidas.' });
      }

      const user = rows[0];
      const isPasswordCorrect = await bcrypt.compare(password, String(user.password_hash));

      if (!isPasswordCorrect) {
        return res.status(401).json({ error: 'Credenciais invalidas.' });
      }

      const token = jwt.sign(
        { id: user.id, role: 'user' },
        process.env.JWT_SECRET || 'default_secret',
        { expiresIn: '1d' }
      );

      delete (user as any).password_hash;
      return res.status(200).json({ user, token });
    } catch (error) {
      console.error('Erro no login do usuário:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getProfile(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    try {
      const [userRows] = await connection.query<RowDataPacket[]>(
        'SELECT id, name, email FROM users WHERE id = ?',
        [userId]
      );

      if (userRows.length === 0) {
        return res.status(404).json({ error: 'Usuário nao encontrado.' });
      }

      const user = userRows[0];

      const [brokerRows] = await connection.query<RowDataPacket[]>(
        'SELECT status FROM brokers WHERE id = ?',
        [userId]
      );

      if (brokerRows.length > 0) {
        return res.json({
          role: 'broker',
          status: brokerRows[0].status,
          user: { id: user.id, name: user.name, email: user.email },
        });
      }

      return res.json({
        role: 'client',
        user: { id: user.id, name: user.name, email: user.email },
      });
    } catch (error) {
      console.error('Erro ao buscar perfil:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async syncUser(req: Request, res: Response) {
    try {
      const secret = req.headers['x-sync-secret'];
      if (secret !== process.env.SYNC_SECRET_KEY) {
        return res.status(401).json({ error: 'Acesso nao autorizado.' });
      }

      const { uid, email } = req.body as { uid: string; email: string };

      if (!uid || !email) {
        return res.status(400).json({ error: 'UID e email sao obrigatorios.' });
      }

      const [existingUserRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE firebase_uid = ? OR email = ?',
        [uid, email]
      );

      if (existingUserRows.length > 0) {
        return res.status(409).json({ error: 'Usuario ja existe.' });
      }

      await connection.query(
        'INSERT INTO users (firebase_uid, email, name, role) VALUES (?, ?, ?, ?)',
        [uid, email, `User-${uid.substring(0, 8)}`, 'client']
      );

      return res.status(201).json({ message: 'Usuario sincronizado com sucesso!' });
    } catch (error) {
      console.error('Erro na sincronizacao do usuario:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async googleLogin(req: Request, res: Response) {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'Token do Google e obrigatorio.' });
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const { uid, email, name } = decodedToken;

      const [userRows] = await connection.query<RowDataPacket[]>(
        `
          SELECT u.id, u.name, u.email, u.firebase_uid,
                 CASE WHEN b.id IS NOT NULL THEN 'broker' ELSE 'client' END AS role,
                 b.status AS broker_status
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE u.firebase_uid = ? OR u.email = ?
        `,
        [uid, email]
      );

      let user: any;

      if (userRows.length > 0) {
        user = userRows[0];
        if (!user.firebase_uid) {
          await connection.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, user.id]);
        }
      } else {
        const [result] = await connection.query<ResultSetHeader>(
          'INSERT INTO users (firebase_uid, email, name, role) VALUES (?, ?, ?, ?)',
          [uid, email, name || `User-${uid.substring(0, 8)}`, 'client']
        );
        user = {
          id: result.insertId,
          name: name || `User-${uid.substring(0, 8)}`,
          email,
          role: 'client',
        };
      }

      const token = jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET || 'default_secret',
        { expiresIn: '1d' }
      );

      return res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        token,
      });
    } catch (error) {
      console.error('Erro no login com Google:', error);
      return res.status(401).json({ error: 'Token do Google invalido.' });
    }
  }

  async addFavorite(req: AuthRequest, res: Response) {
    const userId = req.userId;
    const propertyId = Number(req.params.propertyId);

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    try {
      const [propertyRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM properties WHERE id = ?',
        [propertyId]
      );

      if (propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const [favoriteRows] = await connection.query<RowDataPacket[]>(
        'SELECT 1 FROM favoritos WHERE usuario_id = ? AND imovel_id = ?',
        [userId, propertyId]
      );

      if (favoriteRows.length > 0) {
        return res.status(409).json({ error: 'Este imovel ja esta nos seus favoritos.' });
      }

      await connection.query('INSERT INTO favoritos (usuario_id, imovel_id) VALUES (?, ?)', [userId, propertyId]);

      return res.status(201).json({ message: 'Imovel adicionado aos favoritos.' });
    } catch (error) {
      console.error('Erro ao adicionar favorito:', error);
      return res.status(500).json({ error: 'Ocorreu um erro no servidor.' });
    }
  }

  async removeFavorite(req: AuthRequest, res: Response) {
    const userId = req.userId;
    const propertyId = Number(req.params.propertyId);

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    try {
      const [result] = await connection.query<ResultSetHeader>(
        'DELETE FROM favoritos WHERE usuario_id = ? AND imovel_id = ?',
        [userId, propertyId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Favorito nao encontrado.' });
      }

      return res.status(200).json({ message: 'Imovel removido dos favoritos.' });
    } catch (error) {
      console.error('Erro ao remover favorito:', error);
      return res.status(500).json({ error: 'Ocorreu um erro no servidor.' });
    }
  }

  async listFavorites(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    try {
      const [rows] = await connection.query<FavoriteRow[]>(
        `
          SELECT
            p.*,
            ANY_VALUE(a.id) AS agency_id,
            ANY_VALUE(a.name) AS agency_name,
            ANY_VALUE(a.logo_url) AS agency_logo_url,
            ANY_VALUE(a.address) AS agency_address,
            ANY_VALUE(a.city) AS agency_city,
            ANY_VALUE(a.state) AS agency_state,
            ANY_VALUE(a.phone) AS agency_phone,
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images,
            MAX(f.created_at) AS favorited_at
          FROM favoritos f
          JOIN properties p ON p.id = f.imovel_id
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN property_images pi ON pi.property_id = p.id
          WHERE f.usuario_id = ?
          GROUP BY p.id
          ORDER BY favorited_at DESC
        `,
        [userId]
      );

      return res.status(200).json(rows.map(mapFavorite));
    } catch (error) {
      console.error('Erro ao listar favoritos:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }
}

export const userController = new UserController();
