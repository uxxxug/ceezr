/**
 * الغرض: `WR-04` — عميلُ محادثةِ الطلبِ في Mini App: يسترجعُ «ما بعدَ آخرِ
 *   تسلسلٍ»، ويُرسِلُ بمعرّفٍ ثابتٍ يمنعُ التكرارَ عندَ الإعادة، ويدمجُ بلا تكرار.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/chat
 * الحاكم: `docs/adr/0263-order-chat-in-miniapp.md`.
 *
 * ## الحقيقةُ في الخادم
 *
 * القناةُ الآنيّةُ إشارةٌ «جديدٌ في الغرفة» فقط؛ والرسائلُ تُقرأُ دائماً من
 * `GET /v1/orders/:id/chat?after=<seq>`. فالانقطاعُ لا يُفقِدُ شيئاً: العودةُ
 * تسترجعُ ما فاتَ بالتسلسل، والدمجُ بمعرّفِ الرسالةِ يمنعُ التكرار.
 *
 * ولا شيءَ يُحفَظُ في `localStorage` ولا `sessionStorage`: الخروجُ والعودةُ
 * يقرآنِ من الخادمِ نفسِه، فالسجلُّ لا يعيشُ في الجهاز.
 */

import { ApiError, ApiNetworkError, apiFetch } from "../../api/client.ts";

export type ChatRole = "rider" | "driver";

export type ChatMessageKind = "text" | "location" | "image" | "voice";

/**
 * `WR-34` (ADR 0305) — سجلُّ ملفِّ الوسيط: لا رابطَ فيه. الرابطُ الموقَّعُ القصيرُ يُطلَبُ
 * لكلِّ ملفٍّ عندَ عرضِه أو تشغيلِه (`ChatApi.attachmentUrl`).
 */
export interface ChatAttachment {
  readonly id: string;
  readonly kind: "image" | "voice";
  readonly mimeType: string;
  readonly byteSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
  /** `false` ⇒ انتهت مدّةُ الاحتفاظِ وحُذفَ الملف. */
  readonly available: boolean;
}

/** `WR-34` — حدودُ الوسائطِ كما أعلنَها الخادم؛ `enabled: false` ⇒ لا أزرارَ وسائط. */
export interface ChatMediaCapability {
  readonly enabled: boolean;
  readonly imageMaxBytes: number;
  readonly voiceMaxBytes: number;
  readonly voiceMaxMs: number;
}

export const MEDIA_DISABLED: ChatMediaCapability = Object.freeze({
  enabled: false,
  imageMaxBytes: 0,
  voiceMaxBytes: 0,
  voiceMaxMs: 0,
});

/** `WR-04` — نقطةٌ واحدةٌ اختارَ المستخدمُ إرسالَها. */
export interface ChatLocation {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number | null;
  readonly label: string | null;
  /** رابطُ فتحِ النقطةِ في الخرائطِ كما بناه الخادم — لا يُركَّبُ هنا (`F1-10`). */
  readonly mapsUrl?: string | null;
}

/** ترجمةُ رسالةِ الطرفِ الآخرِ إلى لغةِ القارئ — والأصلُ في `body`. */
export interface ChatTranslation {
  readonly text: string;
  readonly from: string;
  readonly to: string;
}

export interface ChatMessage {
  readonly id: string;
  readonly seq: number;
  readonly senderRole: ChatRole;
  readonly mine: boolean;
  readonly clientMessageId: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly kind: ChatMessageKind;
  readonly location: ChatLocation | null;
  readonly translation: ChatTranslation | null;
  /** `WR-34` — للصورةِ والصوتِ وحدَهما؛ غيابُه ⇒ لا مرفق. */
  readonly attachment?: ChatAttachment | null;
}

export interface ChatSnapshot {
  readonly orderId: string;
  readonly service: "transport" | "delivery";
  readonly status: string;
  readonly writable: boolean;
  /** `WR-05` — سياسةُ المبلغِ ومبلغُه؛ `null` ⇒ لا يُعرَضُ سطرُ السعر. */
  readonly offerMode: "fixed" | "suggested" | "open" | null;
  readonly offerSar: number | null;
  readonly myRole: ChatRole;
  readonly counterpartFirstName: string | null;
  readonly messages: readonly ChatMessage[];
  readonly lastSeq: number;
  readonly myLastReadSeq: number;
  readonly counterpartLastReadSeq: number;
  readonly unread: number;
  /** `WR-04` (ADR 0277) — الرسائلُ تُترجَمُ آليًّا عبرَ خدمةٍ خارجيّة؛ منه يُعرَضُ الإفصاح. */
  readonly translationActive: boolean;
  /** `WR-34` — في الخادمِ رسائلُ أقدمُ ممّا حُمِّل. */
  readonly hasOlder: boolean;
  readonly media: ChatMediaCapability;
}

/** `WR-34` — وسيطٌ محلّيٌّ ينتظرُ الرفع: البايتاتُ في الذاكرةِ وحدَها (لا تخزينَ في الجهاز). */
export interface PendingMedia {
  readonly kind: "image" | "voice";
  readonly blob: Blob;
  /** `blob:` للمعاينةِ والتشغيلِ قبلَ التأكيد — يُحرَّرُ عندَ إسقاطِ المعلَّق. */
  readonly previewUrl: string | null;
  readonly durationMs: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

export type ChatMediaFailure = "too_large" | "unsupported" | "quota" | "disabled" | "other";

/** رسالةٌ أرسلَها المستخدمُ ولم يؤكِّدْها الخادمُ بعدُ — بمعرّفِها الثابت. */
export interface PendingMessage {
  readonly clientMessageId: string;
  readonly body: string;
  readonly state: "sending" | "failed";
  /** غيابُهما ⇒ نصّ. */
  readonly kind?: ChatMessageKind;
  readonly location?: ChatLocation;
  readonly media?: PendingMedia;
  /** `WR-34` — سببُ رفضٍ نهائيٍّ لا تُصلِحُه الإعادة (حجمٌ أو نوعٌ أو حصّة). */
  readonly mediaFailure?: ChatMediaFailure;
}

/** ما يُرسَلُ للخادم: نصٌّ أو نقطةُ موقع. */
export type ChatOutgoing =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "location"; readonly location: ChatLocation };

interface WireMessage {
  readonly id: string;
  readonly seq: number;
  readonly sender_role: ChatRole;
  readonly mine: boolean;
  readonly client_message_id: string | null;
  readonly body: string;
  readonly created_at: string;
  readonly kind?: ChatMessageKind;
  readonly location?: {
    readonly lat: number;
    readonly lng: number;
    readonly accuracy_m: number | null;
    readonly label: string | null;
    readonly maps_url?: string | null;
  } | null;
  readonly translation?: ChatTranslation | null;
  readonly attachment?: {
    readonly id: string;
    readonly kind: "image" | "voice";
    readonly mime_type: string;
    readonly byte_size: number;
    readonly width: number | null;
    readonly height: number | null;
    readonly duration_ms: number | null;
    readonly available: boolean;
  } | null;
}

interface WireThread {
  readonly ok: true;
  readonly order: {
    readonly id: string;
    readonly service: "transport" | "delivery";
    readonly status: string;
    readonly writable: boolean;
    readonly offer_mode?: "fixed" | "suggested" | "open" | null;
    readonly offer_sar?: number | null;
  };
  readonly my_role: ChatRole;
  readonly counterpart: { readonly role: ChatRole; readonly first_name: string | null };
  readonly messages: readonly WireMessage[];
  readonly last_seq: number;
  readonly my_last_read_seq: number;
  readonly counterpart_last_read_seq: number;
  readonly unread: number;
  readonly translation_active?: boolean;
  readonly has_older?: boolean;
  readonly media?: {
    readonly enabled: boolean;
    readonly image_max_bytes: number;
    readonly voice_max_bytes: number;
    readonly voice_max_ms: number;
  };
}

export type { WireMessage as ChatWireMessage, WireThread as ChatWireThread };

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function fromWireMessage(m: WireMessage): ChatMessage {
  const lat = finite(m.location?.lat);
  const lng = finite(m.location?.lng);
  const location: ChatLocation | null =
    m.kind === "location" && lat !== null && lng !== null
      ? {
          lat,
          lng,
          accuracyM: finite(m.location?.accuracy_m),
          label: typeof m.location?.label === "string" ? m.location.label : null,
          mapsUrl:
            typeof m.location?.maps_url === "string" && m.location.maps_url.startsWith("https://")
              ? m.location.maps_url
              : null,
        }
      : null;
  const translation =
    m.translation !== undefined &&
    m.translation !== null &&
    typeof m.translation.text === "string" &&
    m.translation.text.trim().length > 0
      ? m.translation
      : null;
  const wireAttachment = m.attachment;
  const attachment: ChatAttachment | null =
    (m.kind === "image" || m.kind === "voice") &&
    wireAttachment !== undefined &&
    wireAttachment !== null &&
    typeof wireAttachment.id === "string" &&
    wireAttachment.kind === m.kind
      ? {
          id: wireAttachment.id,
          kind: wireAttachment.kind,
          mimeType: wireAttachment.mime_type,
          byteSize: finite(wireAttachment.byte_size) ?? 0,
          width: finite(wireAttachment.width),
          height: finite(wireAttachment.height),
          durationMs: finite(wireAttachment.duration_ms),
          available: wireAttachment.available === true,
        }
      : null;
  // `WR-34`: وسيطٌ بلا سجلِّ مرفقٍ يبقى بنوعِه ويُعرَضُ «غيرَ متاح» — لا نصًّا رمزيًّا.
  const kind: ChatMessageKind =
    m.kind === "image" || m.kind === "voice" ? m.kind : location === null ? "text" : "location";
  return {
    id: m.id,
    seq: m.seq,
    senderRole: m.sender_role,
    mine: m.mine,
    clientMessageId: m.client_message_id,
    body: m.body,
    createdAt: m.created_at,
    // نوعٌ مجهولٌ أو موقعٌ بلا إحداثيّاتٍ صالحة يُعرَضُ نصًّا: لا بطاقةَ موقعٍ بلا موقع.
    kind,
    location,
    // الوسائطُ لا تُترجَم (ADR 0305): لا ترجمةَ تُعرَضُ على غيرِ النصّ.
    translation: kind === "text" ? translation : null,
    attachment,
  };
}

export interface ChatAttachmentLink {
  readonly url: string;
  readonly expiresAt: string;
  readonly mimeType: string;
}

export interface ChatApi {
  readonly fetchAfter: (orderId: string, afterSeq: number) => Promise<WireThread>;
  readonly send: (
    orderId: string,
    clientMessageId: string,
    outgoing: ChatOutgoing,
  ) => Promise<{ readonly status: "added" | "duplicate"; readonly message: WireMessage }>;
  readonly markRead: (orderId: string, seq: number) => Promise<unknown>;
  /** `WR-34` — آخرُ صفحةٍ (الفتحُ الأوّل). غيابُها ⇒ `fetchAfter(…, 0)` كما كان. */
  readonly fetchTail?: (orderId: string) => Promise<WireThread>;
  /** `WR-34` — صفحةُ الأقدمِ قبلَ تسلسلٍ معلوم. */
  readonly fetchBefore?: (orderId: string, beforeSeq: number) => Promise<WireThread>;
  /** `WR-34` — رفعُ وسيطٍ بمعرّفِه الثابت: الإعادةُ بالمعرّفِ نفسِه لا تُكرِّرُ رسالة. */
  readonly uploadMedia?: (
    orderId: string,
    clientMessageId: string,
    media: {
      readonly kind: "image" | "voice";
      readonly blob: Blob;
      readonly durationMs: number | null;
    },
  ) => Promise<{ readonly status: "added" | "duplicate"; readonly message: WireMessage }>;
  /** `WR-34` — رابطٌ موقَّعٌ قصيرٌ لملفٍّ من هذه المحادثة. */
  readonly attachmentUrl?: (orderId: string, attachmentId: string) => Promise<ChatAttachmentLink>;
}

export const productionChatApi: ChatApi = {
  fetchAfter: (orderId, afterSeq) =>
    apiFetch<WireThread>(`/v1/orders/${orderId}/chat?after=${String(afterSeq)}`, {
      method: "GET",
    }),
  send: (orderId, clientMessageId, outgoing) =>
    apiFetch(`/v1/orders/${orderId}/chat/messages`, {
      method: "POST",
      body:
        outgoing.kind === "location"
          ? { clientMessageId, kind: "location", location: outgoing.location }
          : { clientMessageId, text: outgoing.text },
    }),
  markRead: (orderId, seq) =>
    apiFetch(`/v1/orders/${orderId}/chat/read`, { method: "POST", body: { seq } }),
  fetchTail: (orderId) =>
    apiFetch<WireThread>(`/v1/orders/${orderId}/chat?tail=1`, { method: "GET" }),
  fetchBefore: (orderId, beforeSeq) =>
    apiFetch<WireThread>(`/v1/orders/${orderId}/chat?before=${String(beforeSeq)}`, {
      method: "GET",
    }),
  uploadMedia: (orderId, clientMessageId, media) => {
    const query = new URLSearchParams({ kind: media.kind, client_message_id: clientMessageId });
    if (media.durationMs !== null) query.set("duration_ms", String(Math.round(media.durationMs)));
    return apiFetch(`/v1/orders/${orderId}/chat/media?${query.toString()}`, {
      method: "POST",
      rawBody: {
        data: media.blob,
        contentType: media.blob.type.length > 0 ? media.blob.type : "application/octet-stream",
      },
    });
  },
  attachmentUrl: async (orderId, attachmentId) => {
    const wire = await apiFetch<{ url: string; expires_at: string; mime_type: string }>(
      `/v1/orders/${orderId}/chat/attachments/${attachmentId}`,
      { method: "GET" },
    );
    return { url: wire.url, expiresAt: wire.expires_at, mimeType: wire.mime_type };
  },
};

/** `WR-34` — سببُ رفضِ الوسيطِ من رمزِ الخادم؛ `null` ⇒ عطلٌ عابرٌ تُصلِحُه الإعادة. */
export function mediaFailureOf(error: unknown): ChatMediaFailure | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "MEDIA_TOO_LARGE" || error.status === 413) return "too_large";
  if (error.code === "MEDIA_TYPE_UNSUPPORTED" || error.code === "MEDIA_INVALID")
    return "unsupported";
  if (error.code === "MEDIA_DURATION_INVALID") return "unsupported";
  if (error.code === "MEDIA_QUOTA") return "quota";
  if (error.code === "MEDIA_DISABLED") return "disabled";
  if (error.status >= 500 || error.status === 401) return null;
  if (error.status === 409) return null;
  return "other";
}

/**
 * دمجُ دفعةٍ جديدةٍ في القائمةِ القائمة — بمعرّفِ الرسالةِ لا بموضعِها،
 * فالإشارةُ المكرَّرةُ أو الاسترجاعُ المتداخلُ لا يُكرِّرانِ سطراً.
 */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): readonly ChatMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map<string, ChatMessage>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** المُعلَّقةُ التي وصلَ تأكيدُها في القائمةِ تُسقَطُ — فلا تظهرُ الرسالةُ مرّتين. */
export function settlePending(
  pending: readonly PendingMessage[],
  messages: readonly ChatMessage[],
): readonly PendingMessage[] {
  const confirmed = new Set(
    messages.filter((m) => m.mine && m.clientMessageId !== null).map((m) => m.clientMessageId),
  );
  return pending.filter((p) => !confirmed.has(p.clientMessageId));
}

export function applyThread(previous: ChatSnapshot | null, wire: WireThread): ChatSnapshot {
  const incoming = wire.messages.map(fromWireMessage);
  const messages = mergeMessages(previous?.messages ?? [], incoming);
  return {
    orderId: wire.order.id,
    service: wire.order.service,
    status: wire.order.status,
    writable: wire.order.writable,
    offerMode: wire.order.offer_mode ?? null,
    offerSar: typeof wire.order.offer_sar === "number" ? wire.order.offer_sar : null,
    myRole: wire.my_role,
    counterpartFirstName: wire.counterpart.first_name,
    messages,
    lastSeq: Math.max(previous?.lastSeq ?? 0, wire.last_seq),
    myLastReadSeq: wire.my_last_read_seq,
    counterpartLastReadSeq: wire.counterpart_last_read_seq,
    unread: wire.unread,
    translationActive: wire.translation_active === true,
    hasOlder: previous?.hasOlder ?? wire.has_older === true,
    media:
      wire.media === undefined
        ? (previous?.media ?? MEDIA_DISABLED)
        : {
            enabled: wire.media.enabled === true,
            imageMaxBytes: finite(wire.media.image_max_bytes) ?? 0,
            voiceMaxBytes: finite(wire.media.voice_max_bytes) ?? 0,
            voiceMaxMs: finite(wire.media.voice_max_ms) ?? 0,
          },
  };
}

/**
 * `WR-34` — صفحةٌ من الذيلِ أو من الأقدم: هيَ وحدَها تقولُ إن كانَ قبلَها شيء. (الاسترجاعُ
 * التزايديُّ لا يعرفُ الأقدمَ فلا يُغيِّرُ `hasOlder`.)
 */
export function applyHistoryPage(previous: ChatSnapshot | null, wire: WireThread): ChatSnapshot {
  const next = applyThread(previous, wire);
  return { ...next, hasOlder: wire.has_older === true };
}

export type ChatFailure = "not_found" | "closed" | "session" | "network" | "rejected";

export function chatFailureOf(error: unknown): ChatFailure {
  if (error instanceof ApiNetworkError) return "network";
  if (error instanceof ApiError) {
    if (error.status === 401) return "session";
    if (error.status === 404) return "not_found";
    if (error.status === 409) return "closed";
    if (error.status >= 500) return "network";
    return "rejected";
  }
  return "network";
}

/**
 * معرّفُ عميلٍ لكلِّ رسالةٍ — يُولَّدُ مرّةً ويُعادُ استعمالُه في كلِّ إعادة. وهوَ
 * **مفتاحُ لاتكرارٍ** كـ`newIdempotencyKey` في `search-view.ts` (`ADR 0043` يُجيزُه
 * للعميلِ)، لا معرّفُ طلبٍ: ذاكَ يولّدُه الخادمُ وحدَه.
 */
export function newClientMessageId(): string {
  const source = globalThis.crypto;
  return source.randomUUID();
}
