import type { Metadata } from "next";
import "./globals.css";
import { RootLayout } from "@/components/layout/RootLayout";
import { loadCurrentConfig } from "@/server/configs";
import { LANG_LOCALE_MAP, DEFAULT_LANG, i18nInstance, SupportedLanguage } from "@deepclaw/i18n";
import { ManagerConfig } from "@deepclaw/config";
import '@/i18n-server';
import { LoopGateway } from "@deepclaw/loop-gateway";

export const metadata: Metadata = {
  title: i18nInstance.t('meta.title'),
  description: i18nInstance.t('meta.description'),
};

export default async function Layout({
  children,
}: Readonly<{
    children: React.ReactNode;
}>) {
  const lang = await loadCurrentConfig<SupportedLanguage>('ui.lang', DEFAULT_LANG);
  const manager = await loadCurrentConfig<ManagerConfig>('manager');
  const loopInfo = LoopGateway.getLoopInfo();
  return (
    <html
      lang={LANG_LOCALE_MAP[lang]}
      className="h-full antialiased"
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
