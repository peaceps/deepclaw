import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RootLayout } from "@/components/layout/RootLayout";
import { loadCurrentConfig } from "@/server/configs";
import { LANG_BCP47_LOCALE_MAP, DEFAULT_LANG, i18nInstance, SupportedLanguage } from "@deepclaw/i18n";
import { ManagerConfig } from "@deepclaw/config";
import { LoopGateway } from "@deepclaw/loop-gateway";

export const metadata: Metadata = {
  title: i18nInstance.t('server.meta.title'),
  description: i18nInstance.t('server.meta.description'),
};

// resizes-content: on Android the on-screen keyboard shrinks the layout viewport
// instead of overlaying it, so the chat input stays visible while typing.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  interactiveWidget: 'resizes-content',
};

export default async function Layout({
  children,
}: Readonly<{
    children: React.ReactNode;
}>) {
  const lang = await loadCurrentConfig<SupportedLanguage>('ui.lang', DEFAULT_LANG);
  const manager = await loadCurrentConfig<ManagerConfig>('manager');
  const dataInfo = LoopGateway.getDataInfo();
  return (
    <html
      lang={LANG_BCP47_LOCALE_MAP[lang]}
      className="h-full antialiased"
    >
      {/*
        h-screen (100vh) is only the fallback: on mobile browsers 100vh is the
        large viewport, which leaves the bottom of the app hidden behind the
        URL bar. 100dvh tracks the visible viewport; browsers without dvh
        support drop the inline declaration and fall back to the class.
      */}
      <body className="h-screen flex overflow-hidden" style={{ height: '100dvh' }}>
        <RootLayout
            lang={lang}
            manager={manager}
            dataInfo={dataInfo}
        >{children}</RootLayout>
      </body>
    </html>
  );
}
