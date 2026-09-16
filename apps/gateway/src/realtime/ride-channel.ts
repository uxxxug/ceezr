/**
 * الغرض: قناةُ Socket.IO آنيةٌ للرحلةِ النشطةِ — تُغلقُ بانتهاءِ الرحلة.
 * الحالة: منفّذ فعلياً — المرحلة F4-04.
 * ينتمي إلى: apps/gateway/src/realtime
 * يحكمُه: ADR 0042 (ناقلُ الزمنِ الحقيقيِّ لـMini App = Socket.IO)
 *
 * ## دورةُ الحياة
 *
 * ١. العميلُ يتّصلُ بـSocket.IO ويحملُ في `auth.sessionToken` رمزَ جلسةِ Mini App.
 * ٢. الخادمُ يُصادِقُ الجلسةَ ثم يشتقُّ الرحلةَ النشطةَ من القاعدة — لا يثقُ
 *    بـ`tripId` من العميلِ إلا تلميحاً.
 * ٣. يُنضمُّ إلى غرفةِ `ride:<tripId>` ويستقبلُ لقطةً مرجعيّةً فوراً.
 * ٤. أحداثُ التتبُّعِ تُمرَّرُ إلى الغرفة: `location_updated` و`driver_arrived_pickup`
 *    و`driver_near_customer` و`driver_arrived_customer`.
 * ٥. عندَ انتهاءِ الرحلةِ (الحالةُ ليست `isTripLive`) تُغلَقُ الغرفةُ ويُفصلُ العميل.
 *
 * ## ما لا يُفعَلُ هنا
 *
 * - لا يُغلقُ على `session_ended`: جلسةُ التتبُّعِ قد تنتهي والرحلةُ قائمة.
 * - لا يُسقَطُ بثُّ Live Location التلغراميُّ: ذلك `F4-07` لا `F4-04`.
 * - لا يُوثَقُ به `tripId` من العميلِ بلا تحقُّقٍ من الملكيّةِ والحالة.
 * - اشتراكٌ واحدٌ على ناقلِ الأحداثِ لكلِّ نسخة، لا لكلِّ مقبس.
 */

import type { Server as IoServer, Socket as IoSocket } from "socket.io";
import {
  isTripLive,
  type WatchedTripStatus,
} from "../../../../packages/domain/tracking/visibility.ts";
import type {
  TrackingEventBus,
  TrackingEventSink,
} from "../../../../packages/infrastructure/tracking/event-bus.ts";
import type { TrackingEvent } from "../../../../packages/tracking/types.ts";

/** حدثٌ يُرسَلُ إلى العميلِ في غرفةِ الرحلة. */
export interface RideChannelEvent {
  readonly type: string;
  readonly driverId: string;
  readonly tripId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly position: { lat: number; lng: number } | null;
  readonly timestamp: string;
}

/** منفذُ قراءةِ الرحلةِ النشطةِ للراكب. */
export interface ActiveRideResolver {
  resolve(
    riderId: string,
    hintTripId?: string,
  ): Promise<{
    readonly tripId: string;
    readonly driverId: string;
    readonly status: WatchedTripStatus;
  } | null>;
}

/** منفذُ التحقُّقِ من جلسةِ Mini App. */
export interface RideChannelSessionVerifier {
  verify(sessionToken: string): Promise<{
    readonly riderId: string;
  } | null>;
}

export interface RideChannelDeps {
  readonly io: IoServer;
  readonly eventBus: TrackingEventBus;
  readonly rides: ActiveRideResolver;
  readonly sessions: RideChannelSessionVerifier;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** الأنواعُ التي تُمرَّرُ إلى غرفةِ الرحلة. */
const FORWARDED_TYPES = new Set([
  "location_updated",
  "driver_arrived_pickup",
  "driver_left_pickup",
  "driver_near_customer",
  "driver_arrived_customer",
]);

function toRideChannelEvent(event: TrackingEvent): RideChannelEvent {
  return {
    type: event.type,
    driverId: event.driverId,
    tripId: event.tripId ?? "",
    sessionId: event.sessionId,
    sequence: event.sequence,
    position: event.position ? { lat: event.position.lat, lng: event.position.lng } : null,
    timestamp: event.timestamp.toISOString(),
  };
}

export interface RideChannel {
  readonly start: () => void;
  readonly stop: () => void;
  readonly connectedSockets: number;
}

export function createRideChannel(deps: RideChannelDeps): RideChannel {
  const log = deps.log ?? (() => undefined);
  let unsub: (() => void) | null = null;
  let connectedSockets = 0;

  /**
   * اشتراكٌ واحدٌ على ناقلِ الأحداثِ لكلِّ نسخة. كلُّ مقبسٍ يُنضمُّ إلى غرفةِ
   * رحلتِه، فإذا وردَ حدثٌ يخصُّ رحلةً مفتوحةً بُثَّ إلى غرفتِها وحدها.
   */
  function handleEvent(event: TrackingEvent): void {
    if (!event.tripId) return;
    if (!FORWARDED_TYPES.has(event.type)) return;

    const rideEvent = toRideChannelEvent(event);
    deps.io.to(`ride:${event.tripId}`).emit("ride:event", rideEvent);
    log("ride.event_forwarded", {
      tripId: event.tripId,
      type: event.type,
      sequence: event.sequence,
    });
  }

  deps.io.on("connection", (socket: IoSocket) => {
    connectedSockets += 1;
    log("socket.connected", { socketId: socket.id, count: connectedSockets });

    let joinedTripId: string | null = null;

    socket.on("ride:join", async (payload: { tripId?: string }) => {
      const sessionToken = socket.handshake.auth?.sessionToken as string | undefined;
      if (!sessionToken) {
        socket.emit("ride:error", { code: "NO_SESSION" });
        return;
      }

      const session = await deps.sessions.verify(sessionToken);
      if (!session) {
        socket.emit("ride:error", { code: "INVALID_SESSION" });
        return;
      }

      const ride = await deps.rides.resolve(session.riderId, payload?.tripId);
      if (!ride) {
        socket.emit("ride:error", { code: "NO_ACTIVE_RIDE" });
        return;
      }

      if (!isTripLive(ride.status)) {
        socket.emit("ride:error", { code: "RIDE_NOT_LIVE" });
        return;
      }

      // غادر غرفةً سابقةً إن وُجدت
      if (joinedTripId) {
        socket.leave(`ride:${joinedTripId}`);
      }

      joinedTripId = ride.tripId;
      socket.join(`ride:${ride.tripId}`);
      socket.emit("ride:joined", {
        tripId: ride.tripId,
        driverId: ride.driverId,
        status: ride.status,
      });
      log("ride.joined", { socketId: socket.id, tripId: ride.tripId });
    });

    socket.on("disconnect", () => {
      connectedSockets -= 1;
      log("socket.disconnected", { socketId: socket.id, count: connectedSockets });
    });
  });

  return {
    start: () => {
      if (unsub) return;
      const sink: TrackingEventSink = { deliver: handleEvent };
      unsub = deps.eventBus.subscribe({ kind: "operations", scope: { kind: "all_cities" } }, sink);
      log("ride_channel.started", { subscriberCount: deps.eventBus.subscriberCount });
    },
    stop: () => {
      if (unsub) {
        unsub();
        unsub = null;
      }
      deps.io.close();
      log("ride_channel.stopped", {});
    },
    get connectedSockets() {
      return connectedSockets;
    },
  };
}
