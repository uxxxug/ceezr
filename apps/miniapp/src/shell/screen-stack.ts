/**
 * الغرض: مكدّسُ الشاشاتِ (`useScreenStack`) — §6 من الدليلِ المعتمد:
 *   «push / pop / replace / reset. تبديلُ التبويبِ يمسحُ stack».
 * الحالة: منفّذ فعلياً — UI-2 / PR 2 (Shell & Navigation · ADR 0234).
 * ينتمي إلى: apps/miniapp/src/shell
 *
 * **القرارُ نقيٌّ والخطّافُ غلافٌ رقيق:** `screenStackReducer` دالّةٌ بلا React
 * تُختبَرُ وحدَها، و`useScreenStack` يلفُّها بـ`useReducer` لا أكثر.
 *
 * **لا فعلَ بلا أثرٍ يُدَّعى:** `pop` على الجذرِ و`replace` بلا شاشةِ تدفّقٍ و`reset`
 * على الجذرِ تُعيدُ **الحالةَ نفسَها** (المرجعَ ذاتَه) — فلا إعادةَ رسمٍ ولا حركةَ
 * انتقالٍ لشيءٍ لم يتغيّر. والجذرُ ملكُ التبويبِ، فلا يُستبدَلُ بـ`replace`.
 *
 * **الحركةُ معلومةٌ لا زخرفة:** `forward` بعدَ `push`، و`back` بعدَ `pop`/`reset`،
 * و`none` بعدَ `replace` وتبديلِ التبويب (التبويبُ ليسَ تقدّماً في تدفّقٍ).
 */

import { useCallback, useMemo, useReducer } from "react";

export type ScreenMotion = "forward" | "back" | "none";

export interface ScreenEntry<S> {
  /** مفتاحٌ فريدٌ لكلِّ دفعٍ — يُعيدُ تركيبَ الشاشةِ ويُطلِقُ انتقالَها. */
  readonly key: string;
  readonly screen: S;
}

export interface ScreenStackState<T extends string, S> {
  readonly tab: T;
  /** شاشاتُ التدفّقِ فوقَ جذرِ التبويب؛ الفارغُ = الجذر. */
  readonly stack: readonly ScreenEntry<S>[];
  readonly motion: ScreenMotion;
  /** عدّادٌ رتيبٌ لتوليدِ المفاتيح — لا وقتٌ ولا عشوائيّة. */
  readonly seq: number;
}

export type ScreenStackAction<T extends string, S> =
  | { readonly type: "push"; readonly screen: S }
  | { readonly type: "pop" }
  | { readonly type: "replace"; readonly screen: S }
  | { readonly type: "reset" }
  | { readonly type: "selectTab"; readonly tab: T };

export function initialScreenStack<T extends string, S>(tab: T): ScreenStackState<T, S> {
  return { tab, stack: [], motion: "none", seq: 0 };
}

export function screenStackReducer<T extends string, S>(
  state: ScreenStackState<T, S>,
  action: ScreenStackAction<T, S>,
): ScreenStackState<T, S> {
  switch (action.type) {
    case "push": {
      const seq = state.seq + 1;
      return {
        ...state,
        stack: [...state.stack, { key: `s${seq}`, screen: action.screen }],
        motion: "forward",
        seq,
      };
    }
    case "pop":
      if (state.stack.length === 0) return state;
      return { ...state, stack: state.stack.slice(0, -1), motion: "back" };
    case "replace": {
      if (state.stack.length === 0) return state;
      const seq = state.seq + 1;
      return {
        ...state,
        stack: [...state.stack.slice(0, -1), { key: `s${seq}`, screen: action.screen }],
        motion: "none",
        seq,
      };
    }
    case "reset":
      if (state.stack.length === 0) return state;
      return { ...state, stack: [], motion: "back" };
    case "selectTab":
      // §6: تبديلُ التبويبِ يمسحُ المكدّس — وإعادةُ اختيارِ النشطِ تعودُ إلى جذرِه.
      if (state.tab === action.tab && state.stack.length === 0) return state;
      return { ...state, tab: action.tab, stack: [], motion: "none" };
  }
}

/** مفتاحُ الشاشةِ الظاهرة: أعلى المكدّس، وإلّا جذرُ التبويب. */
export function currentScreenKey<T extends string, S>(state: ScreenStackState<T, S>): string {
  const top = state.stack[state.stack.length - 1];
  return top === undefined ? `tab:${state.tab}` : top.key;
}

export function currentScreen<T extends string, S>(state: ScreenStackState<T, S>): S | null {
  const top = state.stack[state.stack.length - 1];
  return top === undefined ? null : top.screen;
}

export interface ScreenStack<T extends string, S> {
  readonly state: ScreenStackState<T, S>;
  /** شاشةُ التدفّقِ الظاهرة، و`null` = جذرُ التبويب. */
  readonly current: S | null;
  readonly currentKey: string;
  readonly canGoBack: boolean;
  readonly push: (screen: S) => void;
  readonly pop: () => void;
  readonly replace: (screen: S) => void;
  readonly reset: () => void;
  readonly selectTab: (tab: T) => void;
}

export function useScreenStack<T extends string, S>(initialTab: T): ScreenStack<T, S> {
  const [state, dispatch] = useReducer(
    screenStackReducer<T, S>,
    initialTab,
    initialScreenStack<T, S>,
  );
  const push = useCallback((screen: S) => dispatch({ type: "push", screen }), []);
  const pop = useCallback(() => dispatch({ type: "pop" }), []);
  const replace = useCallback((screen: S) => dispatch({ type: "replace", screen }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const selectTab = useCallback((tab: T) => dispatch({ type: "selectTab", tab }), []);
  return useMemo(
    () => ({
      state,
      current: currentScreen(state),
      currentKey: currentScreenKey(state),
      canGoBack: state.stack.length > 0,
      push,
      pop,
      replace,
      reset,
      selectTab,
    }),
    [state, push, pop, replace, reset, selectTab],
  );
}
