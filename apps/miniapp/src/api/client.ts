/**
 * Product API boundary.
 * Every product call requires a valid Waslah internal session (ADR 0035 checks).
 * No direct database access. No domain entity creation on the client.
 */

import { getSession, hasValidSession } from "../identity/session.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type ApiRequestInit = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  /** When true, skip session check (only for POST /v1/session/telegram). */
  public?: boolean;
};

function apiBase(): string {
  const base = import.meta.env.VITE_WASLAH_API_BASE;
  if (typeof base === "string" && base.length > 0) return base.replace(/\/$/, "");
  return "";
}

/**
 * Authenticated product API call.
 * Rejects before network if session is missing (ADR 0035 automated check #2).
 */
export async function apiFetch<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  if (!init.public && !hasValidSession()) {
    throw new ApiError(401, "SESSION_REQUIRED", "Waslah session required");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const session = getSession();
  if (session) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  if (init.idempotencyKey) {
    headers["Idempotency-Key"] = init.idempotencyKey;
  }

  const res = await fetch(`${apiBase()}${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    let code = "HTTP_ERROR";
    let message = res.statusText;
    try {
      const payload = (await res.json()) as { code?: string; message?: string };
      if (payload.code) code = payload.code;
      if (payload.message) message = payload.message;
    } catch {
      /* keep defaults */
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
