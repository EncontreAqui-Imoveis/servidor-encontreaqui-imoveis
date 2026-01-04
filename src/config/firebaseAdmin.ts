import * as admin from 'firebase-admin';
import fs from 'fs';

type ServiceAccount = {
  projectId: string;
  privateKey: string;
  clientEmail: string;
};

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

let serviceAccount: ServiceAccount;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (serviceAccountPath) {
  serviceAccount = loadServiceAccountFromFile(serviceAccountPath);
} else {
  serviceAccount = loadServiceAccountFromEnv();
}

// Inicializar o Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

export default admin;
