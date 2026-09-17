/**
 * الغرض: سِجلٌّ **مغلقٌ** لضوابطِ `F8-08` الستّةَ عشرَ، وقواعدُ نقيّةٌ تُحاسِبُه.
 * الحالة: منفَّذٌ فعليّاً — مِعيارُ إغلاقٍ، لا منطقُ أعمالٍ ولا ضابطُ أمنٍ بنفسِه.
 * ينتمي إلى: scripts/lib
 * يُستخدَمُ من: scripts/check-security-controls.ts · tests/unit/check-security-controls.test.ts
 * الحاكم: ADR 0133 · البند `F8-08`
 *
 * ## لِمَ سِجلٌّ، ولِمَ الآنَ
 *
 * نصُّ `F8-08` في `docs/ROADMAP-MASTER.md` §12 حرفاً: «**16 ضابط أمن**، وأهمها
 * التفويض على مستوى الكائن في كل مسار». وفُتِّشَ المستودَعُ كلُّه عن قائمةِ هذهِ
 * الستّةَ عشرَ يومَ 2026-09-16 — **فلا وجودَ لها**: لا في الخارطةِ، ولا في
 * `SYSTEM_STATE`، ولا في `docs/adr/`، ولا في حاجزٍ.
 *
 * **وذاكَ عيبٌ في شرطِ الإغلاقِ لا نقصُ توثيقٍ.** بندٌ يُقاسُ إتمامُه بعددٍ لا
 * قائمةَ لهُ لا يُمكِنُ إغلاقُه بصدقٍ، **ولا يُمكِنُ الطعنُ في دعوى إغلاقِه**:
 * يبني مُنفِّذٌ ثلاثةَ ضوابطَ ويقولُ «الستّةَ عشرَ» ولا نصَّ يردُّه. والحُكمُ بلا
 * مِعيارٍ مكتوبٍ ليسَ حُكماً.
 *
 * ## وما لا يفعلُه هذا الملفُّ
 *
 * **لا يُؤمِّنُ سطراً واحداً.** تسميةُ الضابطِ ليسَت بناءَه، وقائمةٌ مكتوبةٌ لا
 * تردُّ هجوماً. المُدَّعى الوحيدُ أنَّ دعوى الإغلاقِ صارَت **قابلةً للطعنِ
 * آليّاً**، وأنَّ رمزَ البندِ لا يُرفَعُ بيدٍ.
 *
 * ## ومن أينَ جاءَت الستّةَ عشرَ
 *
 * **لم تُختَرَع**: قُرِئَت من الأعمالِ القائمةِ في المستودَعِ ومن العوائقِ
 * المُعلَنةِ. وكلُّ ضابطٍ حالُه ودليلُه **مقيسانِ** لا مُقدَّرانِ — ومن ادَّعى
 * `built` بلا ملفِّ دليلٍ وحاجزٍ موجودَينِ على القرصِ أسقطَ البناءَ.
 */

/** حالُ الضابطِ — ثلاثةٌ لا أكثرُ، وكلُّ زيادةٍ عليها تُميِّعُ الحُكمَ. */
export type ControlState = "built" | "partial" | "not-built";

/** العددُ المفروضُ بنصِّ البندِ. لا يُقرأُ من طولِ المصفوفةِ — وإلّا لَحَرَسَ نفسَه. */
export const REQUIRED_CONTROL_COUNT = 16;

/** أقلُّ طولٍ لحيثيّةِ الحالِ: «مبنيٌّ» و«TODO» ليسا حيثيّةً. */
export const MIN_RATIONALE_LENGTH = 40;

export interface SecurityControl {
  /** معرِّفٌ ثابتٌ — يُحالُ إليهِ من الأدلّةِ، فلا يُعادُ ترقيمُه. */
  readonly id: string;
  /** اسمُ الضابطِ بالعربيّةِ. */
  readonly name: string;
  readonly state: ControlState;
  /**
   * حيثيّةُ الحالِ: **لِمَ هوَ كذلكَ**، لا وصفُه. وفي `partial` و`not-built`
   * يُشتَرَطُ أن تُسمّى الفجوةُ بعينِها.
   */
  readonly rationale: string;
  /**
   * مسارُ ملفِّ دليلٍ على القرصِ. **إلزاميٌّ متى كانَ الحالُ `built`.**
   * وفي غيرِه يُقبَلُ `null` — دعوى بلا دليلٍ أشرفُ من دليلٍ بلا دعوى.
   */
  readonly evidence: string | null;
  /**
   * مسارُ ملفٍّ **يقيسُ الفجوةَ** لا يُثبِتُ البناءَ — لِـ`partial` و`not-built`
   * وحدَهما. وحقلٌ منفصلٌ عن `evidence` عن قصدٍ: `evidence` دعوى بناءٍ تُشترى
   * بها ثقةٌ، وهذا **إقرارٌ مقيسٌ بما لا يفعلُه الضابطُ**. ودمجُهما يُحوِّلُ
   * الإقرارَ إلى دعوى بمرورِ الوقتِ، ومنعُ الإقرارِ رأساً يُبقي الفجوةَ موصوفةً
   * لا مقيسةً — وكلا الأمرَينِ خسارةٌ.
   */
  readonly gapMeasurement?: string | null;
  /** مسارُ حاجزٍ آليٍّ يحرسُه على القرصِ. **إلزاميٌّ متى كانَ `built`.** */
  readonly guard: string | null;
  /** مالكٌ من قائمةٍ مغلقةٍ — عائقٌ بلا مالكٍ لا يُغلَقُ أبداً. */
  readonly owner: "منفّذ المستودع" | "مالك المشروع" | "بنية تحتية (F9)";
  /** معرِّفُ عائقٍ أو قرارٍ يمنعُ البناءَ، متى كانَ المانعُ خارجَ المستودَعِ. */
  readonly blockedBy: string | null;
}

export const SECURITY_CONTROLS: readonly SecurityControl[] = [
  {
    id: "SEC-01",
    name: "التفويضُ على مستوى الكائنِ في كلِّ مسارٍ",
    state: "built",
    rationale:
      "الضابطُ الذي يُسمّيهِ نصُّ البندِ «أهمَّها». حاجزٌ ساكنٌ يقرأُ شجرَ المساراتِ كاملاً (٢٥ مساراً — ١٦ مُقيَّداً بالناظرِ · ٩ مُستثنىً بصنفِه وسببِه ودليلِه)، وتكاملٌ على PostgreSQL حقيقيٍّ يُثبِتُ أنَّ اثنتَي عشرةَ دالّةً تَرُدُّ غيرَ المالكِ، وأنَّ ردَّ الغريبِ يطابقُ ردَّ المعدومِ حرفاً فلا يُعَدُّ المسارُ عدّادَ وجودٍ، وأنَّ الكاتباتِ لا تُغيِّرُ صفّاً.",
    evidence: "docs/evidence/security/F8-08-20260916.md",
    guard: "scripts/check-object-authorization.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-02",
    name: "لا سرَّ ولا بيانٌ شخصيٌّ في سجلٍّ",
    state: "built",
    rationale:
      "شرطٌ صريحٌ في `F1-03` و`F8-03`: السجلُّ أوسعُ سطحِ تسريبٍ لأنَّهُ يُنسَخُ ويُصدَّرُ ويُقرأُ بأعينٍ كثيرةٍ، ورقمُ هاتفٍ فيهِ يعيشُ أطولَ من الصفِّ الذي جاءَ منه. يحرسُه حاجزانِ: منعُ تسجيلِ السرِّ، وهيكلةُ السجلِّ بحقولٍ مُصرَّحةٍ.",
    evidence: "docs/evidence/architecture/F1-03-20260827.md",
    guard: "scripts/check-secret-logging.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-03",
    name: "مرجعيّةُ الدورِ من الخادمِ لا من العميلِ",
    state: "built",
    rationale:
      "`F1-05`: الدورُ يُقرأُ من القاعدةِ لا من حمولةٍ يُرسِلُها العميلُ. ودورٌ يُقرَّرُ في المتصفِّحِ ليسَ دوراً بل اقتراحاً، ومَن يقترحُ دورَه يقترحُ صلاحيّتَه.",
    evidence: "docs/evidence/architecture/F1-05-20260828.md",
    guard: "scripts/check-viewer-role-authority.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-04",
    name: "سياسةُ تخزينِ الجلسةِ",
    state: "built",
    rationale:
      "`F1-04`: مكانُ الرمزِ وعمرُه وحدودُه مفروضةٌ بحاجزٍ لا بعُرفٍ، فلا يُودَعُ في مخزنٍ يقرؤُه نصٌّ ثالثٌ ولا يُعمَّرُ بلا حدٍّ.",
    evidence: "docs/evidence/architecture/F1-04-20260828.md",
    guard: "scripts/check-session-storage-policy.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-05",
    name: "حدُّ الصادرِ: لا نداءَ خارجيَّ بلا إذنٍ مكتوبٍ",
    state: "built",
    rationale:
      "`W-6` · `ADR 0084`: كلُّ مضيفٍ خارجيٍّ مأذونٌ لهُ بسندٍ، وما عداهُ يُسقِطُ البناءَ. وسطحُ الصادرِ سطحُ تسريبٍ كسطحِ الواردِ تماماً — بياناتُنا تخرجُ منهُ لا تدخلُ.",
    evidence: "docs/evidence/architecture/W-6-runtime-20260912.md",
    guard: "scripts/check-egress-boundary.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-06",
    name: "ترويساتُ أمنٍ للصفحاتِ العامّةِ ولوحةِ الإدارةِ",
    // تصحيحٌ بالإضافةِ (`ح-8`) — 2026-09-16: كانَ حالُه `partial` بحيثيّةٍ
    // نصُّها: «لا حاجزَ آليَّ يمنعُ صفحةً عامّةً جديدةً من أن تُركَّبَ بلا
    // الوسيطِ». وكانَت تلكَ الفجوةُ **مقيسةً صادقةً يومَها** — بل كانَ الوسيطُ
    // مُركَّباً **بشرطٍ** فعلاً — ثمَّ سُدَّت بـ`ADR 0135`. والدعوى القديمةُ
    // محفوظةٌ ههنا لا ممحوّةٌ.
    state: "built",
    rationale:
      "وسيطانِ منفصلانِ قائمانِ فعلاً (`apps/gateway/src/public/security-headers.ts` و`admin/security-headers.ts`) بسياسةِ محتوىً بـ`nonce` ومنعِ تأطيرٍ وفهرسةٍ وكتمِ مُحيلٍ. **والحاجزُ معكوسُ القياسِ**: تُكتشَفُ أسطحُ الصفحاتِ من القرصِ (كلُّ وحدةِ توجيهٍ تُصيِّرُ HTML) ثمَّ تُطابَقُ بسِجلٍّ مغلقٍ، فسطحٌ جديدٌ غيرُ مُسجَّلٍ يُسقِطُ البناءَ، ويُمنَعُ التركيبُ **بشرطٍ** لا التركيبُ وحدَه. **ومقيسٌ بالردِّ**: كلُّ ترويسةٍ واجبةٍ تُقرأُ حاضرةً على ردٍّ فعليٍّ من الموجِّهِ الحقيقيِّ في حالِ «غيرِ موجودٍ» — وهيَ أشيعُ ردٍّ. **ولا يُدَّعى `Strict-Transport-Security`**: يُنهيهِ الوسيطُ العكسيُّ — بنيةٌ تحتيّةٌ لا شيفرةٌ، وتلكَ فجوةٌ باقيةٌ مُسمّاةٌ لا مسكوتٌ عنها.",
    evidence: "docs/evidence/security/SEC-06-20260916.md",
    guard: "scripts/check-security-headers.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-07",
    name: "تحديدُ المعدَّلِ على المساراتِ المكشوفةِ",
    // تصحيحٌ بالإضافةِ (`ح-8`) — 2026-09-17: كانَ حالُه `partial` بحيثيّةٍ نصُّها:
    // «نافذةٌ ثابتةٌ قائمةٌ (`apps/gateway/src/rate-limit/fixed-window.ts`) مُركَّبةٌ
    // على الويبهوكِ وموقعِ السائقِ. **والفجوةُ بعينِها**: لا سِجلَّ يقولُ أيُّ مسارٍ
    // يجبُ أن يكونَ محدوداً، فمسارٌ جديدٌ يُولَدُ بلا حدٍّ ولا شيءَ يكشفُه؛ والعدُّ
    // في ذاكرةِ المثيلِ فلا يصمدُ لمثيلَينِ». وكانَت تلكَ الفجوةُ **مقيسةً صادقةً
    // يومَها** — بل أثبتَ سدُّها عيباً حقيقيّاً كانَ قائماً: مساراتُ مركبةِ السائقِ
    // كانَت تُخدَمُ على الجِذرِ لا على `/v1/driver/vehicle`. والدعوى القديمةُ محفوظةٌ
    // ههنا لا ممحوّةٌ.
    state: "built",
    rationale:
      "الاكتشافُ **معكوسٌ** (`ADR 0139`): تُقرأُ المساراتُ المكشوفةُ من القرصِ (93 مساراً · 0 خللٍ في الجردِ) ثمَّ تُطابَقُ بسِجلِّ سياساتٍ مغلقٍ — 10 مساراً في أصنافٍ يُوجَبُ فيها حدٌّ: 8 محدودةٌ بقيمةٍ ونافذةٍ وبُعدِ مفتاحٍ وموضعِ توصيلٍ مقروءٍ من الملفِّ، و3 مُعفاةٌ بسببٍ مكتوبٍ ومالكٍ (إنفاذُها في القاعدةِ). فمسارٌ جديدٌ غيرُ مُصنَّفٍ يُسقِطُ البناءَ. والإنفاذُ **مقيسٌ على الردِّ** لا على السِجلِّ: `429` برأسِ `Retry-After` من موجِّهاتٍ حقيقيّةٍ، والفحصُ قبلَ بوّابةِ التهيئةِ. والعدُّ يخرُجُ من العمليّةِ إلى الخادمِ متى كانَ `SESSION_STORE=redis` (`ADR 0011`) — ونسختانِ تتقاسمانِ نافذةً واحدةً مقيسٌ على Redis حقيقيٍّ بضبطٍ موجبٍ معكوسٍ يُظهِرُ ضِعفَ الحدِّ على حاصرِ الذاكرةِ. **وما لا يُدَّعى**: حاصرُ الذاكرةِ في التهيئةِ أُحاديّةِ المخزنِ يبقى ضِعفَ المُعلَنِ بعددِ النسخِ، وهوَ مكتوبٌ في السياسةِ لا مسكوتٌ عنه.",
    evidence: "docs/evidence/security/SEC-07-20260917.md",
    guard: "scripts/check-rate-limit-coverage.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-08",
    name: "تحقُّقُ الويبهوكِ بسرٍّ مُوقَّعٍ",
    state: "built",
    rationale:
      "`secretsMatch` على `/webhook/telegram/:bot` قبلَ أيِّ عملٍ، ورفضُ حمولةٍ بلا `update_id` صالحٍ قبلَ الإيداعِ الصامدِ — فلا يُعالَجُ ما لم يُثبَت أنَّهُ من تيليجرام. وهوَ أحدُ أصنافِ الاستثناءِ الثلاثةِ المُسجَّلةِ في `SEC-01`.",
    evidence: "docs/evidence/correctness/webhook-invalid-update-guard-20260908.md",
    guard: "scripts/check-object-authorization.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-09",
    name: "حراسةُ لوحةِ الإدارةِ ورمزُ `CSRF`",
    // تصحيحٌ بالإضافةِ (`ح-8`) — 2026-09-16: كانَ حالُه `partial` بحيثيّةٍ
    // نصُّها: «الحارسُ مقيسٌ بوجودِه نصّاً في حاجزِ SEC-01 لا بسلوكِه على
    // قاعدةٍ — لا اختبارَ تكاملٍ يُنادي مساراً إداريّاً بلا جلسةٍ ويقيسُ
    // الرفضَ، ولا يُقاسُ رفضُ رمزِ CSRF المزوَّرِ». وكانَت تلكَ الفجوةُ
    // **مقيسةً صادقةً يومَها**، ثمَّ سُدَّت بـ`ADR 0134` — والدعوى القديمةُ
    // محفوظةٌ ههنا لا ممحوّةٌ.
    state: "built",
    rationale:
      '`createAdminGuard` على `app.use("*")` يغطّي مساراتِ اللوحةِ كلَّها، ورمزُ `CSRF` مُشتَقٌّ من بصمةِ الجلسةِ ويُقارَنُ بزمنٍ ثابتٍ. **ومقيسٌ بالسلوكِ لا بالتركيبِ** على PostgreSQL حقيقيٍّ: جلسةٌ مُبطَلةٌ ومنقضيةٌ ومَن نُزِعَت عنهُ الصفةُ (**وتُبطَلُ جلستُه في الصفِّ** لا يُرَدُّ وحسبُ) ومَن حُظِرَ — كلُّها تُرَدُّ؛ وراكبٌ لا تُفتَحُ لهُ جلسةٌ أصلاً (`NOT_ADMIN` من المحرِّكِ). وثلاثُ حالاتِ كتابةٍ مرفوضةٍ **تُقاسُ بالأثرِ**: الصفُّ قبلَ النداءِ يُساوي ما بعدَه.',
    evidence: "docs/evidence/security/SEC-09-20260916.md",
    guard: "tests/integration/admin-guard-authority.test.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-10",
    name: "أمنُ الصفِّ في القاعدةِ (`RLS`)",
    state: "partial",
    rationale:
      "`RLS` مُفعَّلٌ على **٦٨ جدولاً من ٦٩** مقيساً، والواحدُ الباقي `spatial_ref_sys` جدولُ امتدادِ PostGIS لا جدولُنا (تصحيحٌ بالإضافةِ لنصٍّ سابقٍ قالَ «٦٩ من ٧٠» — `ح-8`). **والفجوةُ الباقيةُ بعينِها**: الخدمةُ تتّصلُ بمالكِ القاعدةِ و`force row level security` صفرٌ على كلِّ جدولٍ، **فالمالكُ يمرُّ**؛ و`٢٥` سياسةً قائمةً كلُّها `to service_role using (true)` أي **إذنٌ شاملٌ لا ضابطُ وصولٍ**. ولا يُدَّعى أنَّ القاعدةَ تحمي اليومَ. **والذي زادَ**: صارَ الأثرُ **مقيساً** بدورٍ `nobypassrls` يُنشِئُه الاختبارُ (منعٌ شاملٌ على ٤٧ جدولاً بلا سياسةٍ · تجاوزُ المالكِ · وردُّ `force` لهُ)، وصارَ الشرطُ الحاكمُ في `ADR 0006` **يُسقِطُ البناءَ** بحاجزٍ ساكنٍ بدلاً من أن يُقرأَ بالنيّةِ.",
    evidence: null,
    gapMeasurement: "docs/evidence/security/SEC-10-20260917.md",
    guard: "scripts/check-row-security-condition.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-11",
    name: "نزعُ التنفيذِ عن `public`/`anon`/`authenticated`",
    state: "built",
    rationale:
      "كلُّ دالّةٍ ذاتِ أثرٍ منزوعةُ التنفيذِ عن الأدوارِ العامّةِ. **ومنحةُ `PUBLIC` التلقائيّةُ على الدوالِّ ترِثُها `anon`** — وذاكَ عطبٌ حقيقيٌّ أوقعَه حكمُ CI في `F8-01`، فصارَ `public` في النزعِ وزِيدَت قاعدةٌ ساكنةٌ `grant.public` بسالبةٍ مبذورةٍ.",
    evidence: "docs/evidence/architecture/F8-01-20260916.md",
    guard: "scripts/check-request-correlation.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-12",
    name: "سِجلُّ تدقيقٍ للأعمالِ الحسّاسةِ",
    // تصحيحٌ بالإضافةِ (`ح-8`) — 2026-09-16: كانَ حالُه `partial` بحيثيّةٍ
    // نصُّها: «جدولُ `audit_log` قائمٌ بتسعةِ أعمدةٍ ويُكتَبُ فيهِ فعلاً.
    // **والفجوةُ بعينِها**: لا سِجلَّ مغلقٌ يقولُ **أيُّ** الأعمالِ يجبُ أن
    // تُدقَّقَ، فعملٌ حسّاسٌ جديدٌ يمرُّ بلا أثرٍ ولا شيءَ يكشفُه — والتدقيقُ
    // الناقصُ أسوأُ من غيابِه لأنَّهُ يُوهِمُ تغطيةً». وكانَت تلكَ الفجوةُ
    // **مقيسةً صادقةً يومَها**، ثمَّ سُدَّت بـ`ADR 0136` — والدعوى القديمةُ
    // محفوظةٌ ههنا لا ممحوّةٌ.
    state: "built",
    rationale:
      "سِجلٌّ **مغلقٌ** لثمانيةَ عشرَ فعلاً لفاعلٍ مُتسلِّطٍ (`admin`/`support`) مع معجمٍ مغلقٍ لأسماءِ أفعالِها، **والاكتشافُ معكوسٌ**: تُقرأُ تعاريفُ الدوالِّ كلُّها من الهجراتِ (١٩٥ تعريفاً) فدالَّةٌ مُتسلِّطةٌ كاتبةٌ جديدةٌ غيرُ مُسجَّلةٍ تُسقِطُ البناءَ — والحُكمُ يُكتشَفُ **مُنابَاً** أيضاً (نوّابُ الحُكمِ مُكتشَفونَ لا مكتوبونَ) فمَن أوكلَ الحُكمَ لا يُفلِتُ. **ومقيسٌ بالأثرِ لا بالنصِّ** على PostgreSQL حقيقيٍّ: النجاحُ يُخلِّفُ صفّاً واحداً بمدينةِ **الحادثةِ** لا بمدينةِ الفاعلِ، و**الرفضُ لا يُخلِّفُ شيئاً** في خمسِ حالاتِ رفضٍ (لقطةُ العدَدِ قبلَ النداءِ تُساوي ما بعدَه). **وأُصلِحَ عطبٌ مقيسٌ**: `claim_safety_incident` و`resolve_safety_incident` كانا الفعلَينِ المُتسلِّطَينِ الوحيدَينِ بلا أثرٍ، وأحدُهما يحظِرُ المُبلِّغَ — فكانَ يُقرأُ حظرٌ بلا قرارٍ. **ولا يُدَّعى** شمولُ أفعالِ المستخدمِ على بياناتِ نفسِه (`record_user_consent` · `update_driver_vehicle` · `update_driver_vehicle_assets`) ولا تدقيقُ كلِّ فرعٍ داخلَ الدالَّةِ.",
    evidence: "docs/evidence/security/SEC-12-20260916.md",
    guard: "scripts/check-audit-actions.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-13",
    name: "تصنيفُ الاستبقاءِ وحقُّ المحوِ",
    state: "built",
    rationale:
      "`F2-11`: لا جدولَ يدخلُ المخطَّطَ بلا تصنيفِ استبقاءٍ، وسِجلُّ المحوِ يُقابَلُ بالشيفرةِ في الاتّجاهَينِ. **والمحوُ يقفُ عندَ المالِ لا عندَ الدورِ** (`ADR 0125`) — وذاكَ قيدٌ قانونيٌّ مكتوبٌ لا تهاونٌ.",
    evidence: "docs/evidence/architecture/F2-11-account-and-data-rights-20260914.md",
    guard: "scripts/check-erasure-policy.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-14",
    name: "أصلٌ واحدٌ للأصولِ الساكنةِ",
    state: "built",
    rationale:
      "`F1-10`: كلُّ أصلٍ يُحمَّلُ من أصلِنا، ولا مضيفَ ثالثاً يُحقَنُ في صفحةٍ يفتحُها مستخدِمٌ. ويُقاسُ **من مُخرَجِ البناءِ لا من الشيفرةِ** — فالبايتاتُ هيَ ما يُنفَّذُ.",
    evidence: "docs/evidence/architecture/F1-10-20260829.md",
    guard: "scripts/check-single-origin-assets.ts",
    owner: "منفّذ المستودع",
    blockedBy: null,
  },
  {
    id: "SEC-15",
    name: "تثبيتُ التبعيّاتِ ونزاهةُ العقودِ المنقولةِ",
    state: "partial",
    rationale:
      "العقودُ المنقولةُ من `CORE` مُثبَّتةٌ ببصمةِ بايتاتٍ يحرسُها حاجزانِ. **والفجوةُ بعينِها**: طزاجتُها **غيرُ قابلةٍ للتحقُّقِ في CI** — `uxxxug/wasla-core` مستودَعٌ خاصٌّ ورِمزُ جرياتِنا لا يقرؤُه؛ وذاكَ `O-6`، قرارُ مالِكٍ لا شغلُ وكيلٍ. ولا فحصَ ثغراتٍ آليٌّ على التبعيّاتِ.",
    evidence: null,
    guard: "scripts/check-vendored-contract-integrity.ts",
    owner: "مالك المشروع",
    blockedBy: "O-6",
  },
  {
    id: "SEC-16",
    name: "إدارةُ الأسرارِ ودورانُها",
    state: "not-built",
    rationale:
      "`check-env-drift` يمنعُ انحرافَ **أسماءِ** المتغيّراتِ، وذاكَ ليسَ إدارةَ أسرارٍ. **والفجوةُ بعينِها**: لا خزنةَ، ولا دورانَ، ولا سِجلَّ لمَن قرأَ سرّاً ومتى — وكلُّ ذلكَ **بنيةٌ تحتيّةٌ لا شيفرةٌ** في مستودَعٍ، محجوزٌ في `F9-01` بقرارِ `DEC-17`.",
    evidence: null,
    guard: null,
    owner: "بنية تحتية (F9)",
    blockedBy: "DEC-17",
  },
];

export interface ControlViolation {
  readonly rule: string;
  readonly detail: string;
}

/** رمزُ البندِ في §12 كما يُقرأُ من نصِّ الخارطةِ — لا كما يُحفَظُ عن ظهرِ قلبٍ. */
const ROADMAP_ROW_RE = /^\|\s*F8-08\s*\|.*\|\s*`(\[[ x~!]\])`\s*\|/m;

export function readF8_08Symbol(roadmapText: string): string | null {
  const match = ROADMAP_ROW_RE.exec(roadmapText);
  return match?.[1] ?? null;
}

export interface ControlInputs {
  /** نصُّ `docs/ROADMAP-MASTER.md`. */
  readonly roadmapText: string;
  /** يُجيبُ: أيوجدُ هذا المسارُ على القرصِ؟ يُحقَنُ لِيُقاسَ الحاجزُ بلا قرصٍ. */
  readonly pathExists: (path: string) => boolean;
  /** السِجلُّ المقيسُ — يُحقَنُ لِتُزرَعَ السوالبُ. */
  readonly controls?: readonly SecurityControl[];
}

export function securityControlViolations(inputs: ControlInputs): ControlViolation[] {
  const controls = inputs.controls ?? SECURITY_CONTROLS;
  const violations: ControlViolation[] = [];

  // القاعدةُ الأولى: العددُ من نصِّ البندِ لا من طولِ المصفوفةِ. ولو قُرِئَ
  // العددُ من المصفوفةِ لَحَرَسَ السِجلُّ نفسَه ولم يحرُس شيئاً.
  if (controls.length !== REQUIRED_CONTROL_COUNT) {
    violations.push({
      rule: "count.matches-item-text",
      detail: `نصُّ F8-08 يشترطُ ${REQUIRED_CONTROL_COUNT} ضابطاً، والسِجلُّ فيهِ ${controls.length}`,
    });
  }

  const seen = new Set<string>();
  for (const control of controls) {
    if (seen.has(control.id)) {
      violations.push({
        rule: "id.unique",
        detail: `معرِّفٌ مكرَّرٌ: ${control.id} — والمعرِّفُ مفتاحُ إحالةٍ، ومفتاحٌ بلا تفرُّدٍ يفسدُ صامتاً`,
      });
    }
    seen.add(control.id);

    if (control.rationale.length < MIN_RATIONALE_LENGTH) {
      violations.push({
        rule: "rationale.written",
        detail: `${control.id}: حيثيّةُ الحالِ أقصرُ من ${MIN_RATIONALE_LENGTH} حرفاً — «مبنيٌّ» ليسَ حيثيّةً`,
      });
    }

    if (control.state === "built") {
      // دعوى `built` **تشتري ثقةً**، فثمنُها دليلٌ موجودٌ وحاجزٌ موجودٌ. وملفٌّ
      // مذكورٌ لا وجودَ لهُ أسوأُ من لا ملفٍّ: يُقرأُ إثباتاً ولا يُفتَحُ.
      if (control.evidence === null || control.guard === null) {
        violations.push({
          rule: "built.requires-evidence-and-guard",
          detail: `${control.id}: حالُه «مبنيٌّ» بلا ${control.evidence === null ? "دليلٍ" : "حاجزٍ"}`,
        });
      }
      for (const path of [control.evidence, control.guard]) {
        if (path !== null && !inputs.pathExists(path)) {
          violations.push({
            rule: "built.paths-exist",
            detail: `${control.id}: المسارُ المذكورُ لا وجودَ لهُ على القرصِ — ${path}`,
          });
        }
      }
    }

    if (control.state !== "built" && control.evidence !== null) {
      // دليلٌ على ضابطٍ غيرِ مبنيٍّ يُقرأُ لاحقاً إثباتَ بناءٍ. والصدقُ أن
      // يُترَكَ فارغاً.
      violations.push({
        rule: "unbuilt.no-evidence-claim",
        detail: `${control.id}: حالُه «${control.state}» ومعَهُ دليلٌ مذكورٌ — الدليلُ دعوى بناءٍ`,
      });
    }

    const gapMeasurement = control.gapMeasurement ?? null;
    if (gapMeasurement !== null && control.state === "built") {
      // «قياسُ فجوةٍ» على ضابطٍ مبنيٍّ تناقضٌ: إمّا الفجوةُ قائمةٌ فالحالُ ليسَ
      // `built`، وإمّا زالَت فالملفُّ دليلُ بناءٍ يُذكَرُ في `evidence`.
      violations.push({
        rule: "built.no-gap-measurement",
        detail: `${control.id}: حالُه «مبنيٌّ» ومعَهُ قياسُ فجوةٍ — فجوةٌ مقيسةٌ تنقضُ دعوى البناءِ`,
      });
    }
    if (gapMeasurement !== null && !inputs.pathExists(gapMeasurement)) {
      // وملفٌّ مذكورٌ لا يُفتَحُ أسوأُ من لا ملفٍّ: يُقرأُ إقراراً ولا وجودَ لهُ.
      violations.push({
        rule: "gap-measurement.exists",
        detail: `${control.id}: قياسُ فجوةٍ مذكورٌ لا وجودَ لهُ — ${gapMeasurement}`,
      });
    }

    if (control.guard !== null && !inputs.pathExists(control.guard)) {
      violations.push({
        rule: "guard.exists",
        detail: `${control.id}: حاجزٌ مذكورٌ لا وجودَ لهُ — ${control.guard}`,
      });
    }
  }

  // القاعدةُ الحاكمةُ: **الرمزُ مُشتَقٌّ لا مكتوبٌ بيدٍ.** ما دامَ ضابطٌ واحدٌ
  // غيرَ مبنيٍّ فرمزُ البندِ `[ ]`، ولا يُرفَعُ بقرارِ كاتبٍ.
  const allBuilt = controls.length > 0 && controls.every((c) => c.state === "built");
  const symbol = readF8_08Symbol(inputs.roadmapText);
  if (symbol === null) {
    violations.push({
      rule: "roadmap.row-readable",
      detail: "صفُّ F8-08 غيرُ مقروءٍ من docs/ROADMAP-MASTER.md — والعجزُ عن القياسِ عطبٌ لا عذرٌ",
    });
  } else if (!allBuilt && symbol !== "[ ]") {
    const built = controls.filter((c) => c.state === "built").length;
    violations.push({
      rule: "symbol.derived-from-registry",
      detail: `رمزُ F8-08 هوَ \`${symbol}\` والمبنيُّ ${built} من ${controls.length} — الرمزُ يُشتَقُّ من السِجلِّ لا يُكتَبُ بيدٍ`,
    });
  }

  return violations;
}

export function describeSecurityControlViolation(violation: ControlViolation): string {
  return `  • [${violation.rule}] ${violation.detail}`;
}

export function summarizeControls(controls: readonly SecurityControl[] = SECURITY_CONTROLS): {
  built: number;
  partial: number;
  notBuilt: number;
  blocked: number;
} {
  return {
    built: controls.filter((c) => c.state === "built").length,
    partial: controls.filter((c) => c.state === "partial").length,
    notBuilt: controls.filter((c) => c.state === "not-built").length,
    blocked: controls.filter((c) => c.blockedBy !== null).length,
  };
}
