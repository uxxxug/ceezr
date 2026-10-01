/**
 * الغرض: عميلُ قناةِ العروضِ الآنيةِ في Mini App — يتّصلُ بـSocket.IO ويستقبِلُ
 *   إشارةَ تحديثٍ فتُجدِّدُ الشاشةُ قائمتَها (DEC-32 · ADR 0229).
 * ينتمي إلى: apps/miniapp/src/services
 * يُستخدم من: `OffersScreen.tsx` عبر حقنٍ لا استيرادٍ مباشر.
 * يحكمُه: ADR 0042 (ناقلُ الزمنِ الحقيقيِّ لـMini App = Socket.IO).
 *
 * ## وما لا يفعَلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يحملُ بياناتِ عرضٍ**: الإشارةُ وحدَها — القراءةُ من الـ API.
 *   ــ **لا يُعيدُ الاتّصالَ تلقائيّاً**: قرارُ الشاشةِ، لا قرارَ الناقل.
 *   ــ **لا يُجدِّدُ أكثرَ من مرّةٍ كلَّ ثانيتَين**: اندفاعٌ من الأحداثِ لا يُضاعِفُ القراءة.
 */

import type { Socket } from "socket.io-client";

/** منفذُ الاتّصالِ بـSocket.IO — يُحقَنُ في الاختبارِ بديلاً. */
export interface OffersTransport {
  connect(url: string, auth: { readonly sessionToken: string }): Socket;
}

/** منفذُ قراءةِ رمزِ الجلسةِ. */
export interface OffersSessionReader {
  read(): string | null;
}

export interface OffersChannelDeps {
  readonly transport: OffersTransport;
  readonly sessions: OffersSessionReader;
  readonly baseUrl: string;
}

export interface OffersSubscription {
  readonly disconnect: () => void;
}

const MIN_REFRESH_INTERVAL_MS = 2000;

/**
 * يتّصلُ بالخادمِ وينضمُّ إلى غرفةِ العروضِ. ويُجدِّدُ القائمةَ عند كلِّ إشارةِ
 * تحديثٍ — بشرطِ ألا تمرَّ ثانيتانِ منذ آخرِ تحديثٍ (منعُ الاندفاعِ).
 *
 * والاتّصالُ **واحدٌ**: إن نُودِعَ `connect` مرّتَينِ فالأوّلُ يُفصَلُ قبلَ الثاني.
 */
export function subscribeOffersChannel(
  deps: OffersChannelDeps,
  input: {
    readonly onUpdate: () => void;
    readonly onError?: (error: unknown) => void;
    readonly now?: () => number;
  },
): OffersSubscription {
  const token = deps.sessions.read();
  if (token === null) {
    return { disconnect: () => {} };
  }

  const now = input.now ?? (() => Date.now());
  let lastRefreshMs = Number.NEGATIVE_INFINITY;
  let socket: Socket | null = null;

  try {
    socket = deps.transport.connect(deps.baseUrl, { sessionToken: token });
  } catch (thrown) {
    input.onError?.(thrown);
    return { disconnect: () => {} };
  }

  socket.on("offers:update", () => {
    const elapsed = now() - lastRefreshMs;
    if (elapsed < MIN_REFRESH_INTERVAL_MS) return;
    lastRefreshMs = now();
    input.onUpdate();
  });

  socket.on("connect_error", (error: unknown) => {
    input.onError?.(error);
  });

  return {
    disconnect: () => {
      if (socket !== null) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
      }
    },
  };
}
