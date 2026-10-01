/**
 * الغرض: قناةُ Socket.IO لتحديثِ عروضِ السائقِ — ينضمُّ السائقُ إلى غرفتِه ويستقبِلُ
 *   إشارةَ `offers:update` فيُجدِّدُ قائمتَه (DEC-32 · ADR 0229).
 * ينتمي إلى: apps/gateway/src/realtime
 * يحكمُه: ADR 0042 (ناقلُ الزمنِ الحقيقيِّ لـMini App = Socket.IO)
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يحملُ بياناتِ عرضٍ**: الإشارةُ وحدَها — القراءةُ من الـ API.
 *   ــ **لا يُصدِّقُ حالةَ التوافر**: ذلك قرارُ السائقِ لا الخادمِ.
 *   ــ **لا يُصدِّقُ رمزَ الجلسةِ هنا**: `createSessionVerifier` يفعلُ.
 */

import type { Server as IoServer, Socket as IoSocket } from "socket.io";
import type { RideChannelSessionVerifier } from "./ride-channel.ts";

export interface OffersChannelDeps {
  readonly io: IoServer;
  readonly sessions: RideChannelSessionVerifier;
}

export interface OffersChannel {
  readonly start: () => void;
  readonly stop: () => void;
}

export function createOffersChannel(deps: OffersChannelDeps): OffersChannel {
  let unsub: (() => void) | null = null;

  function start(): void {
    deps.io.on("connection", (socket: IoSocket) => {
      socket.on("offers:join", async () => {
        const sessionToken = socket.handshake.auth?.sessionToken as string | undefined;
        if (sessionToken === undefined) {
          socket.emit("offers:error", { code: "NO_SESSION" });
          return;
        }

        const session = await deps.sessions.verify(sessionToken);
        if (session === null) {
          socket.emit("offers:error", { code: "INVALID_SESSION" });
          return;
        }

        // السائقُ ينضمُّ إلى غرفةٍ خاصّةٍ به — لا غرفةَ للعرضِ نفسِه.
        socket.join(`driver-offers:${session.riderId}`);
        socket.emit("offers:joined", {});
      });
    });
  }

  function stop(): void {
    if (unsub !== null) {
      unsub();
      unsub = null;
    }
  }

  return { start, stop };
}
