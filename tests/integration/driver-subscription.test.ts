/**
 * الغرض: قياسُ لوحِ اشتراكِ السائقِ على PostgreSQL حقيقيٍّ — الحالُ والخطةُ
 *   والسعرُ من `platform_settings` لا ثابتٌ، والتاريخُ من `payment_transactions`،
 *   والملكيّةُ مُنفَّذةٌ في القاعدةِ لا في الطبقةِ وحدَها (البند `F3-06` · `SD-07`).
 * الحالة: مُختبَرٌ على قاعدةٍ حقيقيّةٍ — البند `F3-06`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun run test:integration` وخطوةُ «تكامل على PostgreSQL حقيقي» في CI.
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ولِمَ على قاعدةٍ حقيقيّة: كلُّ سعرٍ ههنا **مجموعُ إعدادٍ منشورٍ**، وقياسُه
 * بمُهايِئٍ مصنوعٍ يقيسُ الكاذبَ نفسَه الذي كُتِبَ الحاجزُ لمنعِه: `price` على
 * إعدادٍ غائباً يُرجِعُ رقماً يُقرأُ صحيحاً ولا يسقُطُ به شيءٌ.
 *
 * ## وما لا يقيسُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يقيسُ شاشةً ولا مُضيفَ تلغرامَ**: المُحوِّلاتُ في `tests/unit`.
 * - **لا يقيسُ تجديدَ دفعٍ فعليّاً**: التجديدُ يبدأُ معاملةَ دفعٍ عبرَ منفذٍ،
 *   وقياسُه ههنا يستلزمُ مزوّدَ دفعٍ مصنوعاً. الدالّاتُ هنا **تقرأُ**.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TELEGRAM_ID = 900_000_471;
const STRANGER_TELEGRAM_ID = 900_000_472;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let driverUserId = "";
let driverId = "";
let strangerUserId = "";
let subscriptionId = "";

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly [key: string]: unknown;
}

async function callJson(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

function dashboard(telegramId: number): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_subscription_dashboard(${telegramId}::bigint) as result
  `);
}

function history(telegramId: number, limit: number | null): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_subscription_history(${telegramId}::bigint, ${limit}::int) as result
  `);
}

function block(payload: Payload, key: string): Record<string, unknown> {
  const value = payload[key];
  if (value === null || typeof value !== "object") throw new Error(`لا كتلةَ «${key}»`);
  return value as Record<string, unknown>;
}

async function setSetting(
  key: string,
  value: string | number | null,
  valueType: "string" | "number",
): Promise<void> {
  if (value === null) {
    await sql`delete from platform_settings where city_id = ${cityId} and key = ${key}`;
    return;
  }
  const json =
    valueType === "number"
      ? sql`to_jsonb(${Number(value)}::numeric)`
      : sql`to_jsonb(${String(value)}::text)`;
  await sql`
    insert into platform_settings (city_id, key, value, value_type, description_ar)
    values (${cityId}, ${key}, ${json}, ${valueType}, 'قياسٌ')
    on conflict (city_id, key) do update set value = ${json}, value_type = ${valueType}
  `;
}

interface SettingSnapshot {
  readonly key: string;
  readonly text: string | null;
  readonly valueType: "string" | "number" | null;
}

const snapshots = new Map<string, SettingSnapshot>();

async function snapshotSetting(key: string): Promise<SettingSnapshot> {
  const existing = snapshots.get(key);
  if (existing !== undefined) return existing;
  const [row] = await sql<{ text: string; value_type: string }[]>`
    select value #>> '{}' as text, value_type
      from platform_settings
     where city_id = ${cityId} and key = ${key}
  `;
  let snapshot: SettingSnapshot;
  if (row === undefined) {
    snapshot = { key, text: null, valueType: null };
  } else {
    if (row.value_type !== "string" && row.value_type !== "number") {
      throw new Error(`نوعٌ لا يُرجِعُه هذا الملفُّ: ${key}=${row.value_type}`);
    }
    snapshot = { key, text: row.text, valueType: row.value_type };
  }
  snapshots.set(key, snapshot);
  return snapshot;
}

async function restoreSetting(snapshot: SettingSnapshot): Promise<void> {
  if (snapshot.valueType === null || snapshot.text === null) {
    await setSetting(snapshot.key, null, "string");
    return;
  }
  const value = snapshot.valueType === "number" ? Number(snapshot.text) : snapshot.text;
  await setSetting(snapshot.key, value, snapshot.valueType);
}

async function restoreSnapshots(): Promise<void> {
  for (const snapshot of snapshots.values()) await restoreSetting(snapshot);
  snapshots.clear();
}

async function settingsDigest(): Promise<string> {
  const rows = await sql<{ key: string; text: string; value_type: string }[]>`
    select key, value::text as text, value_type
      from platform_settings
     where city_id = ${cityId}
     order by key
  `;
  return rows.map((row) => `${row.key}=${row.text}:${row.value_type}`).join("\n");
}

let settingsDigestBefore = "";

async function withSetting<T>(
  key: string,
  value: string | number | null,
  valueType: "string" | "number",
  body: () => Promise<T>,
): Promise<T> {
  const snapshot = await snapshotSetting(key);
  await setSetting(key, value, valueType);
  try {
    return await body();
  } finally {
    snapshots.set(key, snapshot);
    await restoreSetting(snapshot);
  }
}

async function seedPaymentTransaction(options: {
  readonly amountMinor: number;
  readonly status: string;
  readonly plan: string;
  readonly createdAt: string;
}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into payment_transactions (
      city_id, payer_driver_id, payee_id, purpose,
      amount_minor, currency, provider, status, idempotency_key, metadata, created_at
    ) values (
      ${cityId}, ${driverId}, 'platform', 'driver_subscription',
      ${options.amountMinor}, 'SAR', 'manual', ${options.status}::text,
      ${`test:${options.createdAt}:${driverId}:${options.plan}`},
      ${sql.json({ plan: options.plan, checkout_url: null })},
      ${options.createdAt}::timestamptz
    ) returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ معاملةِ الدفعِ");
  return row.id;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائقُ الاشتراكِ', '+966500000471')
    returning id
  `;
  if (user === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = user.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ح ص ل 471')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;

  const [stranger] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${STRANGER_TELEGRAM_ID}, 'rider', 'قارئٌ غريبٌ', '+966500000472')
    returning id
  `;
  if (stranger === undefined) throw new Error("تعذّر زرعُ الغريبِ");
  strangerUserId = stranger.id;

  settingsDigestBefore = await settingsDigest();
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (driverId !== "") {
    await sql`delete from payment_transactions where payer_driver_id = ${driverId}`;
    await sql`delete from subscriptions where driver_id = ${driverId}`;
    await sql`delete from driver_availability where driver_id = ${driverId}`;
    await sql`delete from drivers where id = ${driverId}`;
  }
  if (strangerUserId !== "") await sql`delete from users where id = ${strangerUserId}`;
  if (driverUserId !== "") await sql`delete from users where id = ${driverUserId}`;
  await restoreSnapshots();
  await restoreCityBaseline(sql, cityHandle);
  const settingsDigestAfter = await settingsDigest();
  const settingsClean = settingsDigestAfter === settingsDigestBefore;
  await sql.end();
  if (!settingsClean) {
    throw new Error("إعداداتُ المدينةِ لم تُرجَع كما كانت — تلويثٌ يسقُطُ على ملفٍّ آخرَ");
  }
});

describeIf("الملكيّةُ — تقريرٌ عن نفسِه وحدَه", () => {
  it("١) حسابٌ لا صفَّ له ⇒ `USER_NOT_FOUND`", async () => {
    expect(await dashboard(900_000_999)).toEqual({ ok: false, error: "USER_NOT_FOUND" });
    expect(await history(900_000_999, 10)).toEqual({ ok: false, error: "USER_NOT_FOUND" });
  });

  it("٢) حسابٌ ليسَ سائقاً ⇒ `NOT_A_DRIVER` لا تقريرٌ فارغٌ", async () => {
    expect(await dashboard(STRANGER_TELEGRAM_ID)).toEqual({
      ok: false,
      error: "NOT_A_DRIVER",
    });
    expect(await history(STRANGER_TELEGRAM_ID, 5)).toEqual({
      ok: false,
      error: "NOT_A_DRIVER",
    });
  });
});

describeIf("اللوحُ — سائقٌ بلا اشتراكٍ سارٍ", () => {
  it("٣) بلا اشتراكٍ ⇒ `has_subscription=false` معَ الأسعارِ من الإعداداتِ", async () => {
    const result = await dashboard(DRIVER_TELEGRAM_ID);
    expect(result.ok).toBe(true);
    expect(result.has_subscription).toBe(false);
    const prices = block(result, "plan_prices");
    expect(Number(prices.transport)).toBe(250);
    expect(Number(prices.delivery)).toBe(250);
    expect(Number(prices.both)).toBe(400);
    expect(result.currency).toBe("SAR");
    expect(Number(result.trial_days)).toBe(30);
    expect(Number(result.period_days)).toBe(30);
  });

  it("٤) السعرُ يتغيّرُ بتغييرِ الإعدادِ — لا ثابتٍ صامتٍ", async () => {
    await withSetting("subscription_price_transport", 300, "number", async () => {
      const result = await dashboard(DRIVER_TELEGRAM_ID);
      const prices = block(result, "plan_prices");
      expect(Number(prices.transport)).toBe(300);
    });
  });

  it("٥) عملةٌ غائبةٌ ⇒ `currency` معدومٌ لا افتراضٌ صامتٌ", async () => {
    await withSetting("currency", null, "string", async () => {
      const result = await dashboard(DRIVER_TELEGRAM_ID);
      expect(result.currency).toBeNull();
    });
  });
});

describeIf("اللوحُ — سائقٌ بلا اشتراكٍ سارٍ: تجربةٌ سارية", () => {
  it("٦) تجربةٌ ساريةٌ ⇒ `has_subscription=true` معَ `is_trial=true`", async () => {
    const trialEnds = new Date(Date.now() + 15 * 86400_000).toISOString();
    const [sub] = await sql<{ id: string }[]>`
      insert into subscriptions (city_id, driver_id, plan, status, trial_ends_at, price_amount, currency)
      values (${cityId}, ${driverId}, 'transport'::subscription_plan, 'trialing'::subscription_status,
              ${trialEnds}::timestamptz, 250, 'SAR')
      returning id
    `;
    if (sub === undefined) throw new Error("تعذّر زرعُ الاشتراكِ");
    subscriptionId = sub.id;

    try {
      const result = await dashboard(DRIVER_TELEGRAM_ID);
      expect(result.ok).toBe(true);
      expect(result.has_subscription).toBe(true);
      expect(result.is_trial).toBe(true);
      expect(result.plan).toBe("transport");
      expect(result.status).toBe("trialing");
      expect(Number(result.trial_days)).toBe(30);
      expect(Number(result.period_days)).toBe(30);
      expect(result.expires_soon).toBe(false);
    } finally {
      await sql`delete from subscriptions where id = ${subscriptionId}`;
      subscriptionId = "";
    }
  });

  it("٧) اشتراكٌ فعّالٌ ينتهي قريباً ⇒ `expires_soon=true`", async () => {
    const periodEnd = new Date(Date.now() + 3 * 86400_000).toISOString();
    const [sub] = await sql<{ id: string }[]>`
      insert into subscriptions (city_id, driver_id, plan, status, current_period_end, price_amount, currency)
      values (${cityId}, ${driverId}, 'both'::subscription_plan, 'active'::subscription_status,
              ${periodEnd}::timestamptz, 400, 'SAR')
      returning id
    `;
    if (sub === undefined) throw new Error("تعذّر زرعُ الاشتراكِ");
    subscriptionId = sub.id;

    try {
      const result = await dashboard(DRIVER_TELEGRAM_ID);
      expect(result.has_subscription).toBe(true);
      expect(result.is_trial).toBe(false);
      expect(result.plan).toBe("both");
      expect(result.expires_soon).toBe(true);
      expect(Number(result.days_left)).toBeLessThanOrEqual(3);
      expect(Number(result.days_left)).toBeGreaterThanOrEqual(2);
    } finally {
      await sql`delete from subscriptions where id = ${subscriptionId}`;
      subscriptionId = "";
    }
  });

  it("٨) اشتراكٌ ملغًى طلبًا ⇒ `cancel_at_period_end=true`", async () => {
    const periodEnd = new Date(Date.now() + 10 * 86400_000).toISOString();
    const [sub] = await sql<{ id: string }[]>`
      insert into subscriptions (city_id, driver_id, plan, status, current_period_end,
                                  price_amount, currency, cancel_at_period_end, cancellation_requested_at)
      values (${cityId}, ${driverId}, 'delivery'::subscription_plan, 'active'::subscription_status,
              ${periodEnd}::timestamptz, 250, 'SAR', true, now())
      returning id
    `;
    if (sub === undefined) throw new Error("تعذّر زرعُ الاشتراكِ");
    subscriptionId = sub.id;

    try {
      const result = await dashboard(DRIVER_TELEGRAM_ID);
      expect(result.cancel_at_period_end).toBe(true);
      expect(result.cancellation_requested_at).not.toBeNull();
    } finally {
      await sql`delete from subscriptions where id = ${subscriptionId}`;
      subscriptionId = "";
    }
  });
});

describeIf("تاريخُ الدفعاتِ — من `payment_transactions` لا من عدَّادٍ", () => {
  it("٩) بلا دفعاتٍ ⇒ قائمةٌ فارغةٌ لا `null`", async () => {
    await sql`delete from payment_transactions where payer_driver_id = ${driverId}`;
    const result = await history(DRIVER_TELEGRAM_ID, 10);
    expect(result.ok).toBe(true);
    expect(result.entries).toEqual([]);
  });

  it("١٠) دفعةٌ واحدةٌ ⇒ سطرٌ بمعرّفٍ ومبلغٍ وحالةٍ وخطةٍ", async () => {
    await sql`delete from payment_transactions where payer_driver_id = ${driverId}`;
    const txId = await seedPaymentTransaction({
      amountMinor: 25000,
      status: "active",
      plan: "transport",
      createdAt: new Date().toISOString(),
    });
    try {
      const result = await history(DRIVER_TELEGRAM_ID, 10);
      const entries = result.entries as Record<string, unknown>[];
      expect(entries).toHaveLength(1);
      const entry = entries[0] as Record<string, unknown>;
      expect(entry.transaction_id).toBe(txId);
      expect(Number(entry.amount_minor)).toBe(25000);
      expect(entry.currency).toBe("SAR");
      expect(entry.provider).toBe("manual");
      expect(entry.status).toBe("active");
      expect(entry.plan).toBe("transport");
    } finally {
      await sql`delete from payment_transactions where id = ${txId}`;
    }
  });

  it("١١) دفعتانِ ⇒ مرتَّبتانِ بالأحدثِ أوّلاً", async () => {
    await sql`delete from payment_transactions where payer_driver_id = ${driverId}`;
    const older = await seedPaymentTransaction({
      amountMinor: 25000,
      status: "expired",
      plan: "transport",
      createdAt: new Date(Date.now() - 86400_000).toISOString(),
    });
    const newer = await seedPaymentTransaction({
      amountMinor: 40000,
      status: "active",
      plan: "both",
      createdAt: new Date().toISOString(),
    });
    try {
      const result = await history(DRIVER_TELEGRAM_ID, 10);
      const entries = result.entries as Record<string, unknown>[];
      expect(entries).toHaveLength(2);
      expect(entries[0]?.transaction_id).toBe(newer);
      expect(entries[1]?.transaction_id).toBe(older);
    } finally {
      await sql`delete from payment_transactions where id in (${older}, ${newer})`;
    }
  });

  it("١٢) السقفُ مقصورٌ في الخادمِ: خرافيٌّ ⇒ ٥٠، ومعدومٌ ⇒ ٢٠، وصفرٌ ⇒ ١", async () => {
    expect((await history(DRIVER_TELEGRAM_ID, 5000)).limit).toBe(50);
    expect((await history(DRIVER_TELEGRAM_ID, null)).limit).toBe(20);
    expect((await history(DRIVER_TELEGRAM_ID, 0)).limit).toBe(1);
  });

  it("١٣) الدفعةُ لا تحملُ هويّةَ راكبٍ — سجلُّ السائقِ عن نفسِه", async () => {
    await sql`delete from payment_transactions where payer_driver_id = ${driverId}`;
    const txId = await seedPaymentTransaction({
      amountMinor: 25000,
      status: "active",
      plan: "transport",
      createdAt: new Date().toISOString(),
    });
    try {
      const result = await history(DRIVER_TELEGRAM_ID, 10);
      const entries = result.entries as Record<string, unknown>[];
      const entry = entries[0] as Record<string, unknown>;
      for (const forbidden of ["rider_id", "rider_name", "rider_phone", "phone"]) {
        expect(Object.keys(entry)).not.toContain(forbidden);
      }
    } finally {
      await sql`delete from payment_transactions where id = ${txId}`;
    }
  });
});
