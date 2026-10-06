/**
 * الغرض: أيقوناتٌ SVG مضمَّنةٌ — لا مكتبةَ أيقوناتٍ (القسم 0: «لا مكتباتٍ جديدة»).
 *   كلُّ أيقونةٍ عنصرُ SVG واحدٌ بقيمة `currentColor` فيكون لونُها لونَ النصِّ
 *   الذي يحيطُ بها، فلا تُكرَّر قيمُ الألوانِ ههنا.
 * الحالة: منفّذ فعلياً — بندُ PR 1 في القسم 11.
 * ينتمي إلى: apps/miniapp/src/system/ui
 *
 * **aria-label لكلِّ أيقونةٍ** (القسم 4): الأيقونةُ بلا نصٍّ تُعطى `aria-label`،
 * وذاتُ النصِّ تُخفى `aria-hidden` كي لا يُكرَّر قارئُ الشاشةِ.
 */

import type { ReactNode, SVGProps } from "react";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** اسمٌ يُقرأ بديلاً للرسمة حين لا يكون ثمّةَ نصٌّ يُحيطُ بها. */
  readonly label?: string;
}

function Svg({ label, children, ...rest }: IconProps & { readonly children: ReactNode }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label !== undefined ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label !== undefined ? undefined : true}
      {...rest}
    >
      {label !== undefined ? <title>{label}</title> : null}
      {children}
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 6L9 17l-5-5" />
    </Svg>
  );
}

export function IconCross(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </Svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </Svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  );
}

export function IconEmpty(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
    </Svg>
  );
}

export function IconError(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </Svg>
  );
}

export function IconSpinner(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </Svg>
  );
}

export function IconChevron(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 18l6-6-6-6" />
    </Svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </Svg>
  );
}
