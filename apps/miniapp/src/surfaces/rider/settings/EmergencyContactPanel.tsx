/**
 * الغرض: لوحةُ جهةِ اتّصالِ الطوارئ ([B] · R13 حسابي) — قراءةٌ وإضافةٌ وتعديلٌ على العقدِ القائم، وحالةٌ
 *   صادقةٌ لكلِّ ما سواه: تحميل · غيرُ متاح (503) · جلسة · خطأٌ يُعاد · فارغ · محفوظ · رُفِض.
 * الحالة: منفّذ فعلياً — UI-3 / PR 5 (ADR 0238).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/settings
 * يُستخدم من: `rider/account/AccountScreen.tsx`.
 *
 * لا حقلَ يُملأُ حينَ لا مخزن (غيرُ متاح)، ولا «تمَّ» قبلَ ردِّ الخادم، ولا وعدٌ بإبلاغِ الجهةِ عندَ الاستغاثة.
 */

// `D-33` · `ADR 0188`: مفاتيحُ هذه اللوحةِ في جزءِ `account` من القاموس.
import "../../../../../../packages/shared/i18n/miniapp/ar-parts/account.ts";
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
  UiField,
  UiRow,
  UiSkeleton,
  UiToast,
} from "../../../system/ui/index.tsx";
import { type CapabilityFailure, classifyCapabilityFailure } from "./capability.ts";
import {
  type ContactFieldProblem,
  contactProblems,
  contactSaveErrorKey,
  EMERGENCY_CONTACT_NAME_MAX,
  type EmergencyContactResponse,
  hasEmergencyContact,
  readEmergencyContact,
  saveEmergencyContact,
} from "./emergency-contact.ts";

export interface EmergencyContactPanelProps {
  readonly language?: MiniAppLanguage;
  readonly read?: () => Promise<EmergencyContactResponse>;
  readonly save?: (input: { readonly name: string; readonly phone: string }) => Promise<unknown>;
  /**
   * بذرةُ الحالِ الأولى — **للعرضِ الساكنِ في الاختبار وحدَه** (لا مكتبةَ DOM في المستودع: ADR 0238).
   * في التشغيلِ لا تُمرَّرُ، والقراءةُ من الخادمِ تجري عندَ التركيبِ على كلِّ حال.
   */
  readonly initial?: EmergencyContactSeed | undefined;
}

export interface EmergencyContactSeed {
  readonly state?: EmergencyContactPanelState;
  readonly editing?: boolean;
  readonly name?: string;
  readonly phone?: string;
  readonly attempted?: boolean;
  readonly saveFailure?: CapabilityFailure | null;
  readonly saved?: boolean;
}

export type EmergencyContactPanelState = PanelState;

type PanelState =
  | { readonly kind: "reading" }
  | { readonly kind: "failed"; readonly failure: CapabilityFailure }
  | { readonly kind: "ready"; readonly contact: EmergencyContactResponse };

const K = "rider.account.emergency.";

export function EmergencyContactPanel({
  language = MINIAPP_DEFAULT_LANGUAGE,
  read = readEmergencyContact,
  save = saveEmergencyContact,
  initial,
}: EmergencyContactPanelProps) {
  const t = miniAppTranslator(language);
  const nameId = useId();
  const phoneId = useId();
  const mounted = useRef(true);
  const [state, setState] = useState<PanelState>(initial?.state ?? { kind: "reading" });
  const [editing, setEditing] = useState(initial?.editing ?? false);
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [attempted, setAttempted] = useState(initial?.attempted ?? false);
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<CapabilityFailure | null>(
    initial?.saveFailure ?? null,
  );
  const [saved, setSaved] = useState(initial?.saved ?? false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState({ kind: "reading" });
    try {
      const contact = await read();
      if (mounted.current) setState({ kind: "ready", contact });
    } catch (thrown) {
      if (mounted.current) setState({ kind: "failed", failure: classifyCapabilityFailure(thrown) });
    }
  }, [read]);

  useEffect(() => {
    void load();
  }, [load]);

  const problems = contactProblems({ name, phone });
  const problem = (which: ContactFieldProblem) => attempted && problems.includes(which);

  const submit = async () => {
    setAttempted(true);
    setSaved(false);
    if (problems.length > 0) return;
    setSaving(true);
    setSaveFailure(null);
    try {
      await save({ name: name.trim(), phone: phone.trim() });
      if (!mounted.current) return;
      setEditing(false);
      setSaved(true);
      // الحالُ بعدَ الحفظِ يُقرأُ من الخادم — لا يُدَسُّ محلّيّاً.
      await load();
    } catch (thrown) {
      if (mounted.current) setSaveFailure(classifyCapabilityFailure(thrown));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const startEdit = (contact: EmergencyContactResponse) => {
    setName(contact.name ?? "");
    setPhone(contact.phone ?? "");
    setAttempted(false);
    setSaveFailure(null);
    setSaved(false);
    setEditing(true);
  };

  const body = () => {
    if (state.kind === "reading") return <UiSkeleton label={t(`${K}reading`)} lines={2} />;
    if (state.kind === "failed") {
      const { failure } = state;
      if (failure.kind === "unavailable")
        return <UiBanner tone="amber" message={t(`${K}unavailable`)} />;
      if (failure.kind === "session")
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

    const { contact } = state;
    if (editing) {
      return (
        <form
          className="rset__form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <UiField
            id={nameId}
            label={t(`${K}name`)}
            value={name}
            maxLength={EMERGENCY_CONTACT_NAME_MAX}
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
            {...(problem("nameRequired")
              ? { error: t(`${K}problem.nameRequired`) }
              : problem("nameTooLong")
                ? { error: t(`${K}problem.nameTooLong`) }
                : {})}
          />
          <UiField
            id={phoneId}
            label={t(`${K}phone`)}
            hint={t(`${K}phoneHint`)}
            value={phone}
            dir="ltr"
            inputMode="numeric"
            autoComplete="tel"
            onChange={(event) => setPhone(event.target.value)}
            {...(problem("phoneInvalid") ? { error: t(`${K}problem.phoneInvalid`) } : {})}
          />
          {saveFailure === null ? null : saveFailure.kind === "unavailable" ? (
            <UiBanner tone="amber" message={t(`${K}unavailable`)} />
          ) : (
            <UiBanner
              tone="bad"
              message={t(
                saveFailure.kind === "session"
                  ? `${K}session.body`
                  : contactSaveErrorKey(saveFailure.code),
              )}
            />
          )}
          <div className="rset__actions">
            <UiButton type="submit" variant="brand" loading={saving}>
              {t(saving ? `${K}saving` : `${K}save`)}
            </UiButton>
            <UiButton onClick={() => setEditing(false)} disabled={saving}>
              {t(`${K}cancel`)}
            </UiButton>
          </div>
        </form>
      );
    }

    return (
      <>
        {saved ? <UiToast tone="ok" message={t(`${K}saved`)} /> : null}
        {hasEmergencyContact(contact) ? (
          <>
            <UiRow label={t(`${K}name`)} value={contact.name} />
            <UiRow label={t(`${K}phone`)} value={<bdi dir="ltr">{contact.phone}</bdi>} />
            <UiButton onClick={() => startEdit(contact)}>{t(`${K}edit`)}</UiButton>
          </>
        ) : (
          <>
            <p className="sys__hint">{t(`${K}empty`)}</p>
            <UiButton variant="brand" onClick={() => startEdit(contact)}>
              {t(`${K}add`)}
            </UiButton>
          </>
        )}
        <p className="sys__hint">{t(`${K}note`)}</p>
      </>
    );
  };

  return <UiCard title={t(`${K}title`)}>{body()}</UiCard>;
}
