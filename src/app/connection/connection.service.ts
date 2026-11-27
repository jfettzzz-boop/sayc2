import { Injectable, computed, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

const MODE_KEY = 'sayc_connection_mode';
const URL_KEY = 'sayc_server_url';
const TEST_TIMEOUT_MS = 8000;

/**
 * Where the app's data lives. 'local' is a database inside the app, which needs no network.
 * 'server' is the API, at any address, which can move without rebuilding the app.
 * They are separate sets of data: nothing is copied from one to the other.
 */
export type ConnectionMode = 'local' | 'server';

/** Trims what people paste, so "https://x.com/api/v1/" and "https://x.com" mean the same. */
export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/api\/v1$/i, '').replace(/\/+$/, '');
}

/** Set by `npm run build:web` from the SAYC_API_URL environment variable; absent in other builds. */
declare const SAYC_API_URL: string | undefined;

/**
 * The API address the web build was made for, such as the Render service when the app is on Vercel.
 * Empty when the app is served beside the API, which then answers on the same address.
 */
export function builtInServerUrl(): string {
  return typeof SAYC_API_URL === 'string' ? normalizeServerUrl(SAYC_API_URL) : '';
}

export function isValidServerUrl(url: string): boolean {
  return /^https?:\/\/[^\s/]+(\/\S*)?$/i.test(url);
}

@Injectable({ providedIn: 'root' })
export class ConnectionService {
  /** A browser is served beside the API, so it needs no address. An installed app has nothing beside it. */
  readonly isNative = Capacitor.isNativePlatform();

  readonly mode = signal<ConnectionMode>(this.loadMode());
  /** A saved address wins; with none, the one the build was made for. */
  readonly serverUrl = signal(localStorage.getItem(URL_KEY) || builtInServerUrl());
  readonly isLocal = computed(() => this.mode() === 'local');

  /** An app that was never configured has to work, so it starts on the device's own database. */
  private loadMode(): ConnectionMode {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'local' || saved === 'server') return saved;
    return this.isNative ? 'local' : 'server';
  }

  save(mode: ConnectionMode, serverUrl: string) {
    const url = normalizeServerUrl(serverUrl);
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(URL_KEY, url);
    this.mode.set(mode);
    this.serverUrl.set(url);
  }

  /** Tries the address as the app would, including the browser's cross-origin rules. */
  async testServer(serverUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/v1/health`, {
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      if (!response.ok) return false;
      return (await response.json())?.status === 'ok';
    } catch {
      return false;
    }
  }
}
