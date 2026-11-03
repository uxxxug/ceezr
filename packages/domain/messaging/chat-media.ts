/**
 * الغرض: فحصُ وسائطِ محادثةِ الطلبِ (صورةٌ ورسالةٌ صوتيّة) **من بايتاتِها لا من تصريحِ
 *   العميل**، وتنظيفُ الصورةِ من بياناتِها الوصفيّة (EXIF/GPS/XMP/التعليقات) قبلَ أن
 *   تُخزَّن — `WR-34` (ADR 0305).
 * الحالة: منفّذ فعلياً — دوالُّ نقيّةٌ بلا شبكةٍ ولا قاعدة، تُناديها البوّابةُ قبلَ الحجزِ
 *   والرفع.
 * ينتمي إلى: packages/domain/messaging
 * يُستخدم من: `packages/application/messaging/order-chat.ts` (مسارُ رفعِ الوسيط).
 *
 * ## لماذا في الخادم
 *   العميلُ يُعيدُ ترميزَ الصورةِ عبرَ `canvas` (فتسقطُ EXIF ويصغرُ الحجم)، لكنّ ذلك
 *   تحسينٌ لا ضمان: طلبٌ مصنوعٌ يتجاوزُ الواجهة. فالخادمُ يحكمُ وحدَه:
 *   ١. النوعُ من البصمةِ السحريّة (magic bytes)، لا من `Content-Type`.
 *   ٢. البنيةُ تُقرأُ فعلاً (مقاطعُ JPEG، وقطعُ PNG، وقطعُ RIFF/WebP، وصناديقُ MP4،
 *      وعناصرُ EBML/WebM، وصفحاتُ Ogg) — ملفٌّ يبدأُ بالبصمةِ ثمّ لا يُقرأُ يُرفَض.
 *   ٣. الصورةُ تُكتَبُ من جديدٍ بقائمةِ سماحٍ: ما يلزمُ لفكِّها ولونِها فقط. EXIF (وفيه
 *      GPS وطرازُ الجهاز) وXMP والتعليقاتُ والنصوصُ والصورُ المضمَّنةُ بعدَ النهايةِ تسقط.
 *   ٤. الصوتُ: مسارٌ صوتيٌّ واحدٌ على الأقلّ ولا مسارَ مرئيّ، والمدّةُ من الحاوية حين
 *      تُعلِنُها (MP4 · Ogg · WebM إن وُجدَ عنصرُ المدّة) وإلّا فالمصرَّحُ بها محدودةً.
 *
 * ## ما لا يفعلُه
 *   - لا يفكُّ ترميزَ البكسلات (لا مكتبةَ صورٍ في البوّابة): الأبعادُ من الترويسة،
 *     وحدُّها (10000 لكلِّ بُعدٍ و40 ميغابكسل) يمنعُ «قنبلةَ الفكّ» عندَ الطرفِ الآخر.
 *   - لا يُعيدُ كتابةَ حاويةِ الصوت: تغييرُ حجمِ `moov` يُزيحُ إزاحاتِ `mdat` فيُتلفُ
 *     الملف. ومسجّلاتُ المتصفّحِ لا تكتبُ موقعاً في الصوت؛ والقيدُ المتبقّي موثَّقٌ.
 */

export type ChatMediaKind = "image" | "voice";

export type ChatImageMime = "image/jpeg" | "image/png" | "image/webp";
export type ChatVoiceMime = "audio/webm" | "audio/mp4" | "audio/ogg";
export type ChatMediaMime = ChatImageMime | ChatVoiceMime;

/** الحدودُ في مصدرٍ واحدٍ (تُطابقُ قيودَ `order_chat_attachments` والدلو). */
export const CHAT_MEDIA_LIMITS = Object.freeze({
  imageMaxBytes: 5 * 1024 * 1024,
  voiceMaxBytes: 5 * 1024 * 1024,
  imageMaxSide: 10_000,
  imageMaxPixels: 40_000_000,
  voiceMinMs: 300,
  voiceMaxMs: 120_000,
  /** هامشٌ بينَ مدّةِ الحاويةِ والحدّ: المسجِّلُ يتوقّفُ عندَ 120 ث فقد تزيدُ الحاويةُ قليلاً. */
  voiceContainerSlackMs: 2_000,
  /** عمرُ رابطِ القراءةِ الموقَّع. */
  readTtlSeconds: 300,
  /** حصّةُ كلِّ مُرسِلٍ في الطلبِ الواحد (تُطابقُ `order_chat_media_quota()`). */
  perSenderQuota: 30,
});

export const CHAT_MEDIA_MAX_BYTES: Readonly<Record<ChatMediaKind, number>> = Object.freeze({
  image: CHAT_MEDIA_LIMITS.imageMaxBytes,
  voice: CHAT_MEDIA_LIMITS.voiceMaxBytes,
});

export const CHAT_MEDIA_MIME_TYPES: readonly ChatMediaMime[] = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
]);

export type ChatMediaRejection =
  | "empty"
  | "too_large"
  | "unknown_type"
  | "kind_mismatch"
  | "malformed"
  | "dimensions"
  | "duration"
  | "not_audio";

export interface InspectedImage {
  readonly ok: true;
  readonly kind: "image";
  readonly mime: ChatImageMime;
  readonly width: number;
  readonly height: number;
  /** البايتاتُ بعدَ التنظيف — هي وحدَها ما يُخزَّن. */
  readonly bytes: Uint8Array;
  /** عددُ البايتاتِ الوصفيّةِ المُسقَطة (للاختبارِ والدليل، لا يُسجَّلُ محتواها). */
  readonly strippedBytes: number;
}

export interface InspectedVoice {
  readonly ok: true;
  readonly kind: "voice";
  readonly mime: ChatVoiceMime;
  readonly durationMs: number;
  /** هل جاءت المدّةُ من الحاويةِ نفسِها أم من تصريحِ العميل (المحدود)؟ */
  readonly durationSource: "container" | "declared";
  readonly bytes: Uint8Array;
}

export type ChatMediaVerdict =
  | InspectedImage
  | InspectedVoice
  | { readonly ok: false; readonly reason: ChatMediaRejection };

const reject = (reason: ChatMediaRejection) => ({ ok: false as const, reason });

// ── بصمةُ النوع ────────────────────────────────────────────────────────────────

function bytesAt(b: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (b.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) if (b[offset + i] !== expected[i]) return false;
  return true;
}

function asciiAt(b: Uint8Array, offset: number, text: string): boolean {
  if (b.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i += 1) if (b[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

/** النوعُ من البايتاتِ الأولى وحدَها — `null` لما ليسَ من الستّةِ المسموحة. */
export function sniffChatMediaMime(b: Uint8Array): ChatMediaMime | null {
  if (bytesAt(b, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytesAt(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (asciiAt(b, 0, "RIFF") && asciiAt(b, 8, "WEBP")) return "image/webp";
  if (bytesAt(b, 0, [0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm";
  if (asciiAt(b, 0, "OggS")) return "audio/ogg";
  if (asciiAt(b, 4, "ftyp")) return "audio/mp4";
  return null;
}

export function chatMediaKindOf(mime: ChatMediaMime): ChatMediaKind {
  return mime.startsWith("image/") ? "image" : "voice";
}

// ── أدواتُ القراءة ────────────────────────────────────────────────────────────

const u16be = (b: Uint8Array, o: number) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const u32be = (b: Uint8Array, o: number) =>
  ((b[o] ?? 0) * 0x1000000 +
    (((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0))) >>>
  0;
const u24le = (b: Uint8Array, o: number) =>
  (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16);
const u32le = (b: Uint8Array, o: number) =>
  ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16)) + (b[o + 3] ?? 0) * 0x1000000;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function dimensionsOk(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= CHAT_MEDIA_LIMITS.imageMaxSide &&
    height <= CHAT_MEDIA_LIMITS.imageMaxSide &&
    width * height <= CHAT_MEDIA_LIMITS.imageMaxPixels
  );
}

// ── JPEG ──────────────────────────────────────────────────────────────────────

/** مقاطعُ SOF التي تحملُ الأبعاد (كلُّ C0..CF إلّا DHT=C4 وJPG=C8 وDAC=CC). */
function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * يقبلُ من مقاطعِ التطبيق: APP0 (JFIF) وAPP2 إن كان ملفَّ ألوان ICC، وAPP14 (Adobe —
 * لازمٌ لتحويلِ ألوانِ CMYK). ويُسقِطُ APP1 (Exif وXMP: الموقعُ والجهازُ والوقت)، وAPP2
 * المتعدّدَ الصور (MPF)، وسائرَ APPn، والتعليقَ COM.
 */
function keepJpegSegment(marker: number, payload: Uint8Array): boolean {
  if (marker === 0xfe) return false;
  if (marker >= 0xe0 && marker <= 0xef) {
    if (marker === 0xe0) return asciiAt(payload, 0, "JFIF\0") || asciiAt(payload, 0, "JFXX\0");
    if (marker === 0xe2) return asciiAt(payload, 0, "ICC_PROFILE\0");
    if (marker === 0xee) return asciiAt(payload, 0, "Adobe");
    return false;
  }
  return true;
}

function inspectJpeg(b: Uint8Array): InspectedImage | { ok: false; reason: ChatMediaRejection } {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let at = 2;
  let width = 0;
  let height = 0;
  let sawSos = false;
  let ended = false;

  while (at < b.length && !ended) {
    if (b[at] !== 0xff) return reject("malformed");
    // بايتاتُ حشوٍ 0xFF مسموحةٌ قبلَ العلامة.
    while (at < b.length && b[at] === 0xff) at += 1;
    if (at >= b.length) return reject("malformed");
    const marker = b[at] as number;
    const markerStart = at - 1;
    at += 1;

    if (marker === 0xd9) {
      out.push(b.subarray(markerStart, at));
      ended = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(b.subarray(markerStart, at));
      continue;
    }
    if (at + 2 > b.length) return reject("malformed");
    const length = u16be(b, at);
    if (length < 2 || at + length > b.length) return reject("malformed");
    const segmentEnd = at + length;
    const payload = b.subarray(at + 2, segmentEnd);

    if (isSof(marker)) {
      if (payload.length < 5) return reject("malformed");
      height = u16be(payload, 1);
      width = u16be(payload, 3);
    }

    if (keepJpegSegment(marker, payload)) out.push(b.subarray(markerStart, segmentEnd));
    at = segmentEnd;

    if (marker === 0xda) {
      sawSos = true;
      // البياناتُ المرمَّزةُ حتّى العلامةِ التالية: 0xFF يليه 00 (حشو) أو RSTn ليسا علامة.
      const scanStart = at;
      let i = at;
      for (; i + 1 < b.length; i += 1) {
        if (b[i] !== 0xff) continue;
        const next = b[i + 1] as number;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) continue;
        break;
      }
      if (i + 1 >= b.length) return reject("malformed");
      out.push(b.subarray(scanStart, i));
      at = i;
    }
  }

  if (!ended || !sawSos) return reject("malformed");
  // ما بعدَ EOI (صورٌ مضمَّنةٌ، بياناتُ عمقٍ، ذيولٌ) يسقطُ كلُّه.
  if (!dimensionsOk(width, height)) return reject("dimensions");
  const bytes = concat(out);
  return {
    ok: true,
    kind: "image",
    mime: "image/jpeg",
    width,
    height,
    bytes,
    strippedBytes: b.length - bytes.length,
  };
}

// ── PNG ───────────────────────────────────────────────────────────────────────

/** قطعُ PNG المقبولة: الحرجةُ، وما يلزمُ للونِ والشفافيّةِ والكثافة. والباقي يسقط. */
const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "sBIT",
  "pHYs",
]);

function inspectPng(b: Uint8Array): InspectedImage | { ok: false; reason: ChatMediaRejection } {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let at = 8;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawIdat = false;
  let ended = false;

  while (at + 12 <= b.length) {
    const length = u32be(b, at);
    const type = String.fromCharCode(
      b[at + 4] ?? 0,
      b[at + 5] ?? 0,
      b[at + 6] ?? 0,
      b[at + 7] ?? 0,
    );
    const end = at + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || end > b.length) return reject("malformed");
    if (!sawIhdr && type !== "IHDR") return reject("malformed");
    if (type === "IHDR") {
      if (length !== 13) return reject("malformed");
      width = u32be(b, at + 8);
      height = u32be(b, at + 12);
      sawIhdr = true;
    }
    if (type === "IDAT") sawIdat = true;
    if (PNG_KEEP.has(type)) out.push(b.subarray(at, end));
    // قطعةٌ حرجةٌ مجهولةٌ (حرفٌ أوّلُ كبير) لا تُفكُّ بلا معرفتِها ⇒ رفضٌ لا إسقاط.
    else if (type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90) return reject("malformed");
    at = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || !sawIdat) return reject("malformed");
  if (!dimensionsOk(width, height)) return reject("dimensions");
  const bytes = concat(out);
  return {
    ok: true,
    kind: "image",
    mime: "image/png",
    width,
    height,
    bytes,
    strippedBytes: b.length - bytes.length,
  };
}

// ── WebP ──────────────────────────────────────────────────────────────────────

function inspectWebp(b: Uint8Array): InspectedImage | { ok: false; reason: ChatMediaRejection } {
  if (b.length < 20) return reject("malformed");
  const riffSize = u32le(b, 4);
  const end = Math.min(b.length, 8 + riffSize);
  if (8 + riffSize > b.length || riffSize < 12) return reject("malformed");
  const chunks: Uint8Array[] = [];
  let at = 12;
  let width = 0;
  let height = 0;
  let vp8xAt = -1;
  let sawImage = false;

  while (at + 8 <= end) {
    const fourcc = String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);
    const size = u32le(b, at + 4);
    const padded = size + (size & 1);
    const chunkEnd = at + 8 + padded;
    if (at + 8 + size > end) return reject("malformed");
    const payload = b.subarray(at + 8, at + 8 + size);

    if (fourcc === "VP8X") {
      if (size < 10) return reject("malformed");
      width = u24le(payload, 4) + 1;
      height = u24le(payload, 7) + 1;
    } else if (fourcc === "VP8 ") {
      if (size < 10 || !bytesAt(payload, 3, [0x9d, 0x01, 0x2a])) return reject("malformed");
      if (width === 0) {
        width = ((payload[6] ?? 0) | ((payload[7] ?? 0) << 8)) & 0x3fff;
        height = ((payload[8] ?? 0) | ((payload[9] ?? 0) << 8)) & 0x3fff;
      }
      sawImage = true;
    } else if (fourcc === "VP8L") {
      if (size < 5 || payload[0] !== 0x2f) return reject("malformed");
      if (width === 0) {
        const bits = u32le(payload, 1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      sawImage = true;
    } else if (fourcc === "ANMF") {
      sawImage = true;
    }

    // EXIF و«XMP » يسقطان؛ وكلُّ قطعةٍ أخرى من المواصفةِ تبقى (ALPH/ICCP/ANIM/ANMF…).
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      if (fourcc === "VP8X") vp8xAt = chunks.length;
      chunks.push(b.subarray(at, Math.min(chunkEnd, end)));
    }
    at = chunkEnd;
  }

  if (!sawImage) return reject("malformed");
  if (!dimensionsOk(width, height)) return reject("dimensions");

  if (vp8xAt >= 0) {
    // نسخةٌ من قطعةِ VP8X تُطفأُ فيها رايتا EXIF (0x08) وXMP (0x04).
    const copy = Uint8Array.from(chunks[vp8xAt] as Uint8Array);
    copy[8] = (copy[8] ?? 0) & ~0x0c;
    chunks[vp8xAt] = copy;
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 4), 0);
  const size = body.length + 4;
  header[4] = size & 0xff;
  header[5] = (size >>> 8) & 0xff;
  header[6] = (size >>> 16) & 0xff;
  header[7] = (size >>> 24) & 0xff;
  header.set(b.subarray(8, 12), 8);
  const bytes = concat([header, body]);
  return {
    ok: true,
    kind: "image",
    mime: "image/webp",
    width,
    height,
    bytes,
    strippedBytes: b.length - bytes.length,
  };
}

// ── MP4 (AAC من Safari/iOS، أو MP4 من Chromium الحديث) ────────────────────────

interface Mp4Facts {
  readonly handlers: string[];
  durationMs: number | null;
}

function walkMp4(
  b: Uint8Array,
  start: number,
  end: number,
  facts: Mp4Facts,
  depth: number,
): boolean {
  let at = start;
  while (at + 8 <= end) {
    let size = u32be(b, at);
    const type = String.fromCharCode(
      b[at + 4] ?? 0,
      b[at + 5] ?? 0,
      b[at + 6] ?? 0,
      b[at + 7] ?? 0,
    );
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return false;
      const hi = u32be(b, at + 8);
      if (hi !== 0) return false;
      size = u32be(b, at + 12);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return false;
    const payloadStart = at + header;
    const boxEnd = at + size;
    if (["moov", "trak", "mdia"].includes(type) && depth < 6) {
      if (!walkMp4(b, payloadStart, boxEnd, facts, depth + 1)) return false;
    } else if (type === "hdlr") {
      // version/flags (4) + pre_defined (4) + handler_type (4)
      if (payloadStart + 12 > boxEnd) return false;
      facts.handlers.push(
        String.fromCharCode(
          b[payloadStart + 8] ?? 0,
          b[payloadStart + 9] ?? 0,
          b[payloadStart + 10] ?? 0,
          b[payloadStart + 11] ?? 0,
        ),
      );
    } else if (type === "mvhd") {
      const version = b[payloadStart] ?? 0;
      let timescale = 0;
      let duration = 0;
      if (version === 1) {
        if (payloadStart + 32 > boxEnd) return false;
        timescale = u32be(b, payloadStart + 20);
        duration = u32be(b, payloadStart + 24) * 0x100000000 + u32be(b, payloadStart + 28);
      } else {
        if (payloadStart + 20 > boxEnd) return false;
        timescale = u32be(b, payloadStart + 12);
        duration = u32be(b, payloadStart + 16);
      }
      // MP4 المجزّأُ (MediaRecorder) يكتبُ مدّةً صفراً أو قصوى: لا تُعَدُّ معلومة.
      if (timescale > 0 && duration > 0 && duration < 0xffffffff) {
        facts.durationMs = Math.round((duration / timescale) * 1000);
      }
    }
    at = boxEnd;
  }
  return true;
}

function inspectMp4(
  b: Uint8Array,
): { ok: true; durationMs: number | null } | { ok: false; reason: ChatMediaRejection } {
  const facts: Mp4Facts = { handlers: [], durationMs: null };
  if (!walkMp4(b, 0, b.length, facts, 0)) return reject("malformed");
  if (facts.handlers.includes("vide")) return reject("not_audio");
  if (!facts.handlers.includes("soun")) return reject("not_audio");
  return { ok: true, durationMs: facts.durationMs };
}

// ── WebM (Opus من Chromium/Android وSafari 18.4+) ──────────────────────────────

function readVint(
  b: Uint8Array,
  at: number,
  keepMarker: boolean,
): { value: number; length: number; unknown: boolean } | null {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while ((first & mask) === 0 && length < 8) {
    mask >>= 1;
    length += 1;
  }
  if (at + length > b.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i += 1) {
    const byte = b[at + i] as number;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

const EBML_SEGMENT = 0x18538067;
const EBML_INFO = 0x1549a966;
const EBML_TRACKS = 0x1654ae6b;
const EBML_TRACK_ENTRY = 0xae;
const EBML_TRACK_TYPE = 0x83;
const EBML_CLUSTER = 0x1f43b675;
const EBML_DURATION = 0x4489;
const EBML_TIMECODE_SCALE = 0x2ad7b1;
const EBML_DOCTYPE = 0x4282;
const EBML_HEADER = 0x1a45dfa3;

interface WebmFacts {
  docType: string | null;
  trackTypes: number[];
  duration: number | null;
  timecodeScale: number;
}

function readFloat(b: Uint8Array, at: number, size: number): number | null {
  const view = new DataView(b.buffer, b.byteOffset + at, size);
  if (size === 4) return view.getFloat32(0);
  if (size === 8) return view.getFloat64(0);
  return null;
}

function readUint(b: Uint8Array, at: number, size: number): number {
  let v = 0;
  for (let i = 0; i < size; i += 1) v = v * 256 + (b[at + i] as number);
  return v;
}

function walkEbml(
  b: Uint8Array,
  start: number,
  end: number,
  facts: WebmFacts,
  depth: number,
): boolean {
  let at = start;
  while (at < end) {
    const id = readVint(b, at, true);
    if (id === null) return false;
    const size = readVint(b, at + id.length, false);
    if (size === null) return false;
    const dataStart = at + id.length + size.length;
    // الحجمُ المجهولُ (MediaRecorder يكتبُه للمقطعِ والعناقيد): يمتدُّ حتّى نهايةِ الأب.
    const dataEnd = size.unknown ? end : dataStart + size.value;
    if (dataEnd > end) {
      // ملفٌّ مبتورٌ داخلَ عنقود: المساراتُ قبلَه قُرئت، فلا يُرفَضُ لذلك وحدَه.
      return facts.trackTypes.length > 0 && id.value === EBML_CLUSTER;
    }
    switch (id.value) {
      case EBML_HEADER:
      case EBML_SEGMENT:
      case EBML_INFO:
      case EBML_TRACKS:
      case EBML_TRACK_ENTRY:
        if (depth > 6 || !walkEbml(b, dataStart, dataEnd, facts, depth + 1)) return false;
        break;
      case EBML_DOCTYPE:
        facts.docType = new TextDecoder().decode(b.subarray(dataStart, dataEnd));
        break;
      case EBML_TRACK_TYPE:
        facts.trackTypes.push(readUint(b, dataStart, size.value));
        break;
      case EBML_TIMECODE_SCALE:
        facts.timecodeScale = readUint(b, dataStart, size.value);
        break;
      case EBML_DURATION:
        facts.duration = readFloat(b, dataStart, size.value);
        break;
      case EBML_CLUSTER:
        // المساراتُ تسبقُ العناقيدَ في كلِّ ما يكتبُه المتصفّح؛ لا حاجةَ لقراءةِ الصوتِ نفسِه.
        return true;
      default:
        break;
    }
    at = dataEnd;
  }
  return true;
}

function inspectWebm(
  b: Uint8Array,
): { ok: true; durationMs: number | null } | { ok: false; reason: ChatMediaRejection } {
  const facts: WebmFacts = {
    docType: null,
    trackTypes: [],
    duration: null,
    timecodeScale: 1_000_000,
  };
  if (!walkEbml(b, 0, b.length, facts, 0)) return reject("malformed");
  if (facts.docType !== "webm" && facts.docType !== "matroska") return reject("malformed");
  if (facts.trackTypes.includes(1)) return reject("not_audio");
  if (!facts.trackTypes.includes(2)) return reject("not_audio");
  const durationMs =
    facts.duration !== null && Number.isFinite(facts.duration) && facts.duration > 0
      ? Math.round((facts.duration * facts.timecodeScale) / 1_000_000)
      : null;
  return { ok: true, durationMs };
}

// ── Ogg (Opus من Firefox) ─────────────────────────────────────────────────────

function inspectOgg(
  b: Uint8Array,
): { ok: true; durationMs: number | null } | { ok: false; reason: ChatMediaRejection } {
  if (b.length < 47 || !asciiAt(b, 0, "OggS")) return reject("malformed");
  const segments = b[26] ?? 0;
  const packetAt = 27 + segments;
  if (!asciiAt(b, packetAt, "OpusHead")) return reject("not_audio");
  const preSkip = (b[packetAt + 10] ?? 0) | ((b[packetAt + 11] ?? 0) << 8);
  // آخرُ صفحةٍ: موضعُها الحُبيبيُّ (granule) بعيّناتِ 48 كيلوهرتز هو المدّة.
  for (let i = b.length - 27; i > 0; i -= 1) {
    if (!asciiAt(b, i, "OggS")) continue;
    const low = u32le(b, i + 6);
    const high = u32le(b, i + 10);
    if (high !== 0 || low === 0xffffffff) return { ok: true, durationMs: null };
    const samples = Math.max(0, low - preSkip);
    return { ok: true, durationMs: Math.round(samples / 48) };
  }
  return { ok: true, durationMs: null };
}

// ── الواجهةُ العامّة ────────────────────────────────────────────────────────────

/**
 * الحكمُ الواحد: النوعُ المطلوبُ (`image` أو `voice`) يُصرِّحُ به العميل، وكلُّ ما سواه
 * من البايتات. `declaredDurationMs` لا يُقبَلُ إلّا داخلَ الحدود، وتغلبُه مدّةُ الحاويةِ
 * إن وُجدَت.
 */
export function inspectChatMedia(input: {
  readonly kind: ChatMediaKind;
  readonly bytes: Uint8Array;
  readonly declaredDurationMs?: number | null;
}): ChatMediaVerdict {
  const { bytes } = input;
  if (bytes.length === 0) return reject("empty");
  if (bytes.length > CHAT_MEDIA_MAX_BYTES[input.kind]) return reject("too_large");
  const mime = sniffChatMediaMime(bytes);
  if (mime === null) return reject("unknown_type");
  if (chatMediaKindOf(mime) !== input.kind) return reject("kind_mismatch");

  if (mime === "image/jpeg") return inspectJpeg(bytes);
  if (mime === "image/png") return inspectPng(bytes);
  if (mime === "image/webp") return inspectWebp(bytes);

  const container =
    mime === "audio/mp4"
      ? inspectMp4(bytes)
      : mime === "audio/webm"
        ? inspectWebm(bytes)
        : inspectOgg(bytes);
  if (!container.ok) return container;

  const declared = input.declaredDurationMs ?? null;
  const declaredOk =
    declared !== null &&
    Number.isInteger(declared) &&
    declared >= CHAT_MEDIA_LIMITS.voiceMinMs &&
    declared <= CHAT_MEDIA_LIMITS.voiceMaxMs;

  if (container.durationMs !== null) {
    if (
      container.durationMs >
      CHAT_MEDIA_LIMITS.voiceMaxMs + CHAT_MEDIA_LIMITS.voiceContainerSlackMs
    ) {
      return reject("duration");
    }
    const clamped = Math.min(
      CHAT_MEDIA_LIMITS.voiceMaxMs,
      Math.max(CHAT_MEDIA_LIMITS.voiceMinMs, container.durationMs),
    );
    return {
      ok: true,
      kind: "voice",
      mime,
      durationMs: clamped,
      durationSource: "container",
      bytes,
    };
  }
  if (!declaredOk) return reject("duration");
  return { ok: true, kind: "voice", mime, durationMs: declared, durationSource: "declared", bytes };
}
