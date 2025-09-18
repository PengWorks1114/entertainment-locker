"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getFirebaseAuth } from "@/lib/firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  fetchSignInMethodsForEmail,
  type User,
} from "firebase/auth";

type Mode = "login" | "register";

const toggleButtonBase =
  "rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300";

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }
    const unSub = onAuthStateChanged(auth, (current) => {
      setUser(current);
      setAuthReady(true);
    });
    return () => unSub();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    setEmail("");
    setPw("");
    setError(null);
    setMessage(null);
  }, [mode, authReady]);

  const modeLabel = useMemo(
    () => (mode === "login" ? "登入" : "註冊"),
    [mode]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes("@") || !trimmedEmail.includes(".")) {
      setError("請輸入有效的 Email");
      return;
    }
    if (pw.length < 6) {
      setError("密碼至少需 6 碼");
      return;
    }

    setLoading(true);
    try {
      const auth = getFirebaseAuth();
      if (!auth) {
        setError("Firebase 尚未設定");
        setLoading(false);
        return;
      }
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, trimmedEmail, pw);
        setMessage("登入成功，正在前往櫃子");
        router.replace("/cabinets");
      } else {
        const methods = await fetchSignInMethodsForEmail(auth, trimmedEmail);
        if (methods.includes("password")) {
          setError("此 Email 已註冊，請改用登入");
          return;
        }
        await createUserWithEmailAndPassword(auth, trimmedEmail, pw);
        setMessage("註冊成功，正在前往櫃子");
        router.replace("/cabinets");
      }
    } catch (err) {
      const errorObj = err as { code?: string; message?: string };
      const code = errorObj.code ?? "";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
        setError("帳號或密碼錯誤");
      } else if (code === "auth/user-not-found") {
        setError("查無此帳號，請確認 Email 或改用註冊");
      } else if (code === "auth/email-already-in-use") {
        setError("此 Email 已註冊，請改用登入");
      } else if (code === "auth/weak-password") {
        setError("密碼強度不足，請至少使用 6 碼");
      } else {
        setError(errorObj.message ?? "操作失敗，請稍後再試");
      }
    } finally {
      setLoading(false);
    }
  }

  async function doSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    setMessage(null);
    try {
      const auth = getFirebaseAuth();
      if (!auth) {
        throw new Error("Firebase 尚未設定");
      }
      await signOut(auth);
      setMessage("已登出，歡迎再次使用");
      router.push("/");
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(`登出時發生錯誤：${err.code ?? err.message ?? "unknown"}`);
    } finally {
      setSigningOut(false);
    }
  }

  const activeToggleClass = `${toggleButtonBase} bg-gray-900 text-white shadow`;
  const inactiveToggleClass = `${toggleButtonBase} text-gray-600 hover:text-gray-900`;

  return (
    <main className="min-h-[100dvh] bg-gradient-to-br from-gray-50 via-white to-gray-100 px-4 py-12">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="rounded-3xl border border-gray-100 bg-white/90 p-8 shadow-xl backdrop-blur">
          <header className="mb-6 text-center">
            <h1 className="text-3xl font-semibold text-gray-900">歡迎來到 Entertainment Locker</h1>
            <p className="mt-2 text-sm text-gray-500">
              請先{mode === "login" ? "登入" : "註冊"}以管理您的收藏櫃與物件。
            </p>
          </header>

          <div className="mb-6 grid grid-cols-2 gap-2 rounded-full bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={mode === "login" ? activeToggleClass : inactiveToggleClass}
            >
              我要登入
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={mode === "register" ? activeToggleClass : inactiveToggleClass}
            >
              我要註冊
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="space-y-1">
              <span className="text-sm font-medium text-gray-700">Email</span>
              <input
                type="email"
                inputMode="email"
                autoComplete={mode === "login" ? "email" : "new-email"}
                className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base shadow-sm transition focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium text-gray-700">密碼</span>
              <input
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base shadow-sm transition focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="至少 6 碼"
              />
            </label>

            <div className="pt-3">
              <button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-xl bg-gray-900 text-base font-medium text-white shadow transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? `${modeLabel}中…` : `${modeLabel}並前往我的櫃子`}
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-4 break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}
          {message && (
            <div className="mt-4 break-anywhere rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
          )}

          {user && (
            <div className="mt-6 space-y-3 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-700">
              <p>
                已以 <span className="break-anywhere font-medium text-gray-900">{user.email ?? "已登入"}</span> 登入。
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => router.push("/cabinets")}
                  className="inline-flex w-full items-center justify-center rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:border-gray-300 hover:text-gray-900"
                >
                  前往我的櫃子
                </button>
                <button
                  type="button"
                  onClick={doSignOut}
                  disabled={signingOut}
                  className="inline-flex w-full items-center justify-center rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition hover:border-gray-300 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {signingOut ? "登出中…" : "登出"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
