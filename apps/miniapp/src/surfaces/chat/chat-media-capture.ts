/**
 * الغرض: `WR-34` (ADR 0305) — تجهيزُ وسائطِ المحادثةِ على الجهاز قبلَ رفعِها:
 *   ١. الصورة: تُصغَّرُ إلى ضلعٍ أقصاه 1600px وتُعادُ ترميزاً JPEG (≈0.82) على لوحٍ (`canvas`) —
 *      فيخفُّ الرفعُ على شبكةٍ ضعيفة، ويسقطُ كلُّ وصفٍ (EXIF/GPS) **قبلَ** أن يغادرَ الجهاز.
 *      والخادمُ يفحصُ وينظِّفُ من جديدٍ ولا يثقُ بهذا (طبقتان لا طبقةٌ واحدة).
 *   ٢. الصوت: نوعُ التسجيلِ بحسبِ ما يدعمُه المتصفّح — `audio/mp4` (AAC؛ Safari/iOS وWebView
 *      تيليجرام على iOS) أوّلاً، ثمَّ `audio/webm;codecs=opus` (Chrome/Android وWebView تيليجرام
 *      على Android)، ثمَّ `audio/ogg;codecs=opus` (Firefox). والرفضُ يُصنَّفُ: إذنٌ مرفوضٌ،
 *      أو لا ميكروفون، أو متصفّحٌ لا يدعم — ولكلٍّ رسالتُه.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/chat
 *
 * لا يُحفَظُ شيءٌ في الجهاز: البايتاتُ في الذاكرةِ حتّى تُرفَعَ أو تُلغى.
 */

export const CHAT_IMAGE_MAX_SIDE = 1600;
export const CHAT_IMAGE_QUALITY = 0.82;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PreparedImage =
  | {
      readonly ok: true;
      readonly blob: Blob;
      readonly width: number | null;
      readonly height: number | null;
    }
  | { readonly ok: false; readonly reason: "too_large" | "unsupported" };

interface DecodedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  readonly release: () => void;
}

async function decode(file: Blob): Promise<DecodedImage | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      /* يُجرَّبُ وسمُ الصورةِ أدناه */
    }
  }
  if (typeof Image === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = await new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = url;
    });
    if (!loaded || image.naturalWidth === 0) {
      URL.revokeObjectURL(url);
      return null;
    }
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/** الحجمُ بعدَ التصغير: الضلعُ الأطولُ لا يتجاوزُ الحدّ، والنسبةُ كما هي. */
export function fitWithin(
  width: number,
  height: number,
  maxSide = CHAT_IMAGE_MAX_SIDE,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * يجهِّزُ الصورةَ المختارة. إن تعذّرَ اللوحُ (بيئةٌ بلا `canvas`) أُرسِلَ الأصلُ إن كانَ من
 * الأنواعِ الثلاثةِ وضمنَ الحدّ — والخادمُ ينزعُ وصفَه على كلِّ حال.
 */
export async function prepareChatImage(file: Blob, maxBytes: number): Promise<PreparedImage> {
  const declared = file.type.toLowerCase();
  if (declared.length > 0 && !declared.startsWith("image/")) {
    return { ok: false, reason: "unsupported" };
  }
  const decoded = await decode(file);
  if (decoded === null) {
    // لا يُفكُّ هنا (HEIC على متصفّحٍ لا يدعمه مثلًا) — لا نرسلُ ما لن يقبلَه الخادم.
    if (ACCEPTED_IMAGE_TYPES.has(declared) && file.size <= maxBytes) {
      return { ok: true, blob: file, width: null, height: null };
    }
    return { ok: false, reason: "unsupported" };
  }
  try {
    const size = fitWithin(decoded.width, decoded.height);
    const canvas = typeof document === "undefined" ? null : document.createElement("canvas");
    const context = canvas?.getContext("2d") ?? null;
    if (canvas === null || context === null) {
      if (ACCEPTED_IMAGE_TYPES.has(declared) && file.size <= maxBytes) {
        return { ok: true, blob: file, width: decoded.width, height: decoded.height };
      }
      return { ok: false, reason: file.size > maxBytes ? "too_large" : "unsupported" };
    }
    canvas.width = size.width;
    canvas.height = size.height;
    // خلفيّةٌ بيضاءُ: PNG الشفّافُ يصيرُ JPEG بلا سوادٍ في الخلفيّة.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(decoded.source, 0, 0, size.width, size.height);
    let blob = await toBlob(canvas, "image/jpeg", CHAT_IMAGE_QUALITY);
    if (blob !== null && blob.size > maxBytes) blob = await toBlob(canvas, "image/jpeg", 0.6);
    if (blob === null) return { ok: false, reason: "unsupported" };
    if (blob.size > maxBytes) return { ok: false, reason: "too_large" };
    return { ok: true, blob, width: size.width, height: size.height };
  } finally {
    decoded.release();
  }
}

/** ترتيبُ التفضيل — موثَّقٌ في ADR 0305 §الصيغ. */
export const VOICE_MIME_CANDIDATES = [
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
] as const;

interface RecorderGlobals {
  readonly MediaRecorder?: {
    isTypeSupported?: (type: string) => boolean;
    new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
  };
  readonly navigator?: {
    readonly mediaDevices?: { getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream> };
  };
}

export function pickVoiceMime(env: RecorderGlobals = globalThis as RecorderGlobals): string | null {
  const recorder = env.MediaRecorder;
  if (recorder === undefined) return null;
  const supports = recorder.isTypeSupported;
  if (typeof supports !== "function") return "";
  for (const candidate of VOICE_MIME_CANDIDATES) {
    try {
      if (supports.call(recorder, candidate)) return candidate;
    } catch {
      /* التالي */
    }
  }
  return null;
}

export function voiceRecordingSupported(
  env: RecorderGlobals = globalThis as RecorderGlobals,
): boolean {
  return (
    typeof env.navigator?.mediaDevices?.getUserMedia === "function" &&
    env.MediaRecorder !== undefined &&
    pickVoiceMime(env) !== null
  );
}

export type VoiceStartFailure = "denied" | "unsupported" | "no_device" | "failed";

export class VoiceStartError extends Error {
  readonly reason: VoiceStartFailure;
  constructor(reason: VoiceStartFailure) {
    super(reason);
    this.name = "VoiceStartError";
    this.reason = reason;
  }
}

export function classifyMicError(error: unknown): VoiceStartFailure {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "denied";
  }
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  ) {
    return "no_device";
  }
  if (name === "NotSupportedError" || name === "TypeError") return "unsupported";
  return "failed";
}

export interface RecordedVoice {
  readonly blob: Blob;
  readonly durationMs: number;
}

export interface VoiceRecording {
  /** يُنهي التسجيلَ ويعيدُ الملفّ — والمدّةُ مقيسةٌ بساعةِ الجهازِ من البدءِ إلى الإيقاف. */
  stop(): Promise<RecordedVoice>;
  /** يُلغي بلا ملفّ، ويُطفئُ الميكروفونَ فوراً. */
  cancel(): void;
  readonly startedAt: number;
}

export type StartVoiceRecording = (options: {
  readonly maxMs: number;
  readonly onAutoStop: () => void;
}) => Promise<VoiceRecording>;

/** البدءُ الفعليُّ على المتصفّح — يُستبدَلُ في الاختبار. */
export const startBrowserVoiceRecording: StartVoiceRecording = async ({ maxMs, onAutoStop }) => {
  const env = globalThis as RecorderGlobals;
  const getUserMedia = env.navigator?.mediaDevices?.getUserMedia;
  const Recorder = env.MediaRecorder;
  const mime = pickVoiceMime(env);
  if (typeof getUserMedia !== "function" || Recorder === undefined || mime === null) {
    throw new VoiceStartError("unsupported");
  }
  let stream: MediaStream;
  try {
    stream = await getUserMedia.call(env.navigator?.mediaDevices, { audio: true, video: false });
  } catch (error) {
    throw new VoiceStartError(classifyMicError(error));
  }
  const release = () => {
    for (const track of stream.getTracks()) track.stop();
  };
  let recorder: MediaRecorder;
  try {
    recorder = new Recorder(stream, mime.length > 0 ? { mimeType: mime } : undefined);
  } catch {
    release();
    throw new VoiceStartError("unsupported");
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const startedAt = Date.now();
  try {
    recorder.start(1000);
  } catch {
    release();
    throw new VoiceStartError("failed");
  }
  const timer = setTimeout(onAutoStop, maxMs);
  let finished = false;
  return {
    startedAt,
    stop: () =>
      new Promise<RecordedVoice>((resolve, reject) => {
        if (finished) {
          reject(new VoiceStartError("failed"));
          return;
        }
        finished = true;
        clearTimeout(timer);
        const durationMs = Math.min(Date.now() - startedAt, maxMs);
        recorder.onstop = () => {
          release();
          const type = recorder.mimeType.length > 0 ? recorder.mimeType : mime;
          resolve({
            blob: new Blob(chunks, { type: type.length > 0 ? type : "audio/webm" }),
            durationMs,
          });
        };
        recorder.onerror = () => {
          release();
          reject(new VoiceStartError("failed"));
        };
        try {
          recorder.stop();
        } catch {
          release();
          reject(new VoiceStartError("failed"));
        }
      }),
    cancel: () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      recorder.ondataavailable = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* لا شيء */
      }
      release();
    },
  };
};

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;
}
