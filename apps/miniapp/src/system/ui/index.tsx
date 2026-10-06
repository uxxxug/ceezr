/**
 * الغرض: مكوّناتُ `ui-*` العرضيّةُ الصرفةُ — تنفيذُ القسم 4 من الدليلِ المعتمدِ.
 *   كلُّ مكوّنٍ هنا React عرضيٌّ صرفٌ: لا حالةَ ولا أثرٌ جانبيٌّ، عناصرُ دلاليّةٌ
 *   (button, a, input) لا div، و`aria-label` لكلِّ أيقونةٍ، وتركيزٌ ظاهرٌ دائمًا.
 * الحالة: منفّذ فعلياً — بندُ PR 1 في القسم 11.
 * ينتمي إلى: apps/miniapp/src/system/ui
 *
 * **الكتلُ المسجَّلةٌ في `DECLARED_BLOCKS`:** `ui-btn` `ui-fld` `ui-tile` `ui-sg`
 * `ui-chip` `ui-tag` `ui-pill` `ui-card` `ui-row` `ui-kv` `ui-truth` `ui-rail`
 * `ui-timer` `ui-stp` `ui-sht` `ui-dg` `ui-tab` `ui-act` `ui-hdr` `ui-skel`
 * `ui-empty` `ui-err` `ui-toast` `ui-banner` `ui-av` `ui-pl` `ui-st` `ui-ds`
 * `ui-pg` `ui-copy`
 *
 * **لا تُخترَعُ حالةٌ ولا بياناتٌ ولا نصوصٌ:** المكوّناتُ تستقبلُ كلَّ نصٍّ وكلِّ
 * حالةٍ من الخارج. لا تُولِّدُ قيمةً ولا تُختلقُ عرضًا.
 *
 * **CSS مسطّحٌ:** كلُّ قاعدةٍ في `global.css` بلا `@layer` ولا تداخلٍ ولا `!important`.
 * خصائصُ منطقيّةٌ (inline-start, block-start…) لاحترامِ RTL.
 *
 * **أنماطُ الأصنافِ قابلةٌ للحلِّ ساكنةً:** كلُّ متغيّرِ نغمةٍ (tone) يُحَلُّ من
 * جدولٍ حرفيٍّ بخصيصَةِ `modifier` — كنمطِ `Skeleton.tsx` — كي يقرأَ حاجزُ
 * تغطيةِ الأصنافِ كلَّ ما يُصدَرُ ولا يَعبرَ تعبيرٌ مبهمٌ (القاعدة ٣).
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import {
  IconAlert,
  IconCheck,
  IconChevron,
  IconClock,
  IconCopy,
  IconCross,
  IconEmpty,
  IconError,
  IconSpinner,
} from "./icons.tsx";

// ─── جداولُ النغماتِ الحرفيّةُ (modifier: "...") ────────────────────────────
// كلُّ قيمةٍ تُقرأُ ساكنةً من `tableLiterals` في حاجزِ التغطيةِ (القاعدة ٣).

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

const ERR_TONES = [
  { tone: "bad", modifier: "ui-err--bad" },
  { tone: "amber", modifier: "ui-err--amber" },
] as const;

const TOAST_TONES = [
  { tone: "brand", modifier: "ui-toast--brand" },
  { tone: "ok", modifier: "ui-toast--ok" },
  { tone: "bad", modifier: "ui-toast--bad" },
  { tone: "amber", modifier: "ui-toast--amber" },
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

// ─── ui-btn ────────────────────────────────────────────────────────────────

export interface UiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "brand" | "amber" | "ok" | "bad" | "neutral";
  readonly size?: "sm" | "md" | "lg";
  readonly icon?: ReactNode;
  readonly loading?: boolean;
}

export function UiButton({
  variant = "neutral",
  size = "md",
  icon,
  loading = false,
  children,
  disabled,
  ...rest
}: UiButtonProps) {
  const v = BTN_VARIANTS.find((x) => x.variant === variant) ?? BTN_VARIANTS[0];
  const s = BTN_SIZES.find((x) => x.size === size) ?? BTN_SIZES[1];
  return (
    <button
      type="button"
      className={`ui-btn ${v.modifier} ${s.modifier}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <IconSpinner className="ui-btn__icon" label="جارٍ" /> : icon}
      {children}
    </button>
  );
}

// ─── ui-fld ────────────────────────────────────────────────────────────────

export interface UiFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
}

export function UiField({ label, hint, error, id, ...rest }: UiFieldProps) {
  const fieldId = id ?? rest.name;
  return (
    <div className="ui-fld">
      <label className="ui-fld__label" htmlFor={fieldId}>
        {label}
      </label>
      <input className="ui-fld__input" id={fieldId} aria-invalid={error !== undefined} {...rest} />
      {error !== undefined ? (
        <p className="ui-fld__error" role="alert">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p className="ui-fld__hint">{hint}</p>
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
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly value: string;
  readonly onSelect: (value: string) => void;
  readonly label: string;
}

export function UiSegment({ options, value, onSelect, label }: UiSegmentProps) {
  return (
    <div className="ui-sg" role="radiogroup" aria-label={label}>
      {options.map((opt) => (
        <label
          key={opt.value}
          className={`ui-sg__item${opt.value === value ? " ui-sg__item--on" : ""}`}
        >
          <input
            type="radio"
            className="ui-sg__radio"
            name={label}
            value={opt.value}
            checked={opt.value === value}
            onChange={() => onSelect(opt.value)}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

// ─── ui-chip ───────────────────────────────────────────────────────────────

export interface UiChipProps {
  readonly label: string;
  readonly selected?: boolean;
  readonly onSelect?: () => void;
}

export function UiChip({ label, selected = false, onSelect }: UiChipProps) {
  return (
    <button
      type="button"
      className={`ui-chip${selected ? " ui-chip--on" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

// ─── ui-tag ────────────────────────────────────────────────────────────────

export interface UiTagProps {
  readonly label: string;
  readonly tone?: "brand" | "amber" | "ok" | "bad";
}

export function UiTag({ label, tone = "brand" }: UiTagProps) {
  const t = TAG_TONES.find((x) => x.tone === tone) ?? TAG_TONES[0];
  return <span className={`ui-tag ${t.modifier}`}>{label}</span>;
}

// ─── ui-pill ───────────────────────────────────────────────────────────────

export interface UiPillProps {
  readonly label: string;
  readonly tone?: "brand" | "amber" | "ok" | "bad";
  readonly icon?: ReactNode;
}

export function UiPill({ label, tone = "brand", icon }: UiPillProps) {
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
  return (
    <section className="ui-card">
      {title !== undefined ? <h3 className="ui-card__title">{title}</h3> : null}
      {action !== undefined ? <div className="ui-card__action">{action}</div> : null}
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

// ─── ui-truth (boolean indicator) ───────────────────────────────────────────

export interface UiTruthProps {
  readonly value: boolean;
  readonly label: string;
  readonly onLabel?: string;
  readonly offLabel?: string;
}

export function UiTruth({ value, label, onLabel = "نعم", offLabel = "لا" }: UiTruthProps) {
  return (
    <div className="ui-truth" role="status" aria-label={label}>
      <span className={`ui-truth__dot${value ? " ui-truth__dot--on" : ""}`} aria-hidden="true" />
      <span className="ui-truth__text">{value ? onLabel : offLabel}</span>
    </div>
  );
}

// ─── ui-rail (progress track) ──────────────────────────────────────────────

export interface UiRailProps {
  readonly steps: ReadonlyArray<{
    readonly label: string;
    readonly state: "done" | "current" | "pending";
  }>;
}

export function UiRail({ steps }: UiRailProps) {
  return (
    <ol className="ui-rail">
      {steps.map((step) => {
        const s = RAIL_STATES.find((x) => x.state === step.state) ?? RAIL_STATES[2];
        return (
          <li
            key={step.label}
            className={`ui-rail__item ${s.modifier}`}
            aria-current={step.state === "current" ? "step" : undefined}
          >
            <span className="ui-rail__dot" aria-hidden="true">
              {steps.indexOf(step) + 1}
            </span>
            <span className="ui-rail__label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ─── ui-timer ──────────────────────────────────────────────────────────────

export interface UiTimerProps {
  readonly seconds: number;
  readonly label: string;
  readonly tone?: "neutral" | "amber" | "bad";
}

export function UiTimer({ seconds, label, tone = "neutral" }: UiTimerProps) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const display = `${mins}:${secs.toString().padStart(2, "0")}`;
  const t = TIMER_TONES.find((x) => x.tone === tone) ?? TIMER_TONES[0];
  return (
    <div className={`ui-timer ${t.modifier}`} role="timer" aria-label={label}>
      <IconClock className="ui-timer__icon" aria-hidden="true" />
      <span className="ui-timer__value">{display}</span>
    </div>
  );
}

// ─── ui-stp (stepper) ───────────────────────────────────────────────────────

export interface UiStepperProps {
  readonly current: number;
  readonly total: number;
  readonly label: string;
}

export function UiStepper({ current, total, label }: UiStepperProps) {
  return (
    <fieldset className="ui-stp" aria-label={label}>
      <button type="button" className="ui-stp__btn" aria-label="إنقاص" disabled={current <= 1}>
        −
      </button>
      <span className="ui-stp__value" aria-live="polite">
        {current} / {total}
      </span>
      <button type="button" className="ui-stp__btn" aria-label="زيادة" disabled={current >= total}>
        +
      </button>
    </fieldset>
  );
}

// ─── ui-sht (bottom sheet) ─────────────────────────────────────────────────

export interface UiSheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function UiSheet({ open, title, onClose, children }: UiSheetProps) {
  if (!open) return null;
  return (
    <div className="ui-sht" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ui-sht__overlay" onClick={onClose} aria-hidden="true" />
      <div className="ui-sht__panel">
        <div className="ui-sht__head">
          <h2 className="ui-sht__title">{title}</h2>
          <button type="button" className="ui-sht__close" aria-label="إغلاق" onClick={onClose}>
            <IconCross aria-hidden="true" />
          </button>
        </div>
        <div className="ui-sht__body">{children}</div>
      </div>
    </div>
  );
}

// ─── ui-dg (dialog) ────────────────────────────────────────────────────────

export interface UiDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly actions?: ReactNode;
}

export function UiDialog({ open, title, children, onClose, actions }: UiDialogProps) {
  if (!open) return null;
  return (
    <div className="ui-dg" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ui-dg__overlay" onClick={onClose} aria-hidden="true" />
      <div className="ui-dg__panel" role="document">
        <div className="ui-dg__head">
          <h2 className="ui-dg__title">{title}</h2>
          <button type="button" className="ui-dg__close" aria-label="إغلاق" onClick={onClose}>
            <IconCross aria-hidden="true" />
          </button>
        </div>
        <div className="ui-dg__body">{children}</div>
        {actions !== undefined ? <div className="ui-dg__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

// ─── ui-tab ────────────────────────────────────────────────────────────────

export interface UiTabProps {
  readonly tabs: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly active: string;
  readonly onSelect: (id: string) => void;
}

export function UiTab({ tabs, active, onSelect }: UiTabProps) {
  return (
    <div className="ui-tab" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`ui-tab__item${tab.id === active ? " ui-tab__item--on" : ""}`}
          role="tab"
          aria-selected={tab.id === active}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── ui-act (action bar) ────────────────────────────────────────────────────

export interface UiActionBarProps {
  readonly children: ReactNode;
  readonly label?: string;
}

export function UiActionBar({ children, label }: UiActionBarProps) {
  return (
    <nav className="ui-act" aria-label={label ?? "إجراءات"}>
      {children}
    </nav>
  );
}

// ─── ui-hdr (header) ────────────────────────────────────────────────────────

export interface UiHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly back?: () => void;
  readonly action?: ReactNode;
}

export function UiHeader({ title, subtitle, back, action }: UiHeaderProps) {
  return (
    <header className="ui-hdr">
      {back !== undefined ? (
        <button type="button" className="ui-hdr__back" aria-label="رجوع" onClick={back}>
          <IconChevron
            className="ui-hdr__back-icon"
            aria-hidden="true"
            style={{ transform: "rotate(180deg)" }}
          />
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

// ─── ui-skel (skeleton / loading) ───────────────────────────────────────────

export interface UiSkeletonProps {
  readonly lines?: number;
  readonly label?: string;
}

const SKEL_LINES = [
  { id: "skel-1", modifier: "" },
  { id: "skel-2", modifier: "" },
  { id: "skel-3", modifier: "ui-skel__line--short" },
] as const;

export function UiSkeleton({ lines = 3, label = "جارٍ التحميل" }: UiSkeletonProps) {
  const items = lines <= SKEL_LINES.length ? SKEL_LINES.slice(0, lines) : SKEL_LINES;
  return (
    <div className="ui-skel" aria-busy="true" aria-label={label} role="status">
      {items.map((item) => (
        <span key={item.id} className={`ui-skel__line ${item.modifier}`.trimEnd()} />
      ))}
    </div>
  );
}

// ─── ui-empty (empty state) ────────────────────────────────────────────────

export interface UiEmptyProps {
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
}

export function UiEmpty({ title, body, action }: UiEmptyProps) {
  return (
    <section className="ui-empty" aria-live="polite">
      <IconEmpty className="ui-empty__icon" aria-hidden="true" />
      <h2 className="ui-empty__title">{title}</h2>
      <p className="ui-empty__body">{body}</p>
      {action !== undefined ? <div className="ui-empty__action">{action}</div> : null}
    </section>
  );
}

// ─── ui-err (error state) ───────────────────────────────────────────────────

export interface UiErrorProps {
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
  readonly tone?: "bad" | "amber";
}

export function UiError({ title, body, action, tone = "bad" }: UiErrorProps) {
  const t = ERR_TONES.find((x) => x.tone === tone) ?? ERR_TONES[0];
  const Icon = tone === "amber" ? IconAlert : IconError;
  return (
    <section className={`ui-err ${t.modifier}`} aria-live="assertive">
      <Icon className="ui-err__icon" aria-hidden="true" />
      <h2 className="ui-err__title">{title}</h2>
      <p className="ui-err__body">{body}</p>
      {action !== undefined ? <div className="ui-err__action">{action}</div> : null}
    </section>
  );
}

// ─── ui-toast ───────────────────────────────────────────────────────────────

export interface UiToastProps {
  readonly message: string;
  readonly tone?: "brand" | "ok" | "bad" | "amber";
  readonly onDismiss?: () => void;
}

export function UiToast({ message, tone = "brand", onDismiss }: UiToastProps) {
  const t = TOAST_TONES.find((x) => x.tone === tone) ?? TOAST_TONES[0];
  return (
    <output className={`ui-toast ${t.modifier}`} aria-live="polite">
      <span className="ui-toast__msg">{message}</span>
      {onDismiss !== undefined ? (
        <button type="button" className="ui-toast__close" aria-label="إغلاق" onClick={onDismiss}>
          <IconCross aria-hidden="true" />
        </button>
      ) : null}
    </output>
  );
}

// ─── ui-banner ──────────────────────────────────────────────────────────────

export interface UiBannerProps {
  readonly message: string;
  readonly tone?: "brand" | "amber" | "ok" | "bad";
  readonly action?: ReactNode;
}

export function UiBanner({ message, tone = "amber", action }: UiBannerProps) {
  const t = BANNER_TONES.find((x) => x.tone === tone) ?? BANNER_TONES[1];
  const Icon = tone === "ok" ? IconCheck : tone === "bad" ? IconCross : IconAlert;
  return (
    <section className={`ui-banner ${t.modifier}`} aria-live="polite">
      <Icon className="ui-banner__icon" aria-hidden="true" />
      <span className="ui-banner__msg">{message}</span>
      {action !== undefined ? <div className="ui-banner__action">{action}</div> : null}
    </section>
  );
}

// ─── ui-av (avatar) ────────────────────────────────────────────────────────

export interface UiAvatarProps {
  readonly name: string;
  readonly src?: string;
}

export function UiAvatar({ name, src }: UiAvatarProps) {
  const initial = name.charAt(0);
  return (
    <span className="ui-av" role="img" aria-label={name}>
      {src !== undefined ? (
        <img className="ui-av__img" src={src} alt={name} width={40} height={40} />
      ) : (
        <span className="ui-av__initial" aria-hidden="true">
          {initial}
        </span>
      )}
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
    <div className="ui-pl" role="img" aria-label={label}>
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
  readonly tone?: "brand" | "amber" | "ok" | "bad";
}

export function UiStatus({ label, tone = "ok" }: UiStatusProps) {
  const t = STATUS_TONES.find((x) => x.tone === tone) ?? STATUS_TONES[2];
  return (
    <span className={`ui-st ${t.modifier}`} role="status">
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
  return label !== undefined ? (
    <div className="ui-ds">
      <span className="ui-ds__line" />
      <span className="ui-ds__label">{label}</span>
      <span className="ui-ds__line" />
    </div>
  ) : (
    <hr className="ui-ds" />
  );
}

// ─── ui-pg (progress) ───────────────────────────────────────────────────────

export interface UiProgressProps {
  readonly value: number;
  readonly max?: number;
  readonly label: string;
}

export function UiProgress({ value, max = 100, label }: UiProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <progress className="ui-pg" value={value} max={max} aria-label={label}>
      <span className="ui-pg__bar" style={{ width: `${pct}%` }} />
    </progress>
  );
}

// ─── ui-copy (copy button) ──────────────────────────────────────────────────

export interface UiCopyProps {
  readonly text: string;
  readonly label: string;
  readonly onCopy: () => void;
}

export function UiCopy({ text, label, onCopy }: UiCopyProps) {
  return (
    <button type="button" className="ui-copy" aria-label={label} onClick={onCopy}>
      <IconCopy className="ui-copy__icon" aria-hidden="true" />
      <span className="ui-copy__text">{text}</span>
    </button>
  );
}
