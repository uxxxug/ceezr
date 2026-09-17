/**
 * الغرض: وحدةُ تدقيقِ تغطيةِ تحديدِ المعدَّلِ — **دالّةٌ خالصةٌ** تُطابِقُ مساراتِ
 *   البوّابةِ المُكتشَفةَ من الشيفرةِ بسِجلِّ السياسةِ المغلقِ، وتُعيدُ قائمةَ
 *   الخروقِ. لا تقرأُ قرصاً ولا تُنهي عمليّةً (`SEC-07`).
 * الحالة: منفّذ فعلياً — 2026-09-17.
 * ينتمي إلى: scripts/lib
 * يُستخدَمُ من: `scripts/check-rate-limit-coverage.ts` ·
 *   `tests/unit/check-rate-limit-coverage.test.ts`
 * يحرسُه: `tests/unit/check-rate-limit-coverage.test.ts` — **بسالبةٍ مزروعةٍ لكلِّ
 *   قاعدةٍ** (`ح-7`): حاجزٌ لم يُرَ ساقطاً لم يُقَسْ.
 * الحاكم: `docs/adr/0139-an-unlisted-exposed-route-is-an-unlimited-route.md`
 *
 * ## لِمَ الخلوصُ شرطٌ لا ذوقٌ
 *
 * لأنَّ حاجزاً يقرأُ القرصَ في جسمِه **لا يُقاسُ إلّا بتعديلِ المستودعِ**: تُزرَعُ
 * السالبةُ بملفٍّ مؤقّتٍ فتُختبَرُ نسخةٌ من الواقعِ لا الواقعُ. وههنا المدخلاتُ
 * مُمرَّرةٌ، فتُزرَعُ السالبةُ في الذاكرةِ ويبقى المستودعُ سليماً.
 *
 * ## وما لا تفعلُه هذه الوحدةُ عن قصدٍ
 *
 * - **لا تُثبِتُ إنفاذاً**: تُطابِقُ إعلاناً بشيفرةٍ. والإنفاذُ يُقاسُ بخادمٍ
 *   حقيقيٍّ في `tests/unit/rate-limit-enforced.test.ts` — و`ADR 0135` يقولُ إنَّ
 *   حاجزاً يفحصُ ما هوَ موجودٌ لا يجدُ ما هوَ غائبٌ، فالجردُ من الشيفرةِ لا من
 *   السِجلِّ لهذا بعينِه.
 * - **لا تُحلِّلُ TypeScript بمُحلِّلٍ**: القراءةُ نصّيّةٌ، وحدُّها مُعلَنٌ في
 *   `gateway-route-inventory.ts`.
 */

import type {
  ExposureClass,
  KeyDimension,
  RoutePolicy,
} from "../../apps/gateway/src/rate-limit/policy.ts";
import { discoverGatewayRoutes, type InventoryProblem } from "./gateway-route-inventory.ts";

/** أدنى طولٍ لسببِ إعفاءٍ. سببٌ في كلمتينِ لا يُراجَعُ ولا يُخالَفُ. */
export const MIN_EXEMPTION_REASON_LENGTH = 120;
/** أدنى طولٍ لتعليلِ رقمٍ: «حدٌّ معقولٌ» ليسَ تعليلاً. */
export const MIN_RATIONALE_LENGTH = 80;
/** حدٌّ أعلى للنافذةِ: نافذةٌ أطولُ من ساعةٍ تُخزِّنُ عدَّاداً بلا انتهاءٍ عمليٍّ. */
export const MAX_WINDOW_SECONDS = 3600;

export interface RateLimitAuditInput {
  /** ملفّاتُ `apps/gateway/src/routes` — مسارٌ نسبيٌّ إلى محتوىً. */
  readonly routeSources: ReadonlyMap<string, string>;
  /** ملفّاتُ التركيبِ التي تُقرأُ منها البادئاتُ. */
  readonly mountSources: ReadonlyMap<string, string>;
  /** السِجلُّ المُعلَنُ. */
  readonly policies: readonly RoutePolicy[];
  /** الأعدادُ المُعلَنةُ نصّاً في السِجلِّ. */
  readonly declared: {
    readonly routes: number;
    readonly limited: number;
    readonly exempt: number;
  };
  /** ملفّاتٌ يُبحَثُ فيها عن نصِّ `wiredIn` — مسارٌ نسبيٌّ إلى محتوىً. */
  readonly wiredSources: ReadonlyMap<string, string>;
  /** معجمُ أصنافِ الكشفِ المغلقُ. */
  readonly exposureClasses: readonly ExposureClass[];
  /** الأصنافُ التي يجبُ فيها حدٌّ أو إعفاءٌ. */
  readonly limitRequiredExposures: readonly ExposureClass[];
  /** أبعادُ المفاتيحِ المغلقةُ. */
  readonly keyDimensions: readonly KeyDimension[];
  /** البادئاتُ العامّةُ المسموحةُ. */
  readonly publicPathPrefixes: readonly string[];
}

function keyOf(method: string, path: string): string {
  return `${method} ${path}`;
}

function describeProblem(problem: InventoryProblem): string {
  return `جردُ المساراتِ: ${problem.kind} — ${problem.detail}`;
}

/**
 * يُعيدُ قائمةَ الخروقِ. فارغةٌ = تغطيةٌ مُعلَنةٌ مُطابِقةٌ للشيفرةِ **لا حمايةٌ
 * مُثبَتةٌ**؛ الفرقُ مكتوبٌ في رأسِ الملفِّ ولا يُختصَرُ في المراجعةِ.
 */
export function auditRateLimitCoverage(input: RateLimitAuditInput): readonly string[] {
  const violations: string[] = [];

  const inventory = discoverGatewayRoutes(input.routeSources, input.mountSources);
  for (const problem of inventory.problems) violations.push(describeProblem(problem));

  const discovered = new Map(
    inventory.routes.map((route) => [keyOf(route.method, route.path), route]),
  );
  const declaredRoutes = new Map<string, RoutePolicy>();

  for (const policy of input.policies) {
    const key = keyOf(policy.method, policy.path);
    // (١٠) لا مدخلَ مُكرَّراً: مدخلانِ لمسارٍ واحدٍ يجعلانِ «أوّلُ ما وُجِدَ» سياسةً.
    if (declaredRoutes.has(key)) {
      violations.push(`مدخلٌ مُكرَّرٌ في السِجلِّ: ${key} — لمسارٍ واحدٍ سياسةٌ واحدةٌ.`);
      continue;
    }
    declaredRoutes.set(key, policy);
  }

  // (١) مسارٌ في الشيفرةِ بلا مدخلٍ = مسارٌ مكشوفٌ لم يُقرِّرْ له أحدٌ حدَّاً.
  for (const [key, route] of discovered) {
    if (!declaredRoutes.has(key)) {
      violations.push(
        `مسارٌ في الشيفرةِ بلا مدخلٍ في السِجلِّ: ${key} (${route.file}) — ` +
          `مسارٌ غيرُ مُدرَجٍ مسارٌ بلا حدٍّ، وسُكوتُ السِجلِّ ليسَ قراراً.`,
      );
    }
  }

  // (٢) مدخلٌ بلا مسارٍ = سياسةٌ تُقرأُ حمايةً لبابٍ زالَ، وتُخفي أنَّ الجردَ عَمِيَ.
  for (const [key, policy] of declaredRoutes) {
    const route = discovered.get(key);
    if (route === undefined) {
      violations.push(
        `مدخلٌ في السِجلِّ بلا مسارٍ في الشيفرةِ: ${key} (${policy.file}) — ` +
          `يُحذَفُ المدخلُ أو يُصلَحُ الجردُ؛ ولا يُترَكُ إعلانٌ لبابٍ لا وجودَ له.`,
      );
      continue;
    }
    if (route.file !== policy.file) {
      violations.push(`ملفُّ ${key} في السِجلِّ ${policy.file} وفي الشيفرةِ ${route.file}.`);
    }
  }

  for (const [key, policy] of declaredRoutes) {
    // (٣) صنفُ الكشفِ من معجمٍ مغلقٍ.
    if (!input.exposureClasses.includes(policy.exposure)) {
      violations.push(`صنفُ كشفٍ غيرُ معروفٍ لِـ${key}: «${policy.exposure}».`);
    }

    // (٨) بادئةٌ عامّةٌ معروفةٌ — القاعدةُ التي كشفَت `GET /` و`POST /assets`.
    if (!input.publicPathPrefixes.some((prefix) => policy.path.startsWith(prefix))) {
      violations.push(
        `مسارٌ لا يبدأُ ببادئةٍ عامّةٍ معروفةٍ: ${key} — إمّا رُكِّبَ على الجِذرِ سهواً ` +
          `وإمّا سطحٌ لم يُقرَّرْ له موضعٌ. (وهذا عينُ ما وقعَ في مساراتِ مركبةِ السائقِ.)`,
      );
    }

    const required = input.limitRequiredExposures.includes(policy.exposure);
    const hasLimits = policy.limits.length > 0;
    const hasExemption = policy.exemption !== null;

    // (٤) صنفٌ يُوجَبُ فيه حدٌّ: **واحدٌ** من الحدِّ أو الإعفاءِ لا كلاهما ولا لا شيءَ.
    if (required && hasLimits === hasExemption) {
      violations.push(
        hasLimits
          ? `${key}: حدٌّ وإعفاءٌ معاً — الإعفاءُ يقولُ «لا حدَّ» والحدُّ يقولُ خلافَه.`
          : `${key}: صنفُ «${policy.exposure}» يُوجِبُ حدّاً مُركَّباً أو إعفاءً بسببٍ مكتوبٍ، ولا ثالثَ.`,
      );
    }
    // (٤-ب) صنفٌ لا يُوجَبُ فيه حدٌّ لا يُعفى: تعليلُه مكتوبٌ للصنفِ مرّةً في السِجلِّ.
    if (!required && hasExemption) {
      violations.push(
        `${key}: إعفاءٌ في صنفٍ لا يُوجَبُ فيه حدٌّ («${policy.exposure}») — ` +
          `إعفاءٌ من واجبٍ غيرِ قائمٍ يُوهِمُ أنَّ ههنا قراراً، وتعليلُ الصنفِ في رأسِ السِجلِّ.`,
      );
    }

    // (٥) سببُ إعفاءٍ مكتوبٌ ومالكٌ.
    if (policy.exemption !== null) {
      if (policy.exemption.reason.trim().length < MIN_EXEMPTION_REASON_LENGTH) {
        violations.push(
          `${key}: سببُ الإعفاءِ أقصرُ من ${MIN_EXEMPTION_REASON_LENGTH} حرفاً — ` +
            `والمطلوبُ **المُنفِّذُ البديلُ مُسمّىً** لا عبارةَ اطمئنانٍ.`,
        );
      }
      if (policy.exemption.owner.trim() === "") {
        violations.push(`${key}: إعفاءٌ بلا مالكٍ — لا أحدَ يُسأَلُ عنه.`);
      }
    }

    for (const limit of policy.limits) {
      // (٦) قيمٌ صالحةٌ وبُعدُ مفتاحٍ معروفٌ.
      if (!Number.isInteger(limit.limit) || limit.limit < 1) {
        violations.push(`${key}: حدٌّ غيرُ صحيحٍ (${limit.limit}) — والصفرُ إغلاقٌ لا حدٌّ.`);
      }
      if (!Number.isInteger(limit.windowSeconds) || limit.windowSeconds < 1) {
        violations.push(`${key}: نافذةٌ غيرُ صحيحةٍ (${limit.windowSeconds}).`);
      }
      if (limit.windowSeconds > MAX_WINDOW_SECONDS) {
        violations.push(`${key}: نافذةٌ أطولُ من ${MAX_WINDOW_SECONDS} ثانيةً — عدَّادٌ لا ينتهي عمليّاً.`);
      }
      if (!input.keyDimensions.includes(limit.keyDimension)) {
        violations.push(`${key}: بُعدُ مفتاحٍ غيرُ معروفٍ: «${limit.keyDimension}».`);
      }
      if (limit.rationale.trim().length < MIN_RATIONALE_LENGTH) {
        violations.push(
          `${key}: تعليلُ الرقمِ أقصرُ من ${MIN_RATIONALE_LENGTH} حرفاً — ` +
            `رقمٌ بلا تعليلٍ لا يُراجَعُ ولا يُغيَّرُ بعلمٍ.`,
        );
      }

      // (٧) موضعُ التركيبِ موجودٌ **ويحتوي نصَّ النداءِ**: إعلانٌ بلا تركيبٍ يُقرأُ حمايةً.
      const separator = limit.wiredIn.indexOf(":");
      if (separator <= 0) {
        violations.push(`${key}: صيغةُ \`wiredIn\` خاطئةٌ: «${limit.wiredIn}» — «<ملفٌّ>:<نصٌّ>».`);
        continue;
      }
      const file = limit.wiredIn.slice(0, separator);
      const needle = limit.wiredIn.slice(separator + 1);
      const source = input.wiredSources.get(file);
      if (source === undefined) {
        violations.push(`${key}: ملفُّ التركيبِ ${file} غيرُ مقروءٍ — لا يُتحقَّقُ تركيبٌ بلا ملفٍّ.`);
        continue;
      }
      if (!source.includes(needle)) {
        violations.push(
          `${key}: حدٌّ مُعلَنٌ بلا تركيبٍ — لم يوجَدْ «${needle}» في ${file}. ` +
            `وسِجلٌّ يُعلِنُ حدّاً لا مُنفِّذَ له أسوأُ من سِجلٍّ يقولُ «لا حدَّ».`,
        );
      }
    }
  }

  // (٩) الأعدادُ المُعلَنةُ نصّاً تُطابِقُ المقيسَ — لا `ARRAY.length` يحرسُ نفسَه.
  const limitedCount = input.policies.filter((policy) => policy.limits.length > 0).length;
  const exemptCount = input.policies.filter((policy) => policy.exemption !== null).length;
  if (input.declared.routes !== input.policies.length) {
    violations.push(
      `العددُ المُعلَنُ للمساراتِ ${input.declared.routes} والمقيسُ ${input.policies.length}.`,
    );
  }
  if (input.declared.limited !== limitedCount) {
    violations.push(`العددُ المُعلَنُ للمحدودةِ ${input.declared.limited} والمقيسُ ${limitedCount}.`);
  }
  if (input.declared.exempt !== exemptCount) {
    violations.push(
      `العددُ المُعلَنُ للمُعفاةِ ${input.declared.exempt} والمقيسُ ${exemptCount} — ` +
        `ونموُّ الإعفاءاتِ خفيةً هوَ بعينِه ما يُخشى.`,
    );
  }

  return violations;
}
