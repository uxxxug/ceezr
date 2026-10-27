/**
 * يدير شوطَ صندوقِ الصادرِ الموحَّدِ لكلِّ أنواعِ الإشعاراتِ؛ القفل الموزع يطبقه
 * runner على اسم المهمة المسجل، فلا يجري شوطانِ في وقتٍ واحدٍ (BUG-004).
 *
 * CAP-RUN-20261015 / N1 — الشوطُ صارَ استنزافًا متزامنًا محدودًا (انظر
 * `deliverNotificationsConcurrently`). `NOTIFICATION_DRAIN_BUDGET_MS=0` يعيدُ السلوكَ القديمَ حرفيًّا
 * (دفعةٌ تسلسليّةٌ واحدةٌ حتّى batch_limit) — للمقارنةِ قبل/بعد وللرجوعِ السريع.
 */

import {
  type ConcurrentDrainOutcome,
  type DeliveryBatchOutcome,
  deliverNotificationBatch,
  deliverNotificationsConcurrently,
  type NotificationAttemptRecord,
  type NotificationDeliveryDeps,
} from "../../../../packages/application/notification/deliver-notification.ts";
import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import {
  type DeliveryAttemptMeter,
  deliveryAttemptMeterFields,
  emptyDeliveryAttemptMeter,
} from "../../../../packages/infrastructure/notification/delivery-attempt-meter.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export interface NotificationDrainSettings {
  readonly lanes: number;
  readonly budgetMs: number;
  readonly maxClaims: number;
}

export const NOTIFICATION_DRAIN_DEFAULTS: NotificationDrainSettings = {
  // يساوي سقفَ تزامنِ المستهلكِ الافتراضيَّ لكلِّ مدينة (outbox_queue_consumer_concurrency=8)؛
  // والقاعدةُ تفرضُ السقفَ لكلِّ مدينةٍ مهما كانت قيمةُ هذا الإعداد.
  lanes: 8,
  // أقلُّ من دقّةِ المشغّلِ (10ث) ليبقى هامشٌ للمهامِّ الأخرى ولإيقافٍ نظيف.
  budgetMs: 8_000,
  maxClaims: 2_000,
};

function intIn(raw: string | undefined, min: number, max: number): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

/** قيمٌ غيرُ صالحةٍ تعودُ للافتراضيِّ (لا تُعطِّلُ الإقلاع) وتُعلَنُ في `invalid`. */
export function notificationDrainSettingsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): NotificationDrainSettings & { invalid: string[] } {
  const invalid: string[] = [];
  const pickOr = (name: string, min: number, max: number, dflt: number) => {
    const raw = env[name];
    const v = intIn(raw, min, max);
    if (raw !== undefined && raw.trim() !== "" && v === null) invalid.push(name);
    return v ?? dflt;
  };
  return {
    lanes: pickOr("NOTIFICATION_DRAIN_LANES", 1, 64, NOTIFICATION_DRAIN_DEFAULTS.lanes),
    budgetMs: pickOr(
      "NOTIFICATION_DRAIN_BUDGET_MS",
      0,
      60_000,
      NOTIFICATION_DRAIN_DEFAULTS.budgetMs,
    ),
    maxClaims: pickOr(
      "NOTIFICATION_DRAIN_MAX_CLAIMS",
      1,
      100_000,
      NOTIFICATION_DRAIN_DEFAULTS.maxClaims,
    ),
    invalid,
  };
}

export function deliverNotifications(
  deps: NotificationDeliveryDeps,
  settings: NotificationDrainSettings = { ...NOTIFICATION_DRAIN_DEFAULTS, budgetMs: 0 },
): Promise<Result<DeliveryBatchOutcome | ConcurrentDrainOutcome, PortFailureError>> {
  if (settings.budgetMs <= 0) return deliverNotificationBatch(deps);
  return deliverNotificationsConcurrently(deps, settings);
}

/**
 * `LOAD-01` (تفكيكُ P7) — أثرُ كلِّ محاولةِ تسليمٍ في السجلّ (`notification.attempt`).
 *
 * **مُطفأٌ افتراضيًّا**، ولا يُشعَلُ إلّا بـ`NOTIFICATION_ATTEMPT_TRACE=1` (مقعدُ القياس).
 * و`NOTIFICATION_ATTEMPT_TRACE_KINDS` قائمةُ أنواعٍ مفصولةٌ بفواصل تحصرُه فيها فيبقى حملُ
 * السجلِّ في ما يُشخَّصُ وحدَه؛ وغيابُها = كلُّ الأنواع. القيمُ غيرُ الصالحةِ تُطفئُه أو
 * تُسقَطُ وتُعلَنُ في `invalid` (لا تُعطِّلُ الإقلاع).
 */
export interface NotificationAttemptTraceSettings {
  readonly enabled: boolean;
  readonly kinds: ReadonlySet<string> | null;
  readonly invalid: string[];
}

const TRACE_KIND = /^[a-z][a-z0-9_]{0,47}$/;

export function notificationAttemptTraceFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): NotificationAttemptTraceSettings {
  const invalid: string[] = [];
  const raw = env.NOTIFICATION_ATTEMPT_TRACE?.trim() ?? "";
  if (raw !== "" && raw !== "0" && raw !== "1") invalid.push("NOTIFICATION_ATTEMPT_TRACE");
  const enabled = raw === "1";
  const kindsRaw = env.NOTIFICATION_ATTEMPT_TRACE_KINDS?.trim() ?? "";
  let kinds: Set<string> | null = null;
  if (kindsRaw !== "") {
    kinds = new Set<string>();
    for (const k of kindsRaw.split(",").map((x) => x.trim())) {
      if (TRACE_KIND.test(k)) kinds.add(k);
      else invalid.push("NOTIFICATION_ATTEMPT_TRACE_KINDS");
    }
    if (kinds.size === 0) kinds = null;
  }
  return { enabled, kinds, invalid: [...new Set(invalid)] };
}

/**
 * `LOAD-01` (CLAIM-SPLIT): `NOTIFICATION_CLAIM_SPLIT=1` يُشعلُ تفكيكَ زمنِ الالتقاطِ ومسبارَ حلقةِ
 * الأحداث. والغيابُ أو `0` = مطفأ. وقيمةٌ أخرى تُطفئُه وتُعلَن (`invalid`)، لا تُخمَّن.
 */
export function notificationClaimSplitFromEnv(env: Readonly<Record<string, string | undefined>>): {
  readonly enabled: boolean;
  readonly invalid: boolean;
} {
  const raw = env.NOTIFICATION_CLAIM_SPLIT?.trim() ?? "";
  return { enabled: raw === "1", invalid: raw !== "" && raw !== "0" && raw !== "1" };
}

/** حقولُ سطرِ الشوطِ للتفكيك: أعدادٌ صحيحةٌ وحدَها (ms وµs و‰) — قائمةٌ مغلقةٌ يثبّتُها اختبار. */
export function notificationClaimSplitLogFields(
  split: {
    readonly timed: number;
    readonly queries: number;
    readonly preMs: number;
    readonly serverMs: number;
    readonly postMs: number;
    readonly skewed: number;
  },
  loop: {
    readonly delayMeanUs: number;
    readonly delayP99Us: number;
    readonly delayMaxUs: number;
    readonly eluPermille: number;
  },
): string[] {
  return [
    `claim_timed=${split.timed}`,
    `claim_queries=${split.queries}`,
    `claim_pre_ms=${Math.round(split.preMs)}`,
    `claim_server_ms=${Math.round(split.serverMs)}`,
    `claim_post_ms=${Math.round(split.postMs)}`,
    `claim_skewed=${split.skewed}`,
    `el_delay_mean_us=${loop.delayMeanUs}`,
    `el_delay_p99_us=${loop.delayP99Us}`,
    `el_delay_max_us=${loop.delayMaxUs}`,
    `elu_permille=${loop.eluPermille}`,
  ];
}

export function traceCoversKind(settings: NotificationAttemptTraceSettings, kind: string): boolean {
  return settings.enabled && (settings.kinds === null || settings.kinds.has(kind));
}

/**
 * حقولُ سطرِ `notification.attempt`: سجلُّ المحاولةِ من طبقةِ التطبيقِ + عدّادُ المُرسِل.
 * أرقامٌ ومعرّفُ الصفِّ ونوعُه وحدَها — قائمةٌ مغلقةٌ يثبّتُها اختبار.
 */
export function notificationAttemptLogFields(
  record: NotificationAttemptRecord,
  meter: DeliveryAttemptMeter | undefined,
): Record<string, string | number | null> {
  return {
    delivery_id: record.deliveryId,
    kind: record.kind,
    notice_event: record.event,
    attempt: record.attempt,
    signal_waits: record.signalWaits,
    started_at_ms: record.startedAtMs,
    duration_ms: Math.round(record.durationMs),
    lane_wait_ms: record.laneWaitMs === null ? null : Math.round(record.laneWaitMs),
    outcome: record.outcome,
    retry_after_ms: record.retryAfterMs,
    failure: record.failure,
    metered: meter === undefined ? 0 : 1,
    ...deliveryAttemptMeterFields(meter ?? emptyDeliveryAttemptMeter()),
  };
}
