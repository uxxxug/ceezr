/**
 * الغرض: تسجيلُ جزءِ `account` من القاموسِ العربيِّ — تستوردُه الوحداتُ المستعمِلةُ لمفاتيحِه (`F1-09` · `D-33` · `ADR 0188`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: shared/i18n/miniapp/ar-parts
 *
 * في Bun يُستورَدُ `ar.json` كاملاً فالتسجيلُ لا يُغيِّرُ شيئاً؛ وفي بناءِ التطبيقِ المصغَّرِ يُحلِّلُه ملحقُ
 * `apps/miniapp/vite/arabic-partitions.ts` إلى مفاتيحِ `account` وحدَها (قاعدتُها `../partitions.ts`).
 */

import ar from "../ar.json" with { type: "json" };
import { extendDefaultMiniAppDictionary } from "../core.ts";

extendDefaultMiniAppDictionary(ar as Record<string, string>);
