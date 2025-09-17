"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  fetchSignInMethodsForEmail,
} from "firebase/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const unSub = onAuthStateChanged(auth, (u) => {
      if (u) router.replace("/cabinets");
    });
    return () => unSub();
  }, [router]);

  async function signIn() {
    setMsg("");
    if (!email.includes("@")) {
      setMsg("錯誤：Email 格式");
      return;
    }
    if (pw.length < 6) {
      setMsg("錯誤：密碼至少 6 碼");
      return;
    }

    try {
      const methods = await fetchSignInMethodsForEmail(auth, email);

      if (methods.includes("password")) {
        await signInWithEmailAndPassword(auth, email, pw);
        router.replace("/cabinets");
        return;
      }
      if (methods.length === 0) {
        await createUserWithEmailAndPassword(auth, email, pw);
        router.replace("/cabinets");
        return;
      }
      setMsg(`此 Email 綁定提供者：${methods.join(", ")}`);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setMsg(`錯誤：${err.code ?? err.message ?? "unknown"}`);
    }
  }

  async function doSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut(auth);
      setMsg("已登出，正在返回首頁");
      router.push("/");
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setMsg(`登出時發生錯誤：${err.code ?? err.message ?? "unknown"}`);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <main className="min-h-[100dvh] px-4 py-8 flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">登入</h1>

      <label className="space-y-1">
        <span className="text-base">Email</span>
        <input
          type="email"
          inputMode="email"
          className="h-12 w-full rounded-xl border px-4 text-base"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </label>

      <label className="space-y-1">
        <span className="text-base">密碼</span>
        <input
          type="password"
          className="h-12 w-full rounded-xl border px-4 text-base"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="至少 6 碼"
        />
      </label>

      <button
        onClick={signIn}
        className="h-12 rounded-xl bg-black text-white text-base"
      >
        登入／首次自動註冊
      </button>
      <button
        onClick={doSignOut}
        disabled={signingOut}
        className="h-12 rounded-xl border text-base disabled:cursor-not-allowed disabled:opacity-60"
      >
        {signingOut ? "登出中…" : "登出"}
      </button>

      {msg && <div className="text-sm">{msg}</div>}
    </main>
  );
}
