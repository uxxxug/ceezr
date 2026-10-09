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

/**
 * `UX-V2` (ADR 0248): رموزُ التنقّلِ والقوائمِ — جدولُ مساراتٍ واحدٌ ومكوّنٌ واحدٌ كي يبقى
 * أثرُها في الحزمةِ صغيراً (سطحُ الراكبِ الأوّلُ مقيسٌ بـ`measure-tti`). زخرفةٌ بجانبِ نصٍّ
 * دائماً فتُخفى عن قارئِ الشاشةِ؛ ولا تحملُ معنىً لا يحملُه النصُّ.
 */
const GLYPHS = {
  home: "M3 10.5L12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
  rides: "M4 6h16M4 12h16M4 18h10",
  support: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4M12 17h.01",
  account: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  offers:
    "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  job: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  earnings: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  dot: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  homePlace: "M3 10.5L12 3l9 7.5M5 9v11h14V9",
  work: "M3 8h18v12H3zM8 8V5h8v3",
  recent: "M12 21a9 9 0 1 0-9-9M3 4v5h5M12 7v5l3 2",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  box: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 8v4M12 16h.01",
  car: "M5 17h14M6 17v2M18 17v2M3 13l2-6h14l2 6v4H3zM7 13h.01M17 13h.01",
  parcel: "M16.5 9.4L7.5 4.2M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12",
  route:
    "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h4M18 9v6a4 4 0 0 1-4 4h-4",
  share: "M4 12v8h16v-8M16 6l-4-4-4 4M12 2v13",
  refresh: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  star: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2 2 9.3l6.9-1z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6",
  card: "M2 6h20v12H2zM2 10h20M6 15h4",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  globe:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  download: "M4 17v3h16v-3M12 3v12M7 10l5 5 5-5",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  phone:
    "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z",
  flag: "M4 22V4M4 4h13l-2 4 2 4H4",
  navigate: "M3 11l19-9-9 19-2-8z",
  power: "M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0",
} as const;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name, ...props }: IconProps & { readonly name: GlyphName }) {
  return (
    <Svg strokeWidth={1.8} {...props}>
      <path d={GLYPHS[name]} />
    </Svg>
  );
}
