/**
 * الغرض: لوحةُ الأماكنِ المحفوظة ([B] · R13 حسابي) — حفظٌ من وجهةٍ حديثةٍ قرأَها الخادم، وتعديلُ الاسمِ
 *   والنوع، وحذفٌ بتأكيدٍ صريح — على `me-places` القائم وحدَه.
 * الحالة: منفّذ فعلياً — UI-3 / PR 5 (ADR 0238).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/settings
 * يُستخدم من: `rider/account/AccountScreen.tsx`.
 *
 * الحالات: تحميل · غيرُ متاح (503) · جلسة · خطأٌ يُعاد · فارغ · قائمة · تعديل · تأكيدُ حذف · حفظٌ جديد ·
 * نتيجةٌ من الخادم (أُضيف · حُدِّث · حُذِف) · رفضٌ بنصّه. والقائمةُ بعدَ كلِّ فعلٍ تُقرأُ من الخادم.
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
  UiSegment,
  UiSkeleton,
  UiTag,
  UiToast,
} from "../../../system/ui/index.tsx";
import { type CapabilityFailure, classifyCapabilityFailure, failureCode } from "./capability.ts";
import {
  type ApiRecentDestination,
  type ApiSavedPlace,
  isPlaceKind,
  labelProblem,
  PLACE_KINDS,
  PLACE_LABEL_MAX,
  type PlaceKind,
  placeErrorKey,
  placeKindKey,
  replacesExisting,
  type SavedPlacesApi,
  savedPlacesApi,
  unsavedRecent,
} from "./saved-places.ts";

export interface SavedPlacesPanelProps {
  readonly language?: MiniAppLanguage;
  readonly api?: SavedPlacesApi;
  /**
   * بذرةُ الحالِ الأولى — **للعرضِ الساكنِ في الاختبار وحدَه** (لا مكتبةَ DOM في المستودع: ADR 0238).
   * في التشغيلِ لا تُمرَّرُ، والقراءةُ من الخادمِ تجري عندَ التركيبِ على كلِّ حال.
   */
  readonly initial?: SavedPlacesSeed | undefined;
}

export interface SavedPlacesSeed {
  readonly state?: SavedPlacesPanelState;
  readonly draft?: SavedPlacesDraft | null;
  readonly label?: string;
  readonly kind?: PlaceKind;
  readonly attempted?: boolean;
  readonly failure?: CapabilityFailure | null;
  readonly notice?: SavedPlacesNotice | null;
}

type Loaded = {
  readonly places: readonly ApiSavedPlace[];
  /** وجهاتٌ حديثةٌ — أو فشلُها وحدَه، فلا يُسقِطُ القائمةَ عطلٌ في الحديثة. */
  readonly recent:
    | { readonly kind: "listed"; readonly list: readonly ApiRecentDestination[] }
    | CapabilityFailure;
};

type PanelState =
  | { readonly kind: "reading" }
  | { readonly kind: "failed"; readonly failure: CapabilityFailure }
  | { readonly kind: "ready"; readonly loaded: Loaded };

/** ما يُحرَّرُ الآن — مكانٌ قائمٌ، أو وجهةٌ حديثةٌ تُحفَظ، أو مكانٌ يُؤكَّدُ حذفُه. */
type Draft =
  | { readonly mode: "edit"; readonly place: ApiSavedPlace }
  | { readonly mode: "create"; readonly from: ApiRecentDestination }
  | { readonly mode: "delete"; readonly place: ApiSavedPlace };

type Notice = "created" | "updated" | "deleted";
export type SavedPlacesPanelState = PanelState;
export type SavedPlacesDraft = Draft;
export type SavedPlacesNotice = Notice;

const K = "rider.account.places.";

export function SavedPlacesPanel({
  language = MINIAPP_DEFAULT_LANGUAGE,
  api = savedPlacesApi,
  initial,
}: SavedPlacesPanelProps) {
  const t = miniAppTranslator(language);
  const labelId = useId();
  const kindName = useId();
  const mounted = useRef(true);
  const [state, setState] = useState<PanelState>(initial?.state ?? { kind: "reading" });
  const [draft, setDraft] = useState<Draft | null>(initial?.draft ?? null);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [kind, setKind] = useState<PlaceKind>(initial?.kind ?? "other");
  const [attempted, setAttempted] = useState(initial?.attempted ?? false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CapabilityFailure | null>(initial?.failure ?? null);
  const [notice, setNotice] = useState<Notice | null>(initial?.notice ?? null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState({ kind: "reading" });
    try {
      const listed = await api.list();
      let recent: Loaded["recent"];
      try {
        recent = { kind: "listed", list: (await api.recent()).destinations };
      } catch (thrown) {
        recent = classifyCapabilityFailure(thrown);
      }
      if (mounted.current) setState({ kind: "ready", loaded: { places: listed.places, recent } });
    } catch (thrown) {
      if (mounted.current) setState({ kind: "failed", failure: classifyCapabilityFailure(thrown) });
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (next: Draft) => {
    setDraft(next);
    setAttempted(false);
    setFailure(null);
    setNotice(null);
    if (next.mode === "edit") {
      setLabel(next.place.label);
      setKind(isPlaceKind(next.place.kind) ? next.place.kind : "other");
    } else if (next.mode === "create") {
      setLabel(next.from.label);
      setKind("other");
    }
  };

  const run = async (action: () => Promise<Notice>) => {
    setBusy(true);
    setFailure(null);
    try {
      const done = await action();
      if (!mounted.current) return;
      setDraft(null);
      setNotice(done);
      await load();
    } catch (thrown) {
      if (!mounted.current) return;
      setFailure(classifyCapabilityFailure(thrown));
      // مكانٌ لم يعُد موجوداً: القائمةُ تُقرأُ من جديدٍ فلا يبقى صفٌّ ميّت.
      if (failureCode(thrown) === "PLACE_NOT_FOUND") {
        setDraft(null);
        await load();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const submitDraft = () => {
    if (draft === null) return;
    if (draft.mode === "delete") {
      void run(async () => {
        await api.remove(draft.place.id);
        return "deleted";
      });
      return;
    }
    setAttempted(true);
    if (labelProblem(label) !== null) return;
    const body = { kind, label: label.trim() };
    if (draft.mode === "edit") {
      const { place } = draft;
      void run(async () => {
        await api.update(place.id, { ...body, lat: place.lat, lng: place.lng });
        return "updated";
      });
    } else {
      const { from } = draft;
      void run(async () => {
        const saved = await api.create({ ...body, lat: from.lat, lng: from.lng });
        return saved.status === "updated" ? "updated" : "created";
      });
    }
  };

  const failureBanner =
    failure === null ? null : failure.kind === "unavailable" ? (
      <UiBanner tone="amber" message={t(`${K}unavailable`)} />
    ) : (
      <UiBanner
        tone="bad"
        message={t(failure.kind === "session" ? `${K}session.body` : placeErrorKey(failure.code))}
      />
    );

  const editor = (places: readonly ApiSavedPlace[]) => {
    if (draft === null) return null;
    if (draft.mode === "delete") {
      return (
        <section className="rset__form" aria-label={t(`${K}delete.title`)}>
          <p className="sys__body">
            {t(`${K}delete.confirm`).replace("{label}", draft.place.label)}
          </p>
          {failureBanner}
          <div className="rset__actions">
            <UiButton variant="bad" loading={busy} onClick={submitDraft}>
              {t(`${K}delete.yes`)}
            </UiButton>
            <UiButton disabled={busy} onClick={() => setDraft(null)}>
              {t(`${K}cancel`)}
            </UiButton>
          </div>
        </section>
      );
    }
    const others = draft.mode === "edit" ? places.filter((p) => p.id !== draft.place.id) : places;
    const problem = attempted ? labelProblem(label) : null;
    return (
      <form
        className="rset__form"
        noValidate
        aria-label={t(draft.mode === "edit" ? `${K}edit.title` : `${K}create.title`)}
        onSubmit={(event) => {
          event.preventDefault();
          submitDraft();
        }}
      >
        <UiField
          id={labelId}
          label={t(`${K}label`)}
          value={label}
          maxLength={PLACE_LABEL_MAX}
          onChange={(event) => setLabel(event.target.value)}
          {...(problem === null ? {} : { error: t(`${K}problem.${problem}`) })}
        />
        <UiSegment
          name={kindName}
          label={t(`${K}kindLabel`)}
          options={PLACE_KINDS.map((value) => ({ value, label: t(placeKindKey(value)) }))}
          value={kind}
          onSelect={(value) => {
            if (isPlaceKind(value)) setKind(value);
          }}
        />
        {replacesExisting(kind, others) ? (
          <UiBanner
            tone="amber"
            message={t(`${K}replaces`).replace("{kind}", t(placeKindKey(kind)))}
          />
        ) : null}
        {failureBanner}
        <div className="rset__actions">
          <UiButton type="submit" variant="brand" loading={busy}>
            {t(busy ? `${K}saving` : `${K}save`)}
          </UiButton>
          <UiButton disabled={busy} onClick={() => setDraft(null)}>
            {t(`${K}cancel`)}
          </UiButton>
        </div>
      </form>
    );
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

    const { places, recent } = state.loaded;
    const candidates = recent.kind === "listed" ? unsavedRecent(recent.list, places) : [];
    return (
      <>
        {notice === null ? null : <UiToast tone="ok" message={t(`${K}notice.${notice}`)} />}
        {draft === null ? failureBanner : null}
        {places.length === 0 ? (
          <p className="sys__hint">{t(`${K}empty`)}</p>
        ) : (
          <ul className="rset__list" aria-label={t(`${K}listLabel`)}>
            {places.map((place) => (
              <li className="rset__item" key={place.id}>
                <UiTag tone="brand" label={t(placeKindKey(place.kind))} />
                <span className="rset__item-label">{place.label}</span>
                <UiButton
                  size="sm"
                  disabled={busy}
                  aria-label={t(`${K}edit.aria`).replace("{label}", place.label)}
                  onClick={() => open({ mode: "edit", place })}
                >
                  {t(`${K}edit.action`)}
                </UiButton>
                <UiButton
                  size="sm"
                  variant="bad"
                  disabled={busy}
                  aria-label={t(`${K}delete.aria`).replace("{label}", place.label)}
                  onClick={() => open({ mode: "delete", place })}
                >
                  {t(`${K}delete.action`)}
                </UiButton>
              </li>
            ))}
          </ul>
        )}
        {editor(places)}

        <h4 className="rset__subtitle">{t(`${K}recent.title`)}</h4>
        {recent.kind !== "listed" ? (
          recent.kind === "unavailable" ? (
            <UiBanner tone="amber" message={t(`${K}recent.unavailable`)} />
          ) : (
            <p className="sys__hint">{t(`${K}recent.error`)}</p>
          )
        ) : candidates.length === 0 ? (
          <p className="sys__hint">{t(`${K}recent.empty`)}</p>
        ) : (
          <ul className="rset__list" aria-label={t(`${K}recent.title`)}>
            {candidates.map((destination) => (
              <li
                className="rset__item"
                key={`${destination.label}:${destination.lat}:${destination.lng}`}
              >
                <span className="rset__item-label">{destination.label}</span>
                <UiButton
                  size="sm"
                  disabled={busy}
                  aria-label={t(`${K}create.aria`).replace("{label}", destination.label)}
                  onClick={() => open({ mode: "create", from: destination })}
                >
                  {t(`${K}create.action`)}
                </UiButton>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  };

  return <UiCard title={t(`${K}title`)}>{body()}</UiCard>;
}
