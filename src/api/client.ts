import * as SecureStore from 'expo-secure-store';
import { LoginResponse, Session, Transcript, AbortResponse, HealthResponse, ChatStreamEvent } from '../types/api';

const TOKEN_KEY = 'brain_auth_token';
const SERVER_KEY = 'brain_server_url';

// Default — override in settings
let serverUrl = '';

export async function getServerUrl(): Promise<string> {
  if (!serverUrl) {
    serverUrl = (await SecureStore.getItemAsync(SERVER_KEY)) || '';
  }
  return serverUrl;
}

export async function setServerUrl(url: string): Promise<void> {
  // Normalize: strip trailing slash
  serverUrl = url.replace(/\/+$/, '');
  await SecureStore.setItemAsync(SERVER_KEY, serverUrl);
}

async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;

  try {
    const base = await getServerUrl();
    if (!base) return false;
    // Use an authenticated endpoint — /health is public and always 200
    const resp = await fetch(`${base}/api/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401) {
      await clearToken();
      return false;
    }
    return resp.ok;
  } catch {
    return false;
  }
}

/** Check if a server URL is reachable (no auth required) */
export async function isServerReachable(url?: string): Promise<boolean> {
  try {
    const base = url || await getServerUrl();
    if (!base) return false;
    // AbortSignal.timeout() doesn't exist in Hermes — use manual AbortController
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(`${base}/health`, { signal: controller.signal });
      return resp.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

// ── Auth ──

export async function login(username: string, password: string): Promise<LoginResponse> {
  const base = await getServerUrl();
  const resp = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error || 'Login failed');
  }

  const data: LoginResponse = await resp.json();
  await setToken(data.bearerToken);
  return data;
}

export async function logout(): Promise<void> {
  const base = await getServerUrl();
  const token = await getToken();
  try {
    await fetch(`${base}/api/logout`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    // Best-effort
  }
  await clearToken();
}

// ── Authenticated fetch helper ──

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const base = await getServerUrl();
  const token = await getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const resp = await fetch(`${base}${path}`, { ...options, headers });

  if (resp.status === 401) {
    await clearToken();
    notifyAuthExpired();
    throw new AuthError('Session expired');
  }

  return resp;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// ── Auth event bus — lets useAuth react to 401s from anywhere ──

type AuthListener = () => void;
const authListeners: Set<AuthListener> = new Set();

export function onAuthExpired(listener: AuthListener): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

function notifyAuthExpired(): void {
  for (const fn of authListeners) {
    try { fn(); } catch {}
  }
}

// ── Sessions ──

export async function getActiveSessions(): Promise<{ sessions: Session[] }> {
  const resp = await apiFetch('/api/sessions/active');
  return resp.json();
}

export async function getSessionMessages(sessionId: string): Promise<any> {
  const encoded = encodeURIComponent(sessionId);
  const resp = await apiFetch(`/api/sessions/active/${encoded}`);
  return resp.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  const encoded = encodeURIComponent(sessionId);
  await apiFetch(`/api/sessions/active/${encoded}`, { method: 'DELETE' });
}

// ── Transcripts ──

export async function getTranscripts(params?: {
  channel?: string;
  excludeChannel?: string;
  limit?: number;
  offset?: number;
  q?: string;
}): Promise<{ transcripts: Transcript[]; total: number; hasMore: boolean }> {
  const query = new URLSearchParams();
  if (params?.channel) query.set('channel', params.channel);
  if (params?.excludeChannel) query.set('excludeChannel', params.excludeChannel);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  if (params?.q) query.set('q', params.q);

  const resp = await apiFetch(`/api/transcripts?${query}`);
  return resp.json();
}

export async function getTranscript(filename: string): Promise<any> {
  const resp = await apiFetch(`/api/transcripts/${encodeURIComponent(filename)}`);
  return resp.json();
}

// ── Chat ──

export async function resetChat(sessionId?: string): Promise<void> {
  await apiFetch('/api/chat/reset', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

export async function abortChat(sessionId?: string): Promise<AbortResponse> {
  const resp = await apiFetch('/api/chat/abort', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
  return resp.json();
}

/**
 * Stream a chat message via SSE.
 *
 * React Native's fetch() doesn't support ReadableStream in all runtimes,
 * so we use XMLHttpRequest to read the stream incrementally.
 */
export async function streamChat(
  message: string,
  sessionId: string | undefined,
  onEvent: (event: ChatStreamEvent) => void,
  options?: {
    model?: string;
    tools?: boolean;
    signal?: AbortSignal;
  },
): Promise<void> {
  const base = await getServerUrl();
  const token = await getToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base}/api/chat/stream`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // 10 minute timeout — matches Brain's server-side SSE timeout
    xhr.timeout = 600000;

    // Track how much of the response we've consumed + line buffer for partial chunks
    let cursor = 0;
    let lineBuf = '';
    let eventType = '';

    xhr.onreadystatechange = () => {
      // readyState 3 = LOADING (data is being received)
      if (xhr.readyState >= 3 && xhr.responseText) {
        const chunk = xhr.responseText.slice(cursor);
        cursor = xhr.responseText.length;

        // Prepend any leftover partial line from previous chunk
        const raw = lineBuf + chunk;
        const lines = raw.split('\n');

        // Last element is either '' (chunk ended on \n) or a partial line — keep it for next chunk
        lineBuf = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              // Normalize event type into the data object
              if (eventType && !data.type) {
                data.type = eventType;
              }
              onEvent(data);
            } catch {
              // Genuinely malformed JSON — log and skip
            }
            eventType = '';
          }
          // Empty lines (SSE event boundaries) just reset eventType
          else if (line.trim() === '') {
            eventType = '';
          }
        }
      }

      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          resolve();
        } else if (xhr.status === 401) {
          clearToken().then(() => { notifyAuthExpired(); reject(new AuthError('Session expired')); });
          return;
        } else {
          reject(new Error(`Chat failed: ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Request timed out'));

    // Wire up abort signal
    if (options?.signal) {
      options.signal.addEventListener('abort', () => {
        xhr.abort();
        resolve(); // Don't reject on user abort
      });
    }

    xhr.send(JSON.stringify({
      message,
      sessionId,
      model: options?.model,
      tools: options?.tools ?? true,
    }));
  });
}

// ── Health ──

export async function getHealth(): Promise<HealthResponse> {
  const base = await getServerUrl();
  const resp = await fetch(`${base}/health`);
  return resp.json();
}

// ── Restore session from transcript ──

export async function restoreSession(filename: string, sessionId?: string): Promise<any> {
  const resp = await apiFetch('/api/chat/restore', {
    method: 'POST',
    body: JSON.stringify({ filename, sessionId }),
  });
  return resp.json();
}
