import bcrypt from 'bcryptjs';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import {
  ApplicationError,
  ConflictError,
  InternalError,
  InvalidInputError,
} from '../errors/ApplicationError';

import { adminDb } from './adminPersistenceService';
import { notifyAdmins } from './notificationService';
import { uploadToCloudinary } from '../config/cloudinary';
import { sanitizeAddressInput as sanitizeAddress } from '../utils/address';
import { hasValidCreci, normalizeCreci } from './adminControllerSupport';

function normalizeDigits(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).replace(/\D/g, '');
}

function isValidEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizePhone(value: unknown): string {
  return normalizeDigits(value).slice(0, 13);
}

function hasValidPhone(value: unknown): boolean {
  const length = normalizePhone(value).length;
  return length >= 10 && length <= 13;
}

function sanitizeAddressInput(input: Parameters<typeof sanitizeAddress>[0]) {
  return sanitizeAddress(input);
}

function normalizeStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'approved') return 'approved';
  return 'pending_verification';
}

export async function createBrokerAccountAdmin(params: {
  body: Record<string, unknown>;
  files?: { [fieldname: string]: Express.Multer.File[] } | undefined;
}): Promise<{
  message: string;
  broker_id: number;
}> {
  const { body, files } = params;
  const {
    name,
    email,
    phone,
    creci,
    street,
    number,
    complement,
    bairro,
    city,
    state,
    cep,
    agency_id,
    password,
    status,
  } = body;

  if (!name || !email || !creci || !password || !phone) {
    throw new InvalidInputError('Nome, email, telefone, senha e CRECI são obrigatórios.');
  }
  if (!isValidEmail(email)) {
    throw new InvalidInputError('Email inválido.');
  }
  if (!hasValidPhone(phone)) {
    throw new InvalidInputError('Telefone inválido. Use 11 dígitos com DDD.');
  }
  if (!hasValidCreci(creci)) {
    throw new InvalidInputError('CRECI inválido. Use 4 a 8 números com sufixo opcional (ex: 12345678-A).');
  }
  if (!normalizeDigits(number)) {
    throw new InvalidInputError('Número do endereço deve conter apenas dígitos.');
  }

  if (!files?.creciFront?.[0] || !files?.creciBack?.[0] || !files?.selfie?.[0]) {
    throw new InvalidInputError('Para cadastrar corretor com documentos, envie frente do CRECI, verso do CRECI e selfie.');
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
    throw new InvalidInputError('Endereco incompleto ou invalido.', { fields: addressResult.errors });
  }

  const db = await adminDb.getConnection();
  try {
    await db.beginTransaction();

    const [existing] = await db.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (existing.length > 0) {
      await db.rollback();
      throw new ConflictError('Email ja cadastrado.');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(String(password), salt);
    const requestedStatus = normalizeStatus(status);
    const brokerStatus = requestedStatus === 'approved' ? 'approved' : 'pending_verification';
    const documentStatus = brokerStatus === 'approved' ? 'approved' : 'pending';

    const [userResult] = await db.query<ResultSetHeader>(
      'INSERT INTO users (name, email, phone, password_hash, street, number, complement, bairro, city, state, cep) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        name,
        email,
        normalizePhone(phone),
        passwordHash,
        addressResult.value.street,
        normalizeDigits(addressResult.value.number),
        addressResult.value.complement,
        addressResult.value.bairro,
        addressResult.value.city,
        addressResult.value.state,
        addressResult.value.cep,
      ]
    );
    const userId = userResult.insertId;

    await db.query('INSERT INTO brokers (id, creci, status, agency_id) VALUES (?, ?, ?, ?)', [
      userId,
      normalizeCreci(creci),
      brokerStatus,
      agency_id ? Number(agency_id) : null,
    ]);

    const creciFrontResult = await uploadToCloudinary(files!.creciFront[0], 'brokers/documents');
    const creciBackResult = await uploadToCloudinary(files!.creciBack[0], 'brokers/documents');
    const selfieResult = await uploadToCloudinary(files!.selfie[0], 'brokers/documents');

    await db.query(
      `INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         creci_front_url = VALUES(creci_front_url),
         creci_back_url = VALUES(creci_back_url),
         selfie_url = VALUES(selfie_url),
         status = VALUES(status),
         updated_at = CURRENT_TIMESTAMP`,
      [userId, creciFrontResult.url, creciBackResult.url, selfieResult.url, documentStatus]
    );

    await db.commit();

    try {
      await notifyAdmins(`Novo corretor '${name}' cadastrado com status '${brokerStatus}'.`, 'broker', userId);
    } catch (notifyError) {
      console.error('Erro ao notificar admins sobre novo corretor:', notifyError);
    }

    return { message: 'Corretor criado com sucesso.', broker_id: userId };
  } catch (error) {
    await db.rollback();
    if (error instanceof ApplicationError) {
      throw error;
    }
    console.error('Erro ao criar corretor:', error);
    throw new InternalError('Erro interno do servidor.');
  } finally {
    db.release();
  }
}

export async function createUserAccountAdmin(params: {
  body: Record<string, unknown>;
}): Promise<{
  message: string;
  user_id: number;
  role: 'client' | 'auxiliary_administrative';
}> {
  const {
    name,
    email,
    phone,
    password,
    street,
    number,
    complement,
    bairro,
    city,
    state,
    cep,
    profileType,
  } = params.body;

  if (!name || !email || !phone || !password) {
    throw new InvalidInputError('Nome, email, telefone e senha são obrigatórios.');
  }
  if (!isValidEmail(email)) {
    throw new InvalidInputError('Email inválido.');
  }
  if (!hasValidPhone(phone)) {
    throw new InvalidInputError('Telefone inválido. Use 11 dígitos com DDD.');
  }
  if (!normalizeDigits(number)) {
    throw new InvalidInputError('Número do endereço deve conter apenas dígitos.');
  }

  const normalizedProfileType = String(profileType ?? 'client').trim().toLowerCase();
  const isAuxiliaryAdministrative =
    normalizedProfileType === 'auxiliary_administrative' ||
    normalizedProfileType === 'auxiliar_administrativo';

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
    throw new InvalidInputError('Endereco incompleto ou invalido.', { fields: addressResult.errors });
  }

  try {
    const [existing] = await adminDb.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (existing.length > 0) {
      throw new ConflictError('Email ja cadastrado.');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(String(password), salt);
    const [userResult] = await adminDb.query<ResultSetHeader>(
      'INSERT INTO users (name, email, phone, password_hash, street, number, complement, bairro, city, state, cep) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        name,
        email,
        normalizePhone(phone),
        passwordHash,
        addressResult.value.street,
        normalizeDigits(addressResult.value.number),
        addressResult.value.complement,
        addressResult.value.bairro,
        addressResult.value.city,
        addressResult.value.state,
        addressResult.value.cep,
      ]
    );

    if (isAuxiliaryAdministrative) {
      await adminDb.query(
        `
          INSERT INTO brokers (id, creci, status, profile_type)
          VALUES (?, NULL, 'approved', 'AUXILIARY_ADMINISTRATIVE')
          ON DUPLICATE KEY UPDATE
            creci = VALUES(creci),
            status = 'approved',
            profile_type = 'AUXILIARY_ADMINISTRATIVE',
            updated_at = CURRENT_TIMESTAMP
        `,
        [userResult.insertId]
      );
    }

    return {
      message: 'Usuario criado com sucesso.',
      user_id: userResult.insertId,
      role: isAuxiliaryAdministrative ? 'auxiliary_administrative' : 'client',
    };
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    console.error('Erro ao criar usuario:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}
