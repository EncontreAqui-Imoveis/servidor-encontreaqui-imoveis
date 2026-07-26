import bcrypt from 'bcryptjs';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

import connection from '../database/connection';

type AdminRow = RowDataPacket & { id: number };

function requiredEnv(name: string): string {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`Defina ${name} antes de criar a conta administrativa.`);
  return value;
}

async function main(): Promise<void> {
  const name = requiredEnv('PANEL_ADMIN_NAME');
  const email = requiredEnv('PANEL_ADMIN_EMAIL').toLowerCase();
  const password = requiredEnv('PANEL_ADMIN_PASSWORD');
  const role = String(process.env.PANEL_ADMIN_ROLE ?? 'document_operator').trim().toLowerCase();

  if (role !== 'document_operator' && role !== 'admin') {
    throw new Error('PANEL_ADMIN_ROLE deve ser document_operator ou admin.');
  }
  if (password.length < 12) {
    throw new Error('PANEL_ADMIN_PASSWORD deve ter ao menos 12 caracteres.');
  }

  const [existing] = await connection.query<AdminRow[]>(
    'SELECT id FROM admins WHERE LOWER(email) = ? LIMIT 1',
    [email]
  );
  if (existing.length > 0) {
    throw new Error('Já existe uma conta administrativa com este e-mail.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO admins (name, email, password_hash, role, token_version)
     VALUES (?, ?, ?, ?, 1)`,
    [name, email, passwordHash, role]
  );

  console.log(`Conta administrativa criada: id=${result.insertId}, role=${role}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
