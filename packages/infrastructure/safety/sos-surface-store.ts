/**
 * الغرض: محوّلُ قراءةِ حالِ سطحِ الاستغاثةِ على PostgreSQL — نداءُ
 *   `sos_surface_state` واحدٌ، وقراءةُ حمولتِه **بلا افتراضٍ** (`F2-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`.
 * ينتمي إلى: infrastructure/safety
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ — الدورُ مُعامِلٌ لا فرعٌ ههنا أيضاً.
 * الحاكم: docs/adr/0111-sos-surface-is-a-judged-card-not-a-button.md
 *
 * ## لماذا حمولةٌ لا تُفهَمُ **تُعلَنُ عطباً** ولا تُقرأُ «لا سطحَ»
 *
 * أسهلُ ما في قراءةِ `jsonb` أن يُقالَ «إن نقصَ حقلٌ فليكنْ `null`». وههنا هذا
 * **إخفاءُ زرِّ استغاثةٍ بصمتٍ**: حكمٌ لا يُفهَمُ يُقرأُ «غيرُ جائزٍ»، فتختفي
 * البطاقةُ من شاشةِ راكبٍ في رحلةٍ جاريةٍ ولا يظهرُ لذلكَ أثرٌ في أيِّ لوحةٍ.
 * فالعقدُ صارمٌ: أصلٌ معروفٌ وسببٌ معروفٌ ورموزُ إفصاحٍ من المجالِ المغلقِ،
 * وإلّا `STORE_ERROR` يُقرأُ عطلاً — والعطلُ يُرى، والصمتُ لا يُرى.
 *
 * ## ولماذا قائمةُ إفصاحٍ فارغةٌ **عطبٌ** لا حالةٌ
 *
 * لأنَّ `SOS_NO_PHONE_CALL` تُنشَرُ في كلِّ الأحوالِ من القاعدةِ. فقائمةٌ فارغةٌ
 * تعني حمولةً من دالّةٍ أخرى أو من نسخةٍ أقدمَ، وعرضُ بطاقةِ استغاثةٍ بلا سطرِ
 * إفصاحٍ واحدٍ **وعدُ خصوصيّةٍ مكسورٌ** في أخطرِ سطحٍ في التطبيقِ.
 */

import type {
  SosStoreFailure,
  SosSurfaceReader,
  SosSurfaceVerdict,
} from "../../application/safety/sos-surface-ports.ts";
import {
  isSosBlockReason,
  isSosDisclosureCode,
  isSosIncidentStatus,
  isSosOrigin,
  isSosTeamDeliveryStatus,
  isSosWindowSource,
  type SosDisclosureCode,
  type SosIncidentState,
  type SosSurfaceState,
} from "../../domain/safety/sos-surface.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

function failed(reason: SosStoreFailure["reason"]): SosStoreFailure {
  return { reason };
}

/** كما في `ride-share-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readCount(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/** بلاغٌ ناقصُ الحقولِ **يُسقِطُ القراءةَ** ولا يُقرأُ «لا بلاغَ». */
function readIncident(value: unknown): SosIncidentState | null | "BROKEN" {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return "BROKEN";
  const incidentId = readText(value.id);
  const status = value.status;
  // `PD-020` — «استُقبِلَ» قبلَ «اطّلعَ»: حالُ التسليمِ حقلٌ لازمٌ في العقدِ،
  // فغيابُهُ حمولةٌ من دالّةٍ أقدمَ لا بلاغٌ بلا تسليمٍ — يُسقِطُ القراءةَ.
  const teamDeliveryStatus = value.team_delivery_status;
  const ageSeconds = readCount(value.age_seconds);
  if (
    incidentId === null ||
    !isSosIncidentStatus(status) ||
    !isSosTeamDeliveryStatus(teamDeliveryStatus) ||
    ageSeconds === null
  ) {
    return "BROKEN";
  }
  return { incidentId, status, teamDeliveryStatus, ageSeconds };
}

/** رمزُ إفصاحٍ خارجَ المجالِ المغلقِ **يُسقِطُ القراءةَ** ولا يُحذَفُ بصمتٍ. */
function readDisclosure(value: unknown): readonly SosDisclosureCode[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const codes: SosDisclosureCode[] = [];
  for (const entry of value) {
    if (!isSosDisclosureCode(entry)) return null;
    codes.push(entry);
  }
  return codes;
}

interface SurfaceRow {
  readonly result: Record<string, unknown> | null;
}

export function createSosSurfaceReader(sql: Sql): SosSurfaceReader {
  return {
    read: async (input): Promise<Result<SosSurfaceVerdict, SosStoreFailure>> => {
      const telegramId = asTelegramId(input.telegramUserId);
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: SurfaceRow[];
      try {
        rows = await sql.unsafe<SurfaceRow[]>("select sos_surface_state($1, $2) as result", [
          telegramId,
          input.role,
        ]);
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === null || result === undefined) return err(failed("STORE_ERROR"));

      if (result.ok !== true) {
        const code = result.error;
        if (code === "INVALID_REPORTER_ROLE") return ok({ found: false, refusal: "INVALID_ROLE" });
        if (code === "ACTOR_NOT_FOUND") return ok({ found: false, refusal: "ACCOUNT_NOT_FOUND" });
        if (code === "ACTOR_BLOCKED") return ok({ found: false, refusal: "ACCOUNT_BLOCKED" });
        return err(failed("STORE_ERROR"));
      }

      const incident = readIncident(result.incident);
      const disclosure = readDisclosure(result.disclosure);
      if (incident === "BROKEN" || disclosure === null) return err(failed("STORE_ERROR"));

      if (result.eligible !== true) {
        const reason = result.reason;
        if (!isSosBlockReason(reason)) return err(failed("STORE_ERROR"));
        const state: SosSurfaceState = { eligible: false, reason, incident, disclosure };
        return ok({ found: true, state });
      }

      const orderId = readText(result.order_id);
      const origin = result.origin;
      if (!isSosOrigin(origin)) return err(failed("STORE_ERROR"));

      /**
       * `F12-03` — بلاغٌ بلا رحلةٍ: **الطلبُ `null` ونافذةُ ما بعدَ الرحلةِ غائبةٌ
       * كلتاهُما شرطٌ لا صدفةٌ**. فلو وصلَ `orderId` معَ `NO_ORDER`، أو وصلَ رقمُ
       * نافذةٍ لحالٍ لا نافذةَ فيها، فذاكَ افتراقُ حَكَمٍ عن نطاقٍ — عطبُ عقدٍ
       * يُرمى، لا حقلٌ يُطوى بصمتٍ.
       */
      if (origin === "NO_ORDER") {
        if (
          orderId !== null ||
          result.post_ride_window_minutes !== null ||
          result.post_ride_window_source !== null
        ) {
          return err(failed("STORE_ERROR"));
        }
        const state: SosSurfaceState = {
          eligible: true,
          origin,
          orderId: null,
          incident,
          disclosure,
        };
        return ok({ found: true, state });
      }

      const minutes = readCount(result.post_ride_window_minutes);
      const source = result.post_ride_window_source;
      if (orderId === null || minutes === null || !isSosWindowSource(source)) {
        return err(failed("STORE_ERROR"));
      }

      const state: SosSurfaceState = {
        eligible: true,
        origin,
        orderId,
        postRideWindowMinutes: minutes,
        postRideWindowSource: source,
        incident,
        disclosure,
      };
      return ok({ found: true, state });
    },
  };
}
