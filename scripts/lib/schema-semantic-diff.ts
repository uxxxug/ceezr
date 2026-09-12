/**
 * الغرض: **مُقابِلٌ دلاليٌّ** بينَ نسختَينِ من عقدٍ: مخطَّطُ JSON Schema يُقابَلُ
 *    بمعناه (المطلوبُ، والحقولُ، وكلماتُ كلِّ حقلٍ، ومنعُ الزائدِ) لا بنصِّه،
 *    وملفُّ YAML يُقابَلُ ببنيتِه المُفكَّكةِ، وما لا يُفكَّكُ يُقابَلُ سطراً
 *    ويُقالُ صريحاً إنَّه نصٌّ لا دلالةٌ. البند `DEP-CORE-005`.
 * الحالة: منفّذ فعلياً — 2026-09-12 · البند `DEP-CORE-005`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-core-contract-freshness.ts` والاختباراتُ.
 * ملاحظات مستقبلية: تصنيفُ الخطورةِ ههنا **من وجهِ MOVE**: مستهلكٌ لأحداثِ CORE
 *    ومنتجٌ لأحداثِ `move.job.*`. فلو صارَ MOVE منتجاً لعقدٍ يستهلكُه غيرُه
 *    فَلْيُقرأْ عمودُ «المنتِجِ» كذلك.
 *
 * ## لِمَ دلاليٌّ لا نصّيٌّ
 *
 * المقابلةُ النصّيّةُ تُخفِقُ على إعادةِ تنسيقٍ لا تُغيِّرُ معنىً (فيُتعلَّمُ
 * تجاهُلُها)، وتسكُتُ عن تغييرٍ قاتلٍ لو وافقَ عددَ البايتاتِ. والمطلوبُ في
 * `DEP-CORE-005` أن يُكشَفَ **اختلافُ المخطَّطِ والحقولِ المطلوبةِ والممنوعةِ**،
 * وذاكَ لا يُثبَتُ إلّا بمقابلةِ المعنى: مجموعةُ المطلوبِ، ومجموعةُ الحقولِ،
 * وكلماتُ كلِّ حقلٍ، وحكمُ الحقلِ الزائدِ.
 *
 * ## ولِمَ تُصنَّفُ الخطورةُ
 *
 * «اختلفَ» وحدَها لا تُفيدُ قراراً. والمستهلكُ الذي يمنعُ الحقلَ الزائدَ —
 * ومُدقِّقُنا يمنعُه — **يَرُدُّ** كلَّ حمولةٍ فيها حقلٌ جديدٌ: وهذا بعينِه ما
 * جرى في `W-5` حينَ أضافَ CORE `organization_id` مطلوباً فصارَ MOVE يرفضُ كلَّ
 * إلغاءٍ. فالتصنيفُ يفصلُ ما يكسِرُ المستهلكَ عمّا يكسِرُ المنتِجَ عمّا هوَ
 * زيادةٌ لا تكسِرُ أحداً.
 */

export type ChangeSeverity =
  /** يكسِرُ MOVE مستهلكاً: يَرُدُّ حمولةً موافقةً للعقدِ الجديدِ، أو يقرأُ حقلاً زالَ. */
  | "breaking_for_consumer"
  /** يكسِرُ MOVE منتِجاً: حمولتُنا الصادرةُ لم تبقَ موافقةً. */
  | "breaking_for_producer"
  /** زيادةٌ لا تكسِرُ طرفاً. */
  | "additive"
  /** بنيةٌ تغيَّرَت في ملفٍّ لا يُصنَّفُ حقلاً حقلاً (عقدُ نقلٍ مثلاً). */
  | "structural"
  /** وصفٌ أو مثالٌ أو عنوانٌ: لا يُنفَّذُ فلا يكسِرُ. */
  | "editorial";

export interface SemanticChange {
  readonly at: string;
  readonly why: string;
  readonly before: string;
  readonly after: string;
  readonly severity: ChangeSeverity;
}

const EDITORIAL_KEYWORDS: ReadonlySet<string> = new Set([
  "description",
  "title",
  "examples",
  "default",
  "$comment",
  "$schema",
  "$id",
]);

/** الكلماتُ التي تُقرأُ حدّاً على القيمةِ، وتشديدُها يكسِرُ المنتِجَ. */
const BOUND_KEYWORDS: ReadonlySet<string> = new Set([
  "minLength",
  "minimum",
  "minItems",
  "exclusiveMinimum",
]);
const UPPER_BOUND_KEYWORDS: ReadonlySet<string> = new Set([
  "maxLength",
  "maximum",
  "maxItems",
  "exclusiveMaximum",
]);

function show(value: unknown): string {
  return value === undefined ? "غائبٌ" : JSON.stringify(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function stringSet(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function forbidsExtra(schema: Record<string, unknown>): boolean {
  return schema.additionalProperties === false;
}

/** مقابلةُ كلماتِ حقلٍ واحدٍ، مُصنَّفةً. */
function diffField(
  at: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): SemanticChange[] {
  const changes: SemanticChange[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key];
    const b = after[key];
    if (sameJson(a, b)) continue;

    if (EDITORIAL_KEYWORDS.has(key)) {
      changes.push({
        at: `${at}.${key}`,
        why: "وصفٌ تغيَّرَ — لا يُنفَّذُ فلا يكسِرُ",
        before: show(a),
        after: show(b),
        severity: "editorial",
      });
      continue;
    }

    if (key === "enum") {
      const gone = stringSet(a).filter((item) => !stringSet(b).includes(item));
      const added = stringSet(b).filter((item) => !stringSet(a).includes(item));
      if (added.length > 0) {
        changes.push({
          at: `${at}.enum`,
          why: `قيمةٌ جديدةٌ في العدادِ (${added.join(", ")}) — ومستهلكٌ يُعلِنُ العدادَ مغلقاً يَرُدُّ حمولةً تحملُها`,
          before: show(a),
          after: show(b),
          severity: "breaking_for_consumer",
        });
      }
      if (gone.length > 0) {
        changes.push({
          at: `${at}.enum`,
          why: `قيمةٌ سقطَت من العدادِ (${gone.join(", ")}) — ومنتِجٌ يُرسِلُها لم يبقَ موافقاً`,
          before: show(a),
          after: show(b),
          severity: "breaking_for_producer",
        });
      }
      continue;
    }

    if (key === "type" || key === "format" || key === "pattern") {
      changes.push({
        at: `${at}.${key}`,
        why:
          a === undefined
            ? "قيدٌ جديدٌ على الحقلِ — يُشدِّدُ ما كانَ مفتوحاً"
            : "قيدُ الحقلِ تغيَّرَ — قيمةٌ كانَت مقبولةً قد لا تبقى",
        before: show(a),
        after: show(b),
        severity: "breaking_for_consumer",
      });
      continue;
    }

    if (BOUND_KEYWORDS.has(key) || UPPER_BOUND_KEYWORDS.has(key)) {
      const numericA = typeof a === "number" ? a : undefined;
      const numericB = typeof b === "number" ? b : undefined;
      const tightened =
        numericA === undefined ||
        numericB === undefined ||
        (BOUND_KEYWORDS.has(key) ? numericB > numericA : numericB < numericA);
      changes.push({
        at: `${at}.${key}`,
        why: tightened ? "حدٌّ شُدِّدَ — حمولتُنا الصادرةُ قد لا تبقى موافقةً" : "حدٌّ خُفِّفَ",
        before: show(a),
        after: show(b),
        severity: tightened ? "breaking_for_producer" : "additive",
      });
      continue;
    }

    changes.push({
      at: `${at}.${key}`,
      why: "كلمةُ مخطَّطٍ تغيَّرَت ولا تصنيفَ مُعلَناً لها — تُقرأُ كاسرةً حتّى تُصنَّفَ",
      before: show(a),
      after: show(b),
      severity: "breaking_for_consumer",
    });
  }
  return changes;
}

/**
 * مقابلةُ مخطَّطَي كائنٍ دلاليّاً: `required` مجموعةً، وأسماءُ الحقولِ مجموعةً،
 * وكلماتُ كلِّ حقلٍ، وحكمُ الزائدِ، وكلماتُ المستوى الأعلى.
 */
export function diffJsonSchema(beforeRaw: unknown, afterRaw: unknown): readonly SemanticChange[] {
  const before = asRecord(beforeRaw);
  const after = asRecord(afterRaw);
  if (before === null || after === null) {
    return [
      {
        at: "(الجذرُ)",
        why: "أحدُ النسختَينِ ليسَ كائناً — لا تُقابَلُ دلالةً",
        before: show(beforeRaw),
        after: show(afterRaw),
        severity: "breaking_for_consumer",
      },
    ];
  }

  const changes: SemanticChange[] = [];

  const requiredBefore = stringSet(before.required);
  const requiredAfter = stringSet(after.required);
  for (const name of requiredAfter) {
    if (requiredBefore.includes(name)) continue;
    changes.push({
      at: `required.${name}`,
      why: "حقلٌ صارَ **مطلوباً** — كلُّ حمولةٍ تحملُه الآنَ، ومستهلكٌ لا يُعلِنُه يَرُدُّها (عطبُ `W-5` بعينِه)",
      before: "غيرُ مطلوبٍ",
      after: "مطلوبٌ",
      severity: "breaking_for_consumer",
    });
  }
  for (const name of requiredBefore) {
    if (requiredAfter.includes(name)) continue;
    changes.push({
      at: `required.${name}`,
      why: "حقلٌ لم يبقَ مطلوباً — ومستهلكٌ يفترضُ حضورَه يقرأُ غياباً",
      before: "مطلوبٌ",
      after: "غيرُ مطلوبٍ",
      severity: "breaking_for_consumer",
    });
  }

  const propsBefore = asRecord(before.properties) ?? {};
  const propsAfter = asRecord(after.properties) ?? {};
  const strict = forbidsExtra(before) || forbidsExtra(after);
  for (const name of Object.keys(propsAfter)) {
    if (name in propsBefore) continue;
    changes.push({
      at: `properties.${name}`,
      why: strict
        ? "حقلٌ جديدٌ في العقدِ، والزائدُ ممنوعٌ — فمستهلكٌ لا يُعلِنُه يَرُدُّ الحمولةَ كلَّها"
        : "حقلٌ جديدٌ في العقدِ",
      before: "غائبٌ",
      after: show(propsAfter[name]),
      severity: strict ? "breaking_for_consumer" : "additive",
    });
  }
  for (const name of Object.keys(propsBefore)) {
    if (name in propsAfter) continue;
    changes.push({
      at: `properties.${name}`,
      why: "حقلٌ سقطَ من العقدِ — ومن يقرأُه يقرأُ غياباً، ومن يُرسِلُه يُرسِلُ زائداً",
      before: show(propsBefore[name]),
      after: "غائبٌ",
      severity: "breaking_for_consumer",
    });
  }
  for (const name of Object.keys(propsAfter)) {
    if (!(name in propsBefore)) continue;
    const fieldBefore = asRecord(propsBefore[name]);
    const fieldAfter = asRecord(propsAfter[name]);
    if (fieldBefore === null || fieldAfter === null) {
      if (!sameJson(propsBefore[name], propsAfter[name])) {
        changes.push({
          at: `properties.${name}`,
          why: "تعريفُ الحقلِ ليسَ كائناً في إحدى النسختَينِ",
          before: show(propsBefore[name]),
          after: show(propsAfter[name]),
          severity: "breaking_for_consumer",
        });
      }
      continue;
    }
    changes.push(...diffField(`properties.${name}`, fieldBefore, fieldAfter));
  }

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === "required" || key === "properties") continue;
    if (sameJson(before[key], after[key])) continue;
    if (EDITORIAL_KEYWORDS.has(key)) {
      changes.push({
        at: key,
        why: "وصفٌ تغيَّرَ — لا يُنفَّذُ فلا يكسِرُ",
        before: show(before[key]),
        after: show(after[key]),
        severity: "editorial",
      });
      continue;
    }
    if (key === "additionalProperties") {
      changes.push({
        at: key,
        why:
          after[key] === false
            ? "العقدُ صارَ يمنعُ الحقلَ الزائدَ — وحمولتُنا الصادرةُ إن حملَت زائداً تُرَدُّ"
            : "العقدُ لم يبقَ يمنعُ الزائدَ — وإعلانُنا صارَ أضيقَ من العقدِ",
        before: show(before[key]),
        after: show(after[key]),
        severity: after[key] === false ? "breaking_for_producer" : "breaking_for_consumer",
      });
      continue;
    }
    changes.push({
      at: key,
      why: "كلمةُ مخطَّطٍ في المستوى الأعلى تغيَّرَت ولا تصنيفَ مُعلَناً لها",
      before: show(before[key]),
      after: show(after[key]),
      severity: "breaking_for_consumer",
    });
  }

  return changes;
}

/** مقابلةُ بنيتَينِ مُفكَّكتَينِ أيّاً كانَ عمقُهما — لعقدِ النقلِ (YAML) مثلاً. */
export function diffStructures(
  beforeRaw: unknown,
  afterRaw: unknown,
  at = "(الجذرُ)",
): readonly SemanticChange[] {
  if (sameJson(beforeRaw, afterRaw)) return [];

  const before = asRecord(beforeRaw);
  const after = asRecord(afterRaw);
  if (before === null || after === null) {
    return [
      {
        at,
        why: "قيمةٌ تغيَّرَت",
        before: show(beforeRaw),
        after: show(afterRaw),
        severity: "structural",
      },
    ];
  }

  const changes: SemanticChange[] = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const a = before[key];
    const b = after[key];
    if (sameJson(a, b)) continue;
    const where = at === "(الجذرُ)" ? key : `${at}.${key}`;
    if (a === undefined || b === undefined) {
      changes.push({
        at: where,
        why: a === undefined ? "مفتاحٌ جديدٌ في البنيةِ" : "مفتاحٌ سقطَ من البنيةِ",
        before: show(a),
        after: show(b),
        severity: "structural",
      });
      continue;
    }
    changes.push(...diffStructures(a, b, where));
  }
  return changes;
}

export type DiffFormat = "json-schema" | "yaml" | "opaque";

/** الصيغةُ تُقرأُ من الامتدادِ، فلا يُخمَّنُ نوعُ الملفِّ من محتواه. */
export function formatOf(path: string): DiffFormat {
  if (path.endsWith(".schema.json")) return "json-schema";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "yaml";
  return "opaque";
}

export interface TextDiff {
  readonly format: DiffFormat;
  readonly changes: readonly SemanticChange[];
  /** حدُّ ما تُثبِتُه هذه المقابلةُ — يُقالُ صريحاً ولا يُترَكُ للقارئِ. */
  readonly claim: string;
}

function opaqueLineDiff(before: string, after: string): readonly SemanticChange[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  const added = afterLines.filter((line) => line.trim() !== "" && !beforeSet.has(line));
  const removed = beforeLines.filter((line) => line.trim() !== "" && !afterSet.has(line));
  const changes: SemanticChange[] = [];
  if (added.length > 0 || removed.length > 0) {
    changes.push({
      at: "(نصٌّ)",
      why: `${added.length} سطراً مُضافاً و${removed.length} سطراً ساقطاً — مقابلةٌ نصّيّةٌ لا تُثبِتُ تكافؤاً دلاليّاً`,
      before: removed.slice(0, 4).join(" ⏎ ") || "—",
      after: added.slice(0, 4).join(" ⏎ ") || "—",
      severity: "structural",
    });
  }
  return changes;
}

/**
 * مقابلةُ نصَّينِ بحسبِ صيغتِهما، مع **تصريحٍ بحدِّ الدعوى**: المخطَّطُ يُقابَلُ
 * دلالةً، وYAML بنيةً، وما سواهما نصّاً ويُقالُ إنَّه نصٌّ.
 */
export function diffContractText(path: string, before: string, after: string): TextDiff {
  const format = formatOf(path);
  if (format === "json-schema") {
    try {
      return {
        format,
        changes: diffJsonSchema(JSON.parse(before), JSON.parse(after)),
        claim: "مقابلةٌ دلاليّةٌ: المطلوبُ والحقولُ وكلماتُها وحكمُ الزائدِ",
      };
    } catch (error) {
      return {
        format,
        changes: [
          {
            at: "(تحليلٌ)",
            why: `مخطَّطٌ لا يُحلَّلُ JSON: ${error instanceof Error ? error.message : String(error)}`,
            before: "—",
            after: "—",
            severity: "breaking_for_consumer",
          },
        ],
        claim: "لا مقابلةَ: أحدُ النسختَينِ لا يُحلَّلُ",
      };
    }
  }
  if (format === "yaml") {
    try {
      return {
        format,
        changes: diffStructures(Bun.YAML.parse(before), Bun.YAML.parse(after)),
        claim: "مقابلةٌ بنيويّةٌ للمُفكَّكِ: كلُّ مفتاحٍ وقيمةٍ، بلا اعتبارٍ لترتيبِ المفاتيحِ",
      };
    } catch {
      return {
        format: "opaque",
        changes: opaqueLineDiff(before, after),
        claim: "YAML لم يُفكَّكْ فسقطَت المقابلةُ إلى النصِّ — ولا تُدَّعى دلالةٌ",
      };
    }
  }
  return {
    format,
    changes: opaqueLineDiff(before, after),
    claim: "مقابلةٌ نصّيّةٌ فقط (نثرٌ) — تكشفُ الاختلافَ ولا تُصنِّفُه دلالةً",
  };
}

/** هل في المقابلةِ ما يكسِرُ طرفاً؟ الوصفُ وحدَه لا يكسِرُ. */
export function hasExecutableChange(changes: readonly SemanticChange[]): boolean {
  return changes.some((change) => change.severity !== "editorial");
}
