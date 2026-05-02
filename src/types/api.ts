// Brain API types

export interface LoginResponse {
  ok: boolean;
  bearerToken: string;
}

export interface Session {
  sessionId: string;
  channel: string;
  messageCount: number;
  startedAt: string;
  lastActive: string;
  busy: boolean;
  isLive: boolean;
  preview?: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface Transcript {
  file: string;
  sessionId: string;
  channel: string;
  startedAt: string;
  archivedAt?: string;
  messageCount: number;
  preview?: string;
}

export interface ChatStreamEvent {
  type: 'text_delta' | 'tool_start' | 'tool_input' | 'tool_summary' | 'turn_complete' | 'done' | 'error' | 'queued' | 'compaction';
  delta?: string;
  name?: string;
  input?: Record<string, unknown>;
  summary?: string;
  text?: string;
  turn?: number;
  message?: string;
  sessionId?: string;
  cost?: Record<string, unknown>;
}

export interface HealthResponse {
  status: string;
  uptime: number;
  uptimeFormatted: string;
  version: string;
  node: string;
  sessions: number;
  crons: number;
  runningJobs: number;
}

export interface AbortResponse {
  ok: boolean;
  aborted: boolean;
  sessionId: string;
}
