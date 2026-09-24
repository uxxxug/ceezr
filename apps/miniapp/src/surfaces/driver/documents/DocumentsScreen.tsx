/**
 * الغرض: شاشةُ وثائقِ السائقِ — **لوحٌ يقولُ لِمَ أنتَ محجوبٌ** ورفعٌ بإذنٍ
 *   موقَّعٍ وتاريخُ انتهاءٍ وإرسالٌ للمراجعةِ (البند `F3-01` · `SD-01` · `SD-02`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/documents
 * يُستخدم من: `DriverRoot.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-11` — أنواعُ المركبةِ في اللوحِ نفسِه.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## لِمَ ثلاثُ خطواتٍ لكلِّ وثيقةٍ لا خطوةٌ واحدةٌ
 *
 * خانةٌ ← رفعٌ إلى المخزنِ ← تسجيلٌ في القاعدةِ. ولا تُدمَجُ لأنَّ **الوسطى لا
 * تمرُّ بخادمِنا**: بايتُ المِلفِّ يذهبُ إلى المخزنِ مباشرةً، وخادمُنا يوقّعُ
 * ويُسجِّلُ ولا يحملُ ميغابايتَ. وكلُّ خطوةٍ تُخفِقُ **بنصٍّ يقولُ أيَّها أخفقَ**.
 *
 * ## ولِمَ تاريخُ الانتهاءِ **مُدخَلٌ إلزاميٌّ لا مُستنبَطٌ**
 *
 * `ADR 0115`: الحجبُ ساعةٌ لا رايةٌ. ورخصةٌ منتهيةٌ = سائقٌ يعملُ بلا غطاءٍ
 * قانونيٍّ، ولا يُقرأُ تاريخُها من صورةٍ بلا قارئٍ بصريٍّ — فيُكتَبُ بيدٍ
 * ويُراجَعُ بشرٌ بعدَه.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — وحدودُها مُعلَنةٌ (`ح-5`)
 *
 *   ــ **لا تعرضُ الوثيقةَ المرفوعةَ**: قراءةُ الوثيقةِ برابطٍ موقَّعٍ للقراءةِ
 *      **دَينٌ مُعلَنٌ**، والدلوُ خاصٌّ فلا رابطَ عامٌّ لها.
 *   ــ **لا تُظهِرُ تقدُّمَ الرفعِ بالنسبةِ**: `fetch` لا يُعطيهِ.
 *   ــ **لا تُصوِّرُ بالكاميرا داخلَ التطبيقِ**: مُدخَلُ مِلفٍّ يفتحُ الكاميرا في
 *      المنصّةِ، وواجهةُ تصويرٍ خاصّةٌ بها **دَينٌ مُعلَنٌ**.
 *   ــ **لا تُلغي وثيقةً مرفوعةً**: الحذفُ حكمُ مراجعٍ، والإحلالُ برفعٍ جديدٍ.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { EmptyState } from "../../../system/EmptyState.tsx";
import {
  type ApiDriverDocumentType,
  type DriverDocumentsResponse,
  type DriverUploadSlotResponse,
  readDriverDocuments,
  recordDocument,
  requestUploadSlot,
  submitDocumentsForReview,
  uploadFileToSlot,
} from "./documents-api.ts";
import {
  type DocumentCardModel,
  type DocumentTone,
  documentsErrorKey,
  isRetryableDocumentsError,
  rejectExpiryLocally,
  rejectFileLocally,
  toBoardSummary,
  todayPlainDay,
} from "./documents-view.ts";

export interface DocumentsScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  readonly readBoard?: () => Promise<DriverDocumentsResponse>;
  readonly requestSlot?: (input: {
    readonly docType: ApiDriverDocumentType;
    readonly contentType: string;
    readonly sizeBytes: number;
  }) => Promise<DriverUploadSlotResponse>;
  readonly upload?: (input: {
    readonly uploadUrl: string;
    readonly file: Blob;
    readonly contentType: string;
  }) => Promise<void>;
  readonly record?: (input: {
    readonly docType: ApiDriverDocumentType;
    readonly objectPath: string;
    readonly expiresAt: string;
  }) => Promise<unknown>;
  readonly submit?: () => Promise<{ readonly submitted: number; readonly still_blocked: boolean }>;
  readonly now?: () => Date;
}

/**
 * أصنافُ نغمةِ الشارةِ — **مكتوبةٌ حرفاً** لا مبنيّةً في زمنِ التشغيلِ: حاجزُ
 * تغطيةِ الأنماطِ (`ADR 0105` · `UX-021`) يقرأُ النصَّ الساكنَ.
 */
const TONE_BADGE: Record<DocumentTone, { readonly modifier: string }> = {
  missing: { modifier: "dd__badge--missing" },
  waiting: { modifier: "dd__badge--waiting" },
  accepted: { modifier: "dd__badge--accepted" },
  refused: { modifier: "dd__badge--refused" },
  expiring: { modifier: "dd__badge--expiring" },
};

/** ما لا سندَ له في هذه الشاشةِ — يُقالُ ولا يُوضَعُ له زرٌّ صوريٌّ. */
const DECLARED_DEBT: readonly string[] = [
  "driver.documents.debt.preview",
  "driver.documents.debt.progress",
  "driver.documents.debt.camera",
];

type BoardState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly board: DriverDocumentsResponse }
  | { readonly kind: "failed"; readonly code: string };

type RowState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy"; readonly stepKey: string }
  | { readonly kind: "failed"; readonly key: string; readonly maxBytes?: number }
  | { readonly kind: "done"; readonly replaced: boolean };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (thrown !== null && typeof thrown === "object" && "name" in thrown) {
    if ((thrown as { name?: unknown }).name === "UploadFailedError") return "UPLOAD_FAILED";
  }
  return "UNKNOWN";
}

export function DocumentsScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  readBoard = readDriverDocuments,
  requestSlot = requestUploadSlot,
  upload = uploadFileToSlot,
  record = recordDocument,
  submit = submitDocumentsForReview,
  now = () => new Date(),
}: DocumentsScreenProps) {
  const t = miniAppTranslator(language);
  const formId = useId();
  const [state, setState] = useState<BoardState>({ kind: "loading" });
  const [rows, setRows] = useState<Readonly<Record<string, RowState>>>({});
  const [expiry, setExpiry] = useState<Readonly<Record<string, string>>>({});
  const [maxBytes, setMaxBytes] = useState<number | null>(null);
  const [submitState, setSubmitState] = useState<RowState>({ kind: "idle" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const board = await readBoard();
      setState({ kind: "ready", board });
    } catch (thrown) {
      setState({ kind: "failed", code: codeOf(thrown) });
    }
  }, [readBoard]);

  useEffect(() => {
    void load();
  }, [load]);

  const setRow = useCallback((docType: string, next: RowState) => {
    setRows((current) => ({ ...current, [docType]: next }));
  }, []);

  /**
   * الخطواتُ الثلاثُ في مِقبضٍ واحدٍ **وكلُّ إخفاقٍ يُسمّى بموضعِه**: خانةٌ
   * أُخفِقَ توقيعُها ليسَ كرفعٍ أُخفِقَ ليسَ كتسجيلٍ رُفِضَ.
   */
  const handleUpload = useCallback(
    async (docType: ApiDriverDocumentType, file: File) => {
      const day = expiry[docType] ?? "";
      const expiryProblem = rejectExpiryLocally({
        value: day,
        todayPlainDay: todayPlainDay(now()),
      });
      if (expiryProblem !== null) {
        setRow(docType, { kind: "failed", key: expiryProblem });
        return;
      }
      const fileProblem = rejectFileLocally({
        sizeBytes: file.size,
        contentType: file.type,
        maxBytes,
        allowedContentTypes: null,
      });
      if (fileProblem !== null) {
        // الحدُّ يُمرَّرُ **متى وُجِدَ فقط**: مفتاحٌ قيمتُه `undefined` ليسَ كغيابِ
        // المفتاحِ، ورسالةُ «أقصى حجمٍ» بلا رقمٍ تُقرأُ فراغاً في الشاشةِ.
        setRow(
          docType,
          fileProblem.maxBytes === undefined
            ? { kind: "failed", key: fileProblem.key }
            : { kind: "failed", key: fileProblem.key, maxBytes: fileProblem.maxBytes },
        );
        return;
      }

      setRow(docType, { kind: "busy", stepKey: "driver.documents.step.signing" });
      let slot: DriverUploadSlotResponse;
      try {
        slot = await requestSlot({
          docType,
          contentType: file.type,
          sizeBytes: file.size,
        });
      } catch (thrown) {
        setRow(docType, { kind: "failed", key: documentsErrorKey(codeOf(thrown)) });
        return;
      }
      setMaxBytes(slot.max_bytes);

      setRow(docType, { kind: "busy", stepKey: "driver.documents.step.uploading" });
      try {
        await upload({ uploadUrl: slot.upload_url, file, contentType: file.type });
      } catch (thrown) {
        setRow(docType, { kind: "failed", key: documentsErrorKey(codeOf(thrown)) });
        return;
      }

      setRow(docType, { kind: "busy", stepKey: "driver.documents.step.recording" });
      try {
        await record({ docType, objectPath: slot.object_path, expiresAt: day });
      } catch (thrown) {
        setRow(docType, { kind: "failed", key: documentsErrorKey(codeOf(thrown)) });
        return;
      }
      setRow(docType, { kind: "done", replaced: false });
      await load();
    },
    [expiry, load, maxBytes, now, record, requestSlot, setRow, upload],
  );

  const handleSubmit = useCallback(async () => {
    setSubmitState({ kind: "busy", stepKey: "driver.documents.step.submitting" });
    try {
      const result = await submit();
      setSubmitState({ kind: "done", replaced: result.still_blocked });
      await load();
    } catch (thrown) {
      setSubmitState({ kind: "failed", key: documentsErrorKey(codeOf(thrown)) });
    }
  }, [load, submit]);

  if (state.kind === "loading") {
    return (
      <section className="dd" aria-labelledby={`${formId}-title`} aria-busy="true">
        <h1 id={`${formId}-title`} className="dd__title">
          {t("driver.documents.title")}
        </h1>
        <p className="dd__loading">{t("driver.documents.loading")}</p>
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section className="dd" aria-labelledby={`${formId}-title`}>
        <h1 id={`${formId}-title`} className="dd__title">
          {t("driver.documents.title")}
        </h1>
        <EmptyState title={t("driver.documents.failed")} body={t(documentsErrorKey(state.code))} />
        {isRetryableDocumentsError(state.code) ? (
          <button type="button" className="dd__retry" onClick={() => void load()}>
            {t("driver.documents.retry")}
          </button>
        ) : null}
        {onBack === undefined ? null : (
          <button type="button" className="dd__back" onClick={onBack}>
            {t("driver.documents.back")}
          </button>
        )}
      </section>
    );
  }

  const summary = toBoardSummary(state.board);

  return (
    <section className="dd" aria-labelledby={`${formId}-title`}>
      <h1 id={`${formId}-title`} className="dd__title">
        {t("driver.documents.title")}
      </h1>
      <p className="dd__headline">{t(summary.headlineKey)}</p>

      {summary.blockLines.length === 0 ? null : (
        <ul className="dd__blocks" aria-label={t("driver.documents.blocksLabel")}>
          {summary.blockLines.map((line) => {
            const fixDocType = line.docType;
            return (
              <li className="dd__block" key={line.id}>
                {line.labelKey === null ? "" : `${t(line.labelKey)}: `}
                {t(line.messageKey)}
                {line.fixLabelKey === null || fixDocType === null ? null : (
                  <a
                    className="dd__block-fix"
                    href={`#${fixDocType}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(fixDocType)?.focus();
                    }}
                  >
                    {t(line.fixLabelKey)}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ul className="dd__list">
        {summary.cards.map((card: DocumentCardModel) => {
          const row = rows[card.docType] ?? { kind: "idle" };
          // الشارةُ تُقرأُ من الجدولِ **قبلَ** العرضِ كي يكونَ الإحلالُ
          // `badge.modifier` — تعبيراً يُحَلُّ ساكناً لحاجزِ الأنماطِ (القاعدة ٣).
          const badge = TONE_BADGE[card.tone];
          return (
            <li className="dd__item" id={card.docType} key={card.docType} tabIndex={-1}>
              <div className="dd__item-head">
                <span className="dd__label">{t(card.labelKey)}</span>
                <span className={`dd__badge ${badge.modifier}`}>{t(card.statusKey)}</span>
              </div>

              {card.expiresAt === null ? null : (
                <p className="dd__expiry">
                  {t("driver.documents.expiresAt")} {card.expiresAt}
                  {card.daysLeft === null
                    ? null
                    : ` · ${t("driver.documents.daysLeft")} ${card.daysLeft}`}
                </p>
              )}

              {card.reviewNote === null ? null : <p className="dd__note">{card.reviewNote}</p>}

              {card.canUpload ? (
                <div className="dd__upload">
                  <label className="dd__field" htmlFor={`${formId}-${card.docType}-expiry`}>
                    {t("driver.documents.expiryLabel")}
                    <input
                      id={`${formId}-${card.docType}-expiry`}
                      className="dd__input"
                      type="date"
                      value={expiry[card.docType] ?? ""}
                      onChange={(event) =>
                        setExpiry((current) => ({
                          ...current,
                          [card.docType]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="dd__field" htmlFor={`${formId}-${card.docType}-file`}>
                    {card.replaces
                      ? t("driver.documents.replaceLabel")
                      : t("driver.documents.fileLabel")}
                    <input
                      id={`${formId}-${card.docType}-file`}
                      className="dd__input"
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      disabled={row.kind === "busy"}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file !== undefined) void handleUpload(card.docType, file);
                      }}
                    />
                  </label>
                </div>
              ) : null}

              {row.kind === "busy" ? <p className="dd__step">{t(row.stepKey)}</p> : null}
              {row.kind === "failed" ? (
                <p className="dd__error" role="status">
                  {t(row.key)}
                  {row.maxBytes === undefined ? null : ` (${row.maxBytes})`}
                </p>
              ) : null}
              {row.kind === "done" ? (
                <p className="dd__ok" role="status">
                  {t("driver.documents.uploaded")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {summary.canSubmit ? (
        <button
          type="button"
          className="dd__submit"
          disabled={submitState.kind === "busy"}
          onClick={() => void handleSubmit()}
        >
          {t("driver.documents.submit")}
        </button>
      ) : null}
      {submitState.kind === "failed" ? (
        <p className="dd__error" role="status">
          {t(submitState.key)}
        </p>
      ) : null}
      {submitState.kind === "done" ? (
        <p className="dd__ok" role="status">
          {submitState.replaced
            ? t("driver.documents.submittedStillBlocked")
            : t("driver.documents.submitted")}
        </p>
      ) : null}

      <ul className="dd__debt" aria-label={t("driver.documents.debtLabel")}>
        {DECLARED_DEBT.map((key) => (
          <li className="dd__debt-item" key={key}>
            {t(key)}
          </li>
        ))}
      </ul>

      {onBack === undefined ? null : (
        <button type="button" className="dd__back" onClick={onBack}>
          {t("driver.documents.back")}
        </button>
      )}
    </section>
  );
}
