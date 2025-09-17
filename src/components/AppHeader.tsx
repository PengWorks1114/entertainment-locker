"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";

import { auth } from "@/lib/firebase";

const baseLinkClass =
  "rounded-full px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400";
const inactiveLinkClass = `${baseLinkClass} text-gray-600 hover:text-gray-900`;
const activeLinkClass = `${baseLinkClass} bg-gray-900 text-white shadow-sm`;
const actionButtonClass =
  "rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 transition hover:border-gray-400 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-70";

export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (current) => {
      setUser(current);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const navLinks = useMemo(
    () => [
      { href: "/", label: "首頁" },
      { href: "/cabinets", label: "我的櫃子" },
      { href: "/item/new", label: "新增物件" },
    ],
    []
  );

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut(auth);
      router.push("/");
      router.refresh();
    } catch (err) {
      console.error("登出失敗", err);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-gray-900">
          Entertainment Locker
        </Link>
        <nav className="flex items-center gap-2">
          {navLinks.map((link) => {
            const isActive = pathname === link.href || pathname?.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={isActive ? activeLinkClass : inactiveLinkClass}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          {user ? (
            <>
              {user.email && (
                <span className="hidden truncate max-w-[12rem] sm:inline">
                  {user.email}
                </span>
              )}
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className={actionButtonClass}
              >
                {signingOut ? "登出中…" : "登出"}
              </button>
            </>
          ) : authReady ? (
            <Link href="/login" className={actionButtonClass}>
              登入 / 註冊
            </Link>
          ) : (
            <span>…</span>
          )}
        </div>
      </div>
    </header>
  );
}
