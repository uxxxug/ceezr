/**
 * الغرض: مُوقِّعُ روابطِ القراءةِ على مخزنِ كائناتٍ متوافقٍ مع واجهةِ Supabase
 *   Storage — إذنُ قراءةٍ **لمسارٍ واحدٍ ولمدّةٍ قصيرةٍ** (`F12-06`).
 * الحالة: مبنيٌّ — البند `F12-06`.
 * ينتمي إلى: infrastructure/storage
 * يُستخدم من: `apps/gateway/src/routes/driver-vehicle.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `F4-xx` (مرفقاتُ الشكاوى) · صورةُ المركبةِ.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## لِمَ رابطٌ موقَّعٌ ولا قراءةٌ عبرَ البوّابةِ
 *
 * قراءةُ صورةٍ عبرَ البوّابةِ تشغلُ نطاقَها وذاكرتَها، ومئةُ سائقٍ يقرؤونَ
 * معاً يُسقِطونَ خدمةَ الطلباتِ. **والرابطُ الموقَّعُ يُخرِجُ البايتَ من
 * مسارِ الطلبِ كلِّه**: الهاتفُ يقرأُ من المخزنِ، والبوّابةُ لا ترى إلّا سطراً.
 *
 * ## وما لا يفعلُه هذا المحوّلُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقرأُ بايتاً ولا يُخزِّنُ مِلفّاً**: يُوقِّعُ إذناً فحسب.
 *   ــ **لا يُوقِّعُ روابطَ رفعٍ**: الرفعُ في `signed-upload.ts`.
 *   ــ **لا يُقرِّرُ مساراً**: المسارُ من القاعدةِ.
 *   ــ **لا يحذفُ كائناً**: نظافتُه عملٌ دوريٌّ مُعلَنٌ كدَينٍ.
 *   ــ **لا يتحقَّقُ أنَّ الكائنَ موجودٌ**: التوقيعُ وعدٌ بالقراءةِ لا إثباتُ وجودٍ.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import { createGuardedFetch, type FetchLike } from "../../shared/wasla/egress-gate.ts";

/** نتيجةُ توقيعِ رابطِ قراءةٍ. */
export interface SignedRead {
  /** الرابطُ الموقَّعُ للقراءةِ — مطلقٌ لا نسبيٌّ. */
  readonly readUrl: string;
  /** الانتهاءُ بالملِّي — وعدٌ مُتحفِّظٌ (أقصرُ من الحقيقيِّ لا أطولُ). */
  readonly expiresAtEpochMs: number;
}

/** رموزُ العطبِ المنشورةُ. */
export type ReadSignerFailure =
  | "SIGNER_NOT_CONFIGURED"
  | "SIGNER_UNAVAILABLE"
  | "SIGNER_MALFORMED_RESPONSE"
  | "SIGNER_TTL_OUT_OF_RANGE";

/** عقدُ المُوقِّعِ. */
export interface ReadUrlSigner {
  signRead(input: {
    readonly objectPath: string;
    readonly ttlSeconds: number;
  }): Promise<Result<SignedRead, ReadSignerFailure>>;
}

export interface SignedReadConfig {
  readonly baseUrl: string;
  readonly secretKey: string;
  readonly bucket: string;
  readonly now?: () => Date;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const MIN_READ_TTL_SECONDS = 60;
const MAX_READ_TTL_SECONDS = 3600;

const SAFE_SEGMENT = /^[A-Za-z0-9._\-/]+$/;

function isSafeObjectPath(objectPath: string): boolean {
  if (objectPath.length === 0 || objectPath.length > 512) return false;
  if (!SAFE_SEGMENT.test(objectPath)) return false;
  if (objectPath.startsWith("/") || objectPath.includes("//")) return false;
  return !objectPath.split("/").includes("..");
}

function encodeObjectPath(objectPath: string): string {
  return objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * قراءةُ التهيئةِ من البيئةِ. تشتركُ مع `signed-upload.ts` في المتغيّراتِ
 * لأنَّ الدلوَ والمضيفَ واحدٌ، وإنَّما الإجراءُ مختلفٌ.
 */
export function readSignedReadConfig(
  env: Record<string, string | undefined>,
): SignedReadConfig | null {
  const baseUrl = (env.OBJECT_STORAGE_URL ?? env.SUPABASE_URL ?? "").trim();
  const secretKey = (
    env.OBJECT_STORAGE_SECRET_KEY ??
    env.SUPABASE_STORAGE_SECRET_KEY ??
    env.SUPABASE_SERVICE_ROLE_KEY ??
    ""
  ).trim();
  const bucket = (env.DRIVER_DOCUMENTS_BUCKET ?? "driver-documents").trim();
  if (baseUrl.length === 0 || secretKey.length === 0 || bucket.length === 0) return null;
  if (!SAFE_SEGMENT.test(bucket)) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), secretKey, bucket };
}

/** مُوقِّعٌ لا يملكُ تهيئةً — يردُّ رفضاً مُصنَّفاً ولا يتظاهرُ بالنجاحِ. */
export class UnconfiguredReadSigner implements ReadUrlSigner {
  async signRead(): Promise<Result<SignedRead, ReadSignerFailure>> {
    return err<ReadSignerFailure>("SIGNER_NOT_CONFIGURED");
  }
}

export class HttpReadSigner implements ReadUrlSigner {
  readonly #config: SignedReadConfig;
  readonly #now: () => Date;
  readonly #transport: FetchLike;
  readonly #timeoutMs: number;

  constructor(config: SignedReadConfig) {
    this.#config = config;
    this.#now = config.now ?? (() => new Date());
    this.#transport = config.fetch ?? createGuardedFetch("supabase-object-storage");
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async signRead(input: {
    readonly objectPath: string;
    readonly ttlSeconds: number;
  }): Promise<Result<SignedRead, ReadSignerFailure>> {
    if (
      !Number.isInteger(input.ttlSeconds) ||
      input.ttlSeconds < MIN_READ_TTL_SECONDS ||
      input.ttlSeconds > MAX_READ_TTL_SECONDS
    ) {
      return err<ReadSignerFailure>("SIGNER_TTL_OUT_OF_RANGE");
    }
    if (!isSafeObjectPath(input.objectPath)) {
      return err<ReadSignerFailure>("SIGNER_MALFORMED_RESPONSE");
    }

    const target =
      `${this.#config.baseUrl}/storage/v1/object/sign/` +
      `${encodeURIComponent(this.#config.bucket)}/${encodeObjectPath(input.objectPath)}`;

    const signedAtMs = this.#now().getTime();
    let response: Response;
    try {
      response = await this.#transport(target, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#config.secretKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ expiresIn: input.ttlSeconds }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      return err<ReadSignerFailure>("SIGNER_UNAVAILABLE");
    }

    if (!response.ok) return err<ReadSignerFailure>("SIGNER_UNAVAILABLE");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return err<ReadSignerFailure>("SIGNER_MALFORMED_RESPONSE");
    }
    if (typeof payload !== "object" || payload === null) {
      return err<ReadSignerFailure>("SIGNER_MALFORMED_RESPONSE");
    }
    const record = payload as Record<string, unknown>;
    const signedURL = typeof record.signedURL === "string" ? record.signedURL : null;
    if (signedURL === null || signedURL.length === 0) {
      return err<ReadSignerFailure>("SIGNER_MALFORMED_RESPONSE");
    }

    let absolute: string;
    try {
      const resolved = new URL(signedURL, `${this.#config.baseUrl}/`);
      const own = new URL(this.#config.baseUrl);
      if (resolved.origin !== own.origin) {
        return err<ReadSignerFailure>("SIGNER_MALFORMED_RESPONSE");
      }
      absolute = resolved.toString();
    } catch {
      return err<ReadSignerFailure>("SIGNER_MALFORMED_RESPONSE");
    }

    return ok({
      readUrl: absolute,
      expiresAtEpochMs: signedAtMs + input.ttlSeconds * 1000,
    });
  }
}
