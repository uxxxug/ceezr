/**
 * الغرض: حالاتُ استخدامِ شاشةِ الراكبِ الأولى — «أماكني المحفوظةُ»، «احفَظْ هذا
 *   المكانَ»، «آخرُ وجهاتي» — بتحقّقِ جلسةٍ على الخادمِ وحدَه (البند `F2-02`
 *   · القسمان 9.5 و9.8).
 * الحالة: منفّذ فعلياً — البند `F2-02`.
 * ينتمي إلى: packages/application/places
 * يُستخدم من: `apps/gateway/src/routes/me-places.ts`.
 *
 * ## ما لا تفعلُه هذه الحالاتُ عن قصدٍ
 *
 *   ــ **لا تثقُ بهويّةٍ من الطلبِ**: المعرّفُ من رمزٍ موقَّعٍ منّا وحدَه، كما في
 *      `record-consent.ts`.
 *   ــ لا تقبلُ مدينةً ولا معرّفَ مستخدمٍ ولا ختماً زمنيّاً من العميلِ.
 *   ــ لا تُنشئُ صفَّ مستخدمٍ: غيابُه حالةٌ تُعادُ (ADR 0035).
 *   ــ لا تُعيدُ قائمةً فارغةً عندَ عطبِ المخزنِ: الفارغُ يعني «لا أماكنَ»،
 *      والعطبُ يعني «لا أعرفُ» — وخلطُهما يجعلُ الشاشةَ تكذبُ على صاحبِها.
 *   ــ لا تحجبُ الشاشةَ على الموافقاتِ: ذاكَ ترتيبُ الشاشاتِ في العميلِ وحكمُه
 *      في `F2-01`، ولا يُكرَّرُ ههنا حكماً ثانياً يتباعدُ عنه.
 */

import {
  isSavedPlaceKind,
  normalizePlaceLabel,
  readPlacePoint,
} from "../../domain/places/place-kinds.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import type {
  PlaceStoreFailure,
  RecentDestination,
  RecentDestinationReader,
  SavedPlace,
  SavedPlaceReader,
  SavedPlaceWriter,
} from "./ports.ts";

export interface PlacesDeps {
  readonly sessions: MiniAppSessionReader;
  readonly reader: SavedPlaceReader;
  readonly writer: SavedPlaceWriter;
  readonly recent: RecentDestinationReader;
  readonly now: () => Date;
}

export type PlacesPublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_NOT_AVAILABLE"
  | "MALFORMED"
  | "UNKNOWN_PLACE_KIND"
  | "ACCOUNT_NOT_FOUND"
  | "PLACE_STORE_NOT_AVAILABLE";

/** «آخرُ ثلاثِ وجهاتٍ» في `SR-02` نصّاً: الثلاثةُ هيَ الافتراضُ لا اختيارُ عميلٍ. */
export const DEFAULT_RECENT_DESTINATIONS = 3;

/**
 * وسقفٌ للحدِّ المطلوبِ: `?limit=100000` على قراءةٍ تفرزُ طلباتِ صاحبِها ثمَّ
 * تُميِّزُها ليس ميزةً بل سطحُ حِملٍ. والسقفُ عشرةٌ لأنَّ الشاشةَ لا تعرضُ أكثرَ،
 * و`SR-12` إن أرادَ سجلاً كاملاً فذاكَ عقدٌ آخرُ بترقيمِ صفحاتٍ.
 */
export const MAX_RECENT_DESTINATIONS = 10;

function sessionErrorFrom(reason: string): PlacesPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

function storeErrorFrom(failure: PlaceStoreFailure): PlacesPublicErrorCode {
  if (failure.reason === "USER_NOT_FOUND") return "ACCOUNT_NOT_FOUND";
  return "PLACE_STORE_NOT_AVAILABLE";
}

function authenticate(
  deps: PlacesDeps,
  accessToken: string | undefined,
): Result<string, PlacesPublicErrorCode> {
  if (accessToken === undefined || accessToken.length === 0) return err("SESSION_REQUIRED");
  const session = deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(sessionErrorFrom(session.error.reason));
  return ok(session.value.telegramUserId);
}

export interface SavedPlacesOutput {
  readonly places: readonly SavedPlace[];
}

export async function listSavedPlaces(
  deps: PlacesDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<SavedPlacesOutput, PlacesPublicErrorCode>> {
  const identified = authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  const listed = await deps.reader.listForTelegramUser(identified.value);
  if (!listed.ok) return err(storeErrorFrom(listed.error));
  return ok({ places: listed.value });
}

export interface SavePlaceOutput {
  readonly status: "created" | "updated";
  readonly place: SavedPlace;
}

/**
 * حفظُ مكانٍ. الترتيبُ: جلسةٌ، ثمَّ قبولُ الجسمِ بحدودِ النطاقِ، ثمَّ كتابةٌ
 * ذرّيّةٌ واحدةٌ (`upsert_saved_place`) تُقرَأُ فيها المدينةُ من صفِّ المستخدمِ.
 * ولا «اقرأْ ثمَّ قرِّرْ أُنشِئُ أم أُحدِّثُ» ههنا: ذاكَ سِباقٌ بينَ نقرتَينِ من
 * نفسِ المستخدمِ يُنتِجُ منزلَينِ، والقاعدةُ تحكمُه بفهرسٍ فريدٍ لا الشِّفرةُ بظنٍّ.
 */
export async function savePlace(
  deps: PlacesDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly body: unknown;
  },
): Promise<Result<SavePlaceOutput, PlacesPublicErrorCode>> {
  const identified = authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  if (typeof input.body !== "object" || input.body === null) return err("MALFORMED");
  const body = input.body as Record<string, unknown>;

  // نوعٌ مجهولٌ يُفصَلُ عن «جسمٍ مُشوَّهٍ»: الأوّلُ خطأُ عقدٍ يُقرأُ، والثاني خطأُ
  // بناءٍ. وخلطُهما يجعلُ عميلاً أرسلَ `kind: "gym"` يظنُّ أنَّ شِفرتَه معطوبةٌ.
  if (!isSavedPlaceKind(body.kind)) return err("UNKNOWN_PLACE_KIND");

  const label = normalizePlaceLabel(body.label);
  if (label === null) return err("MALFORMED");

  const point = readPlacePoint(body.lat, body.lng);
  if (point === null) return err("MALFORMED");

  const saved = await deps.writer.save({
    telegramUserId: identified.value,
    kind: body.kind,
    label,
    lat: point.lat,
    lng: point.lng,
  });
  if (!saved.ok) return err(storeErrorFrom(saved.error));

  return ok({ status: saved.value.status, place: saved.value.place });
}

export interface RecentDestinationsOutput {
  readonly destinations: readonly RecentDestination[];
}

/**
 * حدٌّ مقبولٌ: عددٌ صحيحٌ موجبٌ دونَ السقفِ. وما سواه **يُردُّ** ولا يُقصَرُ
 * صامتاً إلى السقفِ: عميلٌ طلبَ خمسينَ وأخذَ عشراً بلا خبرٍ يبني عليها منطقاً
 * خاطئاً («لا وجهاتَ أكثرَ»).
 */
export function readRecentLimit(raw: string | null): number | null {
  if (raw === null || raw.length === 0) return DEFAULT_RECENT_DESTINATIONS;
  if (!/^[0-9]{1,3}$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  if (value < 1 || value > MAX_RECENT_DESTINATIONS) return null;
  return value;
}

export async function listRecentDestinations(
  deps: PlacesDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly limit: number;
  },
): Promise<Result<RecentDestinationsOutput, PlacesPublicErrorCode>> {
  const identified = authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;

  const listed = await deps.recent.listForTelegramUser(identified.value, input.limit);
  if (!listed.ok) return err(storeErrorFrom(listed.error));
  return ok({ destinations: listed.value });
}
