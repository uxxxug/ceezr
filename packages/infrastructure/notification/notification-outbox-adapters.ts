/**
 * محوّلُ صندوقِ الصادرِ الموحَّدِ إلى RPCs الذرّيّة (BUG-004). كلُّ تغيّرِ حالةٍ يبقى
 * في PostgreSQL: claim بـFOR UPDATE SKIP LOCKED + claim_token، وfinish بالرمزِ لا
 * بالصفّ، وabandon بالرمزِ كذلك. المحوّلُ لا يعرفُ نوعًا بعينِه: يمرّرُ kind والحمولةَ
 * كما بنتهما القاعدةُ إلى معالجِ النوعِ. مرآةٌ لـcreateSafetyDeliveryPort في البنية،
 * تزيدُ عليها abandon.
 */
import type {
  ClaimQueryDetail,
  ClaimTiming,
  FinishOutcome,
  NotificationOutboxPort,
  OutboxDelivery,
} from "../../application/notification/deliver-notification.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import { guard, readEnvelope, type Sql, withRequestContext } from "../db/client.ts";
import { readCorrelationId } from "../observability/correlation.ts";
import { observeQuery } from "./claim-split-probe.ts";

const FINISH_OUTCOMES: readonly string[] = ["delivered", "dead", "retried"];

/**
 * مآلُ القاعدةِ يُقرأُ كما هو لا كما يُشتهى: نصٌّ غيرُ معروفٍ يعودُ `null` فلا
 * يُحسبَ موتاً ولا تسليماً بالغلطِ. (CAP-002)
 */
function finishOutcome(value: unknown): FinishOutcome | null {
  const text = typeof value === "string" ? value : null;
  return text !== null && FINISH_OUTCOMES.includes(text) ? (text as FinishOutcome) : null;
}

function envelope(value: unknown, name: string): Record<string, unknown> {
  const result = readEnvelope(value);
  if (result === null) throw new Error(`ردّ ${name} غير مفهوم`);
  return result;
}

/** ساعةُ الزمنِ الحقيقيِّ بدقّةٍ دونَ الملّي ثانية (ms منذ الحقبة)، لمقارنتِها بساعةِ PG على المضيفِ نفسِه. */
export interface ClaimSplitClock {
  realtimeMs(): number;
  /** CLAIM-WAIT: ما في الطيرانِ على تجمّعِ هذا المنفذِ الآن (غيابُه = لا عدّ). */
  inflight?(): { readonly queries: number; readonly transactions: number };
  /** سعةُ التجمّع، لوسمِ الإصدارِ حينَ يبلغُ ما في الطيرانِ السعة. */
  readonly poolMax?: number;
}

export interface NotificationOutboxPortOptions {
  /** CLAIM-SPLIT (`NOTIFICATION_CLAIM_SPLIT=1`): غيابُه = الاستعلامُ الافتراضيُّ بنصِّه. */
  readonly claimSplit?: ClaimSplitClock;
}

interface Stamped {
  readonly st_ms: number;
  readonly ct_ms: number;
}

/** جزءٌ واحدٌ: الإصدارُ t0، والعودةُ t1، وختما الخادم. */
export function splitOfQuery(t0: number, t1: number, row: Stamped | undefined) {
  if (row === undefined) return { preMs: t1 - t0, serverMs: 0, postMs: 0, skewed: 1 };
  const preMs = row.st_ms - t0;
  const serverMs = row.ct_ms - row.st_ms;
  const postMs = t1 - row.ct_ms;
  return { preMs, serverMs, postMs, skewed: preMs < 0 || postMs < 0 || serverMs < 0 ? 1 : 0 };
}

function addSplit(
  a: ClaimTiming,
  b: ReturnType<typeof splitOfQuery>,
  detail?: ClaimQueryDetail,
): ClaimTiming {
  return {
    queries: a.queries + 1,
    preMs: a.preMs + b.preMs,
    serverMs: a.serverMs + b.serverMs,
    postMs: a.postMs + b.postMs,
    skewed: a.skewed + b.skewed,
    ...(detail === undefined ? {} : { detail: [...(a.detail ?? []), detail] }),
  };
}

/**
 * CLAIM-WAIT: يُصدِرُ استعلامًا مختومًا ويرصدُ مراحلَه على كائنِ الاستعلامِ نفسِه (`observeQuery`)،
 * ويقرأُ ما في الطيرانِ قبلَ الإصدار. فيُرجعُ الصفوفَ والأجزاءَ الثلاثةَ والتفصيل.
 */
async function timedQuery<R extends Stamped>(
  clock: ClaimSplitClock,
  index: 1 | 2,
  build: () => PromiseLike<R[]>,
): Promise<{ rows: R[]; part: ReturnType<typeof splitOfQuery>; detail: ClaimQueryDetail }> {
  const inflight = clock.inflight?.() ?? null;
  const t0 = clock.realtimeMs();
  const q = build();
  const obs = observeQuery(q as object, clock.realtimeMs);
  const rows = await q;
  const t1 = clock.realtimeMs();
  const row = rows[0];
  const part = splitOfQuery(t0, t1, row);
  // مرصودٌ = ثلاثةُ الأختامِ حاضرةٌ ومرتّبةٌ على ساعةِ العاملِ نفسِها (t0 ≤ كتابة ≤ رأس ≤ resolve ≤ t1).
  // وغيرُ المرتّبِ يُعَدُّ غيرَ مرصود، فيظهرُ في نسبةِ التغطيةِ ولا يُخمَّن.
  const stamped =
    obs.tWrite !== null &&
    obs.tActive !== null &&
    obs.tResolved !== null &&
    row !== undefined &&
    t0 <= obs.tWrite &&
    obs.tWrite <= obs.tActive &&
    obs.tActive <= obs.tResolved &&
    obs.tResolved <= t1;
  const detail: ClaimQueryDetail = {
    index,
    preMs: part.preMs,
    serverMs: part.serverMs,
    postMs: part.postMs,
    poolMs: stamped ? (obs.tWrite as number) - t0 : 0,
    pipeMs: stamped ? (obs.tActive as number) - (obs.tWrite as number) : 0,
    postWireMs: stamped ? (obs.tResolved as number) - row.ct_ms : 0,
    contMs: stamped ? t1 - (obs.tResolved as number) : 0,
    stamped,
    pipelined: obs.pipelined === true,
    skewed: part.skewed === 1,
    inflight,
    busyAtIssue:
      inflight === null || clock.poolMax === undefined
        ? null
        : inflight.queries + inflight.transactions >= clock.poolMax,
  };
  return { rows, part, detail };
}

const NO_TIMING: ClaimTiming = { queries: 0, preMs: 0, serverMs: 0, postMs: 0, skewed: 0 };

export function createNotificationOutboxPort(
  sql: Sql,
  options: NotificationOutboxPortOptions = {},
): NotificationOutboxPort {
  const clock = options.claimSplit;
  return {
    claim: () =>
      guard("rpc.claim_notification_delivery", async () => {
        let timing: ClaimTiming | undefined;
        let rows: { result: unknown }[];
        if (clock === undefined) {
          rows = await sql<{ result: unknown }[]>`select claim_notification_delivery() result`;
        } else {
          // `offset 0` يحجزُ الدالّةَ في استعلامٍ فرعيّ: لا يُقرأُ `clock_timestamp()` إلّا بعدَها.
          const r = await timedQuery(
            clock,
            1,
            () => sql<({ result: unknown } & Stamped)[]>`
            select x.result,
                   (extract(epoch from statement_timestamp()) * 1000)::float8 as st_ms,
                   (extract(epoch from clock_timestamp()) * 1000)::float8 as ct_ms
              from (select claim_notification_delivery() result offset 0) x`,
          );
          timing = addSplit(NO_TIMING, r.part, r.detail);
          rows = r.rows;
        }
        const row = envelope(rows[0]?.result, "claim_notification_delivery");
        if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
        const delivery = row.delivery as Record<string, unknown> | null;
        if (delivery == null) {
          // `SEC-19-ب-٣` — صفٌّ عُذِرَ تسليمُه في القاعدةِ: العنوانُ غائبٌ فلا
          // يُحاوَلُ إرسالُه. ويُمَرَّرُ للعدِّ فيُكملُ الشوطَ لا يُنهيهِ.
          const undeliverableId = row.undeliverable;
          if (undeliverableId != null) {
            return {
              delivery: null,
              undeliverable: {
                deliveryId: String(undeliverableId),
                kind: String(row.kind),
                reason: String(row.reason),
                batchLimit: Number(row.batch_limit),
              },
              backpressure: null,
              ...(timing === undefined ? {} : { timing }),
            };
          }
          // لا صفَّ: إمّا الطابورُ فارغٌ، وإمّا سقفُ تزامنِ المستهلِكِ منعَ الالتقاطَ
          // (`F6-06`). ويُقرأُ السببُ كما أعلنَته القاعدةُ لا كما يُشتهى: نصٌّ غيرُ
          // معروفٍ يعودُ `null` فلا يُحسبَ تشبُّعاً بالغلطِ.
          const reason = row.backpressure;
          return {
            delivery: null,
            backpressure: reason === "CONSUMER_CONCURRENCY" ? "CONSUMER_CONCURRENCY" : null,
            ...(timing === undefined ? {} : { timing }),
          };
        }
        const payload = delivery.payload;

        // معرِّفُ الطلبِ الذي أنشأَ الصفَّ (`F8-01`) يُقرأُ بقراءةٍ ثانيةٍ بالمفتاحِ
        // الأوّليِّ **لا بتعديلِ `claim_notification_delivery`**: تلكَ دالّةٌ ذرّيّةٌ
        // حاكمةٌ (`FOR UPDATE SKIP LOCKED` · ضغطٌ عكسيٌّ · أولويّةُ مرورٍ) يُعادُ
        // تعريفُها بجسمِها كلِّه في أيِّ هجرةٍ تمسُّها، فنسخُ مائةٍ وخمسينَ سطراً
        // لأجلِ حقلِ مراقبةٍ يُنشئُ مصدرَ حقيقةٍ ثانياً للالتقاطِ — والقاعدةُ 0.6
        // تمنعُ ذلك. والقراءةُ ههنا **بعدَ** الالتقاطِ فالصفُّ مملوكٌ برمزِ الحجزِ،
        // فلا تسابُقَ. وفشلُها لا يُخفى: `guard` يردُّه عطباً كسائرِ الاستعلامِ.
        const deliveryId = String(delivery.delivery_id);
        let correlationRows: { request_id: string | null }[];
        if (clock === undefined) {
          correlationRows = await sql<{ request_id: string | null }[]>`
          select request_id from notification_outbox where id = ${deliveryId}::uuid
        `;
        } else {
          // استعلامٌ قياسيٌّ (scalar) فيُرجعُ صفًّا واحدًا دائمًا، ومعه ختما الخادم.
          const r = await timedQuery(
            clock,
            2,
            () => sql<({ request_id: string | null } & Stamped)[]>`
            select (select request_id from notification_outbox where id = ${deliveryId}::uuid) as request_id,
                   (extract(epoch from statement_timestamp()) * 1000)::float8 as st_ms,
                   (extract(epoch from clock_timestamp()) * 1000)::float8 as ct_ms`,
          );
          timing = addSplit(timing ?? NO_TIMING, r.part, r.detail);
          correlationRows = r.rows;
        }

        return {
          delivery: {
            deliveryId: String(delivery.delivery_id),
            kind: String(delivery.kind),
            cityId: String(delivery.city_id) as CityId,
            claimToken: String(delivery.claim_token),
            attempts: Number(delivery.attempts),
            maxAttempts: Number(delivery.max_attempts),
            // `LOAD-01 Recovery` — عدّادُ انتظارِ إشارةِ اللوحِ (اختياريٌّ:
            // الصفوفُ القديمةُ قبلهُ = صفرٌ).
            signalWaitCount: Number(delivery.signal_wait_count ?? 0),
            batchLimit: Number(delivery.batch_limit),
            // معرِّفُ الطلبِ الذي أنشأَ الصفَّ (`F8-01`): تكتبُه مُشغِّلاتُ القاعدةِ
            // عندَ الإدراجِ، ويُعادُ ههنا **كما هوَ في الصفِّ** فيستعيدُ العاملُ
            // سلسلةَ الارتباطِ. ونصٌّ غيرُ صالحٍ أو غيابٌ يعودُ `null` لا مولَّداً.
            requestId: readCorrelationId(correlationRows[0]?.request_id),
            payload:
              typeof payload === "object" && payload !== null
                ? (payload as Record<string, unknown>)
                : {},
          } satisfies OutboxDelivery,
          ...(timing === undefined ? {} : { timing }),
        };
      }),
    // `LOAD-01 Recovery` — تسليمٌ عبرَ اللوحِ بإيصالٍ، وعودةٌ بانتظارِ الإشارةِ:
    // الرمزانِ الحارسانِ كما في أخواتِهما — لا عملَ إلا على صفٍّ `sending`
    // يحملُ الرمزَ نفسَهُ.
    finishViaBoard: (input) =>
      guard("rpc.finish_notification_delivery_via_board", async () => {
        const rows = await withRequestContext(
          sql,
          (tx) =>
            tx<{ result: unknown }[]>`select finish_notification_delivery_via_board(
              ${input.deliveryId}::uuid, ${input.claimToken}::uuid) result`,
        );
        const row = envelope(rows[0]?.result, "finish_notification_delivery_via_board");
        return { ok: row.ok === true, outcome: finishOutcome(row.outcome) };
      }),
    requeueSignalWait: (input) =>
      guard("rpc.requeue_notification_delivery_signal_wait", async () => {
        const rows = await withRequestContext(
          sql,
          (tx) =>
            tx<{ result: unknown }[]>`select requeue_notification_delivery_signal_wait(
              ${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${input.retryAfterMs}::integer) result`,
        );
        const row = envelope(rows[0]?.result, "requeue_notification_delivery_signal_wait");
        return { ok: row.ok === true, outcome: finishOutcome(row.outcome) };
      }),
    finish: (input) =>
      guard("rpc.finish_notification_delivery", async () => {
        // `F8-01` — موضعٌ موصولٌ مُعلَنٌ: إعلانُ نتيجةِ التسليمِ يجري في معاملةٍ
        // مضبوطةٍ بمعرِّفِ الطلبِ الذي أنشأَ الصفَّ (استعادَه العاملُ من الصفِّ)،
        // فأثرُ الإرسالِ في القاعدةِ يُقرأُ بمعرِّفِ الطلبِ نفسِه لا بمعرِّفٍ آخرَ.
        const rows = await withRequestContext(
          sql,
          (tx) =>
            tx<
              { result: unknown }[]
            >`select finish_notification_delivery(${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${input.messageId}::text, ${input.messageId !== null}, ${input.error}::text) result`,
        );
        const row = envelope(rows[0]?.result, "finish_notification_delivery");
        return { ok: row.ok === true, outcome: finishOutcome(row.outcome) };
      }),
    abandon: (input) =>
      guard("rpc.abandon_notification_delivery", async () => {
        const rows = await sql<
          { result: unknown }[]
        >`select abandon_notification_delivery(${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${input.reason}::text) result`;
        const row = envelope(rows[0]?.result, "abandon_notification_delivery");
        return row.ok === true;
      }),
    requeue: (input) =>
      guard("rpc.requeue_notification_delivery", async () => {
        // `D8` — إعادةُ ازدحامٍ: موعدُ الفتحةِ من المُرسِلِ، مسقوفٌ بدقيقةٍ حتى لا
        // يعلَقَ صفٌّ أبدًا بموعدٍ بعيدٍ من تقديرٍ شاذٍّ.
        const retryAfterMs = Math.min(Math.max(0, Math.floor(input.retryAfterMs)), 60_000);
        const rows = await sql<
          { result: unknown }[]
        >`select requeue_notification_delivery(${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${retryAfterMs}::integer) result`;
        const row = envelope(rows[0]?.result, "requeue_notification_delivery");
        return row.ok === true;
      }),
    undeliverable: (input) =>
      guard("rpc.mark_notification_undeliverable", async () => {
        const rows = await sql<
          { result: unknown }[]
        >`select mark_notification_undeliverable(${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${input.reason}::text) result`;
        const row = envelope(rows[0]?.result, "mark_notification_undeliverable");
        return row.ok === true;
      }),
  };
}
