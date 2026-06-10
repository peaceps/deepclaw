'use client';

import { useState } from 'react';
import {initI18n} from '@/i18n';
import { Sidebar } from './Sidebar';

interface RootLayoutProps {
  lang: string;
  defaultLang: string;
  children: React.ReactNode;
}

export function RootLayout({ lang, defaultLang, children }: RootLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [i18nInit, setI18nInit] = useState(false);
  if (!i18nInit) {
      initI18n(lang, defaultLang);
      setI18nInit(true);
  }

  return (
    <>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main className="flex-1 overflow-hidden w-full h-full pt-[57px] lg:pt-0">{children}</main>
    </>
  );
}
