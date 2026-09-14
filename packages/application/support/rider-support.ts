/**
 * الغرض: حالتا استخدامِ الدعمِ من داخلِ التطبيقِ — «افتحْ شكوى» و«تذاكري
 *   وحالاتُها» (`F2-12` · `SR-11` · §9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: packages/application/support
 * يُستخدم من: `apps/gateway/src/routes/support-tickets.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` — الدورُ لا يُذكَرُ في هذه الطبقةِ،
 *   والسائقُ يدخلُ من المسارِ نفسِه بأصنافِه.
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لماذا يُفحَصُ الصنفُ والنصُّ **ههنا** والقاعدةُ تفحصُ أيضاً
 *
 * ليسَ تكراراً بل **بابانِ لواحدةٍ**: القاعدةُ تحرسُ البيانةَ من كلِّ نداءٍ
 * (بوتٌ · بوابةٌ · لوحةٌ)، وهذه الطبقةُ تُحوِّلُ خطأَ الإنسانِ إلى **رمزٍ
 * مُصنَّفٍ ونصِّ شاشةٍ** قبلَ أن يُنفَقَ ذَهابٌ إلى القاعدةِ. ولو تُرِكَ الصنفُ
 * يمرُّ نصّاً لَعادَ `22P02` من مُحرِّكِ القاعدةِ — وذاكَ يُقرأُ `503` لا `422`،
 * فيظنُّ المستخدمُ العطبَ عندَنا وهو في اختيارِه.
 *
 * ## ولماذا لا مفتاحُ تكرارٍ (`Idempotency-Key`) على فتحِ التذكرةِ
 *
 * لأنَّ **التهدئةَ هي حاجزُ التكرارِ ههنا**: `support_ticket_cooldown_seconds`
 * يمنعُ تذكرةً ثانيةً لصاحبِها قبلَ مُضيِّ مُدَّتِه، فإعادةُ الإرسالِ من شبكةٍ
 * متعثِّرةٍ تُردُّ `COOLDOWN_ACTIVE` **لا تُنشئُ تذكرتَينِ**. ومفتاحُ تكرارٍ
 * فوقَه جدولُ مفاتيحٍ ثانٍ وحاجزٌ ثانٍ لِما هو محروسٌ في القاعدةِ — و«أقلُّ
 * مصادرِ حقيقةٍ مُكرَّرةٍ» يردُّه. **وهذا ليسَ إعفاءً عامّاً**: القسم 10 يوجبُ
 * المفتاحَ على الأوامرِ التي **لا حاجزَ لها في القاعدةِ**، وأمرُ إنشاءِ الرحلةِ
 * منها فمفتاحُه إلزاميٌّ.
 *
 * ## وما لا تفعلُه هاتانِ الحالتانِ عن قصدٍ — وحدودُه مُعلَنةٌ (`ح-5`)
 *
 *   ــ **لا تقرآنِ معرّفاً من الجسمِ**: معرّفُ صاحبِ التذكرةِ من الرمزِ
 *      الموقَّعِ وحدَه؛ و`orderId` **يُقرأُ** من الجسمِ لكنَّ مِلكيّتَه
 *      تُفحَصُ في القاعدةِ (`ORDER_NOT_YOURS`) لا ههنا.
 *   ــ **لا تُرفِقانِ صورةً**: `attachment_file_id` بابُ تيليجرامَ وحدَه اليومَ؛
 *      ورفعُ ملفٍّ من التطبيقِ المصغَّرِ **دَينٌ مُعلَنٌ** لا مُنفَّذٌ.
 *   ــ **لا تُغلِقانِ تذكرةً ولا تُضيفانِ رسالةً إليها**: المحادثةُ في قروبِ
 *      المدينةِ (`claim/resolve` قائمانِ)، **والردُّ داخلَ التطبيقِ دَينٌ
 *      مُعلَنٌ** في `ROADMAP` لا يُدَّعى ههنا.
 *   ــ **لا تُرسِلانِ إشعاراً**: بطاقةُ القروبِ يكتبُها المُشغِّلُ القائمُ
 *      (`post-dispute-card.ts`) على المصدرِ نفسِه، ولا يُنسَخُ إرسالٌ ثانٍ.
 */

import {
  categoryRequiresOrder,
  DEFAULT_SUPPORT_PAGE_SIZE,
  isRiderSupportCategory,
  MAX_SUPPORT_MESSAGE_CHARS,
  MAX_SUPPORT_PAGE_SIZE,
  type OpenedSupportTicket,
  type RiderSupportPage,
} from "../../domain/support/rider-support.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import { isSupportRejection, type RiderSupportStore, type SupportStoreError } from "./ports.ts";

/**
 * رموزُ العطبِ التي **تُنشَرُ** — مجالٌ مغلقٌ تُقابِلُه خريطةُ حالاتٍ شاملةٌ.
 * وهيَ **قائمةٌ تُقرأُ في زمنِ التشغيلِ** لا اتّحادٌ أنواعٍ وحدَه: الحاجزُ الذي
 * يُلزِمُ أنَّ لكلِّ رمزٍ نصّاً في القواميسِ الثلاثةِ لا يرى الأنواعَ، ونسخُ القائمةِ
 * في الحاجزِ يجعلُها **مصدرَ حقيقةٍ ثانياً** يتخلّفُ عندَ أوّلِ رمزٍ جديدٍ (القاعدة 0.6).
 */
export const RIDER_SUPPORT_PUBLIC_ERROR_CODES = [
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

export type RiderSupportPublicErrorCode = (typeof RIDER_SUPPORT_PUBLIC_ERROR_CODES)[number];

export interface RiderSupportDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: RiderSupportStore;
  readonly now: () => Date;
}

/** رفضٌ يحملُ ثانيةً — التهدئةُ وحدَها تُخبِرُ «بعدَ كم؟». */
export interface RiderSupportRejection {
  readonly code: RiderSupportPublicErrorCode;
  readonly retryAfterSeconds: number | null;
}

function rejection(
  code: RiderSupportPublicErrorCode,
  retryAfterSeconds: number | null = null,
): RiderSupportRejection {
  return { code, retryAfterSeconds };
}

function sessionErrorFrom(reason: string): RiderSupportPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

function openSession(
  deps: RiderSupportDeps,
  accessToken: string | undefined,
): Result<string, RiderSupportRejection> {
  if (accessToken === undefined || accessToken.length === 0)
    return err(rejection("SESSION_REQUIRED"));
  const session = deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(rejection(sessionErrorFrom(session.error.reason)));
  return ok(session.value.telegramUserId);
}

/**
 * تحويلُ رفضِ المخزنِ إلى رمزٍ منشورٍ — **شاملٌ حرفاً** لاتّحادِ
 * `SupportStoreRejection`، فرمزٌ جديدٌ في القاعدةِ يُسقِطُ الترجمةَ في زمنِ
 * البناءِ (`switch` مُستنفَدٌ) لا يمرُّ خاماً إلى شاشةٍ.
 */
function publicCodeFrom(error: SupportStoreError): RiderSupportRejection {
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

export async function openRiderSupportTicket(
  deps: RiderSupportDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly category: unknown;
    readonly message: unknown;
    readonly orderId: unknown;
  },
): Promise<Result<OpenedSupportTicket, RiderSupportRejection>> {
  const session = openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  if (!isRiderSupportCategory(input.category)) return err(rejection("CATEGORY_UNKNOWN"));

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
  if (orderId === null && categoryRequiresOrder(input.category)) {
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

export async function listRiderSupportTickets(
  deps: RiderSupportDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly limit: unknown;
    readonly cursorCreatedAt: unknown;
    readonly cursorId: unknown;
  },
): Promise<Result<RiderSupportPage, RiderSupportRejection>> {
  const session = openSession(deps, input.accessToken);
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

  let cursor: { readonly createdAt: string; readonly id: string } | null = null;
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
