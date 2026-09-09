/**
 * الغرض: الاستلامُ الصامدُ لتحديثاتِ تيليجرام — منفَذٌ واحدٌ يُودِع الإيصالَ ويقرّر
 *    التكرارَ ويحجز العملَ في نداءٍ **ذرّيٍّ** واحدٍ، وتنفيذٌ فوقَ PostgreSQL يُنادي
 *    `claim_telegram_update` / `finish_telegram_update`.
 *    الشطرُ التنفيذيُّ من [ADR 0054](../../../../docs/adr/0054-telegram-webhook-durable-ingest-and-dedup.md) §٣-أ.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-09-04 لإغلاقِ `BUG-002`، ومُختبَرٌ على قاعدةٍ حقيقيّةٍ
 *    في `tests/integration/telegram-durable-intake.test.ts`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/routes/telegram-webhook.ts`،
 *    `apps/gateway/src/index.ts`، `bench/topology/gateway-process.ts`
 * ملاحظات مستقبلية: يومَ يُفصَل عاملٌ يستهلك العملَ خارجَ طلبِ `HTTP` (`CAP-001`) يُقرأ
 *    من هذا الجدولِ نفسِه؛ **ويوجب ذلك حسمَ موضعِ الحمولةِ** لأنّ ADR 0054 §٧/١ يمنع
 *    تخزينَ التحديثِ الخام، ولا يُخترَع الحسمُ ههنا.
 *
 * ## لماذا منفَذٌ لا نداءُ `sql` مباشرٌ في المسار
 *
 * المسارُ يجب أن يبقى قابلاً للاختبارِ بلا قاعدةٍ (نحو خمسٍ وثلاثينَ ملفَّ اختبارٍ
 * يُركّبونه اليوم)، والقرارُ نفسُه يجب أن يبقى في القاعدةِ. فالمنفَذُ يفصل الأمرين:
 * المسارُ يعرف **الدلالةَ** (أوّلُ استلامٍ · مكرَّرٌ · قيدَ المعالجةِ)، والقاعدةُ تعرف
 * **كيف** تُقرَّر ذرّيّاً.
 *
 * ## الدلالاتُ الأربعُ — بحرفِ عقدِ §٥ من ADR 0054
 *
 * - `claimed`: أوّلُ استلامٍ لهذا `(bot, update_id)`. أُودِع الإيصالُ وحُجِز العملُ.
 * - `reclaimed`: إيصالٌ قائمٌ غيرُ مختومٍ استُؤنِف — فشلٌ سابقٌ أو حجزٌ مهجورٌ. وإعادةُ
 *   إرسالِ تيليجرام هي ناقلُ الحمولةِ، فالمعالجةُ «مرّةً على الأقلِّ» تتحقّق بلا تخزينِ
 *   محتوىً (§٥/٣ مع §٧/١).
 * - `duplicate`: مكرَّرٌ حقيقيٌّ — عُولِج وخُتِم. **لا إعادةَ معالجةٍ** (§٥/٦).
 * - `in_progress`: محجوزٌ حجزاً حيّاً في مكانٍ آخرَ. لا معالجةَ ثانيةً ولا انتظارَ قفلٍ.
 */

import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import { readEnvelope } from "../../../../packages/infrastructure/db/client.ts";
import {
  TELEGRAM_INTAKE_CLAIM_TIMEOUT_SECONDS,
  TELEGRAM_JOB_PRODUCER_LIMIT,
} from "../../../../packages/shared/config/domain-ingress.ts";

export type IntakeOutcome = "claimed" | "reclaimed" | "duplicate" | "in_progress";

/**
 * نتيجةُ الإيداعِ غيرِ المتزامنِ للوظيفةِ (ACK سريع). لا حجزَ فيها للمسارِ —
 * المعالجةُ تتمُّ لاحقاً في الدرينرِ الخلفيِّ لا في طلبِ HTTP.
 *
 * - `enqueued`: أوّلُ استلامٍ — أُودِع الإيصالُ والوظيفةُ بالحمولةِ، فدخلَ الطابور.
 * - `duplicate`: مكرَّرٌ مختومٌ سلفاً — **لا عملٌ ثانٍ ولا إعادةُ ضبطٍ** (§٥/٦ وADR 0057).
 * - `in_progress`: إيصالٌ قائمٌ غيرُ مختومٍ — الوظيفةُ موجودةٌ (معلَّقةٌ أو محجوزةٌ أو ميّتةٌ)،
 *   فلا يُنشأُ لها عملٌ ثانٍ، ولا يُصفَّرُ الموجودُ عند إعادةِ تسليمٍ مكرَّرةٍ.
 * - `shed`: الطابورُ بلغَ حدَّ المنتِجِ (F6-06) — **لم يُستهلَكْ رقمُ التحديثِ**،
 *   فالمسارُ يردُّ 429 وإعادةُ إرسالِ تيليجرام مقبولةٌ لاحقاً. تأجيلٌ لا فقدٌ.
 */
export type EnqueueOutcome = "enqueued" | "duplicate" | "in_progress" | "shed";

export interface IntakeClaim {
  readonly outcome: IntakeOutcome;
  /** رمزُ الحجزِ — يوجد مع `claimed`/`reclaimed` وحدَهما، وبه وحدَه يُختَم. */
  readonly claimToken: string | null;
}

/**
 * منفذُ الإيداعِ غيرِ المتزامنِ — ما يحتاجُه مسارُ الويبهوكِ وحدَه. لا يُختمُ ههنا:
 * الختمُ شأنُ الدرينرِ الذي يملكُ إيجارَ الوظيفةِ. وجودُ هذا المنفذِ الضيّقِ منفصلاً
 * عن `DurableUpdateIntake` يمنعُ عودةَ أحدٍ إلى مسارِ «claim + handler + finish» داخلَ
 * طلبِ HTTP — فنوعُ اعتمادِ الويبهوكِ enqueue-only.
 */
export interface TelegramUpdateEnqueuer {
  /**
   * يُودعُ الإيصالَ والوظيفةَ بالحمولةِ ذرّيًّا في نداءٍ واحدٍ، ويعيدُ القرارَ.
   * يرمي عندَ عجزِ القاعدةِ — والمسارُ يُترجمه إلى `503` فيُعيدُ تيليجرام الإرسالَ.
   * إعادةُ تسليمٍ مكرَّرةٌ لا تُعيدُ ضبطَ وظيفةٍ موجودةٍ.
   */
  claimAndEnqueue(bot: string, updateId: number, payload: unknown): Promise<EnqueueOutcome>;
}

export interface DurableUpdateIntake {
  /**
   * يُودِع إيصالَ استلامٍ أو يستأنف حجزَه، ذرّيّاً. يرمي عندَ عجزِ القاعدةِ: عجزُ
   * الإيداعِ **ليس إذناً بالمعالجةِ ولا بالإقرارِ** — والمسارُ يترجمه إلى `503` كي
   * يُعيد تيليجرام الإرسالَ، فلا يُفقَد التحديثُ.
   */
  claim(bot: string, updateId: number): Promise<IntakeClaim>;
  /** يختم الإيصالَ لصاحبِ الرمزِ وحدَه. يعيد `false` إن لم يكن الرمزُ صاحبَ الحجزِ. */
  finish(
    bot: string,
    updateId: number,
    claimToken: string,
    status: "done" | "failed",
    errorCode?: string,
  ): Promise<boolean>;
}

function isOutcome(value: unknown): value is IntakeOutcome {
  return (
    value === "claimed" || value === "reclaimed" || value === "duplicate" || value === "in_progress"
  );
}

function isEnqueueOutcome(value: unknown): value is EnqueueOutcome {
  return (
    value === "enqueued" || value === "duplicate" || value === "in_progress" || value === "shed"
  );
}

/**
 * التنفيذُ فوقَ PostgreSQL. لا منطقَ قرارٍ ههنا بحالٍ: النداءُ واحدٌ، والقرارُ في
 * الدالّةِ — فلا يُقرَأ ثمّ يُكتَب من طبقتين مختلفتين، ولا نافذةَ بينهما تُقتنص.
 */
export function createPostgresUpdateIntake(
  sql: Sql,
  options?: { readonly claimTimeoutSeconds?: number; readonly producerDepthLimit?: number },
): DurableUpdateIntake & TelegramUpdateEnqueuer {
  const timeoutSeconds = options?.claimTimeoutSeconds ?? TELEGRAM_INTAKE_CLAIM_TIMEOUT_SECONDS;
  // حدُّ المنتِجِ يسكنُ حيثُ يسكنُ حدُّ إعادةِ المحاولةِ لهذا الطابورِ: ثابتٌ في
  // `domain-ingress` لا مفتاحٌ لكلِّ مدينةٍ — فالطابورُ بلا مدينةٍ بإذنِ الملحقِ.
  const producerDepthLimit = options?.producerDepthLimit ?? TELEGRAM_JOB_PRODUCER_LIMIT;

  return {
    claimAndEnqueue: async (bot, updateId, payload) => {
      const rows = await sql<{ result: unknown }[]>`
        select claim_and_enqueue_telegram_update(
          ${bot}, ${updateId}, ${sql.json(payload as never)}, ${timeoutSeconds},
          ${producerDepthLimit}
        ) as result
      `;
      const envelope = readEnvelope(rows[0]?.result);
      if (envelope === null || !envelope.ok) {
        throw new Error(`TELEGRAM_INTAKE_ENQUEUE_FAILED:${String(envelope?.error ?? "UNKNOWN")}`);
      }
      const outcome = envelope.outcome;
      if (!isEnqueueOutcome(outcome)) {
        throw new Error("TELEGRAM_INTAKE_ENQUEUE_FAILED:UNKNOWN_OUTCOME");
      }
      return outcome;
    },

    claim: async (bot, updateId) => {
      const rows = await sql<{ result: unknown }[]>`
        select claim_telegram_update(${bot}, ${updateId}, ${timeoutSeconds}) as result
      `;
      const envelope = readEnvelope(rows[0]?.result);
      if (envelope === null || !envelope.ok) {
        throw new Error(`TELEGRAM_INTAKE_CLAIM_FAILED:${String(envelope?.error ?? "UNKNOWN")}`);
      }
      const outcome = envelope.outcome;
      if (!isOutcome(outcome)) {
        throw new Error("TELEGRAM_INTAKE_CLAIM_FAILED:UNKNOWN_OUTCOME");
      }
      const token = envelope.claim_token;
      return { outcome, claimToken: typeof token === "string" ? token : null };
    },

    finish: async (bot, updateId, claimToken, status, errorCode) => {
      const rows = await sql<{ result: unknown }[]>`
        select finish_telegram_update(
          ${bot}, ${updateId}, ${claimToken}::uuid, ${status}, ${errorCode ?? null}
        ) as result
      `;
      const envelope = readEnvelope(rows[0]?.result);
      return envelope?.ok === true;
    },
  };
}
