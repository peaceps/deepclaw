'use client';

import { SSEEvent } from '@/app/api/sse-types';
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
  source: EventSource;
  refCount: number;
  persistentListeners: Map<string, SSEPersistentListener>;
};

export class SSEClient {
  private connections = new Map<string, SSEConnection>();

  public subscribe<T>(
    url: string,
    eventName: SSEEvent['eventType'],
    handler: SSEHandler<T>,
  ): () => void {
    const connection = this.getOrCreateConnection(url);
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
      this.closeIfUnused(url, connection);
    };
  }

  public subscribePersistent<T>(
    url: string,
    eventName: SSEEvent['eventType'],
    handler: SSEHandler<T>,
    options: SSEPersistentOptions<T> = {},
  ): () => void {
    const connection = this.getOrCreateConnection(url);

    if (connection.persistentListeners.has(eventName)) {
      return () => {};
    }

    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;

      connection.source.removeEventListener(eventName, listener);
      connection.persistentListeners.delete(eventName);
      this.closeIfUnused(url, connection);
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

  public close(url: string): void {
    const connection = this.connections.get(url);
    if (!connection) return;

    connection.source.close();
    this.connections.delete(url);
  }

  public closeAll(): void {
    for (const url of this.connections.keys()) {
      this.close(url);
    }
  }

  private closeIfUnused(url: string, connection: SSEConnection): void {
    if (
      connection.refCount <= 0 &&
      connection.persistentListeners.size === 0 &&
      this.connections.get(url) === connection
    ) {
      this.close(url);
    }
  }

  private getOrCreateConnection(url: string): SSEConnection {
    const existing = this.connections.get(url);
    if (existing) {
      if (existing.source.readyState !== EventSource.CLOSED) {
        return existing;
      }
      this.connections.delete(url);
    }

    const source = new EventSource(url);
    source.onerror = (event) => {
      logger.error({ url, event }, 'SSE connection error');
    };

    const connection: SSEConnection = {
      source,
      refCount: 0,
      persistentListeners: new Map(),
    };
    this.connections.set(url, connection);

    return connection;
  }
}

export const sseClient = new SSEClient();
