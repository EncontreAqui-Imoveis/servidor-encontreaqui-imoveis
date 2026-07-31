import { RowDataPacket } from 'mysql2';
import connection from '../database/connection';
import { hashNewPassword, validateNewPassword } from '../security/passwordPolicy';

type AdminIdRow = RowDataPacket & {
  id: number;
};

function requiredEnvironment(name: string): string {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const name = requiredEnvironment('BOOTSTRAP_ADMIN_NAME');
  const email = requiredEnvironment('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const password = requiredEnvironment('BOOTSTRAP_ADMIN_PASSWORD');

  const passwordError = validateNewPassword(password, 'admin');
  if (passwordError) {
    throw new Error(`BOOTSTRAP_ADMIN_PASSWORD: ${passwordError.message}`);
  }

  const [existing] = await connection.query<AdminIdRow[]>(
    'SELECT id FROM admins WHERE LOWER(email) = ? LIMIT 1',
    [email],
  );
  if (existing.length > 0) {
    throw new Error('Ja existe um administrador com este e-mail.');
  }

  const passwordHash = await hashNewPassword(password);
  await connection.query(
    `
      INSERT INTO admins (name, email, password_hash, role, token_version)
      VALUES (?, ?, ?, 'admin', 1)
    `,
    [name, email, passwordHash],
  );
  console.log('Administrador inicial criado com sucesso.');
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Falha ao criar administrador inicial:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await connection.end();
    });
}
