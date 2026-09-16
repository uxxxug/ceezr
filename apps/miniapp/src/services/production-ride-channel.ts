/**
 * منفذُ قناةِ الرحلةِ الآنيةِ للإنتاجِ — يُنشئُ ناقلَ Socket.IO حقيقيًّا ورمزَ
 * جلسةٍ من حاملِ الجلسةِ القائمِ (`F4-07`).
 *
 * **لا يُخزِّنُ حالةَ أعمالٍ** (ADR 0035 §2): الناقلُ ناقلٌ فقط، ورمزُ الجلسةِ
 * يُقرأُ في كلِّ اتصالٍ من `getSession` لا من ذاكرةٍ مخبَّأةٍ.
 *
 * ينتمي إلى: apps/miniapp/src/services
 * يُتوقَّع أن يستخدمه: `RiderRoot.tsx` لحقنِّ `ActiveRideScreen`.
 */

import type { Socket } from "socket.io-client";
import { getSession } from "../identity/session.ts";
import type { RideChannelTransport, SessionTokenReader } from "./ride-channel-client.ts";

/**
 * ناقلُ Socket.IO للإنتاجِ — يُوصِلُ `transport.connect` بـ`socket.io-client`.
 * يُفصَلُ عن `ride-channel-client.ts` كي يبقى الأخيرُ نقيًّا من `socket.io-client`
 * في الاختباراتِ.
 *
 * الاستيرادُ كسولٌ داخلَ `connect` كي لا يُحمَّلَ `socket.io-client` في تجميعِ
 * الجذرِ (الذي بلا أنواعِ DOM) — يُحمَّلُ فقط حينَ يُستدعى في المتصفح.
 */
export const productionRideChannelTransport: RideChannelTransport = {
  connect: (url: string, auth: { readonly sessionToken: string }): Socket => {
    // الاستيرادُ الديناميكيُّ يُحمَّلُ في المتصفحِ لا في تجميعِ الجذرِ.
    const mod = require("socket.io-client") as typeof import("socket.io-client");
    return mod.io(url, {
      auth,
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });
  },
};

/**
 * قارئُ رمزِ الجلسةِ للإنتاجِ — يقرأُ من `getSession` في كلِّ نداءٍ.
 * يُرجِعُ `null` إن لم تكن جلسةٌ صالحةٌ، فيُسقِطُ عميلُ القناةِ الاتصالَ.
 */
export const productionSessionReader: SessionTokenReader = {
  read: () => {
    const session = getSession();
    if (session === null) return null;
    return session.accessToken;
  },
};

/**
 * أساسُ عنوانِ الخادمِ — نفسُ `apiBase` من `client.ts` لكنَّه مُعرَّضٌ هنا
 * كي لا يستورِدَ `RiderRoot` وحدةَ API كاملةً.
 */
export function productionChannelBaseUrl(): string {
  const base = import.meta.env.VITE_WASLAH_API_BASE;
  if (typeof base === "string" && base.length > 0) return base.replace(/\/$/, "");
  return "";
}
