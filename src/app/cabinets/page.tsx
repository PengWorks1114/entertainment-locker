"use client";
import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  terminate,
  clearIndexedDbPersistence,
} from "firebase/firestore";

type Cabinet = { id: string; name: string };

export default function CabinetsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [list, setList] = useState<Cabinet[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const unAuth = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unAuth();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "cabinet"),
      where("uid", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const unSub = onSnapshot(q, (snap) => {
      const rows: Cabinet[] = snap.docs.map((d) => ({
        id: d.id,
        name: d.get("name") || "",
      }));
      setList(rows);
    });
    return () => unSub();
  }, [user]);

  async function addCabinet() {
    if (!user) {
      setMsg("請先登入");
      return;
    }
    if (!name.trim()) {
      setMsg("名稱不可為空");
      return;
    }
    setMsg("");
    await addDoc(collection(db, "cabinet"), {
      uid: user.uid,
      name: name.trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setName("");
  }

  async function clearCache() {
    try {
      await terminate(db);
    } catch {}
    try {
      await clearIndexedDbPersistence(db);
    } catch {}
    location.reload();
  }

  if (!user) {
    return (
      <main className="min-h-[100dvh] p-6">
        <h1 className="text-2xl font-semibold">櫃子</h1>
        <p className="mt-4 text-base">
          未登入。請前往{" "}
          <a href="/login" className="underline">
            /login
          </a>
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">櫃子</h1>
        <button
          onClick={clearCache}
          className="h-10 px-3 rounded border text-sm"
          title="清除本機 Firestore 快取並重新載入"
        >
          清除快取
        </button>
      </div>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="輸入櫃子名稱（例如：漫畫）"
          className="flex-1 h-12 rounded-xl border px-4 text-base"
        />
        <button
          onClick={addCabinet}
          className="h-12 px-5 rounded-xl bg-black text-white text-base"
        >
          新增
        </button>
      </div>
      {msg && <div className="text-sm">{msg}</div>}

      <ul className="space-y-3">
        {list.map((row) => (
          <li
            key={row.id}
            className="h-16 rounded-xl border px-4 flex items-center text-base"
          >
            {row.name}
          </li>
        ))}
        {list.length === 0 && (
          <li className="text-sm text-gray-500">尚無資料</li>
        )}
      </ul>
    </main>
  );
}
