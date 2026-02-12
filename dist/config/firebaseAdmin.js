"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const messaging_1 = require("firebase-admin/messaging");
function loadServiceAccountFromEnv() {
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
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, ''),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };
}
function loadServiceAccountFromFile(path) {
    const raw = fs_1.default.readFileSync(path, 'utf-8');
    const json = JSON.parse(raw);
    return {
        projectId: String(json.project_id ?? ''),
        privateKey: String(json.private_key ?? ''),
        clientEmail: String(json.client_email ?? ''),
    };
}
let serviceAccount;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (serviceAccountPath) {
    serviceAccount = loadServiceAccountFromFile(serviceAccountPath);
}
else {
    serviceAccount = loadServiceAccountFromEnv();
}
const app = (0, app_1.getApps)().length > 0
    ? (0, app_1.getApps)()[0]
    : (0, app_1.initializeApp)({
        credential: (0, app_1.cert)(serviceAccount),
    });
const firebaseAdmin = {
    app,
    auth() {
        return (0, auth_1.getAuth)(app);
    },
    messaging() {
        return (0, messaging_1.getMessaging)(app);
    },
};
exports.default = firebaseAdmin;
