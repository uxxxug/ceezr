/**
 * الغرض: بطاقةُ الاستغاثةِ — **حكمٌ يُقرأُ قبلَ الرسمِ**، وإفصاحٌ يُقالُ قبلَ
 *   الضغطِ، وتأكيدٌ يمنعُ بلاغاً بجيبٍ (البند `F2-10` · `SR-14`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`. حكمُ CI **غيرُ مقروءٍ** بعدُ.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/sos
 * يُستخدم من: `ActiveRideScreen.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ — المُكوِّنُ نفسُه والدورُ خادميٌّ.
 * الحاكم: docs/adr/0111-sos-surface-is-a-judged-card-not-a-button.md
 *
 * ## لماذا **بطاقةٌ محكومةٌ** لا زرٌّ أحمرُ دائمٌ
 *
 * زرٌّ يُعرَضُ دائماً ثمَّ يُجيبُ «لا رحلةَ نشطةً» يكذبُ مرّتَينِ: يَعِدُ قبلَ
 * الضغطِ ويُخلِفُ بعدَه، في اللحظةِ التي لا يُحتمَلُ فيها إخلافٌ. فالحكمُ يُقرأُ
 * أوّلاً، والبطاقةُ تقولُ **ما ستفعلُ وما لن تفعلَ** قبلَ أن تُلمَسَ.
 *
 * ## ولماذا خطوتانِ لا خطوةٌ واحدةٌ
 *
 * بلاغٌ كاذبٌ يُوقِظُ فريقَ مدينةٍ، وعشرةُ بلاغاتٍ كاذبةٍ تجعلُ الحاديَ عشرَ —
 * الصادقَ — يُقرأُ بتراخٍ. والهاتفُ في جيبٍ أو حقيبةٍ يُلمَسُ بلا قصدٍ. فخطوةٌ
 * ثانيةٌ **مقصودةٌ** تحمي مَن يحتاجُ الفريقَ حقّاً، وثمنُها لمسةٌ واحدةٌ لا
 * تستغرقُ ثانيةً. ولا تُطلَبُ كلمةٌ ولا سببٌ ولا نموذجٌ: التأكيدُ لمسةٌ، لا
 * استجوابٌ لخائفٍ.
 *
 * ## ولماذا يُعرَضُ الإفصاحُ **قبلَ** الضغطِ لا بعدَه
 *
 * «ماذا سيُرسَلُ عنّي؟» سؤالٌ يُجابُ قبلَ الفعلِ أو لا يُجابُ. ومنه صراحةً:
 * **المنصّةُ لا تتّصلُ بأحدٍ** (`SOS_NO_PHONE_CALL`) — ومَن ظنَّ أنَّ ضغطةً
 * تستدعي شرطةً وهيَ تُخطِرُ فريقَ تشغيلٍ، ينتظرُ نجدةً لا تأتي.
 *
 * ## ولماذا لا يختفي شيءٌ بعدَ الإرسالِ
 *
 * مَن أبلغَ ثمَّ رأى الشاشةَ فارغةً ظنَّ أنَّ نداءَه ضاعَ. فيبقى البلاغُ معروضاً
 * بحالِه وعُمرِه ما دامَ مفتوحاً — **ولو انتهَت أهليّةُ فتحِ بلاغٍ جديدٍ**.
 *
 * ## وما لا تفعلُه هذه البطاقةُ عن قصدٍ
 *
 *   ــ **لا تتّصلُ ولا تفتحُ `tel:` ولا واتساب**: لا مزوِّدَ اتّصالٍ في
 *      المستودَعِ، ووعدُ اتّصالٍ لا يقعُ أخطرُ من غيابِه.
 *   ــ **لا تعرضُ موقعاً ولا هويّةَ سائقٍ**: الإفصاحُ يقولُ ماذا يُرسَلُ.
 *   ــ **لا تُعيدُ المحاولةَ تلقائيّاً**: بلاغانِ عن حادثٍ واحدٍ يُشتِّتانِ.
 *   ــ **لا تعرضُ مالاً**: `ADR 0039` §٤.
 */

import { useCallback, useEffect, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { readSosSurface as readViaApi, triggerSos as triggerViaApi } from "./sos-api.ts";
import type { SosSurfaceResponse, SosTriggerResponse } from "./sos-contract.ts";
import {
  blockReasonKey,
  disclosureKey,
  incidentAgeText,
  incidentStatusKey,
  isRetryableSosError,
  isSosCardVisible,
  originKey,
  readRefusalKey,
  sosErrorKey,
  triggerRefusalKey,
} from "./sos-view.ts";

export interface SosCardProps {
  readonly language?: MiniAppLanguage;
  readonly read?: () => Promise<SosSurfaceResponse>;
  readonly send?: () => Promise<SosTriggerResponse>;
}

type Found = Extract<SosSurfaceResponse, { found: true }>;

type CardState =
  | { readonly kind: "reading" }
  | { readonly kind: "refused"; readonly refusal: string }
  | { readonly kind: "rejected"; readonly code: string }
  | { readonly kind: "ready"; readonly view: Found };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

export function SosCard({
  language = MINIAPP_DEFAULT_LANGUAGE,
  read = readViaApi,
  send = triggerViaApi,
}: SosCardProps) {
  const t = miniAppTranslator(language);
  const [state, setState] = useState<CardState>({ kind: "reading" });
  const [busy, setBusy] = useState(false);
  /** الخطوةُ الثانيةُ — تُطفَأُ بعدَ كلِّ إرسالٍ فلا تبقى مُسلَّحةً في الخلفيّةِ. */
  const [armed, setArmed] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const refresh = useCallback(async () => {
    setState({ kind: "reading" });
    try {
      const response = await read();
      setState(
        response.found
          ? { kind: "ready", view: response }
          : { kind: "refused", refusal: response.refusal },
      );
    } catch (thrown) {
      setState({ kind: "rejected", code: codeOf(thrown) });
    }
  }, [read]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const confirmSend = useCallback(async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const response = await send();
      setArmed(false);
      if (response.accepted) {
        // `created:false` ليسَ فشلاً: بلاغُه الأوّلُ قائمٌ. وكلاهما «وصلَ».
        setSent(true);
      } else {
        setRefusal(response.refusal);
      }
      // الحالُ يُعادُ سؤالُه في الحالَينِ: البلاغُ الجديدُ يجبُ أن يظهرَ بحالِه
      // وعُمرِه من القاعدةِ، **ولا تُخمِّنُ الشاشةُ ما صارَ**.
      await refresh();
    } catch (thrown) {
      setArmed(false);
      setState({ kind: "rejected", code: codeOf(thrown) });
    } finally {
      setBusy(false);
    }
  }, [refresh, send]);

  if (state.kind === "reading") {
    return (
      <div className="sos" role="status">
        <p className="sys__hint">{t("rider.sos.reading")}</p>
      </div>
    );
  }

  // حسابٌ لا يُعرَفُ أو محجوبٌ: **لا بطاقةَ استغاثةٍ** تُرسَمُ له، والشاشةُ الأمُّ
  // تقولُ حالَ الحسابِ أصلاً.
  if (state.kind === "refused") {
    return (
      <div className="sos" role="status">
        <p className="sys__hint">{t(readRefusalKey(state.refusal))}</p>
      </div>
    );
  }

  // عطلٌ في قراءةِ الحكمِ **يُقالُ صراحةً ولا يُخفي البطاقةَ بصمتٍ**: مَن لا يرى
  // بطاقةً يظنُّ أنَّ لا سبيلَ، ومَن يقرأُ «تعذَّرَ» يعرفُ أن يطلبَ الطوارئَ العامّةَ.
  if (state.kind === "rejected") {
    return (
      <section className="sos sos--broken" role="alert" aria-labelledby="sos-title">
        <h2 className="sos__title" id="sos-title">
          {t("rider.sos.title")}
        </h2>
        <p className="sos__error">{t(sosErrorKey(state.code))}</p>
        {isRetryableSosError(state.code) && (
          <button type="button" className="sys__action sos__retry" onClick={() => void refresh()}>
            {t("rider.sos.retry")}
          </button>
        )}
      </section>
    );
  }

  const view = state.view;
  const incident = view.incident;
  if (!isSosCardVisible(view.eligible, incident)) return null;

  return (
    <section className="sos" aria-labelledby="sos-title">
      <h2 className="sos__title" id="sos-title">
        {t("rider.sos.title")}
      </h2>

      {/* البلاغُ القائمُ أوّلاً: مَن أبلغَ يسألُ «هل وصلَ؟» قبلَ كلِّ شيءٍ. */}
      {incident !== null && (
        <div className="sos__incident" role="status">
          <p className="sos__incident-status">{t(incidentStatusKey(incident.status))}</p>
          <p className="sos__incident-age">
            {(() => {
              const age = incidentAgeText(incident.ageSeconds);
              return t(age.key)
                .replace("{minutes}", String(age.minutes))
                .replace("{seconds}", String(age.seconds));
            })()}
          </p>
        </div>
      )}

      {view.eligible ? (
        <>
          <p className="sos__origin">{t(originKey(view.origin))}</p>
          {/*
            نافذةُ ما بعدَ الرحلةِ تُقالُ **بقيمةِ المدينةِ** لا برقمٍ مكتوبٍ.
            و`view.orderId !== null` أوّلاً ليسَ حشواً: بلاغٌ بلا رحلةٍ (`F12-03`)
            لا يُنشَرُ له رقمُ نافذةٍ ألبتّةَ، وبه يمنعُ المُصرِّفُ قراءةَ حقلٍ
            لم يُنشَرْ فيُطبَعَ `undefined` في شاشةِ استغاثةٍ.
          */}
          {view.orderId !== null && view.origin === "RECENT_ORDER" && (
            <p className="sos__window">
              {t("rider.sos.window").replace("{minutes}", String(view.postRideWindowMinutes))}
            </p>
          )}
        </>
      ) : (
        <p className="sos__blocked">{t(blockReasonKey(view.reason))}</p>
      )}

      {/* **الإفصاحُ قبلَ الضغطِ** — يصلُ رموزاً من الخادمِ ويُعرَضُ كما وصلَ. */}
      <div className="sos__disclosure">
        <p className="sos__disclosure-title">{t("rider.sos.disclosure.title")}</p>
        <ul className="sos__disclosure-list">
          {view.disclosure.map((code) => (
            <li className="sos__disclosure-item" key={code}>
              {t(disclosureKey(code))}
            </li>
          ))}
        </ul>
      </div>

      {sent && (
        <p className="sos__sent" role="status">
          {t("rider.sos.sent")}
        </p>
      )}

      {refusal !== null && (
        <p className="sos__refusal" role="alert">
          {t(triggerRefusalKey(refusal))}
        </p>
      )}

      {/* الخطوتانِ. والثانيةُ لها بابُ تراجعٍ صريحٌ: مَن سلَّحَ بلا قصدٍ يُلغي. */}
      {view.eligible &&
        (armed ? (
          <div className="sos__confirm">
            <p className="sos__confirm-question">{t("rider.sos.confirmQuestion")}</p>
            <button
              type="button"
              className="sos__confirm-send"
              disabled={busy}
              onClick={() => void confirmSend()}
            >
              {t(busy ? "rider.sos.sending" : "rider.sos.confirmSend")}
            </button>
            <button
              type="button"
              className="sos__confirm-cancel"
              disabled={busy}
              onClick={() => setArmed(false)}
            >
              {t("rider.sos.confirmCancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="sos__arm"
            disabled={busy}
            onClick={() => {
              setRefusal(null);
              setSent(false);
              setArmed(true);
            }}
          >
            {t("rider.sos.arm")}
          </button>
        ))}

      <button
        type="button"
        className="sys__action sos__refresh"
        disabled={busy}
        onClick={() => void refresh()}
      >
        {t("rider.sos.refresh")}
      </button>
    </section>
  );
}
