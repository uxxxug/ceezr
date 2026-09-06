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
};

interface SpawnedGateway {
  readonly port: number;
  readonly child: ReturnType<typeof Bun.spawn>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
}

/**
 * يُطلقُ البوابةَ بمنفذٍ عشوائيٍّ، ينتظرُ أن تُجيبَ `/health`، ثمّ يُعيدُ مقبضَها.
 * `PORT` عشوائيٌّ لتجنُّبِ تعارضِ المنافذِ في CI. لا نقرأُ السجلَّ — يكفي
 * أنّ الخادمَ يستقبلُ فعلاً (برهانُه استجابةُ `/health`).
 */
async function bootGateway(): Promise<SpawnedGateway> {
  const port = 30_000 + Math.floor(Math.random() * 20_000);
  const child = Bun.spawn(["bun", "apps/gateway/src/index.ts"], {
    env: { PATH: process.env.PATH ?? "", ...FAKE_ENV, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });

  // نُفرّغُ المخزنَ المؤقتَّ حتى لا يتوقّفَ الإجراءُ عند امتلاءِ الأنبوب.
  void child.stdout
    .getReader()
    .read()
    .catch(() => {});
  void child.stderr
    .getReader()
    .read()
    .catch(() => {});

  const healthOk = await waitForHealth(port, 15_000);
  if (!healthOk) {
    child.kill();
    throw new Error(`لم يُجبِ /health على المنفذِ ${port} خلالَ المهلة`);
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
  it("SIGTERM ⇒ توقّفٌ عن القبولِ ثمّ خروجٌ برمزِ صفرٍ ضمنَ مهلة", async () => {
    const { port, child } = await bootGateway();

    // نُرسلُ الإشارةَ الفعليّة.
    process.kill(child.pid, "SIGTERM");

    // وننتظرُ الخروجَ — رشيقٌ يعني برمزِ صفرٍ وبسرعةٍ لا انهيارٍ.
    const exitCode = await Promise.race([child.exited, Bun.sleep(8_000).then(() => -1)]);

    expect(exitCode).toBe(0);
    void port;
  }, 30_000);

  it("أثناءَ التصريفِ: `/ready` يرتدُّ غيرَ جاهزٍ قبلَ الإغلاق", async () => {
    const { port, child } = await bootGateway();

    // قبلَ الإشارة: `/ready` يُجيب (قد يفشلُ الفحصُ بلا قاعدة، لكنّه يُجيب، لا يُعلَّق).
    const before = await fetch(`http://127.0.0.1:${port}/ready`);
    expect([200, 503]).toContain(before.status);

    // نُطلقُ عدّةَ طلباتٍ جاريةٍ (غيرَ منتظَرة) تُبقي الخادمَ مشغولاً لحظةَ
    // الإشارةِ، فيبقى يستقبلُ حتى يردَّ `/ready` بـ«مُصرِّف» قبلَ الإغلاقِ.
    const pending = Array.from({ length: 4 }, () =>
      fetch(`http://127.0.0.1:${port}/ready`).catch(() => {}),
    );

    // نُرسلُ الإشارةَ مباشرةً بعد إطلاقِ الجاري — فلا يفرغُ بعد.
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
    await Promise.allSettled(pending);
    await child.exited;
  }, 30_000);

  it("أثناءَ التصريفِ: المسارُ غيرُ الصحيِّ يُرفَضُ بـ503 draining (بوّابةُ الجديد)", async () => {
    const { port, child } = await bootGateway();

    // قبلَ الإشارةِ: المسارُ غيرُ الموجودِ يردُّ 404 (لا حارسَ يرفضُه بعد).
    const before = await fetch(`http://127.0.0.1:${port}/__drain_probe__`);
    expect(before.status).toBe(404);

    // نُطلقُ طلباتٍ جاريةً تُبقي الخادمَ مشغولاً أثناءَ نافذةِ الإغلاقِ، فيبقى يستقبلُ
    // ويُطبِّقُ بوّابةَ التصريفِ على المسارِ غيرِ الصحيِّ.
    const pending = Array.from({ length: 4 }, () =>
      fetch(`http://127.0.0.1:${port}/ready`).catch(() => {}),
    );

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
    await Promise.allSettled(pending);
    await child.exited;
  }, 30_000);
});
