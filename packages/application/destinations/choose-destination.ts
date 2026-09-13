/**
 * الغرض: حالتا استخدامِ شاشةِ «إلى أين؟» — البحثُ النصّيُّ ومصادقةُ الدبّوسِ
 *   (البند `F2-03` · `SR-03` · القسمان 9.5 و9.8).
 * الحالة: منفّذ فعلياً — البند `F2-03`.
 * ينتمي إلى: packages/application/destinations
 * يُستخدم من: `apps/gateway/src/routes/destinations.ts`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-04` — يُنادي `resolveDestination` قبلَ إنشاءِ
 *   طلبٍ ولا يكتبُ حكماً ثانياً على الحدِّ.
 *
 * ## ما لا تفعلُه هذه الحالاتُ عن قصدٍ
 *
 *   ــ **لا تثقُ بهويّةٍ من الطلبِ** ولا بمدينةٍ منه: عينُ حكمِ `manage-places.ts`.
 *   ــ **لا تُنادي مُرمِّزاً جغرافيّاً ولا مزوِّدَ خرائطَ**: استقلالُ المشروعِ
 *      (`O-7`) يُنفَذُ بحاجزِ `check-egress-boundary`، والبحثُ من ثلاثةِ مصادرَ
 *      يملكُها المستودعُ (ADR 0102).
 *   ــ **لا تحكمُ على الاحتواءِ في الشِّفرةِ**: الهندسةُ حكمُ PostGIS في القاعدةِ
 *      (القاعدة 0.5)، وههنا نقلٌ وتصنيفٌ لا حسابٌ.
 *   ــ **لا تُعيدُ قائمةً فارغةً عندَ عطبِ المخزنِ**: الفارغُ «لا نتيجةَ»
 *      والعطبُ «لا أعرفُ»، وخلطُهما يجعلُ الشاشةَ تكذبُ على صاحبِها.
 *   ــ **لا تقبلُ حدّاً فوقَ السقفِ صامتاً**: تُردُّ ولا تُقصَرُ، كما في
 *      `readRecentLimit`.
 */

import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
} from "../../domain/destinations/landmark-kinds.ts";
import { readSearchQuery } from "../../domain/destinations/search-text.ts";
import { readPlacePoint } from "../../domain/places/place-kinds.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import type {
  DestinationResolver,
  DestinationSearcher,
  DestinationStoreFailure,
  DestinationSuggestion,
  DestinationVerdict,
} from "./ports.ts";

export interface DestinationsDeps {
  readonly sessions: MiniAppSessionReader;
  readonly searcher: DestinationSearcher;
  readonly resolver: DestinationResolver;
  readonly now: () => Date;
}

export type DestinationsPublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_NOT_AVAILABLE"
  | "MALFORMED"
  /** استفهامٌ دونَ الحدِّ الأدنى بعدَ التطبيعِ — عقدٌ يُقرأُ لا بناءٌ معطوبٌ. */
  | "QUERY_TOO_SHORT"
  | "ACCOUNT_NOT_FOUND"
  | "DESTINATION_STORE_NOT_AVAILABLE";

function sessionErrorFrom(reason: string): DestinationsPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

function storeErrorFrom(failure: DestinationStoreFailure): DestinationsPublicErrorCode {
  if (failure.reason === "USER_NOT_FOUND") return "ACCOUNT_NOT_FOUND";
  return "DESTINATION_STORE_NOT_AVAILABLE";
}

function authenticate(
  deps: DestinationsDeps,
  accessToken: string | undefined,
): Result<string, DestinationsPublicErrorCode> {
  if (accessToken === undefined || accessToken.length === 0) return err("SESSION_REQUIRED");
  const session = deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(sessionErrorFrom(session.error.reason));
  return ok(session.value.telegramUserId);
}

/**
 * حدٌّ مقبولٌ: عددٌ صحيحٌ موجبٌ دونَ السقفِ، وغيابُه هوَ الافتراضُ. عينُ عقدِ
 * `readRecentLimit` في `F2-02` — ولا يُنسَخُ منه الجسمُ لأنَّ السقفَ مختلفٌ
 * والقيمةُ قيمةُ منتَجٍ لكلِّ شاشةٍ (القاعدة 0.3).
 */
export function readSearchLimit(raw: string | null): number | null {
  if (raw === null || raw.length === 0) return DEFAULT_SEARCH_LIMIT;
  if (!/^[0-9]{1,3}$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  if (value < 1 || value > MAX_SEARCH_LIMIT) return null;
  return value;
}

export interface DestinationSearchOutput {
  /** الاستفهامُ المُطبَّعُ كما بُحِثَ به — يُعادُ كي يُبرَزَ موضعُ المطابقةِ بلا تطبيعٍ ثانٍ في العميلِ. */
  readonly query: string;
  readonly suggestions: readonly DestinationSuggestion[];
}

export async function searchDestinations(
  deps: DestinationsDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly rawQuery: string | null;
    readonly limit: number;
  },
): Promise<Result<DestinationSearchOutput, DestinationsPublicErrorCode>> {
  const identified = authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  // التطبيعُ قبلَ القياسِ وقبلَ الشبكةِ: «  ـًـ  » مدخلٌ غيرُ فارغٍ وصفرٌ مُطبَّعاً،
  // ولو مرَّ لَطابَقَ جدولَ المعالمِ كلَّه.
  const query = readSearchQuery(input.rawQuery);
  if (query === null) return err("QUERY_TOO_SHORT");

  const found = await deps.searcher.searchForTelegramUser(identified.value, query, input.limit);
  if (!found.ok) return err(storeErrorFrom(found.error));
  return ok({ query, suggestions: found.value });
}

export interface DestinationResolveOutput {
  readonly verdict: DestinationVerdict;
}

/**
 * مصادقةُ دبّوسٍ. الترتيبُ: جلسةٌ، ثمَّ قبولُ إحداثيّةٍ بحدودِ النطاقِ، ثمَّ
 * نداءٌ واحدٌ ذرّيٌّ يقرأُ فيه الخادمُ مدينةَ صاحبِ الجلسةِ وحدَّها ويحكمُ.
 *
 * و`readPlacePoint` من `F2-02` يُعادُ استعمالُه ولا يُكتَبُ حدُّ كرةٍ ثانٍ: عقدُ
 * «إحداثيّةٌ مقبولةٌ» واحدٌ في المشروعِ، و`0,0` فيه قيمةٌ صحيحةٌ لا غيابٌ.
 */
export async function resolveDestination(
  deps: DestinationsDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly body: unknown;
  },
): Promise<Result<DestinationResolveOutput, DestinationsPublicErrorCode>> {
  const identified = authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  if (typeof input.body !== "object" || input.body === null) return err("MALFORMED");
  const body = input.body as Record<string, unknown>;

  const point = readPlacePoint(body.lat, body.lng);
  if (point === null) return err("MALFORMED");

  const resolved = await deps.resolver.resolveForTelegramUser(
    identified.value,
    point.lat,
    point.lng,
  );
  if (!resolved.ok) return err(storeErrorFrom(resolved.error));
  return ok({ verdict: resolved.value });
}
