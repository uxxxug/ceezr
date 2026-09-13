#!/usr/bin/env bun
/**
 * الغرض: حاجزُ **تطابقِ العقودِ**: يُقابِلُ إعلانَ MOVE
 *    (`packages/domain/wasla/event-envelope.ts`) بمخطَّطاتِ CORE المنقولةِ في
 *    `docs/contracts/core/`، ويُقابِلُ آلةَ الحالاتِ
 *    (`packages/domain/wasla/operational-job.ts`) بدوالِّ الهجرةِ التي تُنفِّذُها،
 *    فلا يبقى للعقدِ صورتانِ مختلفتانِ في مستودعٍ واحدٍ. البند `W-5`.
 * الحالة: منفّذ فعلياً — 2026-09-11 · البند `W-5`.
 * ينتمي إلى: scripts (حاجزٌ في سلسلةِ `ci`)
 * يُستخدم من: `package.json` → `check-core-contract-parity`، و
 *    `.github/workflows/ci.yml` خطوةً مُسمَّاةً.
 * ملاحظات مستقبلية: هذا الحاجزُ **لا يُثبِتُ حداثةَ النسخةِ عن CORE** — ذاكَ
 *    يلزمُه وصولٌ متبادلٌ، وهوَ `DEP-CORE-005` المسجَّلُ. انظر
 *    `docs/contracts/core/PROVENANCE.md`.
 *
 * ## ما يُفحَصُ بالضبطِ
 *
 * ١) كلُّ مخطَّطٍ منقولٍ له إعلانٌ، وكلُّ إعلانٍ له مخطَّطٌ — لا يتيمَ في الجهتَينِ.
 * ٢) `required` سواءً، بلا اعتبارٍ للترتيبِ.
 * ٣) أسماءُ الحقولِ سواءً، وكلُّ كلمةٍ في كلِّ حقلٍ سواءً (`type`, `format`,
 *    `enum`, `minLength`, `minimum`, `pattern`).
 * ٤) كلُّ مخطَّطٍ `additionalProperties: false` — لأنَّ المُدقِّقَ يمنعُ الزائدَ
 *    دائماً، فلو سمحَ المخطَّطُ بالزائدِ لَكانَ إعلانُنا **أضيقَ** من العقدِ ونحنُ
 *    نظنُّه مُطابِقاً.
 * ٥) لا كلمةَ مخطَّطٍ خارجَ ما يفهمُه المُدقِّقُ — فعقدٌ يستعملُ `maxItems` مثلاً
 *    يُخفِقُ ههنا ولا يُمرَّرُ مُهمَلاً.
 * ٦) كلُّ `rpc` في جدولِ الانتقالاتِ موجودةٌ دالّةً في هجرةِ `W-5`.
 * ٧) قائمةُ الحالاتِ في الشيفرةِ = قيدُ `state` في هجرةِ `W-4`.
 * ٨) صيغةُ مفتاحِ منعِ التكرارِ في الشيفرةِ = الصيغةُ المبنيّةُ في الهجرةِ.
 * ٩) ثوابتُ **الناقلِ** في `packages/shared/config/core-event-transport.ts` =
 *    عقدُ النقلِ المنقولُ في `docs/contracts/core/transport/`: مسارُ الإيداعِ،
 *    ورمزُ القبولِ، وحقولُ الإيصالِ الثلاثةُ، وترويستا الهويّةِ والتوقيعِ، وبادئةُ
 *    التوقيعِ، وجدولُ تصنيفِ الردودِ صفّاً صفّاً، وأدنى طولِ سرٍّ.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENVELOPE_SPEC,
  type FieldSpec,
  type ObjectSpec,
  PAYLOAD_SPECS,
  SUPPORTED_SCHEMA_KEYWORDS,
} from "../packages/domain/wasla/event-envelope.ts";
import {
  MOVE_EVENT_TYPES,
  OPERATIONAL_JOB_STATES,
  outboxDedupKey,
  TRANSITIONS,
} from "../packages/domain/wasla/operational-job.ts";
import {
  CORE_EVENT_ID_HEADER,
  CORE_EVENT_RETRYABLE_CLIENT_STATUSES,
  CORE_EVENT_SIGNATURE_HEADER,
  CORE_EVENT_SIGNATURE_PREFIX,
  CORE_EVENT_SUBMIT_ACCEPTED_STATUS,
  CORE_EVENT_SUBMIT_PATH,
  CORE_INBOUND_MIN_SECRET_LENGTH,
  classifyCoreSubmitStatus,
} from "../packages/shared/config/core-event-transport.ts";

const CONTRACTS_DIR = "docs/contracts/core";
// هجرتا `W-4`/`W-5` مؤجَّلتانِ بتعليمةِ `O-7`، والمُقابِلُ يقرؤهما حيثُ هما:
// إخراجُ التكاملِ من مسارِ التطبيقِ لا يُسقِطُ مُقابِلَ عقدِه (`ADR 0095`).
const W4_MIGRATION = "deferred/core-integration/migrations/20260911100000_w4_operational_jobs.sql";
const W5_MIGRATION =
  "deferred/core-integration/migrations/20260911100100_w5_core_inbox_move_outbox.sql";
const CORE_OPENAPI = join(CONTRACTS_DIR, "transport/core-v1.yaml");
const CORE_OUTBOUND_DOC = join(CONTRACTS_DIR, "transport/outbound-delivery.md");

interface Breach {
  readonly where: string;
  readonly why: string;
}

/** ملفّاتُ المخطَّطاتِ المنقولةُ، بمفتاحٍ هوَ اسمُ الملفِّ بلا `.schema.json`. */
function readSchemas(): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const name of readdirSync(CONTRACTS_DIR).sort()) {
    if (!name.endsWith(".schema.json")) continue;
    const raw = readFileSync(join(CONTRACTS_DIR, name), "utf8");
    out.set(name.slice(0, -".schema.json".length), JSON.parse(raw) as Record<string, unknown>);
  }
  return out;
}

/** الكلماتُ الوصفيّةُ التي لا تُنفَّذُ فلا تُقارَنُ. */
const IGNORED_FIELD_KEYWORDS = new Set(["description", "title", "examples", "default", "$comment"]);

/** مقارنةُ قيمتَينِ بلا اعتبارٍ لترتيبِ عناصرِ المصفوفةِ في `type` وحدَه. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }
  return a === b;
}

/** مقابلةُ حقلٍ واحدٍ. */
function compareField(where: string, declared: FieldSpec, schema: unknown): readonly Breach[] {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return [{ where, why: "تعريفُ الحقلِ في المخطَّطِ ليسَ كائناً" }];
  }
  const breaches: Breach[] = [];
  const raw = schema as Record<string, unknown>;
  const declaredRaw = declared as unknown as Record<string, unknown>;
  const keywords = new Set<string>();
  for (const key of Object.keys(raw)) {
    if (IGNORED_FIELD_KEYWORDS.has(key)) continue;
    if (!(SUPPORTED_SCHEMA_KEYWORDS as readonly string[]).includes(key)) {
      breaches.push({
        where,
        why: `المخطَّطُ يستعملُ الكلمةَ \`${key}\` والمُدقِّقُ لا يُنفِّذُها — تُنفَّذُ أو يُرَدُّ العقدُ، ولا تُهمَلُ`,
      });
      continue;
    }
    keywords.add(key);
  }
  for (const key of Object.keys(declaredRaw)) keywords.add(key);
  for (const key of keywords) {
    if (!sameValue(declaredRaw[key], raw[key])) {
      breaches.push({
        where: `${where}.${key}`,
        why: `الإعلانُ ${JSON.stringify(declaredRaw[key]) ?? "غائبٌ"} والمخطَّطُ ${JSON.stringify(raw[key]) ?? "غائبٌ"}`,
      });
    }
  }
  return breaches;
}

/** مقابلةُ كائنٍ كاملاً: `required` والحقولُ ومنعُ الزائدِ. */
export function compareObject(
  name: string,
  declared: ObjectSpec,
  schema: Record<string, unknown>,
): readonly Breach[] {
  const breaches: Breach[] = [];

  if (schema.additionalProperties !== false) {
    breaches.push({
      where: `${name}.additionalProperties`,
      why: "المخطَّطُ لا يمنعُ الحقلَ الزائدَ والمُدقِّقُ يمنعُه — فإعلانُنا أضيقُ من العقدِ",
    });
  }

  const schemaRequired = new Set((schema.required as string[] | undefined) ?? []);
  const declaredRequired = new Set(declared.required);
  for (const key of declaredRequired) {
    if (!schemaRequired.has(key)) {
      breaches.push({ where: `${name}.required`, why: `\`${key}\` مطلوبٌ عندَنا وليسَ في المخطَّطِ` });
    }
  }
  for (const key of schemaRequired) {
    if (!declaredRequired.has(key)) {
      breaches.push({ where: `${name}.required`, why: `\`${key}\` مطلوبٌ في المخطَّطِ وليسَ عندَنا` });
    }
  }

  const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
  for (const key of Object.keys(declared.properties)) {
    if (!(key in properties)) {
      breaches.push({ where: `${name}.${key}`, why: "حقلٌ مُعلَنٌ عندَنا لا وجودَ له في المخطَّطِ" });
    }
  }
  for (const [key, fieldSchema] of Object.entries(properties)) {
    const declaredField = declared.properties[key];
    if (declaredField === undefined) {
      breaches.push({ where: `${name}.${key}`, why: "حقلٌ في المخطَّطِ غيرُ مُعلَنٍ عندَنا" });
      continue;
    }
    breaches.push(...compareField(`${name}.${key}`, declaredField, fieldSchema));
  }
  return breaches;
}

/** مقابلةُ كلِّ الإعلاناتِ بكلِّ المخطَّطاتِ. */
export function compareContracts(schemas: Map<string, Record<string, unknown>>): readonly Breach[] {
  const breaches: Breach[] = [];
  const envelope = schemas.get("envelope");
  if (envelope === undefined) {
    breaches.push({ where: CONTRACTS_DIR, why: "`envelope.schema.json` مفقودٌ" });
  } else {
    breaches.push(...compareObject("envelope", ENVELOPE_SPEC, envelope));
  }

  for (const [key, declared] of Object.entries(PAYLOAD_SPECS)) {
    const schema = schemas.get(key);
    if (schema === undefined) {
      breaches.push({ where: key, why: "إعلانُ حمولةٍ بلا مخطَّطٍ منقولٍ يُقابِلُه" });
      continue;
    }
    breaches.push(...compareObject(key, declared, schema));
  }

  for (const key of schemas.keys()) {
    if (key === "envelope") continue;
    if (!(key in PAYLOAD_SPECS)) {
      breaches.push({ where: key, why: "مخطَّطٌ منقولٌ بلا إعلانٍ يُنفِّذُه — يُعلَنُ أو يُحذَفُ من النسخةِ" });
    }
  }
  return breaches;
}

/** مقابلةُ آلةِ الحالاتِ بالهجرتَينِ. */
export function compareStateMachine(w4: string, w5: string): readonly Breach[] {
  const breaches: Breach[] = [];

  for (const state of OPERATIONAL_JOB_STATES) {
    if (!w4.includes(`'${state}'`)) {
      breaches.push({
        where: W4_MIGRATION,
        why: `الحالةُ \`${state}\` مُعلَنةٌ في الشيفرةِ ولا أثرَ لها في قيدِ الهجرةِ`,
      });
    }
  }

  for (const [name, spec] of Object.entries(TRANSITIONS)) {
    if (!w5.includes(`function ${spec.rpc}(`) && !w5.includes(`function ${spec.rpc} (`)) {
      breaches.push({
        where: W5_MIGRATION,
        why: `الانتقالُ \`${name}\` يُعلِنُ الدالّةَ \`${spec.rpc}\` ولا تعريفَ لها في الهجرةِ`,
      });
    }
  }

  for (const eventType of MOVE_EVENT_TYPES) {
    const key = outboxDedupKey(eventType, "");
    if (!w5.includes(`'${key}'`)) {
      breaches.push({
        where: W5_MIGRATION,
        why: `صيغةُ مفتاحِ منعِ التكرارِ \`${key}<id>\` في الشيفرةِ لا تُطابِقُ ما تبنيه الهجرةُ`,
      });
    }
  }
  return breaches;
}

/**
 * صفٌّ من جدولِ تصنيفِ الردودِ في `outbound-delivery.md`: نصُّ الردِّ، ثمَّ الحكمُ.
 * والجدولُ يُقرأُ من الوثيقةِ لا يُكتَبُ ههنا: لو نُسِخَ لَصارَ للحكمِ مصدرانِ.
 */
interface VerdictRow {
  readonly response: string;
  readonly action: string;
}

function readVerdictTable(markdown: string): readonly VerdictRow[] {
  const rows: VerdictRow[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length !== 3) continue;
    const [response, , action] = cells;
    if (response === undefined || action === undefined) continue;
    if (response === "Response" || response.startsWith("---")) continue;
    rows.push({ response, action });
  }
  return rows;
}

/** حكمُ صفٍّ كما تنطقُ به الوثيقةُ، مُترجَماً إلى مصطلحِ التصنيفِ عندَنا. */
function documentedVerdict(action: string): "delivered" | "retry" | "dead" | null {
  const lowered = action.toLowerCase();
  if (lowered.includes("delivered")) return "delivered";
  if (lowered.includes("dead")) return "dead";
  if (lowered.includes("retry")) return "retry";
  return null;
}

/**
 * مقابلةُ ثوابتِ الناقلِ بعقدِ النقلِ المنقولِ. والمقابلةُ نصّيّةٌ على الوثيقةِ
 * وعلى `core-v1.yaml` بلا مُحلِّلِ YAML: إضافةُ مُحلِّلٍ لأجلِ أربعِ قيمٍ تُقرأُ
 * بالبحثِ عن نصٍّ حرفيٍّ تُدخِلُ تبعيّةً تُصانُ ولا تزيدُ صدقاً.
 */
function compareTransport(): Breach[] {
  const breaches: Breach[] = [];
  const openapi = readFileSync(CORE_OPENAPI, "utf8");
  const doc = readFileSync(CORE_OUTBOUND_DOC, "utf8");

  if (!openapi.includes(`  ${CORE_EVENT_SUBMIT_PATH}:`)) {
    breaches.push({
      where: CORE_OPENAPI,
      why: `مسارُ الإيداعِ في الشيفرةِ \`${CORE_EVENT_SUBMIT_PATH}\` لا يُوجَدُ مساراً في العقدِ المنقولِ`,
    });
  }
  if (!openapi.includes(`"${CORE_EVENT_SUBMIT_ACCEPTED_STATUS}":`)) {
    breaches.push({
      where: CORE_OPENAPI,
      why: `رمزُ القبولِ \`${CORE_EVENT_SUBMIT_ACCEPTED_STATUS}\` في الشيفرةِ لا يُعلِنُه العقدُ رمزَ ردٍّ`,
    });
  }
  for (const field of ["event_id", "accepted", "first_delivery"]) {
    if (!openapi.includes(field)) {
      breaches.push({
        where: CORE_OPENAPI,
        why: `حقلُ الإيصالِ \`${field}\` الذي يقرأُه الناقلُ لا يذكرُه العقدُ المنقولُ`,
      });
    }
  }
  for (const header of [CORE_EVENT_ID_HEADER, CORE_EVENT_SIGNATURE_HEADER]) {
    if (!doc.includes(header)) {
      breaches.push({
        where: CORE_OUTBOUND_DOC,
        why: `الترويسةُ \`${header}\` في الشيفرةِ لا تُذكَرُ في عقدِ التسليمِ الصادرِ`,
      });
    }
  }
  if (!doc.includes(`${CORE_EVENT_SIGNATURE_HEADER}: ${CORE_EVENT_SIGNATURE_PREFIX}`)) {
    breaches.push({
      where: CORE_OUTBOUND_DOC,
      why: `صيغةُ التوقيعِ \`${CORE_EVENT_SIGNATURE_HEADER}: ${CORE_EVENT_SIGNATURE_PREFIX}<hex>\` لا تُطابِقُ ما تنصُّ عليه الوثيقةُ`,
    });
  }
  /**
   * أدنى طولِ سرٍّ منصوصٌ قيداً في `core-v1.yaml` (`minLength`) لا في الوثيقةِ
   * السرديّةِ، فيُقرأُ من موضعِه لا من موضعٍ يُشبِهُه.
   */
  if (!openapi.includes(`minLength: ${CORE_INBOUND_MIN_SECRET_LENGTH}`)) {
    breaches.push({
      where: CORE_OPENAPI,
      why: `أدنى طولِ سرِّ التوقيعِ ${CORE_INBOUND_MIN_SECRET_LENGTH} عندَنا لا يُوافِقُ قيدَ \`minLength\` في العقدِ المنقولِ`,
    });
  }

  const table = readVerdictTable(doc);
  if (table.length === 0) {
    breaches.push({
      where: CORE_OUTBOUND_DOC,
      why: "لا جدولَ تصنيفِ ردودٍ يُقرأُ في العقدِ المنقولِ — فلا يُقابَلُ التصنيفُ بشيءٍ",
    });
  }
  /** أسماءُ الردودِ التي لها رمزٌ يُصنَّفُ برنامجيّاً؛ وما لا رمزَ له (مهلةٌ، DNS) يُقاسُ في اختبارِ الناقلِ. */
  const SAMPLES: Readonly<Record<string, readonly number[]>> = {
    "2xx": [200, 202, 204],
    "5xx": [500, 502, 503],
    "408, 429": [408, 429],
    "other 4xx": [400, 401, 403, 404, 409, 422],
  };
  for (const row of table) {
    const samples = SAMPLES[row.response];
    if (samples === undefined) continue;
    const expected = documentedVerdict(row.action);
    if (expected === null) {
      breaches.push({
        where: CORE_OUTBOUND_DOC,
        why: `صفُّ الجدولِ \`${row.response}\` لا يُقرأُ منه حكمٌ (\`${row.action}\`) — فالجدولُ تغيَّرَ ولم يتغيَّرِ الحاجزُ`,
      });
      continue;
    }
    for (const status of samples) {
      const actual = classifyCoreSubmitStatus(status);
      if (actual !== expected) {
        breaches.push({
          where: "packages/shared/config/core-event-transport.ts",
          why: `تصنيفُ ${status} عندَنا \`${actual}\` والعقدُ ينصُّ على \`${expected}\` لصفِّ \`${row.response}\``,
        });
      }
    }
  }
  const documentedRetryable = table.find((row) => row.response === "408, 429");
  if (documentedRetryable !== undefined) {
    for (const status of [408, 429]) {
      if (!CORE_EVENT_RETRYABLE_CLIENT_STATUSES.includes(status)) {
        breaches.push({
          where: "packages/shared/config/core-event-transport.ts",
          why: `العقدُ يستثني ${status} من موتِ \`4xx\` ولا تذكرُه قائمةُ المُستثنَياتِ عندَنا`,
        });
      }
    }
  }
  return breaches;
}

function main(): void {
  const breaches = [
    ...compareContracts(readSchemas()),
    ...compareStateMachine(readFileSync(W4_MIGRATION, "utf8"), readFileSync(W5_MIGRATION, "utf8")),
    ...compareTransport(),
  ];

  if (breaches.length > 0) {
    console.error(`✗ ${breaches.length} انفراطاً في تطابقِ العقودِ (W-5):\n`);
    for (const breach of breaches) {
      console.error(`  ${breach.where}`);
      console.error(`    ${breach.why}\n`);
    }
    process.exit(1);
  }

  console.log(
    `✓ عقودُ CORE مُطابَقةٌ: مغلَّفٌ + ${Object.keys(PAYLOAD_SPECS).length} حمولةً · آلةُ الحالاتِ مُطابِقةٌ للهجرتَينِ (${OPERATIONAL_JOB_STATES.length} حالاتٍ · ${Object.keys(TRANSITIONS).length} انتقالاتٍ) · ثوابتُ الناقلِ مُطابِقةٌ لعقدِ النقلِ المنقولِ`,
  );
}

if (import.meta.main) main();
