import "./globals.css";
import type { Metadata, Viewport } from "next";

import AppHeader from "@/components/AppHeader";

export const metadata: Metadata = {
  title: "Entertainment Locker",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant" data-theme="dark">
      <body className="bg-zinc-950 text-slate-100 antialiased">
        <AppHeader />
        <div className="pt-6">{children}</div>
      </body>
    </html>
  );
}
