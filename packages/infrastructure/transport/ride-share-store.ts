/**
 * الغرض: محوّلُ قراءةِ حالِ مشاركةِ الرحلةِ على PostgreSQL — نداءُ
 *   `rider_ride_share_state` واحدٌ، وقراءةُ حمولتِه **بلا افتراضٍ** (`F2-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`. حكمُ CI **غيرُ مقروءٍ** (`B-CI-001`).
 * ينتمي إلى: infrastructure/transport
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` إن عرضَ الروابطَ الساريةَ في شاشةِ الطوارئِ.
 *
 * ## لماذا حمولةٌ لا تُفهَمُ **تُعلَنُ عطباً** ولا تُقرأُ «لا موقعَ»
 *
 * أسهلُ ما في قراءةِ `jsonb` أن يُقالَ «إن نقصَ حقلٌ فليكنْ `null`». وهذا ههنا
 * **خطرٌ مُسمّىً**: حكمٌ لا يُفهَمُ يُقرأُ «لا نقطةَ»، فتقولُ المعاينةُ للمالكِ
 * «لا يرى شيئاً» بينما الصفحةُ العامّةُ تعرضُ نقطةً. فالعقدُ صارمٌ: تصنيفٌ
 * معروفٌ وحدٌّ ومصدرُ حدٍّ، وإلّا `STORE_ERROR` يُقرأُ عطلاً في المراقبةِ.
 *
 * ## ولماذا الإحداثيّةُ تُشترَطُ معَ `LOCATED` وحدَه
 *
 * القاعدةُ **لا تُخرِجُها** إلّا معَه. فحمولةٌ حكمُها `LOCATED` بلا إحداثيّةٍ
 * عقدٌ مكسورٌ، وحمولةٌ حكمُها `TOO_OLD` **ومعها** إحداثيّةٌ تسريبٌ — وكلاهُما
 * يُرفَضُ ههنا صراحةً لا يُطوى.
 */

import type { RideStoreFailure } from "../../application/transport/ride-request-ports.ts";
import type {
  RideShareReader,
  RideShareVerdict,
} from "../../application/transport/ride-share-ports.ts";
import {
  isPositionMaxAgeSource,
  isSharedPositionVerdict,
  isSharingNow,
  longestRemainingSeconds,
  type RideShareState,
  type ShareLink,
  type SharePreview,
  shareAvailabilityOf,
} from "../../domain/transport/ride-share.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

function failed(reason: RideStoreFailure["reason"]): RideStoreFailure {
  return { reason };
}

/** كما في `active-ride-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readCount(value: unknown): number | null {
  const parsed = readNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function readInstantMs(value: unknown): number | null {
  const text = readText(value);
  if (text === null) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** رابطٌ ناقصٌ **يُسقِطُ القراءةَ كلَّها** ولا يُحذَفُ بصمتٍ من القائمةِ. */
function readLink(value: unknown): ShareLink | null {
  if (!isRecord(value)) return null;
  const id = readText(value.id);
  const createdAtMs = readInstantMs(value.created_at);
  const secondsRemaining = readCount(value.seconds_remaining);
  if (id === null || createdAtMs === null || secondsRemaining === null) return null;
  return { id, createdAtMs, secondsRemaining };
}

function readLinks(value: unknown): readonly ShareLink[] | null {
  if (!Array.isArray(value)) return null;
  const links: ShareLink[] = [];
  for (const entry of value) {
    const link = readLink(entry);
    if (link === null) return null;
    links.push(link);
  }
  return links;
}

function readPreview(value: unknown): SharePreview | null {
  if (!isRecord(value)) return null;
  const active = value.active === true;
  const position = value.position;
  if (!isRecord(position)) return null;

  const verdict = position.verdict;
  if (!isSharedPositionVerdict(verdict)) return null;

  const maxAgeSeconds = readCount(position.max_age_seconds);
  const maxAgeSource = position.max_age_source;
  if (maxAgeSeconds === null || !isPositionMaxAgeSource(maxAgeSource)) return null;

  const ageSeconds = position.age_seconds === null ? null : readCount(position.age_seconds);
  const hasLat = position.lat !== undefined;
  const hasLng = position.lng !== undefined;

  if (verdict === "LOCATED") {
    const lat = readNumber(position.lat);
    const lng = readNumber(position.lng);
    // `LOCATED` بلا إحداثيّةٍ أو بلا عُمرٍ **عقدٌ مكسورٌ**، لا حالةٌ تُطوى.
    if (lat === null || lng === null || ageSeconds === null) return null;
    return {
      verdict,
      active,
      position: { lat, lng, ageSeconds },
      maxAgeSeconds,
      maxAgeSource,
    };
  }

  // حُجِبَ الحكمُ ومعَ ذلكَ وصلَت إحداثيّةٌ: **تسريبٌ**، ويُعلَنُ عطباً ولا
  // يُصحَّحُ ههنا بحذفِها — إخفاءُ التسريبِ في المحوّلِ يجعلُه غيرَ مرئيٍّ أبداً.
  if (hasLat || hasLng) return null;

  return { verdict, active, ageSeconds, maxAgeSeconds, maxAgeSource };
}

interface ShareRow {
  readonly result: Record<string, unknown> | null;
}

export function createRideShareReader(sql: Sql): RideShareReader {
  return {
    read: async (input): Promise<Result<RideShareVerdict, RideStoreFailure>> => {
      const telegramId = asTelegramId(input.telegramUserId);
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: ShareRow[];
      try {
        rows = await sql.unsafe<ShareRow[]>("select rider_ride_share_state($1, $2) as result", [
          telegramId,
          input.orderId,
        ]);
      } catch {
        // معرّفٌ ليسَ `uuid` يُسقِطُ التحويلَ قبلَ جسمِ الدالّةِ — يُعلَنُ عطباً.
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === null || result === undefined) return err(failed("STORE_ERROR"));

      if (result.ok !== true) {
        const code = result.error;
        if (code === "INVALID_INPUT") return ok({ found: false, refusal: "INVALID_ORDER_ID" });
        if (code === "ORDER_NOT_FOUND") return ok({ found: false, refusal: "ORDER_NOT_FOUND" });
        return err(failed("STORE_ERROR"));
      }

      const orderId = readText(result.order_id);
      const links = readLinks(result.links);
      const preview = readPreview(result.preview);
      if (orderId === null || links === null || preview === null) {
        return err(failed("STORE_ERROR"));
      }

      const state: RideShareState = {
        orderId,
        availability: shareAvailabilityOf(result.can_share === true),
        links,
        sharingNow: isSharingNow(links),
        longestRemainingSeconds: longestRemainingSeconds(links),
        // إعدادٌ غائبٌ يُنشَرُ غائباً: **لا رقمَ يُخترَعُ** ليُعرَضَ وعداً.
        maxLifetimeMinutes:
          result.max_lifetime_minutes === null ? null : readCount(result.max_lifetime_minutes),
        graceMinutes: result.grace_minutes === null ? null : readCount(result.grace_minutes),
        preview,
      };
      return ok({ found: true, state });
    },
  };
}
