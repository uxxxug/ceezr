/**
 * الغرض: ضبطٌ سالبٌ موزَّع — إثباتُ أنّ مخزنَ الجلساتِ المشتركَ (ADR 0011) شرطٌ
 *        حقيقيٌّ لا احتياطٌ نظريّ: نفسُ الحوارِ مقسوماً على عمليتين يتقدّم مع
 *        المخزنِ المشترك ويتعطّل مع مخزنِ الذاكرة.
 * الحالة: منفّذ فعلياً — وحدة 2-6.
 * ينتمي إلى: bench/topology
 * يُتوقع أن يستخدمه لاحقاً: `bench/run-distributed.ts`
 *
 * ## لماذا ضبطٌ سالب
 *
 * كلُّ نتائجِ هذه الوحدةِ الأخرى موجَبةٌ: «نجحَ عبرَ العمليات». ونتيجةٌ موجبةٌ
 * وحدَها لا تقول إن كان الترتيبُ المشتركُ هو سببَ النجاحِ أصلاً. فيُقلَع عنقودٌ
 * ثانٍ بمخزنِ ذاكرةٍ — أي بالضبطِ إعدادِ `render.yaml` الحاليِّ لو رُفِعت النسخُ
 * فوقَ واحدةٍ بلا تغييرِ `SESSION_STORE` — ويُنتظَر منه أن **يفسد**. فسادُه هو
 * الدليلُ على أنّ ما قِيس في البقيّةِ ليس مصادفة، وأنّ التعليقَ في `render.yaml`
 * تحذيرٌ حقيقيٌّ لا مجاملة.
 */

import { translate } from "../../../../packages/shared/i18n/index.ts";
import { type CheckResult, check } from "../scenarios/contract.ts";
import { textUpdate } from "../scenarios/updates.ts";
import { type Cluster, startCluster } from "./cluster.ts";

/** خارجَ نطاقاتِ السائقين المستخدمةِ في السيناريوهات (700k/900k/910k/960k). */
const PROBE_TELEGRAM_ID = 940_101;

export interface ProbeReport {
  readonly id: string;
  readonly title: string;
  readonly checks: readonly CheckResult[];
  readonly topology: readonly string[];
  readonly notes: readonly string[];
}

/** يقسم أوّلَ خطوتين من حوارِ السائقِ على عمليتين ويعيد نصَّ ردِّ العمليةِ الثانية. */
async function splitDialogAcrossProcesses(cluster: Cluster): Promise<string> {
  await cluster.postTo(0, "driver", textUpdate(PROBE_TELEGRAM_ID, "/start"));
  await cluster.postTo(1, "driver", textUpdate(PROBE_TELEGRAM_ID, "فيصل التجريبي"));
  await cluster.sync();
  const messages = cluster.messagesTo(PROBE_TELEGRAM_ID);
  return messages.at(-1)?.text ?? "(لا رسالة)";
}

export async function probeSharedSessionStore(): Promise<ProbeReport> {
  const askPhone = translate("ar", "driver.ask_phone");
  const askName = translate("ar", "driver.ask_name");
  const checks: CheckResult[] = [];
  const notes: string[] = [];

  const shared = await startCluster({ gateways: 2, sessionStore: "redis", basePort: 4451 });
  let sharedReply = "";
  try {
    sharedReply = await splitDialogAcrossProcesses(shared);
    notes.push(`مخزنٌ مشترك · ردُّ العمليةِ الثانية: «${sharedReply}»`);
    notes.push(`أوامرُ المزدوجِ المشترك: ${JSON.stringify(shared.redis.store.commandCounts())}`);
  } finally {
    await shared.stop();
  }

  const isolated = await startCluster({ gateways: 2, sessionStore: "memory", basePort: 4461 });
  let isolatedReply = "";
  try {
    isolatedReply = await splitDialogAcrossProcesses(isolated);
    notes.push(`مخزنُ ذاكرةٍ لكلِّ عملية · ردُّ العمليةِ الثانية: «${isolatedReply}»`);
  } finally {
    await isolated.stop();
  }

  checks.push(
    check(
      "system_response",
      "بمخزنٍ مشترك: الحوارُ يتقدّم في العمليةِ الثانية إلى خطوةِ الجوّال",
      sharedReply === askPhone,
      `المتوقّع=«${askPhone}» · الملاحَظ=«${sharedReply}»`,
    ),
  );
  checks.push(
    check(
      "invariant",
      "بمخزنِ ذاكرةٍ لكلِّ عملية: الحوارُ لا يتقدّم — العمليةُ الثانيةُ لا ترى الجلسة",
      isolatedReply !== askPhone,
      `الملاحَظ=«${isolatedReply}» · وهو ليس «${askPhone}»`,
    ),
  );
  checks.push(
    check(
      "business_outcome",
      "والنتيجتان مختلفتان فعلاً — فالمخزنُ المشترك سببٌ لا مصادفة",
      sharedReply !== isolatedReply,
      `مشترك=«${sharedReply}» · معزول=«${isolatedReply}» · (خطوةُ الاسم=«${askName}»)`,
    ),
  );

  return {
    id: "shared-session-negative-control",
    title: "ضبطٌ سالب: مخزنُ الجلساتِ المشتركُ شرطٌ لعملِ أكثرَ من نسخة",
    checks,
    topology: [
      "عنقودان يُقلَعان بالتتابع، كلٌّ ببوّابتين في عمليتين: الأوّلُ `SESSION_STORE=redis` والثاني `memory`.",
      "نفسُ الحوارِ ونفسُ التقسيمِ في الحالتين: `/start` إلى gw1 ثم الاسمُ إلى gw2.",
    ],
    notes,
  };
}
