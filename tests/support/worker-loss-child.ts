/**
 * الغرض: عمليّةُ عاملٍ حقيقيّةٌ تُقتَلُ بـ`SIGKILL` وهيَ تحملُ القفلَ والحجزَ — طرفُ `F11-02`.
 * الحالة: منفّذ فعلياً — يُشغَّل من tests/integration/worker-loss-reclaim.test.ts
 * ينتمي إلى: tests/support
 * يُتوقع أن يستخدمه لاحقاً: كلُّ قياسِ فقدانِ عاملٍ يحتاجُ موتاً حقيقيّاً لا حجزاً مُصطنَعاً.
 * ملاحظات مستقبلية: لا يُقلِعُ `buildWorkerContainer` — تلكَ تحتاجُ إعداداً كاملاً وتيليجرامَ حقيقيّاً،
 *   والمقيسُ ههنا قطعُ المشغّلِ والقفلِ والمنفذِ الحقيقيّةِ لا الحاوية.
 *
 * ولماذا عمليّةٌ لا دالّةٌ؟ لأنَّ ما يَعِدُ به `advisory-lock.ts` («نسخةُ عاملٍ قُتِلَت لا تُخلِّفُ قفلاً
 * أبديّاً») وعدٌ عن **جلسةٍ تموتُ بموتِ عمليّتِها**، وهذا لا يُرى في عمليّةٍ واحدةٍ: الحجزُ المتروكُ
 * بتعديلِ `claimed_at` يُثبِتُ الاسترجاعَ ولا يُثبِتُ أنَّ القفلَ يُحرَّرُ.
 *
 * المُعامَلات: `<رابطُ القاعدةِ> <رابطُ تيليجرامَ المُزيَّفِ>` — الناشرُ يطلبُ أوّلاً `/gate` (يحبسُه
 * الأبُ ليقتلَ قبلَ الإرسالِ) ثمَّ `/send` (يحبسُه الأبُ ليقتلَ بعدَ الوصولِ وقبلَ الإقرارِ).
 */

import { deliverNotifications } from "../../apps/workers/src/jobs/deliver-notifications.ts";
import { createJobRunner } from "../../apps/workers/src/runner.ts";
import { createOfferNotificationHandler } from "../../packages/application/dispatch/deliver-offer-notification.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { createSql } from "../../packages/infrastructure/db/client.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";
import { createAdvisoryLock } from "../../packages/infrastructure/scheduling/advisory-lock.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

/** اسمُ المهمّةِ كما يُسجِّلُه العاملُ — مفتاحُ القفلِ الاستشاريِّ مشتقٌّ منه. */
export const WORKER_LOSS_JOB = "deliver-notifications";

async function main(): Promise<void> {
  const [databaseUrl, telegramUrl] = process.argv.slice(2);
  if (databaseUrl === undefined || telegramUrl === undefined) {
    console.error("الاستعمال: worker-loss-child.ts <databaseUrl> <telegramUrl>");
    process.exit(2);
  }
  const sql = createSql({ connectionString: databaseUrl });
  const handler = createOfferNotificationHandler({
    publishOffer: async (notification) => {
      try {
        const body = JSON.stringify({ offerId: String(notification.offerId), pid: process.pid });
        await fetch(`${telegramUrl}/gate`, { method: "POST", body });
        const sent = await fetch(`${telegramUrl}/send`, { method: "POST", body });
        const json = (await sent.json()) as { message_id?: string };
        return json.message_id === undefined
          ? err(new PortFailureError("publisher.publishOffer", "TELEGRAM_SEND_FAILED"))
          : ok(json.message_id);
      } catch (error) {
        return err(new PortFailureError("publisher.publishOffer", String(error)));
      }
    },
  });
  const runner = createJobRunner({
    jobs: [
      {
        name: WORKER_LOSS_JOB,
        everySeconds: 1,
        runOnStart: true,
        run: async () => {
          const report = await deliverNotifications({
            outbox: createNotificationOutboxPort(sql),
            handlers: { offer: handler },
          });
          const line = report.ok ? JSON.stringify(report.value) : String(report.error);
          console.log(`RUN ${line}`);
          return line;
        },
      },
    ],
    lock: createAdvisoryLock(sql),
    clock: { now: () => new Date() },
    log: { info: () => {}, error: (m, f) => console.error(m, JSON.stringify(f ?? {})) },
    tickMs: 200,
  });
  runner.start();
  console.log(`READY ${process.pid}`);
}

if (import.meta.main) {
  await main();
}
