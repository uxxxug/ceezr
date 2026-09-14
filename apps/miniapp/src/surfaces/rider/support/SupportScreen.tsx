/**
 * الغرض: شاشةُ الدعمِ والشكوى من داخلِ التطبيقِ — فتحُ تذكرةٍ **بمرجعٍ يُنطَقُ**
 *   وقراءةُ «تذاكري وحالاتُها» (البند `F2-12` · `SR-11` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/support
 * يُستخدم من: `RiderRoot.tsx` (من شاشةِ الحسابِ ومن تفاصيلِ رحلةٍ).
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` — الشاشةُ عينُها بأصنافِ السائقِ.
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لماذا المرجعُ **أكبرُ ما على الشاشةِ** بعدَ الإرسالِ
 *
 * لأنَّه الشيءُ الوحيدُ الذي يخرجُ من هذه الشاشةِ إلى العالمِ: يُقرأُ في قروبٍ،
 * ويُكتَبُ في رسالةٍ، ويُقالُ في مكالمةٍ. ونصٌّ يقولُ «تمَّ الإرسالُ» وحدَه
 * يتركُ الإنسانَ بلا شيءٍ يُطالِبُ به.
 *
 * ## ولماذا القائمةُ تُقرأُ **بعدَ** الإرسالِ ولا تُبنى في العميلِ
 *
 * التذكرةُ المفتوحةُ تُضافُ إلى القائمةِ **من القاعدةِ** لا بسطرٍ يُدسُّ محليّاً:
 * صفٌّ مُختلَقٌ في الواجهةِ يظهرُ بحالةٍ لم يقلْها أحدٌ ويختفي عندَ أوّلِ تحديثٍ.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — وحدودُها مُعلَنةٌ (`ح-5`)
 *
 *   ــ **لا تُرفِقُ صورةً**: رفعُ ملفٍّ **دَينٌ مُعلَنٌ** يُقالُ في القائمةِ.
 *   ــ **لا تفتحُ محادثةً داخلَ التذكرةِ**: الردُّ في قروبِ المدينةِ اليومَ،
 *      وحالةُ التذكرةِ وقرارُ حلِّها يُقرآنِ ههنا.
 *   ــ **لا تعرضُ أسئلةً شائعةً ولا صفحةَ مفقوداتٍ**: محتوىً تحريريٌّ **دَينٌ
 *      مُعلَنٌ** — والبندُ `F2-12` يبقى `[~]` لأجلِه.
 *   ــ **لا تُظهِرُ زرَّ إعادةٍ فوقَ تهدئةٍ**: تقولُ الثانيةَ الباقيةَ.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import {
  type ApiSupportCursor,
  type ApiSupportTicket,
  type OpenTicketResponse,
  openSupportTicket,
  readSupportTickets,
  type SupportTicketsResponse,
} from "./support-api.ts";
import {
  canSubmit,
  categoryRequiresOrder,
  DEFAULT_SUPPORT_PAGE_SIZE,
  isRetryableSupportError,
  MAX_SUPPORT_MESSAGE_CHARS,
  RIDER_SUPPORT_CATEGORIES,
  type RiderSupportCategory,
  remainingChars,
  type SupportStatusTone,
  supportErrorKey,
  toTicketRow,
} from "./support-view.ts";

export interface SupportScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  /**
   * رحلةٌ جاءَ منها الراكبُ (`F2-08` تفاصيلُ رحلةٍ) — **تُثبَّتُ ولا تُكتَبُ
   * بيدٍ**: حقلُ معرّفٍ يُملأُ يدويّاً بابُ خطأٍ لا بابُ دعمٍ.
   */
  readonly orderId?: string | null;
  readonly openTicket?: (input: {
    readonly category: RiderSupportCategory;
    readonly message: string;
    readonly orderId: string | null;
  }) => Promise<OpenTicketResponse>;
  readonly readTickets?: (input: {
    readonly limit: number;
    readonly cursor: ApiSupportCursor | null;
  }) => Promise<SupportTicketsResponse>;
}

type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  | { readonly kind: "failed"; readonly code: string };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function retryAfterOf(thrown: unknown): number | null {
  if (thrown !== null && typeof thrown === "object" && "retryAfterSeconds" in thrown) {
    const value = (thrown as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

/**
 * أصنافُ شارةِ الحالةِ — **مكتوبةٌ حرفاً في هذا المِلفِّ** لا مبنيّةٌ من اسمِ
 * الحالةِ في زمنِ التشغيلِ: حاجزُ تغطيةِ الأنماطِ (`ADR 0105` · `UX-021`) يقرأُ
 * النصَّ الساكنَ، وصنفٌ مبنيٌّ يمرُّ أخضرَ وهوَ بلا قاعدةٍ في ورقةِ النمطِ.
 */
const STATUS_BADGE: Record<SupportStatusTone, { readonly modifier: string }> = {
  open: { modifier: "sup__ticket-status--open" },
  working: { modifier: "sup__ticket-status--working" },
  done: { modifier: "sup__ticket-status--done" },
  refused: { modifier: "sup__ticket-status--refused" },
};

/** ما لا سندَ له في هذه الشاشةِ — يُقالُ ولا يُوضَعُ له زرٌّ صوريٌّ. */
const DECLARED_DEBT: readonly string[] = [
  "rider.support.debt.attachment",
  "rider.support.debt.thread",
  "rider.support.debt.faq",
  "rider.support.debt.lostFound",
];

export function SupportScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  orderId = null,
  openTicket = openSupportTicket,
  readTickets = readSupportTickets,
}: SupportScreenProps) {
  const t = miniAppTranslator(language);
  const messageId = useId();
  const [category, setCategory] = useState<RiderSupportCategory | null>(
    // رحلةٌ جاءَ منها الراكبُ = شكوى رحلةٍ **مبدئيّاً** لا قطعاً: يُبدِّلُها.
    orderId === null ? null : "ride_dispute",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<OpenTicketResponse | null>(null);
  const [formError, setFormError] = useState<{ code: string; retryAfter: number | null } | null>(
    null,
  );
  const [tickets, setTickets] = useState<readonly ApiSupportTicket[]>([]);
  const [cursor, setCursor] = useState<ApiSupportCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [expectedMinutes, setExpectedMinutes] = useState<number | null>(null);
  const [listState, setListState] = useState<ListState>({ kind: "loading" });

  const loadPage = useCallback(
    async (from: ApiSupportCursor | null) => {
      setListState({ kind: "loading" });
      try {
        const response = await readTickets({ limit: DEFAULT_SUPPORT_PAGE_SIZE, cursor: from });
        // **إلحاقٌ عندَ المتابعةِ واستبدالٌ عندَ البدايةِ**: دمجٌ أعمى يُكرِّرُ
        // صفّاً بعدَ إرسالٍ جديدٍ فيُقرأُ تذكرتَينِ لشكوى واحدةٍ.
        setTickets((current) =>
          from === null ? response.tickets : [...current, ...response.tickets],
        );
        setCursor(response.next_cursor);
        setHasMore(response.has_more);
        setExpectedMinutes(response.expected_response_minutes);
        setListState({ kind: "ready" });
      } catch (thrown) {
        setListState({ kind: "failed", code: codeOf(thrown) });
      }
    },
    [readTickets],
  );

  useEffect(() => {
    void loadPage(null);
  }, [loadPage]);

  const submit = useCallback(async () => {
    if (category === null) return;
    setBusy(true);
    setFormError(null);
    try {
      const response = await openTicket({ category, message: message.trim(), orderId });
      setOpened(response);
      setMessage("");
      // القائمةُ تُقرأُ من القاعدةِ بعدَ الكتابةِ — لا صفَّ يُدَسُّ محليّاً.
      await loadPage(null);
    } catch (thrown) {
      setFormError({ code: codeOf(thrown), retryAfter: retryAfterOf(thrown) });
    } finally {
      setBusy(false);
    }
  }, [category, loadPage, message, openTicket, orderId]);

  const submittable = canSubmit({ category, message, orderId, busy });

  return (
    <section className="sup" aria-labelledby="support-title">
      <h1 className="sup__title" id="support-title">
        {t("rider.support.title")}
      </h1>
      {onBack !== undefined && (
        <button type="button" className="sys__action sup__back" onClick={onBack}>
          {t("rider.support.back")}
        </button>
      )}

      {/* ــ إيصالُ الفتحِ: **المرجعُ أوّلاً وأكبرُ** ــ */}
      {opened !== null && (
        <div className="sup__receipt" role="status">
          <p className="sup__receipt-lead">{t("rider.support.opened.lead")}</p>
          <p className="sup__reference">{opened.reference}</p>
          <p className="sup__receipt-hint">{t("rider.support.opened.keepReference")}</p>
          {expectedMinutes !== null && (
            <p className="sup__expected">
              {t("rider.support.opened.expected").replace("{minutes}", String(expectedMinutes))}
            </p>
          )}
        </div>
      )}

      {/* ــ نموذجُ الشكوى ــ */}
      <div className="sup__form">
        <p className="sup__form-lead">{t("rider.support.form.lead")}</p>

        <fieldset className="sup__categories">
          <legend className="sup__categories-legend">{t("rider.support.form.category")}</legend>
          {RIDER_SUPPORT_CATEGORIES.map((value) => (
            <label className="sup__category" key={value}>
              <input
                type="radio"
                name="support-category"
                value={value}
                checked={category === value}
                onChange={() => setCategory(value)}
              />
              <span className="sup__category-label">{t(`rider.support.category.${value}`)}</span>
            </label>
          ))}
        </fieldset>

        {/*
          **الرحلةُ تُقالُ ولا تُطلَبُ كتابةً**: صنفٌ يحتاجُ رحلةً والراكبُ جاءَ
          من غيرِ تفاصيلِ رحلةٍ يُقالُ له مِن أينَ يدخلُ — لا يُعرَضُ حقلُ معرّفٍ.
        */}
        {category !== null && categoryRequiresOrder(category) && orderId === null && (
          <p className="sup__order-required" role="note">
            {t("rider.support.form.orderRequired")}
          </p>
        )}
        {orderId !== null && (
          <p className="sup__order-bound">{t("rider.support.form.orderBound")}</p>
        )}

        <label className="sup__message-label" htmlFor={messageId}>
          {t("rider.support.form.message")}
        </label>
        <textarea
          className="sup__message"
          id={messageId}
          maxLength={MAX_SUPPORT_MESSAGE_CHARS}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
          value={message}
        />
        <p className="sup__remaining">
          {t("rider.support.form.remaining").replace("{count}", String(remainingChars(message)))}
        </p>

        <button
          type="button"
          className="sys__action sup__submit"
          disabled={!submittable}
          onClick={() => void submit()}
        >
          {t(busy ? "rider.support.form.sending" : "rider.support.form.submit")}
        </button>

        {formError !== null && (
          <p className="sup__error" role="alert">
            {formError.code === "COOLDOWN_ACTIVE" && formError.retryAfter !== null
              ? t("rider.support.error.COOLDOWN_ACTIVE_SECONDS").replace(
                  "{seconds}",
                  String(formError.retryAfter),
                )
              : t(supportErrorKey(formError.code))}
          </p>
        )}
        {formError !== null && isRetryableSupportError(formError.code) && (
          <button type="button" className="sys__action sup__retry" onClick={() => void submit()}>
            {t("rider.support.form.retry")}
          </button>
        )}
      </div>

      {/* ــ تذاكري وحالاتُها ــ */}
      <div className="sup__list">
        <h2 className="sup__list-title">{t("rider.support.list.title")}</h2>
        {expectedMinutes !== null && (
          <p className="sup__list-expected">
            {t("rider.support.list.expected").replace("{minutes}", String(expectedMinutes))}
          </p>
        )}

        {listState.kind === "failed" && (
          <p className="sup__list-error" role="alert">
            {t(supportErrorKey(listState.code))}
          </p>
        )}
        {listState.kind === "loading" && (
          <p className="sup__list-loading">{t("rider.support.list.loading")}</p>
        )}
        {listState.kind === "ready" && tickets.length === 0 && (
          <p className="sup__list-empty">{t("rider.support.list.empty")}</p>
        )}

        <ul className="sup__tickets">
          {tickets.map((ticket) => {
            const row = toTicketRow(ticket);
            // الشارةُ تُقرأُ من الجدولِ **قبلَ** العرضِ كي يكونَ الإحلالُ
            // `badge.modifier` — تعبيراً يُحَلُّ ساكناً لحاجزِ الأنماطِ.
            const badge = STATUS_BADGE[row.statusTone];
            return (
              <li className="sup__ticket" key={row.id}>
                <span className="sup__ticket-reference">{row.reference}</span>
                <span className={`sup__ticket-status ${badge.modifier}`}>{t(row.statusKey)}</span>
                <span className="sup__ticket-category">{t(row.categoryKey)}</span>
                <p className="sup__ticket-message">{row.message}</p>
                {row.resolution !== null && (
                  <p className="sup__ticket-resolution">
                    {t("rider.support.list.resolution").replace("{text}", row.resolution)}
                  </p>
                )}
                {row.hasOrder && (
                  <span className="sup__ticket-ride">{t("rider.support.list.aboutRide")}</span>
                )}
              </li>
            );
          })}
        </ul>

        {hasMore && cursor !== null && (
          <button
            type="button"
            className="sys__action sup__more"
            disabled={listState.kind === "loading"}
            onClick={() => void loadPage(cursor)}
          >
            {t("rider.support.list.more")}
          </button>
        )}
      </div>

      {/* **الحدُّ يُقالُ** — انظرْ رأسَ المِلفِّ. */}
      <div className="sup__debt">
        <p className="sup__debt-title">{t("rider.support.debt.title")}</p>
        <ul className="sup__debt-list">
          {DECLARED_DEBT.map((key) => (
            <li className="sup__debt-item" key={key}>
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
