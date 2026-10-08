/**
 * الغرض: لوحةُ تفضيلاتِ الإشعارات ([B] · R12) — مفتاحانِ غيرُ تشغيليَّين (العروض · التحديثات) على العقدِ
 *   القائم، بحفظٍ صريحٍ وحالٍ يُقرأُ من الخادمِ بعدَه.
 * الحالة: منفّذ فعلياً — UI-3 / PR 5 (ADR 0238).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/settings
 * يُستخدم من: `rider/notifications/NotificationsScreen.tsx`.
 *
 * الحالات: تحميل · غيرُ متاح (503) · جلسة · خطأٌ يُعاد · جاهز · لا تغيير (الحفظُ معطَّل) · يُحفَظ · حُفِظ · رُفِض.
 * وإشعاراتُ الرحلةِ التشغيليّةُ لا مفتاحَ لها ههنا — تُقالُ جملةً ولا تُعرَضُ مفتاحاً يوهمُ بإطفائها.
 */

// `D-33` · `ADR 0188`: مفاتيحُ هذه اللوحةِ في جزءِ `rider-history` من القاموس.
import "../../../../../../packages/shared/i18n/miniapp/ar-parts/rider-history.ts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import {
  UiBanner,
  UiButton,
  UiCard,
  UiError,
  UiSegment,
  UiSkeleton,
  UiToast,
} from "../../../system/ui/index.tsx";
import { type CapabilityFailure, classifyCapabilityFailure } from "./capability.ts";
import {
  NOTIFICATION_PREF_FIELDS,
  type NotificationPrefs,
  prefsChanged,
  readNotificationPrefs,
  saveNotificationPrefs,
} from "./notification-prefs.ts";

export interface NotificationPrefsPanelProps {
  readonly language?: MiniAppLanguage;
  readonly read?: () => Promise<NotificationPrefs>;
  readonly save?: (prefs: NotificationPrefs) => Promise<unknown>;
  /**
   * بذرةُ الحالِ الأولى — **للعرضِ الساكنِ في الاختبار وحدَه** (لا مكتبةَ DOM في المستودع: ADR 0238).
   * في التشغيلِ لا تُمرَّرُ، والقراءةُ من الخادمِ تجري عندَ التركيبِ على كلِّ حال.
   */
  readonly initial?: NotificationPrefsSeed | undefined;
}

export interface NotificationPrefsSeed {
  readonly state?: NotificationPrefsPanelState;
  readonly draft?: NotificationPrefs | null;
  readonly failure?: CapabilityFailure | null;
  readonly savedNotice?: boolean;
}

export type NotificationPrefsPanelState = PanelState;

type PanelState =
  | { readonly kind: "reading" }
  | { readonly kind: "failed"; readonly failure: CapabilityFailure }
  | { readonly kind: "ready"; readonly saved: NotificationPrefs };

const K = "rider.notifications.prefs.";

export function NotificationPrefsPanel({
  language = MINIAPP_DEFAULT_LANGUAGE,
  read = readNotificationPrefs,
  save = saveNotificationPrefs,
  initial,
}: NotificationPrefsPanelProps) {
  const t = miniAppTranslator(language);
  const groupName = useId();
  const mounted = useRef(true);
  const [state, setState] = useState<PanelState>(initial?.state ?? { kind: "reading" });
  const [draft, setDraft] = useState<NotificationPrefs | null>(initial?.draft ?? null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<CapabilityFailure | null>(initial?.failure ?? null);
  const [savedNotice, setSavedNotice] = useState(initial?.savedNotice ?? false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState({ kind: "reading" });
    try {
      const response = await read();
      const saved = {
        offersEnabled: response.offersEnabled,
        updatesEnabled: response.updatesEnabled,
      };
      if (!mounted.current) return;
      setState({ kind: "ready", saved });
      setDraft(saved);
    } catch (thrown) {
      if (mounted.current) setState({ kind: "failed", failure: classifyCapabilityFailure(thrown) });
    }
  }, [read]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (next: NotificationPrefs) => {
    setSaving(true);
    setFailure(null);
    setSavedNotice(false);
    try {
      await save(next);
      if (!mounted.current) return;
      setSavedNotice(true);
      await load();
    } catch (thrown) {
      if (mounted.current) setFailure(classifyCapabilityFailure(thrown));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const body = () => {
    if (state.kind === "reading") return <UiSkeleton label={t(`${K}reading`)} lines={2} />;
    if (state.kind === "failed") {
      const f = state.failure;
      if (f.kind === "unavailable") return <UiBanner tone="amber" message={t(`${K}unavailable`)} />;
      if (f.kind === "session")
        return <UiError tone="amber" title={t(`${K}session.title`)} body={t(`${K}session.body`)} />;
      return (
        <UiError
          tone="bad"
          title={t(`${K}error.title`)}
          body={t(`${K}error.read`)}
          action={<UiButton onClick={() => void load()}>{t(`${K}retry`)}</UiButton>}
        />
      );
    }
    const current = draft ?? state.saved;
    const changed = prefsChanged(state.saved, current);
    return (
      <form
        className="rset__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) void submit(current);
        }}
      >
        <p className="sys__hint">{t(`${K}operational`)}</p>
        {NOTIFICATION_PREF_FIELDS.map((field) => (
          <div key={field}>
            <UiSegment
              name={`${groupName}-${field}`}
              label={t(`${K}${field}.label`)}
              options={[
                { value: "on", label: t(`${K}on`) },
                { value: "off", label: t(`${K}off`) },
              ]}
              value={current[field] ? "on" : "off"}
              onSelect={(value) => {
                setSavedNotice(false);
                setDraft({ ...current, [field]: value === "on" });
              }}
            />
            <p className="sys__hint">{t(`${K}${field}.hint`)}</p>
          </div>
        ))}
        {savedNotice && !changed ? <UiToast tone="ok" message={t(`${K}saved`)} /> : null}
        {failure === null ? null : failure.kind === "unavailable" ? (
          <UiBanner tone="amber" message={t(`${K}unavailable`)} />
        ) : (
          <UiBanner
            tone="bad"
            message={t(failure.kind === "session" ? `${K}session.body` : `${K}error.save`)}
          />
        )}
        <div className="rset__actions">
          <UiButton type="submit" variant="brand" loading={saving} disabled={!changed}>
            {t(saving ? `${K}saving` : `${K}save`)}
          </UiButton>
        </div>
      </form>
    );
  };

  return <UiCard title={t(`${K}title`)}>{body()}</UiCard>;
}
