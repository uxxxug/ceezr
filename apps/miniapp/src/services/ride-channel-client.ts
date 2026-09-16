/**
 * الغرض: عميلُ قناةِ الرحلةِ الآنيةِ في Mini App — يتّصلُ بـSocket.IO ويستهلكُ
 *   أحداثَ التتبُّعِ مباشرةً بلا استقصاءٍ (البندانِ `F2-06` و`F4-04` · ADR 0035 §٤).
 * الحالة: مبنيّ — البندانِ `F2-06` و`F4-04`.
 * ينتمي إلى: apps/miniapp/src/services
 * يُستخدم من: `ActiveRideScreen.tsx` عبر حقنٍ لا استيرادٍ مباشر.
 * يحكمُه: ADR 0042 (ناقلُ الزمنِ الحقيقيِّ لـMini App = Socket.IO).
 *
 * ## لماذا لا يُستورَدُ `socket.io-client` في الشاشةِ مباشرةً
 *
 * الشاشةُ تُقاسُ بلا شبكةٍ، فلا يُرقَّعُ فيها `io` عالميّاً. وهذا العميلُ
 * يُحقَنُ فيها كدالّةٍ: `connect` تُعادُ قابلةً للفصل، والاختبارُ يُمرِّرُ
 * دالّةٍ وهميّةً. ولا تُخزَّنُ حالةُ تتبُّعٍ: قيمةُ الردِّ تُمرَّرُ إلى
 * `applyTrackingDelta` في النموذج، وهو يقرَّر.
 *
 * ## ولماذا لا يُحتفَظُ برمزِ الجلسةِ ههنا
 *
 * الرمزُ في الذاكرةِ (`session.ts`) وحدَه، ويُقرأُ عندَ الاتّصالِ لا يُخزَّنُ
 * في هذه الوحدة. وكلُّ اتصالٍ جديدٍ يقرأُه طازجاً — فلا رمزُ منتهٍ يُعادُ.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا يُخزِّنُ موقعاً ولا طوراً**: حالةُ عرضٍ في الشاشة، وحالةُ عملٍ في
 *      القاعدةِ وحدَها (ADR 0035 §٢).
 *   ــ **لا يُعيدُ الاتّصالَ تلقائيّاً**: قرارُ الشاشةِ، لا قرارَ الناقل.
 *   ــ **لا يثقُ بـ`tripId` من العميل**: الخادمُ يُصادِقُ الجلسةَ ثم يشتقُّ
 *      الرحلةَ — والرمزُ يُمرَّرُ تلميحاً لا حقيقةً.
 */

import type { Socket } from "socket.io-client";

/** حدثٌ يُستقبَلُ من الخادمِ في غرفةِ الرحلة. */
export interface RideChannelEvent {
  readonly type: string;
  readonly driverId: string;
  readonly tripId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly position: { readonly lat: number; readonly lng: number } | null;
  readonly timestamp: string;
}

/** منفذُ الاتّصالِ بـSocket.IO — يُحقَنُ في الاختبارِ بديلاً. */
export interface RideChannelTransport {
  connect(url: string, auth: { readonly sessionToken: string }): Socket;
}

/** منفذُ قراءةِ رمزِ الجلسةِ — يُحقَنُ كي لا يُستورَدَ `session.ts` مباشرة. */
export interface SessionTokenReader {
  read(): string | null;
}

export interface RideChannelClientDeps {
  readonly transport: RideChannelTransport;
  readonly sessions: SessionTokenReader;
  readonly baseUrl: string;
}

export interface RideChannelSubscription {
  readonly disconnect: () => void;
}

/**
 * يتّصلُ بالخادمِ وينضمُّ إلى غرفةِ الرحلة. ويُمرِّرُ كلَّ حدثٍ إلى `onEvent`.
 *
 * والاتّصالُ **واحدٌ**: إن نُودِعَ `connect` مرّتَينِ فالأوّلُ يُفصَلُ قبلَ
 * الثاني. ولا يُعادُ الاتّصالُ تلقائيّاً: الشاشةُ تُقرِّرُ متى تُعيدُ الطلب.
 */
export function subscribeRideChannel(
  deps: RideChannelClientDeps,
  input: {
    readonly orderId: string;
    readonly onEvent: (event: RideChannelEvent) => void;
    readonly onError?: (error: unknown) => void;
    readonly onDisconnect?: () => void;
  },
): RideChannelSubscription {
  const token = deps.sessions.read();
  if (token === null) {
    return { disconnect: () => {} };
  }

  let socket: Socket | null = null;
  try {
    socket = deps.transport.connect(deps.baseUrl, { sessionToken: token });
  } catch (thrown) {
    input.onError?.(thrown);
    return { disconnect: () => {} };
  }

  socket.on("ride:event", (event: RideChannelEvent) => {
    if (event.tripId !== input.orderId) return;
    input.onEvent(event);
  });

  socket.on("connect_error", (error: unknown) => {
    input.onError?.(error);
  });

  socket.on("disconnect", () => {
    input.onDisconnect?.();
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
