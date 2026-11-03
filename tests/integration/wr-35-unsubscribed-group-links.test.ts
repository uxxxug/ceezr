/**
 * الغرض: WR-35 على قاعدةٍ حقيقيّةٍ — رابطُ قروبِ سائقي المدينةِ غيرِ المشتركين
 *   يصلُ السائقَ عندَ انتهاءِ تجربتِه، بالرابطِ الصحيحِ لمدينتِه وحدَها، مرّةً
 *   واحدةً، ولا يصلُ ما لم يَعُد مناسبًا (تجديدٌ قبلَ التسليمِ، حظرٌ، مدينةٌ بلا
 *   رابطٍ معتمَدٍ، رابطٌ تالفٌ، سائقٌ موقوفٌ).
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديلٍ على `claim_subscription_notices` أو
 *   `expire_due_subscriptions` أو إعدادِ `unsubscribed_drivers_group_link`.
 * ملاحظات مستقبلية: إن أُضيفت مدينةٌ سادسةٌ برابطٍ معتمَدٍ تُضافُ إلى `APPROVED`.
 *
 * ولماذا يُعادُ تشغيلُ بذرِ الهجرةِ هنا؟ لأنّ ملفّاتِ تكاملٍ أخرى تضعُ رابطًا
 * تجريبيًّا لجدّة ولا تُعيده؛ فالاختبارُ يُفرِغُ الإعدادَ ثمّ يُشغِّلُ نصَّ الهجرةِ
 * نفسَه — فيقيسُ الهجرةَ لا حالةً موروثةً — ويُعيدُ ما وجده في النهاية.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deliverSubscriptionNotices } from "../../packages/application/subscription/deliver-notices.ts";
import type { SubscriptionNoticePublisher } from "../../packages/application/subscription/notice-ports.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createSubscriptionNoticeDeliveryPort } from "../../packages/infrastructure/subscription/notice-adapters.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const APPROVED: Readonly<Record<string, string>> = {
  JED: "https://t.me/ODD_Jeddah_drivers",
  MKK: "https://t.me/ODD_Mecca_drivers",
  RUH: "https://t.me/ODD_AL_Riyadh_drivers",
  TIF: "https://t.me/ODD_AL_Taif_drivers",
  MED: "https://t.me/ODD_AL_Madinah_drivers",
};
const CODES = Object.keys(APPROVED);
const KEY = "unsubscribed_drivers_group_link";
const MIGRATION = join(
  import.meta.dir,
  "../../supabase/migrations/20261103163500_wr_35_unsubscribed_group_links.sql",
);

let sql: Sql;
let cityIds: Record<string, string> = {};
let cityNames: Record<string, string> = {};
let original: { city_id: string; value: unknown; is_provisional: boolean }[] = [];
let chatCounter = 935_000;

/** جزءُ البذرِ من الهجرةِ بعينِه: كتلةُ `do $$ … $$;` الأولى. */
function seedBlock(): string {
  const text = readFileSync(MIGRATION, "utf8");
  const start = text.indexOf("do $$");
  const end = text.indexOf("$$;", start + 5);
  if (start < 0 || end < 0) throw new Error("لم يُعثَر على كتلةِ البذرِ في الهجرة");
  return text.slice(start, end + 3);
}

async function linkOf(code: string): Promise<{ value: string | null; provisional: boolean }> {
  const rows = await sql<{ value: string | null; is_provisional: boolean }[]>`
    select value #>> '{}' as value, is_provisional
      from platform_settings where city_id = ${cityIds[code] ?? ""}::uuid and key = ${KEY}
  `;
  return { value: rows[0]?.value ?? null, provisional: rows[0]?.is_provisional ?? true };
}

async function setLink(code: string, value: string): Promise<void> {
  await sql`
    update platform_settings set value = ${sql.json(value)}
     where city_id = ${cityIds[code] ?? ""}::uuid and key = ${KEY}
  `;
}

/** سائقٌ موثَّقٌ في مدينةٍ بتجربةٍ انتهت قبلَ دقيقةٍ — المدّةُ لا تُفترَض. */
async function expiredTrialDriver(
  code: string,
  opts: { language?: string; verification?: string } = {},
): Promise<{ driverId: string; userId: string; chat: string; subscriptionId: string }> {
  const cityId = cityIds[code] ?? "";
  chatCounter += 1;
  const chat = String(chatCounter);
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}::uuid, ${chat}::bigint, 'سائق WR-35', ${`+9665${chat}`}, 'driver',
            ${opts.language ?? "ar"})
    returning id
  `;
  const userId = users[0]?.id ?? "";
  const drivers = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}::uuid, ${userId}::uuid, ${opts.verification ?? "verified"}::verification_status,
            'sedan', ${`WR35-${chat}`})
    returning id
  `;
  const driverId = drivers[0]?.id ?? "";
  const subs = await sql<{ id: string }[]>`
    insert into subscriptions (city_id, driver_id, plan, status, trial_ends_at)
    values (${cityId}::uuid, ${driverId}::uuid, 'transport', 'trialing', now() - interval '1 minute')
    returning id
  `;
  return { driverId, userId, chat, subscriptionId: subs[0]?.id ?? "" };
}

type Sent = { chatId: string; text: string };

function recorder(
  sent: Sent[],
  fail: { remaining: number } = { remaining: 0 },
): SubscriptionNoticePublisher {
  let messageId = 70_000;
  return {
    publish: async (target) => {
      if (fail.remaining > 0) {
        fail.remaining -= 1;
        return err({ code: "TELEGRAM_TIMEOUT", permanent: false });
      }
      sent.push({ chatId: target.chatId, text: target.text });
      messageId += 1;
      return ok({ messageId: String(messageId) });
    },
  };
}

async function deliver(code: string, publisher: SubscriptionNoticePublisher) {
  const result = await deliverSubscriptionNotices(cityIds[code] ?? "", {
    notices: createSubscriptionNoticeDeliveryPort(sql),
    publisher,
  });
  if (!result.ok) throw new Error(`فشل شوط التسليم: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function noticeOf(subscriptionId: string, kind = "trial_expired") {
  const rows = await sql<
    {
      status: string;
      error_code: string | null;
      attempts: number;
      payload: Record<string, unknown>;
    }[]
  >`
    select status, error_code, attempts, payload from notification_outbox
     where kind = 'subscription_notice' and payload->>'subscription_id' = ${subscriptionId}
       and payload->>'notice_kind' = ${kind}
  `;
  return rows;
}

const mine = (sent: Sent[], chat: string) => sent.filter((m) => m.chatId === chat);

describeIf("WR-35 — رابطُ قروبِ سائقي المدينةِ عندَ انتهاءِ التجربة", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string; code: string; name_ar: string }[]>`
      select id, code, name_ar from cities where code in ${sql(CODES)}
    `;
    if (cities.length !== CODES.length) throw new Error("لم تُطبَّق هجرةُ بذرِ المدنِ الخمس");
    cityIds = Object.fromEntries(cities.map((c) => [c.code, c.id]));
    cityNames = Object.fromEntries(cities.map((c) => [c.code, c.name_ar]));
    original = await sql<{ city_id: string; value: unknown; is_provisional: boolean }[]>`
      select city_id, value, is_provisional from platform_settings
       where key = ${KEY} and city_id in ${sql(Object.values(cityIds))}
    `;
    // يُفرَغُ ثمّ يُبذَرُ بنصِّ الهجرةِ نفسِه: ما يُقاسُ هو الهجرةُ لا أثرُ ملفٍّ سابق.
    await sql`
      update platform_settings set value = '""'::jsonb, is_provisional = true
       where key = ${KEY} and city_id in ${sql(Object.values(cityIds))}
    `;
    await sql.unsafe(seedBlock());
  });

  beforeEach(async () => {
    await sql`truncate table subscription_notices, notification_outbox, audit_log, subscriptions,
                             driver_capabilities, driver_availability, drivers, users
                       restart identity cascade`;
  });

  afterAll(async () => {
    await sql`truncate table subscription_notices, notification_outbox, audit_log, subscriptions,
                             driver_capabilities, driver_availability, drivers, users
                       restart identity cascade`;
    for (const row of original) {
      await sql`
        update platform_settings set value = ${sql.json(row.value as string)},
               is_provisional = ${row.is_provisional}
         where city_id = ${row.city_id}::uuid and key = ${KEY}
      `;
    }
    await sql.end({ timeout: 5 });
  });

  it("الهجرةُ تضعُ للمدنِ الخمسِ روابطَها المعتمَدةَ بعينِها وتُسقِطُ وسمَ المبدئيّ", async () => {
    for (const code of CODES) {
      const link = await linkOf(code);
      expect(link.value).toBe(APPROVED[code] ?? "");
      expect(link.provisional).toBe(false);
    }
  });

  it("الهجرةُ idempotent ولا تطمسُ قيمةً غيرَ فارغةٍ مختلفةً", async () => {
    // إعادةُ التشغيلِ: لا تغيير.
    await sql.unsafe(seedBlock());
    for (const code of CODES) expect((await linkOf(code)).value).toBe(APPROVED[code] ?? "");

    // قيمةٌ وضعها إنسانٌ تبقى؛ والفارغةُ وحدَها تُملأ.
    await setLink("RUH", "https://t.me/owner_set_other");
    await setLink("TIF", "   ");
    await sql.unsafe(seedBlock());
    expect((await linkOf("RUH")).value).toBe("https://t.me/owner_set_other");
    expect((await linkOf("TIF")).value).toBe(APPROVED.TIF ?? "");
    await setLink("RUH", APPROVED.RUH ?? "");
  });

  it("انتهاءُ التجربةِ في كلِّ مدينةٍ من الخمسِ يُرسِلُ رابطَ مدينتِه وحدَها", async () => {
    const drivers: Record<string, Awaited<ReturnType<typeof expiredTrialDriver>>> = {};
    for (const code of CODES) drivers[code] = await expiredTrialDriver(code);
    await sql`select expire_due_subscriptions()`;

    const sent: Sent[] = [];
    for (const code of CODES) await deliver(code, recorder(sent));

    for (const code of CODES) {
      const chat = drivers[code]?.chat ?? "";
      const messages = mine(sent, chat);
      expect(messages).toHaveLength(1);
      const text = messages[0]?.text ?? "";
      expect(text).toContain(APPROVED[code] ?? "?");
      expect(text).toContain(cityNames[code] ?? "?");
      // لا رابطَ لمدينةٍ أخرى
      for (const other of CODES.filter((c) => c !== code)) {
        expect(text).not.toContain(APPROVED[other] ?? "?");
      }
      // لا إيحاءَ بأنّ الانضمامَ يعيدُ التجربةَ أو يُفعِّلُ اشتراكًا — بل نفيٌ صريح
      expect(text).toContain("لا يعيد الفترة المجانية ولا يفعّل اشتراكاً");
      const rows = await noticeOf(drivers[code]?.subscriptionId ?? "");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("delivered");
      expect(rows[0]?.payload.group_link_status).toBe("ok");
    }
  });

  it("التاريخُ في الرسالةِ يومُ انتهاءِ التجربةِ من القاعدة — لا مدّةٌ مفترضة", async () => {
    const d = await expiredTrialDriver("JED", { language: "en" });
    const ends = await sql<{ day: string }[]>`
      select to_char(trial_ends_at at time zone 'UTC', 'YYYY-MM-DD') as day
        from subscriptions where id = ${d.subscriptionId}::uuid
    `;
    await sql`select expire_due_subscriptions()`;
    const sent: Sent[] = [];
    await deliver("JED", recorder(sent));
    const text = mine(sent, d.chat)[0]?.text ?? "";
    expect(text).toContain(ends[0]?.day ?? "?");
    expect(text).toContain(APPROVED.JED ?? "?");
    expect(text).toContain("Jeddah");
    expect(text).toContain("does not restore your free trial or activate a subscription");
  });

  it("لا تكرار: العاملُ يدورُ مرّتَين والشوطُ مرّتَين — رسالةٌ واحدةٌ وصفٌّ واحد", async () => {
    const d = await expiredTrialDriver("MKK");
    await sql`select expire_due_subscriptions()`;
    await sql`select expire_due_subscriptions()`;
    const sent: Sent[] = [];
    await deliver("MKK", recorder(sent));
    await deliver("MKK", recorder(sent));
    expect(mine(sent, d.chat)).toHaveLength(1);
    expect(await noticeOf(d.subscriptionId)).toHaveLength(1);
  });

  it("حجزان متزامنان لا يحجزان الإشعارَ نفسَه مرّتَين", async () => {
    const d = await expiredTrialDriver("MED");
    await sql`select expire_due_subscriptions()`;
    const port = createSubscriptionNoticeDeliveryPort(sql);
    const [a, b] = await Promise.all([
      port.claim(cityIds.MED ?? ""),
      port.claim(cityIds.MED ?? ""),
    ]);
    if (!a.ok || !b.ok) throw new Error("فشل الحجز");
    const ids = [...a.value, ...b.value].filter((n) => n.chatId === d.chat).map((n) => n.noticeId);
    expect(ids).toHaveLength(1);
  });

  it("فشلُ تلغرام العابرُ يُعادُ ولا يُكرِّر: محاولةٌ فاشلةٌ ثمّ رسالةٌ واحدة", async () => {
    const d = await expiredTrialDriver("RUH");
    await sql`select expire_due_subscriptions()`;
    const sent: Sent[] = [];
    const first = await deliver("RUH", recorder(sent, { remaining: 1 }));
    expect(first.retried).toBeGreaterThanOrEqual(1);
    expect(mine(sent, d.chat)).toHaveLength(0);
    let rows = await noticeOf(d.subscriptionId);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.error_code).toBe("TELEGRAM_TIMEOUT");

    // قبلَ موعدِ الإعادةِ لا يُحجَزُ مجدّدًا
    await deliver("RUH", recorder(sent));
    expect(mine(sent, d.chat)).toHaveLength(0);

    // حلَّ الموعدُ: يُرسَلُ مرّةً واحدةً، ثمّ لا شيء
    await sql`update notification_outbox set next_attempt_at = now() - interval '1 second'
               where payload->>'subscription_id' = ${d.subscriptionId}`;
    await deliver("RUH", recorder(sent));
    await deliver("RUH", recorder(sent));
    expect(mine(sent, d.chat)).toHaveLength(1);
    rows = await noticeOf(d.subscriptionId);
    expect(rows[0]?.status).toBe("delivered");
    expect(rows[0]?.attempts).toBe(2);
  });

  it("حجزٌ متروكٌ (عاملٌ مات قبلَ الإرسال) يُسترَدُّ بعدَ المهلةِ فيُرسَلُ مرّةً واحدة", async () => {
    const d = await expiredTrialDriver("TIF");
    await sql`select expire_due_subscriptions()`;
    const port = createSubscriptionNoticeDeliveryPort(sql);
    const claimed = await port.claim(cityIds.TIF ?? "");
    if (!claimed.ok) throw new Error("فشل الحجز");
    // العاملُ مات: لا إرسالَ ولا finish. قبلَ المهلةِ لا يُعادُ حجزُه.
    const sent: Sent[] = [];
    await deliver("TIF", recorder(sent));
    expect(mine(sent, d.chat)).toHaveLength(0);
    await sql`update notification_outbox set claimed_at = now() - interval '1 hour'
               where payload->>'subscription_id' = ${d.subscriptionId}`;
    await deliver("TIF", recorder(sent));
    await deliver("TIF", recorder(sent));
    expect(mine(sent, d.chat)).toHaveLength(1);
  });

  it("تجديدٌ قبلَ التسليمِ يُلغي رسالةَ الانتهاءِ ويصلُ التفعيلُ وحدَه", async () => {
    const d = await expiredTrialDriver("JED");
    await sql`select expire_due_subscriptions()`;
    await sql`select activate_subscription(${d.driverId}::uuid, 'transport', 30)`;
    const sent: Sent[] = [];
    await deliver("JED", recorder(sent));
    const messages = mine(sent, d.chat);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).not.toContain(APPROVED.JED ?? "?");
    const rows = await noticeOf(d.subscriptionId);
    expect(rows[0]?.status).toBe("canceled");
    expect(rows[0]?.error_code).toBe("SUPERSEDED_BY_RENEWAL");
  });

  it("المحظورُ بعدَ الإيداعِ لا يُرسَلُ له شيء", async () => {
    const d = await expiredTrialDriver("MKK");
    await sql`select expire_due_subscriptions()`;
    await sql`update users set is_blocked = true where id = ${d.userId}::uuid`;
    const sent: Sent[] = [];
    await deliver("MKK", recorder(sent));
    expect(mine(sent, d.chat)).toHaveLength(0);
    const rows = await noticeOf(d.subscriptionId);
    expect(rows[0]?.status).toBe("canceled");
    expect(rows[0]?.error_code).toBe("RECIPIENT_BLOCKED");
  });

  it("المحظورُ قبلَ الانتهاءِ لا يُودَعُ له إشعارٌ أصلًا (السياسةُ القائمة)", async () => {
    const d = await expiredTrialDriver("MKK");
    await sql`update users set is_blocked = true where id = ${d.userId}::uuid`;
    await sql`select expire_due_subscriptions()`;
    expect(await noticeOf(d.subscriptionId)).toHaveLength(0);
  });

  it("السائقُ الموقوفُ يصلُه الانتهاءُ بإحالةٍ إلى الدعمِ لا برابطِ القروب", async () => {
    const d = await expiredTrialDriver("MED", { verification: "suspended" });
    await sql`select expire_due_subscriptions()`;
    const sent: Sent[] = [];
    const outcome = await deliver("MED", recorder(sent));
    const text = mine(sent, d.chat)[0]?.text ?? "";
    expect(text).not.toContain("t.me");
    expect(text).toContain("/support");
    expect(outcome.withoutGroupLink).toBeGreaterThanOrEqual(1);
    const rows = await noticeOf(d.subscriptionId);
    expect(rows[0]?.payload.group_link_status).toBe("driver_not_verified");
  });

  it("مدينةٌ بلا رابطٍ معتمَدٍ لا تحصلُ على رابطِ غيرِها: إحالةٌ إلى الدعمِ وحالةٌ مسجَّلة", async () => {
    await setLink("TIF", "");
    try {
      const d = await expiredTrialDriver("TIF");
      await sql`select expire_due_subscriptions()`;
      const sent: Sent[] = [];
      const outcome = await deliver("TIF", recorder(sent));
      const text = mine(sent, d.chat)[0]?.text ?? "";
      expect(text).not.toContain("t.me");
      for (const link of Object.values(APPROVED)) expect(text).not.toContain(link);
      expect(text).toContain("/support");
      expect(outcome.withoutGroupLink).toBeGreaterThanOrEqual(1);
      const rows = await noticeOf(d.subscriptionId);
      expect(rows[0]?.payload.group_link_status).toBe("missing");
      expect(rows[0]?.payload.group_link).toBe("");
    } finally {
      await setLink("TIF", APPROVED.TIF ?? "");
    }
  });

  it("رابطٌ تالفٌ (ليس t.me) لا يُرسَلُ للسائق", async () => {
    await setLink("RUH", "https://evil.example/join");
    try {
      const d = await expiredTrialDriver("RUH");
      await sql`select expire_due_subscriptions()`;
      const sent: Sent[] = [];
      await deliver("RUH", recorder(sent));
      const text = mine(sent, d.chat)[0]?.text ?? "";
      expect(text).not.toContain("evil.example");
      expect(text).toContain("/support");
      const rows = await noticeOf(d.subscriptionId);
      expect(rows[0]?.payload.group_link_status).toBe("invalid");
    } finally {
      await setLink("RUH", APPROVED.RUH ?? "");
    }
  });

  it("إشعارٌ أُودِعَ برابطٍ فارغٍ قبلَ البذرِ يخرجُ بالرابطِ المعتمَدِ الحاليّ", async () => {
    await setLink("JED", "");
    const d = await expiredTrialDriver("JED");
    await sql`select expire_due_subscriptions()`;
    const before = await noticeOf(d.subscriptionId);
    expect(before[0]?.payload.group_link).toBe("");
    await sql.unsafe(seedBlock());
    const sent: Sent[] = [];
    await deliver("JED", recorder(sent));
    expect(mine(sent, d.chat)[0]?.text ?? "").toContain(APPROVED.JED ?? "?");
  });
});
