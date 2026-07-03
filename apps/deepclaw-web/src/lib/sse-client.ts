'use client';

import { SSEEventType } from '@/app/api/sse-server';
import { getLogger } from '@/lib/logger';

const logger = getLogger('SSEClient');

export type SSEHandler<T> = (data: T, event: MessageEvent<string>) => void;

type SSEPersistentOptions<T> = {
  removeOn?: (data: T) => boolean;
};

function parseSSEData<T>(data: string): T {
  try {
    return JSON.parse(data) as T;
  } catch {
    return data as T;
  }
}

type SSEPersistentListener = {
  eventName: string;
  listener: EventListener;
};

type SSEConnection = {
  url: string;
  source: EventSource;
  refCount: number;
  persistentListeners: Map<string, SSEPersistentListener>;
};

export class SSEClient {
  private connections = new Map<string, SSEConnection>();

  public subscribe<T>(
    key: string,
    url: string,
    eventName: SSEEventType,
    handler: SSEHandler<T>,
  ): () => void {
    const connection = this.getOrCreateConnection(key, url);
    let active = true;

    const listener: EventListener = (event) => {
      const messageEvent = event as MessageEvent<string>;
      handler(parseSSEData<T>(messageEvent.data), messageEvent);
    };

    connection.refCount += 1;
    connection.source.addEventListener(eventName, listener);

    return () => {
      if (!active) return;
      active = false;

      connection.source.removeEventListener(eventName, listener);
      connection.refCount -= 1;
      this.closeIfUnused(key, connection);
    };
  }

  public subscribePersistent<T>(
    key: string,
    url: string,
    eventName: SSEEventType,
    handler: SSEHandler<T>,
    options: SSEPersistentOptions<T> = {},
  ): () => void {
    const connection = this.getOrCreateConnection(key, url);

    if (connection.persistentListeners.has(eventName)) {
      return () => {};
    }

    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;

      connection.source.removeEventListener(eventName, listener);
      connection.persistentListeners.delete(eventName);
      this.closeIfUnused(key, connection);
    };

    const listener: EventListener = (event) => {
      const messageEvent = event as MessageEvent<string>;
      const data = parseSSEData<T>(messageEvent.data);
      handler(data, messageEvent);

      if (options.removeOn?.(data)) {
        unsubscribe();
      }
    };

    connection.persistentListeners.set(eventName, { eventName, listener });
    connection.source.addEventListener(eventName, listener);

    return unsubscribe;
  }

  public close(key: string): void {
    const connection = this.connections.get(key);
    if (!connection) return;

    connection.source.close();
    this.connections.delete(key);
  }

  public closeAll(): void {
    for (const key of this.connections.keys()) {
      this.close(key);
    }
  }

  private closeIfUnused(key: string, connection: SSEConnection): void {
    if (
      connection.refCount <= 0 &&
      connection.persistentListeners.size === 0 &&
      this.connections.get(key) === connection
    ) {
      this.close(key);
    }
  }

  private getOrCreateConnection(key: string, url: string): SSEConnection {
    const existing = this.connections.get(key);
    if (existing) {
      if (existing.url !== url) {
        throw new Error(`SSE connection key "${key}" is already bound to "${existing.url}", got "${url}".`);
      }

      if (existing.source.readyState !== EventSource.CLOSED) {
        return existing;
      }

      this.connections.delete(key);
    }

    const source = new EventSource(url);
    source.onerror = (event) => {
      logger.error({ key, url, event }, 'SSE connection error');
    };

    const connection: SSEConnection = {
      url,
      source,
      refCount: 0,
      persistentListeners: new Map(),
    };
    this.connections.set(key, connection);

    return connection;
  }
}

export const sseClient = new SSEClient();
