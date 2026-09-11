/**
 * الغرض: **إعلانُ مغلَّفِ الأحداثِ وحمولاتِها** بصيغةٍ تُقارَنُ آليّاً بمخطَّطاتِ
 *    CORE المنقولةِ في `docs/contracts/core/`، ومُدقِّقٌ صغيرٌ يُنفِّذُ الإعلانَ عندَ
 *    كلِّ إيداعٍ وكلِّ استهلاكٍ. البند `W-5`.
 * الحالة: منفّذ فعلياً — 2026-09-11.
 * ينتمي إلى: domain/wasla
 * يُستخدم من: `packages/application/wasla/fulfillment-lifecycle.ts` و
 *    `scripts/check-core-contract-parity.ts` والاختباراتُ.
 * ملاحظات مستقبلية: لو دخلَت مكتبةُ مخطَّطاتٍ إلى الاعتمادياتِ يوماً فَلْيُستبدَلْ
 *    `validate` بها **ويبقَ الإعلانُ**: الحاجزُ يقرأُ الإعلانَ لا المُدقِّقَ.
 *
 * ## لماذا مُدقِّقٌ مكتوبٌ باليدِ لا `ajv`
 *
 * اعتمادياتُ هذا المستودعِ ثلاثٌ (`grammy`, `hono`, `postgres`) بلا مُدقِّقِ
 * مخطَّطاتٍ. وإدخالُ مكتبةٍ لأجلِ سبعِ حمولاتٍ حقولُها بينَ ثلاثةٍ وخمسةٍ
 * زيادةٌ في سطحِ الاعتمادِ لا في الصدقِ. والمكتوبُ ههنا يُغطّي ما تستعملُه
 * العقودُ فعلاً — `type`، `enum`، `format: uuid|date-time`، `minLength`،
 * `minimum`، ومنعُ الحقلِ الزائدِ — **والحاجزُ يُخفِقُ إن استعملَ عقدٌ جديدٌ
 * كلمةً لا يعرفُها المُدقِّقُ**، فلا يُقبَلُ عقدٌ يُدَّعى إنفاذُه وهوَ مُهمَلٌ.
 */

/** الكلماتُ التي يفهمُها المُدقِّقُ — وما زادَ عليها يُخفِقُ الحاجزَ لا يُتجاهَلُ. */
export const SUPPORTED_SCHEMA_KEYWORDS = [
  "type",
  "format",
  "enum",
  "minLength",
  "minimum",
  "pattern",
] as const;

export interface FieldSpec {
  readonly type: "string" | "integer" | "object" | readonly ["string", "null"];
  readonly format?: "uuid" | "date-time";
  readonly enum?: readonly string[];
  readonly minLength?: number;
  readonly minimum?: number;
  readonly pattern?: string;
}

export interface ObjectSpec {
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, FieldSpec>>;
}

/** المغلَّفُ — عشرةُ حقولٍ كلُّها مطلوبةٌ، و`causation_id` مطلوبُ الحضورِ ويجوزُ `null`. */
export const ENVELOPE_SPEC: ObjectSpec = {
  required: [
    "event_id",
    "event_type",
    "version",
    "producer",
    "occurred_at",
    "correlation_id",
    "causation_id",
    "entity_type",
    "entity_id",
    "payload",
  ],
  properties: {
    event_id: { type: "string", format: "uuid" },
    event_type: { type: "string", pattern: "^(core|move|market)\\.[a-z_]+\\.[a-z_]+$" },
    version: { type: "integer", minimum: 1 },
    producer: { type: "string", enum: ["wasla-core", "wasla-move", "wasla-market"] },
    occurred_at: { type: "string", format: "date-time" },
    correlation_id: { type: "string", minLength: 1 },
    causation_id: { type: ["string", "null"] },
    entity_type: { type: "string" },
    entity_id: { type: "string" },
    payload: { type: "object" },
  },
};

/**
 * الحمولاتُ — مفتاحُ كلِّ واحدةٍ `<event_type>.v<version>`، وهوَ **بعينِه** اسمُ
 * ملفِّ المخطَّطِ في `docs/contracts/core/`، فالمطابقةُ تكونُ بالاسمِ لا بالحدسِ.
 */
export const PAYLOAD_SPECS: Readonly<Record<string, ObjectSpec>> = {
  "core.fulfillment.created.v1": {
    required: ["fulfillment_id", "organization_id", "order_reference", "requested_service"],
    properties: {
      fulfillment_id: { type: "string", format: "uuid" },
      organization_id: { type: "string", format: "uuid" },
      order_reference: { type: "string", minLength: 1 },
      requested_service: { type: "string", minLength: 1 },
    },
  },
  "core.fulfillment.cancelled.v1": {
    required: ["fulfillment_id", "order_reference", "reason", "cancelled_at"],
    properties: {
      fulfillment_id: { type: "string", format: "uuid" },
      order_reference: { type: "string", minLength: 1 },
      reason: { type: "string", minLength: 1 },
      cancelled_at: { type: "string", format: "date-time" },
      settlement_state: {
        type: "string",
        enum: ["none", "held", "captured", "released", "unsettled"],
      },
    },
  },
  "move.job.accepted.v1": {
    required: ["fulfillment_id", "job_id", "accepted_at"],
    properties: {
      fulfillment_id: { type: "string", format: "uuid" },
      job_id: { type: "string", minLength: 1 },
      accepted_at: { type: "string", format: "date-time" },
    },
  },
  "move.job.rejected.v1": {
    required: ["fulfillment_id", "reason", "rejected_at"],
    properties: {
      fulfillment_id: { type: "string", format: "uuid" },
      reason: { type: "string", minLength: 1 },
      rejected_at: { type: "string", format: "date-time" },
    },
  },
  "move.job.completed.v1": {
    required: ["fulfillment_id", "job_id", "outcome", "completed_at"],
    properties: {
      fulfillment_id: { type: "string", format: "uuid" },
      job_id: { type: "string", minLength: 1 },
      outcome: { type: "string", enum: ["completed", "failed"] },
      completed_at: { type: "string", format: "date-time" },
    },
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * `date-time` بحسبِ RFC 3339: تاريخٌ ووقتٌ ومنطقةٌ صريحةٌ (`Z` أو إزاحةٌ).
 * **ولا يُقبَلُ ما تقبلُه `Date.parse` مما ليسَ في العقدِ** — `Date.parse` تقبلُ
 * «2026» و«Sep 11 2026»، وقبولُها يجعلُ المُدقِّقَ يُمرِّرُ ما يرفضُه CORE.
 */
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

export interface ValidationIssue {
  readonly path: string;
  readonly problem: string;
}

/** خطأُ حقلٍ واحدٍ، أو `null` إن سلِمَ. */
function checkField(path: string, spec: FieldSpec, value: unknown): ValidationIssue | null {
  const types = Array.isArray(spec.type) ? spec.type : [spec.type];
  const actual =
    value === null
      ? "null"
      : Array.isArray(value)
        ? "array"
        : typeof value === "number"
          ? Number.isInteger(value)
            ? "integer"
            : "number"
          : typeof value;
  if (!types.includes(actual as "string")) {
    return { path, problem: `النوعُ ${actual} والمنتظرُ ${types.join("|")}` };
  }
  if (typeof value === "string") {
    if (spec.format === "uuid" && !UUID_RE.test(value)) {
      return { path, problem: "ليسَ uuid" };
    }
    if (spec.format === "date-time" && !DATE_TIME_RE.test(value)) {
      return { path, problem: "ليسَ date-time بمنطقةٍ صريحةٍ" };
    }
    if (spec.enum !== undefined && !spec.enum.includes(value)) {
      return { path, problem: `خارجَ المسموحِ: ${spec.enum.join("، ")}` };
    }
    if (spec.minLength !== undefined && value.length < spec.minLength) {
      return { path, problem: `أقصرُ من ${spec.minLength}` };
    }
    if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(value)) {
      return { path, problem: `لا يُطابِقُ ${spec.pattern}` };
    }
  }
  if (typeof value === "number" && spec.minimum !== undefined && value < spec.minimum) {
    return { path, problem: `أصغرُ من ${spec.minimum}` };
  }
  return null;
}

/** تدقيقُ كائنٍ على إعلانٍ: ناقصٌ، وزائدٌ، ومخالفٌ — كلُّها تُجمَعُ لا تُختصَرُ بأوّلِها. */
export function validateObject(
  spec: ObjectSpec,
  value: unknown,
  prefix: string,
): readonly ValidationIssue[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [{ path: prefix || ".", problem: "ليسَ كائناً" }];
  }
  const record = value as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  for (const key of spec.required) {
    if (!(key in record)) issues.push({ path: `${prefix}${key}`, problem: "حقلٌ مطلوبٌ غائبٌ" });
  }
  for (const [key, raw] of Object.entries(record)) {
    const field = spec.properties[key];
    if (field === undefined) {
      issues.push({ path: `${prefix}${key}`, problem: "حقلٌ زائدٌ لا في العقدِ" });
      continue;
    }
    const issue = checkField(`${prefix}${key}`, field, raw);
    if (issue !== null) issues.push(issue);
  }
  return issues;
}

/**
 * تدقيقُ مغلَّفٍ كاملاً: المغلَّفُ ثمَّ الحمولةُ بمخطَّطِ `event_type`+`version`.
 * ونوعٌ لا إعلانَ له **يُرَدُّ** ولا يُمرَّرُ بحمولةٍ غيرِ مدقَّقةٍ.
 */
export function validateEnvelope(value: unknown): readonly ValidationIssue[] {
  const issues = [...validateObject(ENVELOPE_SPEC, value, "")];
  if (issues.some((issue) => issue.path === "payload" || issue.path === ".")) return issues;
  const record = value as Record<string, unknown>;
  const eventType = record.event_type;
  const version = record.version;
  if (typeof eventType !== "string" || typeof version !== "number") return issues;
  const key = `${eventType}.v${version}`;
  const payloadSpec = PAYLOAD_SPECS[key];
  if (payloadSpec === undefined) {
    return [...issues, { path: "event_type", problem: `لا إعلانَ لحمولةِ ${key}` }];
  }
  return [...issues, ...validateObject(payloadSpec, record.payload, "payload.")];
}

/** هل سلِمَ المغلَّفُ؟ للمواضعِ التي لا تُبالي بالتفصيلِ. */
export function isValidEnvelope(value: unknown): boolean {
  return validateEnvelope(value).length === 0;
}
