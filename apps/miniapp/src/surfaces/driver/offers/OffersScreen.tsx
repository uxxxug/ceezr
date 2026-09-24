/**
 * الغرض: لوحُ عروضِ السائقِ — **عرضٌ بمؤقّتٍ يعدُّ من ثوانِ الخادمِ** ومسافةٌ
 *   موسومةٌ وتبديلُ توفُّرٍ وسببُ حجبٍ إن كانَ (البند `F3-02` · `SD-03`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/offers
 * يُستخدم من: `DriverRoot.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` — الرحلةُ النشطةُ تُفتَحُ من بعدِ القبولِ.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ## كيفَ يعدُّ هذا اللوحُ بلا أن يثقَ بساعةِ الهاتفِ
 *
 * القاعدةُ تقولُ «بقيَ ٤٧ ثانيةً» **لحظةَ القراءةِ**. والشاشةُ تُسجِّلُ قراءةَ
 * ساعةِ الجهازِ عندَ وصولِ الجوابِ، ثمَّ **تقرؤها لحظةَ كلِّ رسمٍ** وتطرحُ:
 * `الباقي − (فرقُ القراءتَينِ)`. وانحرافُ الساعةِ — ولو ساعتَينِ — **يسقطُ في
 * الطرحِ** لأنَّ القراءتَينِ من ساعةٍ واحدةٍ. ولو قارنّا `expires_at` بـ
 * `Date.now()` لَكانَ الانحرافُ نفسُه يُخفي عرضاً صالحاً أو يُبقي منتهياً.
 *
 * ## ولِمَ **لا عقربَ يدقُّ كلَّ ثانيةٍ**
 *
 * أوّلُ نسخةٍ من هذه الشاشةِ حرَّكَت قراءةَ الساعةِ بـ`setInterval` كلَّ ثانيةٍ
 * (بلا نداءِ شبكةٍ)، **فأسقطَها `scripts/check-system-screens-policy.ts`**:
 * `F1-07` و`ADR 0035` §٤ يمنعانِ **كلَّ** مؤقّتٍ دوريٍّ في التطبيقِ المصغَّرِ لا
 * الاستقصاءَ الشبكيَّ وحدَه، والاستثناءُ مؤجَّلٌ إلى طبقةِ النقلِ الفوريِّ. فعُولِجَ
 * في الجذرِ ولا استثناءَ: **الباقي محسوبٌ لحظةَ الرسمِ** من آخرِ قراءةٍ، ويُحدَّثُ
 * بفعلِ السائقِ (زرُّ «حدِّثِ اللوحَ» · تبديلُ التوفُّرِ · رفضُ عرضٍ · فتحُ تفصيلٍ).
 * فالرقمُ المرسومُ **صادقٌ لحظةَ رسمِه** ويَقدُمُ بينَ رسمَينِ — وهذا حدٌّ مُعلَنٌ
 * لا مسكوتٌ عنه، ومعَه أنَّ **الصلاحيّةَ حكمُ خادمٍ** فقبولُ عرضٍ مضَت مهلتُه
 * يُرَدُّ برمزٍ مُصنَّفٍ لا بنجاحٍ كاذبٍ.
 *
 * ## ولِمَ يبقى العرضُ في القائمةِ بعدَ بلوغِ العدِّ صفراً
 *
 * لأنَّ الصفرَ **تقديرُ جهازٍ لا حكمُ خادمٍ**: الشاشةُ تُخفي الزرَّ وتضعُ نغمةَ
 * «انتهى»، ولا تحذفُ صفّاً لم تقُلِ القاعدةُ فيهِ شيئاً. والقراءةُ التاليةُ هيَ
 * التي تُسقِطُه، فتكونُ القائمةُ صورةَ حالٍ في الخادمِ لا صورةَ ظنٍّ في الهاتفِ.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — وحدودُها مُعلَنةٌ (`ح-5`)
 *
 *   ــ **لا تُجدِّدُ القائمةَ من نفسِها ولا تدقُّ**: لا نداءَ دوريَّ ولا مؤقّتَ
 *      عرضٍ (`F1-07`)، والدفعُ الفوريُّ (`realtime`) **دَينٌ مُعلَنٌ** — فالزرُّ
 *      ظاهرٌ، والباقي يُقرأُ لحظةَ الرسمِ.
 *   ــ **لا خريطةَ ولا خطَّ سيرٍ**: إحداثيّتانِ في التفاصيلِ فحسب، **دَينٌ مُعلَنٌ**.
 *   ــ **لا مدّةَ وصولٍ**: امتناعٌ مُصنَّفٌ (`ADR 0024`) لا تقديرٌ من مسافةٍ.
 *   ــ **لا هويّةَ راكبٍ**: عرضٌ مُحتَملٌ لا يُبيحُ كشفَ راكبٍ لكلِّ الجولةِ.
 *   ــ **لا صوتَ ولا اهتزازَ**: تنبيهُ المنصّةِ ليسَ ملكَ هذه الشاشةِ.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { EmptyState } from "../../../system/EmptyState.tsx";
import {
  type DriverAvailabilityResponse,
  type DriverOffersResponse,
  readDriverOffers,
  rejectDriverOffer,
  setDriverAvailability,
} from "./offers-api.ts";
import {
  type CountdownTone,
  canAcceptNow,
  countdownLabel,
  countdownSeconds,
  countdownTone,
  type DistanceLine,
  isRetryableOffersError,
  type OfferCardModel,
  offersErrorKey,
  toOffersBoard,
} from "./offers-view.ts";

export interface OffersScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  readonly onOpenOffer?: (offerId: string) => void;
  /**
   * مدخلُ «مَهمّتي» (`F3-03`) — **زيادةٌ لا تغييرٌ** (`ح-8`): غيابُه يُعيدُ هذه
   * الشاشةَ إلى سلوكِها قبلَ `F3-03` حرفاً. وسائقٌ يُغلِقُ التطبيقَ وهوَ في
   * رحلةٍ يحتاجُ طريقاً إلى مَهمّتِه لا يمرُّ بقبولِ عرضٍ ثانٍ.
   */
  readonly onOpenJob?: () => void;
  /**
   * مدخلُ «حصيلتي» (`F3-05`) — **زيادةٌ لا تغييرٌ** (`ح-8`): غيابُهُ يُعيدُ
   * هذه الشاشةَ إلى سلوكِها قبلَ `F3-05` حرفاً. وموضعُه بعدَ «مَهمّتي»: عملٌ
   * جارٍ أولى من تقريرٍ عن عملٍ مضى.
   */
  readonly onOpenActivity?: () => void;
  /**
   * مدخلُ «اشتراكي» (`F3-06` · `SD-07`) — **زيادةٌ لا تغييرٌ** (`ح-8`): غيابُهُ
   * يُعيدُ هذه الشاشةَ إلى سلوكِها قبلَ `F3-06` حرفاً.
   */
  readonly onOpenSubscription?: () => void;
  /**
   * مدخلُ الدعمِ والشكوى (`F3-08` · `SD-10`) — **زيادةٌ في اللوحِ لا تغييرٌ
   * فيه** (`ح-8`). وموضعُه ههنا لا في قائمةٍ مخفيّةٍ لأنَّ السائقَ الذي لا
   * يصلُه عرضٌ أو خُصِمَ منه مبلغٌ **يفتحُ اللوحَ أوّلاً**، ومَن لم يجدْ باباً
   * يشكو منه في الشاشةِ التي وقعَ فيها الضررُ يشكو في قروبٍ عامٍّ أو يصمتُ.
   */
  readonly onOpenSupport?: () => void;
  /**
   * فتحُ شاشةِ الحسابِ (`SD-12`) — **زيادةُ مدخلٍ لا نقصُ آخرَ** (`ح-8`): مدخلُ
   * الدعمِ ههنا يبقى كما هوَ لأنَّه أقربُ إلى موضعِ الضررِ، ويُزادُ بابُ الحسابِ
   * لأنَّ حقَّ التنزيلِ وحقَّ الحذفِ **مبنيّانِ في القاعدةِ ولا بابَ لهما في
   * سطحِ السائقِ** — وحقٌّ بلا بابٍ حقٌّ غيرُ ممنوحٍ عملاً (القسم 9.12).
   */
  readonly onOpenAccount?: () => void;
  readonly readBoard?: () => Promise<DriverOffersResponse>;
  readonly reject?: (offerId: string) => Promise<unknown>;
  readonly setAvailability?: (isAvailable: boolean) => Promise<DriverAvailabilityResponse>;
  /**
   * قراءةُ ساعةِ الجهازِ — **تُمرَّرُ لا تُستدعى في النطاقِ**: بها يصيرُ الباقي
   * مقيساً في الاختبارِ بلا انتظارِ ثوانٍ حقيقيّةٍ.
   */
  readonly now?: () => number;
}

/**
 * أصنافُ نغمةِ المؤقّتِ — **مكتوبةٌ حرفاً** لا مبنيّةً في زمنِ التشغيلِ: حاجزُ
 * تغطيةِ الأنماطِ (`ADR 0105` · `UX-021`) يقرأُ النصَّ الساكنَ.
 */
const COUNTDOWN_BADGE: Record<CountdownTone, { readonly modifier: string }> = {
  calm: { modifier: "dof__timer--calm" },
  urgent: { modifier: "dof__timer--urgent" },
  elapsed: { modifier: "dof__timer--elapsed" },
};

/** ما لا سندَ له في هذه الشاشةِ — يُقالُ ولا يُوضَعُ له زرٌّ صوريٌّ. */
const DECLARED_DEBT: readonly string[] = [
  "driver.offers.debt.push",
  "driver.offers.debt.map",
  "driver.offers.debt.duration",
];

type BoardState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly board: DriverOffersResponse;
      /** قراءةُ ساعةِ الجهازِ لحظةَ وصولِ الجوابِ — أساسُ الطرحِ لا أكثرَ. */
      readonly readAtMs: number;
    }
  | { readonly kind: "failed"; readonly code: string };

type ActionState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "failed"; readonly key: string };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function DistanceRow({
  line,
  labelKey,
  t,
}: {
  readonly line: DistanceLine | null;
  readonly labelKey: string;
  readonly t: (key: string) => string;
}) {
  // غيابُ القياسِ **يُقالُ** ولا يُترَكُ سطراً فارغاً (UX-5)، ولا يُكتَبُ صفراً.
  if (line === null) {
    return (
      <p className="dof__distance dof__distance--absent">
        {t(labelKey)}: {t("rider.quote.distance.unavailable")}
      </p>
    );
  }
  return (
    <p className="dof__distance">
      {t(labelKey)}: {t(line.key).replace("{value}", String(line.value))} ·{" "}
      <span className="dof__distance-kind">{t(line.kindKey)}</span>
    </p>
  );
}

export function OffersScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  onOpenJob,
  onOpenActivity,
  onOpenSubscription,
  onOpenSupport,
  onOpenAccount,
  onOpenOffer,
  readBoard = readDriverOffers,
  reject = rejectDriverOffer,
  setAvailability = setDriverAvailability,
  now = () => Date.now(),
}: OffersScreenProps) {
  const t = miniAppTranslator(language);
  const formId = useId();
  const [state, setState] = useState<BoardState>({ kind: "loading" });
  const [availabilityState, setAvailabilityState] = useState<ActionState>({ kind: "idle" });
  const [rows, setRows] = useState<Readonly<Record<string, ActionState>>>({});

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const board = await readBoard();
      // **الترتيبُ مقصودٌ**: القراءةُ تُسجَّلُ بعدَ وصولِ الجوابِ لا قبلَ إرسالِه،
      // فزمنُ الشبكةِ لا يُحسَبُ من مهلةِ العرضِ مرّتَينِ.
      const readAtMs = now();
      setState({ kind: "ready", board, readAtMs });
    } catch (thrown) {
      setState({ kind: "failed", code: codeOf(thrown) });
    }
  }, [now, readBoard]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAvailability = useCallback(
    async (next: boolean) => {
      setAvailabilityState({ kind: "busy" });
      try {
        await setAvailability(next);
        setAvailabilityState({ kind: "idle" });
        await load();
      } catch (thrown) {
        setAvailabilityState({ kind: "failed", key: offersErrorKey(codeOf(thrown)) });
      }
    },
    [load, setAvailability],
  );

  const handleReject = useCallback(
    async (offerId: string) => {
      setRows((current) => ({ ...current, [offerId]: { kind: "busy" } }));
      try {
        await reject(offerId);
        setRows((current) => ({ ...current, [offerId]: { kind: "idle" } }));
        await load();
      } catch (thrown) {
        setRows((current) => ({
          ...current,
          [offerId]: { kind: "failed", key: offersErrorKey(codeOf(thrown)) },
        }));
      }
    },
    [load, reject],
  );

  if (state.kind === "loading") {
    return (
      <section className="dof" aria-labelledby={`${formId}-title`} aria-busy="true">
        <h1 id={`${formId}-title`} className="dof__title">
          {t("driver.offers.title")}
        </h1>
        <p className="dof__loading">{t("driver.offers.loading")}</p>
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section className="dof" aria-labelledby={`${formId}-title`}>
        <h1 id={`${formId}-title`} className="dof__title">
          {t("driver.offers.title")}
        </h1>
        <EmptyState title={t("driver.offers.failed")} body={t(offersErrorKey(state.code))} />
        {isRetryableOffersError(state.code) ? (
          <button type="button" className="dof__retry" onClick={() => void load()}>
            {t("driver.offers.retry")}
          </button>
        ) : null}
        {onBack === undefined ? null : (
          <button type="button" className="dof__back" onClick={onBack}>
            {t("driver.offers.back")}
          </button>
        )}
      </section>
    );
  }

  const board = toOffersBoard(state.board);
  // **الباقي يُقرأُ لحظةَ الرسمِ** لا بعقربٍ يدقُّ: `F1-07` و`ADR 0035` §٤
  // يمنعانِ كلَّ مؤقّتٍ دوريٍّ في التطبيقِ المصغَّرِ، ويحرسُهما
  // `scripts/check-system-screens-policy.ts`. والفارقُ محليٌّ بينَ قراءتَينِ من
  // ساعةٍ واحدةٍ فتُلغى إزاحتُها، والتحديثُ بفعلِ السائقِ بزرِّ «حدِّثِ اللوحَ».
  const elapsedMs = now() - state.readAtMs;

  return (
    <section className="dof" aria-labelledby={`${formId}-title`}>
      <h1 id={`${formId}-title`} className="dof__title">
        {t("driver.offers.title")}
      </h1>
      <p className="dof__headline">{t(board.headlineKey)}</p>

      <div className="dof__availability">
        <span className="dof__availability-state">
          {board.isAvailable
            ? t("driver.offers.availability.on")
            : t("driver.offers.availability.off")}
        </span>
        <button
          type="button"
          className="dof__availability-toggle"
          disabled={availabilityState.kind === "busy"}
          onClick={() => void handleAvailability(!board.isAvailable)}
        >
          {board.isAvailable
            ? t("driver.offers.availability.goOffline")
            : t("driver.offers.availability.goOnline")}
        </button>
      </div>
      {availabilityState.kind === "failed" ? (
        <p className="dof__error" role="status">
          {t(availabilityState.key)}
        </p>
      ) : null}

      {board.blockLines.length === 0 ? null : (
        <ul className="dof__blocks" aria-label={t("driver.documents.blocksLabel")}>
          {board.blockLines.map((line) => (
            <li className="dof__block" key={line.id}>
              {line.labelKey === null ? "" : `${t(line.labelKey)}: `}
              {t(line.messageKey)}
              {line.fixLabelKey === null || line.docType === null ? null : (
                <a className="dof__block-fix" href={`#/driver/documents#${line.docType}`}>
                  {t(line.fixLabelKey)}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {board.cards.length === 0 ? (
        <EmptyState title={t("driver.offers.empty.title")} body={t("driver.offers.empty.body")} />
      ) : (
        <ul className="dof__list">
          {board.cards.map((card: OfferCardModel) => {
            const secondsRemaining = countdownSeconds({
              secondsLeftAtRead: card.secondsLeftAtRead,
              elapsedMs,
            });
            // النغمةُ تُقرأُ من الجدولِ **قبلَ** العرضِ كي يكونَ الإحلالُ
            // `badge.modifier` — تعبيراً يُحَلُّ ساكناً لحاجزِ الأنماطِ (القاعدة ٣).
            const badge = COUNTDOWN_BADGE[countdownTone(secondsRemaining)];
            const row = rows[card.offerId] ?? { kind: "idle" };
            const open = canAcceptNow({ isClaimable: true, secondsRemaining });
            return (
              <li className="dof__item" key={card.offerId}>
                <div className="dof__item-head">
                  <span className="dof__service">{t(card.serviceKey)}</span>
                  <span className={`dof__timer ${badge.modifier}`} role="status">
                    {secondsRemaining > 0
                      ? countdownLabel(secondsRemaining)
                      : t("driver.offers.timer.elapsed")}
                  </span>
                </div>

                <p className="dof__place">
                  {t("driver.offers.pickup")}:{" "}
                  {card.pickupLabel ?? t("driver.offers.place.unnamed")}
                </p>
                <p className="dof__place">
                  {t("driver.offers.dropoff")}: {card.dropoffLabel ?? t("driver.offers.place.none")}
                </p>

                <DistanceRow
                  line={card.riderDistance}
                  labelKey="driver.offers.riderDistance"
                  t={t}
                />
                <DistanceRow line={card.tripDistance} labelKey="driver.offers.tripDistance" t={t} />

                <div className="dof__actions">
                  {open && onOpenOffer !== undefined ? (
                    <button
                      type="button"
                      className="dof__open"
                      onClick={() => onOpenOffer(card.offerId)}
                    >
                      {t("driver.offers.open")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="dof__reject"
                    disabled={row.kind === "busy"}
                    onClick={() => void handleReject(card.offerId)}
                  >
                    {t("driver.offers.reject")}
                  </button>
                </div>
                {row.kind === "failed" ? (
                  <p className="dof__error" role="status">
                    {t(row.key)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="dof__refresh" onClick={() => void load()}>
        {t("driver.offers.refresh")}
      </button>

      {onOpenJob === undefined ? null : (
        <button type="button" className="dof__job" onClick={onOpenJob}>
          {t("driver.offers.openJob")}
        </button>
      )}

      {onOpenActivity === undefined ? null : (
        <button type="button" className="dof__activity" onClick={onOpenActivity}>
          {t("driver.offers.openActivity")}
        </button>
      )}

      {onOpenSubscription === undefined ? null : (
        <button type="button" className="dof__subscription" onClick={onOpenSubscription}>
          {t("driver.offers.openSubscription")}
        </button>
      )}

      {onOpenSupport === undefined ? null : (
        <button type="button" className="dof__support" onClick={onOpenSupport}>
          {t("driver.offers.openSupport")}
        </button>
      )}

      {onOpenAccount === undefined ? null : (
        <button type="button" className="dof__account" onClick={onOpenAccount}>
          {t("driver.offers.openAccount")}
        </button>
      )}

      <ul className="dof__debt" aria-label={t("driver.offers.debtLabel")}>
        {DECLARED_DEBT.map((key) => (
          <li className="dof__debt-item" key={key}>
            {t(key)}
          </li>
        ))}
      </ul>

      {onBack === undefined ? null : (
        <button type="button" className="dof__back" onClick={onBack}>
          {t("driver.offers.back")}
        </button>
      )}
    </section>
  );
}
