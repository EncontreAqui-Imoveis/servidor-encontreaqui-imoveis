import * as admin from 'firebase-admin';

const requiredEnvVars = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID as string,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY as string).replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL as string,
};

// Inicializar o Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

export default admin;