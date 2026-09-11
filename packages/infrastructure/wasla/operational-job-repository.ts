/**
 * الغرض: محوّلُ **دورةِ حياةِ مهمّةِ التنفيذِ** على القاعدةِ: كلُّ دالّةٍ نداءٌ
 *    واحدٌ لدالّةٍ ذرّيّةٍ في هجرتَي `W-4`/`W-5`، لا حلقةَ ولا معاملةَ في الشيفرةِ.
 * الحالة: منفّذ فعلياً — 2026-09-11 · البند `W-5`.
 * ينتمي إلى: infrastructure/wasla
 * يُستخدم من: الاختباراتُ التكامليّةُ اليومَ، وحاويةُ العاملِ عندَ رفعِ
 *    `DEP-CORE-001`.
 * ملاحظات مستقبلية: لا يُضافُ ههنا نداءٌ ثانٍ لصفقةٍ واحدةٍ منطقيّةٍ — الذرّيّةُ
 *    في الدالّةِ (القاعدةُ ٠.٥)، ونداءانِ يفتحانِ نافذةً بينَهما.
 *
 * ## لماذا تُقرأُ أخطاءُ الدالّةِ ولا تُبتلَعُ
 *
 * دوالُّ الهجرةِ تُرجِعُ `{ok:false,error:CODE}` للممنوعِ المعروفِ
 * (`ILLEGAL_TRANSITION`, `JOB_NOT_FOUND`, `OUTCOME_INVALID`...). وهذه **تُرفَعُ
 * عطلاً برمزِها** لا تُقرأُ نجاحاً بحقولٍ فارغةٍ: نجاحٌ بلا أثرٍ هوَ بعينِه
 * «إعلانُ النجاحِ قبلَ تحقُّقِ شرطِه» المنهيُّ عنه.
 */

import type { PortFailureError } from "../../application/ports/index.ts";
import type {
  ApplyOutcome,
  ClaimedMoveEvent,
  EventEnvelope,
  FulfillmentLifecycleStore,
  IngestOutcome,
  TransitionOutcome,
} from "../../application/wasla/fulfillment-lifecycle.ts";
import type { OperationalJobState } from "../../domain/wasla/operational-job.ts";
import {
  MOVE_EVENT_OUTBOX_BACKOFF_SECONDS,
  MOVE_EVENT_OUTBOX_CLAIM_STALE_SECONDS,
  MOVE_EVENT_OUTBOX_MAX_ATTEMPTS,
} from "../../shared/config/move-event-outbox.ts";
import type { Result } from "../../shared/result/index.ts";
import { guard, type RpcEnvelope, readEnvelope, type Sql } from "../db/client.ts";

const PORT = "wasla.operational_jobs";

/** يقرأُ المغلَّفَ أو يرفعُ — ردٌّ غيرُ مفهومٍ ليسَ نجاحاً. */
function envelopeOrThrow(rpc: string, value: unknown): RpcEnvelope {
  const envelope = readEnvelope(value);
  if (envelope === null) throw new Error(`ردُّ ${rpc} غيرُ مفهومٍ`);
  if (!envelope.ok) {
    const code = typeof envelope.error === "string" ? envelope.error : "UNKNOWN";
    const extra = Object.entries(envelope)
      .filter(([key]) => key !== "ok" && key !== "error")
      .map(([key, raw]) => `${key}=${String(raw)}`)
      .join(" ");
    throw new Error(`${rpc} ردَّ ${code}${extra === "" ? "" : ` (${extra})`}`);
  }
  return envelope;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function stateOrNull(value: unknown): OperationalJobState | null {
  return typeof value === "string" ? (value as OperationalJobState) : null;
}

interface ClaimRow {
  readonly row_id: string;
  readonly claim_token: string;
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
  readonly attempts: number;
}

/**
 * يُعيدُ تركيبَ المغلَّفِ من أعمدةِ الصفِّ — و`occurred_at` يُصاغُ ISO بمنطقةٍ
 * صريحةٍ لأنَّ عقدَ CORE يشترطُ `date-time`، و`Date` كائنٌ لا نصٌّ.
 */
function envelopeFromRow(row: ClaimRow): EventEnvelope {
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

export function createOperationalJobRepository(sql: Sql): FulfillmentLifecycleStore {
  async function transition(
    rpc: "accept_operational_job" | "reject_operational_job",
    args: readonly unknown[],
  ): Promise<TransitionOutcome> {
    const rows =
      rpc === "accept_operational_job"
        ? await sql<{ result: unknown }[]>`
            select accept_operational_job(
              ${args[0] as string}::uuid, ${args[1] as string}::text, ${args[2] as string | null}::text
            ) as result`
        : await sql<{ result: unknown }[]>`
            select reject_operational_job(
              ${args[0] as string}::uuid, ${args[1] as string}::text,
              ${args[2] as string}::text, ${args[3] as string | null}::text
            ) as result`;
    const envelope = envelopeOrThrow(rpc, rows[0]?.result);
    const jobId = stringOrNull(envelope.job_id);
    const state = stateOrNull(envelope.state);
    if (jobId === null || state === null) throw new Error(`${rpc} نجحَ بلا معرّفٍ أو حالةٍ`);
    return { jobId, state, duplicate: envelope.duplicate === true };
  }

  async function applied(rpc: string, rows: readonly { result: unknown }[]): Promise<ApplyOutcome> {
    const envelope = envelopeOrThrow(rpc, rows[0]?.result);
    /**
     * دالّتا التطبيقِ تُفرِّقانِ بينَ «أنشأتُ/طبَّقتُ» و«لم أُطبِّقْ ولا خطأَ»:
     * الثانيةُ نجاحٌ بلا تغييرٍ (مكرَّرٌ، أو نهائيٌّ سابقاً، أو مهمّةٌ لا وجودَ
     * لها). فتُنقَلُ كما هيَ ولا تُقرأُ نجاحَ تغييرٍ.
     */
    const changed = envelope.created === true || envelope.applied === true;
    const note = changed
      ? null
      : (stringOrNull(envelope.reason) ??
        (envelope.duplicate === true ? "DUPLICATE" : "NO_CHANGE"));
    return {
      jobId: stringOrNull(envelope.job_id),
      state: stateOrNull(envelope.state),
      changed,
      note,
    };
  }

  return {
    ingestCoreEvent: (envelope: EventEnvelope): Promise<Result<IngestOutcome, PortFailureError>> =>
      guard(`${PORT}.ingest_core_event`, async () => {
        const rows = await sql<{ result: unknown }[]>`
          select ingest_core_event(${sql.json(envelope as never)}::jsonb) as result`;
        const result = envelopeOrThrow("ingest_core_event", rows[0]?.result);
        const eventId = stringOrNull(result.event_id);
        if (eventId === null) throw new Error("ingest_core_event نجحَ بلا معرّفِ حدثٍ");
        return { eventId, duplicate: result.duplicate === true };
      }),

    applyFulfillmentCreated: (eventId) =>
      guard(`${PORT}.apply_core_fulfillment_created`, async () =>
        applied(
          "apply_core_fulfillment_created",
          await sql<{ result: unknown }[]>`
            select apply_core_fulfillment_created(${eventId}::uuid) as result`,
        ),
      ),

    applyFulfillmentCancelled: (eventId) =>
      guard(`${PORT}.apply_core_fulfillment_cancelled`, async () =>
        applied(
          "apply_core_fulfillment_cancelled",
          await sql<{ result: unknown }[]>`
            select apply_core_fulfillment_cancelled(${eventId}::uuid) as result`,
        ),
      ),

    accept: (fulfillmentId, correlationId, causationId) =>
      guard(`${PORT}.accept_operational_job`, () =>
        transition("accept_operational_job", [fulfillmentId, correlationId, causationId]),
      ),

    reject: (fulfillmentId, reason, correlationId, causationId) =>
      guard(`${PORT}.reject_operational_job`, () =>
        transition("reject_operational_job", [fulfillmentId, reason, correlationId, causationId]),
      ),

    close: (fulfillmentId, outcome, correlationId, failureReason, causationId) =>
      guard(`${PORT}.close_operational_job`, async () => {
        const rows = await sql<{ result: unknown }[]>`
          select close_operational_job(
            ${fulfillmentId}::uuid, ${outcome}::text, ${correlationId}::text,
            ${failureReason}::text, ${causationId}::text
          ) as result`;
        const envelope = envelopeOrThrow("close_operational_job", rows[0]?.result);
        const jobId = stringOrNull(envelope.job_id);
        const state = stateOrNull(envelope.state);
        if (jobId === null || state === null) {
          throw new Error("close_operational_job نجحَ بلا معرّفٍ أو حالةٍ");
        }
        return { jobId, state, duplicate: envelope.duplicate === true };
      }),

    claimNextEvent: (
      staleAfterSeconds = MOVE_EVENT_OUTBOX_CLAIM_STALE_SECONDS,
    ): Promise<Result<ClaimedMoveEvent | null, PortFailureError>> =>
      guard(`${PORT}.claim_move_event_delivery`, async () => {
        const rows = await sql<ClaimRow[]>`
          select * from claim_move_event_delivery(${staleAfterSeconds}::integer)`;
        const row = rows[0];
        if (row === undefined) return null;
        return {
          rowId: row.row_id,
          claimToken: row.claim_token,
          attempts: row.attempts,
          envelope: envelopeFromRow(row),
        };
      }),

    finishDelivery: (claimToken) =>
      guard(`${PORT}.finish_move_event_delivery`, async () => {
        const rows = await sql<{ finished: boolean }[]>`
          select finish_move_event_delivery(${claimToken}::uuid) as finished`;
        return rows[0]?.finished === true;
      }),

    abandonDelivery: (claimToken, error) =>
      guard(`${PORT}.abandon_move_event_delivery`, async () => {
        const rows = await sql<{ result: unknown }[]>`
          select abandon_move_event_delivery(
            ${claimToken}::uuid,
            ${error}::text,
            ${MOVE_EVENT_OUTBOX_MAX_ATTEMPTS}::integer,
            ${MOVE_EVENT_OUTBOX_BACKOFF_SECONDS}::integer
          ) as result`;
        const envelope = envelopeOrThrow("abandon_move_event_delivery", rows[0]?.result);
        const attempts = Number(envelope.attempts);
        return {
          dead: envelope.dead === true,
          attempts: Number.isFinite(attempts) ? attempts : 0,
        };
      }),
  };
}
