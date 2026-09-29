/**
 * الغرض: قراءةُ هدفِ الهبوطِ (`?open=<target>`) من عنوانِ صفحةِ التطبيقِ — مرّةً عند الإقلاعِ —
 *   وتسليمُه نصّاً خاماً إلى السطحِ الذي يفكُّه بجمهورِه (`ADR 0213`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/routing
 * يُتوقع أن يستخدمه لاحقاً: RoleRouter · surfaces/{rider,driver}
 *
 * **الهدفُ ملاحةٌ لا هويّةٌ ولا صلاحيّةٌ** (`packages/shared/miniapp-link`): لذلك يُقرأُ من العنوانِ
 * لا من بياناتِ تيليجرامَ غيرِ الموقَّعةِ — فتلك ممنوعةٌ خارجَ طبقةِ `tg/` لأنّها تُغري باستعمالِها
 * هويّةً (`tg/index.ts`). والشاشةُ التي يُهبَطُ عليها تسألُ الخادمَ بجلستِها، فعرضٌ ليس لصاحبِ الجلسةِ
 * يُرَدُّ كما يُرَدُّ لو فُتِحَ من القائمةِ.
 */

import { MINIAPP_TARGET_PARAM } from "../../../../packages/shared/miniapp-link/index.ts";

/** النصُّ الخامُ لمعاملِ `open` — أو `null`. الفكُّ عند السطحِ لأنّه وحدَه يعرفُ جمهورَه. */
export function readEntryTarget(search: string | undefined): string | null {
  if (typeof search !== "string" || search.length === 0) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get(MINIAPP_TARGET_PARAM);
  return raw === null || raw.length === 0 ? null : raw;
}

/** من عنوانِ الصفحةِ الحاليّةِ — وفي بيئةٍ بلا `window` (الاختبارُ والبناءُ) لا هدفَ. */
export function currentEntryTarget(): string | null {
  if (typeof window === "undefined") return null;
  return readEntryTarget(window.location?.search);
}
