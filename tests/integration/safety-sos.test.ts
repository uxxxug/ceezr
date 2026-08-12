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
    expect(first.ok).toBe(false);
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
