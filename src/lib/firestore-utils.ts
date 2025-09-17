import { FirebaseError } from "firebase/app";
import { collection, deleteDoc, doc, getDoc, getDocs, query, where } from "firebase/firestore";

import { db } from "./firebase";

export async function deleteItemWithProgress(itemId: string, userId?: string) {
  const itemRef = doc(db, "item", itemId);
  const snap = await getDoc(itemRef);
  if (!snap.exists()) {
    return;
  }
  const data = snap.data();
  if (userId && data?.uid !== userId) {
    throw new Error("您沒有刪除此物件的權限");
  }

  const progressSnap = await getDocs(collection(db, "item", itemId, "progress"));
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
