/**
 * الغرض: `WR-34` (ADR 0305) — وسائطُ محادثةِ الطلبِ بلا قاعدة:
 *   ١. فحصُ البايتات (`inspectChatMedia`) على ملفّاتٍ حقيقيّة: النوعُ من البصمةِ لا من التصريح،
 *      ونزعُ EXIF/GPS/XMP، ومدّةُ التسجيلِ من الحاوية، ورفضُ الفيديو والمزوَّر والضخم.
 *   ٢. حالاتُ الاستخدام: الإيقاف، الحجمُ قبلَ القراءة، التكرارُ بلا رفعٍ ثانٍ، التنظيفُ عندَ الفشل،
 *      ولا مسارَ ولا رابطَ في السجلّات.
 *   ٣. المسارات: الرموزُ والحالات (413/415/429/404)، و`no-store` على الرابط.
 *   ٤. مخزنُ الملفّات: الطلباتُ الصادرةُ والعزلُ عن دلوِ وثائقِ السائق.
 *   ٥. عاملُ الكنس: فشلُ الحذفِ لا يُتِمُّ السجلّ.
 *   ٦. الهجرة: قابلةٌ للتراجع، الجدولُ مغلقٌ (RLS)، والدوالُّ لدورِ الخدمةِ وحدَه.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createOrderChatRoutes } from "../../apps/gateway/src/routes/order-chat.ts";
import { sweepChatMedia } from "../../apps/workers/src/jobs/sweep-chat-media.ts";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import type {
  OrderChatDeps,
  OrderChatMediaObjects,
  OrderChatMediaStore,
  OrderChatMessage,
  OrderChatStore,
} from "../../packages/application/messaging/order-chat.ts";
import {
  postOrderChatMedia,
  readOrderChatAttachment,
} from "../../packages/application/messaging/order-chat-media.ts";
import {
  CHAT_MEDIA_LIMITS,
  inspectChatMedia,
  sniffChatMediaMime,
} from "../../packages/domain/messaging/chat-media.ts";
import {
  chatMediaEnabled,
  HttpChatMediaObjectStore,
  isChatMediaObjectPath,
  readChatMediaBucket,
  readChatMediaStoreConfig,
} from "../../packages/infrastructure/storage/chat-media-object-store.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const ROOT = new URL("../../", import.meta.url);
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`tests/fixtures/chat-media/${name}`, ROOT)));
const text = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const has = (bytes: Uint8Array, needle: string) =>
  Buffer.from(bytes).includes(Buffer.from(needle, "latin1"));

const ORDER = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";
const CLIENT = "11111111-2222-4333-8444-555555555555";
const ATTACHMENT = "99999999-8888-4777-8666-555555555555";
const OBJECT_PATH = `orders/${ORDER}/${ATTACHMENT}`;

// ── ١. فحصُ البايتات ───────────────────────────────────────────────────────────

describe("WR-34 — فحصُ الوسائطِ في الخادم", () => {
  it("JPEG: يُنزَعُ EXIF (ومنه GPS) وXMP والتعليقاتُ وما بعدَ النهاية، وتبقى صورةً صالحة", () => {
    const original = fixture("photo-gps.jpg");
    expect(has(original, "Exif")).toBe(true);
    const verdict = inspectChatMedia({ kind: "image", bytes: original });
    if (!verdict.ok || verdict.kind !== "image") throw new Error("expected image");
    expect(verdict.mime).toBe("image/jpeg");
    expect(verdict.width).toBeGreaterThan(0);
    expect(verdict.strippedBytes).toBeGreaterThan(0);
    const out = verdict.bytes;
    expect(Buffer.from(out).includes(Buffer.from([0xff, 0xe1]))).toBe(false);
    for (const secret of ["Exif", "Secret-Model-X", "SecretComment", "TRAILING-SECRET-DATA"]) {
      expect(has(out, secret)).toBe(false);
    }
    // بدايةٌ ونهايةٌ صالحتان.
    expect([out[0], out[1]]).toEqual([0xff, 0xd8]);
    expect([out[out.length - 2], out[out.length - 1]]).toEqual([0xff, 0xd9]);
    // الفحصُ ثانيةً على الناتجِ يقبلُه بلا شيءٍ يُنزَع.
    const again = inspectChatMedia({ kind: "image", bytes: out });
    expect(again.ok && again.kind === "image" ? again.strippedBytes : -1).toBe(0);
  });

  it("PNG وWebP: تُنزَعُ القطعُ الوصفيّة", () => {
    for (const name of ["photo-meta.png", "photo-exif.webp"]) {
      const original = fixture(name);
      const verdict = inspectChatMedia({ kind: "image", bytes: original });
      if (!verdict.ok || verdict.kind !== "image") throw new Error(`expected image: ${name}`);
      expect(verdict.strippedBytes).toBeGreaterThan(0);
      for (const secret of ["Secret-Model-X", "SecretPerson", "SecretComment", "WaslaTestPhone"]) {
        expect(has(verdict.bytes, secret)).toBe(false);
      }
      expect(sniffChatMediaMime(verdict.bytes)).toBe(verdict.mime);
    }
  });

  it("التسجيل: webm/mp4/ogg تُقبَلُ بمدّةِ الحاوية، والبايتاتُ كما هي", () => {
    for (const [name, mime] of [
      ["voice.webm", "audio/webm"],
      ["voice-live.webm", "audio/webm"],
      ["voice.m4a", "audio/mp4"],
      ["voice-fragmented.m4a", "audio/mp4"],
      ["voice.ogg", "audio/ogg"],
      // تسجيلانِ حقيقيّانِ من MediaRecorder في Chromium 147 (ميكروفونٌ مُحاكى، 2.5 ث) —
      // ما يُنتجُه المتصفّحُ فعلاً لا ما يُنتجُه ffmpeg (دليلُ WR-34).
      ["chromium-recorded.m4a", "audio/mp4"],
      ["chromium-recorded.webm", "audio/webm"],
    ] as const) {
      const bytes = fixture(name);
      const verdict = inspectChatMedia({ kind: "voice", bytes, declaredDurationMs: 3000 });
      if (!verdict.ok || verdict.kind !== "voice") throw new Error(`expected voice: ${name}`);
      expect(verdict.mime).toBe(mime);
      expect(verdict.durationMs).toBeGreaterThanOrEqual(CHAT_MEDIA_LIMITS.voiceMinMs);
      expect(verdict.durationMs).toBeLessThanOrEqual(CHAT_MEDIA_LIMITS.voiceMaxMs);
      expect(Buffer.from(verdict.bytes).equals(Buffer.from(bytes))).toBe(true);
    }
  });

  it("الفيديو يُرفَضُ ولو صُرِّحَ بأنّه صوت", () => {
    for (const name of ["video.mp4", "video.webm"]) {
      const verdict = inspectChatMedia({ kind: "voice", bytes: fixture(name) });
      expect(verdict.ok ? "accepted" : verdict.reason).toBe("not_audio");
    }
  });

  it("التسجيلُ الأطولُ من الحدّ يُرفَض", () => {
    const verdict = inspectChatMedia({ kind: "voice", bytes: fixture("voice-long.webm") });
    expect(verdict.ok ? "accepted" : verdict.reason).toBe("duration");
  });

  it("النوعُ من البصمة: نصٌّ أو HTML باسمِ صورة، وصورةٌ باسمِ صوت، ومقطوعٌ — كلُّها مرفوضة", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect(inspectChatMedia({ kind: "image", bytes: html })).toEqual({
      ok: false,
      reason: "unknown_type",
    });
    expect(inspectChatMedia({ kind: "voice", bytes: fixture("photo-gps.jpg") })).toEqual({
      ok: false,
      reason: "kind_mismatch",
    });
    expect(inspectChatMedia({ kind: "image", bytes: new Uint8Array() })).toEqual({
      ok: false,
      reason: "empty",
    });
    const truncated = fixture("photo-gps.jpg").slice(0, 40);
    const cut = inspectChatMedia({ kind: "image", bytes: truncated });
    expect(cut.ok).toBe(false);
  });

  it("الضخمُ يُرفَضُ قبلَ أيِّ تحليل", () => {
    const big = new Uint8Array(CHAT_MEDIA_LIMITS.imageMaxBytes + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(inspectChatMedia({ kind: "image", bytes: big })).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});

// ── ٢. حالاتُ الاستخدام ────────────────────────────────────────────────────────

const sessions = {
  read: async (token: string) =>
    token === "good"
      ? ok({
          telegramUserId: "777000555",
          bot: "rider",
          sessionId: "s1",
          issuedAtSeconds: 0,
          expiresAtSeconds: 9_999_999_999,
        })
      : err({ code: "SESSION_REJECTED", reason: "BAD_SIGNATURE" }),
} as unknown as MiniAppSessionReader;

const mediaMessage: OrderChatMessage = {
  id: "m1",
  seq: 3,
  senderRole: "rider",
  mine: true,
  clientMessageId: CLIENT,
  body: "📷",
  createdAt: "2026-11-03T10:00:00.000Z",
  kind: "image",
} as OrderChatMessage;

interface MediaHarness {
  readonly deps: OrderChatDeps;
  readonly calls: string[];
  readonly logs: { event: string; meta: Record<string, unknown> }[];
}

function mediaHarness(
  over: {
    store?: Partial<OrderChatMediaStore>;
    objects?: Partial<OrderChatMediaObjects>;
    enabled?: boolean;
  } = {},
): MediaHarness {
  const calls: string[] = [];
  const logs: { event: string; meta: Record<string, unknown> }[] = [];
  const store: OrderChatMediaStore = {
    reserve: async (input) => {
      calls.push(`reserve:${input.kind}:${input.mimeType}:${String(input.byteSize)}`);
      return ok({ status: "reserved", attachmentId: ATTACHMENT, objectPath: OBJECT_PATH });
    },
    attach: async () => {
      calls.push("attach");
      return ok({ status: "added", message: mediaMessage });
    },
    discard: async () => {
      calls.push("discard");
      return ok(OBJECT_PATH);
    },
    authorizeRead: async () => {
      calls.push("authorize");
      return ok({ objectPath: OBJECT_PATH, mimeType: "image/jpeg" });
    },
    ...over.store,
  };
  const objects: OrderChatMediaObjects = {
    put: async (input) => {
      calls.push(`put:${input.mimeType}:${String(input.bytes.length)}`);
      return ok(undefined);
    },
    remove: async (paths) => {
      calls.push(`remove:${String(paths.length)}`);
      return ok(undefined);
    },
    signRead: async (input) => {
      calls.push(`sign:${String(input.ttlSeconds)}`);
      return ok({
        url: `https://app.example/storage/v1/object/sign/order-chat-media/${OBJECT_PATH}?token=SECRET`,
        expiresAtEpochMs: Date.parse("2026-11-03T10:05:00Z"),
      });
    },
    ...over.objects,
  };
  const chatStore = {} as OrderChatStore;
  return {
    calls,
    logs,
    deps: {
      sessions,
      store: chatStore,
      media: { enabled: over.enabled ?? true, store, objects },
      now: () => new Date("2026-11-03T10:00:00Z"),
      log: (event, meta) => logs.push({ event, meta }),
    },
  };
}

function postInput(bytes: Uint8Array, over: Record<string, unknown> = {}) {
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    input: {
      accessToken: "good",
      orderId: ORDER,
      kind: "image",
      clientMessageId: CLIENT,
      durationMs: undefined,
      declaredBytes: bytes.length,
      readBody: async (max: number) => {
        reads += 1;
        return bytes.length > max ? ("TOO_LARGE" as const) : bytes;
      },
      ...over,
    },
  };
}

describe("WR-34 — رفعُ الوسيط (حالةُ الاستخدام)", () => {
  it("المسارُ السعيد: فحصٌ ← حجزٌ ← رفعُ المنظَّفِ ← ربطٌ، والسجلُّ بلا مسارٍ ولا رابط", async () => {
    const h = mediaHarness();
    const photo = fixture("photo-gps.jpg");
    const result = await postOrderChatMedia(h.deps, postInput(photo).input);
    expect(result.ok ? result.value.status : result.error).toBe("added");
    expect(h.calls[0]).toStartWith("reserve:image:image/jpeg:");
    expect(h.calls[1]).toStartWith("put:image/jpeg:");
    expect(Number(h.calls[1]?.split(":")[2])).toBeLessThan(photo.length);
    expect(h.calls[2]).toBe("attach");
    const logged = JSON.stringify(h.logs);
    expect(logged).not.toContain(OBJECT_PATH);
    expect(logged).not.toContain("orders/");
    expect(logged).not.toContain("777000555");
  });

  it("الوسائطُ موقوفةٌ ⇒ MEDIA_DISABLED بلا قراءةِ جسم", async () => {
    const h = mediaHarness({ enabled: false });
    const p = postInput(fixture("photo-gps.jpg"));
    const result = await postOrderChatMedia(h.deps, p.input);
    expect(result.ok ? null : result.error).toBe("MEDIA_DISABLED");
    expect(p.reads).toBe(0);
    expect(h.calls).toEqual([]);
  });

  it("بلا جلسة ⇒ رفضٌ قبلَ كلِّ شيء", async () => {
    const h = mediaHarness();
    const p = postInput(fixture("photo-gps.jpg"), { accessToken: undefined });
    const result = await postOrderChatMedia(h.deps, p.input);
    expect(result.ok ? null : result.error).toBe("SESSION_REQUIRED");
    expect(p.reads).toBe(0);
  });

  it("الطولُ المصرَّحُ فوقَ الحدّ ⇒ 413 بلا قراءةِ بايت", async () => {
    const h = mediaHarness();
    const p = postInput(fixture("photo-gps.jpg"), {
      declaredBytes: CHAT_MEDIA_LIMITS.imageMaxBytes + 1,
    });
    const result = await postOrderChatMedia(h.deps, p.input);
    expect(result.ok ? null : result.error).toBe("MEDIA_TOO_LARGE");
    expect(p.reads).toBe(0);
  });

  it("نوعٌ مزوَّرٌ ⇒ MEDIA_TYPE_UNSUPPORTED بلا حجز", async () => {
    const h = mediaHarness();
    const result = await postOrderChatMedia(
      h.deps,
      postInput(new TextEncoder().encode("GIF89a-not-allowed")).input,
    );
    expect(result.ok ? null : result.error).toBe("MEDIA_TYPE_UNSUPPORTED");
    expect(h.calls).toEqual([]);
  });

  it("مدّةٌ مصرَّحةٌ غيرُ رقميّة ⇒ MEDIA_DURATION_INVALID", async () => {
    const h = mediaHarness();
    const result = await postOrderChatMedia(
      h.deps,
      postInput(fixture("voice.webm"), { kind: "voice", durationMs: "abc" }).input,
    );
    expect(result.ok ? null : result.error).toBe("MEDIA_DURATION_INVALID");
  });

  it("إعادةُ محاولةٍ لرسالةٍ وصلت ⇒ duplicate بلا رفعٍ ثانٍ", async () => {
    const h = mediaHarness({
      store: {
        reserve: async () => ok({ status: "duplicate", message: mediaMessage }),
      },
    });
    const result = await postOrderChatMedia(h.deps, postInput(fixture("photo-gps.jpg")).input);
    expect(result.ok ? result.value.status : result.error).toBe("duplicate");
    expect(h.calls.some((c) => c.startsWith("put"))).toBe(false);
  });

  it("فشلُ الرفعِ ⇒ يُسقَطُ الحجزُ ويُحذَفُ الملفّ، والخطأُ عابرٌ (503)", async () => {
    const h = mediaHarness({ objects: { put: async () => err("STORE_UNAVAILABLE") } });
    const result = await postOrderChatMedia(h.deps, postInput(fixture("photo-gps.jpg")).input);
    expect(result.ok ? null : result.error).toBe("MEDIA_STORE_UNAVAILABLE");
    expect(h.calls).toContain("discard");
    expect(h.calls).toContain("remove:1");
    expect(h.calls).not.toContain("attach");
  });

  it("رفضُ الربطِ (الطلبُ أُغلقَ بينَ الحجزِ والربط) ⇒ تنظيفٌ ورمزُ الرفض", async () => {
    const h = mediaHarness({
      store: { attach: async () => err({ rejection: "CHAT_CLOSED" as const }) },
    });
    const result = await postOrderChatMedia(h.deps, postInput(fixture("photo-gps.jpg")).input);
    expect(result.ok ? null : result.error).toBe("CHAT_CLOSED");
    expect(h.calls).toContain("discard");
    expect(h.calls).toContain("remove:1");
  });

  it("تجاوزُ الحصّة ⇒ MEDIA_QUOTA بلا رفع", async () => {
    const h = mediaHarness({
      store: { reserve: async () => err({ rejection: "ATTACHMENT_QUOTA" as const }) },
    });
    const result = await postOrderChatMedia(h.deps, postInput(fixture("photo-gps.jpg")).input);
    expect(result.ok ? null : result.error).toBe("MEDIA_QUOTA");
    expect(h.calls.some((c) => c.startsWith("put"))).toBe(false);
  });
});

describe("WR-34 — رابطُ القراءة (حالةُ الاستخدام)", () => {
  it("الطرفُ يأخذُ رابطاً لخمسِ دقائق", async () => {
    const h = mediaHarness();
    const result = await readOrderChatAttachment(h.deps, {
      accessToken: "good",
      orderId: ORDER,
      attachmentId: ATTACHMENT,
    });
    if (!result.ok) throw new Error(result.error);
    expect(h.calls).toEqual(["authorize", `sign:${String(CHAT_MEDIA_LIMITS.readTtlSeconds)}`]);
    expect(result.value.expiresAt).toBe("2026-11-03T10:05:00.000Z");
    expect(JSON.stringify(h.logs)).not.toContain("token=");
  });

  it("غيرُ الطرفِ أو محادثةٌ أخرى ⇒ ATTACHMENT_NOT_FOUND بلا توقيع", async () => {
    const h = mediaHarness({
      store: { authorizeRead: async () => err({ rejection: "CHAT_NOT_FOUND" as const }) },
    });
    const result = await readOrderChatAttachment(h.deps, {
      accessToken: "good",
      orderId: ORDER,
      attachmentId: ATTACHMENT,
    });
    expect(result.ok ? null : result.error).toBe("ATTACHMENT_NOT_FOUND");
    expect(h.calls.some((c) => c.startsWith("sign"))).toBe(false);
  });

  it("القراءةُ تبقى ممكنةً والرفعُ موقوف", async () => {
    const h = mediaHarness({ enabled: false });
    const result = await readOrderChatAttachment(h.deps, {
      accessToken: "good",
      orderId: ORDER,
      attachmentId: ATTACHMENT,
    });
    expect(result.ok).toBe(true);
  });

  it("معرّفٌ غيرُ صالح ⇒ 404 لا 422 (لا كشفَ لشكلِ المعرّفات)", async () => {
    const h = mediaHarness();
    const result = await readOrderChatAttachment(h.deps, {
      accessToken: "good",
      orderId: ORDER,
      attachmentId: "../../driver-documents/x",
    });
    expect(result.ok ? null : result.error).toBe("ATTACHMENT_NOT_FOUND");
    expect(h.calls).toEqual([]);
  });
});

// ── ٣. المسارات ────────────────────────────────────────────────────────────────

describe("WR-34 — مساراتُ البوّابة", () => {
  it("رفعٌ ناجح ⇒ 201 ورسالةٌ بمرفق؛ ثمّ الحالاتُ 413/415/404 و no-store", async () => {
    const h = mediaHarness();
    const app = createOrderChatRoutes({ chat: h.deps });
    const photo = fixture("photo-gps.jpg");
    const ok201 = await app.request(
      `/v1/orders/${ORDER}/chat/media?kind=image&client_message_id=${CLIENT}`,
      {
        method: "POST",
        headers: { authorization: "Bearer good", "content-type": "image/jpeg" },
        body: photo,
      },
    );
    expect(ok201.status).toBe(201);

    const tooBig = await app.request(
      `/v1/orders/${ORDER}/chat/media?kind=image&client_message_id=${CLIENT}`,
      {
        method: "POST",
        headers: { authorization: "Bearer good" },
        body: new Uint8Array(CHAT_MEDIA_LIMITS.imageMaxBytes + 10),
      },
    );
    expect(tooBig.status).toBe(413);

    const spoof = await app.request(
      `/v1/orders/${ORDER}/chat/media?kind=image&client_message_id=${CLIENT}`,
      {
        method: "POST",
        headers: { authorization: "Bearer good", "content-type": "image/jpeg" },
        body: new TextEncoder().encode("<svg onload=alert(1)>"),
      },
    );
    expect(spoof.status).toBe(415);

    const link = await app.request(`/v1/orders/${ORDER}/chat/attachments/${ATTACHMENT}`, {
      headers: { authorization: "Bearer good" },
    });
    expect(link.status).toBe(200);
    expect(link.headers.get("cache-control")).toBe("no-store");
    const body = (await link.json()) as Record<string, unknown>;
    expect(body.mime_type).toBe("image/jpeg");
    expect(typeof body.expires_at).toBe("string");

    const denied = createOrderChatRoutes({
      chat: mediaHarness({
        store: { authorizeRead: async () => err({ rejection: "CHAT_NOT_FOUND" as const }) },
      }).deps,
    });
    const notFound = await denied.request(`/v1/orders/${ORDER}/chat/attachments/${ATTACHMENT}`, {
      headers: { authorization: "Bearer good" },
    });
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("cache-control")).toBe("no-store");
  });

  it("الحصّة ⇒ 429، والإيقاف ⇒ 503", async () => {
    const quota = createOrderChatRoutes({
      chat: mediaHarness({
        store: { reserve: async () => err({ rejection: "ATTACHMENT_QUOTA" as const }) },
      }).deps,
    });
    const r429 = await quota.request(
      `/v1/orders/${ORDER}/chat/media?kind=image&client_message_id=${CLIENT}`,
      { method: "POST", headers: { authorization: "Bearer good" }, body: fixture("photo-gps.jpg") },
    );
    expect(r429.status).toBe(429);
    const off = createOrderChatRoutes({ chat: mediaHarness({ enabled: false }).deps });
    const r503 = await off.request(
      `/v1/orders/${ORDER}/chat/media?kind=image&client_message_id=${CLIENT}`,
      { method: "POST", headers: { authorization: "Bearer good" }, body: fixture("photo-gps.jpg") },
    );
    expect(r503.status).toBe(503);
  });
});

// ── ٤. مخزنُ الملفّات ──────────────────────────────────────────────────────────

describe("WR-34 — مخزنُ ملفّاتِ المحادثة", () => {
  it("دلوٌ مستقلّ: لا يُقبَلُ أن يساويَ دلوَ وثائقِ السائق", () => {
    expect(readChatMediaBucket({})).toBe("order-chat-media");
    expect(readChatMediaBucket({ ORDER_CHAT_MEDIA_BUCKET: "driver-documents" })).toBeNull();
    expect(
      readChatMediaBucket({ ORDER_CHAT_MEDIA_BUCKET: "docs-x", DRIVER_DOCUMENTS_BUCKET: "docs-x" }),
    ).toBeNull();
    expect(readChatMediaBucket({ ORDER_CHAT_MEDIA_BUCKET: "../etc" })).toBeNull();
    const config = readChatMediaStoreConfig({
      OBJECT_STORAGE_URL: "http://storage.internal",
      OBJECT_STORAGE_SECRET_KEY: "k",
    });
    expect(config?.bucket).toBe("order-chat-media");
    expect(readChatMediaStoreConfig({ ORDER_CHAT_MEDIA_BUCKET: "x" })).toBeNull();
  });

  it("المفتاحُ الصريحُ وحدَه يفتحُ الوسائط", () => {
    expect(chatMediaEnabled({ ORDER_CHAT_MEDIA: "enabled" })).toBe(true);
    expect(chatMediaEnabled({ ORDER_CHAT_MEDIA: "true" })).toBe(false);
    expect(chatMediaEnabled({})).toBe(false);
  });

  it("المسارُ مقيَّدٌ بشكلِ orders/<uuid>/<uuid>", () => {
    expect(isChatMediaObjectPath(OBJECT_PATH)).toBe(true);
    expect(isChatMediaObjectPath(`orders/${ORDER}/../x`)).toBe(false);
    expect(isChatMediaObjectPath(`drivers/${ORDER}/${ATTACHMENT}`)).toBe(false);
  });

  it("الرفعُ والحذفُ والتوقيعُ يذهبونَ إلى الدلوِ الخاصّ بمفتاحِ الخدمة", async () => {
    const seen: { url: string; method: string; headers: Record<string, string>; body: string }[] =
      [];
    const store = new HttpChatMediaObjectStore({
      baseUrl: "http://storage.internal",
      secretKey: "service-key",
      bucket: "order-chat-media",
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        seen.push({
          url: String(url),
          method: init?.method ?? "GET",
          headers,
          body: typeof init?.body === "string" ? init.body : "",
        });
        if (String(url).includes("/object/sign/")) {
          return Response.json({
            signedURL: `/object/sign/order-chat-media/${OBJECT_PATH}?token=t`,
          });
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(
      (
        await store.put({
          objectPath: OBJECT_PATH,
          bytes: new Uint8Array([1]),
          mimeType: "image/jpeg",
        })
      ).ok,
    ).toBe(true);
    expect(seen[0]?.url).toBe(
      `http://storage.internal/storage/v1/object/order-chat-media/${OBJECT_PATH}`,
    );
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.headers.authorization).toBe("Bearer service-key");
    expect(seen[0]?.headers["x-upsert"]).toBe("true");
    expect(seen[0]?.headers["content-type"]).toBe("image/jpeg");

    expect((await store.remove([OBJECT_PATH])).ok).toBe(true);
    expect(seen[1]?.method).toBe("DELETE");
    expect(JSON.parse(seen[1]?.body ?? "{}")).toEqual({ prefixes: [OBJECT_PATH] });

    const signed = await store.signRead({ objectPath: OBJECT_PATH, ttlSeconds: 300 });
    expect(signed.ok).toBe(true);
    expect(seen[2]?.url).toContain("/storage/v1/object/sign/order-chat-media/");
    expect(seen.every((s) => !s.url.includes("driver-documents"))).toBe(true);

    // مسارٌ خارجَ الشكلِ لا يصلُ إلى الشبكة.
    const before = seen.length;
    expect(
      (
        await store.put({
          objectPath: "../driver-documents/x",
          bytes: new Uint8Array([1]),
          mimeType: "image/jpeg",
        })
      ).ok,
    ).toBe(false);
    expect(seen.length).toBe(before);
  });

  it("4xx ⇒ مرفوض، 5xx أو انقطاع ⇒ غيرُ متاح، و404 في الحذفِ نجاح", async () => {
    const make = (status: number | "throw") =>
      new HttpChatMediaObjectStore({
        baseUrl: "http://s",
        secretKey: "k",
        bucket: "order-chat-media",
        fetch: (async () => {
          if (status === "throw") throw new Error("ECONNREFUSED");
          return new Response("x", { status });
        }) as unknown as typeof fetch,
      });
    const input = { objectPath: OBJECT_PATH, bytes: new Uint8Array([1]), mimeType: "image/png" };
    expect(await make(400).put(input)).toEqual(err("STORE_REJECTED"));
    expect(await make(502).put(input)).toEqual(err("STORE_UNAVAILABLE"));
    expect(await make("throw").put(input)).toEqual(err("STORE_UNAVAILABLE"));
    expect((await make(404).remove([OBJECT_PATH])).ok).toBe(true);
  });
});

// ── ٥. عاملُ الكنس ─────────────────────────────────────────────────────────────

describe("WR-34 — كنسُ الملفّات", () => {
  it("يحذفُ ثمّ يُتِمّ، وفشلُ الحذفِ يُبقي الصفوفَ للشوطِ التالي", async () => {
    const completed: string[][] = [];
    const items = [
      { id: "a", objectPath: OBJECT_PATH, reason: "orphan_pending" as const },
      { id: "b", objectPath: OBJECT_PATH, reason: "retention" as const },
    ];
    const good = await sweepChatMedia({
      claim: async () => items,
      complete: async (ids) => {
        completed.push([...ids]);
      },
      remove: async () => ok(undefined),
    });
    expect(good.ok ? good.value.byReason : null).toEqual({
      orphan_pending: 1,
      message_gone: 0,
      retention: 1,
    });
    expect(completed).toEqual([["a", "b"]]);

    const bad = await sweepChatMedia({
      claim: async () => items,
      complete: async (ids) => {
        completed.push([...ids]);
      },
      remove: async () => err("STORE_UNAVAILABLE"),
    });
    expect(bad.ok).toBe(false);
    expect(completed.length).toBe(1);
  });

  it("العاملُ مسجَّلٌ بفاصلٍ دوريّ", () => {
    const container = text("apps/workers/src/container.ts");
    expect(container).toContain("sweep-chat-media");
    expect(container).toContain("sweepChatMedia");
  });
});

// ── ٦. الهجرةُ والعزل ──────────────────────────────────────────────────────────

describe("WR-34 — الهجرةُ والسياسة", () => {
  const migration = text("supabase/migrations/20261103150000_wr_34_chat_media.sql");

  it("تحملُ طريقَ تراجعٍ موثَّقاً", () => {
    expect(migration).toContain("## التراجع (آمن)");
    expect(migration).toContain("drop table if exists order_chat_attachments;");
  });

  it("الجدولُ مغلقٌ بـ RLS ولا منحَ لـ anon/authenticated", () => {
    expect(migration).toContain("alter table order_chat_attachments enable row level security;");
    expect(migration).not.toMatch(/grant [^;]* to (anon|authenticated)/i);
    expect(migration).toContain(
      "revoke all on table order_chat_attachments from public, anon, authenticated;",
    );
  });

  it("الهجرةُ لا تمسُّ المخزن، ودلوُ الوثائقِ لا يُذكَرُ في الشيفرةِ إلّا في حارسِ الرفض", () => {
    // الهجرةُ لا تمسُّ سياساتِ المخزنِ (ولا دلوَ الوثائق): الدلوُ الجديدُ يُهيَّأُ بسكربتٍ مستقلّ.
    expect(migration).not.toMatch(/storage\.(objects|buckets)/);
    const store = text("packages/infrastructure/storage/chat-media-object-store.ts");
    const code = store.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code.match(/driver-documents/g)?.length ?? 0).toBe(1);
    expect(code).toContain("bucket === documents ? null : bucket");
  });

  it("سياسةُ الأمان: CSP يسمحُ بالوسائطِ من الأصلِ نفسِه، والميكروفونُ للأصلِ وحدَه", () => {
    const nginx = text("deploy/casaos/miniapp-nginx.conf");
    expect(nginx).toContain("microphone=(self)");
    expect(nginx).not.toContain("microphone=()");
    const csp = text("scripts/lib/content-security-policy.ts");
    expect(csp).toContain("media-src 'self' blob:");
  });
});
