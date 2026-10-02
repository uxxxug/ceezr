/**
 * DEC-43: محادثةٌ داخلَ التذكرة — إضافةُ رسالةٍ وقراءةُ المحادثة.
 * الترتيبُ: جلسةٌ، ثمَّ تحقُّقُ المعرّفِ، ثمَّ قبولُ الرسالةِ، ثمَّ كتابةٌ مُقيَّدةٌ بالملكيةِ.
 *
 * الحالة: منفَّذ.
 * ينتمي إلى: packages/application/dispute
 */

import type { Result } from "../../shared/result/index.ts";
import { err, ok } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";

export type TicketSenderType = "rider" | "driver";

export interface TicketMessage {
  readonly id: string;
  readonly senderType: string;
  readonly message: string;
  readonly createdAtMs: number;
}

export type TicketThreadStoreFailure = {
  readonly code: "TICKET_THREAD_STORE_FAILED";
  readonly reason:
    | "STORE_ERROR"
    | "USER_NOT_FOUND"
    | "TICKET_NOT_FOUND"
    | "TICKET_CLOSED"
    | "MESSAGE_INVALID"
    | "SENDER_TYPE_INVALID";
};

export interface TicketThreadReader {
  list(input: {
    readonly telegramUserId: string;
    readonly ticketId: string;
    readonly senderType: TicketSenderType;
    readonly limit: number;
  }): Promise<Result<readonly TicketMessage[], TicketThreadStoreFailure>>;
}

export interface TicketThreadWriter {
  add(input: {
    readonly telegramUserId: string;
    readonly ticketId: string;
    readonly message: string;
    readonly senderType: TicketSenderType;
  }): Promise<
    Result<
      { readonly status: "added"; readonly messageId: string; readonly createdAtMs: number },
      TicketThreadStoreFailure
    >
  >;
}

export type TicketThreadPublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_REJECTED"
  | "MALFORMED"
  | "TICKET_NOT_FOUND"
  | "TICKET_CLOSED"
  | "MESSAGE_EMPTY"
  | "MESSAGE_TOO_LONG"
  | "TICKET_THREAD_STORE_NOT_AVAILABLE";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_MIN = 1;
const MESSAGE_MAX = 2000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export interface TicketThreadDeps {
  readonly sessions: MiniAppSessionReader;
  readonly reader: TicketThreadReader;
  readonly writer?: TicketThreadWriter | undefined;
  readonly now: () => Date;
}

async function authenticate(
  deps: TicketThreadDeps,
  accessToken: string | undefined,
): Promise<Result<string, TicketThreadPublicErrorCode>> {
  if (accessToken === undefined || accessToken === "") return err("SESSION_REQUIRED");
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err("SESSION_REJECTED");
  return ok(session.value.telegramUserId);
}

function validateMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  if (trimmed.length < MESSAGE_MIN) return null;
  if (message.length > MESSAGE_MAX) return null;
  return message;
}

/** قراءةُ محادثةِ التذكرةِ — `GET /v1/support/tickets/:id/messages`. */
export async function listTicketMessages(
  deps: TicketThreadDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly ticketId: string;
    readonly senderType: TicketSenderType;
    readonly limit?: unknown;
  },
): Promise<Result<readonly TicketMessage[], TicketThreadPublicErrorCode>> {
  const identified = await authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  if (!UUID_PATTERN.test(input.ticketId)) return err("TICKET_NOT_FOUND");

  let limit = DEFAULT_LIMIT;
  if (typeof input.limit === "number" && input.limit >= 1 && input.limit <= MAX_LIMIT) {
    limit = input.limit;
  }

  const result = await deps.reader.list({
    telegramUserId: identified.value,
    ticketId: input.ticketId,
    senderType: input.senderType,
    limit,
  });
  if (!result.ok) {
    if (result.error.reason === "USER_NOT_FOUND") return err("TICKET_THREAD_STORE_NOT_AVAILABLE");
    if (result.error.reason === "TICKET_NOT_FOUND") return err("TICKET_NOT_FOUND");
    return err("TICKET_THREAD_STORE_NOT_AVAILABLE");
  }
  return ok(result.value);
}

/** إضافةُ رسالةٍ للتذكرةِ — `POST /v1/support/tickets/:id/messages`. */
export async function addTicketMessage(
  deps: TicketThreadDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly ticketId: string;
    readonly senderType: TicketSenderType;
    readonly body: unknown;
  },
): Promise<
  Result<
    { readonly status: "added"; readonly messageId: string; readonly createdAtMs: number },
    TicketThreadPublicErrorCode
  >
> {
  const identified = await authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  if (!UUID_PATTERN.test(input.ticketId)) return err("TICKET_NOT_FOUND");

  if (deps.writer === undefined) return err("TICKET_THREAD_STORE_NOT_AVAILABLE");

  if (typeof input.body !== "object" || input.body === null) return err("MALFORMED");
  const body = input.body as Record<string, unknown>;

  const message = validateMessage(body.message);
  if (message === null) {
    if (typeof body.message !== "string" || body.message.trim().length === 0)
      return err("MESSAGE_EMPTY");
    return err("MESSAGE_TOO_LONG");
  }

  const result = await deps.writer.add({
    telegramUserId: identified.value,
    ticketId: input.ticketId,
    message,
    senderType: input.senderType,
  });
  if (!result.ok) {
    if (result.error.reason === "TICKET_NOT_FOUND") return err("TICKET_NOT_FOUND");
    if (result.error.reason === "TICKET_CLOSED") return err("TICKET_CLOSED");
    if (result.error.reason === "MESSAGE_INVALID") return err("MESSAGE_TOO_LONG");
    return err("TICKET_THREAD_STORE_NOT_AVAILABLE");
  }
  return ok(result.value);
}
