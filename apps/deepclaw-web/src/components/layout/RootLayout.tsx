'use client';

import { useState, useRef } from 'react';
import {initI18n} from '@/i18n';
import { Sidebar } from './Sidebar';

interface RootLayoutProps {
  lang: string;
  children: React.ReactNode;
}

export function RootLayout({ lang, children }: RootLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const i18nInitRef = useRef<boolean | null>(null);
  if (i18nInitRef.current === null) {
      initI18n(lang);
      i18nInitRef.current = true;
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
