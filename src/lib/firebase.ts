import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";
import { getStorage, type FirebaseStorage } from "firebase/storage";

type Nullable<T> = T | null;

type FirebaseEnvKey =
  | "NEXT_PUBLIC_FIREBASE_API_KEY"
  | "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
  | "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
  | "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
  | "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
  | "NEXT_PUBLIC_FIREBASE_APP_ID";

const REQUIRED_ENV_KEYS: FirebaseEnvKey[] = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
];

let hasLoggedMissingConfig = false;

function readFirebaseConfig(): Nullable<{
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}> {
  const envValues: Record<FirebaseEnvKey, string | undefined> = {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !envValues[key]);

  if (missingKeys.length > 0) {
    if (!hasLoggedMissingConfig && process.env.NODE_ENV !== "test") {
      hasLoggedMissingConfig = true;
      console.warn(
        `Firebase 環境變數缺失：${missingKeys.join(", ")}`,
        "請確認 .env.local 是否存在並包含所需設定。"
      );
    }
    return null;
  }

  hasLoggedMissingConfig = false;
  return {
    apiKey: envValues.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: envValues.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: envValues.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: envValues.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
    messagingSenderId: envValues.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
    appId: envValues.NEXT_PUBLIC_FIREBASE_APP_ID!,
  } as const;
}

function createFirebaseApp(): Nullable<FirebaseApp> {
  const config = readFirebaseConfig();
  if (!config) {
    return null;
  }
  return getApps().length ? getApp() : initializeApp(config);
}

let cachedApp: Nullable<FirebaseApp> = null;
let cachedDb: Nullable<Firestore> = null;
let cachedAuth: Nullable<Auth> = null;
let cachedStorage: Nullable<FirebaseStorage> = null;
let initializationAttempted = false;

export function getFirebaseApp(): Nullable<FirebaseApp> {
  if (cachedApp) {
    return cachedApp;
  }

  if (initializationAttempted) {
    return null;
  }

  initializationAttempted = true;
  cachedApp = createFirebaseApp();
  return cachedApp;
}

export function getFirebaseDb(): Nullable<Firestore> {
  if (cachedDb) {
    return cachedDb;
  }

  const app = getFirebaseApp();
  if (!app) {
    return null;
  }

  cachedDb = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
  return cachedDb;
}

export function getFirebaseAuth(): Nullable<Auth> {
  if (cachedAuth) {
    return cachedAuth;
  }

  const app = getFirebaseApp();
  if (!app) {
    return null;
  }

  cachedAuth = getAuth(app);
  return cachedAuth;
}

export function getFirebaseStorage(): Nullable<FirebaseStorage> {
  if (cachedStorage) {
    return cachedStorage;
  }

  const app = getFirebaseApp();
  if (!app) {
    return null;
  }

  cachedStorage = getStorage(app);
  return cachedStorage;
}

export default getFirebaseApp;
