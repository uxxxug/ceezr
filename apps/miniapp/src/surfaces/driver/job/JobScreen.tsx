/**
 * الغرض: شاشةُ مَهمّةِ السائقِ النشطةِ — **زرٌّ واحدٌ للطَورِ الواحدِ** ورابطُ
 *   ملاحةٍ وراكبٌ بلا هويّةٍ تُتعقَّبُ (البند `F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/job
 * يُستخدم من: `DriverRoot.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` — بعدَ الإنهاءِ يُقالُ سطرٌ، والحصيلةُ شاشةٌ
 *   أخرى تُقرأُ من مسارِها.
 * يحرسُه: scripts/check-driver-job-contract.ts
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ## لِمَ زرٌّ واحدٌ ظاهرٌ في كلِّ لحظةٍ
 *
 * لأنَّ السائقَ يقرأُ هذه الشاشةَ **وهوَ يقودُ**: ثلاثةُ أزرارٍ معروضةٍ معاً
 * تُنتِجُ ضغطةً خاطئةً تُردُّ `PHASE_MISMATCH` فتُقرأُ عطلاً، وتُنتِجُ أسوأَ من
 * ذاكَ — إنهاءَ رحلةٍ لم تبدأْ. والخادمُ يقولُ **ما يُفعَلُ الآنَ** فيُعرَضُ.
 *
 * ## ولِمَ لا مؤقّتَ ولا عدَّ تصاعديّاً في هذه الشاشةِ
 *
 * مهلةُ العرضِ (`F3-02`) حكمُ صلاحيّةٍ يُلغي فرصةً، فوجبَ عدُّها. أمّا المَهمّةُ
 * فلا مهلةَ لها: رحلةٌ تطولُ لا تُلغى بمرورِ ثانيةٍ، وعقربٌ يدقُّ على شاشةِ
 * سائقٍ يُصنَعُ ضغطاً كاذباً ويُستهلَكُ بطاريّةً بلا فائدةٍ. والأختامُ تُقالُ نصّاً.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُلغي رحلةً**: لا مسارَ إلغاءٍ للسائقِ ههنا، وسياستُه مُجمَّدةٌ
 *      بقرارٍ (`F2-06`) — وزرٌّ بلا كاتبٍ خيانةُ عرضٍ.
 *   ــ **لا تتّصلُ براكبٍ ولا تُراسِلُه**: العقدُ لا يحملُ هاتفاً ولا معرِّفاً.
 *   ــ **لا تُظهِرُ زرَّ نجدةٍ**: نجدةُ السائقِ **دَينٌ مُعلَنٌ** (زيادةٌ ثانيةٌ)
 *      لأنَّ مسارَ `F2-10` يُركِّبُ الدورَ راكباً حرفاً — وزرٌّ رماديٌّ في شاشةِ
 *      سلامةٍ أسوأُ من غيابِه.
 *   ــ **لا تبثُّ موضعاً**: البثُّ بندُ `F3-04`، ولا يُشتَقُّ طَورٌ من قُربٍ.
 *   ــ **لا تُبقي حالاً بعدَ رفضٍ يعني تقادُماً**: تُعيدُ القراءةَ من القاعدةِ.
 *
 * ## إضافةُ البندِ `PD-020` (2026-09-20)
 *
 * صارَ للشاشةِ **قسمُ «تعذّرَ الإكمالُ»**: تأكيدٌ بخطوتَينِ يُبلِّغُ فريقَ
 * الإسنادِ بلاغَ سلامةٍ بسببِ `driver_cannot_complete` — **ولا يُغيِّرُ حالةَ
 * الرحلةِ ألبتّةَ** ولا يوقفُها ولا يُنهيها: الفريقُ يقرَّرُ. وما كانَ مكتوباً
 * أعلاه من أنَّ نجدةَ السائقِ **دَينٌ مُعلَنٌ** **باقٍ وصفاً لِما كانَ**: ذاكَ
 * كانَ لأنَّ مسارَ `F2-10` يُركِّبُ الدورَ راكباً حرفاً، وقد صارَ للسائقِ
 * حاكمُهُ بدورِهِ (`GET /v1/driver/safety/sos`) بلا تركيبِ دورٍ في الشاشةِ.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { EmptyState } from "../../../system/EmptyState.tsx";
import { openExternalLink } from "../../../tg/index.ts";
import type { SosSurfaceResponse } from "../../rider/sos/sos-contract.ts";
import {
  completeDriverRide,
  type DriverActiveJobResponse,
  type DriverCannotCompleteResponse,
  markDriverArrived,
  readDriverActiveJob,
  readDriverSafetyNarrative,
  reportDriverCannotComplete,
  startDriverRide,
} from "./job-api.ts";
import type { ApiDriverJobAction } from "./job-contract.ts";
import {
  type ActiveJobModel,
  cannotCompleteNarrativeKey,
  cannotCompleteRefusalKey,
  isRetryableJobError,
  jobErrorKey,
  shouldReloadAfterJobError,
  toActiveJob,
} from "./job-view.ts";

export interface JobScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  readonly readJob?: () => Promise<DriverActiveJobResponse>;
  readonly arrive?: (orderId: string) => Promise<unknown>;
  readonly start?: (orderId: string) => Promise<unknown>;
  readonly complete?: (orderId: string) => Promise<unknown>;
  /**
   * فعلُ «تعذّرَ الإكمالُ» (`PD-020`) — بلاغُ سلامةٍ لا تغييرُ حالةٍ، يُحقَنُ
   * في الاختبارِ ولا يُخترَعُ جوابُهُ.
   */
  readonly reportCannotComplete?: (orderId: string) => Promise<DriverCannotCompleteResponse>;
  /** قراءةُ سردِ البلاغِ القائمِ (`PD-020`) — من القاعدةِ لا من ذاكرةِ شاشةٍ. */
  readonly readSafetyNarrative?: () => Promise<SosSurfaceResponse>;
  readonly openLink?: (url: string) => unknown;
  /** يُستدعى عند إتمامِ الرحلةِ لفتحِ شاشةِ الملخصِّ (`F12-05`). */
  readonly onCompleted?: (orderId: string) => void;
}

type JobState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly job: ActiveJobModel | null }
  | { readonly kind: "failed"; readonly code: string };

type ActState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "done"; readonly key: string; readonly completedOrderId: string | undefined }
  | { readonly kind: "failed"; readonly key: string };

/**
 * `PD-020` — حالةُ قسمِ «تعذّرَ الإكمالُ». والخطوةُ الثانيةُ تُطفَأُ بعدَ كلِّ
 * إرسالٍ فلا تبقى مُسلَّحةً في خلفيّةِ شاشةِ قيادةٍ.
 */
type CannotState =
  | { readonly kind: "idle" }
  | { readonly kind: "armed" }
  | { readonly kind: "busy" }
  | { readonly kind: "refused"; readonly refusal: string }
  | { readonly kind: "failed" }
  | { readonly kind: "sent" };

/** البلاغُ القائمُ — حقلا سردٍ فحسب: الحكمُ كلُّهُ في القاعدةِ. */
type IncidentState = {
  readonly status: string;
  readonly teamDeliveryStatus: string;
} | null;

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

const DONE_KEY: Readonly<Record<ApiDriverJobAction, string>> = {
  MARK_ARRIVED: "driver.job.done.MARK_ARRIVED",
  START_RIDE: "driver.job.done.START_RIDE",
  COMPLETE_RIDE: "driver.job.done.COMPLETE_RIDE",
};

function StampRow({
  labelKey,
  value,
  t,
}: {
  readonly labelKey: string;
  readonly value: string | null;
  readonly t: (key: string) => string;
}) {
  return (
    <p className={value === null ? "djb__stamp djb__stamp--absent" : "djb__stamp"}>
      {t(labelKey)}: {value ?? t("driver.job.stamp.none")}
    </p>
  );
}

export function JobScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  onCompleted,
  readJob = readDriverActiveJob,
  arrive = markDriverArrived,
  start = startDriverRide,
  complete = completeDriverRide,
  reportCannotComplete = reportDriverCannotComplete,
  readSafetyNarrative = readDriverSafetyNarrative,
  openLink = (url: string) => openExternalLink(url),
}: JobScreenProps) {
  const t = miniAppTranslator(language);
  const formId = useId();
  const [state, setState] = useState<JobState>({ kind: "loading" });
  const [act, setAct] = useState<ActState>({ kind: "idle" });
  const [cannot, setCannot] = useState<CannotState>({ kind: "idle" });
  const [incident, setIncident] = useState<IncidentState>(null);

  /**
   * سردُ البلاغِ القائمِ (`PD-020`) — يُقرأُ **من القاعدةِ** في كلِّ تركيبٍ
   * وبعدَ كلِّ إرسالٍ، فلا تُخمِّنُ الشاشةُ ما صارَ. وفشلُ قراءتِهِ لا يُخفي
   * القسمَ ولا يوقفُ الفعلَ: السردُ سياقٌ يُقالُ، والفعلُ بابُهُ مفتوحٌ.
   */
  const refreshNarrative = useCallback(async () => {
    try {
      const response = await readSafetyNarrative();
      const i = response.found ? (response.incident ?? null) : null;
      setIncident(
        i === null ? null : { status: i.status, teamDeliveryStatus: i.teamDeliveryStatus },
      );
    } catch {
      setIncident(null);
    }
  }, [readSafetyNarrative]);

  const sendCannot = useCallback(
    async (orderId: string) => {
      setCannot({ kind: "busy" });
      try {
        const response = await reportCannotComplete(orderId);
        if (response.accepted) {
          // «بلاغُكَ الأوّلُ قائمٌ» نجاحٌ لا فشلٌ — والسردُ يُقرأُ بعدها من القاعدةِ.
          setCannot({ kind: "sent" });
          await refreshNarrative();
        } else {
          setCannot({ kind: "refused", refusal: response.refusal });
        }
      } catch {
        setCannot({ kind: "failed" });
      }
    },
    [refreshNarrative, reportCannotComplete],
  );

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await readJob();
      const job = response.job === null ? null : toActiveJob(response.job);
      setState({ kind: "ready", job });
      // `PD-020` — سردُ بلاغٍ قائمٍ يُقرأُ مع المَهمّةِ: سائقٌ عادَ إلى شاشةٍ
      // بعدَ بلاغٍ يجدُ أثرَهُ، لا شاشةً تقولُ إنَّ شيئاً لم يقعْ.
      if (job !== null) void refreshNarrative();
    } catch (thrown) {
      setState({ kind: "failed", code: codeOf(thrown) });
    }
  }, [readJob, refreshNarrative]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (job: ActiveJobModel) => {
      setAct({ kind: "busy" });
      const writer =
        job.action === "MARK_ARRIVED" ? arrive : job.action === "START_RIDE" ? start : complete;
      try {
        await writer(job.orderId);
        setAct({
          kind: "done",
          key: DONE_KEY[job.action],
          completedOrderId: job.action === "COMPLETE_RIDE" ? job.orderId : undefined,
        });
        // **القاعدةُ تقولُ الطَورَ التاليَ**: لا تُحرَّكُ الشاشةُ بتخمينٍ محليٍّ.
        await load();
      } catch (thrown) {
        const code = codeOf(thrown);
        setAct({ kind: "failed", key: jobErrorKey(code) });
        if (shouldReloadAfterJobError(code)) await load();
      }
    },
    [arrive, complete, load, start],
  );

  if (state.kind === "loading") {
    return (
      <section className="djb" aria-labelledby={`${formId}-title`} aria-busy="true">
        <h1 id={`${formId}-title`} className="djb__title">
          {t("driver.job.title")}
        </h1>
        <p className="djb__loading">{t("driver.job.loading")}</p>
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section className="djb" aria-labelledby={`${formId}-title`}>
        <h1 id={`${formId}-title`} className="djb__title">
          {t("driver.job.title")}
        </h1>
        <EmptyState title={t("driver.job.failed")} body={t(jobErrorKey(state.code))} />
        {isRetryableJobError(state.code) ? (
          <button type="button" className="djb__retry" onClick={() => void load()}>
            {t("driver.job.retry")}
          </button>
        ) : null}
        {onBack === undefined ? null : (
          <button type="button" className="djb__back" onClick={onBack}>
            {t("driver.job.backToBoard")}
          </button>
        )}
      </section>
    );
  }

  if (state.job === null) {
    return (
      <section className="djb" aria-labelledby={`${formId}-title`}>
        <h1 id={`${formId}-title`} className="djb__title">
          {t("driver.job.title")}
        </h1>
        {/* `UX-5` — الفراغُ يُقالُ صراحةً ولا يُترَكُ بياضاً يُقرأُ عطلاً. */}
        <EmptyState title={t("driver.job.none.title")} body={t("driver.job.none.body")} />
        <button type="button" className="djb__retry" onClick={() => void load()}>
          {t("driver.job.refresh")}
        </button>
        {onBack === undefined ? null : (
          <button type="button" className="djb__back" onClick={onBack}>
            {t("driver.job.backToBoard")}
          </button>
        )}
      </section>
    );
  }

  const job = state.job;

  return (
    <section className="djb" aria-labelledby={`${formId}-title`}>
      <h1 id={`${formId}-title`} className="djb__title">
        {t("driver.job.title")}
      </h1>

      <div className="djb__head">
        <span className="djb__service">{t(job.serviceKey)}</span>
        <span className="djb__phase" role="status">
          {t(job.phaseKey)}
        </span>
      </div>

      <p className="djb__rider">
        {t("driver.job.rider")}:{" "}
        {job.riderFirstName === null || job.riderFirstName === ""
          ? t("driver.job.rider.unnamed")
          : job.riderFirstName}
        {job.riderLanguageCode === null ? null : (
          <span className="djb__rider-language"> · {job.riderLanguageCode}</span>
        )}
      </p>

      <p className="djb__place">
        {t("driver.job.pickup")}: {job.pickup.label ?? t("driver.job.place.unnamed")}
      </p>
      <p className="djb__coords">
        {job.pickup.latitude} , {job.pickup.longitude}
      </p>
      <p className="djb__place">
        {t("driver.job.dropoff")}:{" "}
        {job.dropoff === null
          ? t("driver.job.place.none")
          : (job.dropoff.label ?? t("driver.job.place.unnamed"))}
      </p>

      <p className="djb__notes">
        {t("driver.job.notes")}:{" "}
        {job.notes === null || job.notes === "" ? t("driver.job.noNotes") : job.notes}
      </p>

      <StampRow labelKey="driver.job.stamp.matchedAt" value={job.matchedAt} t={t} />
      <StampRow labelKey="driver.job.stamp.arrivedAt" value={job.arrivedAt} t={t} />
      <StampRow labelKey="driver.job.stamp.startedAt" value={job.startedAt} t={t} />

      <div className="djb__actions">
        {/* الملاحةُ **خارجَ التطبيقِ**: رابطٌ يُنقَرُ، لا خريطةٌ تُحمَّلُ. */}
        <button
          type="button"
          className="djb__navigate"
          onClick={() => {
            openLink(job.navigateTo.navigationUrl);
          }}
        >
          {t("driver.job.navigate")}
        </button>
        <button
          type="button"
          className="djb__advance"
          disabled={act.kind === "busy"}
          onClick={() => void runAction(job)}
        >
          {t(job.actionLabelKey)}
        </button>
      </div>

      {/*
        قسمُ «تعذّرَ الإكمالُ» (`PD-020` · `ADR 0159`) — بلاغُ سلامةٍ لا تغييرُ
        حالةٍ: يُعرَضُ في المَهمّةِ قبلَ الإكمالِ لا في طَورٍ دونَ طَورٍ، لأنَّ
        العجزَ لا يُنتَظِرُ ختمَ وصولٍ. وتأكيدٌ بخطوتَينِ كما في استغاثةِ الراكبِ:
        بلاغٌ يُوقِظُ فريقاً لا يُرسَلُ بلمسةٍ عابرةٍ.
      */}
      <div className="djb__cannot">
        {incident !== null && (
          <p className="djb__cannot-narrative" role="status">
            {t(cannotCompleteNarrativeKey(incident.status, incident.teamDeliveryStatus))}
          </p>
        )}
        {cannot.kind === "sent" ? (
          <p className="djb__cannot-sent" role="status">
            {t("driver.job.cannotComplete.sent")}
          </p>
        ) : null}
        {cannot.kind === "refused" ? (
          <p className="djb__cannot-refusal" role="alert">
            {t(cannotCompleteRefusalKey(cannot.refusal))}
          </p>
        ) : null}
        {cannot.kind === "failed" ? (
          <p className="djb__cannot-failed" role="alert">
            {t("driver.job.cannotComplete.failed")}
          </p>
        ) : null}
        {cannot.kind === "armed" || cannot.kind === "busy" ? (
          <div className="djb__cannot-confirm">
            <p className="djb__cannot-question">{t("driver.job.cannotComplete.confirmQuestion")}</p>
            <button
              type="button"
              className="djb__cannot-send"
              disabled={cannot.kind === "busy"}
              onClick={() => void sendCannot(job.orderId)}
            >
              {t("driver.job.cannotComplete.confirmSend")}
            </button>
            <button
              type="button"
              className="djb__cannot-cancel"
              disabled={cannot.kind === "busy"}
              onClick={() => setCannot({ kind: "idle" })}
            >
              {t("driver.job.cannotComplete.cancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="djb__cannot-arm"
            onClick={() => setCannot({ kind: "armed" })}
          >
            {t("driver.job.cannotComplete.label")}
          </button>
        )}
      </div>

      {act.kind === "done" ? (
        <p className="djb__done" role="status">
          {t(act.key)}
        </p>
      ) : null}
      {act.kind === "done" &&
      act.key === DONE_KEY.COMPLETE_RIDE &&
      onCompleted !== undefined &&
      act.completedOrderId !== undefined ? (
        <button
          type="button"
          className="djb__summary"
          onClick={() => onCompleted(act.completedOrderId as string)}
        >
          {t("driver.job.viewSummary")}
        </button>
      ) : null}
      {act.kind === "failed" ? (
        <p className="djb__error" role="status">
          {t(act.key)}
        </p>
      ) : null}

      {onBack === undefined ? null : (
        <button type="button" className="djb__back" onClick={onBack}>
          {t("driver.job.backToBoard")}
        </button>
      )}
    </section>
  );
}
