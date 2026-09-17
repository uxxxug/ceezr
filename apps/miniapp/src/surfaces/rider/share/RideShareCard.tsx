/**
 * الغرض: بطاقةُ مشاركةِ الرحلةِ برابطٍ مؤقّتٍ — إصدارٌ وإيقافٌ **ومعاينةُ ما
 *   سيراهُ المستلمُ** (البند `F2-09` · `SR-13`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`. حكمُ CI **غيرُ مقروءٍ** (`B-CI-001`).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/share
 * يُستخدم من: `ActiveRideScreen.tsx` داخلَ شاشةِ الرحلةِ النشطةِ.
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` — زرُّ الطوارئِ يجاورُها ويقرأُ حالَها.
 *
 * ## لماذا **معاينةٌ** لا وعدٌ نصّيٌّ
 *
 * كلُّ تطبيقٍ يقولُ «لن نُشارِكَ إلّا موقعَكَ»، ولا أحدَ يُري صاحبَه ما سيُرى
 * فعلاً. وهذه البطاقةُ تعرضُ **جوابَ المستلمِ نفسَه** — الحكمَ والنقطةَ
 * وعُمرَها كما تُخرِجُها `tracking_link_view` للصفحةِ العامّةِ في اللحظةِ
 * نفسِها. فإن قالَت «انقطعَت إشارتُه» عرفَ المالكُ أنَّ مَن يُعطيهِ الرابطَ لن
 * يرى شيئاً مفيداً **قبلَ** أن يُرسِلَه ويظنَّ أنَّه طمأنَ أهلَه.
 *
 * ## ولماذا لا يدقُّ عدّادٌ
 *
 * عينُ حكمِ `SR-05` و`F2-06`: المتبقّي رقمٌ قاسَته القاعدةُ لحظةَ السؤالِ،
 * ويُعادُ سؤالُه بضغطةٍ. وعقربٌ يدقُّ فوقَ رقمٍ جامدٍ يُوهِمُ بمتابعةٍ لا تحدثُ.
 *
 * ## ولماذا «أوقِفِ المشاركةَ» يُلغي **كلَّ** الروابطِ
 *
 * مَن ضغطَ «أوقِفْ» أرادَ أن **لا يَرى أحدٌ**. وقائمةُ خياراتٍ يُلغى فيها رابطٌ
 * ويبقى آخرُ تتركُه يظنُّ أنَّه أغلقَ البابَ وقد أبقى نافذةً — والمعنى ههنا
 * موقعُ إنسانٍ في الطريقِ.
 *
 * ## وما لا تفعلُه هذه البطاقةُ عن قصدٍ
 *
 *   ــ **لا تُرسِلُ الرابطَ**: المشاركةُ من نظامِ الجهازِ؛ ولا مزوِّدَ رسائلَ
 *      في المستودَعِ، ووعدُ إرسالٍ لا يُنفَّذُ أسوأُ من غيابِه.
 *   ــ **لا تعرضُ رمزاً**: الرمزُ داخلَ الرابطِ وحدَه، ولا يُكتَبُ في الشاشةِ
 *      كي لا يُلتقَطَ من صورةٍ.
 *   ــ **لا تُخفي انقطاعَ الإشارةِ خلفَ «جارٍ التحديثُ»**.
 *   ــ **لا تعرضُ سعراً**: `ADR 0039` §٤.
 */

import { useCallback, useEffect, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import {
  readShare as readViaApi,
  startShare as startViaApi,
  stopShare as stopViaApi,
} from "./ride-share-api.ts";
import type {
  ShareStateResponse,
  StartShareResponse,
  StopShareResponse,
} from "./ride-share-contract.ts";
import {
  disclosureKey,
  isRetryableShareError,
  lifetimeLine,
  previewLine,
  readRefusalKey,
  shareErrorKey,
  startRefusalKey,
} from "./ride-share-view.ts";

export interface RideShareCardProps {
  readonly orderId: string;
  readonly language?: MiniAppLanguage;
  readonly read?: (orderId: string) => Promise<ShareStateResponse>;
  readonly start?: (orderId: string) => Promise<StartShareResponse>;
  readonly stop?: (orderId: string) => Promise<StopShareResponse>;
}

type Found = Extract<ShareStateResponse, { found: true }>;

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

export function RideShareCard({
  orderId,
  language = MINIAPP_DEFAULT_LANGUAGE,
  read = readViaApi,
  start = startViaApi,
  stop = stopViaApi,
}: RideShareCardProps) {
  const t = miniAppTranslator(language);
  const [state, setState] = useState<CardState>({ kind: "reading" });
  const [busy, setBusy] = useState(false);
  /** آخرُ رابطٍ أُصدِرَ في هذه الجلسةِ — **يُعرَضُ مرّةً** ولا يُعادُ من القراءةِ. */
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const refresh = useCallback(
    async (id: string) => {
      setState({ kind: "reading" });
      try {
        const response = await read(id);
        setState(
          response.found
            ? { kind: "ready", view: response }
            : { kind: "refused", refusal: response.refusal },
        );
      } catch (thrown) {
        setState({ kind: "rejected", code: codeOf(thrown) });
      }
    },
    [read],
  );

  useEffect(() => {
    void refresh(orderId);
  }, [orderId, refresh]);

  const askStart = useCallback(async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const response = await start(orderId);
      if (response.issued) {
        setIssuedUrl(response.url);
      } else {
        setRefusal(response.refusal);
      }
      // القراءةُ تُعادُ في الحالَينِ: رفضٌ يعني أنَّ الحالَ تغيَّرَ، ونجاحٌ يعني
      // أنَّ هناكَ رابطاً جديداً حيّاً — **والشاشةُ لا تُخمِّنُ الجديدَ بل تسألُ**.
      await refresh(orderId);
    } catch (thrown) {
      setState({ kind: "rejected", code: codeOf(thrown) });
    } finally {
      setBusy(false);
    }
  }, [orderId, refresh, start]);

  const askStop = useCallback(async () => {
    setBusy(true);
    setRefusal(null);
    try {
      await stop(orderId);
      // الرابطُ المعروضُ يختفي فورَ الإيقافِ: إبقاؤُه معروضاً بعدَ إلغائِه
      // يجعلُ صاحبَه ينسخُه ويُرسِلُه ميتاً.
      setIssuedUrl(null);
      await refresh(orderId);
    } catch (thrown) {
      setState({ kind: "rejected", code: codeOf(thrown) });
    } finally {
      setBusy(false);
    }
  }, [orderId, refresh, stop]);

  if (state.kind === "reading") {
    return (
      <div className="rs" role="status">
        <p className="sys__hint">{t("rider.share.reading")}</p>
      </div>
    );
  }

  // رحلةٌ لا يملكُها السائلُ أو لا وجودَ لها: **لا بطاقةَ** — والشاشةُ الأمُّ
  // تقولُ ذلكَ أصلاً، فتكرارُه ههنا ضجيجٌ.
  if (state.kind === "refused") {
    return (
      <div className="rs" role="status">
        <p className="sys__hint">{t(readRefusalKey(state.refusal))}</p>
      </div>
    );
  }

  if (state.kind === "rejected") {
    return (
      <div className="rs" role="alert">
        <p className="sys__body">{t(shareErrorKey(state.code))}</p>
        {isRetryableShareError(state.code) && (
          <button type="button" className="sys__action" onClick={() => void refresh(orderId)}>
            {t("rider.share.retry")}
          </button>
        )}
      </div>
    );
  }

  const view = state.view;
  // **الروابطُ الواصلةُ حيّةٌ بحكمِ القاعدةِ** (`F12-04`): لا تُرشَّحُ ههنا
  // ببقيّةِ سقفٍ — السقفُ ليسَ الموعدَ، وحكمُ الحياةِ في `view.lifetime`.
  const live = view.links;
  const lifetime = lifetimeLine(view.lifetime);
  const preview = previewLine(view.preview);
  const canShare = view.availability === "CAN_SHARE";

  // رحلةٌ منتهيةٌ بلا رابطٍ حيٍّ: لا شيءَ يُقالُ ولا زرَّ يُرسَمُ. وزرٌّ لا يفعلُ
  // شيئاً كذبٌ (عينُ حكمِ `F2-06`).
  if (!canShare && live.length === 0) return null;

  return (
    <section className="rs" aria-labelledby="rs-title">
      <h2 className="rs__title" id="rs-title">
        {t("rider.share.title")}
      </h2>

      {view.sharingNow ? (
        <p className="rs__state" role="status">
          {t("rider.share.sharingNow").replace("{count}", String(live.length))}
        </p>
      ) : (
        <p className="rs__state">{t("rider.share.notSharing")}</p>
      )}

      {/* **متى تنتهي المشاركةُ؟** حكمُ الرحلةِ لا بقيّةُ سقفٍ (`F12-04`) — رقمٌ
          قاسَته القاعدةُ لا عقربٌ يدقُّ، ولا عدَّ لرحلةٍ جاريةٍ. */}
      <p className="rs__until" role="status">
        {t(lifetime.key)
          .replace("{minutes}", String(lifetime.minutes))
          .replace("{seconds}", String(lifetime.seconds))}
      </p>

      {/* **جوابُ المستلمِ نفسُه**، لا وعدٌ عن جوابِه. */}
      <div className="rs__preview" role="status">
        <p className="rs__preview-title">{t("rider.share.preview.title")}</p>
        {preview.show ? (
          <>
            <p className="rs__preview-point">
              {t("rider.share.preview.point")
                .replace("{lat}", preview.lat.toFixed(5))
                .replace("{lng}", preview.lng.toFixed(5))}
            </p>
            <p className="rs__preview-age">
              {t(preview.ageKey)
                .replace("{minutes}", String(preview.ageMinutes))
                .replace("{seconds}", String(preview.ageSeconds))}
            </p>
          </>
        ) : (
          <p className="rs__preview-hidden">{t(preview.key)}</p>
        )}
      </div>

      {/* إفصاحٌ مُرقَّمٌ يصلُ من الخادمِ — يُعرَضُ كما وصلَ ولا يُختصَرُ. */}
      <div className="rs__disclosure">
        <p className="rs__disclosure-shown-title">{t("rider.share.disclosure.shownTitle")}</p>
        <ul className="rs__disclosure-shown">
          {view.disclosure.shown.map((code) => (
            <li key={code}>{t(disclosureKey(code))}</li>
          ))}
        </ul>
        <p className="rs__disclosure-hidden-title">{t("rider.share.disclosure.hiddenTitle")}</p>
        <ul className="rs__disclosure-hidden">
          {view.disclosure.hidden.map((code) => (
            <li key={code}>{t(disclosureKey(code))}</li>
          ))}
        </ul>
      </div>

      {/* المدّةُ تُقالُ **بقيمةِ المدينةِ** — وبغيابِ الإعدادِ تُقالُ الجملةُ بلا
          رقمٍ، ولا يُوعَدُ بمدّةٍ لم تقطعْها المنصّةُ. */}
      <p className="rs__lifetime">
        {view.maxLifetimeMinutes === null
          ? t("rider.share.lifetimeUnknown")
          : t("rider.share.lifetime").replace("{minutes}", String(view.maxLifetimeMinutes))}
      </p>

      {issuedUrl !== null && (
        <p className="rs__url" role="status">
          {t("rider.share.issued").replace("{url}", issuedUrl)}
        </p>
      )}

      {refusal !== null && (
        <p className="rs__refusal" role="alert">
          {t(startRefusalKey(refusal))}
        </p>
      )}

      {canShare && (
        <button type="button" className="rs__start" disabled={busy} onClick={() => void askStart()}>
          {t(busy ? "rider.share.starting" : "rider.share.start")}
        </button>
      )}

      {/* **زرُّ الإيقافِ يُرسَمُ متى كانَ ثمَّةَ ما يُوقَفُ** — حتّى لو انتهت
          الرحلةُ: رابطٌ حيٌّ بعدَ الوصولِ يجبُ أن يبقى له بابُ إغلاقٍ. */}
      {live.length > 0 && (
        <button type="button" className="rs__stop" disabled={busy} onClick={() => void askStop()}>
          {t(busy ? "rider.share.stopping" : "rider.share.stop")}
        </button>
      )}

      <button
        type="button"
        className="sys__action rs__refresh"
        disabled={busy}
        onClick={() => void refresh(orderId)}
      >
        {t("rider.share.refresh")}
      </button>
    </section>
  );
}
