/**
 * الغرض: منافذُ الأماكنِ المحفوظةِ وآخرِ الوجهاتِ — البند `F2-02` (القاعدة 0.5).
 * الحالة: منفّذ فعلياً — البند `F2-02` (تعريفُ منافذَ بلا تنفيذٍ ههنا).
 * ينتمي إلى: packages/application/places
 * يُستخدم من: `packages/application/places/manage-places.ts`
 *   و`packages/infrastructure/places/places-store.ts`.
 *
 * ## لماذا `telegramUserId` لا `userId` — ولا `cityId`
 *
 * كما في `packages/application/consent/ports.ts` بحرفِه: المعرّفُ الوحيدُ
 * الموقَّعُ منّا هوَ معرّفُ تيليجرام من رمزِ الجلسةِ، وصفُّ المستخدمِ يُحَلُّ
 * داخلَ القاعدةِ. ولا تأخذُ الكتابةُ مدينةً من العميلِ: `users.city_id` مصدرُها
 * (القاعدة 0.4)، وقَبولُها من الطلبِ بابُ «احفَظْ مكاناً في مدينةِ غيرِك».
 *
 * ## ولماذا منفذٌ ثالثٌ للوجهاتِ الأخيرةِ
 *
 * الوجهاتُ الأخيرةُ قراءةٌ من `orders` لا من `saved_places`، فمنفذُها مفصولٌ كي
 * لا يُوهِمَ التوقيعُ أنَّها محفوظةٌ فتُكتَبَ يوماً. وهيَ **مشتقَّةٌ**: لا كتابةَ
 * لها ههنا ولا في مكانٍ آخرَ.
 */

import type { SavedPlaceKind } from "../../domain/places/place-kinds.ts";
import type { Result } from "../../shared/result/index.ts";

export type PlaceStoreFailureReason =
  /** لا صفَّ مستخدمٍ لهذا المعرّفِ — لا يُنشَأُ ههنا (ADR 0035). */
  | "USER_NOT_FOUND"
  /** المنفذُ غيرُ مُهيَّأٍ — يُترجَمُ 503 لا 200 بقائمةٍ فارغةٍ. */
  | "NOT_CONFIGURED"
  | "STORE_ERROR";

export interface PlaceStoreFailure {
  readonly code: "PLACE_STORE_FAILED";
  readonly reason: PlaceStoreFailureReason;
}

export interface SavedPlace {
  readonly id: string;
  readonly kind: SavedPlaceKind;
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  readonly updatedAtMs: number;
}

export interface SavePlaceCommand {
  readonly telegramUserId: string;
  readonly kind: SavedPlaceKind;
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
}

export interface SavePlaceOutcome {
  readonly status: "created" | "updated";
  readonly place: SavedPlace;
}

export interface SavedPlaceReader {
  listForTelegramUser(
    telegramUserId: string,
  ): Promise<Result<readonly SavedPlace[], PlaceStoreFailure>>;
}

export interface SavedPlaceWriter {
  save(command: SavePlaceCommand): Promise<Result<SavePlaceOutcome, PlaceStoreFailure>>;
}

/** وجهةٌ مشتقَّةٌ من طلبٍ سابقٍ: بلا معرّفٍ لأنَّها ليست صفّاً يُحدَّثُ. */
export interface RecentDestination {
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  readonly lastUsedAtMs: number;
}

export interface RecentDestinationReader {
  listForTelegramUser(
    telegramUserId: string,
    limit: number,
  ): Promise<Result<readonly RecentDestination[], PlaceStoreFailure>>;
}
