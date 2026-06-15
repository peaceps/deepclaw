import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RootLayout } from "@/components/layout/RootLayout";
import { loadCurrentConfig } from "@/server/configs";
import { LANG_LOCALE_MAP, DEFAULT_LANG, i18nInstance } from "@deepclaw/i18n";
import { type DeepclawConfig } from "@deepclaw/config";
import '@/i18n-server';
import { LoopGateway } from "@deepclaw/loop-gateway";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: i18nInstance.t('meta.title'),
  description: i18nInstance.t('meta.description'),
};

export default async function Layout({
  children,
}: Readonly<{
    children: React.ReactNode;
}>) {
  const lang = await loadCurrentConfig<string>('ui.lang', DEFAULT_LANG);
  const manager = await loadCurrentConfig<DeepclawConfig['manager']>('manager');
  const loopInfo = LoopGateway.getLoopInfo();
  return (
    <html
      lang={LANG_LOCALE_MAP[lang]}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-screen flex overflow-hidden">
        <RootLayout
            lang={lang}
            manager={manager}
            loopInfo={loopInfo}
        >{children}</RootLayout>
      </body>
    </html>
  );
}
