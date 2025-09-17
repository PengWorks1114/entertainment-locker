import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";
import { getStorage, type FirebaseStorage } from "firebase/storage";

type FirebaseEnvKey =
  | "NEXT_PUBLIC_FIREBASE_API_KEY"
  | "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
  | "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
  | "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
  | "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
  | "NEXT_PUBLIC_FIREBASE_APP_ID";

function getEnvValue(key: FirebaseEnvKey): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `ENV 未載入：缺少 ${key}（請檢查 .env.local 位置與鍵名）`
    );
  }
  return value;
}

function createFirebaseApp(): FirebaseApp {
  const config = {
    apiKey: getEnvValue("NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: getEnvValue("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
    projectId: getEnvValue("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    storageBucket: getEnvValue("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: getEnvValue("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
    appId: getEnvValue("NEXT_PUBLIC_FIREBASE_APP_ID"),
  } as const;
  return getApps().length ? getApp() : initializeApp(config);
}

let cachedApp: FirebaseApp | null = null;
let cachedDb: Firestore | null = null;
let cachedAuth: Auth | null = null;
let cachedStorage: FirebaseStorage | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!cachedApp) {
    cachedApp = createFirebaseApp();
  }
  return cachedApp;
}

export function getFirebaseDb(): Firestore {
  if (!cachedDb) {
    cachedDb = initializeFirestore(getFirebaseApp(), {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  }
  return cachedDb;
}

export function getFirebaseAuth(): Auth {
  if (!cachedAuth) {
    cachedAuth = getAuth(getFirebaseApp());
  }
  return cachedAuth;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (!cachedStorage) {
    cachedStorage = getStorage(getFirebaseApp());
  }
  return cachedStorage;
}

export default getFirebaseApp;
