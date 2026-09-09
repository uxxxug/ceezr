/**
 * الغرض: إثباتُ التوصيلِ الفعليِّ للإشارةِ — أنّ `SIGTERM` تُشغّلُ التصريفَ الرشيقَ
 *   في عمليّةٍ حقيقيّةٍ: البوابةُ تُقلع، تُجيبُ `/health`، ثمّ عند الإشارةِ تتوقّفُ عن
 *   قبولِ الجديدِ، تُغلقُ مواردَها، وتخرجُ برمزِ `0` ضمنَ مهلةٍ معقولة. وهذا هو
 *   «برهانُ SIGTERM» الذي يُقلبُ `F5-05` إلى `[x]` لا المنطقُ وحده.
 * الحالة: اختبار عمليّةٍ فرعيّةٍ فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI (`bun run test`).
 * ملاحظات مستقبلية: لا تُلمسُ القاعدةُ ولا Redis في مسارِ الاختبارِ المُختبَرِ (الإشارةُ
 *   والاستجابةُ)، لكنّ البوابةَ تُحاولُ تيليجرامَ (401) والقاعدةَ (ECONNREFUSED) في
 *   الخلفيّةِ عندَ الإقلاعِ — وهي محاولاتٌ نارٌ في الخلفيّةِ لا تُعلِّقُ الاستماعَ،
 *   والفحصُ يثبتُ مسارَ الإشارةِ إلى الإغلاقِ لا صحّةَ التبعيّاتِ.
 */

import { describe, expect, it } from "bun:test";

/** قيمٌ صناعيّةٌ شكلاً لا تُصيبُ خدمةً حقيقيّةً — تُمكِّنُ العبورَ فوقَ حارسِ الإقلاعِ. */
const FAKE_ENV: Record<string, string> = {
  NODE_ENV: "production",
  PROCESS_TOPOLOGY: "single-process",
  SESSION_STORE: "redis",
  PORT: "38712",
  // TELEGRAM_TRANSPORT يُتركُ للافتراضِ `real` — هو المقبولُ الوحيدُ في الإنتاجِ،
  // وإعدادُ البوتِ لا يُعلِّقُ الإقلاعَ (نارٌ في الخلفيّةِ لا تمنعُ الاستماعَ).
  DATABASE_URL: "postgres://u:p@127.0.0.1:5432/fake_db",
  SUPABASE_URL: "https://fake.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key-with-enough-length",
  UPSTASH_REDIS_REST_URL: "https://fake.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "fake-token-with-enough-length-padding",
  DRIVER_BOT_TOKEN: "1111111:fake-driver-token-padding-padding-padding",
  RIDER_BOT_TOKEN: "2222222:fake-rider-token-padding-padding-padding",
  TELEGRAM_WEBHOOK_SECRET: "fake-webhook-secret-with-enough-length-padding",
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "999999999",
  // إعلانٌ إلزاميٌّ في الإنتاجِ منذ `F5-04` (ADR 0063). و`false` ههنا مقصودةٌ:
  // المُختبَرُ مسارُ الإشارةِ إلى الخروجِ، وعاملٌ مضمَّنٌ كان سيفتح تجمّعَ اتصالاتٍ
  // ثانياً على قاعدةٍ لا وجودَ لها فيُبطئَ الإغلاقَ بما ليس منه.
  RUN_WORKER_IN_GATEWAY: "false",
  // `F5-08` / ADR 0064: الطفلُ يُقلعُ ببيئةِ إنتاجٍ، والإعلانُ صارَ إلزاميّاً فيها.
  // و`false` ههنا لا تُعطِّلُ ما يقيسُهُ هذا الملفُّ: اللوحةُ ليست موضوعَهُ أصلاً.
  RUN_ADMIN_IN_GATEWAY: "false",
};

interface SpawnedGateway {
  readonly port: number;
  readonly child: ReturnType<typeof Bun.spawn>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
}

/**
 * مهلةُ الإقلاعِ. **ليست مهلةَ توكيدٍ بل شرطُ تمهيدٍ**: المُختبَرُ ما يقعُ **بعدَ**
 * `SIGTERM`، وتوكيدُه (الخروجُ بصفرٍ خلالَ ثمانٍ) لم يُمَسَّ حرفاً. ورُفِعَت من خمسَ
 * عشرةَ ثانيةً لأنّ الإخفاقَ المرصودَ وقعَ عندَ `15092ms` بالضبطِ — أي على حافّةِ
 * المهلةِ نفسِها لا دونَها — في جولةِ `test:coverage` حيث يُثقِلُ قياسُ التغطيةِ
 * إقلاعَ عمليّةٍ فرعيّةٍ، **وإعادةُ تشغيلِ الوظيفةِ نفسِها بلا تغييرِ سطرٍ نجحَت**؛
 * فاللااحتميّةُ مُثبَتةٌ بالتجربةِ لا مُستنتَجةٌ.
 */
const BOOT_TIMEOUT_MS = 40_000;

/** مهلةُ الحالةِ: إقلاعٌ ثمّ نافذةُ إغلاقٍ ثمّ هامشٌ — لا تُرخي توكيداً. */
const CASE_TIMEOUT_MS = 70_000;

/**
 * منفذٌ فريدٌ **حتماً** لا عشوائيّاً. العشوائيُّ يجوزُ أن يصطدمَ بمنفذٍ مشغولٍ على
 * عاملِ CI فيُخفِقَ الإقلاعُ بلا ذنبٍ للمُختبَرِ — ومصدرُ عشوائيّةٍ في بوّابةٍ لا
 * مقابلَ له هاهُنا.
 */
let nextPortOffset = 0;

/**
 * يقرأُ المجرى إلى آخرِه في الخلفيّةِ ويحتفظُ بما قرأ. **والقراءةُ إلى الآخرِ شرطٌ
 * لا ترفٌ**: النسخةُ السابقةُ كانت تقرأُ **قطعةً واحدةً** ثمّ تتركُ الأنبوبَ، فإذا
 * أكثرَتِ البوابةُ من السجلِّ امتلأَ فتوقّفَت عندَ الكتابةِ قبلَ أن تستمعَ — وهذا
 * إقلاعٌ لا يكتملُ أبداً لا إقلاعٌ بطيءٌ. ويُفيدُ المحفوظُ أنّ إخفاقَ الإقلاعِ يظهرُ
 * بسببِه لا بجملةٍ عامّةٍ لا تدلُّ على شيءٍ.
 */
function drain(stream: ReadableStream<Uint8Array>, into: string[]): void {
  void (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value !== undefined) into.push(decoder.decode(chunk.value, { stream: true }));
      }
    } catch {
      // أُغلقَ الأنبوبُ مع العمليّةِ — متوقّعٌ وليسَ إخفاقاً.
    }
  })();
}

/**
 * يُطلقُ البوابةَ بمنفذٍ فريدٍ، ينتظرُ أن تُجيبَ `/health`، ثمّ يُعيدُ مقبضَها.
 * `PORT` فريدٌ حتميّاً لتجنُّبِ تعارضِ المنافذِ في CI. ولا نقرأُ السجلَّ حُكماً — يكفي
 * أنّ الخادمَ يستقبلُ فعلاً (برهانُه استجابةُ `/health`) — وإنّما يُحفَظُ
 * للتشخيصِ عندَ إخفاقِ الإقلاعِ.
 */
async function bootGateway(): Promise<SpawnedGateway> {
  nextPortOffset += 1;
  const port = 31_000 + ((process.pid + nextPortOffset * 7) % 9_000);
  const child = Bun.spawn(["bun", "apps/gateway/src/index.ts"], {
    env: { PATH: process.env.PATH ?? "", ...FAKE_ENV, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });

  // نُفرّغُ المجرَيين إلى آخرِهما حتى لا يتوقّفَ الإجراءُ عند امتلاءِ الأنبوب.
  const out: string[] = [];
  const errOut: string[] = [];
  drain(child.stdout, out);
  drain(child.stderr, errOut);

  const healthOk = await waitForHealth(port, BOOT_TIMEOUT_MS);
  if (!healthOk) {
    child.kill();
    const tail = `${out.join("")}\n${errOut.join("")}`.trim().slice(-2_000);
    throw new Error(
      `لم يُجبِ /health على المنفذِ ${port} خلالَ ${BOOT_TIMEOUT_MS} ملّي ثانية.\nمخرجاتُ العمليّةِ:\n${tail}`,
    );
  }

  return { port, child, stdout: child.stdout, stderr: child.stderr };
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.status === 200) return true;
    } catch {
      // ما زالت لم تُقلع — نُعيدُ المحاولة.
    }
    await Bun.sleep(100);
  }
  return false;
}

describe("البوابةُ — الإغلاقُ الرشيقُ عند SIGTERM (F5-05)", () => {
  it(
    "SIGTERM ⇒ توقّفٌ عن القبولِ ثمّ خروجٌ برمزِ صفرٍ ضمنَ مهلة",
    async () => {
      const { port, child } = await bootGateway();

      // نُرسلُ الإشارةَ الفعليّة.
      process.kill(child.pid, "SIGTERM");

      // وننتظرُ الخروجَ — رشيقٌ يعني برمزِ صفرٍ وبسرعةٍ لا انهيارٍ.
      const exitCode = await Promise.race([child.exited, Bun.sleep(8_000).then(() => -1)]);

      expect(exitCode).toBe(0);
      void port;
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "أثناءَ التصريفِ: `/ready` يرتدُّ غيرَ جاهزٍ قبلَ الإغلاق",
    async () => {
      const { port, child } = await bootGateway();

      // قبلَ الإشارة: `/ready` يُجيب (قد يفشلُ الفحصُ بلا قاعدة، لكنّه يُجيب، لا يُعلَّق).
      const before = await fetch(`http://127.0.0.1:${port}/ready`);
      expect([200, 503]).toContain(before.status);

      // **ولا نُطلقُ «طلباتٍ جاريةً» تُبقي الخادمَ مشغولاً.** كانت النسخةُ السابقةُ
      // تُطلقُ أربعةَ `/ready` بهذه النيّةِ، **والنيّةُ باطلةٌ في الواقعِ**: غلافُ
      // `Bun.serve` في `apps/gateway/src/index.ts` يستثني `/health` و`/ready` من
      // عدّادِ الجاري صريحاً («فحوصُ الصحةِ لا تُعدُّ جاريةً — لا تُؤخِّرُ التصريفَ»)،
      // فكانت الأربعةُ لا تُبطئُ التصريفَ لحظةً واحدةً، وما أنجحَ الاختبارَ حتى الآن
      // سباقٌ محضٌ بينَ `close()` وأولِ استطلاعٍ. والنافذةُ الآنَ مضمونةٌ
      // بـ`announceMs` في دورةِ الحياةِ نفسِها.
      process.kill(child.pid, "SIGTERM");

      let drainingSeen = false;
      const start = Date.now();
      while (Date.now() - start < 3_000) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/ready`);
          const body = (await res.json()) as { status: string };
          if (res.status === 503 && body.status === "draining") {
            drainingSeen = true;
            break;
          }
        } catch {
          // أُغلقَ الاتصالُ بعدَ اكتمالِ التصريفِ — متوقَّعٌ.
        }
        await Bun.sleep(5);
      }

      expect(drainingSeen).toBe(true);
      await child.exited;
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "أثناءَ التصريفِ: المسارُ غيرُ الصحيِّ يُرفَضُ بـ503 draining (بوّابةُ الجديد)",
    async () => {
      const { port, child } = await bootGateway();

      // قبلَ الإشارةِ: المسارُ غيرُ الموجودِ يردُّ 404 (لا حارسَ يرفضُه بعد).
      const before = await fetch(`http://127.0.0.1:${port}/__drain_probe__`);
      expect(before.status).toBe(404);

      // النافذةُ مضمونةٌ بـ`announceMs` لا بطلباتٍ «جاريةٍ» لا تُعَدُّ جاريةً — انظرِ
      // الحالةَ السابقةَ.
      process.kill(child.pid, "SIGTERM");

      let gateSeen = false;
      const start = Date.now();
      while (Date.now() - start < 3_000) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/__drain_probe__`);
          const body = (await res.json()) as { status?: string };
          // البوّابةُ ترفضُ الجديدَ بـ503 draining لا تُمرِّرُه إلى التطبيق.
          if (res.status === 503 && body.status === "draining") {
            gateSeen = true;
            break;
          }
        } catch {
          // أُغلقَ الاتصالُ بعدَ اكتمالِ التصريفِ — متوقَّعٌ.
        }
        await Bun.sleep(5);
      }

      expect(gateSeen).toBe(true);
      await child.exited;
    },
    CASE_TIMEOUT_MS,
  );
});
