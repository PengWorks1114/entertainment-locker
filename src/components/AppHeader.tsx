"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase";

const baseLinkClass =
  "block rounded-xl px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400";
const inactiveLinkClass = `${baseLinkClass} text-gray-700 hover:bg-gray-100`;
const activeLinkClass = `${baseLinkClass} bg-gray-900 text-white shadow-sm`;
const actionButtonClass =
  "rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 transition hover:border-gray-400 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-70";

export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }

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
      { href: "/item/quick-add", label: "快速新增物件" },
    ],
    []
  );

  useEffect(() => {
    if (!navOpen) {
      return;
    }
    function handleClickOutside(event: MouseEvent) {
      if (!menuRef.current || menuRef.current.contains(event.target as Node)) {
        return;
      }
      setNavOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNavOpen(false);
      }
    }
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [navOpen]);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const auth = getFirebaseAuth();
      if (!auth) {
        throw new Error("Firebase 尚未設定，無法登出");
      }
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
        <div className="flex items-center gap-4">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-expanded={navOpen}
              aria-controls="primary-navigation"
              onClick={() => setNavOpen((prev) => !prev)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 transition hover:border-gray-400 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
              <span className="sr-only">主選單</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="h-5 w-5"
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            {navOpen ? (
              <nav
                id="primary-navigation"
                aria-label="主選單"
                className="absolute right-0 top-full mt-2 w-48 rounded-2xl border border-gray-200 bg-white p-2 shadow-lg"
              >
                <ul className="space-y-1">
                  {navLinks.map((link) => {
                    const isActive =
                      pathname === link.href || pathname?.startsWith(`${link.href}/`);
                    return (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className={isActive ? activeLinkClass : inactiveLinkClass}
                        >
                          {link.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            ) : null}
          </div>
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
      </div>
    </header>
  );
}
