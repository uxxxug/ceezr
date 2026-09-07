/**
 * الغرض: SCL-005 — إثبات أنّ معرّف بثّ الموقع الحيّ مشترك عبر النسخ عبر القاعدة،
 *   لا في خريطة عملية. اختبار تكامل على PostgreSQL حقيقي.
 *
 *   (١) `claimLiveMessageId` ذرّيّة: مطالبتان متزامنتان، فائزةٌ واحدة.
 *   (٢) `clearLiveMessageId` تُلغي المعرّف فتُرى `null` في القراءة التالية.
 *   (٣) `customerOf` تعيد `liveMessageId` من القاعدة.
 *   (٤) نسختان: A تبدأ بثّاً، B تَرِث المعرّف من القاعدة فلا تفتح رسالةً ثانية.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createCustomerLiveRelay } from "../../packages/application/tracking/customer-live-relay.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createTrackingProofReader } from "../../packages/infrastructure/tracking/tracking-queries.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const sql = DATABASE_URL ? createSql({ connectionString: DATABASE_URL }) : null;

beforeAll(() => {
  if (!sql) return;
});

afterAll(async () => {
  if (sql) await sql.end();
});

const TRIP_ID = "scl-005-test-trip";

interface ChannelCall {
  readonly op: "start" | "update" | "stop";
  readonly messageId?: string;
}

function captureChannel() {
  const calls: ChannelCall[] = [];
  let nextMsg = 100;
  return {
    calls,
    channel: {
      start: async () => {
        nextMsg += 1;
        const messageId = `msg-${nextMsg}`;
        calls.push({ op: "start", messageId });
        return messageId;
      },
      update: async (_chatId: string, messageId: string) => {
        calls.push({ op: "update", messageId });
        return true;
      },
      stop: async (_chatId: string, _messageId: string) => {
        calls.push({ op: "stop" });
        return true;
      },
    },
  };
}

async function ensureTestOrder(sql: Sql): Promise<void> {
  await sql`
    insert into cities (id, name_ar, name_en, slug, is_active)
    values ('scl-005-city', 'مدينة اختبار SCL-005', 'SCL-005 Test City', 'scl-005-test', true)
    on conflict (id) do nothing
  `;
  await sql`
    insert into users (id, telegram_id, language_code, created_at)
    values ('scl-005-user', 999005, 'ar', now())
    on conflict (id) do nothing
  `;
  await sql`
    insert into riders (id, user_id, created_at)
    values ('scl-005-rider', 'scl-005-user', now())
    on conflict (id) do nothing
  `;
  await sql`
    insert into drivers (id, user_id, city_id, created_at)
    values ('scl-005-driver', 'scl-005-user', 'scl-005-city', now())
    on conflict (id) do nothing
  `;
  await sql`
    insert into orders (id, rider_id, city_id, assigned_driver_id, status, created_at)
    values (${TRIP_ID}::uuid, 'scl-005-rider', 'scl-005-city', 'scl-005-driver', 'in_progress', now())
    on conflict (id) do update set
      assigned_driver_id = 'scl-005-driver',
      status = 'in_progress',
      live_message_id = null
  `;
}

async function resetLiveMessageId(sql: Sql): Promise<void> {
  await sql`update orders set live_message_id = null where id = ${TRIP_ID}::uuid`;
}

async function cleanupTestOrder(sql: Sql): Promise<void> {
  await sql`delete from orders where id = ${TRIP_ID}::uuid`;
}

const positionEvent = (
  overrides: Partial<{
    tripId: string;
    sessionId: string;
    sequence: number;
    lat: number;
    lng: number;
  }> = {},
) => ({
  type: "location_updated" as const,
  driverId: "scl-005-driver",
  cityId: "scl-005-city",
  tripId: overrides.tripId ?? TRIP_ID,
  sessionId: overrides.sessionId ?? "scl-005-session-1",
  sequence: overrides.sequence ?? 1,
  position: {
    lat: overrides.lat ?? 21.5471,
    lng: overrides.lng ?? 39.1751,
  },
  timestamp: new Date(),
});

describe.skipIf(!DATABASE_URL)("SCL-005 — بثّ الموقع الحيّ مشترك عبر القاعدة", () => {
  let proofReader: ReturnType<typeof createTrackingProofReader>;

  beforeAll(async () => {
    if (!sql) return;
    proofReader = createTrackingProofReader(sql);
    await ensureTestOrder(sql);
  });

  afterAll(async () => {
    if (sql) await cleanupTestOrder(sql);
  });

  it("claimLiveMessageId ذرّيّة: مطالبتان متزامنتان، فائزةٌ واحدة", async () => {
    const claim1 = proofReader.claimLiveMessageId(TRIP_ID, "msg-claim-1");
    const claim2 = proofReader.claimLiveMessageId(TRIP_ID, "msg-claim-2");
    const [result1, result2] = await Promise.all([claim1, claim2]);
    expect(result1 || result2).toBe(true);
    expect(result1 && result2).toBe(false);
  });

  it("clearLiveMessageId تُلغي المعرّد فتُرى null في القراءة التالية", async () => {
    await proofReader.claimLiveMessageId(TRIP_ID, "msg-to-clear");
    await proofReader.clearLiveMessageId(TRIP_ID);
    const target = await proofReader.customerOf(TRIP_ID);
    expect(target?.liveMessageId).toBeNull();
  });

  it("customerOf تعيد liveMessageId من القاعدة", async () => {
    await proofReader.claimLiveMessageId(TRIP_ID, "msg-from-db");
    const target = await proofReader.customerOf(TRIP_ID);
    expect(target?.liveMessageId).toBe("msg-from-db");
    await proofReader.clearLiveMessageId(TRIP_ID);
  });

  it("نسختان: A تبدأ بثّاً، B تَرِث المعرّف من القاعدة فلا تفتح رسالةً ثانية", async () => {
    await resetLiveMessageId(sql as Sql);
    const now = { value: 1_000_000 };
    const capturedA = captureChannel();
    const capturedB = captureChannel();

    const relayA = createCustomerLiveRelay({
      channel: capturedA.channel,
      customers: {
        resolve: (tripId) => proofReader.customerOf(tripId),
        claimLiveMessageId: (tripId, messageId) =>
          proofReader.claimLiveMessageId(tripId, messageId),
        clearLiveMessageId: (tripId) => proofReader.clearLiveMessageId(tripId),
      },
      clock: { now: () => new Date(now.value) },
      livePeriodSeconds: 3600,
    });

    const relayB = createCustomerLiveRelay({
      channel: capturedB.channel,
      customers: {
        resolve: (tripId) => proofReader.customerOf(tripId),
        claimLiveMessageId: (tripId, messageId) =>
          proofReader.claimLiveMessageId(tripId, messageId),
        clearLiveMessageId: (tripId) => proofReader.clearLiveMessageId(tripId),
      },
      clock: { now: () => new Date(now.value) },
      livePeriodSeconds: 3600,
    });

    await relayA.handle(positionEvent({ sequence: 1 }));
    expect(capturedA.calls.map((c) => c.op)).toEqual(["start"]);
    expect(relayA.openBroadcasts).toBe(1);

    now.value += 10_000;
    await relayB.handle(
      positionEvent({
        sequence: 2,
        lat: 21.56,
        lng: 39.18,
      }),
    );

    /**
     * SCL-005 — B لم يبدأ بثّاً جديداً (لا "start")، بل وَرِث المعرّف وحدّث الرسالة
     * ("update") بالموقع الأحدث.
     */
    expect(capturedB.calls.map((c) => c.op)).toEqual(["update"]);
    expect(relayB.openBroadcasts).toBe(1);

    await proofReader.clearLiveMessageId(TRIP_ID);
  });
});
