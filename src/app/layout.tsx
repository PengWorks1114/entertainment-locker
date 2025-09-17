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
    <html lang="zh-Hant">
      <body className="bg-gray-100 text-gray-900">
        <AppHeader />
        <div className="pt-4">{children}</div>
      </body>
    </html>
  );
}
