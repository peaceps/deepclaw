'use client';

import { SSEEvent } from '@/app/api/sse-types';
import { getLogger } from '@/lib/logger';

const logger = getLogger('SSEClient');

export type SSEHandler<T> = (data: T, event: MessageEvent<string>) => void;

type SSEPersistentOptions<T> = {
  removeOn?: (data: T) => boolean;
  /** Tells apart listeners of the same event that only share a connection, one loop from another. */
  key?: string;
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
  /** Marked by the first open, so that only the opens after it read as the stream coming back. */
  opened: boolean;
  reopenListeners: Set<() => void>;
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
    const listenerKey = `${eventName}:${options.key ?? ''}`;
    // The listener asked for now is the one that matters. A listener of what came before may have
    // been left waiting for an end it was never told about, once the page stopped watching, and
    // would hold the key against the answer the user is waiting for.
    this.dropPersistentListener(connection, listenerKey);

    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;

      connection.source.removeEventListener(eventName, listener);
      if (connection.persistentListeners.get(listenerKey)?.listener === listener) {
        connection.persistentListeners.delete(listenerKey);
      }
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

    connection.persistentListeners.set(listenerKey, { eventName, listener });
    connection.source.addEventListener(eventName, listener);

    return unsubscribe;
  }

  /**
   * Told whenever a stream that dropped is opened again. The server builds a client of its own for
   * every stream and the new one knows nothing of what this page had told the one before it, so
   * whoever said something on the way in is the one to say it again.
   */
  public onReopen(url: string, listener: () => void): () => void {
    const connection = this.getOrCreateConnection(url);
    connection.reopenListeners.add(listener);

    return () => {
      connection.reopenListeners.delete(listener);
    };
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

  private dropPersistentListener(connection: SSEConnection, listenerKey: string): void {
    const held = connection.persistentListeners.get(listenerKey);
    if (!held) return;

    connection.source.removeEventListener(held.eventName, held.listener);
    connection.persistentListeners.delete(listenerKey);
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
      opened: false,
      reopenListeners: new Set(),
    };
    source.onopen = () => {
      if (!connection.opened) {
        connection.opened = true;
        return;
      }
      connection.reopenListeners.forEach(listener => listener());
    };
    this.connections.set(url, connection);

    return connection;
  }
}

export const sseClient = new SSEClient();

/**
 * Every listener of a tab shares this url, and by the url the one connection behind it: a browser
 * hands a host about six, and a stream per loop spent them all on listening.
 */
export function sseUrl(browserId: string): string {
  return `/api/sse?${new URLSearchParams({browserId}).toString()}`;
}
