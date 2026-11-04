/**
 * الغرض: `WR-42` — التدخّلُ الإداريُّ في الطلباتِ العالقةِ على قاعدةٍ حقيقيّةٍ:
 *   الإلغاءُ من `searching`/`matched` عبرَ `cancel_order_by_rider` نفسِها
 *   (بفروعِها)، والقطعُ من `in_progress` عبرَ `driver_abort_ride`، والإنهاءُ
 *   من `in_progress` وحده (لا إنهاءَ لما لم يبدأ)، والسببُ شرطُ قبولٍ،
 *   والفاعلُ مشرفٌ لا سائقٌ ولا راكبٌ، والسجلُّ المحاسبيُّ يكتبُ «مَن قرَّرَ
 *   ولمَ» فوقَ أثرِ الآليّاتِ، والإشعاراتُ تُودَعُ للطرفَينِ، والتكرارُ
 *   يُرَدُّ (لا تدخّلٌ مزدوجٌ)، وحالةُ الطلبِ المُرفَقِ تصلُ بطاقةَ الدعمِ.
 * الحالة: اختبار تكامل فعلي — يتطلّب TEST_DATABASE_URL بها الهجرات مطبَّقة
 *   (ومنها 20261104120000).
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وكلُّ تعديلٍ يمسُّ التدخّلَ الإداريَّ أو
 *   سياساتِ الإلغاءِ بعدَ الإسنادِ.
 * ملاحظات مستقبلية: إرسالُ رسالةِ تلغرامِ الفعليةِ للسائقِ يُقاسُ في وحداتِ
 *   المعالجِ بمُرسِلٍ مُصنَّعٍ — ههنا تُقاسُ المعاملةُ والأثرُ في الجذرِ.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه — بعيدةٌ عن أيِّ حسابٍ أو قروبٍ حقيقيٍّ. */
const RIDER_TG = 900_004_201;
const DRIVER_TG = 900_004_203;
const ADMIN_TG = 900_004_205;

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderId = "";
let driverId = "";
const seededUserIds: string[] = [];

async function seedRider(): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TG}, 'rider', 'راكبُ التدخّلِ', '+966500004201') returning id`;
  if (user === undefined) throw new Error("تعذّر زرعُ الراكب");
  seededUserIds.push(user.id);
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${user.id}) returning id`;
  if (rider === undefined) throw new Error("تعذّر زرعُ صفِّ الراكب");
  return rider.id;
}

async function seedDriver(): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TG}, 'driver', 'سائقُ التدخّلِ', '+966500004203') returning id`;
  if (user === undefined) throw new Error("تعذّر زرعُ السائق");
  seededUserIds.push(user.id);
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${user.id}, 'verified'::verification_status, 'سيدان', 'ح ب 421') returning id`;
  if (driver === undefined) throw new Error("تعذّر زرعُ صفِّ السائق");
  await sql`
    insert into driver_availability (city_id, driver_id, is_available)
    values (${cityId}, ${driver.id}, false)`;
  return driver.id;
}

async function seedAdmin(): Promise<void> {
  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${ADMIN_TG}, 'admin', 'مشرفُ التدخّلِ', '+966500004205') returning id`;
  if (user === undefined) throw new Error("تعذّر زرعُ المشرف");
  seededUserIds.push(user.id);
}

/** طلبٌ بالحالةِ المطلوبةِ — `orders_matched_requires_driver` يُلزِمُ سائقًا للمسنَدِ والجاري. */
async function seedOrder(
  status: "searching" | "matched" | "in_progress" | "completed" | "scheduled",
): Promise<string> {
  const assigned = status === "searching" || status === "scheduled" ? null : driverId;
  // `orders_scheduled_has_times`: المجدولُ لا يُحفَظُ إلا بموعدِ إطلاقٍ وموعدِ
  // حضورٍ — وإلّا ردَّ القيدُ الزرعَ قبلَ أن يبدأَ الاختبار.
  const scheduledTimes =
    status === "scheduled"
      ? sql`now() + interval '2 hours', now() + interval '3 hours'`
      : sql`null, null`;
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff,
      pickup_label, dropoff_label, assigned_driver_id, started_at, dispatch_at, pickup_at)
    values (
      ${cityId}, ${riderId}, 'transport'::service_type, ${status}::order_status,
      st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography,
      st_setsrid(st_makepoint(39.1728, 21.5433), 4326)::geography,
      'نقطةُ الانطلاق', 'الحرم', ${assigned},
      ${status === "in_progress" ? sql`now() - interval '25 minutes'` : null},
      ${scheduledTimes}
    ) returning id`;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلب");
  return order.id;
}

async function intervene(
  orderId: string,
  actorTg: number,
  action: string,
  reason: string,
): Promise<Record<string, unknown>> {
  const [row] = await sql<{ result: Record<string, unknown> }[]>`
    select admin_intervene_order(${orderId}::uuid, ${actorTg}::bigint, ${action}, ${reason}) as result`;
  return row?.result ?? {};
}

async function orderStatus(orderId: string): Promise<string | null> {
  const [row] = await sql<{ status: string | null }[]>`
    select status::text from orders where id = ${orderId}`;
  return row?.status ?? null;
}

async function auditActions(orderId: string): Promise<string[]> {
  const rows = await sql<{ action: string }[]>`
    select action from audit_log where entity_type = 'order' and entity_id = ${orderId}
    order by created_at`;
  return rows.map((row) => row.action);
}

async function cleanupOrder(orderId: string): Promise<void> {
  const scoped = sql`select id from orders where id = ${orderId}`;
  await sql`delete from notification_outbox where order_id in (${scoped})`;
  await sql`delete from support_tickets where order_id in (${scoped})`;
  await sql`delete from order_offers where order_id in (${scoped})`;
  await sql`delete from audit_log where entity_type = 'order' and entity_id in (${scoped})`;
  await sql`delete from orders where id in (${scoped})`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;
  riderId = await seedRider();
  driverId = await seedDriver();
  await seedAdmin();
});

afterAll(async () => {
  if (sql === undefined) return;
  const scoped = sql`select id from orders where rider_id = ${riderId}`;
  await sql`delete from notification_outbox where order_id in (${scoped})`;
  await sql`delete from support_tickets where order_id in (${scoped})`;
  await sql`delete from order_offers where order_id in (${scoped})`;
  await sql`delete from audit_log where entity_type = 'order' and entity_id in (${scoped})`;
  // وآليّاتُ الإلغاءِ والقطعِ تكتبُ سجلاتٍ بكياناتٍ غيرِ الطلبِ (راكبٌ/سائقٌ)
  // بيدِ الفاعلِينَ المزروعِينَ — فهذهِ تُمحى بدورِها وإلّا منعَ المفتاحُ
  // الأجنبيُّ حذفَ حساباتِهم.
  await sql`delete from audit_log where actor_user_id = any(${seededUserIds}::uuid[])
    or entity_id = any(${[...seededUserIds, riderId, driverId]}::uuid[])`;
  await sql`delete from orders where rider_id = ${riderId}`;
  await sql`delete from driver_availability where driver_id = ${driverId}`;
  await sql`delete from drivers where id = ${driverId}`;
  await sql`delete from riders where id = ${riderId}`;
  await sql`delete from users where id = any(${seededUserIds}::uuid[])`;
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql.end({ timeout: 5 });
});

describeIf("WR-42 — التدخّلُ الإداريُّ في الطلباتِ العالقةِ", () => {
  it("السببُ شرطُ قبولٍ، والفاعلُ مشرفٌ، والفعلُ معروفٌ — وإلّا رُدَّ بلا أثرٍ", async () => {
    const orderId = await seedOrder("searching");
    try {
      await expect(intervene(orderId, ADMIN_TG, "cancel", "  ")).resolves.toMatchObject({
        ok: false,
        error: "REASON_REQUIRED",
      });
      await expect(intervene(orderId, RIDER_TG, "cancel", "سببٌ كافٍ")).resolves.toMatchObject({
        ok: false,
        error: "NOT_ADMIN",
      });
      await expect(intervene(orderId, ADMIN_TG, "reschedule", "سببٌ كافٍ")).resolves.toMatchObject({
        ok: false,
        error: "ACTION_UNKNOWN",
      });
      // لا أثرَ لكلِّ نداءٍ مرفوضٍ: الطلبُ كما هو.
      expect(await orderStatus(orderId)).toBe("searching");
    } finally {
      await cleanupOrder(orderId);
    }
  });

  it("إلغاءٌ إداريٌّ لطلبٍ لم يبدأ: من `searching` عبرَ مسارِ الراكبِ نفسِهِ", async () => {
    const orderId = await seedOrder("searching");
    try {
      const result = await intervene(orderId, ADMIN_TG, "cancel", "طلبٌ بلا سائقٍ والراكبُ عالقٌ");
      expect(result.ok).toBe(true);
      expect(await orderStatus(orderId)).toBe("cancelled");
      // السجلُّ: أثرُ الآليّةِ (order.cancelled) فوقَهُ «مَن قرَّرَ ولمَ».
      const actions = await auditActions(orderId);
      expect(actions).toContain("order.cancelled");
      expect(actions).toContain("order.admin_intervention");
      // والراكبُ يُخبَرُ أنَّ طلبَهُ قُطِعَ فلا يبقى ينتظرُ.
      const [notice] = await sql<{ kind: string }[]>`
        select kind::text from notification_outbox
        where order_id = ${orderId} and kind = 'rider_trip_notice' limit 1`;
      expect(notice?.kind).toBe("rider_trip_notice");
    } finally {
      await cleanupOrder(orderId);
    }
  });

  it("إلغاءٌ إداريٌّ لطلبٍ مُسنَدٍ لم يبدأ: الواقعةُ نفسُها (matched) تُلغى الآن", async () => {
    const orderId = await seedOrder("matched");
    try {
      const result = await intervene(orderId, ADMIN_TG, "cancel", "سائقٌ وصلَ ولم يبدأْ والراكبُ عالقٌ");
      expect(result.ok).toBe(true);
      expect(await orderStatus(orderId)).toBe("cancelled");
      const actions = await auditActions(orderId);
      expect(actions).toContain("order.cancelled");
      expect(actions).toContain("order.admin_intervention");
    } finally {
      await cleanupOrder(orderId);
    }
  });

  it("لا يُنهى إداريًّا طلبٌ لم يبدأْ قطُّ: ذاكَ إلغاءٌ لا إنهاء", async () => {
    const orderId = await seedOrder("matched");
    try {
      const result = await intervene(orderId, ADMIN_TG, "complete", "محاولةُ إنهاءِ طلبٍ لم يبدأ");
      expect(result).toMatchObject({ ok: false, error: "ORDER_NOT_COMPLETABLE" });
      expect(await orderStatus(orderId)).toBe("matched");
    } finally {
      await cleanupOrder(orderId);
    }
  });

  it("فعلٌ معدومٌ (NULL) يُرَدُّ صريحًا — ولا أثرَ لا في الطلبِ ولا السجلِّ ولا الإشعاراتِ", async () => {
    // `NOT IN` على معدومٍ يُقيَّمُ معدومًا فلا يُرفضُ — فالرفضُ هنا صريحٌ
    // قبلَ أيِّ مساسٍ، والدليلُ: الحالةُ كما هي، ولا سجلَّ ولا إشعارًا.
    const orderId = await seedOrder("matched");
    try {
      const result = await intervene(
        orderId,
        ADMIN_TG,
        null as unknown as string,
        "سببٌ كافٍ لا ينقذُ فعلًا معدومًا",
      );
      expect(result).toMatchObject({ ok: false, error: "ACTION_UNKNOWN" });
      expect(await orderStatus(orderId)).toBe("matched");
      expect(await auditActions(orderId)).toEqual([]);
      const [notices] = await sql<{ n: number }[]>`
        select count(*)::int as n from notification_outbox where order_id = ${orderId}`;
      expect(notices?.n).toBe(0);
    } finally {
      await cleanupOrder(orderId);
    }
  });

  it("طلبٌ مجدولٌ (scheduled) لا يُمسُّ: رمزٌ صريحٌ بلا أيِّ أثرٍ جانبيٍّ", async () => {
    // مسارا التدخّلِ (إلغاءُ الراكبِ وقطعُ السائقِ) لا يقبلانِ `scheduled` —
    // فاستبعادُهُ من بابِ التدخّلِ عمدٌ لا سهوً، والفتحُ لاحقًا بقرارٍ معلَن.
    const orderId = await seedOrder("scheduled");
    try {
      await expect(
        intervene(orderId, ADMIN_TG, "cancel", "طلبٌ لم يحِنْ وقتُه"),
      ).resolves.toMatchObject({
        ok: false,
        error: "ORDER_NOT_INTERVENABLE",
      });
      await expect(
        intervene(orderId, ADMIN_TG, "complete", "طلبٌ لم يحِنْ وقتُه"),
      ).resolves.toMatchObject({
        ok: false,
        error: "ORDER_NOT_COMPLETABLE",
      });
      expect(await orderStatus(orderId)).toBe("scheduled");
      expect(await auditActions(orderId)).toEqual([]);
      const [notices] = await sql<{ n: number }[]>`
        select count(*)::int as n from notification_outbox where order_id = ${orderId}`;
      expect(notices?.n).toBe(0);
    } finally {
      await cleanupOrder(orderId);
    }
  });

  it("إنهاءٌ إداريٌّ لرحلةٍ في الواقعِ (in_progress): تكتملُ وتُخطرُ الطرفَينِ", async () => {
    const orderId = await seedOrder("in_progress");
    try {
      const result = await intervene(
        orderId,
        ADMIN_TG,
        "complete",
        "رحلةٌ جاريةٌ معلَّقةٌ والطرفانِ ينتظرانِ",
      );
      expect(result.ok).toBe(true);
      expect(await orderStatus(orderId)).toBe("completed");
      const actions = await auditActions(orderId);
      expect(actions).toContain("order.completed");
      expect(actions).toContain("order.admin_intervention");
      // السائقُ يُخبَرُ بنوعِ التدخّلِ الصادقِ لا بإلغاءٍ كاذبٍ.
      const [driverNotice] = await sql<{ payload: Record<string, unknown> }[]>`
        select payload from notification_outbox
        where order_id = ${orderId} and kind = 'admin_order_intervention' limit 1`;
      expect(driverNotice?.payload).toMatchObject({ action: "complete", driver_id: driverId });
      // والراكبُ يُخبَرُ باكتمالِ رحلتِهِ.
      const [riderNotice] = await sql<{ kind: string }[]>`
        select kind::text from notification_outbox
        where order_id = ${orderId} and kind = 'rider_trip_notice' limit 1`;
      expect(riderNotice?.kind).toBe("rider_trip_notice");
    } finally {
      await cleanupOrder(orderId);
    }
  });

  it("قطعٌ إداريٌّ لرحلةٍ في الواقعِ: مسارُ قطعِ السائقِ نفسُهُ وإخطارُهُ بيدِ مَن قُطِعَت", async () => {
    const orderId = await seedOrder("in_progress");
    try {
      const result = await intervene(orderId, ADMIN_TG, "cancel", "رحلةٌ جاريةٌ متعثّرةٌ والراكبُ عالقٌ");
      expect(result.ok).toBe(true);
      expect(await orderStatus(orderId)).toBe("cancelled");
      const actions = await auditActions(orderId);
      expect(actions).toContain("order.aborted_by_driver");
      expect(actions).toContain("order.admin_intervention");
      const [driverNotice] = await sql<{ payload: Record<string, unknown> }[]>`
        select payload from notification_outbox
        where order_id = ${orderId} and kind = 'admin_order_intervention' limit 1`;
      expect(driverNotice?.payload).toMatchObject({ action: "cancel", driver_id: driverId });
    } finally {
      await cleanupOrder(orderId);
    }
  });

  it("طلبٌ انتهى لا يُمسُّ: إلغاءٌ ثانٍ أو تدخّلٌ على مُكتملٍ يُرَدُّ — فلا تدخّلٌ مزدوجٌ", async () => {
    const orderId = await seedOrder("completed");
    try {
      await expect(intervene(orderId, ADMIN_TG, "cancel", "طلبٌ انتهى")).resolves.toMatchObject({
        ok: false,
        error: "ORDER_NOT_INTERVENABLE",
      });
      await expect(intervene(orderId, ADMIN_TG, "complete", "طلبٌ انتهى")).resolves.toMatchObject({
        ok: false,
        error: "ORDER_NOT_COMPLETABLE",
      });
      expect(await orderStatus(orderId)).toBe("completed");
    } finally {
      await cleanupOrder(orderId);
    }

    // والتدخّلُ على طلبٍ خُتِمَ بالتدخّلِ نفسِهِ يُرَدُّ بالرمزِ نفسِهِ.
    const liveOrderId = await seedOrder("matched");
    try {
      expect((await intervene(liveOrderId, ADMIN_TG, "cancel", "إلغاءٌ أول")).ok).toBe(true);
      await expect(intervene(liveOrderId, ADMIN_TG, "cancel", "إلغاءٌ ثانٍ")).resolves.toMatchObject({
        ok: false,
        error: "ORDER_NOT_INTERVENABLE",
      });
    } finally {
      await cleanupOrder(liveOrderId);
    }
  });

  it("طلبٌ مجهولٌ يُرَدُّ بـORDER_NOT_FOUND، وبطاقةُ الدعمِ تحملُ حالةَ الطلبِ المُرفَقِ", async () => {
    await expect(
      intervene("00000000-0000-4000-8000-000000000042", ADMIN_TG, "cancel", "طلبٌ غيرُ موجود"),
    ).resolves.toMatchObject({ ok: false, error: "ORDER_NOT_FOUND" });

    // «واجهةٌ قديمةٌ» أو راكبٌ عالقٌ يطلبُ المساعدةَ: التذكرةُ تُفتحُ على طلبٍ
    // حيٍّ، والبطاقةُ تجلبُ حالتَهُ منَ الجذرِ لا من نصِّ الرسالةِ.
    const orderId = await seedOrder("matched");
    try {
      const [opened] = await sql<{ result: Record<string, unknown> }[]>`
        select open_support_ticket(${RIDER_TG}::bigint, 'app_problem', 'طلبي عالقٌ ولا أعرفُ ماذا أفعل', null, ${orderId}::uuid) as result`;
      const ticketId = String(opened?.result.ticket_id ?? "");
      expect(ticketId).not.toBe("");
      const [context] = await sql<{ result: Record<string, unknown> }[]>`
        select get_support_ticket_context(${ticketId}::uuid) as result`;
      expect(context?.result.order_id).toBe(orderId);
      expect(context?.result.order_status).toBe("matched");
      expect(context?.result.order_stuck_minutes).not.toBeNull();
    } finally {
      await cleanupOrder(orderId);
    }
  });
});
