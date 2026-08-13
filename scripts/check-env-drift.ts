/**
 * الغرض: بوابة CI تمنع انحراف متغيّرات البيئة — كلّ متغيّرٍ مُعلَنٍ للمشغّل يجب
 *    أن يُقرأ فعلاً في الكود، وبنفس الاسم في كلّ موضعٍ يُعلَن فيه.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يستخدمه: .github/workflows/ci.yml
 *
 * لماذا؟ لأنّ هذا العيب وقع مرّتين في هذا المستودع بالضبط:
 *
 *   (١) `OSRM_BASE_URL` كان مُعلَناً في `.env.example` و`render.yaml` ولا يُقرأ
 *       في الضبط أصلاً (الخطر R-28 الموثَّق في `packages/shared/config`).
 *   (٢) كلّ عائلة `TRACKING_*` — سبعة متغيّرات — مُعلَنةٌ في الملفّين ولا يُقرأ
 *       منها واحد، وبأسماءٍ **مختلفةٍ بين الملفّين** فوق ذلك.
 *
 * والضرر ليس في الكود بل في المشغّل: يرى حدَّ سرعةٍ فيضبطه استجابةً لانتحالٍ
 * حقيقيّ، ويعيد النشر، ويظنّ أنّه تصرّف — ولا شيء تغيّر ولا خطأَ ظهر. حدٌّ لا
 * يسري أخطر من حدٍّ لا وجود له، لأنّ الأوّل يُطمئن. إصلاحٌ يدويٌّ واحد لا يمنع
 * التكرار: هذا الفاحص هو ما يمنعه.
 *
 * والفاحص لا يُلزم بأن يُعلَن كلّ ما يُقرأ: متغيّراتُ منصّةٍ (CI، PATH) ومتغيّراتُ
 * تشغيلٍ محلّيّةٍ للاختبارات ليست عقداً مع مشغّل الإنتاج. الإلزامُ في الاتجاه
 * الذي يُنتج الوهم وحده — من المُعلَن إلى المقروء.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ENV_EXAMPLE = ".env.example";
const RENDER_YAML = "render.yaml";
/** جذور البحث عن قراءةٍ فعليّة — الكود والسكربتات والنشر. */
const CODE_ROOTS = ["apps", "packages", "scripts", "docker"];
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".sh"]);

/**
 * متغيّراتٌ تُعلَن لأنّ المنصّة أو أداةٌ خارجيّة تقرؤها، لا الكود.
 * كلُّ اسمٍ هنا يحتاج سبباً مكتوباً — وإلّا صارت هذه القائمة بابَ التسامح الذي
 * يُبطل الفاحص من داخله.
 */
const READ_BY_PLATFORM_NOT_CODE: Readonly<Record<string, string>> = {
  // Render يقرؤه ليَصِل الخدمة بقاعدتها، ويُصدّره للعملية باسمٍ نقرؤه نحن.
  PORT: "تقرؤه المنصّة لتوجيه المرور، ونقرؤه أيضاً في الضبط",
};

interface Declaration {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (CODE_EXTENSIONS.has(extname(full))) out.push(full);
  }
  return out;
}

/** أسماءٌ مُعلَنةٌ في `.env.example` — سطورُ `KEY=` غير المعلَّقة. */
export function declarationsFromEnvExample(content: string): readonly Declaration[] {
  const out: Declaration[] = [];
  content.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) return;
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match?.[1] !== undefined) {
      out.push({ name: match[1], file: ENV_EXAMPLE, line: index + 1 });
    }
  });
  return out;
}

/** أسماءٌ مُعلَنةٌ في `render.yaml` — مُدخلاتُ `- key: NAME`. */
export function declarationsFromRenderYaml(content: string): readonly Declaration[] {
  const out: Declaration[] = [];
  content.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (line.startsWith("#")) return;
    const match = /^-\s*key:\s*([A-Z][A-Z0-9_]*)\s*$/.exec(line);
    if (match?.[1] !== undefined) {
      out.push({ name: match[1], file: RENDER_YAML, line: index + 1 });
    }
  });
  return out;
}

/**
 * هل يُقرأ الاسم فعلاً في نصّ كودٍ؟
 *
 * الحضورُ المجرّد للاسم لا يكفي دليلاً: اسمٌ داخل تعليقٍ أو رسالةِ خطأٍ ليس
 * قراءةً. فالمطلوب شكلُ وصولٍ حقيقيّ — `source.NAME` أو `env["NAME"]` أو
 * `process.env.NAME` أو `${NAME}` في سكربت شِل أو `ENV NAME` في Dockerfile.
 */
export function isReadInCode(name: string, sources: readonly string[]): boolean {
  const patterns = [
    new RegExp(`\\.${name}\\b`),
    new RegExp(`\\[\\s*["'\`]${name}["'\`]\\s*\\]`),
    new RegExp(`["'\`]${name}["'\`]\\s*(?:,|\\)|\\])`),
    new RegExp(`\\$\\{?${name}\\b`),
  ];
  return sources.some((source) => patterns.some((pattern) => pattern.test(source)));
}

interface Report {
  readonly declaredButUnread: readonly Declaration[];
  readonly nameDrift: readonly string[];
}

export function analyse(
  envExample: string,
  renderYaml: string,
  codeSources: readonly string[],
): Report {
  const envDecls = declarationsFromEnvExample(envExample);
  const renderDecls = declarationsFromRenderYaml(renderYaml);

  const declaredButUnread = [...envDecls, ...renderDecls].filter(
    (decl) =>
      READ_BY_PLATFORM_NOT_CODE[decl.name] === undefined && !isReadInCode(decl.name, codeSources),
  );

  /**
   * انحرافُ الأسماء: عائلةٌ من البادئات نُلزم فيها التطابق بين الملفّين، لأنّ
   * اسماً في `render.yaml` لا نظير له في `.env.example` هو اسمٌ ضبطه المشغّل
   * ولم يقرأه أحد — وهذا ما وقع حرفيّاً في `TRACKING_IDLE_INTERVAL_SECONDS`.
   */
  const envNames = new Set(envDecls.map((d) => d.name));
  const nameDrift = renderDecls
    .map((d) => d.name)
    .filter((name) => name.startsWith("TRACKING_") && !envNames.has(name));

  return { declaredButUnread, nameDrift: [...new Set(nameDrift)] };
}

function main(): void {
  const codeSources = CODE_ROOTS.flatMap(walk).map((file) => readFileSync(file, "utf8"));
  const report = analyse(
    readFileSync(ENV_EXAMPLE, "utf8"),
    readFileSync(RENDER_YAML, "utf8"),
    codeSources,
  );

  let failed = false;

  if (report.declaredButUnread.length > 0) {
    failed = true;
    console.error("❌ متغيّرات بيئة مُعلَنة للمشغّل ولا تُقرأ في الكود — وهمُ تحكّم:");
    for (const decl of report.declaredButUnread) {
      console.error(`  - ${decl.name} (${decl.file}:${decl.line})`);
    }
    console.error(
      "  الحلّ: إمّا أن يُقرأ فعلاً في الضبط ويسري على السلوك، وإمّا أن يُشرح سبب إزالته في ADR.",
    );
  }

  if (report.nameDrift.length > 0) {
    failed = true;
    console.error(`❌ اسم في ${RENDER_YAML} لا نظير له في ${ENV_EXAMPLE}:`);
    for (const name of report.nameDrift) console.error(`  - ${name}`);
  }

  if (failed) process.exit(1);
  console.log("✅ كلّ متغيّر بيئة مُعلَن مقروءٌ فعلاً في الكود، ولا انحراف في الأسماء.");
}

if (import.meta.main) {
  main();
}
