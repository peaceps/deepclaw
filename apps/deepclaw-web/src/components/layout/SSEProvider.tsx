'use client';

import { createContext, useContext, useEffect } from 'react';
import { sseClient, type SSEClient } from '@/lib/sse-client';

const SSEClientContext = createContext<SSEClient>(sseClient);

type SSEProviderProps = {
  children: React.ReactNode;
};

export function SSEProvider({ children }: SSEProviderProps) {
  useEffect(() => {
    return () => {
      sseClient.closeAll();
    };
  }, []);

  return (
    <SSEClientContext.Provider value={sseClient}>
      {children}
    </SSEClientContext.Provider>
  );
}

export function useSSEClient(): SSEClient {
  return useContext(SSEClientContext);
}
