/**
 * الغرض: `WR-34` (ADR 0305) — وسائطُ المحادثةِ في Mini App: تحويلُ رسالةِ الوسيط، أسبابُ الرفض،
 *   ذاكرةُ الروابطِ القصيرة، صفحاتُ الأقدم، اختيارُ صيغةِ التسجيل، رفضُ الميكروفونِ وغيابُه،
 *   التسجيلُ الفعليُّ بمُسجِّلٍ مُحاكى، عرضُ الفقاعاتِ باتّجاهِ RTL، وتنبيهُ سلامةِ السائق.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/chat
 */

import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ar from "../../../../../packages/shared/i18n/miniapp/ar.json";
import en from "../../../../../packages/shared/i18n/miniapp/en.json";
import ur from "../../../../../packages/shared/i18n/miniapp/ur.json";
import { ApiError } from "../../api/client.ts";
import { ChatImage, ChatVoice, createLinkCache } from "./ChatMedia.tsx";
import {
  classifyMicError,
  fitWithin,
  formatDuration,
  pickVoiceMime,
  startBrowserVoiceRecording,
  VOICE_MIME_CANDIDATES,
  VoiceStartError,
  voiceRecordingSupported,
} from "./chat-media-capture.ts";
import {
  MessageRow,
  mediaFailureMessage,
  micMessage,
  OrderChat,
  type OrderChatLabels,
} from "./OrderChat.tsx";
import {
  applyHistoryPage,
  applyThread,
  type ChatApi,
  type ChatMessage,
  type ChatWireMessage,
  type ChatWireThread,
  fromWireMessage,
  mediaFailureOf,
} from "./order-chat-client.ts";

const HERE = new URL(".", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, HERE), "utf8");

/** كلُّ مفتاحٍ يُعادُ «باسمِه» — يكفي لإثباتِ أيِّ نصٍّ يُعرَض. */
const labels = new Proxy({} as OrderChatLabels, {
  get: (_t, key) => (typeof key === "string" ? `«${key}»` : undefined),
});
/** تسمياتُ الراكب: بلا مفاتيحِ السلامة (كما تمرّرُها ActiveRideScreen). */
const riderLabels = new Proxy({} as OrderChatLabels, {
  get: (_t, key) =>
    typeof key === "string" && !key.startsWith("driverSafety") ? `«${key}»` : undefined,
});

const silentApi: ChatApi = {
  fetchAfter: () => new Promise(() => undefined),
  send: () => new Promise(() => undefined),
  markRead: () => Promise.resolve(undefined),
};

const ATTACHMENT_ID = "6f9f3a1e-1c0a-4b1e-9a51-2a8c8c3f0d11";

function wireMedia(kind: "image" | "voice", over: Partial<ChatWireMessage> = {}): ChatWireMessage {
  return {
    id: `m-${kind}`,
    seq: 7,
    sender_role: "driver",
    mine: false,
    client_message_id: null,
    body: kind === "image" ? "📷" : "🎤",
    created_at: "2026-11-03T10:00:00Z",
    kind,
    location: null,
    translation: { text: "ترجمة لا تُعرض", from: "en", to: "ar" },
    attachment: {
      id: ATTACHMENT_ID,
      kind,
      mime_type: kind === "image" ? "image/jpeg" : "audio/webm",
      byte_size: 1234,
      width: kind === "image" ? 800 : null,
      height: kind === "image" ? 600 : null,
      duration_ms: kind === "voice" ? 4200 : null,
      available: true,
    },
    ...over,
  } as ChatWireMessage;
}

function wireThread(over: Partial<ChatWireThread> = {}): ChatWireThread {
  return {
    order: { id: "o", service: "ride", status: "assigned", writable: true },
    my_role: "rider",
    counterpart: { first_name: "سالم" },
    messages: [],
    last_seq: 0,
    my_last_read_seq: 0,
    counterpart_last_read_seq: 0,
    unread: 0,
    ...over,
  } as ChatWireThread;
}

describe("WR-34 — رسائلُ الوسائطِ من الخادم", () => {
  it("الصورةُ والتسجيلُ يبقيانِ بنوعِهما ومرفقِهما، ولا ترجمةَ على الوسيط", () => {
    const image = fromWireMessage(wireMedia("image"));
    expect(image.kind).toBe("image");
    expect(image.attachment).toEqual({
      id: ATTACHMENT_ID,
      kind: "image",
      mimeType: "image/jpeg",
      byteSize: 1234,
      width: 800,
      height: 600,
      durationMs: null,
      available: true,
    });
    expect(image.translation).toBeNull();
    const voice = fromWireMessage(wireMedia("voice"));
    expect(voice.kind).toBe("voice");
    expect(voice.attachment?.durationMs).toBe(4200);
    expect(voice.translation).toBeNull();
  });

  it("مرفقٌ لا يطابقُ نوعَ الرسالةِ أو غائبٌ ⇒ بلا مرفق (يُعرَضُ «غيرَ متاح»)", () => {
    const mismatch = fromWireMessage(
      wireMedia("image", {
        attachment: { ...wireMedia("voice").attachment, kind: "voice" },
      } as Partial<ChatWireMessage>),
    );
    expect(mismatch.kind).toBe("image");
    expect(mismatch.attachment).toBeNull();
    const missing = fromWireMessage(wireMedia("voice", { attachment: null }));
    expect(missing.attachment).toBeNull();
  });

  it("النصُّ يحتفظُ بترجمتِه كما كان (الترجمةُ الآليّةُ لم تنكسر)", () => {
    const text = fromWireMessage(
      wireMedia("image", { kind: "text", body: "hello", attachment: null }),
    );
    expect(text.kind).toBe("text");
    expect(text.translation?.text).toBe("ترجمة لا تُعرض");
  });

  it("قدرةُ الوسائطِ من الخادم، وغيابُها ⇒ موقوفة", () => {
    const off = applyThread(null, wireThread());
    expect(off.media.enabled).toBe(false);
    const on = applyThread(
      null,
      wireThread({
        media: {
          enabled: true,
          image_max_bytes: 5_242_880,
          voice_max_bytes: 5_242_880,
          voice_max_ms: 120_000,
        },
      }),
    );
    expect(on.media).toEqual({
      enabled: true,
      imageMaxBytes: 5_242_880,
      voiceMaxBytes: 5_242_880,
      voiceMaxMs: 120_000,
    });
  });

  it("صفحةُ الأقدمِ تُدمَجُ بلا تكرارٍ وتقرّرُ وحدَها hasOlder", () => {
    const tail = applyHistoryPage(
      null,
      wireThread({
        messages: [
          wireMedia("image", { id: "a", seq: 61 }),
          wireMedia("voice", { id: "b", seq: 62 }),
        ],
        last_seq: 62,
        has_older: true,
      }),
    );
    expect(tail.hasOlder).toBe(true);
    // التزايديُّ لا يغيّرُ hasOlder.
    const after = applyThread(tail, wireThread({ messages: [], last_seq: 62 }));
    expect(after.hasOlder).toBe(true);
    const older = applyHistoryPage(
      after,
      wireThread({
        messages: [
          wireMedia("image", { id: "z", seq: 1 }),
          wireMedia("image", { id: "a", seq: 61 }),
        ],
        last_seq: 62,
        has_older: false,
      }),
    );
    expect(older.messages.map((m) => m.seq)).toEqual([1, 61, 62]);
    expect(older.hasOlder).toBe(false);
  });
});

describe("WR-34 — أسبابُ فشلِ الرفع", () => {
  it("الرموزُ الدائمةُ تُصنَّف، والعابرةُ (شبكة/5xx/جلسة) ⇒ null فتبقى قابلةً لإعادةِ المحاولة", () => {
    expect(mediaFailureOf(new ApiError(413, "MEDIA_TOO_LARGE", "x"))).toBe("too_large");
    expect(mediaFailureOf(new ApiError(415, "MEDIA_TYPE_UNSUPPORTED", "x"))).toBe("unsupported");
    expect(mediaFailureOf(new ApiError(422, "MEDIA_DURATION_INVALID", "x"))).toBe("unsupported");
    expect(mediaFailureOf(new ApiError(429, "MEDIA_QUOTA", "x"))).toBe("quota");
    expect(mediaFailureOf(new ApiError(503, "MEDIA_DISABLED", "x"))).toBe("disabled");
    expect(mediaFailureOf(new ApiError(503, "MEDIA_STORE_UNAVAILABLE", "x"))).toBeNull();
    expect(mediaFailureOf(new ApiError(401, "SESSION_INVALID", "x"))).toBeNull();
    expect(mediaFailureOf(new Error("offline"))).toBeNull();
    expect(mediaFailureOf(new ApiError(400, "MALFORMED", "x"))).toBe("other");
  });

  it("كلُّ سببٍ له نصُّه", () => {
    expect(mediaFailureMessage(labels, "too_large")).toBe("«mediaTooLarge»");
    expect(mediaFailureMessage(labels, "unsupported")).toBe("«mediaUnsupported»");
    expect(mediaFailureMessage(labels, "quota")).toBe("«mediaQuota»");
    expect(mediaFailureMessage(labels, "disabled")).toBe("«mediaDisabled»");
    expect(mediaFailureMessage(labels, "other")).toBe("«mediaFailed»");
  });
});

describe("WR-34 — روابطُ القراءةِ القصيرة", () => {
  it("يُعادُ استعمالُ الرابطِ ما بقيَ له أكثرُ من 30 ث، ثمّ يُجدَّد، و fresh يُجدِّدُ دائماً", async () => {
    let now = Date.parse("2026-11-03T10:00:00Z");
    let calls = 0;
    const get = createLinkCache(
      async (id) => {
        calls += 1;
        return {
          url: `/storage/v1/object/sign/order-chat-media/${id}?token=t${String(calls)}`,
          expiresAt: new Date(now + 300_000).toISOString(),
          mimeType: "image/jpeg",
        };
      },
      () => now,
    );
    const first = await get(ATTACHMENT_ID);
    expect((await get(ATTACHMENT_ID)).url).toBe(first.url);
    expect(calls).toBe(1);
    now += 271_000; // بقي 29 ث
    expect((await get(ATTACHMENT_ID)).url).not.toBe(first.url);
    expect(calls).toBe(2);
    await get(ATTACHMENT_ID, true);
    expect(calls).toBe(3);
  });
});

describe("WR-34 — التقاطُ الصورة", () => {
  it("التصغيرُ يحفظُ النسبةَ ولا يكبّرُ الصغير", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1080, 2400)).toEqual({ width: 720, height: 1600 });
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it("المُدخلُ يقبلُ الأنواعَ الثلاثةَ وحدَها", () => {
    const source = read("./OrderChat.tsx");
    expect(source).toContain('accept="image/jpeg,image/png,image/webp"');
  });
});

describe("WR-34 — التسجيلُ الصوتيّ", () => {
  const originalNavigator = globalThis.navigator;
  const g = globalThis as unknown as Record<string, unknown>;
  const originalRecorder = g.MediaRecorder;
  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    g.MediaRecorder = originalRecorder;
  });

  function fakeRecorderClass(supported: readonly string[]) {
    return class FakeRecorder {
      static isTypeSupported(type: string) {
        return supported.includes(type);
      }
      static last: FakeRecorder | null = null;
      state: "inactive" | "recording" = "inactive";
      mimeType: string;
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_stream: unknown, options?: { mimeType?: string }) {
        this.mimeType = options?.mimeType ?? "";
        FakeRecorder.last = this;
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]) });
        queueMicrotask(() => this.onstop?.());
      }
    };
  }

  function fakeStream() {
    const stopped: string[] = [];
    return {
      stopped,
      stream: { getTracks: () => [{ stop: () => stopped.push("audio") }] },
    };
  }

  it("ترتيبُ الصيغ: mp4 أوّلاً (iOS) ثمّ webm/opus ثمّ ogg", () => {
    expect(VOICE_MIME_CANDIDATES[0]).toBe("audio/mp4");
    expect(
      pickVoiceMime({
        MediaRecorder: fakeRecorderClass([
          "audio/webm;codecs=opus",
          "audio/ogg;codecs=opus",
        ]) as never,
      }),
    ).toBe("audio/webm;codecs=opus");
    expect(pickVoiceMime({ MediaRecorder: fakeRecorderClass(["audio/mp4"]) as never })).toBe(
      "audio/mp4",
    );
    expect(pickVoiceMime({ MediaRecorder: fakeRecorderClass([]) as never })).toBeNull();
    expect(pickVoiceMime({})).toBeNull();
  });

  it("بلا getUserMedia أو MediaRecorder ⇒ غيرُ مدعوم (لا زرَّ تسجيل)", () => {
    expect(voiceRecordingSupported({})).toBe(false);
    expect(
      voiceRecordingSupported({
        MediaRecorder: fakeRecorderClass(["audio/webm"]) as never,
        navigator: {},
      }),
    ).toBe(false);
    expect(
      voiceRecordingSupported({
        MediaRecorder: fakeRecorderClass(["audio/webm"]) as never,
        navigator: { mediaDevices: { getUserMedia: async () => ({}) as MediaStream } },
      }),
    ).toBe(true);
  });

  it("تصنيفُ أخطاءِ الميكروفون", () => {
    expect(classifyMicError({ name: "NotAllowedError" })).toBe("denied");
    expect(classifyMicError({ name: "SecurityError" })).toBe("denied");
    expect(classifyMicError({ name: "NotFoundError" })).toBe("no_device");
    expect(classifyMicError({ name: "NotSupportedError" })).toBe("unsupported");
    expect(classifyMicError(new Error("x"))).toBe("failed");
    expect(micMessage(labels, "denied")).toBe("«micDenied»");
    expect(micMessage(labels, "unsupported")).toBe("«micUnsupported»");
    expect(micMessage(labels, "no_device")).toBe("«micNoDevice»");
    expect(micMessage(labels, "too_short")).toBe("«voiceTooShort»");
    expect(micMessage(labels, "failed")).toBe("«micFailed»");
  });

  it("رفضُ إذنِ الميكروفون ⇒ VoiceStartError(denied) ولا مُسجِّلَ يُنشأ", async () => {
    const Recorder = fakeRecorderClass(["audio/webm"]);
    g.MediaRecorder = Recorder;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: {
        mediaDevices: {
          getUserMedia: async () => {
            throw Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
          },
        },
      },
    });
    Recorder.last = null;
    const failure = await startBrowserVoiceRecording({
      maxMs: 120_000,
      onAutoStop: () => {},
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(VoiceStartError);
    expect((failure as VoiceStartError).reason).toBe("denied");
    expect(Recorder.last).toBeNull();
  });

  it("بلا MediaRecorder ⇒ unsupported", async () => {
    g.MediaRecorder = undefined;
    const failure = await startBrowserVoiceRecording({ maxMs: 1000, onAutoStop: () => {} }).catch(
      (e: unknown) => e,
    );
    expect((failure as VoiceStartError).reason).toBe("unsupported");
  });

  it("بدءٌ وإيقاف ⇒ ملفٌّ بنوعِ المسجِّلِ ومدّةٌ مقيسة، والميكروفونُ يُطفأ", async () => {
    const Recorder = fakeRecorderClass(["audio/webm;codecs=opus"]);
    g.MediaRecorder = Recorder;
    const { stream, stopped } = fakeStream();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: { mediaDevices: { getUserMedia: async () => stream } },
    });
    const recording = await startBrowserVoiceRecording({ maxMs: 120_000, onAutoStop: () => {} });
    expect(Recorder.last?.state).toBe("recording");
    const result = await recording.stop();
    expect(result.blob.type).toBe("audio/webm;codecs=opus");
    expect(result.blob.size).toBe(4);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(stopped).toEqual(["audio"]);
  });

  it("الإلغاءُ يُطفئُ الميكروفونَ بلا ملف", async () => {
    g.MediaRecorder = fakeRecorderClass(["audio/mp4"]);
    const { stream, stopped } = fakeStream();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: { mediaDevices: { getUserMedia: async () => stream } },
    });
    const recording = await startBrowserVoiceRecording({ maxMs: 120_000, onAutoStop: () => {} });
    recording.cancel();
    expect(stopped).toEqual(["audio"]);
    await expect(recording.stop()).rejects.toBeInstanceOf(VoiceStartError);
  });

  it("الإيقافُ التلقائيُّ عندَ الحدِّ الأقصى", async () => {
    g.MediaRecorder = fakeRecorderClass(["audio/webm"]);
    const { stream } = fakeStream();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: { mediaDevices: { getUserMedia: async () => stream } },
    });
    let auto = false;
    const recording = await startBrowserVoiceRecording({
      maxMs: 20,
      onAutoStop: () => {
        auto = true;
      },
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(auto).toBe(true);
    const result = await recording.stop();
    expect(result.durationMs).toBeLessThanOrEqual(20);
  });

  it("تنسيقُ المدّة", () => {
    expect(formatDuration(4200)).toBe("0:04");
    expect(formatDuration(120_000)).toBe("2:00");
    expect(formatDuration(null)).toBe("0:00");
  });
});

function mediaMessage(kind: "image" | "voice", over: Partial<ChatMessage> = {}): ChatMessage {
  return { ...fromWireMessage(wireMedia(kind)), ...over };
}

function row(message: ChatMessage, localUrl: string | null = null) {
  return renderToStaticMarkup(
    <ul>
      <MessageRow
        message={message}
        seen={false}
        showingOriginal={false}
        localUrl={localUrl}
        labels={labels}
        getLink={async () => ({
          url: "/x",
          expiresAt: "2099-01-01T00:00:00Z",
          mimeType: "image/jpeg",
        })}
        onToggleOriginal={() => {}}
        renderLocation={() => null}
      />
    </ul>,
  );
}

describe("WR-34 — فقاعاتُ الوسائط", () => {
  it("الصورةُ في فقاعتِها بإطارِ أبعادِها، ولا رابطَ في الترميزِ قبلَ الطلب", () => {
    const html = row(mediaMessage("image"));
    expect(html).toContain("ocht__msg--theirs ocht__msg--media");
    // قبلَ أن تظهرَ في الشاشة: إطارٌ بأبعادِ الصورةِ (بلا قفزٍ في التخطيط) وحالةُ تحميل،
    // ولا رابطَ يُطلَبُ أو يُضمَّنُ في الترميز.
    expect(html).toContain("aspect-ratio:800 / 600");
    expect(html).toContain("«mediaLoading»");
    expect(html).not.toContain("/storage/v1/object");
  });

  it("المعلَّقُ يُعرَضُ من معاينتِه المحلّيّة", () => {
    const html = row(mediaMessage("image", { mine: true }), "blob:local-preview");
    expect(html).toContain('src="blob:local-preview"');
    expect(html).toContain("ocht__msg--mine");
  });

  it("الصوتُ: زرُّ تشغيلٍ ومدّةٌ في الفقاعة، بلا تشغيلٍ تلقائيّ", () => {
    const html = row(mediaMessage("voice"));
    expect(html).toContain("«play»");
    expect(html).toContain("0:04");
    expect(html).not.toMatch(/autoplay/i);
  });

  it("الملفُّ المنتهي ⇒ «انتهت مدّته» لا صورةٌ مكسورة", () => {
    const expired = mediaMessage("image");
    const html = renderToStaticMarkup(
      <ChatImage
        attachment={{
          ...(expired.attachment as NonNullable<ChatMessage["attachment"]>),
          available: false,
        }}
        getLink={null}
        labels={labels}
      />,
    );
    expect(html).toContain("«mediaExpired»");
    expect(html).not.toContain("<img");
    const voice = renderToStaticMarkup(
      <ChatVoice
        attachment={{
          ...(mediaMessage("voice").attachment as NonNullable<ChatMessage["attachment"]>),
          available: false,
        }}
        durationMs={4200}
        getLink={null}
        labels={labels}
      />,
    );
    expect(voice).toContain("«mediaExpired»");
  });
});

describe("WR-34 — الواجهةُ العربيّة RTL", () => {
  it("حقلُ الكتابةِ متعدّدُ الأسطرِ باتّجاهٍ تلقائيّ، والنصُّ العربيُّ يُعرَضُ كما هو", () => {
    const html = renderToStaticMarkup(
      <div dir="rtl" lang="ar">
        <OrderChat
          orderId="o"
          labels={labels}
          statusText="مُسنَد"
          api={silentApi}
          socket={null}
          initiallyOpen
        />
      </div>,
    );
    expect(html).toContain('<div dir="rtl" lang="ar">');
    expect(html).toMatch(/<textarea[^>]*dir="auto"[^>]*class="ocht__input"/);
    const text = row(
      mediaMessage("image", {
        kind: "text",
        body: "أنا عند البوابة",
        attachment: null,
        translation: null,
      }),
    );
    expect(text).toContain('dir="auto"');
    expect(text).toContain("أنا عند البوابة");
  });

  it("CSS الجديدُ يستعملُ الخصائصَ المنطقيّةَ لا اليسارَ واليمين", () => {
    const css = readFileSync(new URL("../../styles/global.css", HERE), "utf8");
    const start = css.indexOf("WR-34");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start);
    expect(block).not.toMatch(/(?:margin|padding)-(?:left|right)\s*:/);
    expect(block).not.toMatch(/\btext-align\s*:\s*(?:left|right)/);
  });

  it("كلُّ مفاتيحِ الوسائطِ بالعربيّةِ والإنجليزيّةِ والأورديّة، ونصوصُ السلامةِ للسائقِ وحدَه", () => {
    const dicts = [ar, en, ur] as Record<string, string>[];
    const riderKeys = Object.keys(ar).filter((k) => k.startsWith("rider.active.chat.media."));
    expect(riderKeys.length).toBeGreaterThanOrEqual(30);
    for (const dict of dicts) {
      for (const key of riderKeys) {
        expect(typeof dict[key]).toBe("string");
        const driverKey = key.replace("rider.active.chat.", "driver.job.chat.");
        expect(typeof dict[driverKey]).toBe("string");
      }
      for (const k of ["Notice", "Dismiss", "Gate", "Confirm"]) {
        expect(typeof dict[`driver.job.chat.media.driverSafety${k}`]).toBe("string");
        expect(dict[`rider.active.chat.media.driverSafety${k}`]).toBeUndefined();
      }
    }
  });
});

describe("WR-34 — سلامةُ السائق", () => {
  it("التنبيهُ يظهرُ لحظةَ فتحِ محادثةِ السائق، ولا يظهرُ للراكب", () => {
    const driver = renderToStaticMarkup(
      <OrderChat
        orderId="o"
        labels={labels}
        statusText="مُسنَد"
        api={silentApi}
        socket={null}
        initiallyOpen
      />,
    );
    expect(driver).toContain('role="note" class="ocht__safety"');
    expect(driver).toContain("«driverSafetyNotice»");
    const rider = renderToStaticMarkup(
      <OrderChat
        orderId="o"
        labels={riderLabels}
        statusText="مُسنَد"
        api={silentApi}
        socket={null}
        initiallyOpen
      />,
    );
    expect(rider).not.toContain("ocht__safety");
  });

  it("شاشةُ السائقِ وحدَها تمرّرُ نصوصَ السلامة", () => {
    const job = read("../driver/job/JobScreen.tsx");
    const ride = read("../rider/active/ActiveRideScreen.tsx");
    for (const k of ["Notice", "Dismiss", "Gate", "Confirm"]) {
      expect(job).toContain(`driver.job.chat.media.driverSafety${k}`);
    }
    expect(ride).not.toContain("driverSafety");
  });

  it("النصوصُ لا تدّعي معرفةَ توقّفِ المركبة، ولا حسّاساتِ حركة", () => {
    for (const dict of [ar, en, ur] as Record<string, string>[]) {
      expect(dict["driver.job.chat.media.driverSafetyConfirm"]).toBeTruthy();
    }
    expect(en["driver.job.chat.media.driverSafetyNotice"].toLowerCase()).not.toMatch(
      /(we detected|vehicle is stopped|you are stopped)/,
    );
    for (const file of ["./OrderChat.tsx", "./ChatMedia.tsx", "./chat-media-capture.ts"]) {
      const source = read(file);
      expect(source).not.toMatch(/devicemotion|DeviceMotionEvent|deviceorientation|Accelerometer/);
      expect(source).not.toMatch(/\bautoPlay\b|\bautoplay=/);
      expect(source).not.toMatch(/coords\.speed/);
    }
  });
});
