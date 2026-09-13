/**
 * الغرض: محوّلاتُ رموز التتبّع — تفويضٌ كامل للدوالّ الذرّية في القاعدة، وتوليدُ
 *   الرمز بـ`crypto.randomBytes(32)`.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.2 من أمر الإطلاق التجاري).
 * ينتمي إلى: infrastructure/tracking
 * يُتوقع أن يستخدمه: apps/gateway/src/container.ts، apps/workers/src/container.ts.
 *
 * ## لا منطقَ هنا
 *
 * ولا شرطَ ملكيةٍ ولا حسابَ انقضاءٍ ولا مقارنةَ وقت: كلُّه في `issue_tracking_token`
 * و`revoke_tracking_token` و`get_tracking_position` و`expire_tracking_tokens`.
 * وما في هذا الملفّ ترجمةُ أسماءٍ وأنواع (snake_case → camelCase، نصّ → `Date`)
 * وتغليفُ العطل التقنيّ في `Result` — لا قرارَ واحد.
 *
 * ## `randomBytes` لا `randomUUID`
 *
 * الـUUID مئةٌ واثنان وعشرون بتاً عشوائيةً في أفضل حال، وشكلُه معروفٌ فيُخمَّن
 * فضاؤه. و٣٢ بايتاً (٢٥٦ بتاً) بترميز hex لا يُخمَّن عملياً — وهو ما يجعل الرمزَ
 * وحدَه كافياً لفتح صفحةٍ بلا تسجيل دخول.
 */

import { randomBytes } from "node:crypto";
import { PortFailureError } from "../../application/ports/index.ts";
import type {
  IssueTokenOutcome,
  IssueTokenRejection,
  TrackingReadState,
  TrackingTokenMintPort,
  TrackingTokenRpcPort,
} from "../../application/tracking/tracking-token-ports.ts";
import type { CityId, OrderId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

/** ٣٢ بايتاً = ٦٤ محرفاً hex — والقاعدة ترفض أقصر منها. */
const TOKEN_BYTES = 32;

/** أسبابُ الرفض التي تُسمّيها `issue_tracking_token` وحدها. */
const ISSUE_REJECTIONS: readonly IssueTokenRejection[] = [
  "UNAUTHORIZED",
  "ORDER_NOT_FOUND",
  "ORDER_NOT_ACTIVE",
  "TOKEN_COLLISION",
  "TOKEN_TOO_SHORT",
];

function toRejection(raw: unknown): IssueTokenRejection {
  const value = typeof raw === "string" ? raw : "";
  const known = ISSUE_REJECTIONS.find((candidate) => candidate === value);
  // سببٌ لا نعرفه يُعامل `UNAUTHORIZED`: الأضيقُ في الأثر (لا يُصدَر رمز) ولا
  // يُوسَّع النوعُ بسلسلةٍ حرّة تُسرّب نصَّ خطأٍ داخليّ إلى طبقة الحوار.
  return known ?? "UNAUTHORIZED";
}

function toDate(raw: unknown): Date | null {
  if (raw instanceof Date) return raw;
  if (typeof raw === "string" || typeof raw === "number") {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toFinite(raw: unknown): number | null {
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** مُولّدُ الرمز الحقيقيّ الوحيد في المستودع. */
export function createTrackingTokenMint(): TrackingTokenMintPort {
  return { mint: () => randomBytes(TOKEN_BYTES).toString("hex") };
}

export function createTrackingTokenRpc(sql: Sql): TrackingTokenRpcPort {
  return {
    async issue(
      orderId: OrderId,
      telegramId: number,
      token: string,
    ): Promise<Result<IssueTokenOutcome, PortFailureError>> {
      const result = await guard("trackingTokens.issue", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select issue_tracking_token(${orderId}::uuid, ${telegramId}::bigint, ${token}) as result
        `;
        return rows[0]?.result ?? null;
      });
      if (!result.ok) return err(result.error);

      const envelope = readEnvelope(result.value);
      if (envelope === null) {
        return err(
          new PortFailureError("trackingTokens.issue", "ردٌّ غير مفهوم من issue_tracking_token"),
        );
      }
      if (!envelope.ok) {
        return ok({ ok: false, rejection: toRejection(envelope.error) });
      }

      const raw = envelope as unknown as Record<string, unknown>;
      const expiresAt = toDate(raw.expires_at);
      const cityId = typeof raw.city_id === "string" ? (raw.city_id as CityId) : null;
      const issued = typeof raw.token === "string" ? raw.token : null;
      if (expiresAt === null || cityId === null || issued === null) {
        // نجاحٌ بلا حقولِه ليس نجاحاً: يُعاد عطلاً لا يُبنى عليه رابطٌ ناقص.
        return err(
          new PortFailureError("trackingTokens.issue", "إصدارٌ ناجح بلا token/city_id/expires_at"),
        );
      }
      return ok({ ok: true, row: { token: issued, cityId, expiresAt } });
    },

    async revoke(token: string, telegramId: number): Promise<Result<boolean, PortFailureError>> {
      const result = await guard("trackingTokens.revoke", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select revoke_tracking_token(${token}, ${telegramId}::bigint) as result
        `;
        return rows[0]?.result ?? null;
      });
      if (!result.ok) return err(result.error);
      const envelope = readEnvelope(result.value);
      if (envelope === null) {
        return err(
          new PortFailureError("trackingTokens.revoke", "ردٌّ غير مفهوم من revoke_tracking_token"),
        );
      }
      return ok(envelope.ok);
    },

    async read(token: string): Promise<Result<TrackingReadState, PortFailureError>> {
      const result = await guard("trackingTokens.read", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select get_tracking_position(${token}) as result
        `;
        return rows[0]?.result ?? null;
      });
      if (!result.ok) return err(result.error);

      const envelope = readEnvelope(result.value);
      if (envelope === null) {
        return err(
          new PortFailureError("trackingTokens.read", "ردٌّ غير مفهوم من get_tracking_position"),
        );
      }
      if (!envelope.ok) return ok({ kind: "invalid" });

      const raw = envelope as unknown as Record<string, unknown>;
      const active = raw.active === true;
      const position = raw.position;
      if (typeof position !== "object" || position === null || Array.isArray(position)) {
        // الحمولةُ تغيّرَت في `F2-09`: غيابُ `position` عقدٌ مكسورٌ يُعلَنُ
        // عطلاً — ولا يُطوى «لا موقعَ» فتُقرأَ هجرةٌ ناقصةٌ حالةً طبيعيّةً.
        return err(
          new PortFailureError("trackingTokens.read", "ردٌّ بلا position من get_tracking_position"),
        );
      }
      const cell = position as Record<string, unknown>;
      const verdict = typeof cell.verdict === "string" ? cell.verdict : "";
      const ageSeconds = toFinite(cell.age_seconds);

      if (verdict === "NEVER_REPORTED" || verdict === "NO_TIMESTAMP") {
        return ok({ kind: "awaiting", active, reason: verdict, ageSeconds });
      }
      if (verdict === "TOO_OLD") {
        return ok({ kind: "awaiting", active, reason: "TOO_OLD", ageSeconds });
      }
      if (verdict !== "LOCATED") {
        return err(new PortFailureError("trackingTokens.read", `حكمٌ مجهولٌ من القاعدةِ: ${verdict}`));
      }

      const lat = toFinite(cell.lat);
      const lng = toFinite(cell.lng);
      if (lat === null || lng === null || ageSeconds === null) {
        // حكمٌ `LOCATED` بلا إحداثيّةٍ عقدٌ مكسورٌ لا «موقعٌ مبتورٌ»: لو قُرئَ
        // انتظاراً لَصارَ خللُ القاعدةِ غيرَ مرئيٍّ في أيِّ مقياسٍ.
        return err(new PortFailureError("trackingTokens.read", "LOCATED بلا lat/lng/age_seconds"));
      }
      return ok({ kind: "located", active, position: { lat, lng, ageSeconds } });
    },

    async revokeForOrder(
      orderId: OrderId,
      telegramId: number,
    ): Promise<Result<number, PortFailureError>> {
      const result = await guard("trackingTokens.revokeForOrder", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select revoke_order_tracking_tokens(${orderId}::uuid, ${telegramId}::bigint) as result
        `;
        return rows[0]?.result ?? null;
      });
      if (!result.ok) return err(result.error);
      const envelope = readEnvelope(result.value);
      if (envelope === null || !envelope.ok) {
        return err(
          new PortFailureError(
            "trackingTokens.revokeForOrder",
            "ردٌّ غير مفهوم من revoke_order_tracking_tokens",
          ),
        );
      }
      const raw = envelope as unknown as Record<string, unknown>;
      return ok(toFinite(raw.revoked) ?? 0);
    },

    async expireEnded(cityId: CityId, limit: number): Promise<Result<number, PortFailureError>> {
      const result = await guard("trackingTokens.expireEnded", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select expire_tracking_tokens(${cityId}::uuid, ${limit}::integer) as result
        `;
        return rows[0]?.result ?? null;
      });
      if (!result.ok) return err(result.error);
      const envelope = readEnvelope(result.value);
      if (envelope === null || !envelope.ok) {
        return err(
          new PortFailureError(
            "trackingTokens.expireEnded",
            "ردٌّ غير مفهوم من expire_tracking_tokens",
          ),
        );
      }
      const raw = envelope as unknown as Record<string, unknown>;
      return ok(toFinite(raw.pulled) ?? 0);
    },
  };
}
