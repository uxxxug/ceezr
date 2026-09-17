/**
 * الغرض: **اكتشافُ** مساراتِ البوّابةِ الفعليّةِ من الشيفرةِ — الفعلُ والمسارُ
 *   **كما يُركَّبُ** لا كما يُوصَفُ في وثيقةٍ: تُقرأُ تسجيلاتُ `Hono` في
 *   `apps/gateway/src/routes/*.ts`، ثمَّ تُضافُ بادئةُ التركيبِ من الموضعِ الذي
 *   يُركِّبُ الموجِّهَ (`server.ts` · `index.ts` · `admin/mount.ts`).
 * الحالة: منفّذ فعلياً — `SEC-07` (ADR 0139).
 * ينتمي إلى: scripts/lib
 * يُستخدَمُ من: scripts/check-rate-limit-coverage.ts ·
 *   tests/unit/check-rate-limit-coverage.test.ts
 * يحرسُه: `scripts/check-rate-limit-coverage.ts` في سلسلةِ `ci`
 * الحاكم: `apps/gateway/src/rate-limit/policy.ts` — سِجلُّ السياسةِ المغلقُ
 *
 * ## لِمَ الاكتشافُ لا القائمةُ
 *
 * `ADR 0135`: حاجزٌ يفتِّشُ عمّا **كُتِبَ في سِجلٍّ** لا يجدُ ما **لم يُكتَبْ**.
 * ومسارٌ مكشوفٌ جديدٌ يُولَدُ بلا حدٍّ **إن كانَ مصدرُ الحقيقةِ قائمةً يدويّةً**:
 * يكتبُ المطوِّرُ المسارَ ولا يكتبُ سطرَه في السِجلِّ، فيمرُّ. فالمصدرُ ههنا
 * **الشيفرةُ**، والسِجلُّ يُطابَقُ بها في **الحدَّينِ**: مسارٌ بلا مدخلٍ خرقٌ،
 * ومدخلٌ بلا مسارٍ خرقٌ.
 *
 * ## ولِمَ دالّةٌ نقيّةٌ تأخذُ نصوصَ الملفّاتِ
 *
 * لأنَّ حاجزاً لا تُقاسُ سالبتُه ليسَ حاجزاً (`ح-7`): تُبذَرُ نصوصٌ مصنوعةٌ
 * فيُقاسُ أنَّ كلَّ قاعدةٍ **تُسقِطُ** ما يخالفُها. ولو قرأَ القرصَ لَما قِيسَت
 * إلّا الحالةُ القائمةُ وحدَها.
 *
 * ## وما لا تفعلُه هذه الدالّةُ عن قصدٍ
 *
 * - **لا تُنفِّذُ الشيفرةَ ولا تُشغِّلُ خادماً**: القراءةُ نصّيّةٌ. وثمنُ ذلكَ
 *   مُعلَنٌ: مسارٌ مُسجَّلٌ بمسارٍ مُحتسَبٍ في التشغيلِ (لا نصٍّ حرفيٍّ ولا قالبٍ
 *   مُحلولٍ ههنا) **يُعلَنُ خرقاً** — `UNRESOLVED_PATH` — ولا يُهمَلُ صمتاً.
 *   وإهمالُه كانَ سيُخفي بابَاً كاملاً.
 * - **لا تحكمُ في المصادقةِ ولا في الحدِّ**: هذا جردٌ لا سياسةٌ. الحكمُ في
 *   `policy.ts` والحاجزِ.
 * - **لا تخترعُ بادئةً**: موجِّهٌ لا يُعرَفُ موضعُ تركيبِه يُعلَنُ
 *   `UNMOUNTED_ROUTER` خرقاً — فموجِّهٌ يُنشَأُ ولا يُركَّبُ إمّا شيفرةٌ ميّتةٌ
 *   وإمّا بابٌ يُركَّبُ في نقطةِ تشغيلٍ لا تراها هذه الدالّةُ، وكلاهُما يُقالُ لا
 *   يُسكَتُ عليه.
 */

export const HTTP_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** مسارٌ مُكتشَفٌ: الفعلُ والمسارُ الكاملُ كما يُركَّبُ، وملفُّه ومصنعُه. */
export interface DiscoveredRoute {
  readonly method: HttpMethod;
  /** المسارُ الكاملُ بعدَ بادئةِ التركيبِ — `/v1/me` · `/admin/api/overview`. */
  readonly path: string;
  readonly file: string;
  readonly factory: string;
}

/** خرقٌ في الجردِ نفسِه: لا في السياسةِ. */
export interface InventoryProblem {
  readonly kind: "UNRESOLVED_PATH" | "UNMOUNTED_ROUTER" | "DUPLICATE_ROUTE";
  readonly detail: string;
}

export interface RouteInventory {
  readonly routes: readonly DiscoveredRoute[];
  readonly problems: readonly InventoryProblem[];
}

/** ملفّاتُ التركيبِ التي تُقرأُ منها البادئاتُ — بترتيبٍ لا يُهِمُّ لأنَّ المفتاحَ اسمُ المصنعِ. */
export const MOUNT_FILES = [
  "apps/gateway/src/server.ts",
  "apps/gateway/src/index.ts",
  "apps/gateway/src/admin/mount.ts",
] as const;

const ROUTE_FILE_PREFIX = "apps/gateway/src/routes/";

/**
 * بادئاتُ التركيبِ: `app.route("<بادئة>", createXRoutes(...))` — يُقرأُ اسمُ
 * المصنعِ والبادئةُ. والمصنعُ الواحدُ قد يُركَّبُ في ملفَّينِ (البوّابةُ وعمليةُ
 * اللوحةِ) وبادئتُه واحدةٌ، فالتكرارُ بالبادئةِ عينِها ليسَ خرقاً.
 */
export function mountPrefixes(
  mountSources: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const prefixes = new Map<string, string>();
  const direct = /\.route\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]*)"\s*,\s*(create[A-Za-z0-9_]+)\s*\(/g;
  // موجِّهٌ يُبنى في متغيّرٍ ثمَّ يُركَّبُ باسمِه:
  //   `const publicTracking = createPublicTrackingRoutes({...});`
  //   `app.route("/", publicTracking);`
  // وإهمالُ هذا الشكلِ كانَ سيُعلِنُ بابَ التتبّعِ العامَّ «غيرَ مُركَّبٍ» وهوَ
  //   مُركَّبٌ فعلاً — أي **سالبةٌ كاذبةٌ تُخفي مساراً مكشوفاً**.
  const bound = /\bconst\s+([A-Za-z0-9_]+)\s*=\s*(create[A-Za-z0-9_]+)\s*\(/g;
  const viaVariable = /\.route\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]*)"\s*,\s*([A-Za-z0-9_]+)\s*\)/g;

  const normalise = (prefix: string): string => (prefix === "/" ? "" : prefix.replace(/\/$/, ""));

  for (const source of mountSources.values()) {
    const boundFactories = new Map<string, string>();
    for (const match of source.matchAll(bound)) {
      const variable = match[1];
      const factory = match[2];
      if (variable !== undefined && factory !== undefined) boundFactories.set(variable, factory);
    }
    for (const match of source.matchAll(direct)) {
      const prefix = match[1] ?? "";
      const factory = match[2] ?? "";
      if (factory === "") continue;
      prefixes.set(factory, normalise(prefix));
    }
    for (const match of source.matchAll(viaVariable)) {
      const prefix = match[1] ?? "";
      const variable = match[2] ?? "";
      const factory = boundFactories.get(variable);
      if (factory === undefined) continue;
      prefixes.set(factory, normalise(prefix));
    }
  }
  return prefixes;
}

/**
 * ثوابتُ النصِّ المحلّيّةُ في ملفِّ الموجِّهِ: `const base = "/v1/..."` — تُحَلُّ
 * بها قوالبُ `` `${base}/invoice` ``. ولا تُحَلُّ حسابياً غيرُها: ما لا يُحَلُّ
 * يُعلَنُ خرقاً لا يُهمَل.
 */
function localStringConstants(source: string): ReadonlyMap<string, string> {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(/\bconst\s+([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*;/g)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) constants.set(name, value);
  }
  return constants;
}

function resolvePathExpression(raw: string, constants: ReadonlyMap<string, string>): string | null {
  const trimmed = raw.trim();
  if (/^"[^"]*"$/.test(trimmed)) return trimmed.slice(1, -1);
  if (/^`[^`]*`$/.test(trimmed)) {
    const body = trimmed.slice(1, -1);
    let resolved = "";
    let index = 0;
    while (index < body.length) {
      const open = body.indexOf("${", index);
      if (open === -1) {
        resolved += body.slice(index);
        break;
      }
      resolved += body.slice(index, open);
      const close = body.indexOf("}", open);
      if (close === -1) return null;
      const name = body.slice(open + 2, close).trim();
      const value = constants.get(name);
      if (value === undefined) return null;
      resolved += value;
      index = close + 1;
    }
    return resolved;
  }
  const direct = constants.get(trimmed);
  return direct ?? null;
}

/** اسمُ المصنعِ المُصدَّرُ من ملفِّ الموجِّهِ: `export function createXRoutes(` */
function exportedFactories(source: string): readonly string[] {
  return [...source.matchAll(/export function (create[A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
}

/**
 * يقرأُ نصوصَ ملفّاتِ الموجِّهاتِ ونصوصَ ملفّاتِ التركيبِ، فيُعيدُ جردَ المساراتِ
 * وخروقَ الجردِ. المفاتيحُ مساراتُ ملفّاتٍ نسبيّةٌ من جِذرِ المستودَعِ.
 */
export function discoverGatewayRoutes(
  routeSources: ReadonlyMap<string, string>,
  mountSources: ReadonlyMap<string, string>,
): RouteInventory {
  const prefixes = mountPrefixes(mountSources);
  const routes: DiscoveredRoute[] = [];
  const problems: InventoryProblem[] = [];
  const seen = new Set<string>();

  const methodAlternatives = HTTP_METHODS.map((method) => method.toLowerCase()).join("|");

  for (const [file, source] of [...routeSources].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const registrationProbe = new RegExp(
      `\\b[A-Za-z0-9_]+\\.(${methodAlternatives})\\(\\s*("|\`|[A-Za-z0-9_]+\\s*,)`,
    );
    // ملفٌّ في `routes/` لا يُسجِّلُ مساراً واحداً **ليسَ موجِّهاً**: في المجلَّدِ
    // ملفّا `update-dedup.ts` و`update-intake.ts` وهُما منفذانِ لا أبوابٌ. وعدُّهما
    // «موجِّهاً غيرَ مُركَّبٍ» كانَ سيُسقِطُ البناءَ على لا شيءٍ فيُعطَّلَ الحاجزُ
    // بيدِ صاحبِه — وذاكَ أسوأُ من غيابِه.
    if (!registrationProbe.test(source)) continue;
    const factories = exportedFactories(source);
    if (factories.length === 0) {
      problems.push({
        kind: "UNMOUNTED_ROUTER",
        detail: `${file}: لا مصنعَ موجِّهٍ مُصدَّراً — فلا يُعرَفُ موضعُ تركيبِ مساراتِه`,
      });
      continue;
    }
    // الموجِّهُ الواحدُ لكلِّ ملفٍّ هوَ العُرفُ القائمُ. ولو صُدِّرَ مصنعانِ من
    // ملفٍّ واحدٍ لصارَت البادئةُ غامضةً، وذاكَ خرقٌ يُعلَنُ لا يُخمَّنُ.
    if (factories.length > 1) {
      problems.push({
        kind: "UNMOUNTED_ROUTER",
        detail: `${file}: مصنعانِ أو أكثرُ مُصدَّرانِ (${factories.join(" · ")}) فبادئةُ التركيبِ غامضةٌ`,
      });
      continue;
    }
    const factory = factories[0] as string;
    const prefix = prefixes.get(factory);
    if (prefix === undefined) {
      problems.push({
        kind: "UNMOUNTED_ROUTER",
        detail: `${file}: المصنعُ ${factory} لا يُركَّبُ في أيِّ من ${MOUNT_FILES.join(" · ")}`,
      });
      continue;
    }

    const constants = localStringConstants(source);
    const registration = new RegExp(
      `\\b[A-Za-z0-9_]+\\.(${methodAlternatives})\\(\\s*("[^"]*"|\`[^\`]*\`|[A-Za-z0-9_]+)\\s*,`,
      "g",
    );
    for (const match of source.matchAll(registration)) {
      const method = (match[1] ?? "").toUpperCase() as HttpMethod;
      const expression = match[2] ?? "";
      const resolved = resolvePathExpression(expression, constants);
      if (resolved === null) {
        problems.push({
          kind: "UNRESOLVED_PATH",
          detail: `${file}: ${method} ${expression} — مسارٌ لا يُحَلُّ نصّاً، فلا يُقاسُ حدُّه`,
        });
        continue;
      }
      const path = `${prefix}${resolved === "/" && prefix !== "" ? "" : resolved}`;
      const key = `${method} ${path}`;
      if (seen.has(key)) {
        problems.push({
          kind: "DUPLICATE_ROUTE",
          detail: `${key} مُسجَّلٌ أكثرَ من مرّةٍ — والثاني لا يُنادى أبداً في Hono`,
        });
        continue;
      }
      seen.add(key);
      routes.push({ method, path, file, factory });
    }
  }

  return { routes, problems };
}

/** ملفّاتُ الموجِّهاتِ: كلُّ ما في `routes/` — يُستخدَمُ في القراءةِ من القرصِ. */
export function isRouteFile(relativePath: string): boolean {
  return relativePath.startsWith(ROUTE_FILE_PREFIX) && relativePath.endsWith(".ts");
}
