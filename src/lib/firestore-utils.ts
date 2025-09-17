import { collection, deleteDoc, doc, getDoc, getDocs, query, where, writeBatch } from "firebase/firestore";

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

  const batch = writeBatch(db);
  const progressSnap = await getDocs(collection(db, "item", itemId, "progress"));
  for (const docSnap of progressSnap.docs) {
    batch.delete(docSnap.ref);
  }
  batch.delete(itemRef);
  await batch.commit();
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
