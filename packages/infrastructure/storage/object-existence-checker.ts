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
    this.#transport = config.fetch ?? createGuardedFetch("supabase-object-storage");
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

    // 200 = موجودٌ. 404 = غيرُ موجودٍ. غيرُهما = عطلٌ يُعامَلُ ك«ليسَ مِلْكَكَ».
    if (response.status === 200) return ok(true);
    if (response.status === 404) return ok(false);
    return err<ObjectExistenceFailure>("CHECKER_UNAVAILABLE");
  }
}
