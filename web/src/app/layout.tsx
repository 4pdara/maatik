import type { Metadata, Viewport } from "next";
import "@fontsource/david-libre/400.css";
import "@fontsource/david-libre/500.css";
import "@fontsource/david-libre/700.css";
import "@fontsource/frank-ruhl-libre/400.css";
import "@fontsource/frank-ruhl-libre/500.css";
import "@fontsource/frank-ruhl-libre/700.css";
import "./globals.css";

export const metadata: Metadata = { title: "מעתיק", description: "הגהת תעתוק של כתבי יד" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
