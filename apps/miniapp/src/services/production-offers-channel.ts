/**
 * منفذُ قناةِ العروضِ الآنيةِ للإنتاجِ — يُنشئُ ناقلَ Socket.IO حقيقيًّا ورمزَ
 * جلسةٍ من حاملِ الجلسةِ القائمِ (DEC-32 · ADR 0229).
 *
 * ينتمي إلى: apps/miniapp/src/services
 * يُستخدم من: `DriverRoot.tsx` لحقنِّ `OffersScreen`.
 */

import { io, type Socket } from "socket.io-client";
import { getSession } from "../identity/session.ts";
import type { OffersSessionReader, OffersTransport } from "./offers-channel-client.ts";

export const productionOffersTransport: OffersTransport = {
  connect: (url: string, auth: { readonly sessionToken: string }): Socket =>
    io(url, {
      auth,
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    }),
};

export const productionOffersSessionReader: OffersSessionReader = {
  read: () => {
    const session = getSession();
    if (session === null) return null;
    return session.accessToken;
  },
};

/**
 * أساسُ عنوانِ الخادمِ — نفسُ `apiBase` من `client.ts` لكنَّه مُعرَّضٌ هنا
 * كي لا يستورِدَ `DriverRoot` وحدةَ API كاملةً.
 */
export function productionOffersBaseUrl(): string {
  const base = import.meta.env.VITE_WASLAH_API_BASE;
  if (typeof base === "string" && base.length > 0) return base.replace(/\/$/, "");
  return "";
}
