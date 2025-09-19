"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase";

const baseLinkClass =
  "block rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60";
const inactiveLinkClass = `${baseLinkClass} text-slate-300 hover:bg-slate-800/80 hover:text-white`;
const activeLinkClass = `${baseLinkClass} bg-indigo-500 text-white shadow`;
const actionButtonClass =
  "rounded-full border border-slate-600 bg-slate-900/60 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-400 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-60";

type ThemeMode = "light" | "dark";

export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("dark");
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
    if (typeof window === "undefined") {
      return;
    }
    try {
      const stored = window.localStorage.getItem("app-theme");
      if (stored === "light" || stored === "dark") {
        if (typeof document !== "undefined") {
          document.documentElement.dataset.theme = stored;
        }
        setTheme(stored);
        return;
      }
      const next: ThemeMode = "dark";
      if (typeof document !== "undefined") {
        document.documentElement.dataset.theme = next;
      }
      setTheme(next);
    } catch {
      if (typeof document !== "undefined") {
        document.documentElement.dataset.theme = "dark";
      }
      setTheme("dark");
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("app-theme", theme);
      } catch {
        // ignore write errors
      }
    }
  }, [theme]);

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

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const themeLabel = theme === "dark" ? "主題:黑" : "主題:白";
  const nextThemeLabel = theme === "dark" ? "切換為白主題" : "切換為黑主題";

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-black/70 backdrop-blur supports-[backdrop-filter]:bg-black/60">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-slate-100">
          Entertainment Locker
        </Link>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-sm text-slate-300">
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
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-expanded={navOpen}
              aria-controls="primary-navigation"
              onClick={() => setNavOpen((prev) => !prev)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-slate-200 transition hover:border-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
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
                className="absolute right-0 top-full mt-2 w-48 rounded-2xl border border-slate-700 bg-slate-950/95 p-2 shadow-xl"
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
                  <li>
                    <button
                      type="button"
                      onClick={toggleTheme}
                      className={`${inactiveLinkClass} w-full text-left`}
                      aria-label={nextThemeLabel}
                      title={nextThemeLabel}
                    >
                      {themeLabel}
                    </button>
                  </li>
                </ul>
              </nav>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
