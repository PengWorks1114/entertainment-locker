import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
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

const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

const missingKeys: FirebaseEnvKey[] = [];
if (!apiKey) missingKeys.push("NEXT_PUBLIC_FIREBASE_API_KEY");
if (!authDomain) missingKeys.push("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
if (!projectId) missingKeys.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
if (!storageBucket) missingKeys.push("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
if (!messagingSenderId)
  missingKeys.push("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");
if (!appId) missingKeys.push("NEXT_PUBLIC_FIREBASE_APP_ID");

const firebaseConfig: Nullable<{
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}> =
  missingKeys.length === 0
    ? {
        apiKey: apiKey!,
        authDomain: authDomain!,
        projectId: projectId!,
        storageBucket: storageBucket!,
        messagingSenderId: messagingSenderId!,
        appId: appId!,
      }
    : null;

let hasLoggedMissingConfig = false;

function createFirebaseApp(): Nullable<FirebaseApp> {
  if (!firebaseConfig) {
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
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

let cachedApp: Nullable<FirebaseApp> = null;
let cachedDb: Nullable<Firestore> = null;
let cachedAuth: Nullable<Auth> = null;
let cachedStorage: Nullable<FirebaseStorage> = null;
let hasWarnedDbFallback = false;

export function getFirebaseApp(): Nullable<FirebaseApp> {
  if (cachedApp) {
    return cachedApp;
  }

  const app = createFirebaseApp();
  if (app) {
    cachedApp = app;
  }
  return app;
}

export function getFirebaseDb(): Nullable<Firestore> {
  if (cachedDb) {
    return cachedDb;
  }

  const app = getFirebaseApp();
  if (!app) {
    return null;
  }

  try {
    cachedDb = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (err) {
    if (!hasWarnedDbFallback && process.env.NODE_ENV !== "test") {
      hasWarnedDbFallback = true;
      console.warn("初始化 Firestore 永久快取失敗，改用預設設定。", err);
    }
    cachedDb = getFirestore(app);
  }

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
