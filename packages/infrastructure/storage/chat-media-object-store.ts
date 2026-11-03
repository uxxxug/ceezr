/**
 * الغرض: مخزنُ ملفّاتِ محادثةِ الطلب (صورٌ ورسائلُ صوتيّة) على مخزنِ الكائناتِ المتوافقِ
 *   مع واجهةِ Supabase Storage (حاويةُ `wasla-storage`، ADR 0294) — في **دلوٍ خاصٍّ
 *   منفصل** `order-chat-media`، لا في `driver-documents` (ADR 0305).
 * الحالة: منفّذ فعلياً — `WR-34`.
 * ينتمي إلى: infrastructure/storage
 * يُستخدم من: `apps/gateway/src/index.ts` (الرفعُ والتوقيع) · `apps/workers/src/container.ts`
 *   (حذفُ اليتيمِ والمنتهي).
 *
 * ## العقد
 *   - الكتابةُ والحذفُ بمفتاحِ الخدمةِ من البوّابةِ/العاملِ وحدَهما، على العنوانِ الداخليّ
 *     (`OBJECT_STORAGE_URL`). لا رابطَ رفعٍ يصلُ العميلَ: البايتاتُ تمرُّ بالبوّابةِ لتُفحَصَ
 *     وتُنظَّفَ **قبلَ** أن تُخزَّن.
 *   - القراءةُ برابطٍ موقَّعٍ قصيرِ العمر (`HttpReadSigner` نفسُه بدلوٍ آخر) يُعادُ كتابتُه
 *     إلى الأصلِ العامِّ (`OBJECT_STORAGE_PUBLIC_URL`) الذي يمرِّرُ مسارَ `object/sign` وحدَه.
 *   - لا يُسجِّلُ مساراً ولا رابطاً ولا مفتاحاً: الأخطاءُ رموزٌ مصنَّفة.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import { createGuardedFetch, type FetchLike } from "../../shared/wasla/egress-gate.ts";
import { HttpReadSigner, type ReadUrlSigner, readSignedReadConfig } from "./signed-read.ts";

export const DEFAULT_CHAT_MEDIA_BUCKET = "order-chat-media";

/** المسارُ من معرّفَين فقط (`orders/<uuid>/<uuid>`) — لا اسمَ ملفٍّ من العميل. */
const OBJECT_PATH = /^orders\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
const SAFE_BUCKET = /^[a-z0-9][a-z0-9._-]{1,62}$/;
const DEFAULT_TIMEOUT_MS = 15_000;

export type ChatMediaStoreFailure = "STORE_UNAVAILABLE" | "STORE_REJECTED" | "STORE_PATH_INVALID";

export interface ChatMediaObjectStore {
  put(input: {
    readonly objectPath: string;
    readonly bytes: Uint8Array;
    readonly mimeType: string;
  }): Promise<Result<void, ChatMediaStoreFailure>>;
  /** حذفٌ متكرّرٌ بلا ضرر: غيابُ الكائنِ نجاح. */
  remove(objectPaths: readonly string[]): Promise<Result<void, ChatMediaStoreFailure>>;
  signRead(input: {
    readonly objectPath: string;
    readonly ttlSeconds: number;
  }): Promise<
    Result<{ readonly url: string; readonly expiresAtEpochMs: number }, ChatMediaStoreFailure>
  >;
}

export interface ChatMediaStoreConfig {
  readonly baseUrl: string;
  readonly secretKey: string;
  readonly bucket: string;
  readonly publicBaseUrl?: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/** المفتاحُ الصريحُ وحدَه يفتحُ الوسائط (`enabled`)؛ وكلُّ قيمةٍ أخرى إيقاف. */
export function chatMediaEnabled(env: Record<string, string | undefined>): boolean {
  return (env.ORDER_CHAT_MEDIA ?? "").trim() === "enabled";
}

/** حدُّ الدلوِ (حاجزٌ ثانٍ بعدَ فحصِ البوّابة) وأنواعُه — يقرؤها سكربتُ التهيئة. */
export const CHAT_MEDIA_BUCKET_MAX_BYTES = 5_242_880;
export const CHAT_MEDIA_BUCKET_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
] as const;

/** اسمُ الدلو، أو `null` إن كانَ غيرَ صالحٍ أو يطابقُ دلوَ وثائقِ السائق. */
export function readChatMediaBucket(env: Record<string, string | undefined>): string | null {
  const bucket = (env.ORDER_CHAT_MEDIA_BUCKET ?? DEFAULT_CHAT_MEDIA_BUCKET).trim();
  if (!SAFE_BUCKET.test(bucket)) return null;
  // عزلُ وثائقِ السائق: لا يُسمَحُ بأن يُشيرَ دلوُ المحادثةِ إلى دلوِها ولو بالخطأ.
  const documents = (env.DRIVER_DOCUMENTS_BUCKET ?? "driver-documents").trim();
  return bucket === documents ? null : bucket;
}

export function readChatMediaStoreConfig(
  env: Record<string, string | undefined>,
): ChatMediaStoreConfig | null {
  const base = readSignedReadConfig(env);
  if (base === null) return null;
  const bucket = readChatMediaBucket(env);
  if (bucket === null) return null;
  return {
    baseUrl: base.baseUrl,
    secretKey: base.secretKey,
    bucket,
    ...(base.publicBaseUrl === undefined ? {} : { publicBaseUrl: base.publicBaseUrl }),
  };
}

export function isChatMediaObjectPath(path: string): boolean {
  return OBJECT_PATH.test(path);
}

export class HttpChatMediaObjectStore implements ChatMediaObjectStore {
  readonly #config: ChatMediaStoreConfig;
  readonly #transport: FetchLike;
  readonly #timeoutMs: number;
  readonly #signer: ReadUrlSigner;

  constructor(config: ChatMediaStoreConfig) {
    this.#config = config;
    this.#transport =
      config.fetch ??
      createGuardedFetch("supabase-object-storage", undefined, { env: process.env });
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#signer = new HttpReadSigner({
      baseUrl: config.baseUrl,
      secretKey: config.secretKey,
      bucket: config.bucket,
      ...(config.publicBaseUrl === undefined ? {} : { publicBaseUrl: config.publicBaseUrl }),
      fetch: this.#transport,
      ...(config.now === undefined ? {} : { now: config.now }),
      timeoutMs: this.#timeoutMs,
    });
  }

  #objectUrl(objectPath: string): string {
    return `${this.#config.baseUrl}/storage/v1/object/${encodeURIComponent(this.#config.bucket)}/${objectPath}`;
  }

  async put(input: {
    readonly objectPath: string;
    readonly bytes: Uint8Array;
    readonly mimeType: string;
  }): Promise<Result<void, ChatMediaStoreFailure>> {
    if (!isChatMediaObjectPath(input.objectPath)) return err("STORE_PATH_INVALID");
    let response: Response;
    try {
      response = await this.#transport(this.#objectUrl(input.objectPath), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#config.secretKey}`,
          "content-type": input.mimeType,
          // إعادةُ المحاولةِ بالمعرّفِ نفسِه تكتبُ المسارَ نفسَه — لا كائنَ ثانٍ.
          "x-upsert": "true",
          "cache-control": "private, max-age=300",
        },
        body: input.bytes,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      return err("STORE_UNAVAILABLE");
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return ok(undefined);
    if (response.status >= 400 && response.status < 500) return err("STORE_REJECTED");
    return err("STORE_UNAVAILABLE");
  }

  async remove(objectPaths: readonly string[]): Promise<Result<void, ChatMediaStoreFailure>> {
    if (objectPaths.length === 0) return ok(undefined);
    if (!objectPaths.every(isChatMediaObjectPath)) return err("STORE_PATH_INVALID");
    let response: Response;
    try {
      response = await this.#transport(
        `${this.#config.baseUrl}/storage/v1/object/${encodeURIComponent(this.#config.bucket)}`,
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${this.#config.secretKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ prefixes: objectPaths }),
          signal: AbortSignal.timeout(this.#timeoutMs),
        },
      );
    } catch {
      return err("STORE_UNAVAILABLE");
    }
    await response.body?.cancel().catch(() => undefined);
    // 404: الكائنُ غائبٌ أصلاً — الحذفُ متحقّق.
    if (response.ok || response.status === 404) return ok(undefined);
    return err(response.status < 500 ? "STORE_REJECTED" : "STORE_UNAVAILABLE");
  }

  async signRead(input: {
    readonly objectPath: string;
    readonly ttlSeconds: number;
  }): Promise<
    Result<{ readonly url: string; readonly expiresAtEpochMs: number }, ChatMediaStoreFailure>
  > {
    if (!isChatMediaObjectPath(input.objectPath)) return err("STORE_PATH_INVALID");
    const signed = await this.#signer.signRead(input);
    if (!signed.ok) return err("STORE_UNAVAILABLE");
    return ok({ url: signed.value.readUrl, expiresAtEpochMs: signed.value.expiresAtEpochMs });
  }
}

/** مخزنٌ لا تهيئةَ له — يرفضُ مصنَّفاً ولا يتظاهرُ بالنجاح. */
export class UnconfiguredChatMediaObjectStore implements ChatMediaObjectStore {
  async put(): Promise<Result<void, ChatMediaStoreFailure>> {
    return err("STORE_UNAVAILABLE");
  }
  async remove(): Promise<Result<void, ChatMediaStoreFailure>> {
    return err("STORE_UNAVAILABLE");
  }
  async signRead(): Promise<
    Result<{ readonly url: string; readonly expiresAtEpochMs: number }, ChatMediaStoreFailure>
  > {
    return err("STORE_UNAVAILABLE");
  }
}
