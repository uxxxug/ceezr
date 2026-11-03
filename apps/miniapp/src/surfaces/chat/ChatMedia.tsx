/**
 * الغرض: `WR-34` (ADR 0305) — عرضُ وسائطِ المحادثةِ داخلَ الفقاعة: صورةٌ مصغَّرةٌ تُفتَحُ
 *   بحجمٍ مناسب، ومشغِّلُ رسالةٍ صوتيّةٍ بمدّتِها. الملفُّ يُقرأُ برابطٍ موقَّعٍ قصيرٍ يُطلَبُ
 *   عندَ الحاجةِ وحدَها (الصورةُ حينَ تقتربُ من الشاشة، والصوتُ حينَ يُضغَطُ «تشغيل»)،
 *   ويُجدَّدُ مرّةً إن انتهى.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/chat
 * يُستخدم من: `OrderChat.tsx`.
 */

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { formatDuration } from "./chat-media-capture.ts";
import type { ChatAttachment, ChatAttachmentLink } from "./order-chat-client.ts";

export interface ChatMediaLabels {
  readonly imageMessage: string;
  readonly voiceMessage: string;
  readonly openImage: string;
  readonly closeImage: string;
  readonly play: string;
  readonly pause: string;
  readonly mediaLoading: string;
  readonly mediaLoadFailed: string;
  readonly mediaExpired: string;
  readonly voiceCannotPlay: string;
  readonly retry: string;
}

export type FetchAttachmentLink = (attachmentId: string) => Promise<ChatAttachmentLink>;

/** الرابطُ صالحٌ إن بقيَ له أكثرُ من نصفِ دقيقة. */
const LINK_MARGIN_MS = 30_000;

/** ذاكرةُ روابطَ في الجلسةِ وحدَها (لا تخزينَ في الجهاز). */
export function createLinkCache(fetchLink: FetchAttachmentLink, now: () => number = Date.now) {
  const cache = new Map<string, ChatAttachmentLink>();
  return async (attachmentId: string, fresh = false): Promise<ChatAttachmentLink> => {
    const known = cache.get(attachmentId);
    if (!fresh && known !== undefined && Date.parse(known.expiresAt) - now() > LINK_MARGIN_MS) {
      return known;
    }
    const link = await fetchLink(attachmentId);
    cache.set(attachmentId, link);
    return link;
  };
}

type LinkState =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly url: string }
  | { readonly state: "failed" };

function useVisible<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (node === null || visible) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible];
}

export function ChatImage({
  attachment,
  localUrl,
  getLink,
  labels,
}: {
  readonly attachment: ChatAttachment | null;
  /** معاينةٌ محلّيّةٌ لمعلَّقٍ لم يؤكَّد بعد. */
  readonly localUrl?: string | null;
  readonly getLink: ((attachmentId: string, fresh?: boolean) => Promise<ChatAttachmentLink>) | null;
  readonly labels: ChatMediaLabels;
}) {
  const [box, visible] = useVisible<HTMLSpanElement>();
  const [link, setLink] = useState<LinkState>({ state: "idle" });
  const [viewing, setViewing] = useState(false);
  const retried = useRef(false);
  const id = attachment?.id ?? null;
  const available = attachment?.available === true;

  const load = useCallback(
    async (fresh: boolean) => {
      if (id === null || getLink === null) return;
      setLink({ state: "loading" });
      try {
        const next = await getLink(id, fresh);
        setLink({ state: "ready", url: next.url });
      } catch {
        setLink({ state: "failed" });
      }
    },
    [getLink, id],
  );

  useEffect(() => {
    if (localUrl || !visible || !available || link.state !== "idle") return;
    void load(false);
  }, [available, link.state, load, localUrl, visible]);

  const src = localUrl ?? (link.state === "ready" ? link.url : null);
  const ratio =
    attachment?.width && attachment.height
      ? `${String(attachment.width)} / ${String(attachment.height)}`
      : "4 / 3";

  if (!localUrl && attachment !== null && !available) {
    return <span className="ocht__media-note">{labels.mediaExpired}</span>;
  }

  return (
    <span ref={box} className="ocht__image" style={{ aspectRatio: ratio }}>
      {src !== null ? (
        <button
          type="button"
          className="ocht__image-open"
          aria-label={labels.openImage}
          onClick={() => setViewing(true)}
        >
          <img
            src={src}
            alt={labels.imageMessage}
            loading="lazy"
            decoding="async"
            onError={() => {
              // رابطٌ انتهى أثناءَ بقاءِ الشاشة: تجديدٌ واحدٌ لا حلقة.
              if (localUrl || retried.current) {
                setLink({ state: "failed" });
                return;
              }
              retried.current = true;
              void load(true);
            }}
          />
        </button>
      ) : link.state === "failed" ? (
        <span className="ocht__media-note" role="status">
          {labels.mediaLoadFailed}{" "}
          <button
            type="button"
            className="ocht__retry"
            onClick={() => {
              retried.current = false;
              void load(true);
            }}
          >
            {labels.retry}
          </button>
        </span>
      ) : (
        <span className="ocht__media-loading">{labels.mediaLoading}</span>
      )}
      {viewing && src !== null ? (
        <ImageViewer src={src} labels={labels} onClose={() => setViewing(false)} />
      ) : null}
    </span>
  );
}

function ImageViewer({
  src,
  labels,
  onClose,
}: {
  readonly src: string;
  readonly labels: ChatMediaLabels;
  readonly onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <span className="ocht__viewer" role="dialog" aria-modal="true" aria-label={labels.imageMessage}>
      <button ref={closeRef} type="button" className="ocht__viewer-close" onClick={onClose}>
        {labels.closeImage}
      </button>
      <img className="ocht__viewer-img" src={src} alt={labels.imageMessage} />
    </span>
  );
}

type PlayerState = "idle" | "loading" | "playing" | "paused" | "failed" | "unplayable";

export function ChatVoice({
  attachment,
  localUrl,
  durationMs,
  getLink,
  labels,
}: {
  readonly attachment: ChatAttachment | null;
  readonly localUrl?: string | null;
  readonly durationMs: number | null;
  readonly getLink: ((attachmentId: string, fresh?: boolean) => Promise<ChatAttachmentLink>) | null;
  readonly labels: ChatMediaLabels;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayerState>("idle");
  const [position, setPosition] = useState(0);
  const [srcSet, setSrcSet] = useState(false);
  const retried = useRef(false);
  const total = durationMs ?? attachment?.durationMs ?? null;

  useEffect(() => {
    const audio = audioRef.current;
    const mime = attachment?.mimeType;
    if (audio === null || mime === undefined || typeof audio.canPlayType !== "function") return;
    // `audio/webm` على iOS قبلَ Safari 18.4 (أو `audio/ogg`) قد لا يُشغَّل — قولٌ صريحٌ لا صمت.
    const base = mime.split(";")[0] ?? mime;
    if (audio.canPlayType(base) === "" && audio.canPlayType(mime) === "") setState("unplayable");
  }, [attachment?.mimeType]);

  if (!localUrl && attachment !== null && !attachment.available) {
    return <span className="ocht__media-note">{labels.mediaExpired}</span>;
  }

  const start = async (fresh = false) => {
    const audio = audioRef.current;
    if (audio === null) return;
    if (!srcSet || fresh) {
      if (localUrl) {
        audio.src = localUrl;
      } else {
        if (attachment === null || getLink === null) return;
        setState("loading");
        try {
          const link = await getLink(attachment.id, fresh);
          audio.src = link.url;
        } catch {
          setState("failed");
          return;
        }
      }
      setSrcSet(true);
    }
    try {
      setState("loading");
      await audio.play();
      setState("playing");
    } catch {
      setState((current) => (current === "unplayable" ? current : "failed"));
    }
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (audio === null) return;
    if (state === "playing") {
      audio.pause();
      setState("paused");
      return;
    }
    retried.current = false;
    void start();
  };

  const progress =
    total !== null && total > 0 ? Math.min(100, Math.round((position / total) * 100)) : 0;

  return (
    <span className="ocht__voice">
      {state === "unplayable" ? (
        <span className="ocht__media-note">{labels.voiceCannotPlay}</span>
      ) : (
        <button
          type="button"
          className="ocht__voice-play"
          aria-label={state === "playing" ? labels.pause : labels.play}
          disabled={state === "loading"}
          onClick={toggle}
        >
          <span aria-hidden="true">{state === "playing" ? "❚❚" : "▶"}</span>
        </button>
      )}
      <span className="ocht__voice-track" aria-hidden="true">
        <span className="ocht__voice-fill" style={{ inlineSize: `${String(progress)}%` }} />
      </span>
      <span className="ocht__voice-time" dir="ltr">
        {state === "playing" || state === "paused"
          ? `${formatDuration(position)} / ${formatDuration(total)}`
          : formatDuration(total)}
      </span>
      <span className="ocht__sr">{labels.voiceMessage}</span>
      {state === "loading" ? (
        <span className="ocht__media-loading">{labels.mediaLoading}</span>
      ) : null}
      {state === "failed" ? (
        <span className="ocht__media-note" role="status">
          {labels.mediaLoadFailed}{" "}
          <button type="button" className="ocht__retry" onClick={() => void start(true)}>
            {labels.retry}
          </button>
        </span>
      ) : null}
      {/* biome-ignore lint/a11y/useMediaCaption: رسالةٌ صوتيّةٌ بين طرفَين — لا نصَّ مرافقًا لها. */}
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime * 1000)}
        onEnded={() => {
          setState("paused");
          setPosition(0);
        }}
        onError={() => {
          if (!srcSet) return;
          // رابطٌ انتهى: تجديدٌ واحدٌ ثمَّ «تعذّر».
          if (!localUrl && !retried.current) {
            retried.current = true;
            void start(true);
            return;
          }
          setState("failed");
        }}
      />
    </span>
  );
}
