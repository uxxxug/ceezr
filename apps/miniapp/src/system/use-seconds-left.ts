/**
 * الغرض: عدّادُ ثوانٍ ظاهرٌ يتناقصُ حتى موعدٍ مطلقٍ قالَه الخادم (ADR 0296).
 * الحالة: منفّذ فعلياً — 2026-11-01.
 * ينتمي إلى: apps/miniapp/src/system
 * يُستخدم من: surfaces/rider/search/RideCandidateCard.tsx ·
 *   surfaces/driver/offers/OfferDetailScreen.tsx
 *
 * ## ما ليسَ هذا
 *
 * ليسَ استقصاءً (`ADR 0035` §٤): لا شبكةَ ولا قراءةَ في كلِّ نبضة. النبضةُ تُعيدُ **رسمَ**
 * الرقمِ من ساعةِ الجهازِ والموعدِ المطلقِ (فلا انجرافَ ولو أبطأَ المتصفّحُ المؤقّتات في
 * الخلفيّة)، وتتوقّفُ عندَ الصفر. وعندَ الصفرِ وحدَه يُنادى `onReached` **مرّةً واحدة**
 * (تقرأُ الشاشةُ الأمُّ المآلَ الحقيقيَّ من الخادم: انتهتِ المهلةُ أم جاءَ مرشَّحٌ آخر).
 */

import { useEffect, useRef, useState } from "react";

/** الباقي بالثواني الصحيحة (سقفًا) من موعدٍ مطلق؛ لا سالب. */
export function secondsUntil(deadlineMs: number | null, nowMs: number): number {
  if (deadlineMs === null || !Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/** كم ينتظرُ الرسمُ التالي: حتى تتغيّرَ الثانيةُ الظاهرة (بحدٍّ أدنى صغير). */
export function nextTickDelayMs(deadlineMs: number, nowMs: number): number {
  const remainder = (deadlineMs - nowMs) % 1000;
  const delay = remainder <= 0 ? 1000 : remainder;
  return Math.max(50, Math.min(1000, Math.ceil(delay)));
}

const systemNow = (): number => Date.now();

export function useSecondsLeft(
  deadlineMs: number | null,
  options: { readonly now?: () => number; readonly onReached?: () => void } = {},
): number {
  const now = options.now ?? systemNow;
  // النبضةُ تُجبرُ إعادةَ الرسمِ فقط؛ والرقمُ يُحسَبُ من الساعةِ في كلِّ رسمٍ، فلا يتأخّرُ
  // رسمٌ أوّلُ بعدَ تغيّرِ الموعدِ برقمٍ قديم.
  const [, setBeat] = useState(0);
  const reachedRef = useRef(options.onReached);
  reachedRef.current = options.onReached;

  useEffect(() => {
    if (deadlineMs === null) return;
    let handle: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const at = now();
      setBeat((n) => n + 1);
      if (secondsUntil(deadlineMs, at) <= 0) {
        reachedRef.current?.();
        return;
      }
      handle = setTimeout(tick, nextTickDelayMs(deadlineMs, at));
    };
    const at = now();
    if (secondsUntil(deadlineMs, at) > 0)
      handle = setTimeout(tick, nextTickDelayMs(deadlineMs, at));
    return () => {
      stopped = true;
      if (handle !== null) clearTimeout(handle);
    };
  }, [deadlineMs, now]);

  return secondsUntil(deadlineMs, now());
}
