/**
 * الغرض: عقدُ **ارتباطِ الطلبِ** (`F8-01` · `OPS-002` · `ADR 0129`) مكتوباً مرّةً
 *    واحدةً: الجداولُ الموصولةُ، ومواضعُ الاستدعاءِ المُعلَنةُ، والمواضعُ المسموحُ
 *    لها بذكرِ اسمِ المتغيّرِ الجلسيِّ، وقواعدُ المنعِ. ويقرؤه `check-request-correlation.ts`
 *    ويقرؤه اختبارُ الوحدةِ، فلا تُكتَبُ القائمةُ مرّتين (القاعدة 0.6).
 * الحالة: منفّذ فعلياً — عقدُ حاجزٍ، ليس منطقَ أعمال.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: scripts/check-request-correlation.ts · tests/unit/request-correlation-guard.test.ts
 * الحاكم: ADR 0129 · البند `F8-01`
 * ملاحظات مستقبلية: توسيعُ `CORRELATED_TABLES` يلزمُه هجرةٌ تُضيفُ العمودَ والقيدَ
 *    والمُشغِّلَ للجدولِ الجديدِ، وإلّا أخفقَ الحاجزُ — وهذا هوَ المقصودُ: قائمةٌ
 *    تكبرُ بالبناءِ لا بالنيّةِ. وتوسيعُ `CORRELATED_CALL_SITES` يلزمُه لفُّ الموضعِ
 *    بـ`withRequestContext` فعلاً.
 */

/** اسمُ المتغيّرِ الجلسيِّ الحاملِ للمعرِّفِ — مصدرُ حقيقةٍ واحدٌ لنصِّه. */
export const REQUEST_ID_SETTING = "app.request_id";

/** اسمُ العمودِ في الجداولِ الموصولةِ. */
export const REQUEST_ID_COLUMN = "request_id";

/**
 * المواضعُ الوحيدةُ المسموحُ لها بذكرِ نصِّ `app.request_id`. وما عداها خرقٌ:
 * اسمٌ مبثوثٌ في مواضعَ يعني مصادرَ حقيقةٍ متعدّدةً تنحرفُ عن بعضِها بهجرةٍ واحدةٍ.
 */
export const SETTING_NAME_ALLOWLIST = [
  "supabase/migrations/20260916190000_f8_01_request_correlation.sql",
  "packages/infrastructure/db/client.ts",
  "scripts/lib/request-correlation-contract.ts",
  "scripts/check-request-correlation.ts",
  "tests/unit/request-correlation-guard.test.ts",
  "tests/integration/request-correlation.test.ts",
  "docs/adr/0129-one-id-from-the-edge-to-the-row.md",
] as const;

/** الهجرةُ التي تُنشئُ العمودَ والقيدَ والمُشغِّلَ. */
export const CORRELATION_MIGRATION =
  "supabase/migrations/20260916190000_f8_01_request_correlation.sql";

/** هجرةُ طورِ `validate` للقيودِ الثلاثةِ. */
export const CORRELATION_VALIDATE_MIGRATION =
  "supabase/migrations/20260916190100_f8_01_validate_request_id_shape.sql";

/**
 * الجداولُ الموصولةُ. ولكلِّ واحدٍ منها يجبُ أن تُوجَدَ في الهجرةِ: إضافةُ العمودِ،
 * وقيدُ شكلٍ باسمِ `<table>_request_id_shape`، ومُشغِّلُ `before insert` باسمِ
 * `<table>_set_request_id`.
 *
 * **تصحيحٌ إضافيٌّ (`ح-8`)**: نصُّ الحجزِ ذكرَ `move_event_outbox` ثالثاً، ولا وجودَ
 * لجدولٍ بهذا الاسمِ في المستودعِ — فحلَّ محلَّه `ledger_entries` (أثرُ المالِ).
 * والتصحيحُ مُضافٌ ههنا وفي تعليقاتِ الهجرةِ، ولا يُمحى نصُّ الحجزِ.
 */
export const CORRELATED_TABLES = ["audit_log", "notification_outbox", "ledger_entries"] as const;

/**
 * مواضعُ الاستدعاءِ الموصولةُ **المُعلَنةُ**: كلُّ واحدٍ منها يجبُ أن يلفَّ دعوتَه
 * بـ`withRequestContext`. وهيَ **مجموعةٌ فرعيّةٌ مُعلَنةٌ لا كلُّ الدوالِّ**، ولذلكَ
 * يبقى البندُ `[~]`: زعمُ تغطيةٍ شاملةٍ لمئةٍ وسبعٍ وثلاثينَ دالّةً بلا قياسٍ
 * ادّعاءٌ (`ح-5`). والحاجزُ يمنعُ **النقصانَ** لا الزيادةَ: من وسَّعَ فليُعلِنْ.
 */
export const CORRELATED_CALL_SITES = [
  { file: "packages/infrastructure/dispatch/dispatch-adapters.ts", rpc: "claim_ride" },
  { file: "packages/infrastructure/dispute/support-adapters.ts", rpc: "open_support_ticket" },
  { file: "packages/infrastructure/reputation/rating-adapters.ts", rpc: "complete_ride" },
  { file: "packages/infrastructure/safety/safety-adapters.ts", rpc: "trigger_sos" },
  {
    file: "packages/infrastructure/notification/notification-outbox-adapters.ts",
    rpc: "finish_notification_delivery",
  },
] as const;

/** مُنشئُ السياقِ على الحافةِ — يجبُ أن يلفَّ ما بعدَه بسياقِ ارتباطٍ. */
export const EDGE_ENTRY_FILE = "apps/gateway/src/observability/request-id.ts";

/** مُصدِرُ السجلِّ المُهيكلِ — يجبُ أن يُلحِقَ المعرِّفَ بكلِّ سطرٍ. */
export const LOG_EMITTER_FILE = "packages/infrastructure/observability/structured-log.ts";

/** وحدةُ السياقِ نفسُها. */
export const CONTEXT_FILE = "packages/infrastructure/observability/correlation.ts";

/** موضعُ ضبطِ المتغيّرِ الجلسيِّ — الوحيدُ. */
export const DB_CONTEXT_FILE = "packages/infrastructure/db/client.ts";

/** مُشغِّلُ المهامِّ — يجبُ أن يُجريَ كلَّ شوطٍ في سياقِ ارتباطٍ. */
export const WORKER_RUNNER_FILE = "apps/workers/src/runner.ts";

/**
 * ترويسةُ الطلبِ الوارِدةُ الممنوعةُ القراءةُ (`ADR 0043`): المعرِّفُ يُولَّدُ عندَنا
 * ولا يأتي من عميلٍ، وإلّا صارَ مدخلَ تلاعبٍ يلوِّثُ سلاسلَ الارتباطِ.
 */
export const FORBIDDEN_INCOMING_HEADER_PATTERN =
  /\.\s*get\s*\(\s*["'`]\s*[xX]-[rR]equest-[iI]d\s*["'`]\s*\)/;

/**
 * سطحُ الخادمِ: هوَ **وحدَه** الممنوعُ من قراءةِ ترويسةِ الطلبِ الوارِدةِ. و`apps/miniapp`
 * خارجٌ عن قصدٍ: هوَ يقرأُ الترويسةَ من **ردِّ خادمِنا** لا من طلبِ عميلٍ (`F1-08`)،
 * وذاكَ عرضُ معرِّفٍ للمستخدمِ لا ثقةٌ بمُدخَلٍ — فمنعُه منعٌ للشيءِ بغيرِ علّتِه.
 */
export const SERVER_ROOTS = ["apps/gateway", "apps/workers", "apps/admin", "packages"] as const;

/** جذورُ الشيفرةِ المفحوصةُ لقاعدةِ الترويسةِ واسمِ المتغيّرِ. */
export const SCANNED_ROOTS = [
  "apps/gateway",
  "apps/workers",
  "apps/admin",
  "apps/miniapp/src",
  "packages",
  "scripts",
] as const;

/** نتيجةُ قاعدةٍ واحدةٍ. */
export interface RuleFinding {
  readonly rule: string;
  readonly detail: string;
}

export interface CorrelationSources {
  /** نصُّ الهجرةِ المُنشئةِ. */
  readonly migration: string;
  /** نصُّ هجرةِ التحقُّقِ. */
  readonly validateMigration: string;
  /** نصُّ كلِّ ملفِّ هجرةٍ، بمفتاحِ مسارِه النسبيِّ. */
  readonly allMigrations: Readonly<Record<string, string>>;
  /** نصُّ كلِّ ملفِّ شيفرةٍ مفحوصٍ، بمفتاحِ مسارِه النسبيِّ. */
  readonly sources: Readonly<Record<string, string>>;
}

/**
 * يحكمُ العقدَ كلَّه على نصوصٍ مُمرَّرةٍ — **بلا قراءةِ قرصٍ ولا خروجٍ بشيفرةٍ**،
 * فيصلحُ للحاجزِ وللاختبارِ السلبيِّ المبذورِ سواءً (`ح-7`).
 */
export function auditRequestCorrelation(input: CorrelationSources): readonly RuleFinding[] {
  const findings: RuleFinding[] = [];
  const add = (rule: string, detail: string): void => {
    findings.push({ rule, detail });
  };

  // (١) لكلِّ جدولٍ موصولٍ: عمودٌ وقيدُ شكلٍ ومُشغِّلٌ — ثلاثتُها أو لا شيءَ.
  for (const table of CORRELATED_TABLES) {
    const column = new RegExp(
      `alter\\s+table\\s+(public\\.)?${table}\\s+add\\s+column\\s+if\\s+not\\s+exists\\s+${REQUEST_ID_COLUMN}\\b`,
      "i",
    );
    if (!column.test(input.migration)) {
      add("table.column", `الجدولُ ${table} بلا عمودِ ${REQUEST_ID_COLUMN} في الهجرةِ`);
    }
    if (!new RegExp(`${table}_${REQUEST_ID_COLUMN}_shape`, "i").test(input.migration)) {
      add("table.check", `الجدولُ ${table} بلا قيدِ شكلٍ ${table}_request_id_shape`);
    }
    if (!new RegExp(`${table}_set_${REQUEST_ID_COLUMN}`, "i").test(input.migration)) {
      add("table.trigger", `الجدولُ ${table} بلا مُشغِّلِ ${table}_set_request_id`);
    }
    if (
      !new RegExp(`validate\\s+constraint\\s+${table}_${REQUEST_ID_COLUMN}_shape`, "i").test(
        input.validateMigration,
      )
    ) {
      add("table.validate", `قيدُ ${table} لم يُتحقَّقْ في هجرةِ طورِ validate`);
    }
  }

  // (٢) لا هجرةَ تُدرِجُ `request_id` بنفسِها: المُشغِّلُ يملأُه من السياقِ،
  //     وإدراجٌ صريحٌ يعني قيمةً مُلفَّقةً من موضعٍ لا يعرفُ وحدةَ العملِ.
  const insertPattern = new RegExp(
    `insert\\s+into\\s+(public\\.)?(${CORRELATED_TABLES.join("|")})\\s*\\(([^)]*)\\)`,
    "gis",
  );
  for (const [path, text] of Object.entries(input.allMigrations)) {
    for (const match of text.matchAll(insertPattern)) {
      const columns = (match[3] ?? "").toLowerCase();
      if (new RegExp(`(^|[\\s,(])${REQUEST_ID_COLUMN}([\\s,)]|$)`).test(columns)) {
        add("insert.explicit", `${path}: إدراجٌ يذكرُ ${REQUEST_ID_COLUMN} صريحاً`);
      }
    }
  }

  // (٣) اسمُ المتغيّرِ الجلسيِّ لا يُذكَرُ خارجَ قائمتِه.
  const allowed = new Set<string>(SETTING_NAME_ALLOWLIST);
  for (const [path, text] of Object.entries(input.sources)) {
    if (allowed.has(path)) continue;
    if (text.includes(REQUEST_ID_SETTING)) {
      add("setting.leak", `${path}: يذكرُ ${REQUEST_ID_SETTING} وليسَ في القائمةِ`);
    }
  }

  // (٤) ترويسةُ العميلِ لا تُقرأُ أبداً (`ADR 0043`).
  for (const [path, text] of Object.entries(input.sources)) {
    if (path === "scripts/lib/request-correlation-contract.ts") continue;
    if (!SERVER_ROOTS.some((root) => path.startsWith(`${root}/`))) continue;
    if (FORBIDDEN_INCOMING_HEADER_PATTERN.test(text)) {
      add("header.incoming", `${path}: يقرأُ ترويسةَ X-Request-Id الوارِدةَ`);
    }
  }

  // (٥) الحافةُ تلفُّ ما بعدَها بسياقِ ارتباطٍ.
  const edge = input.sources[EDGE_ENTRY_FILE];
  if (edge === undefined) {
    add("edge.missing", `${EDGE_ENTRY_FILE} غيرُ موجودٍ`);
  } else if (!/runWithCorrelation\s*\(/.test(edge)) {
    add("edge.context", `${EDGE_ENTRY_FILE}: لا يلفُّ الطلبَ بسياقِ ارتباطٍ`);
  }

  // (٦) السجلُّ المُهيكلُ يُلحِقُ المعرِّفَ.
  const emitter = input.sources[LOG_EMITTER_FILE];
  if (emitter === undefined) {
    add("log.missing", `${LOG_EMITTER_FILE} غيرُ موجودٍ`);
  } else if (!/currentRequestId\s*\(/.test(emitter) || !/request_id/.test(emitter)) {
    add("log.attach", `${LOG_EMITTER_FILE}: لا يُلحِقُ ${REQUEST_ID_COLUMN} بالسطرِ`);
  }

  // (٧) مُشغِّلُ المهامِّ يُجري كلَّ شوطٍ في سياقٍ.
  const runner = input.sources[WORKER_RUNNER_FILE];
  if (runner === undefined) {
    add("worker.missing", `${WORKER_RUNNER_FILE} غيرُ موجودٍ`);
  } else if (!/runWithCorrelationId\s*\(/.test(runner)) {
    add("worker.context", `${WORKER_RUNNER_FILE}: شوطُ المهمّةِ بلا سياقِ ارتباطٍ`);
  }

  // (٨) كلُّ موضعٍ موصولٍ مُعلَنٍ يلفُّ دعوتَه فعلاً.
  for (const site of CORRELATED_CALL_SITES) {
    const text = input.sources[site.file];
    if (text === undefined) {
      add("callsite.missing", `${site.file} غيرُ موجودٍ`);
      continue;
    }
    if (!text.includes("withRequestContext")) {
      add("callsite.unwrapped", `${site.file}: ${site.rpc} بلا withRequestContext`);
    }
    if (!text.includes(site.rpc)) {
      add("callsite.rpc", `${site.file}: لا يذكرُ ${site.rpc} — السجلُّ قديمٌ`);
    }
  }

  // (٩) موضعُ الضبطِ واحدٌ: `withRequestContext` لا تُعرَّفُ إلّا في ملفِّ القاعدةِ.
  //
  // **وملفُّ اختبارٍ خارجٌ عن هذه القاعدةِ بعلّتِها لا بالتخفيفِ**: أوّلُ تشغيلٍ
  // أوقعَها على `tests/unit/request-correlation-guard.test.ts` نفسِه، إذ يحملُ
  // **سالبةً مبذورةً** فيها نصُّ تعريفٍ ثانٍ داخلَ سَلسلةٍ حرفيّةٍ ليُثبِتَ أنَّ
  // القاعدةَ تُمسِكُه (`ح-7`). والعلّةُ المقصودةُ **مصدرُ حقيقةٍ ثانٍ يُنفَّذُ**:
  // دالّةٌ أخرى تفتحُ معاملةً وتُرسِلُ الضبطَ فتنحرفُ عن الأولى بتعديلٍ واحدٍ.
  // وسَلسلةٌ في اختبارٍ **لا تُنفَّذُ ولا تُستورَدُ**، فمنعُها منعٌ للشيءِ بغيرِ
  // علّتِه. والقاعدةُ تبقى نافذةً على كلِّ شيفرةٍ تُشتغَلُ — والسالبةُ المبذورةُ
  // تُمرِّرُ مسارَ إنتاجٍ فتُمسَكُ.
  for (const [path, text] of Object.entries(input.sources)) {
    if (path === DB_CONTEXT_FILE) continue;
    if (path.endsWith(".test.ts")) continue;
    if (/export\s+(async\s+)?function\s+withRequestContext\b/.test(text)) {
      add("context.duplicate", `${path}: تعريفٌ ثانٍ لـwithRequestContext`);
    }
  }

  // (١٠) السياقُ لا يُولِّدُ معرِّفاً في طبقةِ القاعدةِ: الغيابُ يبقى غياباً.
  const dbContext = input.sources[DB_CONTEXT_FILE];
  if (dbContext === undefined) {
    add("db.missing", `${DB_CONTEXT_FILE} غيرُ موجودٍ`);
  } else if (/newCorrelationId\s*\(|randomUUID\s*\(/.test(dbContext)) {
    add("db.fabricate", `${DB_CONTEXT_FILE}: يُولِّدُ معرِّفاً — الغيابُ يجبُ أن يبقى NULL`);
  }

  // (١١) كلُّ دالّةٍ تُنشِئُها هجرةُ الارتباطِ تُنزَعُ صلاحيّتُها من `public` صراحةً.
  //
  // **قاعدةٌ كتبَها حكمُ CI لا التخمينُ** (يُضافُ ولا يُمحى): أوّلُ نسخةٍ من
  // الهجرةِ نزعَت الصلاحيةَ من `anon` و`authenticated` وحدَهما، فأخفقَ اختبارُ
  // سطحِ الصلاحياتِ على PostgreSQL حقيقيّةٍ بحالتَينِ. والسببُ الجذريُّ:
  // PostgreSQL يمنحُ `execute` للدورِ `PUBLIC` **تلقائيّاً** عندَ إنشاءِ أيِّ
  // دالّةٍ، و`anon` يورِّثُ منه — **فنزعُ الصلاحيةِ من دورٍ لا يُبطِلُ منحةَ
  // `PUBLIC`**. وذاكَ عطبٌ لا يُرى في مراجعةٍ ولا في أخضرَ محلّيٍّ، ولا تُخفِقُ
  // به وحدةٌ: إنّما يُرى بمحرِّكٍ حقيقيٍّ. فيُثبَّتُ ههنا حاجزاً ساكناً كي
  // **لا تُدفَعَ دالّةٌ ثانيةٌ بالعطبِ عينِه** ولا يُنتظَرَ حكمُ CI ليقولَه.
  for (const match of input.migration.matchAll(
    /create\s+(or\s+replace\s+)?function\s+public\.([a-z_][a-z0-9_]*)\s*\(/gi,
  )) {
    const fn = match[2];
    if (fn === undefined) continue;
    const revoke = new RegExp(
      `revoke\\s+[^;]*on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+from\\s+[^;]*\\bpublic\\b`,
      "i",
    );
    if (!revoke.test(input.migration)) {
      add(
        "grant.public",
        `${fn}: لا نزعَ صريحاً من الدورِ public — منحةُ PUBLIC التلقائيّةُ تبقى ويورِّثُها anon`,
      );
    }
  }

  return findings;
}
