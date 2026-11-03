/**
 * الغرض: `WR-39` — منفذُ القاعدةِ لدالتَي المحوِ الفوريِّ لملفّاتِ المحادثةِ
 *   (`claim_order_chat_media_purge` · `complete_order_chat_media_purge` من هجرةِ
 *   `20261104100000`). يُبنى منهُ — معَ حذفِ المخزنِ — منفذُ `mediaPurge`
 *   الذي تناديَهُ طبقةُ التطبيقِ بعدَ إتمامِ محوِ الحسابِ.
 * الحالة: منفَّذٌ فعليًّا — `WR-39`.
 * ينتمي إلى: packages/infrastructure/privacy
 * يُستخدم من: `apps/gateway/src/index.ts`
 */

import type { ErasureChatMediaPurgeItem } from "../../application/privacy/erasure-media-purge.ts";
import type { Sql } from "../db/client.ts";

/** منفذُ القاعدةِ: الالتقاطُ والإتمامُ — العزلُ شرطٌ في الدالتَينِ أنفسِهما. */
export function createErasureChatMediaPurgeSqlStore(sql: Sql): {
  claim: (userId: string, limit: number) => Promise<readonly ErasureChatMediaPurgeItem[]>;
  complete: (userId: string, ids: readonly string[]) => Promise<void>;
} {
  return {
    claim: async (userId, limit) => {
      const rows = await sql.unsafe<{ result: unknown }[]>(
        "select claim_order_chat_media_purge($1::uuid, $2::integer) as result",
        [userId, limit],
      );
      const raw = rows[0]?.result;
      if (!Array.isArray(raw)) return [];
      const items: ErasureChatMediaPurgeItem[] = [];
      for (const entry of raw) {
        if (typeof entry !== "object" || entry === null) continue;
        const { id, object_path: objectPath } = entry as Record<string, unknown>;
        if (typeof id !== "string" || typeof objectPath !== "string") continue;
        items.push({ id, objectPath });
      }
      return items;
    },
    complete: async (userId, ids) => {
      await sql.unsafe("select complete_order_chat_media_purge($1::uuid[], $2::uuid) as result", [
        ids as never,
        userId,
      ]);
    },
  };
}
