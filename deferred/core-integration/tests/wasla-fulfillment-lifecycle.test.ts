/**
 * الغرض: `W-4`/`W-5` — إثباتُ دورةِ حياةِ مهمّةِ التنفيذِ الواردةِ من CORE على
 *   **محرّكِ PostgreSQL حقيقيٍّ** لا على مزدوجٍ: الاستقبالُ، والقبولُ والرفضُ،
 *   والإتمامُ والفشلُ، والإلغاءُ، ومنعُ التكرارِ، وموافقةُ كلِّ مغلَّفٍ صادرٍ لعقودِ
 *   CORE حرفاً.
 *
 *   والادّعاءاتُ المُختبَرةُ لا يُقاسُ واحدٌ منها بقراءةِ الشيفرةِ:
 *   (١) أنَّ الانتقالَ الممنوعَ **يُرَدُّ من القاعدةِ** ولا يُغيِّرُ حالةً ولا
 *       يُودِعُ حدثاً — فلا نجاحَ مُعلَنٌ قبلَ تحقُّقِ شرطِه.
 *   (٢) أنَّ إعادةَ الحدثِ نفسِه (والتسليمُ مرّةً على الأقلِّ) **لا تُضاعِفُ أثراً
 *       ولا حدثاً**: الأثرُ محروسٌ بمفتاحٍ في القاعدةِ لا بذاكرةِ عمليّةٍ.
 *   (٣) أنَّ الفشلَ والإلغاءَ **لا يتركانِ حالةً معلَّقةً**: كلُّ خروجٍ يُغلِقُ
 *       الصفَّ ويُخرِجُه من الفهرسِ الجزئيِّ للمفتوحِ.
 *   (٤) أنَّ ما يُودَعُ للتسليمِ **مطابقٌ لمخطَّطاتِ CORE المنقولةِ**، فلا يُكتشَفُ
 *       خللُنا في مستودعِ غيرِنا.
 *
 *   والناقلُ ههنا **مزدوجٌ مُعلَنٌ** عن قصدٍ: المقيسُ في هذا الملفِّ آلةُ الحالاتِ
 *   وأثرُها في الجدولِ، فحدُّه أنَّ الصفَّ يُغلَقُ أو يُعادُ أو يموتُ لا أنَّ CORE
 *   استلمَ. أمّا الناقلُ الحقيقيُّ وبابُ الاستقبالِ الحقيقيُّ فمقيسانِ موصولَينِ
 *   بالقاعدةِ في `tests/integration/wasla-core-transport.test.ts`.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type {
  EventEnvelope,
  MoveEventShipper,
} from "../../../packages/application/wasla/fulfillment-lifecycle.ts";
import { createFulfillmentLifecycle } from "../../../packages/application/wasla/fulfillment-lifecycle.ts";
import { validateEnvelope } from "../../../packages/domain/wasla/event-envelope.ts";
import { createSql, type Sql } from "../../../packages/infrastructure/db/client.ts";
import { createOperationalJobRepository } from "../../../packages/infrastructure/wasla/operational-job-repository.ts";
import { err, isErr, isOk, ok } from "../../../packages/shared/result/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const ORG = "22222222-2222-4222-8222-222222222222";

let sql: Sql;
let store: ReturnType<typeof createOperationalJobRepository>;
let lifecycle: ReturnType<typeof createFulfillmentLifecycle>;

/** عدّادٌ يُولِّدُ معرّفاتٍ مُميَّزةً ثابتةَ الشكلِ — لا عشوائيَّ فلا تعذُّرَ إعادةٍ. */
let seq = 0;
function uuid(prefix: number): string {
  seq += 1;
  const tail = String(seq).padStart(12, "0");
  return `${String(prefix).padStart(8, "0")}-1111-4111-8111-${tail}`;
}

function createdEnvelope(fulfillmentId: string, overrides: Record<string, unknown> = {}) {
  return {
    event_id: uuid(90),
    event_type: "core.fulfillment.created",
    version: 1,
    producer: "wasla-core",
    occurred_at: "2026-09-11T10:00:00.000Z",
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
    ...overrides,
  } as EventEnvelope;
}

function cancelledEnvelope(fulfillmentId: string, overrides: Record<string, unknown> = {}) {
  return {
    event_id: uuid(91),
    event_type: "core.fulfillment.cancelled",
    version: 1,
    producer: "wasla-core",
    occurred_at: "2026-09-11T11:00:00.000Z",
    correlation_id: `corr-${fulfillmentId}`,
    causation_id: null,
    entity_type: "fulfillment",
    entity_id: fulfillmentId,
    payload: {
      fulfillment_id: fulfillmentId,
      /**
       * `organization_id` **مطلوبٌ** في عقدِ الإلغاءِ منذُ دورةِ نطاقِ المستأجرِ
       * عندَ CORE (`acd93c8`). وإضافتُه ههنا ليست تجميلاً: بدونِه يردُّ المُدقِّقُ
       * المغلَّفَ قبلَ الإيداعِ فلا يُقاسُ إلغاءٌ ألبتّةَ.
       */
      organization_id: ORG,
      order_reference: `order-${fulfillmentId.slice(-4)}`,
      reason: "rider_cancelled",
      cancelled_at: "2026-09-11T11:00:00.000Z",
    },
    ...overrides,
  } as EventEnvelope;
}

/** مهمّةٌ قيدَ التنسيقِ جاهزةٌ — استقبالٌ كاملٌ لا إدخالٌ مباشرٌ في الجدولِ. */
async function intake(): Promise<string> {
  const fulfillmentId = uuid(80);
  const result = await lifecycle.consume(createdEnvelope(fulfillmentId));
  if (isErr(result)) throw new Error(`تعذّرَ الاستقبالُ: ${JSON.stringify(result.error)}`);
  return fulfillmentId;
}

interface JobRow {
  readonly state: string;
  readonly failure_stage: string | null;
  readonly failure_reason: string | null;
  readonly cancel_reason: string | null;
  readonly outcome: string | null;
  readonly assigned_at: Date | null;
  readonly closed_at: Date | null;
}

async function job(fulfillmentId: string): Promise<JobRow> {
  const rows = await sql<JobRow[]>`
    select state, failure_stage, failure_reason, cancel_reason, outcome, assigned_at, closed_at
      from operational_jobs where fulfillment_id = ${fulfillmentId}`;
  const row = rows[0];
  if (row === undefined) throw new Error(`لا مهمّةَ لِـ${fulfillmentId}`);
  return row;
}

interface OutboxRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly version: number;
  readonly producer: string;
  readonly occurred_at: Date;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly payload: Record<string, unknown>;
  readonly dedup_key: string;
  readonly attempts: number;
  readonly delivered_at: Date | null;
  readonly dead_at: Date | null;
  readonly next_attempt_at: Date;
  readonly last_error: string | null;
}

async function outbox(fulfillmentId: string): Promise<readonly OutboxRow[]> {
  return await sql<OutboxRow[]>`
    select * from move_event_outbox where entity_id = ${fulfillmentId} order by created_at, dedup_key`;
}

/** المغلَّفُ كما يُسلَّمُ فعلاً — يُعادُ تركيبُه من الأعمدةِ كما يفعلُ المحوّلُ. */
function envelopeOf(row: OutboxRow): EventEnvelope {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    version: row.version,
    producer: row.producer,
    occurred_at: new Date(row.occurred_at).toISOString(),
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    payload: row.payload,
  };
}

/**
 * يُنفِّذُ عبارةً يُنتظَرُ رفضُها ويُرجِعُ نصَّ العطلِ. و`expect(...).rejects` لا
 * تُستعمَلُ على استعلامِ `postgres.js`: كائنُ الاستعلامِ مُؤجَّلُ التنفيذِ
 * (thenable لا Promise)، فتعليقُ المُطابِقِ عليه يُعلِّقُ الاختبارَ حتّى المهلةِ
 * — وذاكَ إخفاقٌ بمهلةٍ لا إثباتُ رفضٍ.
 */
async function expectRejection(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error("العبارةُ نجحَت والمنتظرُ رفضُها");
}

/** ناقلٌ ينجحُ ويُسجِّلُ ما سُلِّمَ. */
function acceptingShipper(): MoveEventShipper & { readonly shipped: EventEnvelope[] } {
  const shipped: EventEnvelope[] = [];
  return {
    shipped,
    ship: async (envelope) => {
      shipped.push(envelope);
      return ok({ firstDelivery: true });
    },
  };
}

/**
 * ناقلٌ يعطلُ دائماً بعطلٍ **عابرٍ** — يُقاسُ به التراجعُ ثمَّ الموتُ بنفادِ
 * المحاولاتِ. والعبورُ صريحٌ لأنَّ الدوامَ صارَ حكماً آخرَ يُقاسُ بناقلٍ آخرَ.
 */
function failingShipper(detail = "لا بابَ في CORE"): MoveEventShipper {
  return { ship: async () => err({ permanent: false, detail }) };
}

/** ناقلٌ يعطلُ عطلاً دائماً — يُقاسُ به الموتُ الفوريُّ بلا استهلاكِ محاولاتٍ. */
function permanentlyFailingShipper(detail = "HTTP 403: بادئةٌ غيرُ مسموحةٍ"): MoveEventShipper {
  return { ship: async () => err({ permanent: true, detail }) };
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("دورةُ حياةِ مهمّةِ التنفيذِ الواردةِ من CORE — W-4/W-5", () => {
  beforeAll(() => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    store = createOperationalJobRepository(sql);
    lifecycle = createFulfillmentLifecycle(store);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table move_event_outbox, core_event_inbox, operational_jobs restart identity cascade`;
  });

  describe("١) الاستقبالُ من CORE", () => {
    it("حدثُ إنشاءٍ صحيحٌ يُنشئُ مهمّةً «قيدَ التنسيقِ» ويُقيَّدُ في صندوقِ الواردِ", async () => {
      const fulfillmentId = uuid(80);
      const envelope = createdEnvelope(fulfillmentId);
      const result = await lifecycle.consume(envelope);

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.changed).toBe(true);
      expect(result.value.state).toBe("coordinating");
      expect(result.value.jobId).not.toBeNull();

      const row = await job(fulfillmentId);
      expect(row.state).toBe("coordinating");
      expect(row.assigned_at).toBeNull();
      expect(row.closed_at).toBeNull();

      const inbox = await sql<
        { event_type: string; outcome: string | null; processed_at: Date | null }[]
      >`select event_type, outcome, processed_at from core_event_inbox where event_id = ${String(envelope.event_id)}`;
      expect(inbox[0]?.event_type).toBe("core.fulfillment.created");
      expect(inbox[0]?.outcome).toBe("applied");
      expect(inbox[0]?.processed_at).not.toBeNull();

      // الاستقبالُ وحدَه لا يُبلِّغُ CORE بشيءٍ: لا حدثَ إلا عن انتقالٍ.
      expect(await outbox(fulfillmentId)).toHaveLength(0);
    });

    it("مغلَّفٌ مخالفٌ للعقدِ يُرَدُّ **قبلَ** القاعدةِ فلا يُقيَّدُ في الواردِ", async () => {
      const fulfillmentId = uuid(80);
      const broken = createdEnvelope(fulfillmentId, { correlation_id: "" });
      const result = await lifecycle.consume(broken);

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error.kind).toBe("contract");

      const inbox = await sql<
        { count: string }[]
      >`select count(*)::text as count from core_event_inbox`;
      expect(inbox[0]?.count).toBe("0");
      const jobs = await sql<
        { count: string }[]
      >`select count(*)::text as count from operational_jobs`;
      expect(jobs[0]?.count).toBe("0");
    });

    it("نوعُ حدثٍ لا يستهلكُه MOVE يُرَدُّ مُصنَّفاً لا يُبتلَعُ صامتاً", async () => {
      const envelope = createdEnvelope(uuid(80), {
        event_type: "core.payment.captured",
        payload: {
          fulfillment_id: uuid(80),
          order_reference: "o",
          reason: "r",
          cancelled_at: "2026-09-11T10:00:00Z",
        },
      });
      const result = await lifecycle.consume(envelope);
      expect(isErr(result)).toBe(true);
      // لا إعلانَ لحمولةِ هذا النوعِ، فالتدقيقُ يُسبِقُ التصنيفَ — وكلاهما ردٌّ.
      if (isErr(result))
        expect(["contract", "unsupported_event_type"]).toContain(result.error.kind);
    });

    it("مهمّةٌ لكلِّ تنفيذٍ واحدةٌ: حدثُ إنشاءٍ ثانٍ بمعرّفٍ آخرَ لا يُنشئُ صفّاً ثانياً", async () => {
      const fulfillmentId = uuid(80);
      await lifecycle.consume(createdEnvelope(fulfillmentId));
      const second = await lifecycle.consume(createdEnvelope(fulfillmentId));

      expect(isOk(second)).toBe(true);
      if (isOk(second)) {
        expect(second.value.changed).toBe(false);
        expect(second.value.state).toBe("coordinating");
      }
      const rows = await sql<{ count: string }[]>`
        select count(*)::text as count from operational_jobs where fulfillment_id = ${fulfillmentId}`;
      expect(rows[0]?.count).toBe("1");
    });
  });

  describe("٢) القبولُ والرفضُ", () => {
    it("القبولُ يُسنِدُ ويُودِعُ `move.job.accepted` مطابقاً لعقدِ CORE", async () => {
      const fulfillmentId = await intake();
      const accepted = await lifecycle.accept(fulfillmentId, "corr-accept", "cause-1");

      expect(isOk(accepted)).toBe(true);
      if (!isOk(accepted)) return;
      expect(accepted.value.state).toBe("assigned");
      expect(accepted.value.duplicate).toBe(false);

      const row = await job(fulfillmentId);
      expect(row.state).toBe("assigned");
      expect(row.assigned_at).not.toBeNull();
      expect(row.closed_at).toBeNull();

      const events = await outbox(fulfillmentId);
      expect(events).toHaveLength(1);
      const event = events[0] as OutboxRow;
      expect(event.event_type).toBe("move.job.accepted");
      expect(event.producer).toBe("wasla-move");
      expect(event.correlation_id).toBe("corr-accept");
      expect(event.causation_id).toBe("cause-1");
      expect(event.payload.job_id).toBe(accepted.value.jobId);
      expect(validateEnvelope(envelopeOf(event))).toEqual([]);
    });

    it("الرفضُ يُفشِلُ بمرحلةِ «مرفوضٌ» ويُودِعُ `move.job.rejected` بلا معرّفِ مهمّةٍ", async () => {
      const fulfillmentId = await intake();
      const rejected = await lifecycle.reject(fulfillmentId, "no_driver_in_city", "corr-reject");

      expect(isOk(rejected)).toBe(true);
      if (!isOk(rejected)) return;
      expect(rejected.value.state).toBe("failed");

      const row = await job(fulfillmentId);
      expect(row.state).toBe("failed");
      expect(row.failure_stage).toBe("rejected");
      expect(row.failure_reason).toBe("no_driver_in_city");
      expect(row.outcome).toBe("failed");
      expect(row.assigned_at).toBeNull();
      expect(row.closed_at).not.toBeNull();

      const events = await outbox(fulfillmentId);
      expect(events).toHaveLength(1);
      const event = events[0] as OutboxRow;
      expect(event.event_type).toBe("move.job.rejected");
      // عقدُ الرفضِ لا `job_id` فيه: مهمّةٌ لم تُسنَدْ لا معرّفَ تشغيليَّ لها.
      expect(event.payload).not.toHaveProperty("job_id");
      expect(event.payload.reason).toBe("no_driver_in_city");
      expect(validateEnvelope(envelopeOf(event))).toEqual([]);
    });

    it("رفضٌ بلا سببٍ يُرَدُّ — عقدُ CORE يشترطُ سبباً غيرَ فارغٍ", async () => {
      const fulfillmentId = await intake();
      const result = await lifecycle.reject(fulfillmentId, "   ", "corr");
      expect(isErr(result)).toBe(true);
      expect((await job(fulfillmentId)).state).toBe("coordinating");
      expect(await outbox(fulfillmentId)).toHaveLength(0);
    });

    it("القبولُ مرّتَينِ: الثانيةُ مكرَّرةٌ بلا حدثٍ ثانٍ ولا تغييرِ حالةٍ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr-1");
      const again = await lifecycle.accept(fulfillmentId, "corr-2");

      expect(isOk(again)).toBe(true);
      if (isOk(again)) {
        expect(again.value.duplicate).toBe(true);
        expect(again.value.state).toBe("assigned");
      }
      expect(await outbox(fulfillmentId)).toHaveLength(1);
    });

    it("قبولانِ متزاحمانِ على اتّصالَينِ: واحدٌ يفوزُ وحدثٌ واحدٌ يُودَعُ", async () => {
      const fulfillmentId = await intake();
      const other = createSql({ connectionString: DATABASE_URL ?? "" });
      try {
        const otherStore = createOperationalJobRepository(other);
        const [first, second] = await Promise.all([
          store.accept(fulfillmentId, "corr-a", null),
          otherStore.accept(fulfillmentId, "corr-b", null),
        ]);
        expect(isOk(first) && isOk(second)).toBe(true);
        if (isOk(first) && isOk(second)) {
          // أحدُهما مكرَّرٌ لا محالةَ: القفلُ يُسلسِلُهما فيرى الثاني «مُسنداً».
          expect([first.value.duplicate, second.value.duplicate].filter(Boolean)).toHaveLength(1);
        }
        expect(await outbox(fulfillmentId)).toHaveLength(1);
      } finally {
        await other.end({ timeout: 5 });
      }
    });
  });

  describe("٣) الإتمامُ والفشلُ", () => {
    it("الإتمامُ من «مُسندٌ» يُبلِّغُ نتيجةَ «تمَّ» بمغلَّفٍ مطابقٍ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      const completed = await lifecycle.complete(fulfillmentId, "corr-done");

      expect(isOk(completed)).toBe(true);
      const row = await job(fulfillmentId);
      expect(row.state).toBe("completed");
      expect(row.outcome).toBe("completed");
      expect(row.failure_stage).toBeNull();
      expect(row.closed_at).not.toBeNull();

      const events = await outbox(fulfillmentId);
      expect(events.map((event) => event.event_type)).toEqual([
        "move.job.accepted",
        "move.job.completed",
      ]);
      const final = events[1] as OutboxRow;
      expect(final.payload.outcome).toBe("completed");
      expect(validateEnvelope(envelopeOf(final))).toEqual([]);
    });

    it("فشلُ التنفيذِ يُبلِّغُ `move.job.completed` بنتيجةِ «فشِلَ» ومرحلةٍ محفوظةٍ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      const failed = await lifecycle.fail(fulfillmentId, "vehicle_breakdown", "corr-fail");

      expect(isOk(failed)).toBe(true);
      const row = await job(fulfillmentId);
      expect(row.state).toBe("failed");
      expect(row.outcome).toBe("failed");
      expect(row.failure_stage).toBe("execution");
      expect(row.failure_reason).toBe("vehicle_breakdown");
      expect(row.closed_at).not.toBeNull();

      const events = await outbox(fulfillmentId);
      const final = events[1] as OutboxRow;
      expect(final.event_type).toBe("move.job.completed");
      expect(final.payload.outcome).toBe("failed");
      expect(validateEnvelope(envelopeOf(final))).toEqual([]);
    });

    it("فشلٌ بلا سببٍ يُرَدُّ: «فشِلَ» بلا سببٍ حالةٌ لا تُراجَعُ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      const result = await lifecycle.fail(fulfillmentId, "", "corr");
      expect(isErr(result)).toBe(true);
      expect((await job(fulfillmentId)).state).toBe("assigned");
    });

    it("الإتمامُ مرّتَينِ: الثانيةُ مكرَّرةٌ بلا حدثٍ ثانٍ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      await lifecycle.complete(fulfillmentId, "corr");
      const again = await lifecycle.complete(fulfillmentId, "corr");
      expect(isOk(again)).toBe(true);
      if (isOk(again)) expect(again.value.duplicate).toBe(true);
      expect(await outbox(fulfillmentId)).toHaveLength(2);
    });
  });

  describe("٤) لا نجاحَ قبلَ شرطِه — الانتقالُ الممنوعُ يُرَدُّ", () => {
    it("الإتمامُ من «قيدَ التنسيقِ» يُرَدُّ ولا يُغيِّرُ حالةً ولا يُودِعُ حدثاً", async () => {
      const fulfillmentId = await intake();
      const result = await lifecycle.complete(fulfillmentId, "corr");

      expect(isErr(result)).toBe(true);
      if (isErr(result) && result.error.kind === "port") {
        expect(result.error.error.detail).toContain("ILLEGAL_TRANSITION");
      }
      expect((await job(fulfillmentId)).state).toBe("coordinating");
      expect(await outbox(fulfillmentId)).toHaveLength(0);
    });

    it("القبولُ بعدَ الإتمامِ والرفضُ بعدَ الإسنادِ كلاهما يُرَدُّ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      expect(isErr(await lifecycle.reject(fulfillmentId, "late", "corr"))).toBe(true);
      await lifecycle.complete(fulfillmentId, "corr");
      const state = (await job(fulfillmentId)).state;
      expect(state).toBe("completed");
      expect(await outbox(fulfillmentId)).toHaveLength(2);
    });

    it("انتقالٌ لمهمّةٍ لا وجودَ لها يُرَدُّ ولا يُنشئُ صفّاً من فراغٍ", async () => {
      const ghost = uuid(70);
      expect(isErr(await lifecycle.accept(ghost, "corr"))).toBe(true);
      const rows = await sql<
        { count: string }[]
      >`select count(*)::text as count from operational_jobs`;
      expect(rows[0]?.count).toBe("0");
    });
  });

  describe("٥) الإلغاءُ الواردُ من CORE", () => {
    it("الإلغاءُ من «قيدَ التنسيقِ» يُلغي ويُغلِقُ بلا حدثٍ صادرٍ", async () => {
      const fulfillmentId = await intake();
      const result = await lifecycle.consume(cancelledEnvelope(fulfillmentId));

      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.value.changed).toBe(true);
      const row = await job(fulfillmentId);
      expect(row.state).toBe("cancelled");
      expect(row.cancel_reason).toBe("rider_cancelled");
      expect(row.closed_at).not.toBeNull();
      expect(row.outcome).toBeNull();
      // لا حدثَ إلغاءٍ من MOVE في عقودِ CORE، وإبلاغُه بإلغائِه ضجيجٌ.
      expect(await outbox(fulfillmentId)).toHaveLength(0);
    });

    it("الإلغاءُ من «مُسندٌ» يُلغي ولا يُبطِلُ حدثَ القبولِ المُودَعَ سابقاً", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      await lifecycle.consume(cancelledEnvelope(fulfillmentId));

      expect((await job(fulfillmentId)).state).toBe("cancelled");
      const events = await outbox(fulfillmentId);
      expect(events).toHaveLength(1);
      expect(events[0]?.event_type).toBe("move.job.accepted");
    });

    it("الإلغاءُ بعدَ الإتمامِ لا يُنقَضُ عليه: نجاحٌ بلا تطبيقٍ وحالةٌ محفوظةٌ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      await lifecycle.complete(fulfillmentId, "corr");
      const result = await lifecycle.consume(cancelledEnvelope(fulfillmentId));

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.changed).toBe(false);
        expect(result.value.note).toBe("ALREADY_TERMINAL");
      }
      expect((await job(fulfillmentId)).state).toBe("completed");
      expect(await outbox(fulfillmentId)).toHaveLength(2);
    });

    it("إلغاءٌ لتنفيذٍ لا مهمّةَ له: يُقيَّدُ مُهمَلاً ولا يُخفِقُ ولا يُنشئُ مهمّةً", async () => {
      const unknown = uuid(70);
      const envelope = cancelledEnvelope(unknown);
      const result = await lifecycle.consume(envelope);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.changed).toBe(false);
        expect(result.value.note).toBe("JOB_NOT_FOUND");
      }
      const inbox = await sql<{ outcome: string | null }[]>`
        select outcome from core_event_inbox where event_id = ${String(envelope.event_id)}`;
      expect(inbox[0]?.outcome).toBe("ignored");
      const jobs = await sql<
        { count: string }[]
      >`select count(*)::text as count from operational_jobs`;
      expect(jobs[0]?.count).toBe("0");
    });

    it("إعادةُ حدثِ الإلغاءِ نفسِه لا تُغيِّرُ شيئاً مرّةً ثانيةً", async () => {
      const fulfillmentId = await intake();
      const envelope = cancelledEnvelope(fulfillmentId);
      await lifecycle.consume(envelope);
      const closedAt = (await job(fulfillmentId)).closed_at;
      const again = await lifecycle.consume(envelope);

      expect(isOk(again)).toBe(true);
      if (isOk(again)) expect(again.value.changed).toBe(false);
      expect((await job(fulfillmentId)).closed_at).toEqual(closedAt);
    });

    /**
     * ما يقيسُه الثلاثةُ التاليةُ: دورةَ نطاقِ المستأجرِ عندَ CORE
     * (`acd93c8`) على حدثِ الإلغاءِ. وليسَ هذا تزَيُّداً في التغطيةِ: قبلَ هذه
     * الزيادةِ كانَ أوّلُ هذه الحالاتِ يُخفِقُ، ومعناه أنَّ أيَّ إلغاءٍ حقيقيٍّ
     * يُنشِرُه CORE اليومَ كانَ يُرَدُّ فتبقى المهمّةُ التشغيليّةُ جاريةً.
     */
    it("إلغاءٌ بمالٍ قُبِضَ جزءٌ منه وقرارٌ ماليٌّ معلَّقٌ: يُلغي المهمّةَ ولا يُدَّعي تسويةً", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      const envelope = cancelledEnvelope(fulfillmentId, {
        payload: {
          fulfillment_id: fulfillmentId,
          organization_id: ORG,
          order_reference: "order-part",
          reason: "customer_cancelled",
          cancelled_at: "2026-09-11T11:00:00.000Z",
          settlement_state: "partially_captured",
          captured_minor: 2500,
          financial_decision_required: true,
        },
      });

      const result = await lifecycle.consume(envelope);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.value.changed).toBe(true);

      const row = await job(fulfillmentId);
      expect(row.state).toBe("cancelled");
      expect(row.cancel_reason).toBe("customer_cancelled");
      expect(row.closed_at).not.toBeNull();
      /**
       * `outcome` يبقى `null`: مهمّةٌ أُلغيَ طلبُها لم تُتمْ ولم تفشلْ، وأن يُكتبَ
       * لها مالٌ دعوى تسويةٍ وMOVE لا يملكُ أن يدّعيَها (حاجزُ CORE `CORE:B-20`).
       */
      expect(row.outcome).toBeNull();
      /**
       * ولا حدثَ صادرٌ جديدٌ: حدثُ القبولِ وحدَه يبقى، فلا يصدرُ عن MOVE
       * شيءٌ يُقرأُ ردَّ مالٍ أو إيراداً مُكتسَباً.
       */
      const events = await outbox(fulfillmentId);
      expect(events).toHaveLength(1);
      expect(events[0]?.event_type).toBe("move.job.accepted");
      expect(JSON.stringify(events[0]?.payload)).not.toContain("captured_minor");
    });

    it("`settlement_state` مجهولٌ يُرَدُّ عقديّاً ولا يُقرأُ «أُعيدَ الحجزُ»", async () => {
      const fulfillmentId = await intake();
      const envelope = cancelledEnvelope(fulfillmentId, {
        payload: {
          fulfillment_id: fulfillmentId,
          organization_id: ORG,
          order_reference: "order-x",
          reason: "customer_cancelled",
          cancelled_at: "2026-09-11T11:00:00.000Z",
          settlement_state: "clawed_back",
        },
      });

      const result = await lifecycle.consume(envelope);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.kind).toBe("contract");
      // ولا أثرَ: لا إيداعَ في الواردِ، والمهمّةُ على حالِها.
      const inbox = await sql<{ count: string }[]>`
        select count(*)::text as count from core_event_inbox
         where event_id = ${String(envelope.event_id)}`;
      expect(inbox[0]?.count).toBe("0");
      expect((await job(fulfillmentId)).state).toBe("coordinating");
    });

    it("إلغاءٌ بلا `organization_id` — تاريخٌ قبلَ دورةِ المستأجرِ — يُرَدُّ ولا يُنسَبُ لمستأجرٍ", async () => {
      const fulfillmentId = await intake();
      const envelope = cancelledEnvelope(fulfillmentId, {
        payload: {
          fulfillment_id: fulfillmentId,
          order_reference: "order-old",
          reason: "customer_cancelled",
          cancelled_at: "2026-09-11T11:00:00.000Z",
        },
      });

      const result = await lifecycle.consume(envelope);
      expect(isErr(result)).toBe(true);
      if (isErr(result) && result.error.kind === "contract") {
        expect(result.error.issues.some((issue) => issue.path === "payload.organization_id")).toBe(
          true,
        );
      }
      expect((await job(fulfillmentId)).state).toBe("coordinating");
    });
  });

  describe("٦) لا حالةَ معلَّقةً بعدَ خروجٍ", () => {
    it("كلُّ خروجٍ — إتمامٌ وفشلُ تنفيذٍ ورفضٌ وإلغاءٌ — يُغلِقُ الصفَّ ويُخرِجُه من المفتوحِ", async () => {
      const completed = await intake();
      await lifecycle.accept(completed, "c");
      await lifecycle.complete(completed, "c");

      const failed = await intake();
      await lifecycle.accept(failed, "c");
      await lifecycle.fail(failed, "breakdown", "c");

      const rejected = await intake();
      await lifecycle.reject(rejected, "no_capacity", "c");

      const cancelled = await intake();
      await lifecycle.consume(cancelledEnvelope(cancelled));

      const open = await intake();

      const rows = await sql<{ fulfillment_id: string; state: string; closed: boolean }[]>`
        select fulfillment_id, state, closed_at is not null as closed from operational_jobs order by created_at`;
      for (const row of rows) {
        const terminal = ["completed", "failed", "cancelled"].includes(row.state);
        expect(row.closed, `${row.state}`).toBe(terminal);
      }

      // الفهرسُ الجزئيُّ للمفتوحِ لا يرى إلا غيرَ النهائيِّ.
      const openRows = await sql<{ fulfillment_id: string }[]>`
        select fulfillment_id from operational_jobs where state in ('coordinating','assigned')`;
      expect(openRows.map((row) => row.fulfillment_id)).toEqual([open]);
    });

    it("لا صفَّ نهائيّاً بحالةٍ نهائيّةٍ ونتيجةٍ متناقضةٍ — القيودُ تمنعُ التلفيقَ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "c");
      await lifecycle.complete(fulfillmentId, "c");
      // محاولةُ تلفيقٍ مباشرةٍ على الجدولِ: «تمَّ» بنتيجةِ «فشِلَ».
      const message = await expectRejection(
        () =>
          sql`update operational_jobs set outcome = 'failed' where fulfillment_id = ${fulfillmentId}`,
      );
      expect(message).toContain("operational_jobs_outcome_shape");
      expect((await job(fulfillmentId)).outcome).toBe("completed");
    });
  });

  describe("٧) صندوقُ الصادرِ: حجزٌ وتسليمٌ وتراجعٌ", () => {
    it("الحجزُ يُخرِجُ صفّاً واحداً، ولا يُحجَزُ مرّتَينِ، والإنهاءُ يُثبِتُ التسليمَ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");

      const first = await store.claimNextEvent();
      expect(isOk(first)).toBe(true);
      if (!isOk(first) || first.value === null) throw new Error("لم يُحجَزْ صفٌّ");
      expect(first.value.attempts).toBe(1);
      expect(validateEnvelope(first.value.envelope)).toEqual([]);

      const second = await store.claimNextEvent();
      expect(isOk(second) && second.value === null).toBe(true);

      const finished = await store.finishDelivery(first.value.claimToken);
      expect(isOk(finished) && finished.value).toBe(true);
      const rows = await outbox(fulfillmentId);
      expect(rows[0]?.delivered_at).not.toBeNull();

      // ولا يُحجَزُ المُسلَّمُ ثانيةً: التسليمُ خروجٌ من الطابورِ لا وسمٌ.
      const third = await store.claimNextEvent();
      expect(isOk(third) && third.value === null).toBe(true);
    });

    it("إنهاءٌ برمزِ حجزٍ باطلٍ يُرَدُّ كذباً لا يُقرأُ تسليماً", async () => {
      const finished = await store.finishDelivery(uuid(60));
      expect(isOk(finished) && finished.value).toBe(false);
    });

    it("التخلّي يُؤجِّلُ بتراجعٍ ويحفظُ العطلَ ولا يُسلِّمُ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      const claimed = await store.claimNextEvent();
      if (!isOk(claimed) || claimed.value === null) throw new Error("لم يُحجَزْ صفٌّ");

      const abandoned = await store.abandonDelivery(claimed.value.claimToken, "خطأُ شبكةٍ");
      expect(isOk(abandoned)).toBe(true);
      if (isOk(abandoned)) expect(abandoned.value.dead).toBe(false);

      const rows = await outbox(fulfillmentId);
      const row = rows[0] as OutboxRow;
      expect(row.delivered_at).toBeNull();
      expect(row.dead_at).toBeNull();
      expect(row.attempts).toBe(1);
      expect(row.last_error).toBe("خطأُ شبكةٍ");
      expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now());

      // ولا يُحجَزُ قبلَ حينِه: التراجعُ تأجيلٌ حقيقيٌّ لا وسمٌ.
      const early = await store.claimNextEvent();
      expect(isOk(early) && early.value === null).toBe(true);
    });

    it("دورةُ تسليمٍ ناجحةٌ تُغلِقُ الصفَّ وتُسلِّمُ مغلَّفاً مطابقاً للعقدِ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      const shipper = acceptingShipper();

      const report = await lifecycle.deliverOnce(shipper);
      expect(isOk(report)).toBe(true);
      if (isOk(report) && report.value !== null) {
        expect(report.value.verdict).toBe("delivered");
        expect(report.value.eventType).toBe("move.job.accepted");
      }
      expect(shipper.shipped).toHaveLength(1);
      expect(validateEnvelope(shipper.shipped[0] as EventEnvelope)).toEqual([]);
      expect((await outbox(fulfillmentId))[0]?.delivered_at).not.toBeNull();

      const empty = await lifecycle.deliverOnce(shipper);
      expect(isOk(empty) && empty.value === null).toBe(true);
    });

    it("ناقلٌ عاطلٌ: الصفُّ يُعادُ ولا يُوسَمُ مُسلَّماً، ثمَّ يموتُ عندَ نفادِ المحاولاتِ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");

      for (let round = 0; round < 8; round += 1) {
        // التراجعُ يُؤجِّلُ فعلاً، فيُعادُ ضبطُ الاستحقاقِ ليُقاسَ النفادُ لا الانتظارُ.
        await sql`update move_event_outbox set next_attempt_at = now() - interval '1 second'
                    where entity_id = ${fulfillmentId}`;
        const report = await lifecycle.deliverOnce(failingShipper());
        expect(isOk(report)).toBe(true);
        if (isOk(report) && report.value !== null) {
          expect(report.value.verdict).toBe(round === 7 ? "dead" : "retry");
        }
      }

      const row = (await outbox(fulfillmentId))[0] as OutboxRow;
      expect(row.delivered_at).toBeNull();
      expect(row.dead_at).not.toBeNull();
      expect(row.attempts).toBe(8);
      expect(row.last_error).toContain("لا بابَ في CORE");

      // والميّتُ لا يُحجَزُ: لا حلقةَ أبديّةً ولا تسليمَ بعدَ موتٍ.
      await sql`update move_event_outbox set next_attempt_at = now() - interval '1 second'
                  where entity_id = ${fulfillmentId}`;
      const claimed = await store.claimNextEvent();
      expect(isOk(claimed) && claimed.value === null).toBe(true);
    });

    it("مغلَّفٌ مخالفٌ للعقدِ لا يُسلَّمُ: يُتخلّى عنه بعطلٍ منصوصٍ ويبقى دليلاً", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      // تلفيقٌ في الصادرِ يُحاكي انفراطَ عقدٍ بعدَ ترقيةٍ في CORE.
      await sql`update move_event_outbox set payload = payload - 'job_id' where entity_id = ${fulfillmentId}`;

      const shipper = acceptingShipper();
      const report = await lifecycle.deliverOnce(shipper);

      expect(isOk(report)).toBe(true);
      if (isOk(report) && report.value !== null) {
        expect(report.value.verdict).toBe("contract_rejected");
      }
      expect(shipper.shipped).toHaveLength(0);
      const row = (await outbox(fulfillmentId))[0] as OutboxRow;
      expect(row.delivered_at).toBeNull();
      expect(row.last_error).toContain("CONTRACT");
      /**
       * ومخالفةُ العقدِ **موتٌ فوريٌّ** لا إعادةٌ ثمانيةَ أضعافٍ: البايتاتُ التي
       * رُفِضَت هيَ البايتاتُ التي ستُرسَلُ ثانيةً، فالانتظارُ لا يُغيِّرُ الحكمَ
       * وإنّما يُؤخِّرُ ظهورَ الصفِّ الميّتِ لعينِ المُشغِّلِ.
       */
      expect(row.dead_at).not.toBeNull();
      expect(row.attempts).toBe(1);
    });

    it("إخفاقُ إيداعٍ دائمٌ (رفضٌ عقديٌّ من CORE) يُميتُ الصفَّ من المحاولةِ الأولى", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");

      const report = await lifecycle.deliverOnce(permanentlyFailingShipper());

      expect(isOk(report)).toBe(true);
      if (isOk(report) && report.value !== null) {
        expect(report.value.verdict).toBe("dead");
        expect(report.value.attempts).toBe(1);
      }
      const row = (await outbox(fulfillmentId))[0] as OutboxRow;
      expect(row.dead_at).not.toBeNull();
      expect(row.delivered_at).toBeNull();
      expect(row.attempts).toBe(1);
      expect(row.last_error).toContain("403");

      // والميّتُ لا يُحجَزُ ثانيةً ولو حانَ وقتُه.
      await sql`update move_event_outbox set next_attempt_at = now() - interval '1 second'
                  where entity_id = ${fulfillmentId}`;
      const claimed = await store.claimNextEvent();
      expect(isOk(claimed) && claimed.value === null).toBe(true);
    });

    it("إخفاقٌ عابرٌ لا يُميتُ الصفَّ: يُعادُ بتراجعٍ وتُحفَظُ محاولاتُه", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");

      const report = await lifecycle.deliverOnce(failingShipper("HTTP 503: CORE مُتعَبٌ"));

      expect(isOk(report) && report.value?.verdict).toBe("retry");
      const row = (await outbox(fulfillmentId))[0] as OutboxRow;
      expect(row.dead_at).toBeNull();
      expect(row.attempts).toBe(1);
      expect(row.last_error).toContain("503");
      expect(new Date(String(row.next_attempt_at)).getTime()).toBeGreaterThan(Date.now());
    });

    it("الحجزُ المتروكُ يُستَرجَعُ بعدَ مهلتِه فلا يُقفِلُ الصفَّ إلى الأبدِ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      const claimed = await store.claimNextEvent();
      if (!isOk(claimed) || claimed.value === null) throw new Error("لم يُحجَزْ صفٌّ");

      // عاملٌ ماتَ وهوَ حاجزٌ: لا إنهاءَ ولا تخلٍّ.
      await sql`update move_event_outbox set claimed_at = now() - interval '10 minutes'
                  where entity_id = ${fulfillmentId}`;
      const reclaimed = await store.claimNextEvent(60);
      expect(isOk(reclaimed)).toBe(true);
      if (isOk(reclaimed) && reclaimed.value !== null) {
        expect(reclaimed.value.attempts).toBe(2);
        expect(reclaimed.value.claimToken).not.toBe(claimed.value.claimToken);
      } else {
        throw new Error("لم يُسترجَعْ الحجزُ المتروكُ");
      }
    });

    it("منعُ التكرارِ في الصادرِ بالمفتاحِ: حدثٌ واحدٌ لكلِّ نوعٍ لكلِّ تنفيذٍ", async () => {
      const fulfillmentId = await intake();
      await lifecycle.accept(fulfillmentId, "corr");
      const events = await outbox(fulfillmentId);
      const key = (events[0] as OutboxRow).dedup_key;
      expect(key).toBe(`move.job.accepted:${fulfillmentId}`);

      const message = await expectRejection(
        () => sql`
          insert into move_event_outbox (event_id, event_type, version, producer, occurred_at,
                                         correlation_id, causation_id, entity_type, entity_id,
                                         payload, dedup_key)
          values (${uuid(61)}::uuid, 'move.job.accepted', 1, 'wasla-move', now(), 'c', null,
                  'operational_job', ${fulfillmentId}, '{}'::jsonb, ${key})`,
      );
      expect(message).toContain("dedup_key");
    });
  });

  describe("٨) الدورةُ كاملةً كما يراها CORE", () => {
    it("استقبالٌ ثمَّ قبولٌ ثمَّ إتمامٌ: حدثانِ مُسلَّمانِ مطابقانِ وحالةٌ نهائيّةٌ مُغلَقةٌ", async () => {
      const fulfillmentId = uuid(80);
      await lifecycle.consume(createdEnvelope(fulfillmentId));
      const accepted = await lifecycle.accept(fulfillmentId, `corr-${fulfillmentId}`);
      if (!isOk(accepted)) throw new Error("تعذّرَ القبولُ");
      await lifecycle.complete(fulfillmentId, `corr-${fulfillmentId}`);

      const shipper = acceptingShipper();
      const first = await lifecycle.deliverOnce(shipper);
      const second = await lifecycle.deliverOnce(shipper);
      const third = await lifecycle.deliverOnce(shipper);

      expect(isOk(first) && first.value?.verdict).toBe("delivered");
      expect(isOk(second) && second.value?.verdict).toBe("delivered");
      expect(isOk(third) && third.value === null).toBe(true);

      expect(shipper.shipped.map((envelope) => envelope.event_type)).toEqual([
        "move.job.accepted",
        "move.job.completed",
      ]);
      for (const envelope of shipper.shipped) {
        expect(validateEnvelope(envelope)).toEqual([]);
        expect(envelope.producer).toBe("wasla-move");
        expect((envelope.payload as Record<string, unknown>).fulfillment_id).toBe(fulfillmentId);
      }
      const row = await job(fulfillmentId);
      expect(row.state).toBe("completed");
      expect(row.closed_at).not.toBeNull();
    });

    it("إعادةُ الاستقبالِ بعدَ الإتمامِ لا تُعيدُ المهمّةَ إلى «قيدَ التنسيقِ»", async () => {
      const fulfillmentId = uuid(80);
      const envelope = createdEnvelope(fulfillmentId);
      await lifecycle.consume(envelope);
      await lifecycle.accept(fulfillmentId, "corr");
      await lifecycle.complete(fulfillmentId, "corr");

      const replay = await lifecycle.consume(envelope);
      expect(isOk(replay)).toBe(true);
      if (isOk(replay)) expect(replay.value.changed).toBe(false);
      expect((await job(fulfillmentId)).state).toBe("completed");
      expect(await outbox(fulfillmentId)).toHaveLength(2);
    });
  });
});
