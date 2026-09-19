/**
 * الغرض: ميزانيةُ الأداءِ في القسم 9.9 مقروءةً من **مُخرَجِ البناءِ نفسِه** لا من
 *   وعدٍ في وثيقة: ما يُنزَّل قبلَ أوّلِ رسمٍ، وكم طلباً يلزمه، وحجمُ كلِّ حزمةٍ
 *   مؤجَّلةٍ بعدَ الضغط. وهذه الوحدةُ **نقيّةٌ ومنفصلةٌ عن البوّابة** كي تُختبَر
 *   بحقائقَ مصنوعةٍ بلا بناءٍ كامل.
 * الحالة: منفّذ فعلياً — البند `F1-09` (جزئيّاً: ثلاثةُ صفوفٍ من ثمانيةٍ، والتفصيلُ
 *   في `docs/evidence/architecture/F1-09-20260829.md` §٣).
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: scripts/check-performance-budget.ts، و`tests/unit`،
 *   وأيُّ مسارِ قياسٍ بمتصفّحٍ يُضاف يوماً لصفوفِ `FCP`/`LCP`/زمنِ التفاعل.
 * ملاحظات مستقبلية:
 *   - الأرقامُ ههنا **منقولةٌ حرفياً** من القسم 9.9 ولا تُخفَّف. من أراد تخفيفَها
 *     فالطريقُ قرارٌ معماريٌّ مكتوبٌ لا تعديلُ ثابتٍ في ملفٍّ.
 *   - وهذه الوحدةُ **لا تقيس زمناً**: لا `FCP` ولا `LCP` ولا زمنَ تفاعلٍ. تلك
 *     تحتاج متصفّحاً وشبكةً مُقيَّدةً وجهازاً، ولا شيءَ من ذلك في هذا الفحص —
 *     فلا يُدَّعى ما لم يُقَس (`ح-5`).
 *
 * لماذا فحصٌ لا اتفاق: حزمةٌ تكبُر لا تُكبِر شيئاً مرئياً في مراجعةٍ — تبعيّةٌ
 * واحدةٌ تُضاف اليومَ فتصير الشاشةُ الأولى ثلاثةَ أضعافِ ميزانيتِها، ولا يظهر ذلك
 * إلا على هاتفٍ بشبكةٍ ضعيفةٍ عند مستخدمٍ لا يشتكي بل يخرج. والاتفاقُ يُنسى؛
 * والبناءُ الساقطُ لا يُنسى.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

/** كيلوبايتٌ ثنائيٌّ: 1 KB = 1024 بايت. */
const KB = 1024;

/**
 * حدودُ القسم 9.9 المُمكِنُ إثباتُها من مُخرَجِ البناءِ وحدَه — بأرقامِها كما هي.
 * والصفوفُ الخمسةُ الباقيةُ (`FCP` · `LCP` · زمنُ التفاعلِ · بياناتُ جلسةِ عشرِ
 * دقائقَ · إعادةُ رسمِ الخريطة) **غيرُ مذكورةٍ هنا عن قصدٍ**: حدٌّ يُكتَب في
 * ثابتٍ لا يفحصه أحدٌ يصير ادّعاءَ تغطيةٍ.
 */
export const BUDGET = {
  /** «`shell` + `identity` بعد الضغط (gzip/br) ≤ 180 KB». */
  eagerGzipBytes: 180 * KB,
  /** «أي حزمة مؤجّلة ≤ 120 KB». */
  lazyChunkGzipBytes: 120 * KB,
  /** «طلبات الشبكة لأول رسم ≤ 6» — والمستندُ نفسُه طلبٌ ويُحسَب. */
  firstPaintRequests: 6,
} as const;

/** أسماءُ الحزمِ المأذونُ بها في القسم 9.4 — بحرفِها وترتيبِها. */
export const AUTHORIZED_BUNDLES = [
  "shell",
  "identity",
  "rider-home",
  "rider-ride",
  "driver",
  "map",
  "payment",
  "support",
  "account",
] as const;

/**
 * حزمٌ ليست في جدولِ القسم 9.4 ومأذونٌ بها **بسندٍ مكتوبٍ لكلِّ واحدةٍ** — والسندُ
 * مطبوعٌ مع المخالفةِ كي لا يصير الاستثناءُ سطراً يُضاف بلا سببٍ يُقرأ. وكلُّ اسمٍ
 * سواها يُسقِط البناءَ: هكذا انكشف أنّ حزمةَ `tg` كانت قائمةً في المُخرَجِ منذ
 * `F1-02` بلا ذكرٍ في العقدِ إطلاقاً.
 */
export const DECLARED_EXTRA_BUNDLES: Readonly<Record<string, string>> = {
  index: "مدخلُ البناءِ الذي يولّده الجامعُ — ليس حزمةَ منتَجٍ ولا يُسمّيه جدولُ الحزم",
  "vendor-react": "مكتبةُ العرضِ تُفصَل كي لا يُبطِل تعديلٌ في شيفرتِنا خُبَيْئتَها في الجهاز (ADR 0044)",
  admin:
    "سطحُ المشرفِ داخلَ التطبيقِ المصغَّرِ — قرارُ مالكِ المنتجِ في `F1-05`، وتوتُّرُه مع ADR 0007 (لوحةٌ مُصيَّرةٌ من الخادم) نقطةٌ مفتوحةٌ لم تُحسَم",
  /**
   * D-23: حزمةٌ قسريّةٌ (٢٢٠ بايت) يُولِّدُها Rolldown لتوافقِ CommonJS —
   * `__commonJS` + namespace. ثلاثُ محاولاتٍ لإزالتِها في D-09 باءت بالفشلِ:
   * لا تُطابِقُ `id.includes("rolldown:runtime")`، و`includeDependenciesRecursively:
   * false` يزيدُ الطلباتِ، وحذفُ وسمِ `modulepreload` وحدَهُ تلوينُ قياسٍ.
   * فالإذنُ بها سندٌ مكتوبٌ لا سطرٌ صامتٌ.
   */
  "rolldown-runtime":
    "حزمةٌ قسريّةٌ يُولِّدُها Rolldown لتوافقِ CommonJS — ٢٢٠ بايت، لا تُستطاعُ إزالتُها بلا إضعافِ طبقةِ التوافق (D-23 · D-09)",
};

export interface AssetSize {
  /** اسمُ الملفِّ كما هو في `dist` (ببصمتِه). */
  readonly file: string;
  /** اسمُ الحزمةِ المُشتَقُّ من اسمِ الملفِّ بعدَ نزعِ البصمةِ والامتداد. */
  readonly bundle: string;
  readonly rawBytes: number;
  readonly gzipBytes: number;
}

/** طلبٌ واحدٌ يُثبِته مُخرَجُ البناءِ قبلَ أوّلِ رسم. */
export interface FirstPaintRequest {
  readonly kind: "document" | "script" | "modulepreload" | "stylesheet";
  readonly target: string;
  /** `true` = من نطاقٍ ليس نطاقَنا، فبايتاتُه ليست في ميزانيتِنا ولكنّ طلبَه مَحسوب. */
  readonly external: boolean;
}

export interface BuildFacts {
  readonly requests: readonly FirstPaintRequest[];
  /** الأصولُ المحلّيةُ التي يُنزِّلها الجهازُ قبلَ أوّلِ رسم. */
  readonly eager: readonly AssetSize[];
  /** كلُّ أصلٍ في `dist` ليس في الحملِ الأوّل. */
  readonly lazy: readonly AssetSize[];
  /** بايتاتُ الأنماطِ المُدمَجةِ في المستندِ بعدَ الضغطِ (تُحسَب في ميزانيةِ الحملِ الأوّل). */
  readonly inlineStyleGzipBytes: number;
}

export interface Violation {
  readonly rule: string;
  readonly detail: string;
}

/**
 * `assets/shell-DjHgntGc.js` ⇒ `shell` · `assets/rider-home-CyeAoQpm.js` ⇒
 * `rider-home` · `assets/vendor-react-DGj8QgOs.js` ⇒ `vendor-react`.
 *
 * والمقطوعُ **ثمانيةُ محارفَ بالعددِ** لا «ثمانٍ أو أكثر»: بصمةُ Vite
 * طولُها ثمانٌ وقد تحمل `-` و`_`، فـ«أكثر» تأكل من الاسمِ نفسِه: كانت
 * `vendor-react-DGj8QgOs` تُقرأ `vendor` فُتُبلَّغ مخالفةً كاذبةً عن اسمٍ مأذونٍ به.
 * ولو غُيّر طولُ البصمةِ في `vite.config.ts` فسيبقى الاسمُ كاملاً ببصمتِه وتسقط
 * البوّابةُ — وذلك مقصودٌ: فاحصٌ يخمّن أسماءً أسوأُ من فاحصٍ يطلب تحديثاً.
 */
export function bundleNameOf(file: string): string {
  const name = basename(file).replace(/\.(js|css)$/, "");
  return name.replace(/-[A-Za-z0-9_-]{8}$/, "");
}

function isAuthorizedBundle(bundle: string): boolean {
  return (
    (AUTHORIZED_BUNDLES as readonly string[]).includes(bundle) ||
    Object.hasOwn(DECLARED_EXTRA_BUNDLES, bundle)
  );
}

function kb(bytes: number): string {
  return `${(bytes / KB).toFixed(1)} KB`;
}

/**
 * الحكمُ على حقائقِ البناء. لا قراءةَ قرصٍ ههنا: دالّةٌ من حقائقَ إلى مخالفات،
 * فتُختبَر بحقائقَ مصنوعةٍ ويُرى سقوطُها بلا بناءٍ كامل.
 */
export function evaluate(facts: BuildFacts): readonly Violation[] {
  const violations: Violation[] = [];

  /* ── حاجزُ حضورٍ: مُخرَجٌ فارغٌ لا يمرُّ ─────────────────────────────────── */
  if (facts.eager.length === 0) {
    violations.push({
      rule: "حضورُ الحملِ الأوّل",
      detail: "لا أصلَ واحداً في الحملِ الأوّل — الفحصُ لا يمرُّ على مُخرَجٍ فارغ",
    });
  }
  if (facts.requests.length === 0) {
    violations.push({
      rule: "حضورُ الطلبات",
      detail: "لم يُقرأ طلبٌ واحدٌ من المستند — المستندُ نفسُه طلبٌ فالصفرُ يعني فشلَ القراءة",
    });
  }

  /* ── الصفُّ الأوّل: الحملُ الأوّل بعدَ الضغط ─────────────────────────────── */
  const eagerLocal = facts.eager.reduce((sum, asset) => sum + asset.gzipBytes, 0);
  const eagerTotal = eagerLocal + facts.inlineStyleGzipBytes;
  if (eagerTotal > BUDGET.eagerGzipBytes) {
    violations.push({
      rule: "الحملُ الأوّل ≤ 180 KB بعدَ الضغط (9.9)",
      detail: `${kb(eagerTotal)} في ${facts.eager.length} أصلاً — وهذا يجمع كلَّ ما يُنزَّل قبلَ أوّلِ رسمٍ لا حزمتَي \`shell\`+\`identity\` وحدَهما`,
    });
  }

  /** والصفُّ نفسُه بقراءتِه الحرفيّة: الحزمتانِ المُسمَّاتانِ وحدَهما. */
  const named = facts.eager.filter(
    (asset) => asset.bundle === "shell" || asset.bundle === "identity",
  );
  const namedTotal = named.reduce((sum, asset) => sum + asset.gzipBytes, 0);
  if (namedTotal > BUDGET.eagerGzipBytes) {
    violations.push({
      rule: "`shell` + `identity` ≤ 180 KB بعدَ الضغط (9.9)",
      detail: `${kb(namedTotal)} في ${named.length} أصلاً`,
    });
  }

  /* ── الصفُّ الثاني: كلُّ حزمةٍ مؤجَّلةٍ على حِدَة ─────────────────────────── */
  for (const asset of facts.lazy) {
    if (asset.gzipBytes > BUDGET.lazyChunkGzipBytes) {
      violations.push({
        rule: "حزمةٌ مؤجَّلةٌ ≤ 120 KB بعدَ الضغط (9.9)",
        detail: `${asset.file}: ${kb(asset.gzipBytes)}`,
      });
    }
  }

  /* ── الصفُّ السادس: طلباتُ أوّلِ رسم ─────────────────────────────────────── */
  if (facts.requests.length > BUDGET.firstPaintRequests) {
    const listed = facts.requests.map((request) => `${request.kind}:${request.target}`).join(" · ");
    violations.push({
      rule: "طلباتُ الشبكةِ لأوّلِ رسمٍ ≤ 6 (9.9)",
      detail: `${facts.requests.length} طلباً — ${listed}`,
    });
  }

  /* ── التقسيمُ الإلزاميُّ: لا حزمةَ بلا اسمٍ مأذونٍ (9.4) ─────────────────── */
  for (const asset of [...facts.eager, ...facts.lazy]) {
    if (isAuthorizedBundle(asset.bundle)) continue;
    violations.push({
      rule: "أسماءُ الحزمِ من القسم 9.4 وحدَه",
      detail: `\`${asset.bundle}\` (${asset.file}) ليس في القسم 9.4 ولا في المأذونِ به بقرارٍ مكتوب`,
    });
  }

  /* ── حاجزُ حضورٍ: تقسيمُ الكودِ إلزاميٌّ فلا بناءَ بحزمةٍ واحدة ──────────── */
  if (facts.lazy.length === 0) {
    violations.push({
      rule: "تقسيمُ الكودِ إلزاميٌّ (9.4)",
      detail: "لا حزمةَ مؤجَّلةً واحدةً في المُخرَج — حزمةٌ واحدةٌ تُنزَّل كلَّها لكلِّ دور",
    });
  }
  const bundles = new Set(facts.eager.map((asset) => asset.bundle));
  for (const required of ["shell", "identity"] as const) {
    if (bundles.has(required)) continue;
    violations.push({
      rule: "حزمتا `shell` و`identity` تُحمَّلان فوراً (9.4)",
      detail: `\`${required}\` غيرُ موجودةٍ في الحملِ الأوّل`,
    });
  }

  return violations;
}

/* ────────────────────────────── قراءةُ الحقائق ────────────────────────────── */

const EXTERNAL = /^(?:https?:)?\/\//;

function gzipOf(bytes: Buffer): number {
  return gzipSync(bytes, { level: 9 }).byteLength;
}

function sizeOf(distDir: string, reference: string): AssetSize {
  const file = reference.replace(/^\//, "");
  const bytes = readFileSync(join(distDir, file));
  return {
    file,
    bundle: bundleNameOf(file),
    rawBytes: bytes.byteLength,
    gzipBytes: gzipOf(bytes),
  };
}

/**
 * حقائقُ البناءِ من القرص. والمصدرُ `dist/index.html` **لا قائمةٌ مكتوبةٌ بيدنا**:
 * ما يُنزِّله الجهازُ هو ما يذكره المستندُ الذي يستقبله، لا ما نظنُّه.
 */
export function readBuildFacts(distDir: string): BuildFacts {
  const html = readFileSync(join(distDir, "index.html"), "utf8");

  const requests: FirstPaintRequest[] = [
    { kind: "document", target: "index.html", external: false },
  ];
  const eager: AssetSize[] = [];
  const localReferences = new Set<string>();

  for (const match of html.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g)) {
    const target = match[1] ?? "";
    const external = EXTERNAL.test(target);
    requests.push({ kind: "script", target, external });
    if (!external) localReferences.add(target.replace(/^\//, ""));
  }
  for (const match of html.matchAll(/<link[^>]*\srel="modulepreload"[^>]*\shref="([^"]+)"/g)) {
    const target = match[1] ?? "";
    const external = EXTERNAL.test(target);
    requests.push({ kind: "modulepreload", target, external });
    if (!external) localReferences.add(target.replace(/^\//, ""));
  }
  for (const match of html.matchAll(/<link[^>]*\srel="stylesheet"[^>]*\shref="([^"]+)"/g)) {
    const target = match[1] ?? "";
    const external = EXTERNAL.test(target);
    requests.push({ kind: "stylesheet", target, external });
    if (!external) localReferences.add(target.replace(/^\//, ""));
  }

  for (const reference of localReferences) eager.push(sizeOf(distDir, reference));

  let inlineStyleGzipBytes = 0;
  for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    inlineStyleGzipBytes += gzipOf(Buffer.from(match[1] ?? "", "utf8"));
  }

  const lazy: AssetSize[] = [];
  const assetsDir = join(distDir, "assets");
  if (statSync(assetsDir, { throwIfNoEntry: false })?.isDirectory() === true) {
    for (const entry of readdirSync(assetsDir)) {
      if (!entry.endsWith(".js") && !entry.endsWith(".css")) continue;
      const reference = `assets/${entry}`;
      if (localReferences.has(reference)) continue;
      lazy.push(sizeOf(distDir, reference));
    }
  }

  return { requests, eager, lazy, inlineStyleGzipBytes };
}
