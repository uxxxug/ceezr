/**
 * الغرض: `WR-04` — بطاقةُ «المحادثة» داخلَ رحلةِ الراكبِ ومَهمّةِ السائق: زرٌّ
 *   بعددِ غيرِ المقروء، وسجلٌّ يُسترجَعُ من الخادم، وحقلُ إرسالٍ يُعيدُ المحاولةَ
 *   بالمعرّفِ نفسِه فلا تتكرّرُ الرسالة.
 *   `WR-34` (ADR 0305): الصورُ والرسائلُ الصوتيّة، وصفحاتُ الأقدم، وحقلٌ يتّسعُ بالأسطر،
 *   وتنبيهُ سلامةِ السائق، والنزولُ إلى الجديدِ دونَ انتزاعِ القارئِ من موضعِه.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/chat
 * يُستخدم من: `rider/active/ActiveRideScreen.tsx` و`driver/job/JobScreen.tsx`.
 *
 * النصوصُ تُمرَّرُ مُترجَمةً من الشاشةِ الحاضنة (`labels`) — فمفاتيحُ الراكبِ في
 * جزءِ `rider-ride` ومفاتيحُ السائقِ في جزءِ `driver`، ولا يُحمِّلُ أحدُهما جزءَ الآخر.
 *
 * ## سلامةُ السائق (ADR 0305 §السلامة)
 * النظامُ **لا يعرفُ** أنّ المركبةَ متوقّفة ولا يدّعي ذلك: لا حسّاسَ حركةٍ ولا سرعةَ GPS
 * تُستعمَلُ حكمًا. السائقُ يرى تنبيهًا عندَ فتحِ المحادثة، ويُقِرُّ بنفسِه أنّه متوقّفٌ في
 * مكانٍ آمنٍ قبلَ أوّلِ صورةٍ أو تسجيل. ولا تشغيلَ تلقائيَّ للصوتِ ولا صوتَ تنبيه.
 */

import {
  type ChangeEvent,
  type FormEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openExternalLink } from "../../tg/index.ts";
import { type DeviceFixResult, readFreshDeviceFix } from "../rider/destination/device-fix.ts";
import { ChatImage, type ChatMediaLabels, ChatVoice, createLinkCache } from "./ChatMedia.tsx";
import {
  formatDuration,
  type PreparedImage,
  prepareChatImage,
  type RecordedVoice,
  type StartVoiceRecording,
  startBrowserVoiceRecording,
  type VoiceRecording,
  VoiceStartError,
  type VoiceStartFailure,
  voiceRecordingSupported,
} from "./chat-media-capture.ts";
import {
  applyHistoryPage,
  applyThread,
  type ChatApi,
  type ChatAttachmentLink,
  type ChatFailure,
  type ChatLocation,
  type ChatMediaFailure,
  type ChatMessage,
  type ChatSnapshot,
  chatFailureOf,
  fromWireMessage,
  mediaFailureOf,
  mergeMessages,
  newClientMessageId,
  type PendingMedia,
  type PendingMessage,
  productionChatApi,
  settlePending,
} from "./order-chat-client.ts";
import { type ChatSocketFactory, productionChatSocket } from "./order-chat-socket.ts";

export interface OrderChatLabels extends ChatMediaLabels {
  readonly title: string;
  readonly open: string;
  readonly hide: string;
  readonly unread: string;
  readonly placeholder: string;
  readonly send: string;
  readonly sending: string;
  readonly failed: string;
  readonly retry: string;
  readonly closed: string;
  readonly empty: string;
  readonly loadFailed: string;
  readonly unavailable: string;
  readonly seen: string;
  readonly counterpart: string;
  readonly status: string;
  readonly refresh: string;
  /** `WR-05` — «{amount}» يُستبدَلُ بالمبلغ. */
  readonly offerFixed: string;
  readonly offerSuggested: string;
  readonly offerOpen: string;
  /** `WR-04` — مشاركةُ نقطةِ الموقعِ داخلَ المحادثة. */
  readonly shareLocation: string;
  readonly locating: string;
  readonly locationPreview: string;
  readonly sendLocation: string;
  readonly cancel: string;
  readonly locationFailed: string;
  readonly locationMessage: string;
  readonly openInMaps: string;
  /** «{value}» يُستبدَلُ بدقّةِ القراءةِ بالمتر. */
  readonly accuracy: string;
  /** `WR-04` — الترجمة: النصُّ الأصليُّ يبقى متاحًا بنقرة. */
  readonly translated: string;
  readonly showOriginal: string;
  readonly showTranslation: string;
  /** `WR-04` (ADR 0277) — الإفصاحُ: الرسائلُ النصّيّةُ تُترجَمُ آليًّا عبرَ خدمةٍ خارجيّة. */
  readonly translationNotice: string;
  /** `WR-34` — قائمةُ المرفقاتِ والصورةُ والصوت. */
  readonly attach: string;
  readonly attachImage: string;
  readonly recordVoice: string;
  readonly imagePreview: string;
  readonly sendImage: string;
  readonly preparingImage: string;
  /** «{time}» يُستبدَلُ بالمدّة. */
  readonly recording: string;
  readonly stopRecording: string;
  readonly cancelRecording: string;
  readonly voicePreview: string;
  readonly sendVoice: string;
  readonly micDenied: string;
  readonly micUnsupported: string;
  readonly micNoDevice: string;
  readonly micFailed: string;
  readonly voiceTooShort: string;
  readonly mediaTooLarge: string;
  readonly mediaUnsupported: string;
  readonly mediaQuota: string;
  readonly mediaDisabled: string;
  readonly mediaFailed: string;
  readonly remove: string;
  readonly loadOlder: string;
  readonly loadingOlder: string;
  readonly newMessages: string;
  /** `WR-34` — للسائقِ وحدَه (تمرِّرُها شاشةُ المهمّة). */
  readonly driverSafetyNotice?: string;
  readonly driverSafetyDismiss?: string;
  readonly driverSafetyGate?: string;
  readonly driverSafetyConfirm?: string;
}

type LocationDraft =
  | { readonly state: "idle" }
  | { readonly state: "locating" }
  | { readonly state: "preview"; readonly location: ChatLocation }
  | { readonly state: "failed" };

type ImageDraft =
  | { readonly state: "idle" }
  | { readonly state: "preparing" }
  | {
      readonly state: "preview";
      readonly blob: Blob;
      readonly url: string | null;
      readonly width: number | null;
      readonly height: number | null;
    }
  | { readonly state: "failed"; readonly reason: "too_large" | "unsupported" };

type VoiceDraft =
  | { readonly state: "idle" }
  | { readonly state: "starting" }
  | { readonly state: "recording"; readonly startedAt: number }
  | { readonly state: "stopping" }
  | { readonly state: "preview"; readonly voice: RecordedVoice; readonly url: string | null }
  | { readonly state: "failed"; readonly reason: VoiceStartFailure | "too_short" };

/** ما ينتظرُ إقرارَ السائقِ قبلَ أن يبدأ. */
type GatedAction = "image" | "voice" | null;

/** `WR-05` — سطرُ السعرِ بمعناه، أو `null` لطلبٍ أقدمَ من السياسة. */
export function chatOfferLine(
  labels: Pick<OrderChatLabels, "offerFixed" | "offerSuggested" | "offerOpen">,
  offerMode: "fixed" | "suggested" | "open" | null,
  offerSar: number | null,
): string | null {
  if (offerMode === "open") return labels.offerOpen;
  if (offerSar === null) return null;
  if (offerMode === "fixed") return labels.offerFixed.replace("{amount}", String(offerSar));
  if (offerMode === "suggested") {
    return labels.offerSuggested.replace("{amount}", String(offerSar));
  }
  return null;
}

export interface OrderChatProps {
  readonly orderId: string;
  readonly labels: OrderChatLabels;
  /** حالةُ الطلبِ مُترجَمةً من الشاشةِ الحاضنة — تظهرُ في رأسِ الغرفة. */
  readonly statusText: string;
  readonly api?: ChatApi;
  readonly socket?: ChatSocketFactory | null;
  /** يُفتَحُ مبسوطاً — للاختبارِ والروابطِ التي تقصدُ المحادثةَ مباشرةً. */
  readonly initiallyOpen?: boolean;
  /** قراءةُ الموقعِ عندَ ضغطِ «شارك موقعي» وحدَه — لا قبلَه ولا في الخلفيّة. */
  readonly readFix?: () => Promise<DeviceFixResult>;
  readonly openLink?: (url: string) => unknown;
  /** `WR-34` — منافذُ الجهازِ (تُستبدَلُ في الاختبار). */
  readonly startRecording?: StartVoiceRecording;
  readonly canRecordVoice?: () => boolean;
  readonly prepareImage?: (file: Blob, maxBytes: number) => Promise<PreparedImage>;
}

const MESSAGE_MAX = 1000;
/** أقصرُ تسجيلٍ يُرسَل — يطابقُ حدَّ الخادم (300ms) بهامشٍ يمنعُ النقرةَ العابرة. */
const VOICE_MIN_MS = 1000;
const NEAR_BOTTOM_PX = 96;
const TEXTAREA_MAX_PX = 128;

function timeOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function objectUrl(blob: Blob): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function revoke(url: string | null | undefined): void {
  if (url && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

function micMessage(labels: OrderChatLabels, reason: VoiceStartFailure | "too_short"): string {
  if (reason === "denied") return labels.micDenied;
  if (reason === "unsupported") return labels.micUnsupported;
  if (reason === "no_device") return labels.micNoDevice;
  if (reason === "too_short") return labels.voiceTooShort;
  return labels.micFailed;
}

function mediaFailureMessage(labels: OrderChatLabels, reason: ChatMediaFailure): string {
  if (reason === "too_large") return labels.mediaTooLarge;
  if (reason === "unsupported") return labels.mediaUnsupported;
  if (reason === "quota") return labels.mediaQuota;
  if (reason === "disabled") return labels.mediaDisabled;
  return labels.mediaFailed;
}

function withoutFailure(item: PendingMessage): PendingMessage {
  const { mediaFailure: _dropped, ...rest } = item;
  return rest;
}

type LinkGetter = (attachmentId: string, fresh?: boolean) => Promise<ChatAttachmentLink>;

interface RowProps {
  readonly message: ChatMessage;
  readonly seen: boolean;
  readonly showingOriginal: boolean;
  readonly localUrl: string | null;
  readonly labels: OrderChatLabels;
  readonly getLink: LinkGetter | null;
  readonly onToggleOriginal: (id: string) => void;
  readonly renderLocation: (location: ChatLocation) => ReactNode;
}

/** سطرٌ مؤكَّد — `memo` كي لا يُعادَ رسمُ مئاتِ الفقاعاتِ عندَ كلِّ حرفٍ في الحقل. */
const MessageRow = memo(function MessageRow({
  message: m,
  seen,
  showingOriginal,
  localUrl,
  labels,
  getLink,
  onToggleOriginal,
  renderLocation,
}: RowProps) {
  let body: ReactNode;
  if (m.kind === "location" && m.location !== null) {
    body = renderLocation(m.location);
  } else if (m.kind === "image") {
    body = (
      <ChatImage
        attachment={m.attachment ?? null}
        localUrl={localUrl}
        getLink={getLink}
        labels={labels}
      />
    );
  } else if (m.kind === "voice") {
    body = (
      <ChatVoice
        attachment={m.attachment ?? null}
        localUrl={localUrl}
        durationMs={m.attachment?.durationMs ?? null}
        getLink={getLink}
        labels={labels}
      />
    );
  } else if (m.translation === null) {
    body = (
      <span className="ocht__body" dir="auto">
        {m.body}
      </span>
    );
  } else {
    body = (
      <>
        <span className="ocht__body" dir="auto">
          {showingOriginal ? m.body : m.translation.text}
        </span>
        <span className="ocht__tr">
          {showingOriginal ? null : <span>{labels.translated} · </span>}
          <button type="button" className="ocht__tr-toggle" onClick={() => onToggleOriginal(m.id)}>
            {showingOriginal ? labels.showTranslation : labels.showOriginal}
          </button>
        </span>
      </>
    );
  }
  const media = m.kind === "image" || m.kind === "voice";
  return (
    <li
      className={`ocht__msg ${m.mine ? "ocht__msg--mine" : "ocht__msg--theirs"}${media ? " ocht__msg--media" : ""}`}
    >
      {body}
      <span className="ocht__time">
        {timeOf(m.createdAt)}
        {m.mine ? <span className="ocht__tick">{seen ? ` · ${labels.seen}` : " ✓"}</span> : null}
      </span>
    </li>
  );
});

export function OrderChat({
  orderId,
  labels,
  statusText,
  api = productionChatApi,
  socket = productionChatSocket,
  initiallyOpen = false,
  readFix = readFreshDeviceFix,
  openLink = openExternalLink,
  startRecording = startBrowserVoiceRecording,
  canRecordVoice = voiceRecordingSupported,
  prepareImage = prepareChatImage,
}: OrderChatProps) {
  const baseId = useId();
  const [open, setOpen] = useState(initiallyOpen);
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [pending, setPending] = useState<readonly PendingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState(false);
  const [locationDraft, setLocationDraft] = useState<LocationDraft>({ state: "idle" });
  const [imageDraft, setImageDraft] = useState<ImageDraft>({ state: "idle" });
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft>({ state: "idle" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [originals, setOriginals] = useState<ReadonlySet<string>>(new Set());
  const [olderState, setOlderState] = useState<"idle" | "loading" | "failed">("idle");
  const [unseenBelow, setUnseenBelow] = useState(0);
  const [safetyDismissed, setSafetyDismissed] = useState(false);
  const [safetyAcked, setSafetyAcked] = useState(false);
  const [gated, setGated] = useState<GatedAction>(null);
  const [tick, setTick] = useState(0);
  const snapshotRef = useRef<ChatSnapshot | null>(null);
  const inFlight = useRef(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recordingRef = useRef<VoiceRecording | null>(null);
  const nearBottom = useRef(true);
  const restoreFrom = useRef<number | null>(null);
  const previews = useRef(new Map<string, string>());
  const rowsBefore = useRef(0);

  const again = useRef(false);

  const getLink = useMemo<LinkGetter | null>(() => {
    const fetchLink = api.attachmentUrl;
    if (fetchLink === undefined) return null;
    return createLinkCache((attachmentId) => fetchLink(orderId, attachmentId));
  }, [api, orderId]);

  const refresh = useCallback(async (): Promise<void> => {
    // إشارةٌ وصلت أثناءَ استرجاعٍ جارٍ لا تُهمَل: تُعادُ القراءةُ بعدَه مرّةً واحدة.
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      const current = snapshotRef.current;
      // `WR-34`: الفتحُ الأوّلُ يقرأُ آخرَ صفحةٍ لا أوّلَها؛ وما بعدَه تزايديٌّ بالتسلسل.
      const next =
        current === null && api.fetchTail !== undefined
          ? applyHistoryPage(null, await api.fetchTail(orderId))
          : applyThread(current, await api.fetchAfter(orderId, current?.lastSeq ?? 0));
      snapshotRef.current = next;
      setSnapshot(next);
      setPending((p) => settlePending(p, next.messages));
      setFailure(null);
    } catch (error) {
      setFailure(chatFailureOf(error));
    } finally {
      inFlight.current = false;
    }
    if (again.current) {
      again.current = false;
      await refresh();
    }
  }, [api, orderId]);

  const loadOlder = useCallback(async () => {
    const current = snapshotRef.current;
    const first = current?.messages[0];
    if (current === null || first === undefined || api.fetchBefore === undefined) return;
    setOlderState("loading");
    try {
      const wire = await api.fetchBefore(orderId, first.seq);
      const latest = snapshotRef.current ?? current;
      const next = applyHistoryPage(latest, wire);
      // الحفاظُ على موضعِ القارئ: يُستعادُ بعدَ الرسمِ بفارقِ الارتفاع.
      restoreFrom.current = listRef.current?.scrollHeight ?? null;
      snapshotRef.current = { ...next, lastSeq: Math.max(latest.lastSeq, next.lastSeq) };
      setSnapshot(snapshotRef.current);
      setOlderState("idle");
    } catch {
      setOlderState("failed");
    }
  }, [api, orderId]);

  // أوّلُ قراءةٍ، ثمَّ القناةُ إن وُجِدَت.
  useEffect(() => {
    snapshotRef.current = null;
    setSnapshot(null);
    void refresh();
    if (socket === null) return undefined;
    const handle = socket(orderId, {
      onJoined: () => {
        setLive(true);
        void refresh();
      },
      onUpdate: (lastSeq) => {
        if (lastSeq > (snapshotRef.current?.lastSeq ?? 0)) void refresh();
      },
      onLost: () => setLive(false),
    });
    return () => handle.close();
  }, [orderId, refresh, socket]);

  // لا استقصاءَ دوريّاً (`ADR 0035` §4): ما فاتَ يُسترجَعُ عندَ (إعادةِ) الانضمامِ
  // إلى الغرفة، وعندَ عودةِ المستخدمِ إلى التطبيق، وبزرِّ «تحديث».
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // معايناتُ الجهازِ تُحرَّرُ عندَ مغادرةِ الشاشة، والميكروفونُ يُطفأُ إن كانَ يسجّل.
  useEffect(() => {
    const map = previews.current;
    return () => {
      recordingRef.current?.cancel();
      for (const url of map.values()) revoke(url);
      map.clear();
    };
  }, []);

  // المفتوحةُ تُقرأُ: يتقدّمُ موضعُ القراءةِ إلى آخرِ رسالة.
  const lastSeq = snapshot?.lastSeq ?? 0;
  const myRead = snapshot?.myLastReadSeq ?? 0;
  useEffect(() => {
    if (!open || lastSeq === 0 || lastSeq <= myRead) return;
    api
      .markRead(orderId, lastSeq)
      .then(() => {
        const current = snapshotRef.current;
        if (current === null) return;
        const next = { ...current, myLastReadSeq: lastSeq, unread: 0 };
        snapshotRef.current = next;
        setSnapshot(next);
      })
      .catch(() => undefined);
  }, [api, lastSeq, myRead, open, orderId]);

  // الصفحةُ الأقدمُ تُضافُ فوقَ القارئِ ولا تُحرِّكُه.
  useLayoutEffect(() => {
    const list = listRef.current;
    const from = restoreFrom.current;
    if (list === null || from === null) return;
    restoreFrom.current = null;
    list.scrollTop += list.scrollHeight - from;
  });

  // الجديدُ: ينزلُ السجلُّ إن كانَ القارئُ في آخرِه أو كانَ الجديدُ رسالتَه؛ وإلّا شارةُ «جديد».
  const lastMessage = snapshot?.messages[snapshot.messages.length - 1];
  const rowCount = (snapshot?.messages.length ?? 0) + pending.length;
  const lastKey = `${String(lastMessage?.seq ?? 0)}:${String(pending.length)}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: يُطلَقُ بتغيّرِ آخرِ سطرٍ وحدَه.
  useEffect(() => {
    const list = listRef.current;
    const added = rowCount - rowsBefore.current;
    rowsBefore.current = rowCount;
    if (!open || rowCount === 0 || list === null) return;
    const mineLast = pending.length > 0 || lastMessage?.mine === true;
    if (nearBottom.current || mineLast) {
      if (typeof list.scrollTo === "function") list.scrollTo({ top: list.scrollHeight });
      setUnseenBelow(0);
    } else if (added > 0) {
      setUnseenBelow((n) => n + added);
    }
  }, [open, lastKey]);

  const onListScroll = () => {
    const list = listRef.current;
    if (list === null) return;
    nearBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom.current) setUnseenBelow(0);
  };

  const jumpToBottom = () => {
    const list = listRef.current;
    if (list !== null && typeof list.scrollTo === "function") {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }
    nearBottom.current = true;
    setUnseenBelow(0);
  };

  // عدّادُ التسجيل: مهلةٌ متسلسلةٌ في الثانية أثناءَ التسجيلِ وحدَه (لا مؤقّتَ دائم).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` يُعيدُ جدولةَ المهلةِ التالية.
  useEffect(() => {
    if (voiceDraft.state !== "recording") return undefined;
    const handle = setTimeout(() => setTick((n) => n + 1), 500);
    return () => clearTimeout(handle);
  }, [voiceDraft, tick]);

  // الحقلُ يتّسعُ بالأسطرِ حتّى حدٍّ ثمَّ يُمرَّر.
  // biome-ignore lint/correctness/useExhaustiveDependencies: يُعادُ القياسُ بتغيّرِ النصّ.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.style.height = "auto";
    input.style.height = `${String(Math.min(input.scrollHeight, TEXTAREA_MAX_PX))}px`;
  }, [draft, open]);

  const confirm = useCallback((confirmed: ChatMessage) => {
    const current = snapshotRef.current;
    if (current === null) return;
    const next = {
      ...current,
      messages: mergeMessages(current.messages, [confirmed]),
      lastSeq: Math.max(current.lastSeq, confirmed.seq),
      myLastReadSeq: Math.max(current.myLastReadSeq, confirmed.seq),
    };
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const deliver = useCallback(
    async (item: PendingMessage) => {
      setPending((p) =>
        p.map((x) =>
          x.clientMessageId === item.clientMessageId
            ? withoutFailure({ ...x, state: "sending" })
            : x,
        ),
      );
      try {
        let result: Awaited<ReturnType<ChatApi["send"]>>;
        if (item.media !== undefined) {
          const upload = api.uploadMedia;
          if (upload === undefined) throw new Error("media unsupported");
          // المعرّفُ نفسُه في كلِّ إعادة ⇒ الخادمُ يُعيدُ الرسالةَ نفسَها ولا يرفعُ مرّتين.
          result = await upload(orderId, item.clientMessageId, {
            kind: item.media.kind,
            blob: item.media.blob,
            durationMs: item.media.durationMs,
          });
        } else {
          result = await api.send(
            orderId,
            item.clientMessageId,
            item.kind === "location" && item.location !== undefined
              ? { kind: "location", location: item.location }
              : { kind: "text", text: item.body },
          );
        }
        const confirmed = fromWireMessage(result.message);
        if (item.media?.previewUrl)
          previews.current.set(item.clientMessageId, item.media.previewUrl);
        confirm(confirmed);
        setPending((p) => p.filter((x) => x.clientMessageId !== item.clientMessageId));
      } catch (error) {
        const kind = chatFailureOf(error);
        if (kind === "closed") {
          setPending((p) => p.filter((x) => x.clientMessageId !== item.clientMessageId));
          revoke(item.media?.previewUrl);
          // النصُّ لا يضيعُ بصمت: يعودُ إلى الحقلِ إن كانَ فارغًا، والغرفةُ تُعرَضُ مغلقة.
          if ((item.kind ?? "text") === "text") setDraft((d) => (d.length === 0 ? item.body : d));
          void refresh();
          return;
        }
        const permanent = item.media === undefined ? null : mediaFailureOf(error);
        setPending((p) =>
          p.map((x) =>
            x.clientMessageId === item.clientMessageId
              ? {
                  ...x,
                  state: "failed" as const,
                  ...(permanent === null ? {} : { mediaFailure: permanent }),
                }
              : x,
          ),
        );
      }
    },
    [api, confirm, orderId, refresh],
  );

  const dropPending = (item: PendingMessage) => {
    revoke(item.media?.previewUrl);
    setPending((p) => p.filter((x) => x.clientMessageId !== item.clientMessageId));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || text.length > MESSAGE_MAX) return;
    const item: PendingMessage = {
      clientMessageId: newClientMessageId(),
      body: text,
      state: "sending",
    };
    setPending((p) => [...p, item]);
    setDraft("");
    nearBottom.current = true;
    void deliver(item);
  };

  const startLocation = async () => {
    setMenuOpen(false);
    setLocationDraft({ state: "locating" });
    try {
      const fix = await readFix();
      if (!fix.ok) {
        setLocationDraft({ state: "failed" });
        return;
      }
      setLocationDraft({
        state: "preview",
        location: { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM ?? null, label: null },
      });
    } catch {
      setLocationDraft({ state: "failed" });
    }
  };

  const sendLocation = (location: ChatLocation) => {
    const item: PendingMessage = {
      clientMessageId: newClientMessageId(),
      body: `${location.lat.toFixed(6)},${location.lng.toFixed(6)}`,
      state: "sending",
      kind: "location",
      location,
    };
    setPending((p) => [...p, item]);
    setLocationDraft({ state: "idle" });
    nearBottom.current = true;
    void deliver(item);
  };

  const sendMedia = (media: PendingMedia) => {
    const item: PendingMessage = {
      clientMessageId: newClientMessageId(),
      body: media.kind === "image" ? "📷" : "🎤",
      state: "sending",
      kind: media.kind,
      media,
    };
    setPending((p) => [...p, item]);
    nearBottom.current = true;
    void deliver(item);
  };

  const isDriver = snapshot?.myRole === "driver";
  const needsSafetyAck = isDriver && !safetyAcked && labels.driverSafetyGate !== undefined;

  const pickImage = () => {
    setMenuOpen(false);
    if (needsSafetyAck) {
      setGated("image");
      return;
    }
    fileRef.current?.click();
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    const max = snapshotRef.current?.media.imageMaxBytes ?? 0;
    setImageDraft({ state: "preparing" });
    const prepared = await prepareImage(file, max);
    if (!prepared.ok) {
      setImageDraft({ state: "failed", reason: prepared.reason });
      return;
    }
    setImageDraft({
      state: "preview",
      blob: prepared.blob,
      url: objectUrl(prepared.blob),
      width: prepared.width,
      height: prepared.height,
    });
  };

  const cancelImage = () => {
    if (imageDraft.state === "preview") revoke(imageDraft.url);
    setImageDraft({ state: "idle" });
  };

  const sendImage = () => {
    if (imageDraft.state !== "preview") return;
    sendMedia({
      kind: "image",
      blob: imageDraft.blob,
      previewUrl: imageDraft.url,
      durationMs: null,
      width: imageDraft.width,
      height: imageDraft.height,
    });
    setImageDraft({ state: "idle" });
  };

  const stopVoice = useCallback(async () => {
    const recording = recordingRef.current;
    if (recording === null) return;
    recordingRef.current = null;
    setVoiceDraft({ state: "stopping" });
    try {
      const voice = await recording.stop();
      if (voice.durationMs < VOICE_MIN_MS || voice.blob.size === 0) {
        setVoiceDraft({ state: "failed", reason: "too_short" });
        return;
      }
      setVoiceDraft({ state: "preview", voice, url: objectUrl(voice.blob) });
    } catch {
      setVoiceDraft({ state: "failed", reason: "failed" });
    }
  }, []);

  const startVoice = async (acknowledged = false) => {
    setMenuOpen(false);
    if (needsSafetyAck && !acknowledged) {
      setGated("voice");
      return;
    }
    if (!canRecordVoice()) {
      setVoiceDraft({ state: "failed", reason: "unsupported" });
      return;
    }
    setVoiceDraft({ state: "starting" });
    try {
      const maxMs = snapshotRef.current?.media.voiceMaxMs || 120_000;
      const recording = await startRecording({ maxMs, onAutoStop: () => void stopVoice() });
      recordingRef.current = recording;
      setVoiceDraft({ state: "recording", startedAt: recording.startedAt });
    } catch (error) {
      setVoiceDraft({
        state: "failed",
        reason: error instanceof VoiceStartError ? error.reason : "failed",
      });
    }
  };

  const cancelVoice = () => {
    recordingRef.current?.cancel();
    recordingRef.current = null;
    if (voiceDraft.state === "preview") revoke(voiceDraft.url);
    setVoiceDraft({ state: "idle" });
  };

  const sendVoice = () => {
    if (voiceDraft.state !== "preview") return;
    sendMedia({
      kind: "voice",
      blob: voiceDraft.voice.blob,
      previewUrl: voiceDraft.url,
      durationMs: voiceDraft.voice.durationMs,
      width: null,
      height: null,
    });
    setVoiceDraft({ state: "idle" });
  };

  const confirmSafety = () => {
    const action = gated;
    setSafetyAcked(true);
    setGated(null);
    // الإقرارُ فعلُ المستخدمِ نفسُه، فيمضي ما طلبَه مباشرةً (لا ضغطةَ ثالثةَ تُطيلُ النظرَ للشاشة).
    if (action === "image") fileRef.current?.click();
    if (action === "voice") void startVoice(true);
  };

  const toggleOriginal = useCallback(
    (id: string) =>
      setOriginals((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const locationCard = useCallback(
    (location: ChatLocation) => (
      <span className="ocht__loc">
        <span className="ocht__loc-title">{location.label ?? labels.locationMessage}</span>
        <span className="ocht__loc-coords" dir="ltr">
          {`${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`}
        </span>
        {location.accuracyM !== null ? (
          <span className="ocht__loc-acc">
            {labels.accuracy.replace("{value}", String(Math.round(location.accuracyM)))}
          </span>
        ) : null}
        {typeof location.mapsUrl === "string" ? (
          <button
            type="button"
            className="ocht__loc-open"
            onClick={() => {
              const url = location.mapsUrl;
              if (typeof url === "string") void openLink(url);
            }}
          >
            {labels.openInMaps}
          </button>
        ) : null}
      </span>
    ),
    [labels, openLink],
  );

  // لا غرفةَ لهذا الطلب (لم يُسنَدْ بعدُ أو انقضت النافذة): لا بطاقةَ ألبتّة.
  if (failure === "not_found" && snapshot === null) return null;

  const unread = snapshot?.unread ?? 0;
  const panelId = `${baseId}-panel`;
  const writable = snapshot?.writable === true;
  const mediaOn = writable && snapshot?.media.enabled === true && api.uploadMedia !== undefined;
  const voiceOn = mediaOn && canRecordVoice();
  const composing = voiceDraft.state === "idle" || voiceDraft.state === "failed";
  const showMic = voiceOn && draft.trim().length === 0;
  const recordingElapsed =
    voiceDraft.state === "recording" ? Math.max(0, Date.now() - voiceDraft.startedAt) : 0;

  return (
    <section className="ocht" aria-labelledby={`${baseId}-title`}>
      <button
        type="button"
        className="ocht__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span id={`${baseId}-title`} className="ocht__title">
          {labels.title}
        </span>
        {unread > 0 && !open ? (
          <span className="ocht__badge">
            <span className="ocht__sr">{labels.unread}: </span>
            {String(unread)}
          </span>
        ) : null}
        <span className="ocht__toggle-hint">{open ? labels.hide : labels.open}</span>
      </button>

      {open ? (
        <div id={panelId} className="ocht__panel">
          <p className="ocht__meta">
            <span>
              {labels.counterpart}: {snapshot?.counterpartFirstName ?? "—"}
            </span>
            <span className="ocht__status">
              {labels.status}: {statusText}
            </span>
          </p>
          {isDriver && !safetyDismissed && labels.driverSafetyNotice !== undefined ? (
            <p className="ocht__safety" role="note">
              <span>{labels.driverSafetyNotice}</span>
              <button
                type="button"
                className="ocht__retry"
                onClick={() => setSafetyDismissed(true)}
              >
                {labels.driverSafetyDismiss ?? labels.hide}
              </button>
            </p>
          ) : null}
          {snapshot !== null &&
          chatOfferLine(labels, snapshot.offerMode, snapshot.offerSar) !== null ? (
            <p className="ocht__offer">
              {chatOfferLine(labels, snapshot.offerMode, snapshot.offerSar)}
            </p>
          ) : null}
          {snapshot?.translationActive === true ? (
            <p className="ocht__offer ocht__privacy">{labels.translationNotice}</p>
          ) : null}

          {failure === "session" ? (
            <p className="ocht__notice" role="alert">
              {labels.unavailable}
            </p>
          ) : null}
          {failure === "network" || failure === "rejected" ? (
            <p className="ocht__notice" role="alert">
              {labels.loadFailed}{" "}
              <button type="button" className="ocht__retry" onClick={() => void refresh()}>
                {labels.retry}
              </button>
            </p>
          ) : null}

          {live ? null : (
            <button type="button" className="ocht__refresh" onClick={() => void refresh()}>
              {labels.refresh}
            </button>
          )}

          <div className="ocht__scroll">
            <ol ref={listRef} className="ocht__list" aria-live="polite" onScroll={onListScroll}>
              {snapshot?.hasOlder === true && api.fetchBefore !== undefined ? (
                <li className="ocht__older">
                  <button
                    type="button"
                    className="ocht__older-btn"
                    disabled={olderState === "loading"}
                    onClick={() => void loadOlder()}
                  >
                    {olderState === "loading" ? labels.loadingOlder : labels.loadOlder}
                  </button>
                  {olderState === "failed" ? (
                    <span className="ocht__media-note">{labels.loadFailed}</span>
                  ) : null}
                </li>
              ) : null}
              {snapshot !== null && snapshot.messages.length === 0 && pending.length === 0 ? (
                <li className="ocht__empty">{labels.empty}</li>
              ) : null}
              {(snapshot?.messages ?? []).map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  seen={m.mine && snapshot !== null && m.seq <= snapshot.counterpartLastReadSeq}
                  showingOriginal={originals.has(m.id)}
                  localUrl={
                    m.mine && m.clientMessageId !== null
                      ? (previews.current.get(m.clientMessageId) ?? null)
                      : null
                  }
                  labels={labels}
                  getLink={getLink}
                  onToggleOriginal={toggleOriginal}
                  renderLocation={locationCard}
                />
              ))}
              {pending.map((p) => (
                <li
                  key={p.clientMessageId}
                  className={`ocht__msg ocht__msg--mine ocht__msg--pending${p.media ? " ocht__msg--media" : ""}`}
                >
                  {p.kind === "location" && p.location !== undefined ? (
                    locationCard(p.location)
                  ) : p.media?.kind === "image" ? (
                    <ChatImage
                      attachment={null}
                      localUrl={p.media.previewUrl}
                      getLink={null}
                      labels={labels}
                    />
                  ) : p.media?.kind === "voice" ? (
                    <ChatVoice
                      attachment={null}
                      localUrl={p.media.previewUrl}
                      durationMs={p.media.durationMs}
                      getLink={null}
                      labels={labels}
                    />
                  ) : (
                    <span className="ocht__body" dir="auto">
                      {p.body}
                    </span>
                  )}
                  <span className="ocht__time" role="status">
                    {p.state === "sending"
                      ? labels.sending
                      : p.mediaFailure !== undefined
                        ? mediaFailureMessage(labels, p.mediaFailure)
                        : labels.failed}
                    {p.state === "failed" && p.mediaFailure === undefined ? (
                      <button type="button" className="ocht__retry" onClick={() => void deliver(p)}>
                        {labels.retry}
                      </button>
                    ) : null}
                    {p.state === "failed" && p.media !== undefined ? (
                      <button type="button" className="ocht__retry" onClick={() => dropPending(p)}>
                        {labels.remove}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
            {unseenBelow > 0 ? (
              <button type="button" className="ocht__jump" onClick={jumpToBottom}>
                {labels.newMessages} ({String(unseenBelow)})
              </button>
            ) : null}
          </div>

          {gated !== null ? (
            <div
              className="ocht__draft ocht__draft--safety"
              role="alertdialog"
              aria-live="assertive"
            >
              <p>{labels.driverSafetyGate}</p>
              <div className="ocht__draft-actions">
                <button type="button" className="ocht__send" onClick={confirmSafety}>
                  {labels.driverSafetyConfirm}
                </button>
                <button type="button" className="ocht__ghost" onClick={() => setGated(null)}>
                  {labels.cancel}
                </button>
              </div>
            </div>
          ) : null}

          {writable && locationDraft.state !== "idle" ? (
            <div className="ocht__locdraft ocht__draft" role="status">
              {locationDraft.state === "locating" ? <p>{labels.locating}</p> : null}
              {locationDraft.state === "failed" ? (
                <p>
                  {labels.locationFailed}{" "}
                  <button
                    type="button"
                    className="ocht__retry"
                    onClick={() => void startLocation()}
                  >
                    {labels.retry}
                  </button>
                </p>
              ) : null}
              {locationDraft.state === "preview" ? (
                <>
                  <p className="ocht__locdraft-title">{labels.locationPreview}</p>
                  {locationCard(locationDraft.location)}
                  <button
                    type="button"
                    className="ocht__send"
                    onClick={() => sendLocation(locationDraft.location)}
                  >
                    {labels.sendLocation}
                  </button>
                </>
              ) : null}
              {locationDraft.state !== "locating" ? (
                <button
                  type="button"
                  className="ocht__retry"
                  onClick={() => setLocationDraft({ state: "idle" })}
                >
                  {labels.cancel}
                </button>
              ) : null}
            </div>
          ) : null}

          {writable && imageDraft.state !== "idle" ? (
            <div className="ocht__draft" role="status">
              {imageDraft.state === "preparing" ? <p>{labels.preparingImage}</p> : null}
              {imageDraft.state === "failed" ? (
                <p>
                  {imageDraft.reason === "too_large"
                    ? labels.mediaTooLarge
                    : labels.mediaUnsupported}
                </p>
              ) : null}
              {imageDraft.state === "preview" ? (
                <>
                  <p className="ocht__locdraft-title">{labels.imagePreview}</p>
                  {imageDraft.url !== null ? (
                    <img
                      className="ocht__draft-img"
                      src={imageDraft.url}
                      alt={labels.imagePreview}
                    />
                  ) : null}
                </>
              ) : null}
              {imageDraft.state !== "preparing" ? (
                <div className="ocht__draft-actions">
                  {imageDraft.state === "preview" ? (
                    <button type="button" className="ocht__send" onClick={sendImage}>
                      {labels.sendImage}
                    </button>
                  ) : null}
                  <button type="button" className="ocht__ghost" onClick={cancelImage}>
                    {labels.cancel}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {writable && voiceDraft.state === "failed" ? (
            <div className="ocht__draft" role="alert">
              <p>{micMessage(labels, voiceDraft.reason)}</p>
              <div className="ocht__draft-actions">
                <button type="button" className="ocht__ghost" onClick={cancelVoice}>
                  {labels.cancel}
                </button>
              </div>
            </div>
          ) : null}

          {writable && voiceDraft.state === "preview" ? (
            <div className="ocht__draft" role="status">
              <p className="ocht__locdraft-title">{labels.voicePreview}</p>
              <ChatVoice
                attachment={null}
                localUrl={voiceDraft.url}
                durationMs={voiceDraft.voice.durationMs}
                getLink={null}
                labels={labels}
              />
              <div className="ocht__draft-actions">
                <button type="button" className="ocht__send" onClick={sendVoice}>
                  {labels.sendVoice}
                </button>
                <button type="button" className="ocht__ghost" onClick={cancelVoice}>
                  {labels.cancel}
                </button>
              </div>
            </div>
          ) : null}

          {snapshot !== null && !snapshot.writable ? (
            <p className="ocht__notice">{labels.closed}</p>
          ) : voiceDraft.state === "starting" ||
            voiceDraft.state === "recording" ||
            voiceDraft.state === "stopping" ? (
            <div className="ocht__recorder" role="status" aria-live="polite">
              <span className="ocht__rec-dot" aria-hidden="true" />
              <span className="ocht__rec-time">
                {voiceDraft.state === "starting"
                  ? labels.mediaLoading
                  : labels.recording.replace("{time}", formatDuration(recordingElapsed))}
              </span>
              <button type="button" className="ocht__ghost" onClick={cancelVoice}>
                {labels.cancelRecording}
              </button>
              <button
                type="button"
                className="ocht__send"
                disabled={voiceDraft.state !== "recording"}
                onClick={() => void stopVoice()}
              >
                {labels.stopRecording}
              </button>
            </div>
          ) : (
            <form className="ocht__form" onSubmit={onSubmit}>
              <div className="ocht__attach-wrap">
                <button
                  type="button"
                  className="ocht__attach"
                  aria-label={mediaOn ? labels.attach : labels.shareLocation}
                  title={mediaOn ? labels.attach : labels.shareLocation}
                  aria-expanded={mediaOn ? menuOpen : undefined}
                  disabled={snapshot === null || locationDraft.state === "locating" || !composing}
                  onClick={() => (mediaOn ? setMenuOpen((v) => !v) : void startLocation())}
                >
                  {mediaOn ? <span aria-hidden="true">＋</span> : labels.shareLocation}
                </button>
                {mediaOn && menuOpen ? (
                  <div className="ocht__menu">
                    <button type="button" className="ocht__menu-item" onClick={pickImage}>
                      {labels.attachImage}
                    </button>
                    <button
                      type="button"
                      className="ocht__menu-item"
                      onClick={() => void startLocation()}
                    >
                      {labels.shareLocation}
                    </button>
                  </div>
                ) : null}
              </div>
              {mediaOn ? (
                <input
                  ref={fileRef}
                  className="ocht__file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => void onFile(event)}
                />
              ) : null}
              <textarea
                ref={inputRef}
                className="ocht__input"
                value={draft}
                maxLength={MESSAGE_MAX}
                rows={1}
                dir="auto"
                aria-label={labels.placeholder}
                placeholder={labels.placeholder}
                onChange={(e) => setDraft(e.target.value)}
                disabled={snapshot === null}
              />
              {showMic ? (
                <button
                  type="button"
                  className="ocht__send ocht__mic"
                  aria-label={labels.recordVoice}
                  title={labels.recordVoice}
                  disabled={!composing}
                  onClick={() => void startVoice()}
                >
                  <span aria-hidden="true">🎙</span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="ocht__send"
                  disabled={snapshot === null || draft.trim().length === 0}
                >
                  {labels.send}
                </button>
              )}
            </form>
          )}
        </div>
      ) : null}
    </section>
  );
}
