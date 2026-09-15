/**
 * الغرض: شاشةُ الدعمِ والشكوى — فتحُ تذكرةٍ **بمرجعٍ يُنطَقُ** وقراءةُ «تذاكري
 *   وحالاتُها»، **مُعامَلةٌ بالدورِ** فتُخدَمُ الراكبَ والسائقَ بنسخةٍ واحدةٍ
 *   (`F2-12` · `SR-11` · `F3-08` · `SD-10` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08` (الزيادةُ `S-5`)، ومنقولٌ عن `F2-12`.
 * ينتمي إلى: apps/miniapp/src/surfaces/support
 * يُستخدم من: `rider/support/SupportScreen.tsx` · `driver/support/SupportScreen.tsx`
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لِمَ شاشةٌ واحدةٌ للدورَينِ ولا شاشتانِ متشابهتانِ
 *
 * لأنَّ ما يفترقُ بينَ الدورَينِ **ثلاثةُ أشياءَ**: قائمةُ الأصنافِ، وبادئةُ
 * النصِّ، والمسارُ. وكلُّ ما بعدَها واحدٌ: ترتيبُ الإيصالِ، وحكمُ زرِّ الإرسالِ،
 * وسلوكُ الترقيمِ، وقراءةُ القائمةِ **من القاعدةِ بعدَ الكتابةِ**، ونصُّ
 * التهدئةِ بثانيتِها. ونسخةٌ ثانيةٌ تعني إصلاحاً يُصيبُ دوراً ويُخطئُ الآخرَ —
 * وهذا بالذاتِ ما وقعَ في هذا المستودعِ قبلَ أن تُوحَّدَ نواةُ الاستقبالِ.
 *
 * ## ولِمَ صارَ سطحُ الراكبِ يستدعيها ولم يُنسَخْ عنها
 *
 * حِفظاً لِحكمِ `ح-8`: **لا سلوكَ ناجحاً يُنقَصُ**. فأسماءُ الأصنافِ في الشاشةِ
 * وأصنافُ الأنماطِ ومفاتيحُ `rider.support.` كما هيَ حرفاً، والمُقاسُ في
 * `tests/unit/rider-support-view.test.ts` يمرُّ بالأبوابِ نفسِها.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — وحدودُها مُعلَنةٌ (`ح-5`)
 *
 *   ــ **لا تُرفِقُ صورةً**: رفعُ ملفٍّ **دَينٌ مُعلَنٌ** يُقالُ في القائمةِ.
 *   ــ **لا تفتحُ محادثةً داخلَ التذكرةِ**: الردُّ في قروبِ المدينةِ اليومَ،
 *      وحالةُ التذكرةِ وقرارُ حلِّها يُقرآنِ ههنا.
 *   ــ **لا تُظهِرُ زرَّ إعادةٍ فوقَ تهدئةٍ**: تقولُ الثانيةَ الباقيةَ.
 *   ــ **لا تُوجِّهُ بمسارٍ**: الانتقالُ حالةٌ محليّةٌ في جذرِ السطحِ.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../packages/shared/i18n/miniapp/index.ts";
import type { OpenTicketInput, ReadTicketsInput } from "./ticket-api.ts";
import type {
  ApiSupportCursor,
  ApiSupportTicket,
  OpenTicketResponse,
  SupportTicketsResponse,
} from "./ticket-contract.ts";
import type { SupportStatusTone, SupportSurfaceSpec, SupportViewModel } from "./ticket-view.ts";
import { isRetryableSupportError } from "./ticket-view.ts";

/**
 * أصنافُ شارةِ الحالةِ — **مكتوبةٌ حرفاً في هذا المِلفِّ** لا مبنيّةٌ من اسمِ
 * الحالةِ في زمنِ التشغيلِ: حاجزُ تغطيةِ الأنماطِ (`ADR 0105` · `UX-021`) يقرأُ
 * النصَّ الساكنَ، وصنفٌ مبنيٌّ يمرُّ أخضرَ وهوَ بلا قاعدةٍ في ورقةِ النمطِ.
 */
const STATUS_BADGE: Record<SupportStatusTone, { readonly modifier: string }> = {
  open: { modifier: "sup__ticket-status--open" },
  working: { modifier: "sup__ticket-status--working" },
  done: { modifier: "sup__ticket-status--done" },
  refused: { modifier: "sup__ticket-status--refused" },
};

export interface TicketsScreenProps {
  readonly spec: SupportSurfaceSpec;
  readonly view: SupportViewModel;
  /** حجمُ الصفحةِ كما نشرَه النطاقُ — لا رقمٌ في شِفرةِ عرضٍ. */
  readonly pageSize: number;
  /** مفاتيحُ الدَّينِ المُعلَنِ لهذا الدورِ — تُقالُ ولا يُوضَعُ لها زرٌّ صوريٌّ. */
  readonly declaredDebt: readonly string[];
  readonly openTicket: (input: OpenTicketInput) => Promise<OpenTicketResponse>;
  readonly readTickets: (input: ReadTicketsInput) => Promise<SupportTicketsResponse>;
  /**
   * `| undefined` **مكتوبٌ صراحةً** لأنَّ `exactOptionalPropertyTypes` يُفرِّقُ
   * بينَ «حقلٍ غائبٍ» و«حقلٍ قيمتُه `undefined`»: وسطحُ الدورِ يُمرِّرُ ما جاءَه
   * كما جاءَه، فمَن لم يُمرِّرْ لغةً يُمرَّرُ عنه `undefined` — وهذا هوَ عقدُ
   * الوسيطِ لا تفريطٌ في تشدُّدِ الأنواعِ.
   */
  readonly language?: MiniAppLanguage | undefined;
  readonly onBack?: (() => void) | undefined;
  /**
   * رحلةٌ جاءَ منها صاحبُ الحسابِ — **تُثبَّتُ ولا تُكتَبُ بيدٍ**: حقلُ معرّفٍ
   * يُملأُ يدويّاً بابُ خطأٍ لا بابُ دعمٍ.
   */
  readonly orderId?: string | null;
  /** صنفٌ مبدئيٌّ حينَ جاءَ من سياقٍ يدلُّ عليه — يُبدِّلُه صاحبُه. */
  readonly initialCategory?: string | null;
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

export function TicketsScreen({
  spec,
  view,
  pageSize,
  declaredDebt,
  openTicket,
  readTickets,
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  orderId = null,
  initialCategory = null,
}: TicketsScreenProps) {
  const t = miniAppTranslator(language);
  const messageId = useId();
  const prefix = spec.keyPrefix;
  const [category, setCategory] = useState<string | null>(initialCategory);
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
        const response = await readTickets({ limit: pageSize, cursor: from });
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
    [pageSize, readTickets],
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

  const submittable = view.canSubmit({ category, message, orderId, busy });

  return (
    <section className="sup" aria-labelledby="support-title">
      <h1 className="sup__title" id="support-title">
        {t(`${prefix}title`)}
      </h1>
      {onBack !== undefined && (
        <button type="button" className="sys__action sup__back" onClick={onBack}>
          {t(`${prefix}back`)}
        </button>
      )}

      {/* ــ إيصالُ الفتحِ: **المرجعُ أوّلاً وأكبرُ** ــ */}
      {opened !== null && (
        <div className="sup__receipt" role="status">
          <p className="sup__receipt-lead">{t(`${prefix}opened.lead`)}</p>
          <p className="sup__reference">{opened.reference}</p>
          <p className="sup__receipt-hint">{t(`${prefix}opened.keepReference`)}</p>
          {expectedMinutes !== null && (
            <p className="sup__expected">
              {t(`${prefix}opened.expected`).replace("{minutes}", String(expectedMinutes))}
            </p>
          )}
        </div>
      )}

      {/* ــ نموذجُ الشكوى ــ */}
      <div className="sup__form">
        <p className="sup__form-lead">{t(`${prefix}form.lead`)}</p>

        <fieldset className="sup__categories">
          <legend className="sup__categories-legend">{t(`${prefix}form.category`)}</legend>
          {spec.selectableCategories.map((value) => (
            <label className="sup__category" key={value}>
              <input
                type="radio"
                name="support-category"
                value={value}
                checked={category === value}
                onChange={() => setCategory(value)}
              />
              <span className="sup__category-label">{t(`${prefix}category.${value}`)}</span>
            </label>
          ))}
        </fieldset>

        {/*
          **الرحلةُ تُقالُ ولا تُطلَبُ كتابةً**: صنفٌ يحتاجُ رحلةً وصاحبُ الحسابِ
          جاءَ من غيرِ تفاصيلِ رحلةٍ يُقالُ له مِن أينَ يدخلُ — لا يُعرَضُ حقلُ
          معرّفٍ.
        */}
        {category !== null && spec.requiresOrder(category) && orderId === null && (
          <p className="sup__order-required" role="note">
            {t(`${prefix}form.orderRequired`)}
          </p>
        )}
        {orderId !== null && <p className="sup__order-bound">{t(`${prefix}form.orderBound`)}</p>}

        <label className="sup__message-label" htmlFor={messageId}>
          {t(`${prefix}form.message`)}
        </label>
        <textarea
          className="sup__message"
          id={messageId}
          maxLength={spec.maxMessageChars}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
          value={message}
        />
        <p className="sup__remaining">
          {t(`${prefix}form.remaining`).replace("{count}", String(view.remainingChars(message)))}
        </p>

        <button
          type="button"
          className="sys__action sup__submit"
          disabled={!submittable}
          onClick={() => void submit()}
        >
          {t(busy ? `${prefix}form.sending` : `${prefix}form.submit`)}
        </button>

        {formError !== null && (
          <p className="sup__error" role="alert">
            {formError.code === "COOLDOWN_ACTIVE" && formError.retryAfter !== null
              ? t(`${prefix}error.COOLDOWN_ACTIVE_SECONDS`).replace(
                  "{seconds}",
                  String(formError.retryAfter),
                )
              : t(view.errorKey(formError.code))}
          </p>
        )}
        {formError !== null && isRetryableSupportError(formError.code) && (
          <button type="button" className="sys__action sup__retry" onClick={() => void submit()}>
            {t(`${prefix}form.retry`)}
          </button>
        )}
      </div>

      {/* ــ تذاكري وحالاتُها ــ */}
      <div className="sup__list">
        <h2 className="sup__list-title">{t(`${prefix}list.title`)}</h2>
        {expectedMinutes !== null && (
          <p className="sup__list-expected">
            {t(`${prefix}list.expected`).replace("{minutes}", String(expectedMinutes))}
          </p>
        )}

        {listState.kind === "failed" && (
          <p className="sup__list-error" role="alert">
            {t(view.errorKey(listState.code))}
          </p>
        )}
        {listState.kind === "loading" && (
          <p className="sup__list-loading">{t(`${prefix}list.loading`)}</p>
        )}
        {listState.kind === "ready" && tickets.length === 0 && (
          <p className="sup__list-empty">{t(`${prefix}list.empty`)}</p>
        )}

        <ul className="sup__tickets">
          {tickets.map((ticket) => {
            const row = view.toTicketRow(ticket);
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
                    {t(`${prefix}list.resolution`).replace("{text}", row.resolution)}
                  </p>
                )}
                {row.hasOrder && (
                  <span className="sup__ticket-ride">{t(`${prefix}list.aboutRide`)}</span>
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
            {t(`${prefix}list.more`)}
          </button>
        )}
      </div>

      {/* **الحدُّ يُقالُ** — انظرْ رأسَ المِلفِّ. */}
      <div className="sup__debt">
        <p className="sup__debt-title">{t(`${prefix}debt.title`)}</p>
        <ul className="sup__debt-list">
          {declaredDebt.map((key) => (
            <li className="sup__debt-item" key={key}>
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
