import { FirebaseError } from "firebase/app";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type QuerySnapshot,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
} from "firebase/firestore";

import { getFirebaseDb } from "./firebase";

export async function deleteItemWithProgress(itemId: string, userId?: string) {
  const db = getFirebaseDb();
  if (!db) {
    throw new Error("Firebase 尚未設定");
  }
  const itemRef = doc(db, "item", itemId);
  let snap: DocumentSnapshot<DocumentData>;
  try {
    snap = await getDoc(itemRef);
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "permission-denied") {
      throw new Error("讀取物件資料時遭到拒絕，請稍後再試或確認帳號權限。");
    }
    throw err;
  }
  if (!snap.exists()) {
    return;
  }
  const data = snap.data();
  if (userId && data?.uid !== userId) {
    throw new Error("您沒有刪除此物件的權限");
  }

  const progressCollection = collection(db, "item", itemId, "progress");
  let progressSnap: QuerySnapshot<DocumentData>;
  try {
    progressSnap = await getDocs(progressCollection);
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "permission-denied") {
      throw new Error("無法讀取進度資料，請確認帳號權限或稍後再試。");
    }
    throw err;
  }
  const storedProgress = progressSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data(),
  }));
  const trashRef = doc(db, "cabinetTrash", itemId);
  try {
    await setDoc(trashRef, {
      uid: typeof data?.uid === "string" ? data.uid : userId ?? null,
      cabinetId:
        typeof data?.cabinetId === "string" ? data.cabinetId : "",
      originalItemId: itemId,
      itemData: data,
      progress: storedProgress,
      deletedAt: serverTimestamp(),
    });
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "permission-denied") {
      throw new Error("移至垃圾桶時遭到拒絕，請稍後再試或確認帳號權限。");
    }
    throw err;
  }
  for (const docSnap of progressSnap.docs) {
    try {
      await deleteDoc(docSnap.ref);
    } catch (err) {
      if (err instanceof FirebaseError && err.code === "permission-denied") {
        throw new Error("刪除進度時遭到拒絕，請稍後再試或確認帳號權限。");
      }
      throw err;
    }
  }
  try {
    await deleteDoc(itemRef);
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "permission-denied") {
      throw new Error("刪除此物件的權限不足。");
    }
    throw err;
  }
}

export async function deleteCabinetWithItems(cabinetId: string, userId: string) {
  const db = getFirebaseDb();
  if (!db) {
    throw new Error("Firebase 尚未設定");
  }
  const cabinetRef = doc(db, "cabinet", cabinetId);
  const snap = await getDoc(cabinetRef);
  if (!snap.exists()) {
    throw new Error("找不到指定的櫃子");
  }
  const data = snap.data();
  if (data?.uid !== userId) {
    throw new Error("您沒有刪除此櫃子的權限");
  }

  const itemsQuery = query(
    collection(db, "item"),
    where("uid", "==", userId),
    where("cabinetId", "==", cabinetId)
  );
  const itemsSnap = await getDocs(itemsQuery);
  await Promise.all(itemsSnap.docs.map((docSnap) => deleteItemWithProgress(docSnap.id, userId)));

  await deleteDoc(cabinetRef);
}

function normalizeUrlForComparison(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, "");
}

export async function hasCabinetItemWithSourceUrl(
  db: Firestore,
  userId: string,
  cabinetId: string,
  sourceUrl: string,
  options: { excludeItemId?: string } = {}
): Promise<boolean> {
  const normalizedTarget = normalizeUrlForComparison(sourceUrl);
  if (!normalizedTarget) {
    return false;
  }

  const sourceQuery = query(
    collection(db, "item"),
    where("uid", "==", userId),
    where("cabinetId", "==", cabinetId)
  );
  const snap = await getDocs(sourceQuery);
  return snap.docs.some((docSnap) => {
    if (options.excludeItemId && docSnap.id === options.excludeItemId) {
      return false;
    }
    const data = docSnap.data();
    if (!data) {
      return false;
    }
    const links = Array.isArray(data.links) ? data.links : [];
    return links.some((entry: unknown) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const urlValue = (entry as { url?: unknown }).url;
      if (typeof urlValue !== "string") {
        return false;
      }
      const normalized = normalizeUrlForComparison(urlValue);
      return normalized === normalizedTarget;
    });
  });
}
