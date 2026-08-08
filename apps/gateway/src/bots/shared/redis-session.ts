/**
 * الغرض: مخزن جلسات الحوار على Redis — نفس منفذ SessionStore الذي ينفّذه المخزن
 *   في الذاكرة، بلا تغيير سطر واحد في أي حوار.
 * الحالة: منفّذ فعلياً — القسم 2 البند د.2.
 * ينتمي إلى: apps/gateway/src/bots/shared
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts عند SESSION_STORE=redis
 * ملاحظات مستقبلية: لا دالّة prune هنا عن قصد — انتهاء المهلة مسؤولية Redis نفسه
 *   بـ EX، فمهمّة التنظيف الدورية تتخطّاه كما هو موثّق في cleanup-stale-sessions.ts.
 */

import type {
  DialogState,
  DialogStep,
  SessionStore,
} from "../../../../../packages/application/bots/types.ts";
import { PortFailureError } from "../../../../../packages/application/ports/index.ts";
import type { CityId, ServiceType } from "../../../../../packages/shared/kernel/index.ts";
import { err, ok, type Result } from "../../../../../packages/shared/result/index.ts";
import type { RedisClient, RedisFailure } from "../../redis/upstash.ts";
import { SESSION_TTL_SECONDS } from "./session.ts";

/** بادئة مفاتيح المنصّة في Redis، حتى تتعايش مع أي استعمال آخر لنفس القاعدة. */
export const REDIS_SESSION_PREFIX = "waslah:session";

/**
 * فضاء المفتاح لكل بوت. في الذاكرة كان الفصل بوجود خريطتين منفصلتين؛ في Redis
 * القاعدة واحدة، فلو تشارك البوتان بادئةً واحدة لرأى العميل خطوةَ حوارِ سائقٍ
 * لأنّ معرّف تلغرام للشخص نفسه واحد في البوتين.
 */
export type SessionNamespace = "driver" | "rider";

const DIALOG_STEPS: readonly DialogStep[] = [
  "idle",
  "awaiting_name",
  "awaiting_phone",
  "awaiting_city",
  "awaiting_service",
  "awaiting_pickup",
  "awaiting_dropoff",
  "awaiting_parcel",
  "awaiting_support_type",
  "awaiting_support_message",
];

const SUPPORT_TYPES = ["subscription", "ride_dispute"] as const;
const SERVICE_TYPES = ["transport", "delivery"] as const;

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function nullableCoordinates(value: unknown): { latitude: number; longitude: number } | null | 0 {
  if (value === null) return null;
  if (typeof value !== "object") return 0;
  const point = value as { latitude?: unknown; longitude?: unknown };
  if (typeof point.latitude !== "number" || typeof point.longitude !== "number") return 0;
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return 0;
  return { latitude: point.latitude, longitude: point.longitude };
}

/**
 * ما يخرج من Redis نصٌّ كتبته نسخةٌ قد تكون أقدم من هذه: حقلٌ ناقص، أو خطوة حُذفت
 * في إصدار لاحق. القبول الأعمى يعني تمرير حالة مكسورة إلى الحوار فيتصرّف بها كأنها
 * صحيحة. لذلك يُتحقّق من كل حقل، وما لم يمرّ يُعامَل «لا جلسة» لا «جلسة فاسدة».
 */
export function parseDialogState(raw: string): DialogState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;

  const step = candidate.step;
  if (typeof step !== "string" || !DIALOG_STEPS.includes(step as DialogStep)) return null;
  if (typeof candidate.language !== "string") return null;

  const draftName = nullableString(candidate.draftName);
  const draftPhone = nullableString(candidate.draftPhone);
  const draftCityId = nullableString(candidate.draftCityId);
  if (draftName === undefined || draftPhone === undefined || draftCityId === undefined) return null;

  const service = candidate.draftService;
  if (service !== null && !(SERVICE_TYPES as readonly unknown[]).includes(service)) return null;

  const supportType = candidate.draftSupportType;
  if (supportType !== null && !(SUPPORT_TYPES as readonly unknown[]).includes(supportType)) {
    return null;
  }

  const pickup = nullableCoordinates(candidate.draftPickup);
  const dropoff = nullableCoordinates(candidate.draftDropoff);
  if (pickup === 0 || dropoff === 0) return null;

  return {
    step: step as DialogStep,
    language: candidate.language,
    draftName,
    draftPhone,
    draftCityId: draftCityId === null ? null : (draftCityId as CityId),
    draftService: service === null ? null : (service as ServiceType),
    draftPickup: pickup,
    draftDropoff: dropoff,
    draftSupportType: supportType === null ? null : (supportType as (typeof SUPPORT_TYPES)[number]),
  };
}

function portFailure(namespace: SessionNamespace, failure: RedisFailure): PortFailureError {
  return new PortFailureError(`redis-session:${namespace}`, `${failure.kind}: ${failure.detail}`);
}

export interface RedisSessionOptions {
  readonly ttlSeconds?: number;
  readonly prefix?: string;
  /** يُستدعى عند كل فشل حتى لا ينقطع Redis بصمت في السجلّ. */
  readonly onFailure?: (failure: RedisFailure & { readonly operation: string }) => void;
}

/**
 * سياسة الفشل مقصودة ومعلَنة: `load` تُعيد خطأ المنفذ لا `null`. الحوار يترجم ذلك
 * إلى حالة ابتدائية (loadState في driver-dialog)، أي أنّ انقطاع Redis يُرجع
 * المستخدم إلى بداية الحوار — وهو أقلّ ضرراً من الادّعاء بأنه بلا جلسة أصلاً بينما
 * الجلسة موجودة وسليمة في Redis، لأن الثاني قد يُعيد تنفيذ خطوةٍ كُتبت فعلاً.
 * و`save` تُعيد الخطأ صريحاً: الحوار الذي لا تُحفظ خطوته لا يجوز أن يُعلن نجاحه.
 */
export function createRedisSessionStore(
  redis: RedisClient,
  namespace: SessionNamespace,
  options: RedisSessionOptions = {},
): SessionStore {
  const ttlSeconds = options.ttlSeconds ?? SESSION_TTL_SECONDS;
  const prefix = options.prefix ?? REDIS_SESSION_PREFIX;
  const keyOf = (telegramUserId: string): string => `${prefix}:${namespace}:${telegramUserId}`;

  const report = (operation: string, failure: RedisFailure): PortFailureError => {
    options.onFailure?.({ ...failure, operation });
    return portFailure(namespace, failure);
  };

  return {
    load: async (telegramUserId): Promise<Result<DialogState | null, PortFailureError>> => {
      const result = await redis.command(["GET", keyOf(telegramUserId)]);
      if (!result.ok) return err(report("load", result.error));
      if (result.value === null || result.value === undefined) return ok(null);
      if (typeof result.value !== "string") {
        return err(report("load", { kind: "malformed", detail: "القيمة ليست نصّاً" }));
      }
      // حالة لا تُفهم تُمحى لا تُترك: تركها يعني تكرار نفس الفشل كل رسالة إلى أن
      // تنتهي مهلتها، ومحوها يُعيد المستخدم إلى بداية نظيفة من الرسالة التالية.
      const state = parseDialogState(result.value);
      if (state === null) {
        options.onFailure?.({
          kind: "malformed",
          detail: "حالة حوار غير صالحة، مُحيت",
          operation: "load",
        });
        await redis.command(["DEL", keyOf(telegramUserId)]);
        return ok(null);
      }
      return ok(state);
    },

    save: async (telegramUserId, state): Promise<Result<void, PortFailureError>> => {
      const result = await redis.command([
        "SET",
        keyOf(telegramUserId),
        JSON.stringify(state),
        "EX",
        ttlSeconds,
      ]);
      if (!result.ok) return err(report("save", result.error));
      return ok(undefined);
    },

    clear: async (telegramUserId): Promise<Result<void, PortFailureError>> => {
      const result = await redis.command(["DEL", keyOf(telegramUserId)]);
      if (!result.ok) return err(report("clear", result.error));
      return ok(undefined);
    },
  };
}
