/**
 * الغرض: شاشةُ تفاصيلِ رحلةٍ واحدةٍ — حالةٌ وطرفانِ وبطاقةُ سائقٍ وسجلُّ
 *   أحداثٍ بمصادرِه (البند `F2-08` · `SR-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/history
 * يُستخدم من: `apps/miniapp/src/surfaces/rider/RiderRoot.tsx` (طورُ `inspected`)
 * يُتوقع أن يستخدمه لاحقاً: `F2-12` (تذكرةُ الدعمِ) تُضيفُ مدخلَها **ههنا**
 *   حينَ يُبنى مسارُها — لا زرَّ قبلَ مسارٍ.
 *
 * ## لماذا سجلُّ الأحداثِ **يُعرَضُ بمصدرِ كلِّ حدثٍ**
 *
 * لأنَّ السجلَّ شاهدٌ في نزاعٍ: «متى أُلغيَت؟» جوابُها من ختمِ الطلبِ أو من
 * سجلِّ التدقيقِ، وفرقُهما فرقُ درجةِ سندٍ. وسجلٌّ بلا مصادرَ يبدو يقيناً
 * متساوياً، فيُحتَجُّ به حيثُ لا يصلحُ.
 *
 * ## ولماذا حدثٌ بلا لحظةٍ **يُعرَضُ** ولا يُحذَفُ
 *
 * إلغاءٌ جرى ولا صفَّ تدقيقٍ له حدثٌ **واقعٌ** لحظتُه غيرُ مسجَّلةٍ. وحذفُ سطرِه
 * يُنتِجُ سجلّاً يقولُ إنَّ الرحلةَ لم تُلغَ — وذاكَ إخفاءُ دليلٍ (`ح-5`).
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ
 *
 *   ــ **لا تعرضُ مبلغاً ولا أجرةً ولا وسيلةَ دفعٍ ولا إيصالاً ولا خانةً لها** —
 *      مُجمَّدةٌ بـ`ADR 0039` §٤ (`DEC-11` · `م13-7`). **وهذه تفاصيلُ رحلةٍ لا
 *      إيصالٌ.**
 *   ــ **لا ترسمُ خريطةً ولا مستطيلاً يُشبِهُها**: لا مزوِّدَ (`ADR 0007`) ولا
 *      أثرَ مسارٍ في المخطَّطِ — **غيابٌ مُصرَّحٌ**، ومستطيلٌ رماديٌّ كذبٌ مرسومٌ.
 *   ــ **لا ترسمُ زرَّ «مشكلةٌ في هذه الرحلةِ»**: مسارُه `F2-12` — وزرٌّ مُعطَّلٌ
 *      وعدٌ لا عقدٌ.
 *   ــ **لا تعرضُ مدّةً ولا وترَ خطٍّ**: حقولُ الملخَّصِ (`F2-07`)، وتكرارُها
 *      مصدرُ حقيقةٍ ثانٍ (القاعدة 0.6).
 *   ــ **لا تعرضُ نموذجَ تقييمٍ**: بابُه شاشةُ الملخَّصِ وحدَها.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  directionFor,
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import {
  classifyFailure,
  failureFromThrown,
  shouldProbeReachability,
} from "../../../system/failure.ts";
import { deviceOnline, probeReachability } from "../../../system/health.ts";
import { Skeleton } from "../../../system/Skeleton.tsx";
import { SystemScreen } from "../../../system/SystemScreen.tsx";
import type { ScreenState } from "../../../system/state-text.ts";
import { readRideDetail as readViaApi } from "./ride-history-api.ts";
import type { RideDetailResponse } from "./ride-history-contract.ts";
import {
  detailRefusalKey,
  eventLabel,
  eventSourceKey,
  historyErrorKey,
  instantParts,
  monthNameKey,
  outcomeKey,
  serviceKey,
  statusLabel,
} from "./ride-history-view.ts";

export interface RideDetailScreenProps {
  readonly orderId: string;
  /** منطقةُ تصنيفِ السجلِّ كما نشرَتها القاعدةُ — **تُمرَّرُ ولا تُخمَّنُ**: لحظةُ
   *  حدثٍ بساعةٍ تخالفُ ساعةَ عنوانِ شهرِه تُنتِجُ سجلّاً يناقضُ قائمتَه. */
  readonly timeZone: string;
  readonly read?: (orderId: string) => Promise<RideDetailResponse>;
  readonly onBack?: () => void;
  readonly initialLanguage?: MiniAppLanguage;
}

/**
 * شارةُ المآلِ — **المعدِّلُ مكتوبٌ حرفاً** لا مبنيٌّ من اسمِ المآلِ في زمنِ
 * التشغيلِ: حاجزُ تغطيةِ الأنماطِ (`ADR 0105` · `UX-021`) يقرأُ النصَّ الساكنَ،
 * وصنفٌ مبنيٌّ يمرُّ أخضرَ وهو بلا قاعدةٍ في ورقةِ النمطِ. والمآلُ يصلُ من
 * العقدِ **نصّاً مفتوحَ الاتحادِ**، فالسقوطُ إلى `--other` لازمٌ لا احتياطٌ.
 */
interface OutcomeBadge {
  readonly outcome: string;
  readonly modifier: string;
}

const OUTCOME_BADGES: readonly OutcomeBadge[] = [
  { outcome: "IN_FLIGHT", modifier: "hd__badge--in-flight" },
  { outcome: "COMPLETED", modifier: "hd__badge--completed" },
  { outcome: "NOT_COMPLETED", modifier: "hd__badge--not-completed" },
  { outcome: "OTHER", modifier: "hd__badge--other" },
];

const FALLBACK_BADGE: OutcomeBadge = { outcome: "OTHER", modifier: "hd__badge--other" };

function badgeOf(outcome: string): OutcomeBadge {
  return OUTCOME_BADGES.find((row) => row.outcome === outcome) ?? FALLBACK_BADGE;
}

type Found = Extract<RideDetailResponse, { found: true }>;

type DetailState =
  | { readonly kind: "reading" }
  | { readonly kind: "refused"; readonly refusal: string }
  | { readonly kind: "rejected"; readonly code: string }
  | { readonly kind: "ready"; readonly view: Found };

type SystemState = { readonly screen: ScreenState } | null;

function codeOf(thrown: unknown): string | null {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

async function screenFor(thrown: unknown): Promise<ScreenState | null> {
  const failure = failureFromThrown(thrown);
  if (failure === null) return null;
  const online = deviceOnline();
  const probe = shouldProbeReachability(failure, online) ? await probeReachability() : "not_probed";
  return classifyFailure(failure, probe, online);
}

export function RideDetailScreen({
  orderId,
  timeZone,
  read = readViaApi,
  onBack,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
}: RideDetailScreenProps) {
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const [state, setState] = useState<DetailState>({ kind: "reading" });
  const [system, setSystem] = useState<SystemState>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const issued = useRef(0);
  const t = miniAppTranslator(language);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (id: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const question = ++issued.current;
      try {
        const response = await read(id);
        if (!mounted.current || question !== issued.current) return;
        if (!response.found) {
          setState({ kind: "refused", refusal: response.refusal });
          return;
        }
        setState({ kind: "ready", view: response });
      } catch (thrown) {
        if (!mounted.current || question !== issued.current) return;
        const screen = await screenFor(thrown);
        if (!mounted.current) return;
        if (screen !== null) setSystem({ screen });
        else setState({ kind: "rejected", code: codeOf(thrown) ?? "HTTP_ERROR" });
      } finally {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [read],
  );

  /** نداءٌ واحدٌ — الماضي لا يتحرَّكُ فلا يُستقصى (`ADR 0035` §٤). */
  useEffect(() => {
    void refresh(orderId);
  }, [orderId, refresh]);

  if (system !== null) {
    return (
      <SystemScreen state={system.screen} onAction={() => void refresh(orderId)} busy={busy} />
    );
  }

  const detailBody = (view: Found) => {
    const status = statusLabel(view.status);
    const driver = view.driver;
    // كما في الشاشةِ الأختِ: الإحلالُ `badge.modifier` لا `badgeOf(...).modifier`،
    // لأنَّ الحاجزَ يقرأُ جذرَ الإحلالِ لا نتيجتَه (`ADR 0105` · القاعدة ٣).
    const badge = badgeOf(view.outcome);

    return (
      <div className="hd__body">
        <p className={`hd__badge ${badge.modifier}`}>{t(outcomeKey(view.outcome))}</p>
        <p className="hd__status">
          {status.known ? t(status.key) : t(status.key).replace("{status}", status.raw)}
        </p>
        <p className="hd__service">{t(serviceKey(view.service))}</p>
        <p className="hd__route">
          {t("rider.history.route")
            .replace("{pickup}", view.pickupLabel ?? t("rider.history.point.unlabeled"))
            .replace("{dropoff}", view.dropoffLabel ?? t("rider.history.point.unlabeled"))}
        </p>

        {/* سببُ الإلغاءِ **نصُّ القاعدةِ خامّاً**: مُعجَمُ الأسبابِ ليسَ محصوراً
            في هذا البندِ، ومفتاحٌ مُترجَمٌ لسببٍ غيرِ محصورٍ يُنتِجُ نصّاً
            مفقوداً. فيُعرَضُ كما كُتِبَ ويُصرَّحُ بأنَّه مُسجَّلٌ لا مُترجَمٌ. */}
        {view.cancelledReason === null ? null : (
          <p className="hd__cancelled">
            {t("rider.history.detail.cancelledReason").replace("{reason}", view.cancelledReason)}
          </p>
        )}

        {driver === null ? (
          <p className="hd__no-driver">{t("rider.history.detail.driver.none")}</p>
        ) : (
          <div className="hd__driver">
            <p className="hd__driver-name">
              {t("rider.history.detail.driver.name").replace(
                "{name}",
                driver.firstName ?? t("rider.history.detail.driver.unnamed"),
              )}
            </p>
            <p className="hd__driver-vehicle">
              {t("rider.history.detail.driver.vehicle")
                .replace(
                  "{vehicle}",
                  driver.vehicleType ?? t("rider.history.detail.driver.noVehicle"),
                )
                .replace("{plate}", driver.plateNumber ?? t("rider.history.detail.driver.noPlate"))}
            </p>
            {/* `null` = لا تقييمَ بعدُ: يُقالُ نصّاً ولا يُعرَضُ صفرٌ. */}
            <p className="hd__driver-rating">
              {driver.ratingAverage === null
                ? t("rider.history.detail.driver.unrated")
                : t("rider.history.detail.driver.rating")
                    .replace("{average}", driver.ratingAverage.toFixed(1))
                    .replace("{count}", String(driver.ratingCount))}
            </p>
          </div>
        )}

        <h2 className="hd__events-title">{t("rider.history.detail.events.title")}</h2>
        <ol className="hd__events">
          {/* المفتاحُ **من محتوى الحدثِ** لا من ترتيبِه: القاعدةُ تولَّدُ حدثاً
              واحداً لِكلِّ (نوعٍ · مصدرٍ) في الرحلةِ، ومفتاحٌ من الدليلِ يُعيدُ استعمالَ
              حالةِ صفٍّ لِصفٍّ أخرَ متى تغيَّرَ الطولُ بعدَ إعادةِ قراءةٍ. */}
          {view.events.map((event) => {
            const label = eventLabel(event);
            const at = event.at === null ? null : instantParts(event.at, timeZone);
            return (
              <li
                className="hd__event"
                key={`${event.rawKind}\u0000${event.source}\u0000${event.at ?? ""}`}
              >
                <span className="hd__event-kind">
                  {label.known ? t(label.key) : t(label.key).replace("{kind}", label.raw)}
                </span>
                {/* لحظةٌ غائبةٌ أو غيرُ مقروءةٍ **تُقالُ** ولا تُستبدَلُ. */}
                <span className="hd__event-at">
                  {at === null
                    ? t(
                        event.at === null
                          ? "rider.history.detail.events.unstamped"
                          : "rider.history.when.unreadable",
                      )
                    : t("rider.history.detail.events.at")
                        .replace("{day}", String(at.day))
                        .replace("{month}", t(monthNameKey(at.month)))
                        .replace("{year}", String(at.year))
                        .replace("{hour}", String(at.hour).padStart(2, "0"))
                        .replace("{minute}", String(at.minute).padStart(2, "0"))}
                </span>
                <span className="hd__event-source">{t(eventSourceKey(event.source))}</span>
              </li>
            );
          })}
        </ol>

        {/* غيابانِ **مُصرَّحانِ نصّاً**: خريطةٌ لا مزوِّدَ لها، وتذكرةُ دعمٍ لا
            مسارَ لها بعدُ. والتصريحُ أصدقُ من زرٍّ مُعطَّلٍ ومن صمتٍ. */}
        <p className="hd__absent">{t("rider.history.detail.noMap")}</p>
        <p className="hd__absent">{t("rider.history.detail.noSupport")}</p>
      </div>
    );
  };

  const body = () => {
    if (state.kind === "reading") {
      return (
        <div className="hd__pending" aria-busy="true">
          <p className="sys__hint">{t("rider.history.detail.reading")}</p>
          <Skeleton />
        </div>
      );
    }

    if (state.kind === "refused") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(detailRefusalKey(state.refusal))}</p>
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.history.back")}
          </button>
        </div>
      );
    }

    if (state.kind === "rejected") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(historyErrorKey(state.code))}</p>
          <button type="button" className="sys__action" onClick={() => void refresh(orderId)}>
            {t("rider.history.retry")}
          </button>
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.history.back")}
          </button>
        </div>
      );
    }

    return (
      <>
        {detailBody(state.view)}
        <button type="button" className="hd__back" onClick={() => onBack?.()}>
          {t("rider.history.back")}
        </button>
      </>
    );
  };

  return (
    <section className="hd" dir={directionFor(language)} aria-labelledby="hd-title">
      <h1 className="hd__title" id="hd-title">
        {t("rider.history.detail.title")}
      </h1>
      {body()}
    </section>
  );
}
