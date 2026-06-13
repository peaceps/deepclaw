import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RootLayout } from "@/components/layout/RootLayout";
import { loadCurrentConfig } from "@/server/configs";
import { LANG_LOCALE_MAP, DEFAULT_LANG } from "@deepclaw/i18n";
import { DeepclawConfig } from "@deepclaw/config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DeepClaw - AI Agent 管理系统",
  description: "把每个 Agent 视为公司里的真实员工",
};

export default async function Layout({
  children,
}: Readonly<{
    children: React.ReactNode;
}>) {
  const lang = await loadCurrentConfig<string>('ui.lang', DEFAULT_LANG);
  const manager = await loadCurrentConfig<DeepclawConfig['manager']>('manager');
  return (
    <html
      lang={LANG_LOCALE_MAP[lang]}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-screen flex overflow-hidden">
        <RootLayout
            lang={lang}
            manager={manager}
        >{children}</RootLayout>
      </body>
    </html>
  );
}
