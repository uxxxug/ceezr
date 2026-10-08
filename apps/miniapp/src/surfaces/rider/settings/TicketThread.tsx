/**
 * الغرض: رسائلُ تذكرةِ الدعم ([B] · R15) — قراءةُ رسائلِ التذكرةِ وإضافةُ رسالةٍ على العقدِ القائم، داخلَ
 *   بطاقةِ التذكرةِ نفسِها، بلا محادثةٍ حيّةٍ مُختلَقة.
 * الحالة: منفّذ فعلياً — UI-3 / PR 5 (ADR 0238).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/settings
 * يُستخدم من: `rider/support/SupportScreen.tsx` (عبرَ مَنفذِ `renderTicketExtra` في `TicketsScreen`).
 *
 * الحالات: مطويّ · تحميل · غيرُ متاح (503) · جلسة · غيرُ موجودة · خطأٌ يُعاد · لا رسائل · رسائل · يُرسَل ·
 * أُرسِل (ثمَّ قراءةٌ من الخادم) · مغلقةٌ (`TICKET_CLOSED` من الخادم: يُطفأُ الإرسال) · رُفِض.
 */

// `D-33` · `ADR 0188`: مفاتيحُ هذه اللوحةِ في جزءِ `support` من القاموس.
import "../../../../../../packages/shared/i18n/miniapp/ar-parts/support.ts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { UiBanner, UiButton, UiError, UiSkeleton, UiToast } from "../../../system/ui/index.tsx";
import { type CapabilityFailure, classifyCapabilityFailure } from "./capability.ts";
import {
  type ApiTicketMessage,
  canSendMessage,
  messageTime,
  senderKey,
  TICKET_MESSAGE_MAX,
  type TicketThreadApi,
  threadErrorKey,
  ticketThreadApi,
} from "./ticket-thread.ts";

export interface TicketThreadProps {
  readonly ticketId: string;
  readonly language?: MiniAppLanguage;
  readonly api?: TicketThreadApi;
  /** للاختبار: يُفتَحُ مبسوطاً. الافتراضُ مطويٌّ — لا قراءةَ قبلَ طلبٍ صريح. */
  readonly initiallyOpen?: boolean;
  readonly timeZone?: string;
  /**
   * بذرةُ الحالِ الأولى — **للعرضِ الساكنِ في الاختبار وحدَه** (لا مكتبةَ DOM في المستودع: ADR 0238).
   * في التشغيلِ لا تُمرَّرُ، والقراءةُ من الخادمِ تجري عندَ التركيبِ على كلِّ حال.
   */
  readonly initial?: TicketThreadSeed | undefined;
}

export interface TicketThreadSeed {
  readonly state?: TicketThreadState;
  readonly message?: string;
  readonly closed?: boolean;
  readonly sendFailure?: CapabilityFailure | null;
  readonly sent?: boolean;
}

export type TicketThreadState = ThreadState;

type ThreadState =
  | { readonly kind: "reading" }
  | { readonly kind: "failed"; readonly failure: CapabilityFailure }
  | { readonly kind: "ready"; readonly messages: readonly ApiTicketMessage[] };

const K = "rider.support.thread.";

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}

export function TicketThread({
  ticketId,
  language = MINIAPP_DEFAULT_LANGUAGE,
  api = ticketThreadApi,
  initiallyOpen = false,
  timeZone,
  initial,
}: TicketThreadProps) {
  const t = miniAppTranslator(language);
  const regionId = useId();
  const inputId = useId();
  const mounted = useRef(true);
  const zone = useRef(timeZone ?? deviceTimeZone());
  const [open, setOpen] = useState(initiallyOpen);
  const [state, setState] = useState<ThreadState>(initial?.state ?? { kind: "reading" });
  const [message, setMessage] = useState(initial?.message ?? "");
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(initial?.closed ?? false);
  const [sendFailure, setSendFailure] = useState<CapabilityFailure | null>(
    initial?.sendFailure ?? null,
  );
  const [sent, setSent] = useState(initial?.sent ?? false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState({ kind: "reading" });
    try {
      const response = await api.read(ticketId);
      if (mounted.current) setState({ kind: "ready", messages: response.messages });
    } catch (thrown) {
      if (mounted.current) setState({ kind: "failed", failure: classifyCapabilityFailure(thrown) });
    }
  }, [api, ticketId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const send = async () => {
    if (!canSendMessage(message, busy)) return;
    setBusy(true);
    setSendFailure(null);
    setSent(false);
    try {
      await api.send(ticketId, message);
      if (!mounted.current) return;
      setMessage("");
      setSent(true);
      await load();
    } catch (thrown) {
      if (!mounted.current) return;
      const failure = classifyCapabilityFailure(thrown);
      if (failure.kind === "error" && failure.code === "TICKET_CLOSED") setClosed(true);
      setSendFailure(failure);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const failureText = (failure: CapabilityFailure, fallback: string) =>
    failure.kind === "unavailable"
      ? t(`${K}unavailable`)
      : failure.kind === "session"
        ? t(`${K}session`)
        : failure.code === "UNKNOWN" || failure.code === "NETWORK" || failure.code === "HTTP_ERROR"
          ? t(fallback)
          : t(threadErrorKey(failure.code));

  const body = () => {
    if (state.kind === "reading") return <UiSkeleton label={t(`${K}reading`)} lines={2} />;
    if (state.kind === "failed") {
      const f = state.failure;
      if (f.kind === "unavailable") return <UiBanner tone="amber" message={t(`${K}unavailable`)} />;
      return (
        <UiError
          tone={f.kind === "session" ? "amber" : "bad"}
          title={t(`${K}error.title`)}
          body={failureText(f, `${K}error.read`)}
          action={
            f.kind === "error" && f.code !== "TICKET_NOT_FOUND" ? (
              <UiButton onClick={() => void load()}>{t(`${K}retry`)}</UiButton>
            ) : undefined
          }
        />
      );
    }
    const { messages } = state;
    return (
      <>
        <p className="sys__hint">{t(`${K}note`)}</p>
        {messages.length === 0 ? (
          <p className="sys__hint">{t(`${K}empty`)}</p>
        ) : (
          <ol className="rset__list" aria-label={t(`${K}listLabel`)}>
            {messages.map((m) => (
              <li className="rset__msg" key={m.id}>
                <span className="rset__msg-meta">
                  {t(senderKey(m.sender_type))} ·{" "}
                  {messageTime(m.created_at, language, zone.current)}
                </span>
                <p className="rset__msg-body">{m.message}</p>
              </li>
            ))}
          </ol>
        )}
        <div className="rset__actions">
          <UiButton size="sm" disabled={busy} onClick={() => void load()}>
            {t(`${K}refresh`)}
          </UiButton>
        </div>
        {sent ? <UiToast tone="ok" message={t(`${K}sent`)} /> : null}
        {closed ? (
          <UiBanner tone="amber" message={t(`${K}error.closed`)} />
        ) : (
          <form
            className="rset__form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label className="sup__message-label" htmlFor={inputId}>
              {t(`${K}compose`)}
            </label>
            <textarea
              className="sup__message"
              id={inputId}
              rows={3}
              maxLength={TICKET_MESSAGE_MAX}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <p className="sup__remaining">
              {t(`${K}remaining`).replace("{count}", String(TICKET_MESSAGE_MAX - message.length))}
            </p>
            {sendFailure === null ? null : (
              <UiBanner
                tone={sendFailure.kind === "unavailable" ? "amber" : "bad"}
                message={failureText(sendFailure, `${K}error.send`)}
              />
            )}
            <div className="rset__actions">
              <UiButton
                type="submit"
                variant="brand"
                loading={busy}
                disabled={!canSendMessage(message, false)}
              >
                {t(busy ? `${K}sending` : `${K}send`)}
              </UiButton>
            </div>
          </form>
        )}
      </>
    );
  };

  return (
    <div className="rset__form">
      <UiButton
        size="sm"
        aria-expanded={open}
        {...(open ? { "aria-controls": regionId } : {})}
        onClick={() => setOpen((value) => !value)}
      >
        {t(open ? `${K}hide` : `${K}show`)}
      </UiButton>
      {open ? (
        <section id={regionId} aria-label={t(`${K}title`)} className="rset__form">
          {body()}
        </section>
      ) : null}
    </div>
  );
}
