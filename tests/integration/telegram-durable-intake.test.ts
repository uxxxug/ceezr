/**
 * الغرض: إثباتُ إغلاقِ `BUG-002` على قاعدةٍ حقيقيّةٍ — أنّ استلامَ تحديثِ تيليجرام
 *   **صامدٌ** ومنعَ تكرارِه **ذرّيٌّ في القاعدةِ** لا في خريطةِ ذاكرةٍ، وأنّ رفضَ
 *   حدِّ المعدَّلِ **لا يستهلك** `update_id` فلا يضيعُ التحديثُ الأصليُّ.
 *
 *   وخمسةُ أقسامٍ ههنا بحرفِ ما يوجبُه
 *   [ADR 0054](../../docs/adr/0054-telegram-webhook-durable-ingest-and-dedup.md) §٥ و§٦:
 *     (أ) المكرَّرُ: نفسُ `(bot, update_id)` مرّتين ⇒ معالجةٌ واحدةٌ وصفٌّ واحدٌ.
 *     (ب) حدُّ المعدَّلِ ثمَّ المكرَّرُ: المرفوضُ بـ`429` لا يُودَع، والإعادةُ تُقبَل.
 *     (ج) عبرَ العملياتِ: القرارُ لا يعتمد على `Map` داخلَ العمليةِ — **عمليتان
 *         منفصلتان فعلاً** بـ`Bun.spawn`، لا محاكاةٌ.
 *     (د) الحجزُ: نجاحٌ · منعُ حجزٍ متزامنٍ مزدوجٍ · استرجاعُ حجزٍ مهجورٍ · ختمٌ برمزٍ.
 *     (هـ) لا فقدَ: مكرَّراتٌ + تجاوزُ حدٍّ معاً، والأصلُ يُعالَج مرّةً ولا يضيع.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب `TEST_DATABASE_URL` بقاعدةٍ مطبَّقةٍ عليها الهجرات.
 *   **ولا يُقبل بديلٌ mock**: الذرّيّةُ وسلوكُ عبرِ العملياتِ لا يُثبتُهما إلّا محرّكٌ حقيقيٌّ.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis مع `CI_REQUIRE_DB=1`)
 * ملاحظات مستقبلية: لا يُدَّعى ههنا `exactly-once` للآثارِ الخارجيةِ ولا يُختبَر —
 *   ADR 0054 §٥/٤ ينفيه صراحةً. المُثبَتُ: الإيصالُ مرّةً واحدةً، والمعالجةُ مرّةً
 *   على الأقلِّ، وامتناعُ إعادةِ المعالجةِ بعدَ الختمِ.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createMemoryRateLimiter } from "../../apps/gateway/src/rate-limit/fixed-window.ts";
import {
  createTelegramWebhookRoutes,
  TELEGRAM_SECRET_HEADER,
} from "../../apps/gateway/src/routes/telegram-webhook.ts";
import {
  createPostgresUpdateIntake,
  type DurableUpdateIntake,
} from "../../apps/gateway/src/routes/update-intake.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

const SECRET = "durable-intake-secret";
/** مدىً مستقلٌّ عن أرقامِ سائرِ الاختباراتِ كي لا يتصادمَ صفٌّ مع صفٍّ. */
const BASE_UPDATE_ID = 910_000;

let sql: Sql;
let intake: DurableUpdateIntake;

interface ReceiptRow {
  readonly status: string;
  readonly attempts: number;
  readonly claim_token: string | null;
  readonly completed_at: Date | null;
}

/** تحديثٌ بأدنى شكلٍ يقبله المسارُ: رقمٌ ومُرسِلٌ، بلا محتوىً حسّاسٍ. */
function update(updateId: number, actorId: number): Record<string, unknown> {
  return { update_id: updateId, message: { from: { id: actorId }, text: "/start" } };
}

async function post(
  app: ReturnType<typeof createTelegramWebhookRoutes>,
  body: unknown,
): Promise<Response> {
  return await app.request(
    new Request("http://localhost/webhook/telegram/driver", {
      method: "POST",
      headers: { "content-type": "application/json", [TELEGRAM_SECRET_HEADER]: SECRET },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * بوّابةٌ بمنفَذٍ صامدٍ حقيقيٍّ وعدّادِ معالجةٍ. و`clock` يُمرَّر للحدِّ كي تُقاد
 * النافذةُ الزمنيةُ صراحةً بدلَ الانتظارِ بساعةِ الجدارِ.
 */
function buildGateway(options?: {
  readonly limit?: number;
  readonly clock?: () => number;
  readonly handled?: boolean;
}) {
  const calls: number[] = [];
  const routes = createTelegramWebhookRoutes({
    webhookSecret: SECRET,
    intake,
    handler: {
      handle: async (_bot, received) => {
        calls.push((received as { update_id: number }).update_id);
        return options?.handled ?? true;
      },
    },
    ...(options?.limit === undefined
      ? {}
      : {
          rateLimits: {
            users: createMemoryRateLimiter(
              { limit: options.limit, windowSeconds: 60 },
              options.clock ?? (() => 0),
            ),
          },
        }),
  });
  return { routes, calls };
}

function receiptsOf(updateId: number): Promise<ReceiptRow[]> {
  return sql<ReceiptRow[]>`
    select status, attempts, claim_token, completed_at
      from telegram_update_receipts
     where bot = 'driver' and update_id = ${updateId}
  `;
}

describeIf("الاستلامُ الصامدُ لتحديثاتِ تيليجرام (BUG-002)", () => {
  beforeAll(() => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    intake = createPostgresUpdateIntake(sql);
  });

  afterEach(async () => {
    await sql`delete from telegram_update_receipts where update_id >= ${BASE_UPDATE_ID}`;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  // ─────────────────────────── (أ) المكرَّر ───────────────────────────

  it("أ: التحديثُ المكرَّرُ لا يُعالَج مرّتين ولا يُودَع صفّاً ثانياً", async () => {
    const id = BASE_UPDATE_ID + 1;
    const { routes, calls } = buildGateway();

    const first = await post(routes, update(id, 5001));
    const second = await post(routes, update(id, 5001));

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, duplicate: true });

    // المعالجةُ مرّةً واحدةً — وهذا هو معنى §٥/٦.
    expect(calls).toEqual([id]);

    // والإيصالُ **مرّةً واحدةً بالضبط**: قيدُ التفرُّدِ على `(bot, update_id)` هو المانعُ.
    const rows = await receiptsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("done");
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.completed_at).not.toBeNull();
    // الختمُ يُفرِّغ الرمزَ فلا يبقى حجزٌ معلَّقٌ (قيدُ `done_is_sealed`).
    expect(rows[0]?.claim_token).toBeNull();
  });

  // ──────────────────── (ب) حدُّ المعدَّلِ ثمَّ المكرَّرُ ────────────────────

  it("ب: المرفوضُ بحدِّ المعدَّلِ لا يستهلك `update_id`، وإعادتُه تُقبَل ولا تضيع", async () => {
    const allowed = BASE_UPDATE_ID + 10;
    const rejected = BASE_UPDATE_ID + 11;
    const actor = 5002;
    let now = 0;
    // حدٌّ بواحدٍ: الطلبُ الثاني في النافذةِ نفسِها يرتدُّ حتماً.
    const { routes, calls } = buildGateway({ limit: 1, clock: () => now });

    expect((await post(routes, update(allowed, actor))).status).toBe(200);

    const blocked = await post(routes, update(rejected, actor));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ ok: false, error: "RATE_LIMITED" });

    // **جوهرُ الإصلاحِ**: الرقمُ المرفوضُ لم يُودَع، فليس «مستهلَكاً».
    expect(await receiptsOf(rejected)).toHaveLength(0);

    // انقضاءُ النافذةِ، ثمّ إعادةُ تيليجرام للتحديثِ نفسِه.
    now = 61_000;
    const retried = await post(routes, update(rejected, actor));
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({ ok: true });

    // الأصلُ عولِج ولم يُبتلَع بوصفِه «مكرَّراً» — وهذا ما كان يفشل قبلَ الإصلاحِ.
    expect(calls).toEqual([allowed, rejected]);
    expect((await receiptsOf(rejected))[0]?.status).toBe("done");
  });

  // ─────────────────── (ج) عبرَ العملياتِ لا داخلَ العمليةِ ───────────────────

  it("ج: القرارُ صامدٌ عبرَ عمليتَينِ منفصلتَينِ ولا يعتمد على ذاكرةِ العمليةِ", async () => {
    const id = BASE_UPDATE_ID + 20;

    /** عمليةٌ منفصلةٌ تماماً: `Bun.spawn` بلا ذاكرةٍ مشتركةٍ مع هذه. */
    const claimInSeparateProcess = async (): Promise<string> => {
      const script = `
        const { createSql } = await import("${import.meta.dir}/../../packages/infrastructure/db/client.ts");
        const { createPostgresUpdateIntake } = await import("${import.meta.dir}/../../apps/gateway/src/routes/update-intake.ts");
        const sql = createSql({ connectionString: process.env.TEST_DATABASE_URL });
        const result = await createPostgresUpdateIntake(sql).claim("driver", ${id});
        await sql.end({ timeout: 5 });
        console.log(JSON.stringify(result));
      `;
      const proc = Bun.spawn(["bun", "-e", script], {
        env: { ...process.env, TEST_DATABASE_URL: DATABASE_URL ?? "" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0) throw new Error(`عمليةٌ فرعيةٌ فشلت (${code}): ${err}`);
      return (JSON.parse(out.trim()) as { outcome: string }).outcome;
    };

    // العمليةُ الأولى تلتقط، ثم تموت. والإيصالُ يبقى في القاعدةِ لا في ذاكرتِها.
    expect(await claimInSeparateProcess()).toBe("claimed");

    // العمليةُ الثانيةُ — ذاكرتُها فارغةٌ تماماً — ترى الحجزَ الحيَّ ولا تُعيد الالتقاطَ.
    expect(await claimInSeparateProcess()).toBe("in_progress");

    // ولو كان القرارُ في `Map` لكانت كلتاهما «أوّلَ استلامٍ»؛ فالصفُّ واحدٌ لا اثنان.
    expect(await receiptsOf(id)).toHaveLength(1);

    // وبعدَ ختمِ العملِ يصير جوابُ أيِّ عمليةٍ «مكرَّراً» لا «قيدَ المعالجةِ».
    const token = (await receiptsOf(id))[0]?.claim_token;
    expect(token).not.toBeNull();
    expect(await intake.finish("driver", id, token ?? "", "done")).toBe(true);
    expect(await claimInSeparateProcess()).toBe("duplicate");
  }, 30_000);

  // ─────────────────────────── (د) الحجزُ ───────────────────────────

  it("د: حجزٌ ناجحٌ، ومنعُ حجزٍ متزامنٍ مزدوجٍ، واسترجاعُ حجزٍ مهجورٍ", async () => {
    const id = BASE_UPDATE_ID + 30;

    const first = await intake.claim("driver", id);
    expect(first.outcome).toBe("claimed");
    expect(first.claimToken).not.toBeNull();

    // حجزٌ متزامنٌ على الصفِّ نفسِه: لا التقاطَ ثانياً ولا انتظارَ قفلٍ (`skip locked`).
    const second = await intake.claim("driver", id);
    expect(second.outcome).toBe("in_progress");
    expect(second.claimToken).toBeNull();

    // ولا يُختَم إلّا لصاحبِ الرمزِ: رمزٌ غريبٌ يُرفَض، فلا يُنهي أحدٌ عملَ غيرِه.
    expect(await intake.finish("driver", id, "00000000-0000-4000-8000-000000000000", "done")).toBe(
      false,
    );

    // حجزٌ مهجورٌ: عمليةٌ ماتت وهي ممسكةٌ بالعملِ. تقديمُ الزمنِ يُحاكي مضيَّ المهلةِ.
    await sql`
      update telegram_update_receipts
         set claimed_at = now() - interval '1 hour'
       where bot = 'driver' and update_id = ${id}
    `;
    const reclaimed = await intake.claim("driver", id);
    expect(reclaimed.outcome).toBe("reclaimed");
    expect(reclaimed.claimToken).not.toBeNull();
    // ورمزُ الحجزِ يتبدّل، فالرمزُ القديمُ يفقد سلطتَه على الختمِ.
    expect(reclaimed.claimToken).not.toBe(first.claimToken);
    expect(await intake.finish("driver", id, first.claimToken ?? "", "done")).toBe(false);

    const rows = await receiptsOf(id);
    expect(rows[0]?.attempts).toBe(2);
    expect(rows[0]?.status).toBe("claimed");

    // وصاحبُ الحجزِ الحاليُّ يختم.
    expect(await intake.finish("driver", id, reclaimed.claimToken ?? "", "done")).toBe(true);
    expect((await receiptsOf(id))[0]?.status).toBe("done");
  });

  // ─────────────────────── (هـ) الدليلُ النهائيُّ: لا فقدَ ───────────────────────

  it("هـ: مكرَّراتٌ وتجاوزُ حدٍّ معاً — ولا تحديثَ واحدٌ يضيع", async () => {
    const actor = 5005;
    const first = BASE_UPDATE_ID + 40;
    const starved = BASE_UPDATE_ID + 41;
    let now = 0;
    // حدٌّ باثنينِ: يكفي للأوّلِ ولمكرَّرِه، ويُجهِض الثالثَ.
    const { routes, calls } = buildGateway({ limit: 2, clock: () => now });

    // ١) الأصلُ يُعالَج.
    expect((await post(routes, update(first, actor))).status).toBe(200);
    // ٢) مكرَّرُ الأصلِ يُبتلَع بلا معالجةٍ ثانيةٍ — لكنّه **يستهلك حصّةَ الحدِّ**،
    //    لأنّ إعفاءَ الإعاداتِ مسألةٌ لم يحسمها ADR 0054 (§١٠/٥) فلا تُخترَع ههنا.
    expect(await (await post(routes, update(first, actor))).json()).toEqual({
      ok: true,
      duplicate: true,
    });
    // ٣) تحديثٌ جديدٌ تماماً يرتدُّ لنفادِ الحصّةِ — وهو موضعُ الفقدِ قبلَ الإصلاحِ.
    expect((await post(routes, update(starved, actor))).status).toBe(429);
    // ٤) وتيليجرام يُعيد إرسالَه مراراً وهو ما يزال مخنوقاً.
    expect((await post(routes, update(starved, actor))).status).toBe(429);

    // لا شيءَ من ذلك أودعَ الرقمَ المخنوقَ، فلم يُحرَق.
    expect(await receiptsOf(starved)).toHaveLength(0);

    // ٥) تنقضي النافذةُ، فتصل إعادةُ تيليجرام الأخيرةُ.
    now = 61_000;
    expect((await post(routes, update(starved, actor))).status).toBe(200);

    // الحصيلةُ: كلا التحديثَينِ عولِج، وكلٌّ منهما **مرّةً واحدةً**، ولا ثالثَ ضاع.
    expect(calls).toEqual([first, starved]);
    const [firstRow] = await receiptsOf(first);
    const [starvedRow] = await receiptsOf(starved);
    expect(firstRow?.status).toBe("done");
    expect(firstRow?.attempts).toBe(1);
    expect(starvedRow?.status).toBe("done");
    expect(starvedRow?.attempts).toBe(1);
  });
});
