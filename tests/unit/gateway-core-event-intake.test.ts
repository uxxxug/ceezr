/**
 * الغرض: قياسُ بابِ استقبالِ أحداثِ CORE: أنَّه لا يقبلُ إلّا موقَّعاً، وأنَّ
 *    التحقّقَ على البايتاتِ المُرسَلةِ عينِها، وأنَّ رمزَ الردِّ يقولُ لـCORE
 *    «أَعِدْ» أو «لا تُعِدْ» كما ينصُّ جدولُ عقدِه. البند `W-5` (ناقلٌ).
 * الحالة: منفّذ فعلياً — 2026-09-12.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit`، وسلسلةُ `ci`.
 * ملاحظات مستقبلية: حالةُ الاستخدامِ مُزوَّرةٌ ههنا؛ ومسارُ القاعدةِ الحقيقيُّ
 *    مقيسٌ في `tests/integration/wasla-fulfillment-lifecycle.test.ts`. فلا يُقاسُ
 *    الإيداعُ مرّتَينِ بأداتَينِ، ولا يُترَكُ أحدُهما بلا قياسٍ.
 *
 * ## لِمَ يُقاسُ الرفضُ أكثرَ من القبولِ
 *
 * بابُ استقبالٍ مكشوفٌ للإنترنتِ خطرُه في ما يقبلُه لا في ما يرفضُه: توقيعٌ
 * ناقصٌ، أو بادئةٌ غيرُ متوقَّعةٍ، أو ترويسةُ هويّةٍ تُخالِفُ الجسمَ، أو سرٌّ أقصرُ
 * ممّا يُصدِرُه CORE. وكلُّ واحدةٍ من هذه مقيسةٌ صريحاً، لأنَّ «نجحَ الطريقُ
 * السعيدُ» لا يُثبِتُ إغلاقَ بابٍ.
 */

import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import {
  CORE_EVENT_INTAKE_PATH,
  createCoreEventIntakeRoutes,
} from "../../apps/gateway/src/routes/core-event-intake.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type {
  ApplyOutcome,
  FulfillmentLifecycle,
  LifecycleFailure,
} from "../../packages/application/wasla/fulfillment-lifecycle.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";

const SECRET = "a".repeat(48);
const EVENT_ID = "5c4e6f2a-9b31-4f7d-8a12-6d0e9c3b7a54";

const ENVELOPE = {
  event_id: EVENT_ID,
  event_type: "core.fulfillment.created",
  occurred_at: "2026-09-12T00:00:00.000Z",
  correlation_id: "5c4e6f2a-9b31-4f7d-8a12-6d0e9c3b7a55",
  causation_id: null,
  payload: {
    fulfillment_id: "5c4e6f2a-9b31-4f7d-8a12-6d0e9c3b7a56",
    organization_id: "5c4e6f2a-9b31-4f7d-8a12-6d0e9c3b7a57",
    order_reference: "order-1",
    requested_service: "delivery",
  },
};

const ACCEPTED: ApplyOutcome = {
  jobId: "5c4e6f2a-9b31-4f7d-8a12-6d0e9c3b7a58",
  state: "coordinating",
  changed: true,
  note: null,
};

/**
 * حالةُ استخدامٍ مُزوَّرةٌ: `consume` وحدَها مُنفَّذةٌ، وسائرُ البابِ يرمي حتّى
 * يُكشَفَ استعمالٌ لم يُنوَ ههنا بصراحةٍ لا بصمتٍ.
 */
function lifecycleReturning(
  result: Result<ApplyOutcome, LifecycleFailure>,
  seen: { envelope?: Record<string, unknown> } = {},
): FulfillmentLifecycle {
  const unused = () => {
    throw new Error("لا يُنادى في هذا الاختبارِ");
  };
  return {
    consume: async (envelope: Record<string, unknown>) => {
      seen.envelope = envelope;
      return result;
    },
    accept: unused,
    reject: unused,
    complete: unused,
    fail: unused,
    deliverOnce: unused,
  } as unknown as FulfillmentLifecycle;
}

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex")}`;
}

interface PostOptions {
  readonly body?: string;
  readonly signature?: string | null;
  readonly eventId?: string | null;
  readonly secret?: string;
  readonly lifecycle?: FulfillmentLifecycle;
}

async function post(options: PostOptions = {}): Promise<Response> {
  const body = options.body ?? JSON.stringify(ENVELOPE);
  const app = createCoreEventIntakeRoutes({
    ...(options.secret === undefined
      ? { signingSecret: SECRET }
      : { signingSecret: options.secret }),
    lifecycle: options.lifecycle ?? lifecycleReturning(ok(ACCEPTED)),
  });
  const headers: Record<string, string> = { "content-type": "application/json" };
  const signature = options.signature === undefined ? sign(body) : options.signature;
  if (signature !== null) headers["x-wasla-signature"] = signature;
  const eventId = options.eventId === undefined ? EVENT_ID : options.eventId;
  if (eventId !== null) headers["x-wasla-event-id"] = eventId;
  return app.request(CORE_EVENT_INTAKE_PATH, { method: "POST", headers, body });
}

describe("بابُ أحداثِ CORE — القبولُ الموقَّعُ", () => {
  it("مغلَّفٌ موقَّعٌ سليمٌ يُقبَلُ ويُبلِّغُ حصيلةَ التطبيقِ", async () => {
    const seen: { envelope?: Record<string, unknown> } = {};
    const response = await post({ lifecycle: lifecycleReturning(ok(ACCEPTED), seen) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      event_id: EVENT_ID,
      job_id: ACCEPTED.jobId,
      state: ACCEPTED.state,
      changed: true,
      note: null,
    });
    expect(seen.envelope).toEqual(ENVELOPE);
  });

  it("التحقّقُ على البايتاتِ المُرسَلةِ لا على إعادةِ تركيبِها", async () => {
    /**
     * جسمٌ بترتيبِ مفاتيحَ مقلوبٍ وفراغٍ زائدٍ ومحارفَ عربيّةٍ: لو حُسِبَ التوقيعُ
     * على كائنٍ مُعادِ التركيبِ لَاختلفَت البايتاتُ ولَأُخفِقَ توقيعٌ صحيحٌ.
     */
    const odd = `{\n  "payload": ${JSON.stringify({ ...ENVELOPE.payload, order_reference: "طلب-٢" })},\n  "causation_id": null,\n  "correlation_id": "${ENVELOPE.correlation_id}",\n  "occurred_at": "${ENVELOPE.occurred_at}",\n  "event_type": "core.fulfillment.created",\n  "event_id": "${EVENT_ID}"\n}`;
    const response = await post({ body: odd });
    expect(response.status).toBe(200);
  });
});

describe("بابُ أحداثِ CORE — لا قبولَ بلا إثباتِ أصلٍ", () => {
  it("بلا ترويسةِ توقيعٍ = 401", async () => {
    const response = await post({ signature: null });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "MISSING_SIGNATURE" });
  });

  it("بادئةٌ غيرُ `sha256=` = 401 ولا يُحاوَلُ فَكُّها", async () => {
    const response = await post({ signature: "md5=deadbeef" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "MISSING_SIGNATURE" });
  });

  it("توقيعٌ ليسَ سِتّعشريّاً بطولِ `sha256` = 401", async () => {
    const response = await post({ signature: "sha256=notahexdigest" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "MALFORMED_SIGNATURE" });
  });

  it("توقيعٌ بسرٍّ آخرَ = 401", async () => {
    const body = JSON.stringify(ENVELOPE);
    const response = await post({ body, signature: sign(body, "b".repeat(48)) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("توقيعٌ سليمٌ لجسمٍ آخرَ = 401: بايتٌ واحدٌ يكفي", async () => {
    const tampered = JSON.stringify({ ...ENVELOPE, occurred_at: "2026-09-12T00:00:01.000Z" });
    const response = await post({ body: tampered, signature: sign(JSON.stringify(ENVELOPE)) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("سرٌّ أقصرُ من حدِّ CORE = تعطيلٌ معلَنٌ 503 لا قبولٌ مُخفَّفٌ", async () => {
    const response = await post({ secret: "short" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "CORE_INTAKE_NOT_CONFIGURED" });
  });
});

describe("بابُ أحداثِ CORE — الهويّةُ والجسمُ يشهدانِ لشيءٍ واحدٍ", () => {
  it("بلا ترويسةِ معرّفِ حدثٍ = 400", async () => {
    const response = await post({ eventId: null });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "MISSING_EVENT_ID_HEADER" });
  });

  it("ترويسةٌ تُخالِفُ معرّفَ المغلَّفِ = 400 ولو صحَّ التوقيعُ", async () => {
    const response = await post({ eventId: "00000000-0000-4000-8000-000000000000" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "EVENT_ID_MISMATCH" });
  });

  it("جسمٌ ليسَ JSON = 400 بعدَ إثباتِ الأصلِ لا قبلَه", async () => {
    const response = await post({ body: "{ليسَ" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "MALFORMED_JSON" });
  });

  it("جسمٌ مصفوفةٌ = 400: المغلَّفُ كائنٌ", async () => {
    const response = await post({ body: "[]" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "ENVELOPE_MUST_BE_OBJECT" });
  });
});

describe("بابُ أحداثِ CORE — رمزُ الردِّ حكمٌ على الإعادةِ", () => {
  it("مخالفةُ عقدٍ = 422 فيموتُ عندَ CORE بسببِه لا يُعادُ ثمانياً", async () => {
    const response = await post({
      lifecycle: lifecycleReturning(
        err({ kind: "contract", issues: [{ path: "payload.fulfillment_id", problem: "مفقودٌ" }] }),
      ),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, error: "CONTRACT_VIOLATION" });
  });

  it("نوعٌ لا نستهلكُه = 422: سوءُ تهيئةِ اشتراكٍ لا عطلٌ عابرٌ", async () => {
    const response = await post({
      lifecycle: lifecycleReturning(
        err({ kind: "unsupported_event_type", eventType: "core.payment.captured" }),
      ),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, error: "UNSUPPORTED_EVENT_TYPE" });
  });

  it("رفضٌ منصوصٌ من القاعدةِ = 422 برمزِه لا برمزٍ عامٍّ", async () => {
    const response = await post({
      lifecycle: lifecycleReturning(
        err({ kind: "rejected", code: "PAYLOAD_FIELD_MISSING", detail: "order_reference" }),
      ),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, error: "PAYLOAD_FIELD_MISSING" });
  });

  it("عطلُ قاعدةٍ = 503 فيُعادُ: حدثٌ صحيحٌ لا يُفقَدُ لعطلٍ عندَنا", async () => {
    const response = await post({
      lifecycle: lifecycleReturning(
        err({
          kind: "port",
          error: new PortFailureError("wasla.operational_job", "connection reset"),
        }),
      ),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "INTAKE_UNAVAILABLE" });
  });
});
