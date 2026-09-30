/**
 * الغرض: بطاقةُ السمعةِ المشتركةُ بينَ البوتَينِ لأمرِ `/rating` — ملخّصٌ كسائقٍ
 *   وزبونٍ معَ آخرِ التقييماتِ المستلمةِ. مشتركةٌ لأنَّ العرضَ واحدٌ في الاتجاهين،
 *   وتكرارُهُ في حوارَينِ يعني تباعُدَهُما بعدَ أوّلِ تعديلٍ.
 * الحالة: منفّذ فعلياً — `F16-01` (`DEC-24` · `ADR 0218`).
 * ينتمي إلى: application/bots
 * يُستخدم من: driver-dialog.ts، rider-dialog.ts
 * ملاحظات مستقبلية: عندَ الحاجةِ إلى ترقيمِ صفحاتٍ تُضاف حدودٌ للمنفذِ لا حلقةٌ هنا
 *   (نفسُ قاعدةِ `get-reputation-summary.ts`).
 */

import { type Stars, starsBar } from "../../domain/reputation/index.ts";
import { t } from "../../shared/i18n/index.ts";
import {
  getReputationSummary,
  type ReputationReader,
  type ReputationSummary,
} from "../reputation/index.ts";
import type { BotReply, DialogState, Sender } from "./types.ts";

export interface ReputationCardDeps {
  readonly reputation: ReputationReader;
}

/**
 * غيابُ التقييماتِ ليسَ صفريَ نجومٍ: المتوسطُ `null` يُعرضُ «لا تقييم بعد» لا
 * «0.0» — فالغيابُ ليسَ حُكمًا سيّئًا (`ReputationSnapshot`).
 */
function snapshotLine(
  language: string,
  key: string,
  average: number | null,
  count: number,
): string {
  const tr = t(language);
  if (average === null || count === 0) return tr(`${key}.empty`);
  return tr(key, { average: average.toFixed(1), count: String(count) });
}

export async function reputationCardReplies(
  sender: Sender,
  state: DialogState,
  telegramUserId: string,
  deps: ReputationCardDeps,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const resolved = await getReputationSummary({ telegramId: telegramUserId }, deps);

  if (!resolved.ok) {
    // عطلُ المنفذِ عطلٌ فنيٌّ لا «لا سمعةَ»: القارئُ يجيبُ `null` عن غيابِ البياناتِ.
    return [{ chatId: sender.chatId, text: tr("common.error_try_again"), keyboard: null }];
  }
  if (resolved.value === null) {
    return [{ chatId: sender.chatId, text: tr("reputation.empty"), keyboard: null }];
  }

  const value: ReputationSummary = resolved.value;

  // لا تقييمٍ على الإطلاق — لا في الاتجاهَينِ ولا مستلَمٌ واحدٌ: جوابٌ واحدٌ صريحٌ
  // لا بطاقةٌ بعنوانٍ وفراغَينِ. (المنفذُ يُعيدُ `null` عن الغيابِ، وهذا الحارسُ
  // يغطّي الصورةَ التي تُعيدُها القاعدةُ بقيَمٍ فارغةٍ.)
  const hasDriverRatings = (value.asDriver?.count ?? 0) > 0;
  const hasRiderRatings = (value.asRider?.count ?? 0) > 0;
  if (!hasDriverRatings && !hasRiderRatings && value.received.length === 0) {
    return [{ chatId: sender.chatId, text: tr("reputation.empty"), keyboard: null }];
  }
  const lines = [
    tr("reputation.heading"),
    "",
    snapshotLine(
      state.language,
      "reputation.as_driver",
      value.asDriver?.average ?? null,
      value.asDriver?.count ?? 0,
    ),
    snapshotLine(
      state.language,
      "reputation.as_rider",
      value.asRider?.average ?? null,
      value.asRider?.count ?? 0,
    ),
  ];

  // آخرُ ثلاثةِ تقييماتٍ مستلمةٍ لا كلُّها: البطاقةُ إجابةُ «كيفَ سمْعتي؟» لا سجلٌّ
  // كاملٌ — السجلُّ الكاملُ في القاعدةِ ولوحةِ الإدارةِ.
  const recent = value.received.slice(0, 3);
  if (recent.length > 0) {
    lines.push("", tr("reputation.recent"));
    for (const rating of recent) {
      const direction =
        rating.direction === "rider_to_driver"
          ? tr("reputation.from_rider")
          : tr("reputation.from_driver");
      const stars = starsBar(Math.min(5, Math.max(1, rating.stars)) as Stars);
      lines.push(tr("reputation.recent_row", { stars, direction }));
    }
  }

  return [{ chatId: sender.chatId, text: lines.join("\n"), keyboard: null }];
}
