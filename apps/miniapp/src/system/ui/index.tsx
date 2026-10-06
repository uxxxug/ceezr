/**
 * الغرض: مكوّناتُ `ui-*` العرضيّةُ — تنفيذُ القسم 4 من الدليلِ المعتمدِ.
 * الحالة: منفّذ فعلياً — بندُ PR 1 في القسم 11 (مُصلَّبٌ بعدَ التدقيقِ · ADR 0233 «تصليبُ PR 1»).
 * ينتمي إلى: apps/miniapp/src/system/ui
 *
 * **عرضيٌّ صرفٌ:** لا حالةَ (`useState`) ولا طلبَ ولا مؤقّتَ ولا حافظةَ ولا
 * تخزين. كلُّ فعلٍ يُسلَّمُ إلى المستدعي بـcallback إلزاميٍّ، فلا زرَّ بلا فعلٍ.
 * الاستثناءُ الوحيدُ مُزامَنةُ `<dialog>` الأصيلِ مع خاصيّةِ `open`
 * (`showModal()`/`close()`) — وهي ما يمنحُ حبسَ التركيزِ وEscape وإعادةَ التركيزِ.
 *
 * **لا نصَّ مُضمَّنٌ:** كلُّ نصٍّ يراهُ المستخدمُ أو يسمعُه قارئُ الشاشةِ —
 * عنوانٌ، وسمُ زرٍّ، «إغلاق»، «رجوع»، حالةُ خطوةٍ — يأتي من المستدعي (من
 * القاموسِ). لا قيمةَ افتراضيّةَ نصّيّةَ ههنا؛ وحاجزُ `ui-components.test.tsx`
 * يُسقِطُ أيَّ حرفٍ عربيٍّ خارجَ التعليقاتِ.
 *
 * **CSS مسطّحٌ:** كلُّ قاعدةٍ في `global.css` بلا `@layer` ولا تداخلٍ ولا `!important`.
 * **أنماطُ الأصنافِ قابلةٌ للحلِّ ساكنةً:** كلُّ متغيّرٍ يُحَلُّ من جدولٍ حرفيٍّ
 * بخصيصةِ `modifier` (القاعدة ٣ في حاجزِ تغطيةِ الأصنافِ).
 */

import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  KeyboardEvent,
  ReactNode,
} from "react";
import { useEffect, useId, useRef } from "react";
import {
  IconAlert,
  IconCheck,
  IconChevron,
  IconClock,
  IconCopy,
  IconCross,
  IconEmpty,
  IconError,
  IconInfo,
  IconSpinner,
} from "./icons.tsx";

export type UiTone = "brand" | "amber" | "ok" | "bad";

// ─── جداولُ المتغيّراتِ الحرفيّةُ (modifier: "...") ─────────────────────────

const BTN_VARIANTS = [
  { variant: "neutral", modifier: "ui-btn--neutral" },
  { variant: "brand", modifier: "ui-btn--brand" },
  { variant: "amber", modifier: "ui-btn--amber" },
  { variant: "ok", modifier: "ui-btn--ok" },
  { variant: "bad", modifier: "ui-btn--bad" },
] as const;

const BTN_SIZES = [
  { size: "sm", modifier: "ui-btn--sm" },
  { size: "md", modifier: "ui-btn--md" },
  { size: "lg", modifier: "ui-btn--lg" },
] as const;

const SEGMENT_STATES = [
  { on: false, modifier: "ui-sg__item" },
  { on: true, modifier: "ui-sg__item ui-sg__item--on" },
] as const;

const CHIP_STATES = [
  { on: false, modifier: "ui-chip" },
  { on: true, modifier: "ui-chip ui-chip--on" },
] as const;

const TAB_STATES = [
  { on: false, modifier: "ui-tab__item" },
  { on: true, modifier: "ui-tab__item ui-tab__item--on" },
] as const;

const TAG_TONES = [
  { tone: "brand", modifier: "ui-tag--brand" },
  { tone: "amber", modifier: "ui-tag--amber" },
  { tone: "ok", modifier: "ui-tag--ok" },
  { tone: "bad", modifier: "ui-tag--bad" },
] as const;

const PILL_TONES = [
  { tone: "brand", modifier: "ui-pill--brand" },
  { tone: "amber", modifier: "ui-pill--amber" },
  { tone: "ok", modifier: "ui-pill--ok" },
  { tone: "bad", modifier: "ui-pill--bad" },
] as const;

const TRUTH_TONES = [
  { tone: "brand", modifier: "ui-truth--brand" },
  { tone: "amber", modifier: "ui-truth--amber" },
  { tone: "ok", modifier: "ui-truth--ok" },
  { tone: "bad", modifier: "ui-truth--bad" },
  { tone: "unknown", modifier: "ui-truth--unknown" },
] as const;

const RAIL_STATES = [
  { state: "done", modifier: "ui-rail__item--done" },
  { state: "current", modifier: "ui-rail__item--current" },
  { state: "pending", modifier: "ui-rail__item--pending" },
] as const;

const TIMER_TONES = [
  { tone: "neutral", modifier: "ui-timer--neutral" },
  { tone: "amber", modifier: "ui-timer--amber" },
  { tone: "bad", modifier: "ui-timer--bad" },
] as const;

const STEP_STATES = [
  { state: "done", modifier: "ui-stp__seg--done" },
  { state: "current", modifier: "ui-stp__seg--current" },
  { state: "pending", modifier: "ui-stp__seg--pending" },
] as const;

const SKEL_LINES = [
  { id: "skel-1", modifier: "ui-skel__line" },
  { id: "skel-2", modifier: "ui-skel__line" },
  { id: "skel-3", modifier: "ui-skel__line ui-skel__line--short" },
] as const;

const ERR_TONES = [
  { tone: "bad", modifier: "ui-err--bad" },
  { tone: "amber", modifier: "ui-err--amber" },
] as const;

const TOAST_TONES = [
  { tone: "brand", modifier: "ui-toast--brand" },
  { tone: "amber", modifier: "ui-toast--amber" },
  { tone: "ok", modifier: "ui-toast--ok" },
  { tone: "bad", modifier: "ui-toast--bad" },
] as const;

const BANNER_TONES = [
  { tone: "brand", modifier: "ui-banner--brand" },
  { tone: "amber", modifier: "ui-banner--amber" },
  { tone: "ok", modifier: "ui-banner--ok" },
  { tone: "bad", modifier: "ui-banner--bad" },
] as const;

const STATUS_TONES = [
  { tone: "brand", modifier: "ui-st--brand" },
  { tone: "amber", modifier: "ui-st--amber" },
  { tone: "ok", modifier: "ui-st--ok" },
  { tone: "bad", modifier: "ui-st--bad" },
] as const;

/** أيقونةُ كلِّ نغمةٍ — «كلُّ حالةٍ لها نصٌّ + أيقونةٌ» (§2)، فلا يحملُ اللونُ المعنى وحدَه. */
function ToneIcon({ tone }: { readonly tone: UiTone }) {
  if (tone === "ok") return <IconCheck />;
  if (tone === "bad") return <IconError />;
  if (tone === "amber") return <IconAlert />;
  return <IconInfo />;
}

// ─── ui-btn ────────────────────────────────────────────────────────────────

export interface UiButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "className" | "type" | "aria-busy" | "aria-disabled" | "onClick"
  > {
  readonly onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
  readonly type?: "button" | "submit";
  readonly variant?: "neutral" | UiTone;
  readonly size?: "sm" | "md" | "lg";
  readonly icon?: ReactNode;
  /**
   * أثناءَ الانتظار: `aria-busy` و`aria-disabled` لا `disabled` — فلا يُطرَدُ
   * التركيزُ من زرٍّ ضغطَه المستخدمُ للتوِّ، ويُبتلَعُ الضغطُ المكرَّرُ.
   */
  readonly loading?: boolean;
}

export function UiButton({
  variant = "neutral",
  size = "md",
  type = "button",
  icon,
  loading = false,
  children,
  onClick,
  ...rest
}: UiButtonProps) {
  const v = BTN_VARIANTS.find((x) => x.variant === variant) ?? BTN_VARIANTS[0];
  const s = BTN_SIZES.find((x) => x.size === size) ?? BTN_SIZES[1];
  return (
    <button
      {...rest}
      type={type}
      className={`ui-btn ${v.modifier} ${s.modifier}`}
      aria-busy={loading ? true : undefined}
      aria-disabled={loading ? true : undefined}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {loading ? (
        <IconSpinner className="ui-btn__spinner" />
      ) : icon !== undefined ? (
        <span className="ui-btn__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}

// ─── ui-fld ────────────────────────────────────────────────────────────────

export interface UiFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "className" | "id" | "aria-invalid" | "aria-describedby"
  > {
  /** إلزاميٌّ: بلا مُعرِّفٍ لا يرتبطُ الوسمُ بالحقلِ ولا التلميحُ ولا الخطأُ. */
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
}

export function UiField({ id, label, hint, error, ...rest }: UiFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [hint !== undefined ? hintId : null, error !== undefined ? errorId : null]
    .filter((x): x is string => x !== null)
    .join(" ");
  return (
    <div className="ui-fld">
      <label className="ui-fld__label" htmlFor={id}>
        {label}
      </label>
      <input
        {...rest}
        className="ui-fld__input"
        id={id}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={described.length > 0 ? described : undefined}
      />
      {hint !== undefined ? (
        <p className="ui-fld__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p className="ui-fld__error" id={errorId} role="alert">
          <IconError className="ui-fld__error-icon" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ─── ui-tile ───────────────────────────────────────────────────────────────

export interface UiTileProps {
  readonly title: string;
  readonly value: string;
  readonly icon?: ReactNode;
}

export function UiTile({ title, value, icon }: UiTileProps) {
  return (
    <div className="ui-tile">
      {icon !== undefined ? (
        <span className="ui-tile__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="ui-tile__value">{value}</span>
      <span className="ui-tile__title">{title}</span>
    </div>
  );
}

// ─── ui-sg (segmented control) ─────────────────────────────────────────────

export interface UiSegmentProps {
  /** اسمُ مجموعةِ الراديو — فريدٌ في الصفحةِ؛ لا يُشتقُّ من نصٍّ مرئيٍّ. */
  readonly name: string;
  readonly label: string;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly value: string;
  readonly onSelect: (value: string) => void;
}

/** راديو أصيلٌ: الأسهمُ والمسافةُ وTab تعملُ من المتصفِّحِ، والوسمُ يلفُّ الحقلَ. */
export function UiSegment({ name, label, options, value, onSelect }: UiSegmentProps) {
  return (
    <div className="ui-sg" role="radiogroup" aria-label={label}>
      {options.map((opt) => {
        const state =
          SEGMENT_STATES.find((x) => x.on === (opt.value === value)) ?? SEGMENT_STATES[0];
        return (
          <label key={opt.value} className={state.modifier}>
            <input
              type="radio"
              className="ui-sg__radio"
              name={name}
              value={opt.value}
              checked={opt.value === value}
              onChange={() => onSelect(opt.value)}
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}

// ─── ui-chip ───────────────────────────────────────────────────────────────

export interface UiChipProps {
  readonly label: string;
  readonly selected: boolean;
  /** إلزاميٌّ: رقاقةٌ بـ`aria-pressed` بلا فعلٍ تفاعلٌ وهميٌّ. */
  readonly onToggle: () => void;
}

export function UiChip({ label, selected, onToggle }: UiChipProps) {
  const state = CHIP_STATES.find((x) => x.on === selected) ?? CHIP_STATES[0];
  return (
    <button type="button" className={state.modifier} aria-pressed={selected} onClick={onToggle}>
      {label}
    </button>
  );
}

// ─── ui-tag ────────────────────────────────────────────────────────────────

export interface UiTagProps {
  readonly label: string;
  readonly tone: UiTone;
}

export function UiTag({ label, tone }: UiTagProps) {
  const t = TAG_TONES.find((x) => x.tone === tone) ?? TAG_TONES[0];
  return <span className={`ui-tag ${t.modifier}`}>{label}</span>;
}

// ─── ui-pill ───────────────────────────────────────────────────────────────

export interface UiPillProps {
  readonly label: string;
  readonly tone: UiTone;
  readonly icon?: ReactNode;
}

export function UiPill({ label, tone, icon }: UiPillProps) {
  const t = PILL_TONES.find((x) => x.tone === tone) ?? PILL_TONES[0];
  return (
    <span className={`ui-pill ${t.modifier}`}>
      {icon !== undefined ? (
        <span className="ui-pill__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {label}
    </span>
  );
}

// ─── ui-card ───────────────────────────────────────────────────────────────

export interface UiCardProps {
  readonly children: ReactNode;
  readonly title?: string;
  readonly action?: ReactNode;
}

export function UiCard({ children, title, action }: UiCardProps) {
  const titleId = useId();
  return (
    <section className="ui-card" aria-labelledby={title !== undefined ? titleId : undefined}>
      {title !== undefined || action !== undefined ? (
        <div className="ui-card__head">
          {title !== undefined ? (
            <h3 className="ui-card__title" id={titleId}>
              {title}
            </h3>
          ) : null}
          {action !== undefined ? <div className="ui-card__action">{action}</div> : null}
        </div>
      ) : null}
      <div className="ui-card__body">{children}</div>
    </section>
  );
}

// ─── ui-row ────────────────────────────────────────────────────────────────

export interface UiRowProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly icon?: ReactNode;
}

export function UiRow({ label, value, icon }: UiRowProps) {
  return (
    <div className="ui-row">
      {icon !== undefined ? (
        <span className="ui-row__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="ui-row__label">{label}</span>
      <span className="ui-row__value">{value}</span>
    </div>
  );
}

// ─── ui-kv (key-value) ─────────────────────────────────────────────────────

export interface UiKvProps {
  readonly k: string;
  readonly v: ReactNode;
}

export function UiKv({ k, v }: UiKvProps) {
  return (
    <dl className="ui-kv">
      <dt className="ui-kv__k">{k}</dt>
      <dd className="ui-kv__v">{v}</dd>
    </dl>
  );
}

// ─── ui-truth (شريطُ الحقيقة · §10.1 · يُربَطُ بالمنتجِ في PR 4) ───────────

export interface UiTruthProps {
  /** جملةُ الحقيقةِ الحاليّةُ كما يصوغُها المستدعي من حالةٍ مقيسةٍ. */
  readonly text: string;
  /** `unknown` = الصمتُ المُصمَّمُ (§10.9): المجهولُ يُقالُ مجهولاً بنغمةٍ محايدةٍ. */
  readonly tone: UiTone | "unknown";
}

/** شريطٌ واحدٌ يتبدّلُ نصُّه فيُعلَنُ بأدبٍ (`<output>` = role=status). */
export function UiTruth({ text, tone }: UiTruthProps) {
  const t = TRUTH_TONES.find((x) => x.tone === tone) ?? TRUTH_TONES[4];
  return (
    <output className={`ui-truth ${t.modifier}`}>
      <span className="ui-truth__icon" aria-hidden="true">
        {tone === "unknown" ? <IconInfo /> : <ToneIcon tone={tone} />}
      </span>
      <span className="ui-truth__text">{text}</span>
    </output>
  );
}

// ─── ui-rail (السكّة) ───────────────────────────────────────────────────────

export type UiRailState = "done" | "current" | "pending";

export interface UiRailProps {
  readonly label: string;
  readonly steps: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly state: UiRailState;
  }>;
  /** نصُّ الحالةِ لقارئِ الشاشةِ — كي لا تُقالَ «تمّت/التالية» باللونِ وحدَه. */
  readonly stateText: Readonly<Record<UiRailState, string>>;
}

export function UiRail({ label, steps, stateText }: UiRailProps) {
  return (
    <ol className="ui-rail" aria-label={label}>
      {steps.map((step, position) => {
        const s = RAIL_STATES.find((x) => x.state === step.state) ?? RAIL_STATES[2];
        return (
          <li
            key={step.id}
            className={`ui-rail__item ${s.modifier}`}
            aria-current={step.state === "current" ? "step" : undefined}
          >
            <span className="ui-rail__dot" aria-hidden="true">
              {step.state === "done" ? <IconCheck className="ui-rail__check" /> : position + 1}
            </span>
            <span className="ui-rail__label">{step.label}</span>
            <span className="ui-rail__state">{stateText[step.state]}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ─── ui-timer (مؤقّتُ CSS · §11 PR 6) ───────────────────────────────────────

export interface UiTimerProps {
  /** اسمُ المهلةِ، كـ«مهلةُ العرض». */
  readonly label: string;
  /** الموعدُ المطلقُ مصوغاً من المستدعي، كـ«حتى ٣:٤١» — لا يتقادمُ بعدَ الرسم. */
  readonly deadlineText: string;
  readonly remainingSeconds: number;
  readonly totalSeconds: number;
  readonly tone: "neutral" | "amber" | "bad";
}

/** نسبةُ المتبقّي في [0، 1]؛ والمدخلاتُ غيرُ الصالحةِ تُعطي 0 لا قيمةً مختلَقةً. */
export function timerRatio(remainingSeconds: number, totalSeconds: number): number {
  if (!Number.isFinite(remainingSeconds) || !Number.isFinite(totalSeconds)) return 0;
  if (totalSeconds <= 0 || remainingSeconds <= 0) return 0;
  return Math.min(1, remainingSeconds / totalSeconds);
}

/**
 * لا `setInterval` (§9): الشريطُ يُفرَغُ بحركةِ CSS من النسبةِ الحاليّةِ إلى الصفرِ
 * خلالَ المتبقّي، والنصُّ موعدٌ مطلقٌ لا عدٌّ تنازليٌّ يتجمّدُ.
 */
export function UiTimer({
  label,
  deadlineText,
  remainingSeconds,
  totalSeconds,
  tone,
}: UiTimerProps) {
  const labelId = useId();
  const textId = useId();
  const t = TIMER_TONES.find((x) => x.tone === tone) ?? TIMER_TONES[0];
  const ratio = timerRatio(remainingSeconds, totalSeconds);
  const seconds = ratio === 0 ? 0 : Math.ceil(remainingSeconds);
  const fill = {
    "--ui-timer-start": String(ratio),
    "--ui-timer-duration": `${seconds}s`,
  } as CSSProperties;
  return (
    <div className={`ui-timer ${t.modifier}`} role="timer" aria-labelledby={`${labelId} ${textId}`}>
      <span className="ui-timer__label" id={labelId}>
        {label}
      </span>
      <span className="ui-timer__text" id={textId}>
        <IconClock className="ui-timer__icon" />
        {deadlineText}
      </span>
      <span className="ui-timer__track" aria-hidden="true">
        <span className="ui-timer__fill" style={fill} />
      </span>
    </div>
  );
}

// ─── ui-stp (مؤشّرُ خطواتِ تدفّقٍ) ──────────────────────────────────────────

export interface UiStepperProps {
  /** رقمُ الخطوةِ الحاليّةِ، يبدأُ من 1. */
  readonly current: number;
  readonly total: number;
  /** نصُّ الموضعِ من القاموسِ، كـ«الخطوة ٢ من ٣» — لا يُركَّبُ ههنا. */
  readonly text: string;
}

/** حالةُ قطعةٍ في المؤشّرِ — نقيّةٌ ومُختبَرةٌ. */
export function stepState(position: number, current: number): "done" | "current" | "pending" {
  if (position < current) return "done";
  if (position === current) return "current";
  return "pending";
}

/**
 * مؤشّرٌ لا مُتحكِّمٌ: التقدّمُ بينَ الخطواتِ فعلُ الشاشةِ (زرُّها الأساسيُّ)،
 * فلا زرَّ «زيادة/إنقاص» ههنا بلا callback. القطعُ زخرفةٌ مخفيّةٌ، والنصُّ هو المعنى.
 */
export function UiStepper({ current, total, text }: UiStepperProps) {
  const count = Number.isFinite(total) && total >= 1 ? Math.floor(total) : 0;
  const positions = Array.from({ length: count }, (_, i) => i + 1);
  return (
    <div className="ui-stp">
      <span className="ui-stp__track" aria-hidden="true">
        {positions.map((n) => {
          const s = STEP_STATES.find((x) => x.state === stepState(n, current)) ?? STEP_STATES[2];
          return <span key={n} className={`ui-stp__seg ${s.modifier}`} />;
        })}
      </span>
      <p className="ui-stp__text">{text}</p>
    </div>
  );
}

// ─── ui-sht / ui-dg — `<dialog>` أصيلٌ ───────────────────────────────────────

/** ما يلزمُ من `HTMLDialogElement` — أصغرُ واجهةٍ تُختبَرُ بلا DOM. */
export interface ModalElement {
  readonly open: boolean;
  showModal?: () => void;
  close?: () => void;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * يُزامِنُ `<dialog>` مع `open`: `showModal()` يحبسُ التركيزَ ويجعلُ ما خلفَه
 * خاملاً ويُغلِقُ بـEscape، و`close()` يُعيدُ التركيزَ إلى ما فتحَه. ومتصفّحٌ بلا
 * `showModal` يُفتَحُ فيه الحوارُ بالخاصيّةِ — ظاهراً لا مفقوداً.
 */
export function syncModal(el: ModalElement, open: boolean): void {
  if (open && !el.open) {
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
  } else if (!open && el.open) {
    if (typeof el.close === "function") el.close();
    else el.removeAttribute("open");
  }
}

/**
 * Escape يُطلِقُ `cancel`: يُمنَعُ الإغلاقُ الأصيلُ ويُسلَّمُ القرارُ للمستدعي،
 * فتبقى `open` مصدرَ الحقيقةِ الوحيدَ ولا يختلفُ DOM عن الحالة.
 */
export function cancelToClose(onClose: () => void) {
  return (event: { preventDefault(): void }) => {
    event.preventDefault();
    onClose();
  };
}

function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (ref.current !== null) syncModal(ref.current, open);
  }, [open]);
  return ref;
}

export interface UiSheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function UiSheet({ open, title, closeLabel, onClose, children }: UiSheetProps) {
  const ref = useModal(open);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      className="ui-sht"
      aria-labelledby={titleId}
      onCancel={cancelToClose(onClose)}
    >
      <div className="ui-sht__head">
        <h2 className="ui-sht__title" id={titleId}>
          {title}
        </h2>
        <button type="button" className="ui-sht__close" aria-label={closeLabel} onClick={onClose}>
          <IconCross />
        </button>
      </div>
      <div className="ui-sht__body">{children}</div>
    </dialog>
  );
}

export interface UiDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}

export function UiDialog({ open, title, closeLabel, onClose, children, actions }: UiDialogProps) {
  const ref = useModal(open);
  const titleId = useId();
  return (
    <dialog ref={ref} className="ui-dg" aria-labelledby={titleId} onCancel={cancelToClose(onClose)}>
      <div className="ui-dg__head">
        <h2 className="ui-dg__title" id={titleId}>
          {title}
        </h2>
        <button type="button" className="ui-dg__close" aria-label={closeLabel} onClick={onClose}>
          <IconCross />
        </button>
      </div>
      <div className="ui-dg__body">{children}</div>
      {actions !== undefined ? <div className="ui-dg__actions">{actions}</div> : null}
    </dialog>
  );
}

// ─── ui-tab (تبويبٌ داخلَ الصفحةِ · WAI-ARIA Tabs) ──────────────────────────

/**
 * موضعُ التبويبِ التالي لمفتاحٍ: الأسهمُ تتبعُ الاتّجاهَ (في RTL السهمُ الأيمنُ
 * يعودُ إلى السابقِ)، وHome/End للطرفين، ويلتفُّ. `null` = مفتاحٌ لا يخصُّ التبويب.
 */
export function tabKeyTarget(
  index: number,
  count: number,
  key: string,
  rtl: boolean,
): number | null {
  if (count <= 0) return null;
  const forward = rtl ? "ArrowLeft" : "ArrowRight";
  const backward = rtl ? "ArrowRight" : "ArrowLeft";
  if (key === forward) return (index + 1) % count;
  if (key === backward) return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export interface UiTabProps {
  readonly label: string;
  /** `id` معرّفُ زرِّ التبويبِ في الصفحةِ، و`panelId` معرّفُ لوحتِه (`UiTabPanel`). */
  readonly tabs: ReadonlyArray<{
    readonly id: string;
    readonly panelId: string;
    readonly label: string;
  }>;
  readonly active: string;
  readonly onSelect: (id: string) => void;
}

/** تركيزٌ متجوّلٌ: التبويبُ النشطُ وحدَه في ترتيبِ Tab، والأسهمُ تنقلُ وتُفعِّلُ. */
export function UiTab({ label, tabs, active, onSelect }: UiTabProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const target = tabKeyTarget(index, tabs.length, event.key, rtl);
    const next = target === null ? undefined : tabs[target];
    if (next === undefined) return;
    event.preventDefault();
    const list = event.currentTarget.parentElement;
    const button = list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target ?? 0];
    button?.focus();
    onSelect(next.id);
  };
  return (
    <div className="ui-tab" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const on = tab.id === active;
        const state = TAB_STATES.find((x) => x.on === on) ?? TAB_STATES[0];
        return (
          <button
            key={tab.id}
            id={tab.id}
            type="button"
            role="tab"
            className={state.modifier}
            aria-selected={on}
            aria-controls={tab.panelId}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export interface UiTabPanelProps {
  readonly id: string;
  readonly tabId: string;
  readonly active: boolean;
  readonly children: ReactNode;
}

/** لا `tabIndex`: محتوى اللوحةِ يحملُ عناصرَه القابلةَ للتركيزِ، وTab يبلغُها مباشرةً. */
export function UiTabPanel({ id, tabId, active, children }: UiTabPanelProps) {
  return (
    <div className="ui-tab__panel" role="tabpanel" id={id} aria-labelledby={tabId} hidden={!active}>
      {children}
    </div>
  );
}

// ─── ui-act (شريطُ أفعالِ التدفّقِ · §6) ────────────────────────────────────

export interface UiActionBarProps {
  readonly children: ReactNode;
}

/** حاويةُ أفعالٍ لا معلمُ تنقّلٍ: الأزرارُ أفعالٌ، فلا `<nav>`. */
export function UiActionBar({ children }: UiActionBarProps) {
  return <div className="ui-act">{children}</div>;
}

// ─── ui-hdr (header) ────────────────────────────────────────────────────────

export interface UiHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  /** زرُّ الرجوعِ يُرسَمُ فقط حين يمرُّ فعلُه ووسمُه معاً. */
  readonly back?: { readonly label: string; readonly onBack: () => void };
  readonly action?: ReactNode;
}

export function UiHeader({ title, subtitle, back, action }: UiHeaderProps) {
  return (
    <header className="ui-hdr">
      {back !== undefined ? (
        <button
          type="button"
          className="ui-hdr__back"
          aria-label={back.label}
          onClick={back.onBack}
        >
          <IconChevron className="ui-hdr__back-icon" />
        </button>
      ) : null}
      <div className="ui-hdr__text">
        <h1 className="ui-hdr__title">{title}</h1>
        {subtitle !== undefined ? <p className="ui-hdr__subtitle">{subtitle}</p> : null}
      </div>
      {action !== undefined ? <div className="ui-hdr__action">{action}</div> : null}
    </header>
  );
}

// ─── ui-skel (Loading · §5) ─────────────────────────────────────────────────

export interface UiSkeletonProps {
  /** ما يُحمَّلُ، لقارئِ الشاشةِ. */
  readonly label: string;
  readonly lines?: 1 | 2 | 3;
}

export function UiSkeleton({ label, lines = 3 }: UiSkeletonProps) {
  return (
    <div className="ui-skel" role="status" aria-busy="true" aria-label={label}>
      {SKEL_LINES.slice(0, lines).map((item) => (
        <span key={item.id} className={item.modifier} aria-hidden="true" />
      ))}
    </div>
  );
}

// ─── ui-empty (Empty · §5) ──────────────────────────────────────────────────

export interface UiEmptyProps {
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
}

/** حالةٌ ساكنةٌ تُقرأُ بالتصفّحِ — لا منطقةَ حيّةً تُقاطِعُ المستخدمَ. */
export function UiEmpty({ title, body, action }: UiEmptyProps) {
  const titleId = useId();
  return (
    <section className="ui-empty" aria-labelledby={titleId}>
      <IconEmpty className="ui-empty__icon" />
      <h2 className="ui-empty__title" id={titleId}>
        {title}
      </h2>
      <p className="ui-empty__body">{body}</p>
      {action !== undefined ? <div className="ui-empty__action">{action}</div> : null}
    </section>
  );
}

// ─── ui-err (Error · §5) ────────────────────────────────────────────────────

export interface UiErrorProps {
  readonly title: string;
  readonly body: string;
  readonly tone: "bad" | "amber";
  readonly action?: ReactNode;
}

export function UiError({ title, body, tone, action }: UiErrorProps) {
  const t = ERR_TONES.find((x) => x.tone === tone) ?? ERR_TONES[0];
  return (
    <div className={`ui-err ${t.modifier}`} role="alert">
      <span className="ui-err__badge" aria-hidden="true">
        {tone === "amber" ? (
          <IconAlert className="ui-err__icon" />
        ) : (
          <IconError className="ui-err__icon" />
        )}
      </span>
      <h2 className="ui-err__title">{title}</h2>
      <p className="ui-err__body">{body}</p>
      {action !== undefined ? <div className="ui-err__action">{action}</div> : null}
    </div>
  );
}

// ─── ui-toast ───────────────────────────────────────────────────────────────

export interface UiToastProps {
  readonly message: string;
  readonly tone: UiTone;
  /** زرُّ الإغلاقِ يُرسَمُ فقط حين يمرُّ فعلُه ووسمُه معاً. */
  readonly dismiss?: { readonly label: string; readonly onDismiss: () => void };
}

/** `<output>` = role=status: يُعلَنُ بأدبٍ دونَ `aria-live` مكرَّرٍ. */
export function UiToast({ message, tone, dismiss }: UiToastProps) {
  const t = TOAST_TONES.find((x) => x.tone === tone) ?? TOAST_TONES[0];
  return (
    <output className={`ui-toast ${t.modifier}`}>
      <span className="ui-toast__icon" aria-hidden="true">
        <ToneIcon tone={tone} />
      </span>
      <span className="ui-toast__msg">{message}</span>
      {dismiss !== undefined ? (
        <button
          type="button"
          className="ui-toast__close"
          aria-label={dismiss.label}
          onClick={dismiss.onDismiss}
        >
          <IconCross />
        </button>
      ) : null}
    </output>
  );
}

// ─── ui-banner ──────────────────────────────────────────────────────────────

export interface UiBannerProps {
  readonly message: string;
  readonly tone: UiTone;
  readonly action?: ReactNode;
}

/** لافتةٌ ساكنةٌ (حالةُ سياقٍ)، لا منطقةَ حيّةً — الإعلانُ عملُ `ui-toast`/`ui-truth`. */
export function UiBanner({ message, tone, action }: UiBannerProps) {
  const t = BANNER_TONES.find((x) => x.tone === tone) ?? BANNER_TONES[0];
  return (
    <div className={`ui-banner ${t.modifier}`}>
      <span className="ui-banner__icon" aria-hidden="true">
        <ToneIcon tone={tone} />
      </span>
      <span className="ui-banner__msg">{message}</span>
      {action !== undefined ? <div className="ui-banner__action">{action}</div> : null}
    </div>
  );
}

// ─── ui-av (avatar) ────────────────────────────────────────────────────────

export interface UiAvatarProps {
  readonly name: string;
  readonly src?: string;
}

/** أوّلُ محرفٍ مرئيٍّ (لا نصفُ زوجٍ بديلٍ)، أو فراغٌ لاسمٍ فارغٍ. */
export function avatarInitial(name: string): string {
  return Array.from(name.trim())[0] ?? "";
}

/** اسمٌ واحدٌ يُقرأُ مرّةً: `alt` للصورةِ، أو `role=img` للحرفِ — لا كلاهما. */
export function UiAvatar({ name, src }: UiAvatarProps) {
  if (src !== undefined) {
    return (
      <span className="ui-av">
        <img className="ui-av__img" src={src} alt={name} width={40} height={40} />
      </span>
    );
  }
  const initial = avatarInitial(name);
  if (initial === "") return <span className="ui-av" aria-hidden="true" />;
  return (
    <span className="ui-av" role="img" aria-label={name}>
      <span className="ui-av__initial" aria-hidden="true">
        {initial}
      </span>
    </span>
  );
}

// ─── ui-pl (placeholder) ────────────────────────────────────────────────────

export interface UiPlaceholderProps {
  readonly label: string;
  readonly icon?: ReactNode;
}

export function UiPlaceholder({ label, icon }: UiPlaceholderProps) {
  return (
    <div className="ui-pl">
      {icon !== undefined ? (
        <span className="ui-pl__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="ui-pl__label">{label}</span>
    </div>
  );
}

// ─── ui-st (status indicator) ───────────────────────────────────────────────

export interface UiStatusProps {
  readonly label: string;
  readonly tone: UiTone;
}

/** شارةُ حالةٍ ساكنةٌ — لا `role=status` (منطقةٌ حيّةٌ لكلِّ شارةٍ ضجيجٌ). */
export function UiStatus({ label, tone }: UiStatusProps) {
  const t = STATUS_TONES.find((x) => x.tone === tone) ?? STATUS_TONES[0];
  return (
    <span className={`ui-st ${t.modifier}`}>
      <span className="ui-st__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

// ─── ui-ds (divider) ────────────────────────────────────────────────────────

export interface UiDividerProps {
  readonly label?: string;
}

export function UiDivider({ label }: UiDividerProps) {
  if (label === undefined) return <hr className="ui-ds" />;
  return (
    <div className="ui-ds ui-ds--labeled">
      <span className="ui-ds__line" aria-hidden="true" />
      <span className="ui-ds__label">{label}</span>
      <span className="ui-ds__line" aria-hidden="true" />
    </div>
  );
}

// ─── ui-pg (progress) ───────────────────────────────────────────────────────

export interface UiProgressProps {
  readonly value: number;
  readonly max: number;
  readonly label: string;
}

/** القيمةُ مقصورةٌ على [0، max]؛ والحدُّ غيرُ الصالحِ يُعطي 0 من 1 لا نسبةً مختلَقةً. */
export function progressBounds(value: number, max: number): { value: number; max: number } {
  if (!Number.isFinite(max) || max <= 0) return { value: 0, max: 1 };
  if (!Number.isFinite(value)) return { value: 0, max };
  return { value: Math.min(max, Math.max(0, value)), max };
}

/** `<progress>` أصيلٌ يُرسَمُ بأشباهِ عناصرِه — لا محتوى بديلٌ ميّتٌ ولا نمطٌ مُضمَّن. */
export function UiProgress({ value, max, label }: UiProgressProps) {
  const b = progressBounds(value, max);
  return <progress className="ui-pg" value={b.value} max={b.max} aria-label={label} />;
}

// ─── ui-copy (copy button) ──────────────────────────────────────────────────

export interface UiCopyProps {
  readonly text: string;
  readonly label: string;
  /** النسخُ نفسُه (الحافظةُ) أثرٌ جانبيٌّ للمستدعي، لا للمكوّنِ. */
  readonly onCopy: () => void;
}

/** الاسمُ = الوسمُ + النصُّ المنسوخُ؛ لا `aria-label` يُخفي القيمةَ عن قارئِ الشاشةِ. */
export function UiCopy({ text, label, onCopy }: UiCopyProps) {
  return (
    <button type="button" className="ui-copy" onClick={onCopy}>
      <IconCopy className="ui-copy__icon" />
      <span className="ui-copy__label">{label}</span>
      <span className="ui-copy__text" dir="auto">
        {text}
      </span>
    </button>
  );
}
