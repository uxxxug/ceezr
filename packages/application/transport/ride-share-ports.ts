/**
 * الغرض: عقدُ قراءةِ حالِ مشاركةِ الرحلةِ بينَ طبقةِ التطبيقِ والقاعدةِ
 *   (`F2-09` · `SR-13`) — وقائعُ الحالِ وحدَها **بلا نصٍّ معروضٍ**.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`. حكمُ CI **غيرُ مقروءٍ** (`B-CI-001`).
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `read-ride-share.ts` · `infrastructure/transport/ride-share-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` حينَ يعرضُ «مَن يرى موقعي الآنَ» في شاشةِ
 *   الطوارئِ — يقرأُ هذا العقدَ ولا يُنشئُ ثانياً.
 *
 * ## لماذا **قراءةٌ** فقط في هذا العقدِ
 *
 * الإصدارُ والإلغاءُ لهما عقدٌ قائمٌ منذُ 2026-08-14
 * (`application/tracking/tracking-token-ports.ts`) يستعملُه البوتانِ. وإضافةُ
 * `issue`/`revoke` ههنا كانت ستعني منفذَينِ لكتابةٍ واحدةٍ، ويومَ يتغيَّرُ شرطُ
 * الملكيّةِ في القاعدةِ يُحدَّثُ أحدُهما ويُنسى الآخرُ (القاعدة 0.6). فالكتابةُ
 * تمرُّ بالمنفذِ القائمِ حرفاً، والجديدُ **سؤالٌ لم يكن يُسألُ**: «ما حالُ
 * مشاركةِ هذه الرحلةِ الآنَ، وماذا سيرى مَن أُعطيهِ الرابطَ؟».
 *
 * ## ولماذا المعاينةُ تُنقَلُ ولا تُبنى
 *
 * `preview` في هذا العقدِ هوَ ما أعادَته `tracking_link_view` — الدالّةُ نفسُها
 * التي تُجيبُ الصفحةَ العامّةَ. فالمحوّلُ يقرؤُها ويُصنِّفُها نوعاً، **ولا
 * يُعيدُ حسابَ حكمٍ ولا يملأُ نقصاً**: حمولةٌ لا تُفهَمُ عطبُ عقدٍ يُعلَنُ، لا
 * فراغٌ يُملأُ بافتراضٍ.
 */

import type { RideShareState } from "../../domain/transport/ride-share.ts";
import type { Result } from "../../shared/result/index.ts";
import type { RideStoreFailure } from "./ride-request-ports.ts";

/** كما في `F2-06`…`F2-08`: مَن سألَ عن رحلةِ غيرِه يُجابُ «غيرُ موجودةٍ». */
export type RideShareRefusal = "INVALID_ORDER_ID" | "ORDER_NOT_FOUND";

export type RideShareVerdict =
  | { readonly found: true; readonly state: RideShareState }
  | { readonly found: false; readonly refusal: RideShareRefusal };

export interface RideShareReader {
  read(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<RideShareVerdict, RideStoreFailure>>;
}
