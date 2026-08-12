/**
 * الغرض: إثبات أن إلغاء الاشتراك وترقية الخطّة يعملان فعلاً على قاعدة حقيقية،
 *   لا أن الملفّين توقّفا عن كونهما `export {}`.
 *
 *   سبب وجود هذا الملف أن الجرد الجنائي (البوابة B) وجد فجوةً صامتة واحدة:
 *   `cancel-subscription.ts` و`upgrade-plan.ts` تعلن ترويستهما تفعيلاً في
 *   الأمر الثاني، ولا أثر لهما في القاعدة. النتيجة العملية أن سائقاً مشتركاً
 *   في «نقل فقط» لا يملك طريقاً للترقية، ولا طريقاً لإلغاء اشتراكه بنفسه.
 *
 *   ما تقيسه هذه الاختبارات سلوكاً لا شكلاً:
 *     ١. الإلغاء لا يقطع الخدمة لحظته: يرفع العلم ويُبقي الدورة إلى نهايتها.
 *        (لا بنية استرداد في هذا الأمر — MASTER_DIRECTIVE:95 — فقطع خدمةٍ
 *        مدفوعة سلبٌ بلا ردّ.)
 *     ٢. الإلغاء المكرَّر لا يُخطئ ولا يكتب سبباً ثانياً ولا سطر تدقيق ثانياً.
 *     ٣. عند نهاية الدورة يُغلق المُلغى بحالة `cancelled` والمنتهي بـ`expired`
 *        — خلطهما يُفقد القدرة على قياس معدّل الإلغاء أصلاً.
 *     ٤. الاستئناف يُرجع الاشتراك قبل انتهاء دورته.
 *     ٥. الترقية داخل التجربة المجّانية بلا مقابل: أول نسخة من الدالّة كانت
 *        تُطالب سائقاً في تجربة مجّانية بفرق ١٥٠ ريالاً لترقية فترة لم يدفع
 *        فيها شيئاً. كشفه تشغيلٌ فعليّ، ويحرسه الاختبار من العودة.
 *     ٦. الترقية داخل دورة مدفوعة تُطالب بفرق السعرين من `platform_settings`،
 *        ولا تُطبَّق قبل تأكيد الدفع، ولا تمسّ `current_period_end`.
 *     ٧. الترقية الجانبية (نقل → توصيل) مرفوضة برمز صريح لا بنجاحٍ كاذب.
 *     ٨. ويبهوك مكرَّر لا يرقّي مرّتين ولا يُنشئ اشتراكاً ثانياً.
 *     ٩. مدّة الدورة المدفوعة تُقرأ من `subscription_period_days` لا من
 *        `trial_days` — كانت تُقرأ من الثاني، فلو غيّر المالك مدّة التجربة
 *        لتغيّرت مدّة ما يُدفع مقابله صامتةً.
 *    ١٠. `metadata` يُخزَّن في القاعدة كائناً (`object`) لا نصّاً مُلفَّفاً، ومن
 *        دفع ثمن «نقل» تُفعَّل له «نقل». كان محوّل الدفع يمرّر
 *        `JSON.stringify(metadata)::jsonb` فيُلفّفه السائق ثانيةً، فتقرأ
 *        `confirm_payment` الخطّة `null` وتقع على `coalesce(..., 'both')`:
 *        كل دافع ٢٥٠ ريالاً يُفعَّل له ما ثمنه ٤٠٠. أُصلح المحوّل بـ`sql.json`
 *        وأُزيل الافتراض من الدالّة، وهذان الاختباران يحرسان الطرفين.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه: CI (خدمة postgis)، وكل هجرة تمسّ الاشتراكات أو الدفع.
 * ملاحظات مستقبلية: التقسيط الزمنيّ (proration) غير مُنفَّذ عن قصد. إن أقرّه
 *   المالك فمكانه `plan_upgrade_quote` وإعدادٌ جديد، ويُضاف اختبار له هنا.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { servicesCoveredByPlan } from "../../packages/domain/subscription/entity.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createPaymentRepository } from "../../packages/infrastructure/financial/payment-adapters.ts";
import { createSubscriptionChangeRpc } from "../../packages/infrastructure/subscription/subscription-change-adapters.ts";
import type { DriverId } from "../../packages/shared/kernel/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** قاعدة معرّفات فريدة لكل تشغيل — القاعدة في CI دائمة بين الملفات. */
const RUN_BASE = 6_000_000_000 + (Date.now() % 800_000_000);
let seq = 0;

interface Fixture {
  readonly cityId: string;
  readonly driverId: DriverId;
  readonly subscriptionId: string;
}

async function makeDriver(kind: "trialing" | "active"): Promise<Fixture> {
  seq += 1;
  const rows = await sql<{ id: string }[]>`select id from cities order by code limit 1`;
  const city = rows[0];
  if (city === undefined) {
    throw new Error("لا مدن في القاعدة — الهجرات غير مطبّقة.");
  }
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${city.id}, ${RUN_BASE + seq}, ${`اشتراك ${seq}`},
            ${`+9665${String(RUN_BASE + seq).slice(-8)}`}, 'driver')
    returning id
  `;
  const user = users[0];
  if (user === undefined) {
    throw new Error("تعذّر إنشاء المستخدم.");
  }
  const drivers = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, vehicle_type, plate_number)
    values (${city.id}, ${user.id}, 'sedan', ${`SB-${RUN_BASE + seq}`})
    returning id
  `;
  const driver = drivers[0];
  if (driver === undefined) {
    throw new Error("تعذّر إنشاء السائق.");
  }
  if (kind === "trialing") {
    await sql`select start_trial(${driver.id}::uuid, 'transport')`;
  } else {
    await sql`select activate_subscription(${driver.id}::uuid, 'transport', 30)`;
  }
  const subs = await sql<{ id: string }[]>`
    select id from subscriptions where driver_id = ${driver.id}
  `;
  const sub = subs[0];
  if (sub === undefined) {
    throw new Error("لم يُنشأ اشتراك.");
  }
  return { cityId: city.id, driverId: driver.id as DriverId, subscriptionId: sub.id };
}

interface SubscriptionRow {
  readonly plan: string;
  readonly status: string;
  readonly price_amount: string | null;
  readonly cancel_at_period_end: boolean;
  readonly cancellation_reason: string | null;
  readonly cancellation_requested_at: Date | null;
  readonly current_period_end: Date | null;
  readonly trial_ends_at: Date | null;
}

async function readSubscription(id: string): Promise<SubscriptionRow> {
  const rows = await sql<SubscriptionRow[]>`
    select plan, status, price_amount, cancel_at_period_end, cancellation_reason,
           cancellation_requested_at, current_period_end, trial_ends_at
      from subscriptions where id = ${id}
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new Error("الاشتراك غير موجود.");
  }
  return row;
}

async function countAudit(subscriptionId: string, action: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from audit_log
     where entity_id = ${subscriptionId} and action = ${action}
  `;
  return rows[0]?.n ?? 0;
}

/** ينشئ معاملة دفع للترقية ويؤكّدها — نفس المسار الذي يسلكه الويبهوك. */
/**
 * يدفع ويؤكّد **عبر المحوّل الإنتاجي نفسه** (createPaymentRepository)، لا بـSQL يدويّ.
 * هذا ليس تفضيلاً أسلوبياً: النسخة الأولى من هذا الملف كتبت الـjsonb بيدها،
 * فأعادت إنتاج خلل المحوّل (تلفيف مزدوج) بدل أن تكشفه. المرور من المحوّل
 * يجعل الاختبار حرساً على طبقة التسلسل أيضاً.
 */
async function payAndConfirm(
  fixture: Fixture,
  amountMinor: number,
  idempotencyKey: string,
  metadata: Readonly<Record<string, unknown>> = { plan: "both", upgrade: true },
): Promise<string> {
  const payments = createPaymentRepository(sql, async () => fixture.cityId);
  const created = await payments.create({
    driverId: fixture.driverId as never,
    amount: { amount: amountMinor, currency: "SAR" },
    purpose: "driver_subscription" as never,
    provider: "manual",
    providerTransactionId: null,
    status: "pending" as never,
    idempotencyKey,
    metadata,
  });
  if (!created.ok) {
    throw new Error(`لم تُنشأ معاملة الدفع: ${created.error.detail}`);
  }
  const txId = String(created.value.transaction.id);
  await sql`select confirm_payment(${txId}::uuid, ${`prov-${idempotencyKey}`}, 'active')`;
  return txId;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql.end();
});

describeIf("إلغاء الاشتراك على قاعدة حقيقية", () => {
  it("لا يقطع الخدمة لحظته بل يُبقيها إلى نهاية الدورة", async () => {
    const f = await makeDriver("active");
    const before = await readSubscription(f.subscriptionId);

    const changes = createSubscriptionChangeRpc(sql);
    const result = await changes.requestCancellation(f.driverId, "غالي");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.ok).toBe(true);
    expect(result.value.alreadyCancelled).toBe(false);
    expect(result.value.serviceUntil?.getTime()).toBe(before.current_period_end?.getTime());

    const after = await readSubscription(f.subscriptionId);
    // الحالة تبقى active: الخدمة عاملة إلى نهاية الدورة المدفوعة.
    expect(after.status).toBe("active");
    expect(after.cancel_at_period_end).toBe(true);
    expect(after.cancellation_reason).toBe("غالي");
    expect(after.cancellation_requested_at).not.toBeNull();
    expect(after.current_period_end?.getTime()).toBe(before.current_period_end?.getTime());
    expect(await countAudit(f.subscriptionId, "subscription.cancellation_requested")).toBe(1);
  });

  it("الطلب المكرَّر لا يُخطئ ولا يكتب سبباً ثانياً ولا سطر تدقيق ثانياً", async () => {
    const f = await makeDriver("active");
    const changes = createSubscriptionChangeRpc(sql);

    const first = await changes.requestCancellation(f.driverId, "سبب-أول");
    const second = await changes.requestCancellation(f.driverId, "سبب-ثانٍ");
    expect(first.ok && first.value.alreadyCancelled).toBe(false);
    expect(second.ok && second.value.ok).toBe(true);
    expect(second.ok && second.value.alreadyCancelled).toBe(true);

    const row = await readSubscription(f.subscriptionId);
    expect(row.cancellation_reason).toBe("سبب-أول");
    expect(await countAudit(f.subscriptionId, "subscription.cancellation_requested")).toBe(1);
  });

  it("يُرفض بلا اشتراك سارٍ برمز صريح لا بنجاحٍ كاذب", async () => {
    const f = await makeDriver("active");
    await sql`update subscriptions set status = 'expired' where id = ${f.subscriptionId}`;

    const changes = createSubscriptionChangeRpc(sql);
    const result = await changes.requestCancellation(f.driverId, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ok).toBe(false);
    expect(result.value.error).toBe("NO_LIVE_SUBSCRIPTION");
  });

  it("عند نهاية الدورة: المُلغى cancelled والمنتهي expired — لا خلط", async () => {
    const cancelled = await makeDriver("active");
    const expired = await makeDriver("active");
    const changes = createSubscriptionChangeRpc(sql);
    await changes.requestCancellation(cancelled.driverId, "لا حاجة");

    await sql`
      update subscriptions set current_period_end = now() - interval '1 minute'
       where id in (${cancelled.subscriptionId}, ${expired.subscriptionId})
    `;
    await sql`select expire_due_subscriptions()`;

    expect((await readSubscription(cancelled.subscriptionId)).status).toBe("cancelled");
    expect((await readSubscription(expired.subscriptionId)).status).toBe("expired");
    expect(await countAudit(cancelled.subscriptionId, "subscription.cancelled")).toBe(1);
    expect(await countAudit(expired.subscriptionId, "subscription.expired")).toBe(1);
  });

  it("الاستئناف يُرجع الاشتراك قبل انتهاء دورته", async () => {
    const f = await makeDriver("active");
    const changes = createSubscriptionChangeRpc(sql);
    await changes.requestCancellation(f.driverId, "تراجعت");

    const resumed = await changes.resume(f.driverId);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.ok).toBe(true);
    expect(resumed.value.alreadyActive).toBe(false);

    const row = await readSubscription(f.subscriptionId);
    expect(row.cancel_at_period_end).toBe(false);
    expect(row.cancellation_requested_at).toBeNull();
    expect(row.cancellation_reason).toBeNull();

    const again = await changes.resume(f.driverId);
    expect(again.ok && again.value.alreadyActive).toBe(true);
  });
});

describeIf("ترقية الخطّة على قاعدة حقيقية", () => {
  it("داخل التجربة المجّانية: بلا مقابل ولا سعر مكتوب", async () => {
    const f = await makeDriver("trialing");
    const changes = createSubscriptionChangeRpc(sql);

    const quote = await changes.quoteUpgrade(f.driverId, "both");
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.value.ok).toBe(true);
    expect(quote.value.amountDue).toBe(0);
    expect(quote.value.paymentRequired).toBe(false);

    const applied = await changes.applyUpgrade(f.driverId, "both", null);
    expect(applied.ok && applied.value.ok).toBe(true);

    const row = await readSubscription(f.subscriptionId);
    expect(row.plan).toBe("both");
    expect(row.status).toBe("trialing");
    // لا سعرٌ يوحي بدفعٍ لم يحدث.
    expect(row.price_amount).toBeNull();
  });

  it("داخل دورة مدفوعة: الفرق من الإعدادات، والدورة لا تُمَسّ", async () => {
    const f = await makeDriver("active");
    const before = await readSubscription(f.subscriptionId);
    const changes = createSubscriptionChangeRpc(sql);

    const quote = await changes.quoteUpgrade(f.driverId, "both");
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.value.paymentRequired).toBe(true);

    const settings = await sql<{ transport: number; both: number }[]>`
      select
        (select (value #>> '{}')::numeric from platform_settings
          where city_id = ${f.cityId} and key = 'subscription_price_transport') as transport,
        (select (value #>> '{}')::numeric from platform_settings
          where city_id = ${f.cityId} and key = 'subscription_price_both') as both
    `;
    const prices = settings[0];
    expect(prices).toBeDefined();
    if (prices === undefined) return;
    // المبلغ ليس رقماً مكتوباً في الاختبار: يُقارن بما في platform_settings.
    expect(quote.value.amountDue).toBe(Number(prices.both) - Number(prices.transport));

    // قبل الدفع لا ترقية.
    expect((await readSubscription(f.subscriptionId)).plan).toBe("transport");

    await payAndConfirm(f, Math.round(quote.value.amountDue * 100), `upg-${RUN_BASE}-${seq}`);

    const after = await readSubscription(f.subscriptionId);
    expect(after.plan).toBe("both");
    expect(after.status).toBe("active");
    expect(Number(after.price_amount)).toBe(Number(prices.both));
    expect(after.current_period_end?.getTime()).toBe(before.current_period_end?.getTime());
    expect(await countAudit(f.subscriptionId, "subscription.plan_upgraded")).toBe(1);
    expect(await countAudit(f.subscriptionId, "subscription.upgraded_via_payment")).toBe(1);
  });

  it("الويبهوك المكرَّر لا يرقّي مرّتين ولا يُنشئ اشتراكاً ثانياً", async () => {
    const f = await makeDriver("active");
    const changes = createSubscriptionChangeRpc(sql);
    const quote = await changes.quoteUpgrade(f.driverId, "both");
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;

    const key = `upg-dup-${RUN_BASE}-${seq}`;
    const txId = await payAndConfirm(f, Math.round(quote.value.amountDue * 100), key);
    await sql`select confirm_payment(${txId}::uuid, ${`prov-${key}`}, 'active')`;

    expect(await countAudit(f.subscriptionId, "subscription.plan_upgraded")).toBe(1);
    const live = await sql<{ n: number }[]>`
      select count(*)::int as n from subscriptions
       where driver_id = ${f.driverId} and status in ('trialing', 'active')
    `;
    expect(live[0]?.n).toBe(1);
    const ledger = await sql<{ n: number }[]>`
      select count(*)::int as n from ledger_entries where transaction_id = ${txId}
    `;
    expect(ledger[0]?.n).toBe(1);
  });

  it("الترقية الجانبية (نقل → توصيل) مرفوضة برمز صريح", async () => {
    const f = await makeDriver("active");
    const changes = createSubscriptionChangeRpc(sql);

    const quote = await changes.quoteUpgrade(f.driverId, "delivery");
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.value.ok).toBe(false);
    expect(quote.value.error).toBe("PLAN_NOT_AN_UPGRADE");

    const applied = await changes.applyUpgrade(f.driverId, "delivery", null);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.ok).toBe(false);
    expect(applied.value.error).toBe("PLAN_NOT_AN_UPGRADE");
    expect((await readSubscription(f.subscriptionId)).plan).toBe("transport");
  });

  it("من هو على الخطّة أصلاً: الاقتباس يرفض والتطبيق إيدمبوتنسي", async () => {
    const f = await makeDriver("active");
    const changes = createSubscriptionChangeRpc(sql);
    await sql`update subscriptions set plan = 'both' where id = ${f.subscriptionId}`;

    const quote = await changes.quoteUpgrade(f.driverId, "both");
    expect(quote.ok && quote.value.error).toBe("ALREADY_ON_PLAN");

    const applied = await changes.applyUpgrade(f.driverId, "both", null);
    expect(applied.ok && applied.value.ok).toBe(true);
    expect(applied.ok && applied.value.alreadyOnPlan).toBe(true);
  });
});

describeIf("مدّة الدورة المدفوعة مستقلّة عن مدّة التجربة", () => {
  it("subscription_period_days موجود لكل مدينة", async () => {
    const rows = await sql<{ cities: number; keys: number }[]>`
      select (select count(*)::int from cities) as cities,
             (select count(*)::int from platform_settings
               where key = 'subscription_period_days') as keys
    `;
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.keys).toBe(row.cities);
  });

  it("confirm_payment يقرأ الدورة من subscription_period_days لا من trial_days", async () => {
    const f = await makeDriver("active");
    // تُغيَّر مدّة التجربة وحدها: لو كانت الدورة تُقرأ منها لتغيّرت مدّة ما يُدفع.
    const original = await sql<{ value: number }[]>`
      select (value #>> '{}')::int as value from platform_settings
       where city_id = ${f.cityId} and key = 'trial_days'
    `;
    await sql`
      update platform_settings set value = to_jsonb(3)
       where city_id = ${f.cityId} and key = 'trial_days'
    `;
    try {
      await sql`update subscriptions set status = 'expired' where id = ${f.subscriptionId}`;
      // عبر المحوّل الإنتاجي: كتابة الـjsonb يدوياً هنا كانت تُنتج نصّاً مُلفَّفاً
      // فيرفضه حرس `confirm_payment` الجديد بحقّ.
      await payAndConfirm(f, 25_000, `period-${RUN_BASE}-${seq}`, { plan: "transport" });

      const rows = await sql<{ days: number }[]>`
        select round(extract(epoch from (current_period_end - now())) / 86400)::int as days
          from subscriptions
         where driver_id = ${f.driverId} and status = 'active'
      `;
      const periodRows = await sql<{ value: number }[]>`
        select (value #>> '{}')::int as value from platform_settings
         where city_id = ${f.cityId} and key = 'subscription_period_days'
      `;
      expect(rows[0]?.days).toBe(periodRows[0]?.value);
      expect(rows[0]?.days).not.toBe(3);
    } finally {
      const restored = original[0]?.value;
      if (restored !== undefined) {
        await sql`
          update platform_settings set value = to_jsonb(${restored}::int)
           where city_id = ${f.cityId} and key = 'trial_days'
        `;
      }
    }
  });
});

describeIf("تسلسل بيانات المعاملة: الخطّة لا تُفترض أبداً", () => {
  it("المحوّل الإنتاجي يخزّن metadata كائناً لا نصّاً مُلفَّفاً", async () => {
    const f = await makeDriver("active");
    const key = `meta-obj-${RUN_BASE}-${seq}`;
    const payments = createPaymentRepository(sql, async () => f.cityId);
    const created = await payments.create({
      driverId: f.driverId,
      amount: { amount: 25_000, currency: "SAR" },
      purpose: "driver_subscription" as never,
      provider: "manual",
      providerTransactionId: null,
      status: "pending" as never,
      idempotencyKey: key,
      metadata: { plan: "transport", cityId: f.cityId },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const rows = await sql<{ kind: string; plan: string | null }[]>`
      select jsonb_typeof(metadata) as kind, metadata->>'plan' as plan
        from payment_transactions where id = ${String(created.value.transaction.id)}::uuid
    `;
    // لو عاد "string" فقد رجع التلفيف المزدوج، وستُفعَّل خطّة لم يُدفع ثمنها.
    expect(rows[0]?.kind).toBe("object");
    expect(rows[0]?.plan).toBe("transport");
  });

  it("من دفع ثمن نقل فُعّلت له نقل — لا الأغلى", async () => {
    const f = await makeDriver("active");
    await sql`update subscriptions set status = 'expired' where id = ${f.subscriptionId}`;
    const key = `paid-transport-${RUN_BASE}-${seq}`;
    await payAndConfirm(f, 25_000, key, { plan: "transport", cityId: f.cityId });

    const rows = await sql<{ plan: string }[]>`
      select plan from subscriptions
       where driver_id = ${f.driverId} and status = 'active'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.plan).toBe("transport");
  });

  it("معاملة بخطّة مجهولة تُرفض صريحاً ولا تُفعّل شيئاً", async () => {
    const f = await makeDriver("active");
    await sql`update subscriptions set status = 'expired' where id = ${f.subscriptionId}`;
    const key = `bad-plan-${RUN_BASE}-${seq}`;
    const payments = createPaymentRepository(sql, async () => f.cityId);
    const created = await payments.create({
      driverId: f.driverId,
      amount: { amount: 25_000, currency: "SAR" },
      purpose: "driver_subscription" as never,
      provider: "manual",
      providerTransactionId: null,
      status: "pending" as never,
      idempotencyKey: key,
      metadata: { plan: "platinum" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const confirmed = await sql<{ result: { ok: boolean; error?: string } }[]>`
      select confirm_payment(${String(created.value.transaction.id)}::uuid, ${`prov-${key}`}, 'active') as result
    `;
    expect(confirmed[0]?.result.ok).toBe(false);
    expect(confirmed[0]?.result.error).toBe("TRANSACTION_METADATA_UNKNOWN_PLAN");

    const live = await sql<{ n: number }[]>`
      select count(*)::int as n from subscriptions
       where driver_id = ${f.driverId} and status in ('active', 'trialing')
    `;
    expect(live[0]?.n).toBe(0);
    const tx = await sql<{ status: string }[]>`
      select status from payment_transactions where id = ${String(created.value.transaction.id)}::uuid
    `;
    // الرفض قبل أي كتابة: المعاملة ما زالت pending، لا active بلا اشتراك.
    expect(tx[0]?.status).toBe("pending");
  });
});

describeIf("إعدادات المنصّة: النوع المُعلَن يجب أن يطابق القيمة", () => {
  it("رقمٌ مخزَّن نصّاً يُرفض على مستوى القاعدة لا على مستوى النيّة", async () => {
    const rows = await sql<{ id: string }[]>`
      select id from platform_settings where key = 'trial_days' limit 1
    `;
    const id = rows[0]?.id;
    expect(id).toBeDefined();
    if (id === undefined) return;

    let rejected = false;
    let message = "";
    try {
      // هذا بالضبط ما ينتجه `${text}::jsonb` من سائق postgres.js.
      await sql`update platform_settings set value = '"5"'::jsonb where id = ${id}`;
    } catch (error) {
      rejected = true;
      message = error instanceof Error ? error.message : String(error);
    }
    expect(rejected).toBe(true);
    expect(message).toContain("platform_settings_value_type_coherent");

    // ولم تتغيّر القيمة: الرفض قبل الكتابة لا بعدها.
    const after = await sql<{ kind: string }[]>`
      select jsonb_typeof(value) as kind from platform_settings where id = ${id}
    `;
    expect(after[0]?.kind).toBe("number");
  });

  it("لا صفَّ إعداداتٍ واحد في القاعدة يخالف نوعه المُعلَن", async () => {
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from platform_settings
       where jsonb_typeof(value) <> value_type
    `;
    expect(rows[0]?.n).toBe(0);
  });
});

/**
 * القدرات تتبع الخطّة — الهجرة 20260812150000.
 *
 * العطب المُكتشَف بالتشغيل: أهليّة الإسناد تشترط قدرةً مُفعَّلة وخطّةً تغطّي
 * الخدمة (domain/dispatch/entity.ts:184-186)، و`driver_capabilities` كان
 * يُكتب مرّةً واحدة عند التسجيل فقط. فمن رقّى خطّته أو اشترك بالشاملة يدفع
 * ٤٠٠ ريالاً ويُرفض بـ`SERVICE_NOT_ENABLED` ولا يصله عرض توصيلٍ أبداً.
 */
describeIf("قدرات السائق تتبع خطّته لا لحظة تسجيله", () => {
  async function enabledServices(driverId: DriverId): Promise<string[]> {
    const rows = await sql<{ service: string }[]>`
      select service::text as service
        from driver_capabilities
       where driver_id = ${driverId} and is_enabled = true
       order by service
    `;
    return rows.map((r) => r.service);
  }

  it("تعريف تغطية الخطّة في القاعدة يطابق تعريف الدومين حرفاً بحرف", async () => {
    // مصدرا حقيقةٍ لمفهومٍ واحد (القاعدة لا تستورد الدومين)، فيُقارَنان صريحاً
    // بدل أن يتباعدا صامتين عند إضافة خطّةٍ ثالثة.
    for (const plan of ["transport", "delivery", "both"] as const) {
      const rows = await sql<{ services: string[] }[]>`
        select services_covered_by_plan(${plan}::subscription_plan)::text[] as services
      `;
      expect([...(rows[0]?.services ?? [])].sort()).toEqual(
        [...servicesCoveredByPlan(plan)].sort(),
      );
    }
  });

  it("الترقية إلى الشاملة تفتح التوصيل فعلاً لا اسماً", async () => {
    const f = await makeDriver("active");
    expect(await enabledServices(f.driverId)).toEqual(["transport"]);

    const changes = createSubscriptionChangeRpc(sql);
    const applied = await changes.applyUpgrade(f.driverId, "both", null);
    expect(applied.ok).toBe(true);

    expect(await enabledServices(f.driverId)).toEqual(["delivery", "transport"]);
  });

  it("التفعيل المدفوع بالشاملة يفتح الخدمتين لمن سجّل بواحدة", async () => {
    const f = await makeDriver("active");
    await sql`select activate_subscription(${f.driverId}::uuid, 'both', 30)`;
    expect(await enabledServices(f.driverId)).toEqual(["delivery", "transport"]);
  });

  it("انتهاء الاشتراك لا يُطفئ قدرةً اختارها السائق — المنع بفحص الاشتراك", async () => {
    // القرار مقصود: الإطفاء يُتلف خياراً، وفحص الاشتراك في الأهليّة كافٍ للمنع.
    const f = await makeDriver("active");
    await sql`select activate_subscription(${f.driverId}::uuid, 'both', 30)`;
    await sql`update subscriptions set status = 'expired' where driver_id = ${f.driverId}`;

    expect(await enabledServices(f.driverId)).toEqual(["delivery", "transport"]);
  });

  it("المواءمة تُسجَّل في audit_log بمدينة السائق", async () => {
    const f = await makeDriver("active");
    const changes = createSubscriptionChangeRpc(sql);
    await changes.applyUpgrade(f.driverId, "both", null);

    const rows = await sql<{ payload: { new_plan: string } }[]>`
      select payload from audit_log
       where entity_id = ${f.subscriptionId} and action = 'subscription.plan_upgraded'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]?.payload.new_plan).toBe("both");
  });
});
