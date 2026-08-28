/**
 * Product API boundary.
 * Every product call requires a valid Waslah internal session (ADR 0035 checks).
 * No direct database access. No domain entity creation on the client.
 *
 * `F1-07` — تفريقُ **صنفَي الفشلِ** ههنا لا في الشاشات: ردٌّ وصل بحالةٍ غيرِ
 * ناجحةٍ (`ApiError`) وفشلٌ قبلَ أن يصل ردٌّ إطلاقاً (`ApiNetworkError`). وكان
 * الثاني يهرب `TypeError` خامّاً فتراه الشاشةُ خطأً مجهولاً، فلا تستطيع أن تقول
 * «الشبكةُ أم خدمتُنا؟» كما يوجب القسم 9.7. والتفريقُ في حدِّ API لأنه معرفةُ
 * الحدِّ وحدَه: الشاشةُ لا ترى `fetch` ولا ترويسةً.
 */

import { getSession, hasValidSession } from "../identity/session.ts";

/** الحدُّ الأعلى المعقولُ لثوانٍ في `Retry-After` — يومٌ واحد. ما فوقه يُهمَل. */
const MAX_RETRY_AFTER_SECONDS = 86_400;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * `F1-07`: ثوانٍ من ترويسةِ `Retry-After` إن أرسلها الخادمُ ــ و`null` إن لم
   * يُرسِلها. ولا يُخترَع تقديرٌ عندَ غيابِها: «تقديرٌ زمنيٌّ **إن وُجد**» (9.7).
   */
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * `F1-07`: لم يصل ردٌّ. سببُه شبكةُ الجهازِ أو الطريقُ أو الخدمةُ نفسُها — وهذا
 * الصنفُ **لا يزعم** أيَّها: التمييزُ قرارُ طبقةِ التشخيصِ لا طبقةِ النقل.
 */
export class ApiNetworkError extends Error {
  constructor(message = "لم يصل ردٌّ من الخادم") {
    super(message);
    this.name = "ApiNetworkError";
  }
}

/**
 * قراءةُ `Retry-After` بصيغةِ الثواني وحدَها. والصيغةُ التاريخيةُ (HTTP-date)
 * مقبولةٌ في المعيارِ ولا تُقرأ ههنا عن قصد: ساعةُ الجهازِ قد تكون منحرفةً،
 * فتقديرٌ محسوبٌ عليها أسوأُ من لا تقديرٍ — و«الصدقُ في الحالة» (UX-8).
 */
function readRetryAfterSeconds(header: string | null): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const seconds = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_RETRY_AFTER_SECONDS) return null;
  return seconds;
}

export type ApiRequestInit = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  /**
   * When true, skip session check.
   *
   * `F1-07`: المسارات العامّةُ ثلاثةٌ لا أكثر، وكلُّها **ليست واجهةَ منتَجٍ**:
   * مبادلةُ الجلسةِ (`F1-03`) وتجديدُها (`F1-04`) وفحصُ الحياةِ `GET /health`
   * (القسم 10: «فحوصُ التشغيل | نظام»). وحدُّ ADR 0035 §2 قائمٌ كما هو: لا نداءَ
   * لواجهةِ المنتجِ بلا جلسةٍ صالحة.
   */
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
export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
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

  // `body` is spread in conditionally rather than passed as `undefined`:
  // `exactOptionalPropertyTypes` is on, and `RequestInit.body` accepts
  // `BodyInit | null` — never the literal `undefined`.
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    // `F1-07`: الرسالةُ الأصليةُ لا تُنقَل: نصُّ خطأِ المتصفّحِ يحمل أحياناً
    // العنوانَ كاملاً، والعنوانُ يحمل مسارَ الجلسة. ولا شيءَ يُسجَّل ههنا.
    throw new ApiNetworkError();
  }

  if (!res.ok) {
    let code = "HTTP_ERROR";
    let message = res.statusText;
    try {
      // ردودُ البوابةِ في `F1-03`..`F1-05` تحمل الرمزَ في `error`، وبعضُ الردودِ
      // الأقدمِ في `code`. فيُقرأ الاثنان — والرمزُ وحدَه يُقرأ، لا نصُّ رسالةٍ
      // يُبنى عليه قرار.
      const payload = (await res.json()) as { code?: string; error?: string; message?: string };
      if (payload.code) code = payload.code;
      if (!payload.code && typeof payload.error === "string" && payload.error.length > 0) {
        code = payload.error;
      }
      if (payload.message) message = payload.message;
    } catch {
      /* keep defaults */
    }
    throw new ApiError(
      res.status,
      code,
      message,
      readRetryAfterSeconds(res.headers.get("retry-after")),
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
