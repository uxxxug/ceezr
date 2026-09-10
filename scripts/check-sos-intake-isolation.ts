/**
 * الغرض: بوابة CI تفرضُ **عزلَ مسارِ استقبالِ الاستغاثةِ** — أنَّ ضغطةَ الزرِّ أو
 *    الأمرَ `/sos` لا تمرُّ على قراءةٍ واحدةٍ زائدةٍ قبلَ أن تصلَ إلى
 *    `trigger_sos`. البند `F8-05`، وقرارُ
 *    [ADR 0077](../docs/adr/0077-sos-intake-resolves-its-own-order.md).
 *    والفحصُ خمسةُ آثارٍ، وكلُّه قراءةُ نصٍّ لا قراءةُ وثيقةٍ:
 *      ١) **الحاملُ موجودٌ**: كلُّ موضعِ استقبالٍ مُعلَنٍ ههنا يوجَدُ في ملفِّه،
 *         وكلُّ مُوزِّعِ أوامرٍ كذلك. فغيابُ الحاملِ خرقٌ لا نجاحٌ (ح-5): حاجزٌ
 *         يفحصُ لا شيءَ أخطرُ من خرقٍ يُرى.
 *      ٢) **انتظارٌ واحدٌ**: في جسمِ موضعِ الاستقبالِ `await` واحدٌ لا غيرُ،
 *         وهوَ على `triggerSos`. فكلُّ انتظارٍ ثانٍ بابُ إسقاطٍ: إخفاقُه يردُّ
 *         عطلاً أو كذباً مطمئنّاً عن حالةِ الرحلةِ.
 *      ٣) **الطلبُ يُحَلُّ في القاعدةِ**: الحِملُ يحوي `orderId: null` حرفاً، فلا
 *         مُعرِّفٌ يُقرأُ من مسارٍ أو يُمرَّرُ من بياناتِ زرٍّ غيرِ مُوقَّعةٍ.
 *      ٤) **لا قارئَ محظوراً**: أسماءُ القراءاتِ التي كانت تُسقِطُ النداءَ
 *         (`findByTelegramId` · `activeOrdersOf` · `cardOf` · `tripCards`) غائبةٌ
 *         عن أجسامِ مواضعِ الاستقبالِ كلِّها.
 *      ٥) **موضعُ التوزيعِ**: في مُوزِّعِ الأوامرِ يُوزَّعُ `/sos` **قبلَ أوّلِ
 *         `await`**، ولا `case "/sos"` في المُوزِّعِ — فالفرعُ في `switch` يعني
 *         حتماً أنَّ قراءةَ الدليلِ فوقَه قد مرَّت وأنَّ إخفاقَها يُسقِطُ النداءَ.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml · tests/unit
 * ملاحظات مستقبلية: إن زِيدَ مسارُ استقبالٍ ثالثٌ (تطبيقٌ مُصغَّرٌ مثلاً) فيُزادُ
 *    موضعُه إلى `INTAKE_SITES` ولا يُخفَّفُ الفحصُ. وإن صارَ للاستغاثةِ منفذٌ
 *    مستقلٌّ عن حوارِ البوتِ فالمعنى يبقى: انتظارٌ واحدٌ على تبعيّةٍ واحدةٍ.
 *
 * لماذا فحصٌ لا اتفاقٌ: العطبُ الأصليُّ لم يُكتَب سطراً خاطئاً. `/sos` كانَ فرعاً
 * في `switch` كسائرِ الفروعِ، والمُوزِّعُ يقرأُ الدليلَ **قبلَ كلِّ أمرٍ** — فبنيةٌ
 * سليمةٌ لكلِّ أمرٍ آخرَ صارت بابَ إسقاطٍ لأخطرِ أمرٍ. ولا ترجمةٌ تُخفِقُ ولا
 * مراجعٌ يرى تعارضاً: الفرعُ في مكانِه الطبيعيِّ. وإسقاطُ استغاثةٍ لا يُرى في
 * لوحةٍ ولا يُشتكى منه — من ضغطَ الزرَّ ولم يُجَب لا يفتحُ تذكرةً.
 *
 * **وحدُّ الحاجزِ مُعلَنٌ:** يقرأُ النصَّ لا الأثرَ. أنَّ النداءَ يصلُ فعلاً حينَ
 * تسقطُ `Redis` أو حينَ لا طلبَ صريحاً يُثبِتُه اختبارُ الوَحدةِ واختبارُ التكاملِ
 * على PostgreSQL حقيقيٍّ — لا هذا الملفُّ.
 */

import { readFileSync } from "node:fs";

/** بوتُ الراكبِ. */
export const RIDER_MODULE = "packages/application/bots/rider-dialog.ts";
/** بوتُ السائقِ. */
export const DRIVER_MODULE = "packages/application/bots/driver-dialog.ts";

export interface IntakeSite {
  /** الملفُّ الذي يحوي الدالّةَ. */
  readonly module: string;
  /** اسمُ الدالّةِ التي تُمثِّلُ موضعَ الاستقبالِ. */
  readonly fn: string;
  /** ما يستقبلُه هذا الموضعُ — يُذكَرُ في نصِّ الخرقِ. */
  readonly what: string;
}

/**
 * مواضعُ استقبالِ الاستغاثةِ كلُّها. **قائمةٌ مُعلَنةٌ لا مُستنبَطةٌ**: لو استُنبِطَت
 * بالبحثِ عن `triggerSos` لَسقطَ الفحصُ صامتاً عندَ إعادةِ تسميةٍ.
 */
export const INTAKE_SITES: readonly IntakeSite[] = [
  { module: RIDER_MODULE, fn: "handleRiderSos", what: "أمرُ `/sos` من الراكبِ" },
  { module: RIDER_MODULE, fn: "handleSosCallback", what: "زرُّ الاستغاثةِ من الراكبِ" },
  { module: DRIVER_MODULE, fn: "handleDriverSos", what: "أمرُ `/sos` من السائقِ" },
];

export interface DispatcherSite {
  readonly module: string;
  readonly fn: string;
  /** الدالّةُ التي يجبُ أن يُوزَّعَ إليها قبلَ أوّلِ انتظارٍ. */
  readonly target: string;
}

/** مُوزِّعاتُ الأوامرِ التي يجبُ أن يسبقَ فيها توزيعُ `/sos` أوّلَ انتظارٍ. */
export const DISPATCHERS: readonly DispatcherSite[] = [
  { module: RIDER_MODULE, fn: "handleCommand", target: "handleRiderSos" },
  { module: DRIVER_MODULE, fn: "handleCommand", target: "handleDriverSos" },
];

/** الدالّةُ الوحيدةُ التي يجوزُ انتظارُها في موضعِ الاستقبالِ. */
export const ALLOWED_AWAIT = "triggerSos";
/** الحِملُ الذي يعني «حُلَّ طلبَ المُبلِّغِ في القاعدةِ تحتَ القفلِ». */
export const NULL_ORDER_LITERAL = "orderId: null";
/** فرعُ `switch` المحظورُ: وجودُه يعني أنَّ قراءةَ الدليلِ قد مرَّت. */
export const FORBIDDEN_CASE = 'case "/sos"';
/** القراءاتُ التي كانت تُسقِطُ النداءَ — محظورةٌ في أجسامِ الاستقبالِ. */
export const FORBIDDEN_READS: readonly string[] = [
  "findByTelegramId",
  "activeOrdersOf",
  "cardOf",
  "tripCards",
];

export interface Violation {
  readonly file: string;
  readonly line: number | null;
  readonly why: string;
}

/** قارئُ ملفٍّ يُمرَّرُ للاختبارِ: الغيابُ `null` ليُقرأَ خرقاً لا استثناءً. */
export type Reader = (path: string) => string | null;

export const defaultReader: Reader = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/**
 * يُبدِلُ كلَّ تعليقٍ بفراغٍ **مع حفظِ عددِ الأسطرِ** — فأرقامُ الأسطرِ تبقى صادقةً.
 * وحدُّه مُعلَنٌ: لا يفهمُ نصّاً حرفيّاً يحوي `//`؛ ولا يوجَدُ في المواضعِ
 * المحروسةِ، وإن وُجِدَ فأثرُه تشدُّدٌ لا تسامحٌ.
 */
export function stripComments(source: string): string {
  let out = "";
  let index = 0;
  let inBlock = false;
  let inLine = false;
  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];
    if (inBlock) {
      if (char === "*" && next === "/") {
        inBlock = false;
        out += "  ";
        index += 2;
        continue;
      }
      out += char === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }
    if (inLine) {
      if (char === "\n") {
        inLine = false;
        out += "\n";
        index += 1;
        continue;
      }
      out += " ";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlock = true;
      out += "  ";
      index += 2;
      continue;
    }
    if (char === "/" && next === "/") {
      inLine = true;
      out += "  ";
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

export interface FunctionBody {
  /** جسمُ الدالّةِ بينَ القوسَينِ المعقوفَينِ، تعليقاتُه مُبدَلةٌ بفراغٍ. */
  readonly body: string;
  /** رقمُ سطرِ إعلانِ الدالّةِ في الملفِّ (١ مبدأً). */
  readonly line: number;
}

/**
 * جسمُ دالّةٍ مُعلَنةٍ بالاسمِ، بمطابقةِ الأقواسِ المعقوفةِ. `null` إن لم تُعلَن.
 * والمصدرُ يُنقّى من التعليقاتِ **قبلَ** البحثِ: فذكرُ الاسمِ في تعليقٍ لا يُعَدُّ
 * إعلاناً، وقراءةٌ مذكورةٌ في تعليقٍ شرحاً لا تُعَدُّ خرقاً.
 */
export function functionBody(source: string, name: string): FunctionBody | null {
  const clean = stripComments(source);
  const declaration = new RegExp(`function\\s+${name}\\s*\\(`).exec(clean);
  if (declaration === null) return null;
  const open = clean.indexOf("{", declaration.index);
  if (open === -1) return null;
  let depth = 0;
  for (let index = open; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          body: clean.slice(open + 1, index),
          line: clean.slice(0, declaration.index).split("\n").length,
        };
      }
    }
  }
  return null;
}

/** أسماءُ الدوالِّ المُنتظَرَةِ في نصٍّ، بترتيبِ ورودِها. */
export function awaitedCalls(body: string): readonly string[] {
  const names: string[] = [];
  const pattern = /await\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;
  let match = pattern.exec(body);
  while (match !== null) {
    names.push(match[1] as string);
    match = pattern.exec(body);
  }
  return names;
}

/** كلُّ `await` في النصِّ ولو لم يكن نداءً — لتُحصى المخالفاتُ لا النداءاتُ وحدَها. */
export function awaitCount(body: string): number {
  return (body.match(/\bawait\b/g) ?? []).length;
}

export function findViolations(read: Reader = defaultReader): readonly Violation[] {
  const violations: Violation[] = [];

  // ١) لا تُفحَصُ قائمةٌ فارغةٌ: حاجزٌ بلا مواضعَ نجاحٌ كاذبٌ (ح-5).
  if (INTAKE_SITES.length === 0 || DISPATCHERS.length === 0) {
    violations.push({
      file: "scripts/check-sos-intake-isolation.ts",
      line: null,
      why: "قائمةُ المواضعِ المحروسةِ فارغةٌ: الحاجزُ يفحصُ لا شيءَ فيَمُرُّ دائماً — وذاكَ أخطرُ من خرقٍ يُرى (ح-5).",
    });
    return violations;
  }

  const sources = new Map<string, string>();
  for (const path of new Set([...INTAKE_SITES, ...DISPATCHERS].map((site) => site.module))) {
    const source = read(path);
    if (source === null) {
      violations.push({
        file: path,
        line: null,
        why: "الملفُّ المحروسُ غيرُ مقروءٍ: إمّا نُقِلَ أو أُعيدَت تسميتُه. ويُصحَّحُ الموضعُ في الحاجزِ، لا يُحذَفُ الفحصُ.",
      });
      continue;
    }
    sources.set(path, source);
  }

  for (const site of INTAKE_SITES) {
    const source = sources.get(site.module);
    if (source === undefined) continue;
    const found = functionBody(source, site.fn);
    if (found === null) {
      violations.push({
        file: site.module,
        line: null,
        why: `لا دالّةَ \`${site.fn}\` — وهيَ موضعُ استقبالِ ${site.what}. فإن أُعيدَت تسميتُها فالاسمُ يُصحَّحُ ههنا، وإن أُدمِجَت في المُوزِّعِ فقد عادَ العطبُ نفسُه (F8-05).`,
      });
      continue;
    }
    const { body, line } = found;

    // ٢) انتظارٌ واحدٌ لا غيرُ، وهوَ على `triggerSos`.
    const awaited = awaitedCalls(body);
    const total = awaitCount(body);
    if (total !== 1 || awaited.length !== 1 || awaited[0] !== ALLOWED_AWAIT) {
      violations.push({
        file: site.module,
        line,
        why: `\`${site.fn}\` فيه ${total} انتظاراً (${awaited.join(" · ") || "بلا نداءٍ"}) والمسموحُ انتظارٌ واحدٌ على \`${ALLOWED_AWAIT}\`. فكلُّ انتظارٍ ثانٍ بابُ إسقاطٍ: إخفاقُه يردُّ عطلاً أو كذباً مطمئنّاً، والاستغاثةُ تسقطُ (ADR-0077).`,
      });
    }

    // ٣) الطلبُ يُحَلُّ في القاعدةِ تحتَ القفلِ لا يُمرَّرُ من الأعلى.
    if (!body.includes(NULL_ORDER_LITERAL)) {
      violations.push({
        file: site.module,
        line,
        why: `\`${site.fn}\` لا يُمرِّرُ \`${NULL_ORDER_LITERAL}\`: فمُعرِّفُ الطلبِ إمّا قُرِئَ بانتظارٍ زائدٍ أو جاءَ من بياناتِ زرٍّ غيرِ مُوقَّعةٍ — وزرٌّ قديمٌ يشيرُ إلى رحلةٍ انتهَت فتُبلَّغُ مدينةٌ لا خطرَ فيها (ADR-0077).`,
      });
    }

    // ٤) لا قارئَ محظوراً في جسمِ الاستقبالِ.
    for (const read_ of FORBIDDEN_READS) {
      if (!body.includes(read_)) continue;
      violations.push({
        file: site.module,
        line,
        why: `\`${site.fn}\` يذكرُ \`${read_}\` — وهيَ من القراءاتِ التي كانت تُسقِطُ الاستغاثةَ. والدالّةُ تُثبِتُ المِلكيّةَ بنفسِها تحتَ \`for update\`، فالقراءةُ تكرارُ حكمٍ قائمٍ بفارقِ أنَّها تُخفِقُ.`,
      });
    }
  }

  for (const dispatcher of DISPATCHERS) {
    const source = sources.get(dispatcher.module);
    if (source === undefined) continue;
    const clean = stripComments(source);

    // ٥) لا فرعَ في `switch`: الفرعُ يعني أنَّ قراءةَ الدليلِ فوقَه قد مرَّت.
    const caseAt = clean.indexOf(FORBIDDEN_CASE);
    if (caseAt !== -1) {
      violations.push({
        file: dispatcher.module,
        line: clean.slice(0, caseAt).split("\n").length,
        why: `\`${FORBIDDEN_CASE}\` عادَ فرعاً في \`switch\`: فرعٌ ههنا لا يُبلَغُ إلّا بعدَ قراءةِ الدليلِ في أعلى \`${dispatcher.fn}\`، وإخفاقُ تلكَ القراءةِ يردُّ «حدثَ عطلٌ» — فتسقطُ الاستغاثةُ بعطبِ قراءةٍ لا تخصُّها (F8-05).`,
      });
    }

    const found = functionBody(source, dispatcher.fn);
    if (found === null) {
      violations.push({
        file: dispatcher.module,
        line: null,
        why: `لا دالّةَ \`${dispatcher.fn}\` في مُوزِّعِ الأوامرِ: فموضعُ التوزيعِ غيرُ مفحوصٍ، ولا يُعرَفُ أسبقَ \`/sos\` أوّلَ انتظارٍ أم تأخّرَ عنه.`,
      });
      continue;
    }
    const { body, line } = found;
    const dispatchAt = body.indexOf(dispatcher.target);
    if (dispatchAt === -1) {
      violations.push({
        file: dispatcher.module,
        line,
        why: `\`${dispatcher.fn}\` لا يُوزِّعُ إلى \`${dispatcher.target}\`: فالأمرُ \`/sos\` إمّا صارَ فرعاً في \`switch\` أو سقطَ من المُوزِّعِ رأساً.`,
      });
      continue;
    }
    const firstAwait = body.search(/\bawait\b/);
    if (firstAwait !== -1 && firstAwait < dispatchAt) {
      violations.push({
        file: dispatcher.module,
        line: line + body.slice(0, firstAwait).split("\n").length - 1,
        why: `في \`${dispatcher.fn}\` انتظارٌ **قبلَ** توزيعِ \`/sos\` إلى \`${dispatcher.target}\`: كلُّ ما يُوضَعُ فوقَ سطرِ التوزيعِ يصيرُ شرطاً لوصولِ النداءِ، وإخفاقُه إسقاطٌ له. فالتوزيعُ يبقى أوّلَ فعلٍ في المُوزِّعِ (ADR-0077).`,
      });
    }
  }

  return violations;
}

function main(): void {
  const violations = findViolations();

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} خرقاً لعزلِ مسارِ الاستغاثةِ (F8-05 · ADR-0077):\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}${violation.line === null ? "" : `:${violation.line}`}`);
      console.error(`    ${violation.why}\n`);
    }
    process.exit(1);
  }

  console.log(
    `✓ مسارُ استقبالِ الاستغاثةِ معزولٌ — ${INTAKE_SITES.length} موضعَ استقبالٍ بانتظارٍ واحدٍ على \`${ALLOWED_AWAIT}\` و\`${NULL_ORDER_LITERAL}\`، و${DISPATCHERS.length} مُوزِّعاً يُوزِّعُ \`/sos\` قبلَ أوّلِ انتظارٍ`,
  );
}

if (import.meta.main) main();
