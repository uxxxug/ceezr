/**
 * الغرض: سِجلٌّ **مغلقٌ** لأفعالِ **الفاعلِ المُتسلِّطِ** (`admin` · `support`) التي
 *   يجبُ أن تُخلِّفَ أثراً في `audit_log`، ومعجمٌ مغلقٌ لأسماءِ أفعالِها — وقواعدُ
 *   محضةٌ تكشفُ دالَّةً مُتسلِّطةً **جديدةً** تكتبُ في المحرِّكِ بلا أثرٍ تدقيقيٍّ.
 * الحالة: منفَّذٌ فعليّاً — أُضيفَ في 2026-09-16 (`SEC-12` · الرِجلُ الخامسةُ من `F8-08`).
 * ينتمي إلى: scripts/lib
 * يُتوقَّعُ أن يستخدمَهُ: scripts/check-audit-actions.ts و
 *   tests/unit/check-audit-actions.test.ts.
 * الحاكم: ADR 0136 · `ح-7`
 *
 * ## الفجوةُ المُسمّاةُ التي يُغلِقُها هذا السِجلُّ
 *
 * نصُّ فجوةِ `SEC-12` في سِجلِّ الضوابطِ (`ADR 0133`): «لا سِجلَّ مغلقاً يقولُ **أيُّ**
 * الأفعالِ يجبُ أن تُدقَّقَ، ففعلٌ حسّاسٌ جديدٌ يمرُّ بلا أثرٍ ولا شيءَ يكشفُه».
 * والعِلّةُ أنَّ `audit_log` **موجودٌ ويُكتَبُ فيهِ في نحوِ خمسينَ دالَّةً** — فيُقرأُ
 * ذلكَ تغطيةً. **والعددُ ليسَ برهاناً**: مَن يكتبُ الدالَّةَ التاليةَ بلا إدراجٍ لا
 * يُخفِقُ اختباراً ولا يُخالِفُ نمطاً مكتوباً.
 *
 * ## ولِمَ **الاكتشافُ** من الهجراتِ لا القراءةُ من السِجلِّ
 *
 * حاجزٌ يفحصُ الدوالَّ **المُسجَّلةَ** يبقى فاحصاً للمعروفِ (`ADR 0135`). فالقياسُ
 * معكوسٌ: تُقرأُ **تعاريفُ الدوالِّ كلُّها من ملفّاتِ الهجراتِ** (آخرُ تعريفٍ لكلِّ
 * اسمٍ بترتيبِ الطابعِ الزمنيِّ، إذ `create or replace` يُبطِلُ ما قبلَه)، ثمَّ
 * تُنتَقى منها ما فيها **حُكمُ دورٍ مُتسلِّطٍ** وفيها **كتابةٌ**، ثمَّ تُطابَقُ
 * بالسِجلِّ. فدالَّةٌ مُتسلِّطةٌ كاتبةٌ غيرُ مُسجَّلةٍ تُسقِطُ البناءَ.
 *
 * ## والحُكمُ يُكتشَفُ **مُنابَاً** أيضاً لا مباشراً وحدَه
 *
 * أوّلُ صياغةٍ لهذا الحاجزِ فتَّشَت عن `role in ('admin','support')` في الجسمِ
 * **مباشرةً**، فسقطَ منها `claim_support_ticket` و`resolve_support_ticket` — وهما
 * يُوكِلانِ الحُكمَ إلى `is_support_actor(...)`. **وذاكَ ثقبٌ لا نقصٌ**: مَن كتبَ
 * دالَّةً مُتسلِّطةً جديدةً بالنائبِ نفسِه لأفلَتَ من الاكتشافِ كلِّه. فصارَ القياسُ
 * على مرحلتَينِ: تُستخرَجُ **نوّابُ الحُكمِ** (دالَّةٌ فيها حُكمُ دورٍ ولا تكتبُ)
 * ثمَّ تُعَدُّ كلُّ دالَّةٍ تنادي نائباً مُتسلِّطةً. **والنوّابُ مُكتشَفونَ لا
 * مكتوبونَ**، فنائبٌ جديدٌ لا يحتاجُ تعديلَ هذا الملفِّ.
 *
 * ## ولِمَ يُقفَلُ **معجمُ الأفعالِ** أيضاً
 *
 * وجودُ `insert into audit_log` لا يكفي: مَن كتبَ `'admin.updated'` لثلاثةِ أفعالٍ
 * مختلفةٍ خلَّفَ أثراً **لا يُميِّزُ الفعلَ** — وسِجلٌّ لا يُميِّزُ عدَّادٌ. فكلُّ
 * دالَّةٍ مُسجَّلةٍ تُعلِنُ أسماءَ أفعالِها، وكلُّ اسمٍ تكتبُهُ ولم تُعلِنْهُ خرقٌ.
 * وأمّا الاسمُ **المُركَّبُ** (`'support.ticket_' || p_action`) فمعجمُهُ مفتوحٌ
 * بطبيعتِه، فلا يُقبَلُ إلّا إذا كانَ نطاقُ لاحقتِهِ **محصوراً في الجسمِ نفسِه**
 * بـ`in (…)` — وإلّا صارَ العمودُ يقبلُ ما يُمرَّرُ.
 *
 * ## وما **لا** يُدَّعى ههنا — مُسمّىً لا مسكوتاً عنه
 *
 *   ١) **المحورُ هوَ التسلُّطُ لا الحساسيّةُ.** يُقاسُ فعلُ فاعلٍ على بياناتِ
 *      **غيرِه** أو على حالةِ المنصّةِ. وأفعالُ المستخدمِ على بياناتِ **نفسِه**
 *      خارجَ هذا الحاجزِ — وهيَ فجوةٌ باقيةٌ **مُسمّاةٌ**: `record_user_consent` و
 *      `update_driver_vehicle` و`update_driver_vehicle_assets` تكتبُ بلا أثرٍ
 *      تدقيقيٍّ، ولا يقولُ هذا الحاجزُ عنها شيئاً.
 *   ٢) **ولا يُدَّعى تدقيقُ كلِّ فرعٍ في الدالَّةِ المُسجَّلةِ.** مثالُهُ مقيسٌ:
 *      `consume_admin_login_code` يكتبُ أثراً عندَ **الرفضِ** ولا يكتبُ عندَ
 *      **النجاحِ** — والنجاحُ يُقرأُ من `admin.session_opened` في دالَّةٍ أخرى.
 *      والقاعدةُ ههنا «لكلِّ دالَّةٍ أثرٌ» لا «لكلِّ فرعٍ أثرٌ».
 *   ٣) **هذا قياسُ نصٍّ لا قياسُ أثرٍ.** أنَّ الإدراجَ مكتوبٌ في التعريفِ لا يُثبِتُ
 *      أنَّ صفّاً يُكتَبُ عندَ النجاحِ ولا أنَّهُ **لا يُكتَبُ عندَ الرفضِ**. ذاكَ
 *      يُقاسُ على قاعدةٍ حقيقيّةٍ في `tests/integration/audit-trail-authority.test.ts`
 *      — وهما برهانانِ يختلفانِ **في الجنسِ لا في الدرجةِ**، فلا يُغني أحدُهما.
 */

/** حُكمُ دورٍ مُتسلِّطٍ داخلَ جسمِ دالَّةٍ: `admin` أو `support` شرطاً على الفاعلِ. */
const PRIVILEGED_ROLE_MARKERS: readonly RegExp[] = [
  /\brole\s*(?:<>|=|!=)\s*'(?:admin|support)'/i,
  /\brole\s+not\s+in\s*\([^)]*'(?:admin|support)'/i,
  /\brole\s+in\s*\([^)]*'(?:admin|support)'/i,
];

/** كتابةٌ في المحرِّكِ. قراءةٌ محضةٌ ليسَت فعلاً يُدقَّقُ. */
const WRITE_MARKERS: readonly RegExp[] = [
  /\binsert\s+into\s+/i,
  /\bupdate\s+[a-z_]+\s+set\b/i,
  /\bdelete\s+from\s+/i,
];

const AUDIT_INSERT_MARKER = /\binsert\s+into\s+audit_log\b/i;

/** اسمُ فعلٍ يُركَّبُ من لاحقةٍ مُمرَّرةٍ: معجمُهُ مفتوحٌ حتّى يُحصَرَ في الجسمِ. */
export interface ComposedActionName {
  /** البادئةُ الحرفيّةُ قبلَ `||`. */
  readonly prefix: string;
  /** اللواحقُ المسموحةُ — يجبُ أن تُحصَرَ بـ`in (…)` في جسمِ الدالَّةِ نفسِه. */
  readonly suffixes: readonly string[];
}

export interface AuditedPrivilegedAction {
  /** اسمُ الدالَّةِ في `public`. */
  readonly fn: string;
  /** معجمُ أسماءِ الأفعالِ الحرفيّةِ المُعلَنِ لهذهِ الدالَّةِ — مغلقٌ. */
  readonly actions: readonly string[];
  /** إن كانَ الاسمُ مُركَّباً: بادئتُهُ ولواحقُهُ المحصورةُ. */
  readonly composed?: ComposedActionName;
}

/**
 * السِجلُّ المغلقُ. **كلُّ دالَّةٍ مُتسلِّطةٍ كاتبةٍ جديدةٍ يجبُ أن تُضافَ ههنا**،
 * وحينَ تُضافُ يَلزَمُها إدراجٌ في `audit_log` باسمِ فعلٍ مُعلَنٍ — فالتسجيلُ
 * **التزامٌ لا إعفاءٌ**.
 */
export const AUDITED_PRIVILEGED_ACTIONS: readonly AuditedPrivilegedAction[] = [
  {
    fn: "review_account_recovery_request",
    actions: ["admin.account_recovery_approved", "admin.account_recovery_rejected"],
  },
  { fn: "admin_revoke_miniapp_sessions", actions: ["admin.miniapp_sessions_revoked"] },
  {
    fn: "admin_set_driver_verification",
    actions: ["admin.driver_verification_changed", "admin.trial_auto_started"],
  },
  { fn: "admin_set_user_blocked", actions: ["admin.user_blocked_changed"] },
  { fn: "admin_update_city_group_ids", actions: ["admin.city_group_ids_updated"] },
  { fn: "admin_update_setting", actions: ["admin.setting_updated"] },
  { fn: "cancel_broadcast", actions: ["broadcast.canceled"] },
  { fn: "consume_admin_login_code", actions: ["admin.login_code_rejected"] },
  { fn: "create_broadcast", actions: ["broadcast.created"] },
  { fn: "flag_rating", actions: ["rating.flagged"] },
  { fn: "grant_bootstrap_admin", actions: ["identity.bootstrap_admin_granted"] },
  { fn: "issue_admin_login_code", actions: ["admin.login_code_issued"] },
  { fn: "open_admin_session", actions: ["admin.session_opened"] },
  { fn: "refund_subscription_payment", actions: ["subscription_payment.refunded"] },
  {
    fn: "settle_subscription_wallet_system_error",
    actions: ["subscription_wallet.system_error_settled"],
  },
  { fn: "top_up_subscription_wallet", actions: ["subscription_wallet.topped_up"] },
  { fn: "claim_support_ticket", actions: ["support.ticket_claimed"] },
  {
    // اسمٌ مُركَّبٌ: `'support.ticket_' || p_action`. ولا يمرُّ إلّا لأنَّ نطاقَ
    // اللاحقةِ محصورٌ في الجسمِ بـ`p_action not in ('activate','terminate','reject')`.
    fn: "resolve_support_ticket",
    actions: [],
    composed: { prefix: "support.ticket_", suffixes: ["activate", "terminate", "reject"] },
  },
  // أُضيفَ أثرُهما في هجرةِ 20260916210000: كانا **الاستثناءَ الوحيدَ** بينَ دوالِّ
  // الفاعلِ المُتسلِّطِ الكاتبةِ — وهما فعلانِ على بلاغِ استغاثةٍ، أحدُهما يُغلِقُ
  // البلاغَ وقد يحظِرُ المُبلِّغَ. راجع ADR 0136.
  { fn: "claim_safety_incident", actions: ["safety.incident_claimed"] },
  { fn: "resolve_safety_incident", actions: ["safety.incident_resolved"] },
];

export interface AuditExemption {
  readonly fn: string;
  /** سببٌ مكتوبٌ. إعفاءٌ بلا سببٍ خرقٌ — وإلّا صارَ السِجلُّ بابَ إسكاتٍ. */
  readonly reason: string;
}

/**
 * الإعفاءاتُ. **قصيرةٌ بقصدٍ**: كلُّ اسمٍ ههنا نقصٌ مُعلَنٌ في الأثرِ التدقيقيِّ،
 * لا نمطٌ يُقتدى بهِ. ومَن أرادَ الإضافةَ فعليهِ السببُ لا الحاجةُ.
 */
export const AUDIT_EXEMPT_PRIVILEGED_FUNCTIONS: readonly AuditExemption[] = [
  {
    fn: "touch_admin_session",
    reason:
      "تمديدُ عمرِ جلسةِ المسؤولِ نفسِه على كلِّ طلبٍ — فعلٌ على بياناتِ الفاعلِ ذاتِه " +
      "لا على غيرِه، ويقعُ آلافَ المرّاتِ في الجلسةِ الواحدةِ. وتدقيقُه يُغرِقُ " +
      "السِجلَّ بضجيجٍ يُخفي الأفعالَ الحقيقيّةَ — وسِجلٌّ لا يُقرأُ ليسَ سِجلَّاً. " +
      "وفتحُ الجلسةِ مُدقَّقٌ (admin.session_opened)، فبدايةُ النفاذِ مكتوبةٌ.",
  },
];

/**
 * عددُ الدوالِّ المُسجَّلةِ **كنصِّ بندٍ** لا كطولِ مصفوفةٍ: لو قُرِئَ من
 * `AUDITED_PRIVILEGED_ACTIONS.length` لصارَ السِجلُّ يحرسُ نفسَه فلا يحرسُ شيئاً.
 */
export const REQUIRED_AUDITED_FUNCTION_COUNT = 20;

/** وعددُ الإعفاءاتِ كذلكَ: نموُّهُ خفيةً هوَ بعينِه ما يُخشى. */
export const REQUIRED_EXEMPTION_COUNT = 1;

/** تعريفُ دالَّةٍ كما قُرِئَ من ملفِّ هجرةٍ. */
export interface FunctionDefinitionFacts {
  readonly fn: string;
  /** ملفُّ الهجرةِ الذي فيهِ **آخرُ** تعريفٍ لهذا الاسمِ. */
  readonly migration: string;
  /** نصُّ التعريفِ كما هوَ. */
  readonly body: string;
}

export interface AuditViolation {
  readonly rule:
    | "registry.declared-count-drifted"
    | "discovery.privileged-writer-unregistered"
    | "registry.function-not-found"
    | "registry.function-not-privileged-writer"
    | "writer.no-audit-insert"
    | "action.written-but-undeclared"
    | "action.declared-but-unwritten"
    | "action.composed-domain-not-closed"
    | "exemption.without-reason"
    | "exemption.function-does-audit";
  readonly detail: string;
}

export function hasDirectPrivilegedCheck(body: string): boolean {
  return PRIVILEGED_ROLE_MARKERS.some((marker) => marker.test(body));
}

export function writesToEngine(body: string): boolean {
  return WRITE_MARKERS.some((marker) => marker.test(body));
}

export function writesAuditRow(body: string): boolean {
  return AUDIT_INSERT_MARKER.test(body);
}

/**
 * نوّابُ الحُكمِ: دالَّةٌ فيها حُكمُ دورٍ مُتسلِّطٍ **ولا تكتبُ** — فهيَ مُحكِّمٌ
 * تُنادى، لا فعلٌ يُدقَّقُ. تُكتشَفُ ولا تُكتَبُ، فنائبٌ جديدٌ لا يُفلِتُ.
 */
export function privilegedDelegates(
  definitions: readonly FunctionDefinitionFacts[],
): readonly string[] {
  return definitions
    .filter(
      (definition) => hasDirectPrivilegedCheck(definition.body) && !writesToEngine(definition.body),
    )
    .map((definition) => definition.fn);
}

/** أيُحكَمُ في هذهِ الدالَّةِ بدورٍ مُتسلِّطٍ — مباشرةً أو بنائبٍ؟ */
export function isPrivilegedActorFunction(body: string, delegates: readonly string[]): boolean {
  if (hasDirectPrivilegedCheck(body)) return true;
  return delegates.some((delegate) => new RegExp(`\\b${delegate}\\s*\\(`).test(body));
}

/**
 * أسماءُ الأفعالِ الحرفيّةُ المكتوبةُ في جسمِ دالَّةٍ. تُقرأُ من أوّلِ حرفيٍّ على
 * صورةِ `'نطاق.فعل'` بعدَ `insert into audit_log (…) values (…`، وهوَ موضعُ `action`
 * في ترتيبِ `city_id, actor_user_id, action, …` المُعتمَدِ في المستودَعِ كلِّه.
 */
export function writtenActionNames(body: string): readonly string[] {
  const names: string[] = [];
  const pattern =
    /insert\s+into\s+audit_log\s*\([^)]*\)\s*(?:select|values)?\s*\(?[^;]*?'([a-z_]+\.[a-z_]*)'/gi;
  for (const match of body.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

/** أيُحصَرُ نطاقُ لاحقةٍ في الجسمِ نفسِه بـ`in (…)`؟ */
function suffixDomainClosed(body: string, suffixes: readonly string[]): boolean {
  return suffixes.every((suffix) => new RegExp(`\\bin\\s*\\([^)]*'${suffix}'`, "i").test(body));
}

/**
 * القواعدُ. لا تلمسُ قرصاً ولا محرِّكاً — تُغذّى بحقائقَ فتُعيدُ خرقاً، فتُزرَعُ لها
 * السالباتُ في اختبارِ الوحدةِ (`ح-7`).
 */
export function auditActionViolations(
  definitions: readonly FunctionDefinitionFacts[],
): readonly AuditViolation[] {
  const violations: AuditViolation[] = [];

  // ٠. العددُ المُعلَنُ يُطابِقُ السِجلَّ: نموٌّ صامتٌ في أيِّ الجهتَينِ يُسقِطُ البناءَ.
  if (AUDITED_PRIVILEGED_ACTIONS.length !== REQUIRED_AUDITED_FUNCTION_COUNT) {
    violations.push({
      rule: "registry.declared-count-drifted",
      detail:
        `السِجلُّ فيهِ ${AUDITED_PRIVILEGED_ACTIONS.length} دالَّةً والبندُ يقولُ ` +
        `${REQUIRED_AUDITED_FUNCTION_COUNT} — يُحدَّثُ نصُّ البندِ مع الدليلِ لا يُقرأُ من الطولِ.`,
    });
  }
  if (AUDIT_EXEMPT_PRIVILEGED_FUNCTIONS.length !== REQUIRED_EXEMPTION_COUNT) {
    violations.push({
      rule: "registry.declared-count-drifted",
      detail:
        `الإعفاءاتُ ${AUDIT_EXEMPT_PRIVILEGED_FUNCTIONS.length} والبندُ يقولُ ` +
        `${REQUIRED_EXEMPTION_COUNT} — ونموُّ الإعفاءاتِ خفيةً هوَ ما يُخشى.`,
    });
  }

  const registered = new Map(AUDITED_PRIVILEGED_ACTIONS.map((entry) => [entry.fn, entry]));
  const exempt = new Map(AUDIT_EXEMPT_PRIVILEGED_FUNCTIONS.map((entry) => [entry.fn, entry]));
  const onDisk = new Map(definitions.map((definition) => [definition.fn, definition]));
  const delegates = privilegedDelegates(definitions);

  // ١. الاكتشافُ أوّلاً: دالَّةٌ مُتسلِّطةٌ كاتبةٌ ليسَت في السِجلِّ ولا في الإعفاءاتِ.
  for (const definition of definitions) {
    if (!isPrivilegedActorFunction(definition.body, delegates)) continue;
    if (!writesToEngine(definition.body)) continue;
    if (registered.has(definition.fn) || exempt.has(definition.fn)) continue;
    violations.push({
      rule: "discovery.privileged-writer-unregistered",
      detail:
        `${definition.fn} (${definition.migration}): دالَّةٌ تحكُمُ بدورٍ مُتسلِّطٍ وتكتبُ في ` +
        "المحرِّكِ وليسَت في سِجلِّ الأفعالِ المُدقَّقةِ — فلا شيءَ يُوجِبُ عليها أثراً. " +
        "تُسجَّلُ في AUDITED_PRIVILEGED_ACTIONS، أو تُعفى بسببٍ مكتوبٍ.",
    });
  }

  for (const entry of AUDITED_PRIVILEGED_ACTIONS) {
    const definition = onDisk.get(entry.fn);
    // ٢. اسمٌ مُسجَّلٌ لا تعريفَ لهُ: السِجلُّ يصيرُ حرفاً ميّتاً يُقرأُ تغطيةً.
    if (definition === undefined) {
      violations.push({
        rule: "registry.function-not-found",
        detail: `${entry.fn}: مُسجَّلٌ ولا تعريفَ لهُ في أيِّ هجرةٍ — سِجلٌّ يعِدُ بما لا وجودَ لهُ.`,
      });
      continue;
    }
    // ٣. مُسجَّلٌ لكنَّهُ ليسَ فاعلاً مُتسلِّطاً كاتباً: سُحِبَ حُكمُ الدورِ أو الكتابةُ،
    //    فيبقى «مُدقَّقاً» بالاسمِ. وبلا هذهِ القاعدةِ يُنزَعُ الحُكمُ بلا كاشفٍ.
    if (
      !isPrivilegedActorFunction(definition.body, delegates) ||
      !writesToEngine(definition.body)
    ) {
      violations.push({
        rule: "registry.function-not-privileged-writer",
        detail:
          `${entry.fn} (${definition.migration}): مُسجَّلٌ في أفعالِ الفاعلِ المُتسلِّطِ ولكنَّ ` +
          "تعريفَهُ لا يحكُمُ بدورٍ مُتسلِّطٍ (مباشرةً ولا بنائبٍ) أو لا يكتبُ — إمّا سُحِبَ " +
          "الحُكمُ فيجبُ ردُّه، أو تغيَّرَ الفعلُ فيجبُ نقلُهُ من السِجلِّ صراحةً.",
      });
      continue;
    }
    // ٤. لا إدراجَ في `audit_log`: فعلٌ مُتسلِّطٌ بلا أثرٍ.
    if (!writesAuditRow(definition.body)) {
      violations.push({
        rule: "writer.no-audit-insert",
        detail:
          `${entry.fn} (${definition.migration}): لا إدراجَ في audit_log — فعلُ فاعلٍ مُتسلِّطٍ ` +
          "لا يُخلِّفُ أثراً، فلا يُعرَفُ مَن فعلَ ولا متى ولا على مَن.",
      });
      continue;
    }
    const composed = entry.composed;
    if (composed !== undefined) {
      // ٥. اسمٌ مُركَّبٌ نطاقُ لاحقتِهِ غيرُ محصورٍ في الجسمِ: العمودُ يقبلُ ما يُمرَّرُ،
      //    فالمعجمُ مفتوحٌ وإن بدا مُسجَّلاً.
      if (!suffixDomainClosed(definition.body, composed.suffixes)) {
        violations.push({
          rule: "action.composed-domain-not-closed",
          detail:
            `${entry.fn}: اسمُ الفعلِ مُركَّبٌ ('${composed.prefix}' || …) ولواحقُهُ المُعلَنةُ ` +
            `(${composed.suffixes.join(" · ")}) غيرُ محصورةٍ بـin (…) في الجسمِ — ` +
            "فيقبلُ عمودُ الفعلِ ما يُمرَّرُ، ومعجمٌ مفتوحٌ سِجلٌّ لا يُميِّزُ.",
        });
      }
      if (!definition.body.includes(`'${composed.prefix}'`)) {
        violations.push({
          rule: "action.declared-but-unwritten",
          detail: `${entry.fn}: يُعلِنُ بادئةً مُركَّبةً '${composed.prefix}' ولا يكتبُها في تعريفِه.`,
        });
      }
      continue;
    }
    const written = writtenActionNames(definition.body);
    // ٦. اسمُ فعلٍ مكتوبٌ غيرُ مُعلَنٍ: المعجمُ يُقفَلُ وإلّا صارَ الأثرُ لا يُميِّزُ.
    for (const name of written) {
      if (!entry.actions.includes(name)) {
        violations.push({
          rule: "action.written-but-undeclared",
          detail:
            `${entry.fn}: يكتبُ الفعلَ '${name}' وهوَ غيرُ مُعلَنٍ في سِجلِّه ` +
            `(المُعلَنُ: ${entry.actions.join(" · ")}) — ومعجمٌ مفتوحٌ سِجلٌّ لا يُميِّزُ.`,
        });
      }
    }
    // ٧. اسمٌ مُعلَنٌ غيرُ مكتوبٍ: الحدُّ الآخرُ. وبلا هذا يُعلَنُ ما لا يُكتَبُ فيُقرأُ
    //    السِجلُّ أوسعَ من الأثرِ الحقيقيِّ.
    for (const name of entry.actions) {
      if (!written.includes(name)) {
        violations.push({
          rule: "action.declared-but-unwritten",
          detail:
            `${entry.fn}: يُعلِنُ الفعلَ '${name}' ولا يكتبُهُ في تعريفِه — ` +
            "فيُقرأُ السِجلُّ أوسعَ من الأثرِ الحقيقيِّ.",
        });
      }
    }
  }

  for (const exemption of AUDIT_EXEMPT_PRIVILEGED_FUNCTIONS) {
    // ٨. إعفاءٌ بلا سببٍ مكتوبٍ: بابُ إسكاتٍ لا سِجلُّ نقصٍ.
    if (exemption.reason.trim().length < 40) {
      violations.push({
        rule: "exemption.without-reason",
        detail:
          `${exemption.fn}: إعفاءٌ بلا سببٍ مكتوبٍ كافٍ — والإعفاءُ بلا سببٍ ` +
          "بابُ إسكاتٍ يُمحى بهِ الأثرُ بلا مسؤولٍ.",
      });
    }
    const definition = onDisk.get(exemption.fn);
    // ٩. إعفاءٌ بائتٌ: الدالَّةُ صارَت تُدقِّقُ فعلاً، فالإعفاءُ يُوهِمُ نقصاً زائلاً.
    if (definition !== undefined && writesAuditRow(definition.body)) {
      violations.push({
        rule: "exemption.function-does-audit",
        detail:
          `${exemption.fn}: مُعفىً وهوَ يكتبُ في audit_log فعلاً — يُنقَلُ إلى السِجلِّ، ` +
          "إذ إعفاءٌ بائتٌ يُوهِمُ نقصاً زالَ ويُخفي أثراً موجوداً.",
      });
    }
  }

  return violations;
}

export function describeAuditViolation(violation: AuditViolation): string {
  return `  · [${violation.rule}] ${violation.detail}`;
}
