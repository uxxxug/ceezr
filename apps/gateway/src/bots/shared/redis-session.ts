/**
 * الغرض: مخزن جلسات الحوار على Redis — نفس منفذ SessionStore الذي ينفّذه المخزن
 *   في الذاكرة، بلا تغيير سطر واحد في أي حوار.
 * الحالة: منفّذ فعلياً — القسم 2 البند د.2.
 * ينتمي إلى: apps/gateway/src/bots/shared
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts عند SESSION_STORE=redis
 * ملاحظات مستقبلية: لا دالّة prune هنا عن قصد — انتهاء المهلة مسؤولية Redis نفسه
 *   بـ EX، فمهمّة التنظيف الدورية تتخطّاه كما هو موثّق في cleanup-stale-sessions.ts.
 */

import {
  DIALOG_STEPS,
  type DialogState,
  type DialogStep,
  type SessionStore,
} from "../../../../../packages/application/bots/types.ts";
import { PortFailureError } from "../../../../../packages/application/ports/index.ts";
import type { CityId, ServiceType } from "../../../../../packages/shared/kernel/index.ts";
import { err, ok, type Result } from "../../../../../packages/shared/result/index.ts";
import type { RedisClient, RedisFailure } from "../../redis/upstash.ts";
import { SESSION_TTL_SECONDS } from "./session.ts";
import { attachRevision, readRevision, SessionCasConflictError } from "./session-revision.ts";

/** بادئة مفاتيح المنصّة في Redis، حتى تتعايش مع أي استعمال آخر لنفس القاعدة. */
export const REDIS_SESSION_PREFIX = "waslah:session";

/**
 * فضاء المفتاح لكل بوت. في الذاكرة كان الفصل بوجود خريطتين منفصلتين؛ في Redis
 * القاعدة واحدة، فلو تشارك البوتان بادئةً واحدة لرأى العميل خطوةَ حوارِ سائقٍ
 * لأنّ معرّف تلغرام للشخص نفسه واحد في البوتين.
 */
export type SessionNamespace = "driver" | "rider";

const SUPPORT_TYPES = ["subscription", "ride_dispute"] as const;
const SERVICE_TYPES = ["transport", "delivery"] as const;

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

/**
 * حقلٌ أُضيف بعد أن كُتبت جلساتٌ قائمة في Redis. الغياب يُقرأ null لا رفضاً:
 * رفضُه كان سيُبطل كل جلسة جارية لحظة النشر، فيجد كل سائق ومستخدم نفسه في
 * منتصف حوار قد بدأ من الصفر بلا سبب مفهوم. أمّا القيمة بنوعٍ خاطئ فتُرفض،
 * لأنها ليست جلسةً قديمة بل جلسة مشوّهة.
 */
function addedNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  return nullableString(value);
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
  return coerceDialogState(parsed);
}

/**
 * التحقّقُ نفسه لكن على كائنٍ محلَّل لا على نصّ — ليُعيد استخدامُه عند فكّ المغلف.
 */
export function coerceDialogState(parsed: unknown): DialogState | null {
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

  const vehicleType = addedNullableString(candidate.draftVehicleType);
  const plateNumber = addedNullableString(candidate.draftPlateNumber);
  const nationalId = addedNullableString(candidate.draftNationalId);
  const vehiclePhoto = addedNullableString(candidate.draftVehiclePhotoFileId);
  // البند 2.4: حقلٌ أُضيف بعد نشر جلسات قائمة، فيُعامَل بنفس تسامح سابقيه
  const preferredAreaLabel = addedNullableString(candidate.draftPreferredAreaLabel);
  if (
    vehicleType === undefined ||
    plateNumber === undefined ||
    nationalId === undefined ||
    vehiclePhoto === undefined ||
    preferredAreaLabel === undefined
  ) {
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
    draftVehicleType: vehicleType,
    draftPlateNumber: plateNumber,
    draftNationalId: nationalId,
    draftVehiclePhotoFileId: vehiclePhoto,
    draftPreferredAreaLabel: preferredAreaLabel,
  };
}

/**
 * مغلفُ الجلسةِ على Redis: `{ revision, state }`. المراجعةُ تُمكِّن CAS فلا
 * يكتبُ تحديثٌ فوقَ حالةٍ أحدث (BUG-007). والجلساتُ القديمةُ التي كُتبت قبلَ
 * المغلفِ نصٌّ خامٌ لحالةِ حوارٍ بلا `revision`، فتُقرأ مراجعتُها 0 — هجرةٌ
 * صامتةٌ لا إلغاءُ جلسةٍ جارية.
 */
interface SessionEnvelope {
  readonly state: DialogState;
  readonly revision: number;
}

export function parseSessionEnvelope(raw: string): SessionEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  // مغلفٌ جديد: { revision: رقم, state: كائن }
  if (
    typeof candidate.revision === "number" &&
    Number.isFinite(candidate.revision) &&
    typeof candidate.state === "object" &&
    candidate.state !== null
  ) {
    const state = coerceDialogState(candidate.state);
    if (state === null) return null;
    return { state, revision: candidate.revision };
  }
  // إرثٌ: نصٌّ خامٌّ لحالةِ حوارٍ كُتب قبلَ المغلف — مراجعتُها 0.
  const legacy = coerceDialogState(parsed);
  if (legacy === null) return null;
  return { state: legacy, revision: 0 };
}

/**
 * سكربتُ CAS الذرّيُّ على Redis: يقرأُ المغلفَ الحاليَّ ويُقارنُ مراجعتَه بالمراجعةِ
 * المتوقَّعة، فإن طابقت كتبَ المغلفَ بمراجعةٍ أعلى، وإن لم تطابق ردَّ 0 (تعارض).
 * ذرّيٌّ لأنّه أمرٌ واحدٌ (EVAL): لا نافذةُ زمنٍ بين القراءةِ والكتابة يكتبُ فيها
 * متزامنٌ آخرُ فوقَ حالتنا. الجلساتُ الإرثُ تُعامَل مراجعتَها 0 فأوّلُ كتابةٍ بعدَ
 * الترقية تنجحُ وتُغلِّفُها.
 */
const LUA_SESSION_CAS = `
local key = KEYS[1]
local newState = ARGV[1]
local expected = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local current = redis.call('GET', key)
local currentRevision = 0
if current then
  local ok, parsed = pcall(cjson.decode, current)
  if ok and type(parsed) == 'table' and type(parsed.revision) == 'number' and type(parsed.state) == 'table' then
    currentRevision = parsed.revision
  end
end
if currentRevision ~= expected then
  return 0
end
local newRevision = expected + 1
local envelope = cjson.encode({ revision = newRevision, state = cjson.decode(newState) })
redis.call('SET', key, envelope, 'EX', ttl)
return newRevision
`;

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
      // حالةٌ لا تُفهم تُمحى لا تُترك: تركها يعني تكرار نفس الفشل كل رسالة إلى أن
      // تنتهي مهلتها، ومحوها يُعيد المستخدم إلى بداية نظيفة من الرسالة التالية.
      const envelope = parseSessionEnvelope(result.value);
      if (envelope === null) {
        options.onFailure?.({
          kind: "malformed",
          detail: "حالة حوار غير صالحة، مُحيت",
          operation: "load",
        });
        await redis.command(["DEL", keyOf(telegramUserId)]);
        return ok(null);
      }
      // المراجعةُ تُرفق كرمزٍ على الحالة فيحملها الحوار إلى `save` عبر الانتشار،
      // فيُقارنها CAS دون أن يعلم الحوارُ بوجودها.
      return ok(attachRevision(envelope.state, envelope.revision));
    },

    save: async (telegramUserId, state): Promise<Result<void, PortFailureError>> => {
      // CAS الذرّيُّ عبر Lua: لا يكتب إلا إن طابقت مراجعةُ الحالة المُمرَّرة مراجعةَ
      // آخرِ تحميل. JSON.stringify يُسقط الرمزَ فلا تُخزَّن المراجعةُ في الحالة.
      const expected = readRevision(state);
      const stateJson = JSON.stringify(state);
      const result = await redis.command([
        "EVAL",
        LUA_SESSION_CAS,
        1,
        keyOf(telegramUserId),
        stateJson,
        String(expected),
        String(ttlSeconds),
      ]);
      if (!result.ok) return err(report("save", result.error));
      const returned = result.value;
      const newRevision = typeof returned === "number" ? returned : Number(returned);
      // ردُّ السكربتِ 0 يعني تعارضاً: كتبَ متزامنٌ آخرُ بعدَ تحميلِ هذه الحالة.
      // ارمِ الإشارةَ لا تُعيدُ خطأً صامتاً، فيُعيدُ المحوّلُ تحميلَ الحالة وإعادةَ
      // حسابِ الردود قبلَ إرسالِ أيِّ رسالة.
      if (!Number.isFinite(newRevision) || newRevision === 0) {
        throw new SessionCasConflictError(telegramUserId, expected);
      }
      attachRevision(state, newRevision);
      return ok(undefined);
    },

    clear: async (telegramUserId): Promise<Result<void, PortFailureError>> => {
      const result = await redis.command(["DEL", keyOf(telegramUserId)]);
      if (!result.ok) return err(report("clear", result.error));
      return ok(undefined);
    },
  };
}
