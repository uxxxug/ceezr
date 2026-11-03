/**
 * الغرض: حالتا استخدامِ الوسائطِ في محادثةِ الطلب — `WR-34` (ADR 0305):
 *   ١. `postOrderChatMedia`: بايتاتُ صورةٍ أو تسجيلٍ ← فحصٌ وتنظيفٌ في الخادم ← حجزُ مرفقٍ
 *      ← رفعٌ إلى الدلوِ الخاصّ ← رسالةٌ مربوطةٌ بالمرفقِ ذرّيّاً. وعندَ أيِّ فشلٍ بعدَ الحجز
 *      يُسقَطُ الحجزُ ويُحذَفُ الملفُّ (والعاملُ يلتقطُ ما فاتَ بعدَ 15 دقيقة).
 *   ٢. `readOrderChatAttachment`: طرفُ المحادثةِ وحدَه يأخذُ رابطاً موقَّعاً قصيراً (5 دقائق)
 *      لملفٍّ من **هذا** الطلب.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/application/messaging
 * يُستخدم من: `apps/gateway/src/routes/order-chat.ts`.
 *
 * ## إعادةُ المحاولةِ بلا تكرار
 *   `client_message_id` واحدٌ لكلِّ وسيطٍ في العميل: إعادةُ الإرسالِ بعدَ انقطاعٍ تجدُ
 *   الرسالةَ (`duplicate`) فلا رفعَ ثانياً، أو تجدُ الحجزَ المعلَّقَ فتكتبُ المسارَ نفسَه.
 *
 * ## السجلّات
 *   حدثٌ بالطلبِ والنوعِ والحجمِ والحالة — لا مسارَ ولا رابطَ ولا محتوى.
 */

import {
  CHAT_MEDIA_LIMITS,
  CHAT_MEDIA_MAX_BYTES,
  type ChatMediaKind,
  type ChatMediaRejection,
  inspectChatMedia,
} from "../../domain/messaging/chat-media.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import {
  type OrderChatDeps,
  type OrderChatMessage,
  type OrderChatPublicErrorCode,
  orderChatInternals,
} from "./order-chat.ts";

export type ReadMediaBody = (maxBytes: number) => Promise<Uint8Array | "TOO_LARGE">;

const REJECTION_CODE: Readonly<Record<ChatMediaRejection, OrderChatPublicErrorCode>> = {
  empty: "MEDIA_INVALID",
  too_large: "MEDIA_TOO_LARGE",
  unknown_type: "MEDIA_TYPE_UNSUPPORTED",
  kind_mismatch: "MEDIA_TYPE_UNSUPPORTED",
  malformed: "MEDIA_INVALID",
  dimensions: "MEDIA_INVALID",
  duration: "MEDIA_DURATION_INVALID",
  not_audio: "MEDIA_TYPE_UNSUPPORTED",
};

function readKind(value: unknown): ChatMediaKind | null {
  return value === "image" || value === "voice" ? value : null;
}

function readDuration(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

export async function postOrderChatMedia(
  deps: OrderChatDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly orderId: unknown;
    readonly kind: unknown;
    readonly clientMessageId: unknown;
    readonly durationMs: unknown;
    /** `Content-Length` المصرَّحُ (إن وُجد) — يُرفَضُ ما يتجاوزُ الحدَّ قبلَ قراءةِ بايتٍ. */
    readonly declaredBytes: number | null;
    readonly readBody: ReadMediaBody;
  },
): Promise<
  Result<
    { readonly status: "added" | "duplicate"; readonly message: OrderChatMessage },
    OrderChatPublicErrorCode
  >
> {
  const { identify, readUuid, publicCodeFrom } = orderChatInternals;
  const identified = await identify(deps, input.accessToken);
  if (!identified.ok) return identified;
  const orderId = readUuid(input.orderId);
  if (orderId === null) return err("ORDER_ID_INVALID");
  const media = deps.media;
  if (media === undefined || !media.enabled) return err("MEDIA_DISABLED");
  const kind = readKind(input.kind);
  if (kind === null) return err("MESSAGE_KIND_INVALID");
  const clientMessageId = readUuid(input.clientMessageId);
  if (clientMessageId === null) return err("CLIENT_ID_INVALID");
  const declaredDuration = readDuration(input.durationMs);
  if (Number.isNaN(declaredDuration)) return err("MEDIA_DURATION_INVALID");

  const maxBytes = CHAT_MEDIA_MAX_BYTES[kind];
  if (input.declaredBytes !== null && input.declaredBytes > maxBytes) return err("MEDIA_TOO_LARGE");
  const raw = await input.readBody(maxBytes);
  if (raw === "TOO_LARGE") return err("MEDIA_TOO_LARGE");

  const verdict = inspectChatMedia({ kind, bytes: raw, declaredDurationMs: declaredDuration });
  if (!verdict.ok) {
    deps.log?.("order_chat.media_rejected", { order_id: orderId, kind, reason: verdict.reason });
    return err(REJECTION_CODE[verdict.reason]);
  }

  const reserved = await media.store.reserve({
    telegramUserId: identified.value,
    orderId,
    clientMessageId,
    kind,
    mimeType: verdict.mime,
    byteSize: verdict.bytes.length,
    width: verdict.kind === "image" ? verdict.width : null,
    height: verdict.kind === "image" ? verdict.height : null,
    durationMs: verdict.kind === "voice" ? verdict.durationMs : null,
  });
  if (!reserved.ok) {
    if ("reason" in reserved.error) deps.log?.("order_chat.store_failed", { op: "reserve" });
    return err(publicCodeFrom(reserved.error));
  }
  if (reserved.value.status === "duplicate") {
    // إعادةُ محاولةٍ لرسالةٍ وصلت: لا رفعَ ثانٍ ولا رسالةَ ثانية.
    return ok({ status: "duplicate", message: reserved.value.message });
  }
  const { attachmentId, objectPath } = reserved.value;

  const cleanup = async (why: string) => {
    const dropped = await media.store.discard(attachmentId);
    const path = dropped.ok ? (dropped.value ?? objectPath) : objectPath;
    const removed = await media.objects.remove([path]);
    deps.log?.("order_chat.media_cleanup", {
      order_id: orderId,
      kind,
      why,
      row_discarded: dropped.ok,
      object_removed: removed.ok,
    });
  };

  const stored = await media.objects.put({
    objectPath,
    bytes: verdict.bytes,
    mimeType: verdict.mime,
  });
  if (!stored.ok) {
    await cleanup("put_failed");
    return err("MEDIA_STORE_UNAVAILABLE");
  }

  const attached = await media.store.attach({
    telegramUserId: identified.value,
    orderId,
    clientMessageId,
    kind,
    attachmentId,
  });
  if (!attached.ok) {
    await cleanup("attach_failed");
    if ("reason" in attached.error) deps.log?.("order_chat.store_failed", { op: "attach" });
    return err(publicCodeFrom(attached.error));
  }
  if (attached.value.status === "duplicate") {
    // سباقٌ نادرٌ: رسالةٌ بالمعرّفِ نفسِه سبقت بعدَ الحجز ⇒ هذا المرفقُ يتيمٌ يُزالُ الآن.
    await cleanup("duplicate_after_reserve");
  } else {
    deps.onPosted?.({ orderId, lastSeq: attached.value.message.seq });
  }
  deps.log?.("order_chat.media_saved", {
    order_id: orderId,
    kind,
    bytes: verdict.bytes.length,
    stripped_bytes: verdict.kind === "image" ? verdict.strippedBytes : 0,
    status: attached.value.status,
    seq: attached.value.message.seq,
  });
  return ok(attached.value);
}

export interface OrderChatAttachmentLink {
  readonly url: string;
  readonly expiresAt: string;
  readonly mimeType: string;
}

export async function readOrderChatAttachment(
  deps: OrderChatDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly orderId: unknown;
    readonly attachmentId: unknown;
  },
): Promise<Result<OrderChatAttachmentLink, OrderChatPublicErrorCode>> {
  const { identify, readUuid, publicCodeFrom } = orderChatInternals;
  const identified = await identify(deps, input.accessToken);
  if (!identified.ok) return identified;
  const orderId = readUuid(input.orderId);
  if (orderId === null) return err("ORDER_ID_INVALID");
  const attachmentId = readUuid(input.attachmentId);
  if (attachmentId === null) return err("ATTACHMENT_NOT_FOUND");
  const media = deps.media;
  // القراءةُ تبقى ممكنةً وإن أُوقِفَ الرفعُ: ما أُرسِلَ يُرى حتّى تنتهيَ مدّتُه.
  if (media === undefined) return err("MEDIA_DISABLED");

  const authorized = await media.store.authorizeRead({
    telegramUserId: identified.value,
    orderId,
    attachmentId,
  });
  if (!authorized.ok) {
    if ("reason" in authorized.error) deps.log?.("order_chat.store_failed", { op: "authorize" });
    const code = publicCodeFrom(authorized.error);
    return err(code === "CHAT_NOT_FOUND" ? "ATTACHMENT_NOT_FOUND" : code);
  }
  const signed = await media.objects.signRead({
    objectPath: authorized.value.objectPath,
    ttlSeconds: CHAT_MEDIA_LIMITS.readTtlSeconds,
  });
  if (!signed.ok) {
    deps.log?.("order_chat.media_sign_failed", { order_id: orderId });
    return err("MEDIA_STORE_UNAVAILABLE");
  }
  return ok({
    url: signed.value.url,
    expiresAt: new Date(signed.value.expiresAtEpochMs).toISOString(),
    mimeType: authorized.value.mimeType,
  });
}
