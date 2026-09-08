/**
 * # وحدةُ الحكمِ على دليلِ Redis الحقيقيِّ — `OPS-006`
 *
 * **الغرض:** أن يُحكَم على تشغيلٍ زُعِم أنّه جرى على **Redis حقيقيٍّ** بشرطَين معاً:
 * أنّه **جرى فعلاً** (عميلٌ حقيقيٌّ · أوامرُ صدرت · فحوصٌ مُعلَنةٌ تمّت · ولا مفتاحَ
 * تُرِك خلفَه)، وأنّه **لم يُفشِ سرّاً** في الدليلِ الذي سيُنشَر.
 *
 * **الحالة:** `OPS-006` — مُنفَّذ · مُختبَر (ADR 0049).
 *
 * **ينتمي إلى:** البند `OPS-006` · القسم 11-د · و`tests/support/real-redis.ts`
 * الذي يُنتِج الدليلَ، و`scripts/check-real-redis-proof.ts` الذي يفرضه.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** أيُّ وظيفةِ CI تعمل على مخزنٍ حقيقيٍّ خارجيٍّ —
 * فالقاعدةُ نفسُها تصلح لطابورٍ أو مخزنِ كائناتٍ: **لا يُقرَأ الزعمُ دليلاً، ولا
 * يُنشَر دليلٌ يحمل سرّاً**.
 *
 * **ملاحظات مستقبلية:** لو زِيدت فحوصٌ في الاختبارِ الحقيقيِّ فتُضاف إلى
 * `REQUIRED_CHECKS` ههنا، وإلّا مرّت غيرَ مفروضةٍ. والزيادةُ في `MIN_REAL_COMMANDS`
 * تُقاس ولا تُستحسَن.
 *
 * **ما لا تفعله هذه الوحدةُ عن قصدٍ — وحدودُها مُعلَنةٌ لا مضمرةٌ:**
 * - **لا تتّصل بشبكةٍ ولا تقرأ قرصاً ولا تقرأ بيئةً.** حكمٌ على كائنٍ مُمرَّرٍ فقط،
 *   فكلُّ قاعدةٍ فيها تُختبَر بحقنِ خرقٍ.
 * - **لا تُثبِت أنّ الخادمَ المُقابِلَ Redis إنتاجيٌّ.** تُثبِت أنّ عميلاً حقيقيّاً
 *   خاطبَ خادماً فأجاب بسلوكِ Redis؛ أمّا هُويّةُ الخادمِ فمن الإعدادِ لا من ههنا.
 * - **لا تكشف كتمانَ سرٍّ كشفاً تامّاً.** تمنع الأنماطَ المعروفةَ (رابطٌ · رمزٌ طويلٌ ·
 *   ترويسةُ تصريحٍ)، ولا تدّعي أنّها تمنع كلَّ صياغةٍ ممكنةٍ لإفشاءٍ.
 */

/** فحوصٌ **مطلوبةٌ كلُّها**: نقصانُ واحدٍ إخفاقٌ، ومعرِّفٌ خارجَ القائمةِ إخفاقٌ. */
export const REQUIRED_CHECKS = [
  "roundtrip-set-get-del",
  "session-store-save-load",
  "session-ttl-is-real",
  "session-expiry-observed",
  "namespace-isolation",
  "malformed-value-erased",
  "keys-scoped-to-prefix",
  "rate-limit-counts-on-server",
  "rate-limit-window-expires",
  "rate-limit-atomic-under-concurrency",
  "full-dialog-through-real-redis",
  "scl-004-stream-cross-instance-delivery",
  "scl-005-broadcast-shared-store",
] as const;
export type RequiredCheck = (typeof REQUIRED_CHECKS)[number];

/**
 * حدٌّ أدنى **مقيسٌ** لعددِ الأوامرِ التي خرجت إلى الخادمِ الحقيقيِّ. وجودُه يمنع
 * دليلاً «كاملَ الفحوصِ» أنتجَه مزدوجٌ لا يُخاطِب شبكةً: فحوصُ هذا الملفِّ لا تتمّ
 * بأقلَّ من هذا العددِ، والعددُ يُقاس ولا يُستحسَن.
 */
export const MIN_REAL_COMMANDS = 30;

/** الدليلُ كما يكتبه الاختبارُ — **ولا حقلَ فيه للسرِّ ولا للنقطةِ** عن قصدٍ. */
export interface RealRedisProof {
  readonly producedAt: string;
  readonly runId: string;
  readonly usedRealClient: boolean;
  readonly commandsIssued: number;
  readonly checks: readonly string[];
  readonly keyPrefix: string;
  readonly keysLeftBehind: number;
}

/**
 * أنماطُ إفشاءٍ تُرفَض في **أيِّ** نصٍّ داخلَ الدليلِ:
 * 1. رابطٌ بأيِّ مخطَّطٍ — النقطةُ نفسُها معلومةٌ حسّاسةٌ بأمرِ صاحبِ المستودعِ.
 * 2. سلسلةٌ طويلةٌ تخلط حروفاً وأرقاماً بلا فاصلٍ — شكلُ رمزِ التصريحِ في Upstash
 *    وغيرِه. والشَّرطانِ (حرفٌ **و**رقمٌ) لا زيادةَ فيهما: معرِّفاتُ الفحوصِ عندنا
 *    كلماتٌ مفصولةٌ بشُرَطٍ بلا أرقامٍ، فبلا هذا الشرطِ كان الحاجزُ يرى فيها سرّاً
 *    فيسقط على لا شيءٍ — وحاجزٌ يسقط على لا شيءٍ يُخفَّف بعدَ حينٍ فيبطل.
 * 3. لفظُ ترويسةِ التصريحِ.
 */
const LEAK_PATTERNS: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  { id: "رابطٌ صريحٌ", pattern: /[a-z][a-z0-9+.-]*:\/\// },
  {
    id: "رمزٌ طويلٌ يُشبِه رمزَ تصريحٍ",
    pattern: /(?=[A-Za-z0-9_]*[0-9])(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{28,}/,
  },
  { id: "ترويسةُ تصريحٍ", pattern: /bearer\s/i },
];

/**
 * تُستعمَل على **كلِّ** نصٍّ يخرج من محوّلِ Redis إلى مخرجاتِ الاختبارِ: رسالةُ
 * `fetch` المخفقةِ تحمل الرابطَ في كثيرٍ من أزمنةِ التشغيلِ، فتُطبَع النقطةُ في سجلِّ
 * وظيفةٍ عامّةٍ من حيثُ لا يُقصَد. والاستبدالُ لا الحذفُ: القارئُ يرى أنّ ههنا شيئاً
 * كُتِم، فلا يظنّ الرسالةَ ناقصةً.
 */
export function redactSecrets(text: string, extra: readonly string[] = []): string {
  let output = text;
  for (const secret of extra) {
    if (secret.length >= 4) output = output.split(secret).join("«مكتومٌ»");
  }
  output = output.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, "«نقطةٌ مكتومةٌ»");
  output = output.replace(
    /(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{28,}/g,
    "«رمزٌ مكتومٌ»",
  );
  return output;
}

function leaksIn(label: string, value: string): readonly string[] {
  const found: string[] = [];
  for (const { id, pattern } of LEAK_PATTERNS) {
    if (pattern.test(value)) found.push(`${label}: قد يُفشي سرّاً (${id}) — ولا يُنشَر دليلٌ بسرٍّ.`);
  }
  return found;
}

/**
 * الحكمُ. كلُّ مخالفةٍ نصٌّ يُقرَأ بلا سياقٍ خارجيٍّ، لأنّ قارئَها يراها في سجلِّ CI
 * وحدَه. ولا تُرمى استثناءاتٌ: الشكلُ الفاسدُ مخالفةٌ مثلُ غيرِه.
 */
export function auditRealRedisProof(input: unknown): readonly string[] {
  const violations: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return ["الدليلُ ليس كائناً — ولا يُقرَأ غيابُ الشكلِ نجاحاً."];
  }
  const proof = input as Partial<RealRedisProof>;

  if (proof.usedRealClient !== true) {
    violations.push(
      "الدليلُ لا يُصرِّح باستعمالِ عميلٍ حقيقيٍّ (`usedRealClient`) — ومزدوجٌ في الذاكرةِ لا يُثبِت Redis حقيقياً.",
    );
  }
  if (typeof proof.runId !== "string" || proof.runId.trim() === "") {
    violations.push("لا معرِّفَ تشغيلٍ في الدليلِ (`runId`) — فدليلٌ لا يُنسَب إلى تشغيلٍ لا يُراجَع.");
  }
  if (typeof proof.producedAt !== "string" || Number.isNaN(Date.parse(proof.producedAt))) {
    violations.push("زمنُ إنتاجِ الدليلِ (`producedAt`) مفقودٌ أو غيرُ مقروءٍ.");
  }
  if (typeof proof.commandsIssued !== "number" || !Number.isFinite(proof.commandsIssued)) {
    violations.push("عددُ الأوامرِ (`commandsIssued`) مفقودٌ أو ليس رقماً.");
  } else if (proof.commandsIssued < MIN_REAL_COMMANDS) {
    violations.push(
      `الأوامرُ الصادرةُ ${proof.commandsIssued} والحدُّ الأدنى المقيسُ ${MIN_REAL_COMMANDS} — ` +
        `قِلَّةٌ كهذه تعني أنّ الفحوصَ لم تُخاطِب خادماً فعلاً.`,
    );
  }
  if (typeof proof.keysLeftBehind !== "number" || !Number.isFinite(proof.keysLeftBehind)) {
    violations.push("عددُ المفاتيحِ المتروكةِ (`keysLeftBehind`) مفقودٌ أو ليس رقماً.");
  } else if (proof.keysLeftBehind !== 0) {
    violations.push(
      `تُرِك ${proof.keysLeftBehind} مفتاحاً في الخادمِ بعدَ التشغيلِ — ` +
        `والتشغيلُ الذي لا ينظّف أثرَه يُلوِّث تشغيلاً تالياً فيصير الأخضرُ مصادفةً.`,
    );
  }

  const checks = Array.isArray(proof.checks) ? proof.checks.map(String) : null;
  if (checks === null) {
    violations.push("قائمةُ الفحوصِ (`checks`) مفقودةٌ أو ليست مصفوفةً.");
  } else {
    const done = new Set(checks);
    for (const required of REQUIRED_CHECKS) {
      if (!done.has(required)) violations.push(`فحصٌ مطلوبٌ لم يتمّ: ${required}`);
    }
    for (const name of done) {
      if (!(REQUIRED_CHECKS as readonly string[]).includes(name)) {
        violations.push(
          `فحصٌ في الدليلِ ليس في القائمةِ المغلقةِ: ${name} — يُضاف إلى القائمةِ أو يُحذَف من الدليلِ.`,
        );
      }
    }
    if (checks.length !== done.size) {
      violations.push("فحصٌ مُعلَنٌ مرّتَين في الدليلِ — والتكرارُ يُخفي نقصاناً بعددٍ صحيحٍ.");
    }
  }

  if (typeof proof.keyPrefix !== "string" || proof.keyPrefix.trim() === "") {
    violations.push("بادئةُ المفاتيحِ (`keyPrefix`) مفقودةٌ — ولا يُعزَل تشغيلٌ بلا بادئةٍ خاصّةٍ به.");
  }

  for (const [key, value] of Object.entries(proof)) {
    if (typeof value === "string") violations.push(...leaksIn(`الحقلُ \`${key}\``, value));
  }
  if (checks !== null) {
    for (const name of checks) violations.push(...leaksIn("معرِّفُ فحصٍ", name));
  }

  return violations;
}
