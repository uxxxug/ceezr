/**
 * الغرض: **نواةُ استقبالِ تذكرةِ دعمٍ** — الجلسةُ والتحقُّقُ والترقيمُ وترجمةُ
 *   رفضِ القاعدةِ، **بلا دورٍ**؛ يمرُّ الدورُ مُعامَلاً (`F3-08` · `SR-11` · `SD-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08` (مُستخرَجٌ من `rider-support.ts` بلا
 *   تغييرِ سلوكٍ، ويُقاسُ ذلكَ بحالاتِ الراكبِ القائمةِ كما هيَ).
 * ينتمي إلى: packages/application/support
 * يُستخدم من: `rider-support.ts` · `driver-support.ts`
 * يُتوقع أن يستخدمه لاحقاً: أيُّ دورٍ ثالثٍ يفتحُ تذكرةً (موظّفُ دعمٍ عن نفسِه).
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لِمَ نواةٌ واحدةٌ ولا ملفٌّ للسائقِ يُشبِهُ ملفَّ الراكبِ
 *
 * الفرقُ بينَ الدورَينِ **مجالُ أصنافٍ وما يلزمُه رحلةٌ** — لا شيءَ غيرَ ذلكَ:
 * الجلسةُ واحدةٌ، وحدُّ المحارفِ واحدٌ، وترقيمُ المفتاحِ واحدٌ، وترجمةُ رفضِ
 * القاعدةِ واحدةٌ. **ولو نُسِخَ الملفُّ** لَصارَ لحدِّ الصفحةِ حكمانِ ولترجمةِ
 * `COOLDOWN_ACTIVE` حكمانِ، ولافترقا عندَ أوّلِ إصلاحٍ في أحدِهما — وذاكَ عينُ
 * «أقلِّ مصادرِ حقيقةٍ مُكرَّرةٍ». فالمُختلِفُ يُمرَّرُ **مواصفةً** والباقي واحدٌ.
 *
 * **ولا سلوكَ تغيَّرَ بالاستخراجِ** (`ح-8`): الشِّفرةُ منقولةٌ حرفاً، ودوالُّ
 * الراكبِ المُصدَّرةُ بأسمائِها وتوقيعاتِها كما كانَت، وحالاتُ وحدتِه الثمانِ
 * والأربعونَ تُقاسُ عليها بلا تعديلِ حرفٍ فيها.
 *
 * ## وما لا تفعلُه هذه النواةُ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا تعرفُ SQL ولا HTTP**: المخزنُ منفذٌ، والحالةُ تُخرَّجُ رمزاً.
 *   ــ **لا تقرأُ دوراً من الجسمِ**: الدورُ **مواصفةٌ يختارُها المسارُ** من
 *      الصنفِ، والقاعدةُ تحكمُ فيه أخيراً (`NOT_A_DRIVER`).
 *   ــ **لا تُرفِقُ ملفاً ولا تُرسِلُ إشعاراً**: كما كانَ، دَينٌ مُعلَنٌ.
 */

import {
  DEFAULT_SUPPORT_PAGE_SIZE,
  MAX_SUPPORT_MESSAGE_CHARS,
  MAX_SUPPORT_PAGE_SIZE,
} from "../../domain/support/rider-support.ts";
import type {
  OpenedSupportTicketOf,
  SupportTicketCursor,
  SupportTicketsPage,
  SupportTicketType,
} from "../../domain/support/ticket-types.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import { isSupportRejection, type SupportStoreError, type SupportTicketStore } from "./ports.ts";

/**
 * رموزُ العطبِ التي **تُنشَرُ** — مجالٌ مغلقٌ تُقابِلُه خريطةُ حالاتٍ شاملةٌ.
 * وهيَ **قائمةٌ تُقرأُ في زمنِ التشغيلِ** لا اتّحادُ أنواعٍ وحدَه: الحاجزُ الذي
 * يُلزِمُ أنَّ لكلِّ رمزٍ نصّاً في القواميسِ الثلاثةِ لا يرى الأنواعَ، ونسخُ
 * القائمةِ في الحاجزِ يجعلُها **مصدرَ حقيقةٍ ثانياً** يتخلّفُ عندَ أوّلِ رمزٍ
 * جديدٍ (القاعدة 0.6).
 *
 * **وهيَ واحدةٌ للدورَينِ**: رمزٌ يُعرَضُ للسائقِ ولا يُعرَضُ للراكبِ يعني
 * شاشةً بلا نصٍّ عندَ أوّلِ رفضٍ مشتركٍ.
 */
export const SUPPORT_PUBLIC_ERROR_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "SUPPORT_STORE_NOT_AVAILABLE",
  "CATEGORY_UNKNOWN",
  "MESSAGE_EMPTY",
  "MESSAGE_TOO_LONG",
  "ORDER_REQUIRED",
  "ORDER_INVALID",
  "ORDER_NOT_YOURS",
  "COOLDOWN_ACTIVE",
  "ACCOUNT_BLOCKED",
  "NOT_REGISTERED",
  "CITY_NOT_READY",
  "LIMIT_OUT_OF_RANGE",
  "CURSOR_INVALID",
] as const;

export type SupportPublicErrorCode = (typeof SUPPORT_PUBLIC_ERROR_CODES)[number];

/** رفضٌ يحملُ ثانيةً — التهدئةُ وحدَها تُخبِرُ «بعدَ كم؟». */
export interface SupportRejection {
  readonly code: SupportPublicErrorCode;
  readonly retryAfterSeconds: number | null;
}

export interface SupportIntakeDeps<C extends SupportTicketType> {
  readonly sessions: MiniAppSessionReader;
  readonly store: SupportTicketStore<C>;
  readonly now: () => Date;
}

/**
 * **مواصفةُ الدورِ** — كلُّ ما يختلفُ بينَ راكبٍ وسائقٍ، مكتوباً في موضعٍ واحدٍ
 * يُقرأُ: مجالُ أصنافِه، وما يلزمُه رحلةً منها.
 */
export interface SupportRoleSpec<C extends SupportTicketType> {
  readonly isCategory: (value: unknown) => value is C;
  readonly requiresOrder: (category: C) => boolean;
}

export function rejection(
  code: SupportPublicErrorCode,
  retryAfterSeconds: number | null = null,
): SupportRejection {
  return { code, retryAfterSeconds };
}

function sessionErrorFrom(reason: string): SupportPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

async function openSession<C extends SupportTicketType>(
  deps: SupportIntakeDeps<C>,
  accessToken: string | undefined,
): Promise<Result<string, SupportRejection>> {
  if (accessToken === undefined || accessToken.length === 0)
    return err(rejection("SESSION_REQUIRED"));
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(rejection(sessionErrorFrom(session.error.reason)));
  return ok(session.value.telegramUserId);
}

/**
 * تحويلُ رفضِ المخزنِ إلى رمزٍ منشورٍ — **شاملٌ حرفاً** لاتّحادِ
 * `SupportStoreRejection`، فرمزٌ جديدٌ في القاعدةِ يُسقِطُ الترجمةَ في زمنِ
 * البناءِ (`switch` مُستنفَدٌ) لا يمرُّ خاماً إلى شاشةٍ.
 */
export function publicCodeFrom(error: SupportStoreError): SupportRejection {
  if (!isSupportRejection(error)) return rejection("SUPPORT_STORE_NOT_AVAILABLE");
  switch (error.rejection) {
    case "MESSAGE_EMPTY":
      return rejection("MESSAGE_EMPTY");
    // حسابٌ لا صفَّ له في القاعدةِ ليسَ جلسةً فاسدةً: جلسةٌ سليمةٌ لمن لم يُنشَأْ
    // صفُّه بعدُ (القسم 9.8). والشاشةُ تقولُ «أكمِلْ تسجيلَكَ» لا «انتهت جلستُكَ».
    case "USER_NOT_FOUND":
    case "NOT_REGISTERED":
    case "NOT_A_RIDER":
    case "NOT_A_DRIVER":
      return rejection("NOT_REGISTERED");
    case "USER_BLOCKED":
      return rejection("ACCOUNT_BLOCKED");
    case "CITY_GROUP_MISSING":
      return rejection("CITY_NOT_READY");
    case "COOLDOWN_ACTIVE":
      return rejection("COOLDOWN_ACTIVE", error.retryAfterSeconds);
    case "ORDER_NOT_YOURS":
      return rejection("ORDER_NOT_YOURS");
    case "LIMIT_OUT_OF_RANGE":
      return rejection("LIMIT_OUT_OF_RANGE");
    case "CURSOR_INCOMPLETE":
      return rejection("CURSOR_INVALID");
  }
}

/** معرّفٌ لا يُشبِهُ `uuid` يُردُّ ههنا: لا يُرسَلُ نصٌّ ليُسقِطَه المُحرِّكُ. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function openSupportTicket<C extends SupportTicketType>(
  deps: SupportIntakeDeps<C>,
  spec: SupportRoleSpec<C>,
  input: {
    readonly accessToken: string | undefined;
    readonly category: unknown;
    readonly message: unknown;
    readonly orderId: unknown;
  },
): Promise<Result<OpenedSupportTicketOf<C>, SupportRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  if (!spec.isCategory(input.category)) return err(rejection("CATEGORY_UNKNOWN"));

  if (typeof input.message !== "string") return err(rejection("MESSAGE_EMPTY"));
  const message = input.message.trim();
  if (message.length === 0) return err(rejection("MESSAGE_EMPTY"));
  // **القياسُ على المحارفِ لا البايتاتِ**: حدٌّ بالبايتِ يقطعُ العربيَّةَ عندَ
  // نصفِ ما يقطعُ به الإنجليزيّةَ، فيصيرُ الحدُّ عقوبةً على اللغةِ.
  if ([...message].length > MAX_SUPPORT_MESSAGE_CHARS) return err(rejection("MESSAGE_TOO_LONG"));

  let orderId: string | null = null;
  if (input.orderId !== undefined && input.orderId !== null) {
    if (typeof input.orderId !== "string" || !UUID_PATTERN.test(input.orderId)) {
      return err(rejection("ORDER_INVALID"));
    }
    orderId = input.orderId;
  }
  if (orderId === null && spec.requiresOrder(input.category)) {
    return err(rejection("ORDER_REQUIRED"));
  }

  const written = await deps.store.openTicket({
    telegramUserId: session.value,
    category: input.category,
    message,
    orderId,
  });
  if (!written.ok) return err(publicCodeFrom(written.error));
  return ok(written.value);
}

export async function listSupportTickets<C extends SupportTicketType>(
  deps: SupportIntakeDeps<C>,
  input: {
    readonly accessToken: string | undefined;
    readonly limit: unknown;
    readonly cursorCreatedAt: unknown;
    readonly cursorId: unknown;
  },
): Promise<Result<SupportTicketsPage, SupportRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  let limit = DEFAULT_SUPPORT_PAGE_SIZE;
  if (input.limit !== undefined && input.limit !== null && input.limit !== "") {
    const parsed = typeof input.limit === "number" ? input.limit : Number(input.limit);
    // **يُردُّ ولا يُقصَرُ صامتاً**: طالبُ مئةٍ يُجابُ بعطبٍ يُقرأُ لا بعشرينَ
    // يظنُّها مئةً فيبني ترقيمَه على وهمٍ (درسُ `F2-08`).
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_SUPPORT_PAGE_SIZE) {
      return err(rejection("LIMIT_OUT_OF_RANGE"));
    }
    limit = parsed;
  }

  const hasCreatedAt =
    typeof input.cursorCreatedAt === "string" && input.cursorCreatedAt.length > 0;
  const hasId = typeof input.cursorId === "string" && input.cursorId.length > 0;
  // شطرٌ بلا شطرٍ ليسَ مؤشِّراً: يُنتِجُ صفحةً غيرَ حتميّةٍ (`ADR 0108`).
  if (hasCreatedAt !== hasId) return err(rejection("CURSOR_INVALID"));

  let cursor: SupportTicketCursor | null = null;
  if (hasCreatedAt && hasId) {
    const createdAt = input.cursorCreatedAt as string;
    const id = input.cursorId as string;
    if (Number.isNaN(new Date(createdAt).getTime()) || !UUID_PATTERN.test(id)) {
      return err(rejection("CURSOR_INVALID"));
    }
    cursor = { createdAt, id };
  }

  const read = await deps.store.listTickets({
    telegramUserId: session.value,
    limit,
    cursor,
  });
  if (!read.ok) return err(publicCodeFrom(read.error));
  return ok(read.value);
}
