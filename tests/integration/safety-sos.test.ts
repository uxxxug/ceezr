/**
 * اختبار قاعدة حقيقية لمسار SOS: كتابة + outbox، تعافٍ بعد فشل تلغرام، وقفل قرار
 * فريق الإسناد. لا يوجد Telegram فعلي هنا؛ الناشر المزدوج يثبت أثر الإرسال فقط.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { deliverSafetyIncidents } from "../../apps/workers/src/jobs/deliver-safety-incidents.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { SafetyCardPublisher } from "../../packages/application/safety/ports.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createSafetyDeliveryPort,
  createSafetyResolutionPort,
  createTriggerSosPort,
} from "../../packages/infrastructure/safety/safety-adapters.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const RIDER_TELEGRAM_ID = "880001";
const SUPPORT_TELEGRAM_ID = "880101";
const ESCALATION_GROUP = "-100880";
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityId: string;
let orderId: string;
let reporterUserId: string;
let trigger: ReturnType<typeof createTriggerSosPort>;
let resolution: ReturnType<typeof createSafetyResolutionPort>;

async function createFixture(): Promise<void> {
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = city[0]?.id ?? "";
  if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
  await sql`
    update cities set is_active = true, telegram_support_group_id = -100881,
      telegram_escalation_group_id = ${ESCALATION_GROUP}::bigint,
      telegram_unsubscribed_drivers_group_id = -100882
    where id = ${cityId}
  `;
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, ${RIDER_TELEGRAM_ID}::bigint, 'راكب SOS', '+966500880001', 'rider')
    returning id
  `;
  reporterUserId = users[0]?.id ?? "";
  const riders = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${reporterUserId}::uuid) returning id
  `;
  const riderId = riders[0]?.id;
  if (riderId === undefined) throw new Error("تعذر تجهيز الراكب");
  const orders = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup)
    values (
      ${cityId}, ${riderId}::uuid, 'transport', 'searching',
      ST_SetSRID(ST_MakePoint(39.1728, 21.5433), 4326)::geography
    )
    returning id
  `;
  orderId = orders[0]?.id ?? "";
  if (orderId === "") throw new Error("تعذر تجهيز الطلب");
  await sql`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, ${SUPPORT_TELEGRAM_ID}::bigint, 'مدير الإسناد', '+966500880101', 'admin')
  `;
}

describeIf("SOS safety outbox على PostgreSQL فعلية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`
      truncate table safety_incident_deliveries, safety_incidents, order_offers, orders,
        driver_availability, drivers, riders, users restart identity cascade
    `;
    await createFixture();
    trigger = createTriggerSosPort(sql);
    resolution = createSafetyResolutionPort(sql);
  });

  /**
   * الانحصار الذي كان: المطالبة تمسح المدن كلّها بترتيب `created_at`، فصفٌّ في
   * مدينةٍ بلا مجموعة تصعيد كان يُختار أوّلاً، ويُرجع `ESCALATION_GROUP_MISSING`،
   * فيسقط الشوط كلّه — واستغاثةُ جدّة المهيّأة تماماً لا تُسلَّم أبداً. حقلٌ فارغ
   * في مدينةٍ غير مفعّلة كان يكفي لتعطيل مسار الاستغاثة في المنصّة كلّها.
   */
  it("صفٌّ أقدم في مدينةٍ بلا مجموعة تصعيد لا يمنع تسليم استغاثة جدّة", async () => {
    const poisonCity = await sql<{ id: string }[]>`
      select id from cities where code = 'MKK' and telegram_escalation_group_id is null
    `;
    const poisonCityId = poisonCity[0]?.id;
    if (poisonCityId === undefined) throw new Error("مدينة الاختبار غير مبذورة");

    // صفٌّ سامّ أقدم من صفّ جدّة، في مدينةٍ ناقصة الإعداد.
    const newId = async (rows: { id: string }[], what: string): Promise<string> => {
      const id = rows[0]?.id;
      if (id === undefined) throw new Error(`تعذر تجهيز ${what}`);
      return id;
    };
    const poisonUserId = await newId(
      await sql<{ id: string }[]>`
        insert into users (city_id, telegram_id, full_name, phone, role)
        values (${poisonCityId}, 880777::bigint, 'راكب مدينة غير مهيأة', '+966500880777', 'rider')
        returning id`,
      "الراكب",
    );
    const poisonRiderId = await newId(
      await sql<{ id: string }[]>`
        insert into riders (city_id, user_id) values (${poisonCityId}, ${poisonUserId}::uuid)
        returning id`,
      "ملف الراكب",
    );
    const poisonOrderId = await newId(
      await sql<{ id: string }[]>`
        insert into orders (city_id, rider_id, service, status, pickup)
        values (${poisonCityId}, ${poisonRiderId}::uuid, 'transport', 'searching',
          ST_SetSRID(ST_MakePoint(39.826, 21.389), 4326)::geography)
        returning id`,
      "الطلب",
    );
    const poisonIncidentId = await newId(
      await sql<{ id: string }[]>`
        insert into safety_incidents (city_id, order_id, reporter_role, reporter_user_id, status)
        values (${poisonCityId}, ${poisonOrderId}::uuid, 'rider', ${poisonUserId}::uuid, 'open')
        returning id`,
      "الحادث",
    );
    const poisonDelivery = await sql<{ id: string }[]>`
      insert into safety_incident_deliveries (city_id, incident_id, created_at, next_attempt_at)
      values (${poisonCityId}, ${poisonIncidentId}::uuid, now() - interval '1 hour',
        now() - interval '1 hour')
      returning id`;
    const poisonDeliveryId = poisonDelivery[0]?.id;
    if (poisonDeliveryId === undefined) throw new Error("تعذر تجهيز الصفّ السامّ");

    const triggered = await trigger.trigger({
      orderId,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
    });
    expect(triggered.ok).toBe(true);

    const published: string[] = [];
    const report = await deliverSafetyIncidents({
      deliveries: createSafetyDeliveryPort(sql),
      publisher: {
        publish: async (card) => {
          published.push(card.orderId);
          return ok("991");
        },
      } satisfies SafetyCardPublisher,
    });

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    // استغاثة جدّة سُلّمت رغم أنّ الصفّ السامّ أقدم منها.
    expect(report.value.delivered).toBe(1);
    expect(published).toEqual([orderId]);
    // والصفّ السامّ لم يُكتم: يُبلَّغ بسببه في كل دورة حتى يُضبط إعداد مدينته.
    expect(report.value.deferred).toEqual([
      { deliveryId: poisonDeliveryId, cityId: poisonCityId, reason: "ESCALATION_GROUP_MISSING" },
    ]);
    // ولم يُستهلك: لا محاولة محسوبة عليه ولا حالةٌ تغيّرت، فيُسلَّم فور ضبط الإعداد.
    const poisonRow = await sql<{ status: string; attempts: number }[]>`
      select status, attempts from safety_incident_deliveries where id = ${poisonDeliveryId}::uuid`;
    expect(poisonRow[0]?.status).toBe("pending");
    expect(poisonRow[0]?.attempts).toBe(0);
  });

  it("ضغطتا SOS متزامنتان تنشئان حادثاً واحداً وoutbox واحداً", async () => {
    const results = await Promise.all([
      trigger.trigger({ orderId, actorTelegramId: RIDER_TELEGRAM_ID, reporterRole: "rider" }),
      trigger.trigger({ orderId, actorTelegramId: RIDER_TELEGRAM_ID, reporterRole: "rider" }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(
      results.filter(
        (result) =>
          result.ok &&
          result.value.incidentId !== null &&
          "created" in result.value &&
          result.value.created,
      ),
    ).toHaveLength(1);
    const persisted = await sql<{ incidents: string; deliveries: string }[]>`
      select
        (select count(*)::text from safety_incidents where order_id = ${orderId}::uuid) incidents,
        (select count(*)::text from safety_incident_deliveries) deliveries
    `;
    expect(Number(persisted[0]?.incidents)).toBe(1);
    expect(Number(persisted[0]?.deliveries)).toBe(1);
  });

  it("فشل تيليجرام مرة لا يفقد الحادث ثم تسلمه المحاولة التالية مرة واحدة", async () => {
    const opened = await trigger.trigger({
      orderId,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
    });
    expect(opened.ok).toBe(true);
    let failedCalls = 0;
    const failing: SafetyCardPublisher = {
      publish: async () => {
        failedCalls += 1;
        return err(new PortFailureError("telegram.safetyCard", "temporary failure"));
      },
    };
    const first = await deliverSafetyIncidents({
      deliveries: createSafetyDeliveryPort(sql),
      publisher: failing,
    });
    // فشل النشر لم يعد يُسقط الشوط: يُعدّ فشلاً معلوماً ويستمرّ الشوط لغيره.
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.delivered).toBe(0);
      expect(first.value.failed).toBe(1);
    }
    expect(failedCalls).toBe(1);

    const pending = await sql<{ status: string; attempts: number }[]>`
      select status, attempts from safety_incident_deliveries
    `;
    expect(pending[0]?.status).toBe("pending");
    expect(pending[0]?.attempts).toBe(1);

    // نتجاوز فاصل الإعادة المأخوذ من platform_settings؛ لا ننتظر 30 ثانية في اختبار.
    await sql`update safety_incident_deliveries set next_attempt_at = now()`;
    let deliveredCalls = 0;
    const succeeding: SafetyCardPublisher = {
      publish: async () => {
        deliveredCalls += 1;
        return ok("7788");
      },
    };
    const second = await deliverSafetyIncidents({
      deliveries: createSafetyDeliveryPort(sql),
      publisher: succeeding,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.delivered).toBe(1);
    expect(deliveredCalls).toBe(1);
    const delivered = await sql<{ status: string; attempts: number; message_id: string }[]>`
      select status, attempts, delivered_message_id::text as message_id
      from safety_incident_deliveries
    `;
    expect(delivered[0]).toEqual({ status: "delivered", attempts: 2, message_id: "7788" });
  });

  it("إغلاقان متزامنان بعد الاستلام يسجلان قراراً واحداً فقط", async () => {
    const opened = await trigger.trigger({
      orderId,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok || opened.value.incidentId === null) return;
    const incidentId = opened.value.incidentId;
    const claimed = await resolution.claim(incidentId, SUPPORT_TELEGRAM_ID);
    expect(claimed.ok).toBe(true);
    if (claimed.ok) expect(claimed.value.claimed).toBe(true);

    const closed = await Promise.all([
      resolution.resolve({ incidentId, actorTelegramId: SUPPORT_TELEGRAM_ID, decision: "close" }),
      resolution.resolve({
        incidentId,
        actorTelegramId: SUPPORT_TELEGRAM_ID,
        decision: "block_reporter",
      }),
    ]);
    const succeeded = closed.filter((result) => result.ok && result.value.resolved);
    expect(succeeded).toHaveLength(1);
    const incident = await sql<
      {
        status: string;
        decision: string;
        decided_by_user_id: string;
        reporter_user_id: string;
      }[]
    >`
      select status, decision, decided_by_user_id::text, reporter_user_id::text
      from safety_incidents where id = ${incidentId}::uuid
    `;
    expect(incident[0]?.status).toBe("closed");
    expect(["close", "block_reporter"]).toContain(incident[0]?.decision ?? "");
    expect(incident[0]?.decided_by_user_id).not.toBeNull();
    if (incident[0]?.decision === "block_reporter") {
      const blocked = await sql<{ is_blocked: boolean }[]>`
        select is_blocked from users where id = ${reporterUserId}::uuid
      `;
      expect(blocked[0]?.is_blocked).toBe(true);
    }
  });

  it("قرار إنسان بالحجب يستدعي مسار الإدارة القائم ويحفظ من اتخذه", async () => {
    const opened = await trigger.trigger({
      orderId,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok || opened.value.incidentId === null) return;
    const incidentId = opened.value.incidentId;
    const claimed = await resolution.claim(incidentId, SUPPORT_TELEGRAM_ID);
    expect(claimed.ok).toBe(true);
    const closed = await resolution.resolve({
      incidentId,
      actorTelegramId: SUPPORT_TELEGRAM_ID,
      decision: "block_reporter",
    });
    expect(closed.ok).toBe(true);
    if (closed.ok) expect(closed.value.resolved).toBe(true);
    const audit = await sql<{ decision: string; is_blocked: boolean }[]>`
      select i.decision, u.is_blocked
      from safety_incidents i join users u on u.id = i.reporter_user_id
      where i.id = ${incidentId}::uuid
    `;
    expect(audit[0]).toEqual({ decision: "block_reporter", is_blocked: true });
  });
});
