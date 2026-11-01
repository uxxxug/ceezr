/**
 * الغرض: فاحصُ وجودِ كائنٍ في مخزنِ Supabase Storage عبرَ نداءِ HEAD على عنوانِ
 *   الكائنِ (`DEC-30` · `ADR 0227`).
 * ينتمي إلى: packages/infrastructure/storage
 * يُستخدم من: `apps/gateway/src/container.ts` عبرَ حقنِ التبعياتِ.
 *
 * ## ولِمَ HEAD ولا GET
 *
 * GET يُنزِّلُ البايتَ كلَّه، وHEAD يَطلبُ الترويساتِ وحدَها. والغرضُ تحقُّقٌ لا
 * قراءةٌ، فالبايتُ لا حاجةَ لنا بهِ.
 *
 * ## ولِمَ فشلُ الفحصِ يُعامَلُ ك«ليسَ مِلْكَكَ»
 *
 * نداءٌ يتعلَّقُ بالشبكةِ لا يُمكنُ أن يَعني أنَّ الملفَّ موجودٌ. فالحذرُ أن يُسجَّلَ
 * وثيقةٌ غيرُ موجودةٍ، لا أن يُمنَعَ سائقٌ صادقٌ. فالخطأُ يُعادُ `CHECKER_UNAVAILABLE`
 * ويُعامَلُهُ المُطبِّقُ كرفضٍ لا كقبولٍ.
 */

import type {
  ObjectExistenceChecker,
  ObjectExistenceFailure,
} from "../../application/driver/ports.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { createGuardedFetch, type FetchLike } from "../../shared/wasla/egress-gate.ts";

export interface ObjectExistenceCheckerConfig {
  /** أصلُ المخزنِ — مثلَ `https://<ref>.supabase.co` بلا شرطةٍ أخيرةٍ. */
  readonly baseUrl: string;
  /** مفتاحُ خدمةٍ يملكُ القراءةَ في الدلوِ. **لا يُسجَّلُ ولا يُعادُ أبداً.** */
  readonly secretKey: string;
  readonly bucket: string;
  /**
   * جالبٌ محقونٌ — كي يُقاسَ العطبُ بلا شبكةٍ. وإن غابَ فالافتراضُ جالبٌ يمرُّ من
   * بوّابةِ الصادرِ باسمِ المقصدِ `supabase-object-storage`.
   */
  readonly fetch?: FetchLike;
  /** سقفُ زمنِ النداءِ بالمِلِّي. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export class HttpObjectExistenceChecker implements ObjectExistenceChecker {
  readonly #config: ObjectExistenceCheckerConfig;
  readonly #transport: FetchLike;
  readonly #timeoutMs: number;

  constructor(config: ObjectExistenceCheckerConfig) {
    this.#config = config;
    this.#transport =
      config.fetch ??
      createGuardedFetch("supabase-object-storage", undefined, { env: process.env });
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async checkExists(input: {
    readonly objectPath: string;
  }): Promise<Result<boolean, ObjectExistenceFailure>> {
    const target =
      `${this.#config.baseUrl}/storage/v1/object/` +
      `${encodeURIComponent(this.#config.bucket)}/${input.objectPath}`;

    let response: Response;
    try {
      response = await this.#transport(target, {
        method: "HEAD",
        headers: { authorization: `Bearer ${this.#config.secretKey}` },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      return err<ObjectExistenceFailure>("CHECKER_UNAVAILABLE");
    }

    // 200 = موجودٌ. 404 = غيرُ موجودٍ (Supabase المستضاف).
    if (response.status === 200) return ok(true);
    if (response.status === 404) return ok(false);
    // WR-21 (CasaOS، قياسٌ حيٌّ 2026-11-01): `supabase/storage-api` يردُّ HEAD لكائنٍ غائبٍ بـ400
    // بلا جسم — والرمزُ نفسُه لمفتاحٍ خاطئٍ أو دلوٍ غائب. فلا يُستنتَجُ الغيابُ من HEAD وحدَه:
    // يُسألُ GET لبايتٍ واحدٍ فيُقرأُ رمزُ الخطأ. `NoSuchKey` وحدَه غيابٌ؛ وكلُّ ما سواه
    // (`NoSuchBucket`، جسمٌ غيرُ مفهوم، شبكة) يبقى `CHECKER_UNAVAILABLE` ⇒ رفضٌ لا قبول.
    if (response.status === 400) return this.#probeWithGet(target);
    return err<ObjectExistenceFailure>("CHECKER_UNAVAILABLE");
  }

  async #probeWithGet(target: string): Promise<Result<boolean, ObjectExistenceFailure>> {
    let response: Response;
    try {
      response = await this.#transport(target, {
        method: "GET",
        headers: { authorization: `Bearer ${this.#config.secretKey}`, range: "bytes=0-0" },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      return err<ObjectExistenceFailure>("CHECKER_UNAVAILABLE");
    }
    if (response.status === 200 || response.status === 206) {
      await response.body?.cancel().catch(() => undefined);
      return ok(true);
    }
    if (response.status === 404) return ok(false);
    if (response.status !== 400) return err<ObjectExistenceFailure>("CHECKER_UNAVAILABLE");
    let code: unknown;
    try {
      const body = (await response.json()) as { readonly code?: unknown };
      code = body?.code;
    } catch {
      return err<ObjectExistenceFailure>("CHECKER_UNAVAILABLE");
    }
    return code === "NoSuchKey" ? ok(false) : err<ObjectExistenceFailure>("CHECKER_UNAVAILABLE");
  }
}
