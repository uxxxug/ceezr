/**
 * الغرض: `W-5` (ناقلٌ) — إثباتُ **الطريقَينِ كاملَينِ** على قاعدةٍ حقيقيّةٍ:
 *   (١) بابُ الاستقبالِ الحقيقيُّ (`apps/gateway/src/routes/core-event-intake.ts`)
 *       يُوصِلُ حدثاً موقَّعاً من CORE إلى مهمّةٍ في الجدولِ، وإعادةُ إرسالِه
 *       عينِه لا تُنشِئُ مهمّةً ثانيةً ولا صفَّ واردٍ ثانياً.
 *   (٢) الناقلُ الحقيقيُّ (`packages/infrastructure/wasla/core-event-shipper.ts`)
 *       يُودِعُ ما في صندوقِ الصادرِ في `POST /v1/events` بمصادقةِ حاملٍ، فيُغلَقُ
 *       الصفُّ مُسلَّماً؛ وعندَ رفضٍ عقديٍّ يموتُ الصفُّ من محاولتِه الأولى.
 *
 *   والفرقُ عن `tests/integration/wasla-fulfillment-lifecycle.test.ts`: ذاكَ
 *   يقيسُ **آلةَ الحالاتِ** بناقلٍ مزدوجٍ، وهذا يقيسُ **الناقلَ والبابَ** أنفسَهما
 *   موصولَينِ بالقاعدةِ. فلا تكرارَ بينَهما ولا فراغَ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL · 2026-09-12.
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun run test:integration` وسلسلةُ CI بقاعدةٍ حقيقيّةٍ.
 * ملاحظات مستقبلية: نظيرُ CORE ههنا `fetch` مزدوجٌ يُطبِّقُ عقدَه المنقولَ، لا
 *   خادمُ CORE نفسُه. فالمقيسُ **مطابقتُنا للعقدِ المكتوبِ**، لا أنَّ CORE الحقيقيَّ
 *   قَبِلَ؛ وذاكَ الأخيرُ محجوبٌ بـ`DEP-CORE-007` (لا بيئةَ CORE مشتركةٌ ولا رمزَ
 *   خدمةٍ لـMOVE) وهوَ مسجَّلٌ لا مُدَّعىً مُنجَزاً.
 *
 * ## لِمَ يُقاسُ البابُ بجسمٍ موقَّعٍ فعلاً لا بحالةِ استخدامٍ مزدوجةٍ
 *
 * لأنَّ الخطرَ في الوصلِ لا في الطرفَينِ: توقيعٌ يُحسَبُ على بايتاتٍ غيرِ التي
 * وصلَت، أو مغلَّفٌ يُفَكُّ ثمَّ يُعادُ تركيبُه قبلَ التحقّقِ، أو معرّفٌ يُقرأُ من
 * الجسمِ ويُودَعُ غيرُه. وكلُّ هذه لا تظهرُ إلّا بجسمٍ حقيقيٍّ يمرُّ من البابِ إلى
 * القاعدةِ في نفسِ المسارِ الذي سيمرُّ منه حدثُ CORE.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import {
  CORE_EVENT_INTAKE_PATH,
  createCoreEventIntakeRoutes,
} from "../../apps/gateway/src/routes/core-event-intake.ts";
import { createFulfillmentLifecycle } from "../../packages/application/wasla/fulfillment-lifecycle.ts";
import { validateEnvelope } from "../../packages/domain/wasla/event-envelope.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createCoreEventShipper } from "../../packages/infrastructure/wasla/core-event-shipper.ts";
import { createOperationalJobRepository } from "../../packages/infrastructure/wasla/operational-job-repository.ts";
import { isOk } from "../../packages/shared/result/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SECRET = "c".repeat(48);
const ORG = "22222222-2222-4222-8222-222222222222";

let sql: Sql;
let store: ReturnType<typeof createOperationalJobRepository>;
let lifecycle: ReturnType<typeof createFulfillmentLifecycle>;
let intake: ReturnType<typeof createCoreEventIntakeRoutes>;

let seq = 0;
function uuid(prefix: number): string {
  seq += 1;
  return `${String(prefix).padStart(8, "0")}-3333-4333-8333-${String(seq).padStart(12, "0")}`;
}

/** مغلَّفُ إنشاءٍ كما يُرسِلُه CORE — بايتاتُه هيَ ما يُوقَّعُ عليه. */
function createdBody(fulfillmentId: string, eventId: string): string {
  return JSON.stringify({
    event_id: eventId,
    event_type: "core.fulfillment.created",
    version: 1,
    producer: "wasla-core",
    occurred_at: "2026-09-12T10:00:00.000Z",
    correlation_id: `corr-${fulfillmentId}`,
    causation_id: null,
    entity_type: "fulfillment",
    entity_id: fulfillmentId,
    payload: {
      fulfillment_id: fulfillmentId,
      organization_id: ORG,
      order_reference: `order-${fulfillmentId.slice(-4)}`,
      requested_service: "delivery",
    },
  });
}

async function deliver(body: string, eventId: string, secret = SECRET): Promise<Response> {
  return await intake.request(CORE_EVENT_INTAKE_PATH, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-wasla-event-id": eventId,
      "x-wasla-signature": `sha256=${createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex")}`,
    },
    body,
  });
}

/** نظيرُ CORE: يقبلُ بـ`202` ويُسجِّلُ ما وصلَه، ويُطبِّقُ إسلامَ المعرّفِ. */
function coreThatAccepts(): { readonly fetch: typeof fetch; readonly seen: unknown[] } {
  const seen: unknown[] = [];
  const ids = new Set<string>();
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const authorization = (init.headers as Record<string, string>).authorization;
    if (authorization !== "Bearer move-service-token") {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }
    if (!String(url).endsWith("/v1/events")) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }
    seen.push(body);
    const eventId = String(body.event_id);
    const first = !ids.has(eventId);
    ids.add(eventId);
    return new Response(
      JSON.stringify({ event_id: eventId, accepted: true, first_delivery: first }),
      { status: 202, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, seen };
}

/** نظيرُ CORE الرافضُ عقديّاً: `422` — رفضٌ لا يُصلِحُه انتظارٌ. */
const coreThatRefuses = (async () =>
  new Response(JSON.stringify({ error: "envelope invalid" }), {
    status: 422,
  })) as unknown as typeof fetch;

interface OutboxRow {
  readonly event_type: string;
  readonly attempts: number;
  readonly delivered_at: Date | null;
  readonly dead_at: Date | null;
  readonly last_error: string | null;
}

async function outbox(fulfillmentId: string): Promise<readonly OutboxRow[]> {
  return await sql<OutboxRow[]>`
    select event_type, attempts, delivered_at, dead_at, last_error
      from move_event_outbox where entity_id = ${fulfillmentId} order by dedup_key`;
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("ناقلُ الحدِّ مع CORE موصولاً بالقاعدةِ — W-5", () => {
  beforeAll(() => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    store = createOperationalJobRepository(sql);
    lifecycle = createFulfillmentLifecycle(store);
    intake = createCoreEventIntakeRoutes({ signingSecret: SECRET, lifecycle });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table move_event_outbox, core_event_inbox, operational_jobs restart identity cascade`;
  });

  describe("١) الاستقبالُ من البابِ إلى الجدولِ", () => {
    it("حدثٌ موقَّعٌ من CORE يُنشئُ مهمّةً «قيدَ التنسيقِ» ويُقيَّدُ في صندوقِ الواردِ", async () => {
      const fulfillmentId = uuid(70);
      const eventId = uuid(71);
      const body = createdBody(fulfillmentId, eventId);

      const response = await deliver(body, eventId);

      expect(response.status).toBe(200);
      const payload = (await response.json()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.changed).toBe(true);
      expect(payload.state).toBe("coordinating");

      const jobs = await sql<{ state: string }[]>`
        select state from operational_jobs where fulfillment_id = ${fulfillmentId}`;
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.state).toBe("coordinating");

      const inbox = await sql<{ count: string }[]>`
        select count(*)::text as count from core_event_inbox where event_id = ${eventId}::uuid`;
      expect(inbox[0]?.count).toBe("1");
    });

    it("إعادةُ التسليمِ عينِه (تسليمٌ مرّةً على الأقلِّ) لا تُنشِئُ مهمّةً ثانيةً", async () => {
      const fulfillmentId = uuid(70);
      const eventId = uuid(71);
      const body = createdBody(fulfillmentId, eventId);

      const first = await deliver(body, eventId);
      const second = await deliver(body, eventId);
      const third = await deliver(body, eventId);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(200);
      expect(((await first.json()) as Record<string, unknown>).changed).toBe(true);
      expect(((await second.json()) as Record<string, unknown>).changed).toBe(false);

      const jobs = await sql<{ count: string }[]>`
        select count(*)::text as count from operational_jobs where fulfillment_id = ${fulfillmentId}`;
      expect(jobs[0]?.count).toBe("1");
      const inbox = await sql<{ count: string }[]>`
        select count(*)::text as count from core_event_inbox where event_id = ${eventId}::uuid`;
      expect(inbox[0]?.count).toBe("1");
    });

    it("جسمٌ عُدِّلَ بايتاً واحداً في الطريقِ يُرَدُّ 401 ولا يُقيَّدُ ولا يُنشئُ مهمّةً", async () => {
      const fulfillmentId = uuid(70);
      const eventId = uuid(71);
      const body = createdBody(fulfillmentId, eventId);
      const tampered = body.replace("delivery", "deliverY");

      const response = await intake.request(CORE_EVENT_INTAKE_PATH, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wasla-event-id": eventId,
          "x-wasla-signature": `sha256=${createHmac("sha256", SECRET).update(Buffer.from(body, "utf8")).digest("hex")}`,
        },
        body: tampered,
      });

      expect(response.status).toBe(401);
      const jobs = await sql<{ count: string }[]>`
        select count(*)::text as count from operational_jobs where fulfillment_id = ${fulfillmentId}`;
      expect(jobs[0]?.count).toBe("0");
      const inbox = await sql<{ count: string }[]>`
        select count(*)::text as count from core_event_inbox where event_id = ${eventId}::uuid`;
      expect(inbox[0]?.count).toBe("0");
    });
  });

  describe("٢) الإيداعُ من الصادرِ إلى CORE", () => {
    it("الدورةُ كاملةً: بابٌ ← قبولٌ ← إيداعٌ في `/v1/events` ← صفٌّ مُسلَّمٌ", async () => {
      const fulfillmentId = uuid(70);
      const eventId = uuid(71);
      await deliver(createdBody(fulfillmentId, eventId), eventId);
      const accepted = await lifecycle.accept(fulfillmentId, `corr-${fulfillmentId}`);
      expect(isOk(accepted)).toBe(true);

      const core = coreThatAccepts();
      const shipper = createCoreEventShipper({
        baseUrl: "https://core.example",
        bearerToken: "move-service-token",
        fetchImpl: core.fetch,
      });

      const report = await lifecycle.deliverOnce(shipper);
      expect(isOk(report) && report.value?.verdict).toBe("delivered");
      expect(isOk(report) && report.value?.eventType).toBe("move.job.accepted");

      // ما وصلَ CORE هوَ مغلَّفٌ مُطابِقٌ للعقدِ حرفاً، لا صورةٌ مُختَصرةٌ منه.
      expect(core.seen).toHaveLength(1);
      expect(validateEnvelope(core.seen[0] as Record<string, unknown>)).toEqual([]);
      expect((core.seen[0] as Record<string, unknown>).event_type).toBe("move.job.accepted");

      const rows = await outbox(fulfillmentId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.delivered_at).not.toBeNull();
      expect(rows[0]?.dead_at).toBeNull();
      expect(rows[0]?.last_error).toBeNull();

      // ولا شيءَ يُستحَقُّ بعدَ ذلكَ: لا إعادةَ إيداعٍ لِما سُلِّمَ.
      const again = await lifecycle.deliverOnce(shipper);
      expect(isOk(again) && again.value === null).toBe(true);
      expect(core.seen).toHaveLength(1);
    });

    it("رفضٌ عقديٌّ من CORE (`422`) يُميتُ الصفَّ من محاولتِه الأولى بسببِه مكتوباً", async () => {
      const fulfillmentId = uuid(70);
      const eventId = uuid(71);
      await deliver(createdBody(fulfillmentId, eventId), eventId);
      await lifecycle.accept(fulfillmentId, `corr-${fulfillmentId}`);

      const shipper = createCoreEventShipper({
        baseUrl: "https://core.example",
        bearerToken: "move-service-token",
        fetchImpl: coreThatRefuses,
      });
      const report = await lifecycle.deliverOnce(shipper);

      expect(isOk(report) && report.value?.verdict).toBe("dead");
      const rows = await outbox(fulfillmentId);
      expect(rows[0]?.dead_at).not.toBeNull();
      expect(rows[0]?.attempts).toBe(1);
      expect(rows[0]?.last_error).toContain("422");
      expect(rows[0]?.delivered_at).toBeNull();
    });

    it("رمزُ حاملٍ خاطئٌ = `403` = موتٌ فوريٌّ لا إعادةٌ ثمانيةَ أضعافٍ", async () => {
      const fulfillmentId = uuid(70);
      const eventId = uuid(71);
      await deliver(createdBody(fulfillmentId, eventId), eventId);
      await lifecycle.accept(fulfillmentId, `corr-${fulfillmentId}`);

      const core = coreThatAccepts();
      const shipper = createCoreEventShipper({
        baseUrl: "https://core.example",
        bearerToken: "wrong-token",
        fetchImpl: core.fetch,
      });
      const report = await lifecycle.deliverOnce(shipper);

      expect(isOk(report) && report.value?.verdict).toBe("dead");
      expect(core.seen).toHaveLength(0);
      const rows = await outbox(fulfillmentId);
      expect(rows[0]?.dead_at).not.toBeNull();
      expect(rows[0]?.last_error).toContain("403");
    });

    it("إعادةُ إيداعِ المعرّفِ نفسِه عندَ CORE نجاحٌ: `first_delivery=false` لا إخفاقٌ", async () => {
      const fulfillmentId = uuid(70);
      const eventId = uuid(71);
      await deliver(createdBody(fulfillmentId, eventId), eventId);
      await lifecycle.accept(fulfillmentId, `corr-${fulfillmentId}`);

      const core = coreThatAccepts();
      const shipper = createCoreEventShipper({
        baseUrl: "https://core.example",
        bearerToken: "move-service-token",
        fetchImpl: core.fetch,
      });

      /**
       * يُحاكى انقطاعٌ بعدَ قبولِ CORE وقبلَ إغلاقِ صفِّنا: الصفُّ يُعادُ
       * استحقاقُه فيُودَعُ ثانيةً، فيردُّ CORE `first_delivery=false` ويُغلَقُ
       * الصفُّ مُسلَّماً مرّةً واحدةً. وهذا هوَ الإسلامُ على الحدِّ لا في ذاكرتِنا.
       */
      const claimed = await store.claimNextEvent();
      if (!isOk(claimed) || claimed.value === null) throw new Error("لم يُحجَزْ صفٌّ");
      const shipped = await shipper.ship(claimed.value.envelope);
      expect(isOk(shipped) && shipped.value.firstDelivery).toBe(true);
      await store.abandonDelivery(claimed.value.claimToken, "NETWORK: انقطعَ الردُّ", false);
      await sql`update move_event_outbox set next_attempt_at = now() - interval '1 second'
                  where entity_id = ${fulfillmentId}`;

      const report = await lifecycle.deliverOnce(shipper);
      expect(isOk(report) && report.value?.verdict).toBe("delivered");
      expect(core.seen).toHaveLength(2);

      const rows = await outbox(fulfillmentId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.delivered_at).not.toBeNull();
      expect(rows[0]?.attempts).toBe(2);
    });
  });
});
