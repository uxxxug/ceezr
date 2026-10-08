/**
 * # عقدُ المكانِ الموحَّدُ (`PlaceInput`) — للالتقاطِ والوجهةِ معاً · `LOC-TRUST-01`
 *
 * **الغرض:** يحسمُ سؤالاً واحداً كانَ متروكاً للعرضِ: **ما الحقيقةُ في مكانٍ أدخلَه
 * الراكبُ؟** والجوابُ هنا مكتوبٌ مرّةً ويقرؤه الطرفانِ (الشاشةُ والبوّابةُ):
 *
 * ١) **النقطةُ هيَ الحقيقةُ متى وُجِدَت** — ومعها مصدرُها (`source`) ودقّتُها ووقتُ
 *    التقاطِها. واسمُ أقربِ معلَمٍ **وصفٌ للعرضِ وحدَه**: لا يُحفَظُ مكانَ الاسمِ ولا
 *    يُرسَلُ للسائقِ على أنّه الموقعُ (`nearestLandmark` لا يَعبُرُ السلكَ أصلاً).
 * ٢) **الرابطُ الأصليُّ يُحفَظُ كما أدخلَه الراكبُ** ولا يُستبدَلُ ولا يُختصَرُ. وإن
 *    لم تُستخرَجْ منه نقطةٌ (رابطٌ مختصرٌ) يبقى محفوظاً ويُفتَحُ للسائقِ كما هو.
 * ٣) **الاسمُ ما كتبَه الراكبُ أو اختارَه** (اقتراحاً أو مكاناً محفوظاً)، لا ما
 *    استنتجَه النظامُ من أقربِ معلَم.
 * ٤) **الملاحظاتُ مرتبطةٌ بالمكانِ** (الالتقاطِ أو الوجهةِ) لا بالرحلةِ.
 *
 * **سياسةُ دقّةِ الجهازِ — أرقامٌ مقروءةٌ من النطاقِ لا مكتوبةٌ هنا:**
 * - `GOOD` حتّى `DEFAULT_GPS_POLICY.maxAccuracyMeters` (100 م · `ADR 0015`): الحدُّ
 *   نفسُه الذي تقبلُ به المنصّةُ موقعَ السائقِ بلا تحذير.
 * - `COARSE` فوقَه وحتّى `NEAREST_LANDMARK_DESCRIBES_WITHIN_M` (1500 م): يُحذَّرُ
 *   الراكبُ ولا يُعتمَدُ إلّا بإقرارٍ صريحٍ بعدَ التحقّقِ على الخريطة.
 * - `UNRELIABLE` فوقَ 1500 م — وهوَ الحدُّ الذي قرّرَ النطاقُ أنَّ ما بعدَه «لا يَصِفُ
 *   موضعاً بل يُضلِّلُ عنه»: لا يُعتمَدُ أبداً، ويُطلَبُ تصحيحٌ (رابطٌ/إحداثيّاتٌ/اقتراح).
 * - الحداثةُ بحدودِ `DEFAULT_GPS_POLICY` نفسِها: أقدمُ من `staleAfterSeconds` (30 ث)
 *   `COARSE`، وأقدمُ من `rejectOlderThanSeconds` (300 ث) `UNRELIABLE`. وقراءةٌ **لا
 *   وقتَ لها** (Telegram `LocationManager` لا يُعيدُ طابعاً) حداثتُها **غيرُ مُثبَتةٍ**
 *   فلا تبلغُ `GOOD` أبداً — وهذا بالضبطِ عيبُ Telegram لـAndroid (موقعٌ راكد).
 *
 * **الحالة:** منفّذ فعلياً — `LOC-TRUST-01` · `docs/adr/0247-place-input-contract.md`.
 * **ينتمي إلى:** domain/places · نقيٌّ: لا شبكةَ ولا ساعةَ ولا تخزين.
 * **يستخدمه:** شاشتا الالتقاطِ والوجهةِ في التطبيقِ المصغَّر، وحالةُ طلبِ الرحلةِ
 *   في البوّابة، وبطاقةُ السائق.
 *
 * **ما لا يفعلُه عن قصد:** لا يفتحُ رابطاً مختصراً عبرَ الشبكةِ (لا مزوّدَ خرائطَ ولا
 * طلبَ خارجيٍّ): الرابطُ المختصرُ يُحفَظُ بلا نقطةٍ، ويُطلَبُ من الراكبِ نقطةٌ معه.
 * ولا يحوي عنواناً مطلقاً (`https://…`) — الرابطُ الذي يُفتَحُ يُبنى في الخادمِ.
 */
import { NEAREST_LANDMARK_DESCRIBES_WITHIN_M } from "../destinations/landmark-kinds.ts";
import { DEFAULT_GPS_POLICY } from "../geo/gps-fix.ts";

export const PLACE_POINT_SOURCES = [
  /** قراءةٌ من جهازِ الراكبِ الآن. */
  "DEVICE",
  /** إحداثيّاتٌ حدّدَها الراكبُ على خريطةٍ (لُصِقَت أرقاماً). */
  "MAP_PIN",
  /** نقطةٌ استُخرِجَت من رابطِ موقعٍ لصقَه الراكب. */
  "SHARED_LINK",
  /** اقتراحٌ من دليلِ الوجهاتِ اختارَه الراكبُ بالاسم. */
  "SUGGESTION",
  /** مكانٌ محفوظٌ أو وجهةٌ سابقةٌ للراكبِ نفسِه. */
  "SAVED",
] as const;

export type PlacePointSource = (typeof PLACE_POINT_SOURCES)[number];

export function isPlacePointSource(value: unknown): value is PlacePointSource {
  return typeof value === "string" && (PLACE_POINT_SOURCES as readonly string[]).includes(value);
}

export interface PlacePoint {
  readonly lat: number;
  readonly lng: number;
  readonly source: PlacePointSource;
  /** نصفُ قطرِ الدقّةِ بالمتر كما أعلنَه الجهاز؛ `null` = لم يُعلَن. */
  readonly accuracyM: number | null;
  /** لحظةُ الالتقاطِ ISO؛ `null` = لا طابعَ موثوق. */
  readonly capturedAt: string | null;
}

export interface PlaceInput {
  readonly point: PlacePoint | null;
  /** الرابطُ كما لصقَه الراكبُ — حرفاً. */
  readonly link: string | null;
  readonly label: string | null;
  readonly notes: string | null;
}

/** حدودُ نقلٍ لا قيمُ منتَج (القاعدة 0.3). رابطُ خرائطِ Google بمكانٍ عربيِّ الاسمِ يتجاوزُ الألفَ أحياناً. */
export const PLACE_LINK_MAX_LENGTH = 2048;
export const PLACE_NOTES_MAX_LENGTH = 200;
/** أقصى دقّةٍ تُقبَلُ رقماً على السلكِ (أبعدُ منها ليسَ موقعاً بل منطقة). */
export const PLACE_ACCURACY_MAX_M = 100_000;

export const PLACE_ACCURACY_GOOD_M = DEFAULT_GPS_POLICY.maxAccuracyMeters;
export const PLACE_ACCURACY_UNRELIABLE_M = NEAREST_LANDMARK_DESCRIBES_WITHIN_M;
export const PLACE_FIX_STALE_AFTER_S = DEFAULT_GPS_POLICY.staleAfterSeconds;
export const PLACE_FIX_TOO_OLD_S = DEFAULT_GPS_POLICY.rejectOlderThanSeconds;

// ─── الروابط ──────────────────────────────────────────────────────────────

export type PlaceLinkKind =
  | "GOOGLE_MAPS"
  /** `maps.app.goo.gl` · `goo.gl/maps` — لا نقطةَ فيه بلا شبكة. */
  | "GOOGLE_SHORT"
  | "APPLE_MAPS"
  | "WAZE"
  | "OSM"
  | "GEO_URI";

export interface ParsedPlaceLink {
  /** الرابطُ كما وُجِدَ في النصِّ — لا يُعادُ ترميزُه. */
  readonly raw: string;
  readonly kind: PlaceLinkKind;
  readonly point: { readonly lat: number; readonly lng: number } | null;
}

export type PlaceLinkRefusal = "NOT_A_LINK" | "UNSUPPORTED_HOST" | "TOO_LONG";

function validPoint(lat: number, lng: number): { lat: number; lng: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // (0،0) قيمةٌ افتراضيّةٌ لمُرسِلٍ معطوبٍ أكثرَ منها مكاناً في الخدمة.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

const PAIR = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,،]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/u;

/** «24.4615, 39.6118» — إحداثيّاتٌ منسوخةٌ من دبّوسِ خريطة. */
export function parseCoordinateText(text: string): { lat: number; lng: number } | null {
  const match = PAIR.exec(text);
  if (match === null) return null;
  return validPoint(Number(match[1]), Number(match[2]));
}

function pairFrom(value: string | null): { lat: number; lng: number } | null {
  if (value === null) return null;
  const cleaned = value.replace(/^loc:/i, "").replace(/\+/g, " ").split("(")[0] ?? "";
  return parseCoordinateText(cleaned);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isGoogleHost(host: string): boolean {
  return /^(?:www\.|maps\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(host);
}

function hostKind(host: string, path: string): PlaceLinkKind | null {
  if (host === "maps.app.goo.gl") return "GOOGLE_SHORT";
  if (host === "goo.gl" && path.startsWith("/maps")) return "GOOGLE_SHORT";
  if (isGoogleHost(host) && (host.startsWith("maps.") || path.startsWith("/maps"))) {
    return "GOOGLE_MAPS";
  }
  if (host === "maps.apple.com") return "APPLE_MAPS";
  if (host === "waze.com" || host === "www.waze.com" || host === "ul.waze.com") return "WAZE";
  if (host === "openstreetmap.org" || host === "www.openstreetmap.org" || host === "osm.org") {
    return "OSM";
  }
  return null;
}

function googlePoint(url: URL): { lat: number; lng: number } | null {
  const path = safeDecode(url.pathname);
  // `!3d<lat>!4d<lng>` موضعُ الدبّوسِ نفسِه — أدقُّ من `@` الذي هوَ وسطُ العرض.
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(path + safeDecode(url.search));
  if (pin !== null) {
    const point = validPoint(Number(pin[1]), Number(pin[2]));
    if (point !== null) return point;
  }
  for (const key of ["q", "query", "ll", "destination", "daddr"]) {
    const point = pairFrom(url.searchParams.get(key));
    if (point !== null) return point;
  }
  const segment = /\/maps\/(?:search|place|dir)\/([^/]+)/.exec(path);
  if (segment?.[1] !== undefined) {
    const point = pairFrom(segment[1]);
    if (point !== null) return point;
  }
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(path);
  if (at !== null) return validPoint(Number(at[1]), Number(at[2]));
  return null;
}

function linkPoint(kind: PlaceLinkKind, url: URL): { lat: number; lng: number } | null {
  switch (kind) {
    case "GOOGLE_SHORT":
      return null;
    case "GOOGLE_MAPS":
      return googlePoint(url);
    case "APPLE_MAPS":
      for (const key of ["ll", "coordinate", "q", "daddr", "sll"]) {
        const point = pairFrom(url.searchParams.get(key));
        if (point !== null) return point;
      }
      return null;
    case "WAZE":
      return pairFrom(url.searchParams.get("ll"));
    case "OSM": {
      const lat = url.searchParams.get("mlat");
      const lng = url.searchParams.get("mlon");
      if (lat === null || lng === null) return null;
      return validPoint(Number(lat), Number(lng));
    }
    case "GEO_URI":
      return null;
  }
}

const URL_IN_TEXT = /(?:https?:\/\/|geo:)[^\s<>"']+/i;

/**
 * يقرأُ رابطَ موقعٍ من نصٍّ ملصوقٍ (WhatsApp يضعُ الرابطَ داخلَ جملةٍ أحياناً).
 * ويقبلُ مضيفي الخرائطِ المعروفينَ وحدَهم: رابطٌ إلى موقعٍ آخرَ يُفتَحُ للسائقِ
 * بابُ تصيّدٍ، فلا يُقبَلُ.
 */
export function parsePlaceLink(
  text: string,
): ParsedPlaceLink | { readonly refusal: PlaceLinkRefusal } {
  const found = URL_IN_TEXT.exec(text.trim());
  if (found === null) return { refusal: "NOT_A_LINK" };
  // علاماتُ ترقيمٍ تلتصقُ بآخرِ الرابطِ في الرسائلِ («… هنا: <رابط>.») لا تُحسَبُ منه.
  let raw = found[0].replace(/[.,،!?؟]+$/u, "");
  // قوسٌ يُغلَقُ بلا فتحٍ في الرابطِ قوسُ الجملةِ لا قوسُه (`geo:…(البيت)` يبقى كاملاً).
  while (raw.endsWith(")") && (raw.match(/\(/g) ?? []).length < (raw.match(/\)/g) ?? []).length) {
    raw = raw.slice(0, -1).replace(/[.,،!?؟]+$/u, "");
  }
  if (raw.length > PLACE_LINK_MAX_LENGTH) return { refusal: "TOO_LONG" };

  if (/^geo:/i.test(raw)) {
    const body = raw.slice(4);
    const head = body.split(/[;?]/)[0] ?? "";
    const query = /[?&]q=([^&]+)/.exec(body);
    const point = parseCoordinateText(head) ?? pairFrom(query?.[1] ? safeDecode(query[1]) : null);
    return { raw, kind: "GEO_URI", point };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { refusal: "NOT_A_LINK" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { refusal: "NOT_A_LINK" };
  if (url.username !== "" || url.password !== "") return { refusal: "UNSUPPORTED_HOST" };
  const kind = hostKind(url.hostname.toLowerCase(), url.pathname);
  if (kind === null) return { refusal: "UNSUPPORTED_HOST" };
  return { raw, kind, point: linkPoint(kind, url) };
}

/** هل يُفتَحُ الرابطُ نفسُه زرّاً؟ `geo:` لا تقبلُه أزرارُ Telegram فيُفتَحُ من النقطة. */
export function isOpenableLink(raw: string): boolean {
  const parsed = parsePlaceLink(raw);
  return !("refusal" in parsed) && parsed.kind !== "GEO_URI" && parsed.raw === raw;
}

// ─── دقّةُ الجهازِ وحداثتُه ─────────────────────────────────────────────────

export type DeviceFixVerdict = "GOOD" | "COARSE" | "UNRELIABLE";

export type DeviceFixReason =
  | "ACCURACY_UNKNOWN"
  | "ACCURACY_COARSE"
  | "ACCURACY_UNRELIABLE"
  | "FRESHNESS_UNKNOWN"
  | "STALE"
  | "TOO_OLD";

export interface DeviceFixAssessment {
  readonly verdict: DeviceFixVerdict;
  readonly reasons: readonly DeviceFixReason[];
}

/**
 * يحكمُ على قراءةِ جهازٍ: هل تُعتمَدُ نقطةَ التقاطٍ؟ نقيٌّ — الساعةُ تُمرَّر.
 * `capturedAtMs = null` معناه «لا طابعَ من المصدر» فالحداثةُ غيرُ مُثبَتة.
 */
export function assessDeviceFix(input: {
  readonly accuracyM: number | null;
  readonly capturedAtMs: number | null;
  readonly nowMs: number;
}): DeviceFixAssessment {
  const reasons: DeviceFixReason[] = [];
  let verdict: DeviceFixVerdict = "GOOD";
  const worsen = (to: DeviceFixVerdict, reason: DeviceFixReason) => {
    reasons.push(reason);
    if (to === "UNRELIABLE" || verdict === "GOOD") verdict = to;
  };

  const accuracy = input.accuracyM;
  if (accuracy === null || !Number.isFinite(accuracy) || accuracy < 0) {
    worsen("COARSE", "ACCURACY_UNKNOWN");
  } else if (accuracy > PLACE_ACCURACY_UNRELIABLE_M) {
    worsen("UNRELIABLE", "ACCURACY_UNRELIABLE");
  } else if (accuracy > PLACE_ACCURACY_GOOD_M) {
    worsen("COARSE", "ACCURACY_COARSE");
  }

  if (input.capturedAtMs === null || !Number.isFinite(input.capturedAtMs)) {
    worsen("COARSE", "FRESHNESS_UNKNOWN");
  } else {
    const ageSeconds = (input.nowMs - input.capturedAtMs) / 1000;
    if (ageSeconds > PLACE_FIX_TOO_OLD_S) worsen("UNRELIABLE", "TOO_OLD");
    else if (ageSeconds > PLACE_FIX_STALE_AFTER_S) worsen("COARSE", "STALE");
  }

  return { verdict, reasons };
}

// ─── قراءةُ السلكِ (البوّابة) ───────────────────────────────────────────────

/**
 * ما يحملُه السلكُ زيادةً على الحقولِ المسطّحةِ القديمةِ (`originLat`… و`pickupLabel`):
 * النقطةُ والاسمُ يبقيانِ في مكانِهما للتوافقِ الخلفيّ، وهذا يحملُ ما كانَ يسقط.
 */
export interface PlaceMeta {
  readonly source: PlacePointSource;
  readonly accuracyM: number | null;
  readonly capturedAt: string | null;
  readonly link: string | null;
  readonly notes: string | null;
}

export type PlaceMetaRefusal =
  | "PLACE_INVALID"
  | "PLACE_LINK_UNSUPPORTED"
  | "PLACE_NOTES_TOO_LONG"
  | "PLACE_POINT_UNRELIABLE";

/** تفاوتُ ساعةِ الجهازِ المقبولُ لطابعٍ «من المستقبل» — من سياسةِ GPS نفسِها. */
const FUTURE_SKEW_MS = DEFAULT_GPS_POLICY.maxFutureSkewSeconds * 1000;
/** تطابقُ نقطةِ الرابطِ معَ النقطةِ المُرسَلةِ: ستُّ منازلَ عشريّةٍ ≈ عُشرُ متر. */
const LINK_POINT_TOLERANCE_DEG = 1e-5;

/**
 * يقرأُ `pickupPlace`/`dropoffPlace` من جسمِ الطلبِ. الغيابُ مقبولٌ (عميلٌ قديم)
 * فيُعادُ `null`؛ والحضورُ المعطوبُ رفضٌ مُسمّى لا إسقاطٌ صامت.
 */
export function readPlaceMeta(
  value: unknown,
  point: { readonly lat: number; readonly lng: number },
  nowMs: number,
): { readonly meta: PlaceMeta | null } | { readonly refusal: PlaceMetaRefusal } {
  if (value === undefined || value === null) return { meta: null };
  if (typeof value !== "object" || Array.isArray(value)) return { refusal: "PLACE_INVALID" };
  const body = value as Record<string, unknown>;

  if (!isPlacePointSource(body.source)) return { refusal: "PLACE_INVALID" };

  let accuracyM: number | null = null;
  if (body.accuracyM !== undefined && body.accuracyM !== null) {
    if (
      typeof body.accuracyM !== "number" ||
      !Number.isFinite(body.accuracyM) ||
      body.accuracyM < 0 ||
      body.accuracyM > PLACE_ACCURACY_MAX_M
    ) {
      return { refusal: "PLACE_INVALID" };
    }
    accuracyM = Math.round(body.accuracyM * 10) / 10;
  }

  let capturedAt: string | null = null;
  if (body.capturedAt !== undefined && body.capturedAt !== null) {
    if (typeof body.capturedAt !== "string") return { refusal: "PLACE_INVALID" };
    const at = Date.parse(body.capturedAt);
    if (Number.isNaN(at) || at > nowMs + FUTURE_SKEW_MS) return { refusal: "PLACE_INVALID" };
    capturedAt = new Date(at).toISOString();
  }

  let link: string | null = null;
  if (body.link !== undefined && body.link !== null) {
    if (typeof body.link !== "string") return { refusal: "PLACE_INVALID" };
    const trimmed = body.link.trim();
    if (trimmed !== "") {
      if (trimmed.length > PLACE_LINK_MAX_LENGTH) return { refusal: "PLACE_LINK_UNSUPPORTED" };
      const parsed = parsePlaceLink(trimmed);
      // الرابطُ يُحفَظُ حرفاً كما أرسلَه الراكب؛ ولا يُقبَلُ نصٌّ يحوي رابطاً ونصّاً معه.
      if ("refusal" in parsed || parsed.raw !== trimmed)
        return { refusal: "PLACE_LINK_UNSUPPORTED" };
      // رابطٌ يدلُّ على مكانٍ آخرَ غيرِ النقطةِ يُضلِّلُ السائق (الأصليُّ يُفتَحُ أوّلاً).
      if (parsed.point !== null && linkConflictsWithPoint(parsed.point, point)) {
        return { refusal: "PLACE_INVALID" };
      }
      if (body.source === "SHARED_LINK") {
        if (
          parsed.point === null ||
          Math.abs(parsed.point.lat - point.lat) > LINK_POINT_TOLERANCE_DEG ||
          Math.abs(parsed.point.lng - point.lng) > LINK_POINT_TOLERANCE_DEG
        ) {
          return { refusal: "PLACE_INVALID" };
        }
      }
      link = trimmed;
    }
  }
  if (body.source === "SHARED_LINK" && link === null) return { refusal: "PLACE_INVALID" };

  let notes: string | null = null;
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== "string") return { refusal: "PLACE_INVALID" };
    const trimmed = body.notes.trim();
    if (trimmed.length > PLACE_NOTES_MAX_LENGTH) return { refusal: "PLACE_NOTES_TOO_LONG" };
    notes = trimmed === "" ? null : trimmed;
  }

  // دفاعٌ في العمق: قراءةُ جهازٍ دقّتُها أسوأُ من حدِّ «لا يَصِفُ موضعاً» لا تُعتمَدُ
  // ولو تجاوزَت الشاشة. (الحداثةُ لا تُحكَمُ هنا: الراكبُ قد يملأُ النموذجَ دقائق.)
  if (body.source === "DEVICE" && accuracyM !== null && accuracyM > PLACE_ACCURACY_UNRELIABLE_M) {
    return { refusal: "PLACE_POINT_UNRELIABLE" };
  }

  return { meta: { source: body.source, accuracyM, capturedAt, link, notes } };
}

// ─── تعارضُ الرابطِ والنقطة ────────────────────────────────────────────────

/**
 * رابطٌ نقطتُه أبعدُ من هذا عن النقطةِ المختارةِ **مكانٌ آخر**: السائقُ سيفتحُ الرابطَ
 * (الأصليُّ يُفتَحُ أوّلاً) ويقودُ إلى غيرِ ما حُسِبَت عليه الرحلة. والرقمُ هوَ نصفُ قطرِ
 * «وصلَ السائقُ» نفسُه (`DEFAULT_OPERATIONS_POLICY.arrivalRadiusKm` = 0.15 كم) — يُطابِقُه
 * اختبارٌ ولا يُنسَخُ بلا حارس.
 */
export const PLACE_LINK_CONFLICT_M = 150;

function metersBetween(
  a: { readonly lat: number; readonly lng: number },
  b: { readonly lat: number; readonly lng: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** هل يدلُّ الرابطُ على مكانٍ غيرِ النقطةِ المختارة؟ رابطٌ بلا نقطةٍ لا يُحكَمُ عليه. */
export function linkConflictsWithPoint(
  linkPoint: { readonly lat: number; readonly lng: number } | null,
  point: { readonly lat: number; readonly lng: number },
): boolean {
  if (linkPoint === null) return false;
  return metersBetween(linkPoint, point) > PLACE_LINK_CONFLICT_M;
}
