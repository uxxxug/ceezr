/**
 * الغرض: مزوّد OSRM للتوجيه — أول تنفيذ فعلي لواجهة RoutingProvider.
 *   OSRM مفتوح المصدر، يدعم Route/Table/Nearest/Match.
 *   يعمل عبر HTTP، ولا يحتاج مفتاح API للخوادم ذاتية الاستضافة.
 * الحالة: منفّذ فعلياً — المرحلة ٤، ومُحصَّن في المرحلة ٩.
 * ينتمي إلى: packages/maps/providers/osrm
 * يُتوقع أن يستخدمه لاحقاً: المرحلة ١٥ (ETA)، المرحلة ١٦ (مطابقة المسار)
 * ملاحظات مستقبلية: الميزانية الزمنية واحدةٌ لكل النداءات؛ من احتاج مصفوفةً كبيرة
 *   (٥٠×٥٠) يضبط `timeoutMs` عند البناء لا يُعدّل الثابت.
 */

import {
  createDependencyGuard,
  DEPENDENCY_BUDGETS,
  type DependencyGuard,
} from "../../../shared/resilience/dependency-guard.ts";
import { err, ok, type Result } from "../../../shared/result/index.ts";
import { createGuardedFetch } from "../../../shared/wasla/egress-gate.ts";
import {
  type DistanceMatrix,
  type DistanceMatrixElement,
  type DistanceMatrixRow,
  deservesRoutingRetry,
  type NearestOptions,
  type RouteOptions,
  RoutingError,
  type RoutingErrorKind,
  type RoutingProvider,
} from "../../core/routing-provider.ts";
import type {
  LatLng,
  NearestResult,
  ProviderName,
  RouteResult,
  RouteSnap,
  SnappedPoint,
} from "../../core/types.ts";

/**
 * الميزانية الزمنية الكلّية لنداء التوجيه الواحد.
 *
 * الرقم مشتقٌّ من المستهلك المقصود لا من قدرة الخادم: تقديرُ زمن الوصول تحسينٌ
 * فوق تقديرٍ تقريبي متاح أصلاً (هافرساين في `packages/domain/geo`). فانتظارُ عميلٍ
 * في تلغرام عشرَ ثوانٍ ليصل رقمٌ أدقّ أسوأُ من رقمٍ تقريبيّ يصله الآن. ولذلك
 * السقف ثلاث ثوانٍ: تكفي خادماً ذاتيَ الاستضافة بفارقٍ واسع، ولا تحتجز مستخدماً.
 *
 * وهو **غير مُعاير على خادم OSRM حقيقي تحت حمل** — خطرٌ مُسجَّل، لا حقيقةٌ مُثبتة.
 *
 * **والرقمُ مقروءٌ من `DEPENDENCY_BUDGETS.maps` لا مكتوبٌ ههنا ثانيةً** (`F8-04`):
 * موضعٌ واحدٌ للميزانيةِ، وإلاّ افترقَ ما يقيسُه الحاجزُ عمّا يقيسُه المزوّدُ.
 */
export const OSRM_TIMEOUT_MS = DEPENDENCY_BUDGETS.maps.timeoutMs;

/**
 * تراجعٌ قصير قبل المحاولة الثانية والأخيرة. قصيرٌ عمداً: العطل العابر (اتصالٌ
 * مرفوض، 503) يزول في أجزاء الثانية، وما لم يزل فيها لن يزول في ثانية — والميزانية
 * الكلّية لا تتوسّع لتموّل انتظاراً أطول.
 */
export const OSRM_RETRY_BACKOFF_MS = 150;

/** أقلّ ما يستحقّ أن تُبدأ به محاولةٌ ثانية: ما دون ذلك يُهدر من الميزانية ولا يُنتج. */
const MIN_ATTEMPT_BUDGET_MS = 400;

/** محاولتان لا أكثر: الأولى، ثم واحدة بعد التراجع. */
const MAX_ATTEMPTS = 2;

export interface OsrmConfig {
  /** عنوان خادم OSRM (مثال: http://router.project-osrm.org). */
  readonly baseUrl: string;
  /** الملف الشخصي الافتراضي (driving افتراضياً). */
  readonly defaultProfile?: OsrmProfile;
  /** الميزانية الزمنية الكلّية للنداء الواحد بمحاولتيه وتراجعه. */
  readonly timeoutMs?: number;
  /** يُحقن في الاختبار ليُثبَّت السلوك بلا شبكة — نفس مِنهاج مزوّدات الترجمة. */
  readonly fetchImpl?: typeof fetch;
  /** يُحقن في الاختبار ليُثبَّت التراجع بلا انتظارٍ حقيقي. */
  readonly sleepImpl?: (ms: number) => Promise<void>;
  /**
   * حاجزُ الاعتماديّةِ (`F8-04`). **يُحقَنُ في الاختبارِ لا يُلغى**: مَن مرَّرَ
   * `undefined` نالَ حاجزاً بالميزانيّةِ المُعلَنةِ، ولا سبيلَ إلى مزوّدٍ بلا حاجزٍ.
   * وحقنُه يُتيحُ كذلكَ اشتراكَ حاجزٍ واحدٍ بينَ مزوّدَينِ لخادمٍ واحدٍ.
   */
  readonly guard?: DependencyGuard;
}

export type OsrmProfile = "driving" | "walking" | "cycling";

/** استجابة OSRM للمسار. */
interface OsrmRouteResponse {
  code?: string;
  message?: string;
  routes?: readonly {
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: readonly [number, number][] };
  }[];
  /**
   * OSRM يردّ مع كلّ مسارٍ نقاطَ الطريق المُلصَقة، و`distance` فيها **ليست مسافةَ
   * قيادة** بل بُعدُ الإحداثية المطلوبة عن الطريق. وكان المزوّد يقرأ هذا الحقل
   * في `/nearest` ويُسقطه في `/route` — وهو في الموضعين نفسُ المعلومة.
   */
  waypoints?: readonly { distance?: number }[];
}

/** استجابة OSRM للأقرب. */
interface OsrmNearestResponse {
  code?: string;
  message?: string;
  waypoints?: readonly {
    location?: readonly [number, number];
    distance?: number;
    hint?: string;
    /** اسم الطريق — يعيده OSRM خاوياً للطرق غير المسمّاة، فلا يُفترض حضوره. */
    name?: string;
  }[];
}

/**
 * استجابة OSRM للجدول.
 *
 * الحقول اختيارية والعناصر تسمح بـ`null` **لأن هذا هو الواقع**: OSRM يُسقط
 * `distances` كلّياً إن لم تُفعَّل تعليقةُ المسافة عند بناء الخريطة، ويضع `null`
 * لكل زوجٍ لا طريق بينه. وتوصيفُها `number[][]` غيرَ اختياريّ كان يجعل المُصرِّف
 * يضمن ما لا يضمنه الخادم، فيمرّ `.map` على `undefined` ويُلقي استثناءً خارج أي
 * `try` — أي أن عقد `Result` كان يُخلَف بانهيار.
 */
interface OsrmTableResponse {
  code?: string;
  message?: string;
  distances?: readonly (readonly (number | null)[])[];
  durations?: readonly (readonly (number | null)[])[];
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** إحداثيةٌ صالحة: أرقامٌ منتهية داخل مدى WGS84. */
function isValidPoint(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

/**
 * ترجمة رمز OSRM إلى صنفٍ يُقرَّر به.
 *
 * OSRM يردّ **HTTP 200 مع `code` مخالف** لأخطاء التوجيه، فمن يفحص `res.ok` وحده
 * يظنّ النداء ناجحاً ثم يقرأ حقولاً غائبة. و`NoRoute` منها ليس عطلاً بل جواب.
 */
function kindForOsrmCode(code: string): RoutingErrorKind {
  if (code === "NoRoute" || code === "NoSegment" || code === "NoTrips") return "no_route";
  if (code === "TooBig" || code === "InvalidQuery" || code === "InvalidOptions") {
    return "invalid_request";
  }
  return "protocol";
}

export function createOsrmProvider(config: OsrmConfig): RoutingProvider {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  /** البوّابةُ: المُوجِّهُ لا يُنادي إلّا ما ضبطَه `OSRM_BASE_URL`. */
  const doFetch = createGuardedFetch("osrm-routing", config.fetchImpl, { env: process.env });
  const sleep = config.sleepImpl ?? defaultSleep;
  const totalBudget = config.timeoutMs ?? OSRM_TIMEOUT_MS;
  const guard = config.guard ?? createDependencyGuard({ dependency: "maps" });
  const configuredProfile: OsrmProfile = config.defaultProfile ?? "driving";

  const fail = (detail: string, kind: RoutingErrorKind): RoutingError =>
    new RoutingError("osrm" as ProviderName, detail, kind);

  /** محاولةٌ واحدة بميزانيةٍ محدَّدة. لا تعرف شيئاً عن الإعادة. */
  async function attemptJson(
    path: string,
    budgetMs: number,
  ): Promise<Result<unknown, RoutingError>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (res.status === 429) {
        return err(fail(`HTTP ${res.status}: ${res.statusText}`, "rate_limited"));
      }
      if (!res.ok) {
        return err(
          fail(
            `HTTP ${res.status}: ${res.statusText}`,
            res.status >= 500 ? "server_error" : "client_error",
          ),
        );
      }
      try {
        return ok((await res.json()) as unknown);
      } catch (e) {
        // ردٌّ بحالة 200 وجسمٍ ليس JSON: وسيطٌ أو صفحةُ خطأ لا OSRM.
        return err(fail(`invalid JSON: ${e instanceof Error ? e.message : String(e)}`, "protocol"));
      }
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      const detail = e instanceof Error ? e.message : String(e);
      return err(
        isAbort
          ? fail(`timeout after ${budgetMs}ms`, "timeout")
          : fail(`fetch failed: ${detail}`, "unreachable"),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * نداءٌ بمحاولةٍ إضافية واحدة عند العطل العابر وحده.
   *
   * القرار الذي يستحقّ التسمية: **الميزانية الكلّية لا تتوسّع.** المهلة المُعلَنة
   * سقفٌ لكامل العملية بمحاولتيها وتراجعها، لا سقفٌ لكل محاولة. ولو كانت لكل
   * محاولة لصار أسوأُ انتظارٍ ستَّ ثوانٍ بدل ثلاث — أي أن «التحصين» يكسر الوعد
   * الذي بُني عليه الرقم أصلاً، والمستخدم هو من يدفع الفرق.
   *
   * وأثرُه الصريح: انتهاءُ المهلة في المحاولة الأولى يعني عادةً ألّا تكون ثانية،
   * لأن الميزانية نفدت. والمكسبُ يقع حيث يقع العطل العابر فعلاً: 503 فوريّ، أو
   * اتصالٌ مرفوض — وكلّها تفشل في أجزاء الثانية وتترك ميزانيةً وافرة.
   *
   * (نفس مِنهاج `packages/infrastructure/i18n-translation`، وجدولُ قرار الإعادة
   * مشتركٌ في `deservesRoutingRetry` فلا يتباعد مزوّدان.)
   */
  async function requestJson<T>(path: string): Promise<Result<T, RoutingError>> {
    // **الحاجزُ يلفُّ العمليّةَ كاملةً بمحاولتَيها لا كلَّ محاولةٍ على حدَتِها**:
    // لو لفَّ المحاولةَ لعُدَّ العطلُ العابرُ الواحدُ عطلَينِ عندَ القاطعِ، فانفتحَ
    // على ضِعفِ ما أُعلِنَ. وحدُّ التزامنِ كذلكَ يقيسُ نداءَ توجيهٍ واحداً لا مقبساً.
    const outcome = await guard.run(async () => requestJsonInner<T>(path), {
      // **العطلُ العابرُ وحدَه يُفتحُ به القاطعُ**: المزوّدُ يُعيدُ إخفاقَه قيمةً
      // (`Result`) لا رمياً، فبلا هذا التصنيفِ كانَ `503` المتكرِّرُ نجاحاً عندَ
      // القاطعِ. و`no_route` و`client_error` **لا يُعَدّانِ**: الأوّلُ جوابٌ صحيحٌ
      // والثاني عيبُ نداءٍ عندَنا، وفتحُ القاطعِ عليهما يحجُبُ مزوّداً سليماً.
      failed: (result: Result<T, RoutingError>) =>
        !result.ok && deservesRoutingRetry(result.error.kind),
    });
    if (outcome.admitted) return outcome.value;
    const rejection = outcome.rejection;
    if (rejection.reason === "open") {
      return err(fail("قاطعُ دائرةِ التوجيهِ مفتوحٌ: لم يُرسَلِ النداءُ", "circuit_open"));
    }
    if (rejection.reason === "saturated") {
      return err(fail("بلغَ التوجيهُ حدَّ التزامنِ عندَنا", "saturated"));
    }
    return err(fail(`timeout after ${totalBudget}ms (حاجزُ الاعتماديّةِ)`, "timeout"));
  }

  async function requestJsonInner<T>(path: string): Promise<Result<T, RoutingError>> {
    const startedAt = Date.now();
    // المحاولة الأولى تُنفَّذ دائماً ولو كانت الميزانية أقصر من الحدّ الأدنى: من
    // ضبط مهلةً قصيرة أراد نداءً قصيراً، لا إلغاءَ النداء. الشرط يحكم الإعادة وحدها.
    let last = await attemptJson(path, totalBudget);

    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (last.ok || !deservesRoutingRetry(last.error.kind)) break;

      const remaining = totalBudget - (Date.now() - startedAt) - OSRM_RETRY_BACKOFF_MS;
      if (remaining < MIN_ATTEMPT_BUDGET_MS) break;

      await sleep(OSRM_RETRY_BACKOFF_MS);
      last = await attemptJson(path, remaining);
    }

    if (!last.ok) return err(last.error);
    return ok(last.value as T);
  }

  /** فحص `code` قبل قراءة أي حقلٍ آخر: OSRM يُخطئ بحالة 200. */
  function checkCode(body: { code?: string; message?: string }): RoutingError | null {
    const code = body.code;
    if (code === undefined) return fail("response missing `code`", "protocol");
    if (code === "Ok") return null;
    const suffix = body.message === undefined ? "" : `: ${body.message}`;
    return fail(`osrm code ${code}${suffix}`, kindForOsrmCode(code));
  }

  function coordStr(p: LatLng): string {
    return `${p.lng},${p.lat}`;
  }

  return {
    name: "osrm" as ProviderName,

    route: async (options: RouteOptions): Promise<Result<RouteResult, RoutingError>> => {
      const points = [options.origin, ...(options.waypoints ?? []), options.destination];
      if (!points.every(isValidPoint)) {
        return err(fail("invalid coordinates in route request", "invalid_request"));
      }
      const coords = points.map(coordStr).join(";");
      const overview = options.steps ? "full" : "simplified";
      // المرحلة ٩: `profile` كان مُعلَناً في الخيارات وفي الضبط ومُهمَلاً في المسار
      // (`/driving/` مثبَّتٌ نصّاً). خيارٌ يُقبل ثم يُهمل أسوأ من خيارٍ لا يوجد:
      // من طلب مشياً كان يُحسب له زمنُ سيارة ولا شيء يُخبره.
      const profile: OsrmProfile = options.profile ?? configuredProfile;

      const result = await requestJson<OsrmRouteResponse>(
        `/route/v1/${profile}/${coords}?overview=${overview}&geometries=geojson&steps=${options.steps ? "true" : "false"}`,
      );
      if (!result.ok) return err(result.error);

      const codeError = checkCode(result.value);
      if (codeError !== null) return err(codeError);

      const route = result.value.routes?.[0];
      if (route === undefined) {
        return err(fail("no route found", "no_route"));
      }
      const coordinates = route.geometry?.coordinates;
      if (
        typeof route.distance !== "number" ||
        typeof route.duration !== "number" ||
        coordinates === undefined
      ) {
        return err(fail("route missing distance/duration/geometry", "protocol"));
      }

      /**
       * الإلصاقُ يُقرأ من **أوّل نقطةٍ وأخيرتِها** لا من الفهرسين ٠ و١: النقاطُ
       * الوسيطة (`waypoints` في `RouteOptions`) تدخل في القائمة، فالفهرس ١ مع
       * نقطةٍ وسيطةٍ يكون إلصاقَ الوسيطة لا المقصد — ولا شيءَ يصيح بذلك.
       *
       * وتُشترط مطابقةُ العدد لما طُلب: قائمةٌ أقصرُ تعني أنّ المحرّك دمج نقاطاً أو
       * أنّ الردّ ليس للسؤال — وحينها «لا أعلم» أصدقُ من رقمٍ يخصّ موضعاً أخر.
       */
      const wps = result.value.waypoints;
      const first = wps?.[0]?.distance;
      const last = wps === undefined ? undefined : wps[wps.length - 1]?.distance;
      const snap: RouteSnap =
        wps !== undefined &&
        wps.length === points.length &&
        typeof first === "number" &&
        typeof last === "number"
          ? { known: true, originMeters: first, destinationMeters: last }
          : { known: false };

      return ok({
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        geometry: {
          points: coordinates.map(([lng, lat]) => ({ lat, lng })),
        },
        snap,
      });
    },

    nearest: async (options: NearestOptions): Promise<Result<NearestResult, RoutingError>> => {
      if (!isValidPoint(options.point)) {
        return err(fail("invalid coordinate in nearest request", "invalid_request"));
      }
      const count = options.count ?? 1;
      if (!Number.isInteger(count) || count < 1) {
        return err(fail(`invalid count: ${count}`, "invalid_request"));
      }
      const profile = configuredProfile;
      // المرحلة ٩: `radiusMeters` كان مُعلَناً ومُهمَلاً. وOSRM يقبل `radiuses`،
      // وحين لا يجد طريقاً داخله يردّ `NoSegment` — وهو الجواب الصحيح لسؤال
      // «أقربُ طريقٍ داخل هذا المدى»، لا نقطةٌ على بعد كيلومترات تُقدَّم كأنها قريبة.
      const radius =
        options.radiusMeters === undefined
          ? ""
          : `&radiuses=${Array.from({ length: count }, () => options.radiusMeters).join(";")}`;

      const result = await requestJson<OsrmNearestResponse>(
        `/nearest/v1/${profile}/${coordStr(options.point)}?number=${count}${radius}`,
      );
      if (!result.ok) return err(result.error);

      const codeError = checkCode(result.value);
      if (codeError !== null) return err(codeError);

      const waypoints = result.value.waypoints;
      if (waypoints === undefined) {
        return err(fail("nearest response missing `waypoints`", "protocol"));
      }

      /**
       * المرحلة ٨ — كان هذا الموضع يُصنّع `driverId: `nearest-${i}`` ويعيده في
       * نوعٍ اسمه `NearbyDriver`. وOSRM `/nearest` يعيد **نقاطاً على الطريق**
       * لا سائقين: لا يعرف أن السائقين موجودون. فالمُعرَّف كان اختلاقاً كاملاً،
       * و`durationSeconds: 0` كذبةً ثانية (صفرٌ يعني «وصولٌ فوري» لا «لا أعلم»).
       *
       * ومن أراد السائقين القريبين يقرأ `drivers.last_location` عبر مسار
       * المرشّحين — وهو المصدر القانوني الوحيد لموقع السائق (ADR-0015).
       */
      const points: SnappedPoint[] = [];
      for (const wp of waypoints) {
        if (wp.location === undefined || typeof wp.distance !== "number") {
          return err(fail("nearest waypoint missing location/distance", "protocol"));
        }
        points.push({
          position: { lat: wp.location[1], lng: wp.location[0] },
          offsetMeters: wp.distance,
          ...(wp.name === undefined || wp.name === "" ? {} : { roadName: wp.name }),
        });
      }

      return ok({ points });
    },

    table: async (
      sources: readonly LatLng[],
      destinations: readonly LatLng[],
    ): Promise<Result<DistanceMatrix, RoutingError>> => {
      // مدخلاتٌ فارغة كانت تبني `?sources=&destinations=0;-1` بمسارٍ بلا إحداثيات
      // وتُطلق نداءً محكومَ الفشل. رفضُها قبل الشبكة أصدق وأرخص.
      if (sources.length === 0 || destinations.length === 0) {
        return err(
          fail(
            `table needs at least one source and one destination (got ${sources.length}×${destinations.length})`,
            "invalid_request",
          ),
        );
      }
      const allPoints = [...sources, ...destinations];
      if (!allPoints.every(isValidPoint)) {
        return err(fail("invalid coordinates in table request", "invalid_request"));
      }

      /**
       * المرحلة ٩ — البند P1-8 من خط الأساس.
       *
       * كان السطر: `destinations=${destStart};${destinations.length - 1}`.
       * وهو يبني **قائمةً من فهرسين** لا مدىً: فهرسَ أول وجهة، ثم رقماً هو عددُ
       * الوجهات ناقص واحد — وهو فهرسٌ في المصفوفة المدمجة يشير في الغالب إلى
       * **مصدر**. مع ٣ مصادر و٣ وجهات يصير `destinations=3;2`، والفهرس ٢ مصدر.
       * ومع ٣ مصادر ووجهةٍ واحدة يصير `3;0` — الوجهةَ الصحيحة ثم المصدرَ الأول.
       *
       * وأسوأ ما فيه أنه **لا يفشل**: OSRM يردّ مصفوفةً صحيحة الشكل للسؤال
       * الخاطئ، فيُعاد `ok` بأرقامٍ معقولةٍ تخصّ مواضع أخرى. ولذلك لا يكشفه
       * سجلُّ أخطاء ولا فحصُ صحّة، بل قياسُ **ما يُطلب** — وهو ما تفعله حالاته.
       */
      const srcIdx = sources.map((_, i) => i).join(";");
      const destIdx = destinations.map((_, i) => sources.length + i).join(";");

      const result = await requestJson<OsrmTableResponse>(
        `/table/v1/${configuredProfile}/${allPoints.map(coordStr).join(";")}?sources=${srcIdx}&destinations=${destIdx}&annotations=duration,distance`,
      );
      if (!result.ok) return err(result.error);

      const codeError = checkCode(result.value);
      if (codeError !== null) return err(codeError);

      const { distances, durations } = result.value;
      if (distances === undefined || durations === undefined) {
        // يقع فعلاً: خادمٌ بُنيت خريطتُه بلا تعليقة المسافة يُسقط `distances`.
        // وكان `.map` عليها يُلقي استثناءً خارج أي `try` فيخلف عقد `Result`.
        return err(fail("table response missing distances/durations", "protocol"));
      }

      /**
       * فحصُ المقاس هو الحَرَس الذي يجعل عطباً من صنف P1-8 **صائحاً** لا صامتاً:
       * لو أخطأ بناءُ الفهارس مرّةً أخرى، جاء المقاس مخالفاً لما طُلب فيُرفض،
       * بدل أن تُسلَّم مصفوفةٌ مُنزاحةٌ أعمدتُها إلى المستهلك.
       */
      if (distances.length !== sources.length || durations.length !== sources.length) {
        return err(
          fail(
            `table shape mismatch: asked ${sources.length} sources, got ${distances.length}/${durations.length} rows`,
            "protocol",
          ),
        );
      }

      const rows: DistanceMatrixRow[] = [];
      for (let i = 0; i < sources.length; i += 1) {
        const distRow = distances[i];
        const durRow = durations[i];
        if (distRow?.length !== destinations.length || durRow?.length !== destinations.length) {
          return err(
            fail(
              `table shape mismatch: asked ${destinations.length} destinations, got ${distRow?.length}/${durRow?.length} in row ${i}`,
              "protocol",
            ),
          );
        }
        const elements: DistanceMatrixElement[] = [];
        for (let j = 0; j < destinations.length; j += 1) {
          const dist = distRow[j];
          const dur = durRow[j];
          // `null` من OSRM تعني «لا طريق». وضعُها في حقلٍ نوعُه رقم، أو استبدالُ
          // المدّة بصفرٍ بـ`?? 0`، يحوّل «لا طريق» إلى «وصولٌ فوري» — وهو أسوأ
          // ما قد يُقرأ في تقدير زمن وصول.
          if (typeof dist !== "number" || typeof dur !== "number") {
            elements.push({ status: "no_route" });
          } else {
            elements.push({ status: "ok", distanceMeters: dist, durationSeconds: dur });
          }
        }
        rows.push({ elements });
      }

      return ok({ rows });
    },
  };
}
