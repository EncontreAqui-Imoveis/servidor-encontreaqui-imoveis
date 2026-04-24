import fs from 'fs';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

type ServiceAccount = {
  projectId: string;
  privateKey: string;
  clientEmail: string;
};

const isTestEnvironment =
  String(process.env.NODE_ENV ?? '').toLowerCase() === 'test' ||
  process.env.VITEST === 'true';

function loadServiceAccountFromEnv(): ServiceAccount {
  const requiredEnvVars = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  return {
    projectId: process.env.FIREBASE_PROJECT_ID as string,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY as string)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, ''),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL as string,
  };
}

function loadServiceAccountFromFile(path: string): ServiceAccount {
  const raw = fs.readFileSync(path, 'utf-8');
  const json = JSON.parse(raw);
  return {
    projectId: String(json.project_id ?? ''),
    privateKey: String(json.private_key ?? ''),
    clientEmail: String(json.client_email ?? ''),
  };
}

let serviceAccount: ServiceAccount | null = null;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (serviceAccountPath) {
  serviceAccount = loadServiceAccountFromFile(serviceAccountPath);
} else if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_PRIVATE_KEY &&
  process.env.FIREBASE_CLIENT_EMAIL
) {
  serviceAccount = loadServiceAccountFromEnv();
} else if (!isTestEnvironment) {
  // Keep strict behavior outside tests.
  serviceAccount = loadServiceAccountFromEnv();
}

const app: App = (() => {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  if (serviceAccount) {
    try {
      return initializeApp({ credential: cert(serviceAccount) });
    } catch (error) {
      if (!isTestEnvironment) {
        throw error;
      }
    }
  }

  return initializeApp({ projectId: 'test-project-id' });
})();

const firebaseAdmin = {
  app,
  auth(): Auth {
    return getAuth(app);
  },
  messaging(): Messaging {
    return getMessaging(app);
  },
};

export default firebaseAdmin;
