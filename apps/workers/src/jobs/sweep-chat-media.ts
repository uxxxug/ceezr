/**
 * الغرض: `WR-34` (ADR 0305) — مكنسةُ ملفّاتِ محادثةِ الطلب: تحذفُ من الدلوِ الخاصِّ
 *   (`order-chat-media`) ما لا يجوزُ بقاؤه، ثمَّ تُتِمُّ السجلَّ في القاعدة:
 *   - `orphan_pending`: حجزٌ معلَّقٌ أقدمُ من 15 دقيقة (رفعٌ أو إنشاءُ رسالةٍ فشلَ).
 *   - `message_gone`: ملفٌّ حُذفَت رسالتُه (محوُ حساب).
 *   - `retention`: انتهت نافذةُ قراءةِ المحادثة (7 أيّامٍ بعدَ انتهاءِ الطلب) أو 30 يوماً.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/workers/src/jobs
 * يُستخدم من: `apps/workers/src/container.ts` (مهمّةٌ عامّةٌ، تُسجَّلُ حينَ يُهيَّأُ المخزن).
 *
 * الترتيبُ «احذف الملفَّ ثمَّ السجلّ»: إن سقطَ العاملُ بينهما أعادَ الشوطُ التالي الالتقاطَ،
 * والحذفُ متكرّرٌ بلا ضرر. ولا يُسجَّلُ مسارٌ ولا رابط — أعدادٌ فقط.
 */

import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import { err, ok, type Result } from "../../../../packages/shared/result/index.ts";

export interface ChatMediaSweepItem {
  readonly id: string;
  readonly objectPath: string;
  readonly reason: "orphan_pending" | "message_gone" | "retention";
}

export interface ChatMediaSweepDeps {
  claim(limit: number): Promise<readonly ChatMediaSweepItem[]>;
  complete(ids: readonly string[]): Promise<void>;
  remove(objectPaths: readonly string[]): Promise<Result<void, string>>;
}

export interface ChatMediaSweepReport {
  readonly claimed: number;
  readonly removed: number;
  readonly byReason: Readonly<Record<ChatMediaSweepItem["reason"], number>>;
}

export const CHAT_MEDIA_SWEEP_BATCH = 100;

export async function sweepChatMedia(
  deps: ChatMediaSweepDeps,
): Promise<Result<ChatMediaSweepReport, string>> {
  const items = await deps.claim(CHAT_MEDIA_SWEEP_BATCH);
  const byReason = { orphan_pending: 0, message_gone: 0, retention: 0 };
  for (const item of items) byReason[item.reason] += 1;
  if (items.length === 0) return ok({ claimed: 0, removed: 0, byReason });

  const removed = await deps.remove(items.map((item) => item.objectPath));
  // فشلُ الحذفِ لا يُتِمُّ السجلّ: الشوطُ التالي يعيدُ المحاولةَ على الصفوفِ نفسِها.
  if (!removed.ok) return err(removed.error);
  await deps.complete(items.map((item) => item.id));
  return ok({ claimed: items.length, removed: items.length, byReason });
}

const REASONS = new Set(["orphan_pending", "message_gone", "retention"]);

/** منفذُ القاعدةِ لدالّتَي `20261103150000` (`claim_…`/`complete_…`). */
export function createChatMediaSweepStore(
  sql: Sql,
): Pick<ChatMediaSweepDeps, "claim" | "complete"> {
  return {
    claim: async (limit) => {
      const rows = await sql.unsafe<{ result: unknown }[]>(
        "select claim_order_chat_media_sweep($1::integer) as result",
        [limit],
      );
      const raw = rows[0]?.result;
      if (!Array.isArray(raw)) return [];
      const items: ChatMediaSweepItem[] = [];
      for (const entry of raw) {
        if (typeof entry !== "object" || entry === null) continue;
        const { id, object_path: objectPath, reason } = entry as Record<string, unknown>;
        if (
          typeof id !== "string" ||
          typeof objectPath !== "string" ||
          typeof reason !== "string"
        ) {
          continue;
        }
        if (!REASONS.has(reason)) continue;
        items.push({ id, objectPath, reason: reason as ChatMediaSweepItem["reason"] });
      }
      return items;
    },
    complete: async (ids) => {
      await sql.unsafe("select complete_order_chat_media_sweep($1::uuid[]) as result", [
        ids as never,
      ]);
    },
  };
}
