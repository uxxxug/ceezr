/**
 * الغرض: إشاراتُ القناةِ الآنيةِ **بين نسخِ البوّابة** — تعدُّدُ النسخِ (قرارُ المالكِ 2026-10-30).
 * الحالة: منفَّذٌ فعليّاً.
 * ينتمي إلى: apps/gateway/src/realtime
 *
 * غرفُ Socket.IO محلّيّةٌ لكلِّ نسخة. فحدثٌ يولدُ في نسخةٍ (رسالةُ محادثةٍ حُفِظت عبرَ HTTP، أو
 * حدثُ رحلةٍ للراكب) وطرفُه الآخرُ متّصلٌ بنسخةٍ أخرى لا يصلُه إلّا إن أُشيرَ إلى النسخِ الأخرى.
 * هذه الوحدةُ تُرسلُ الإشارةَ إلى كلِّ عناوينِ `GATEWAY_INTERNAL_URL` (قائمةً) مع **معرّفِ المصدر**،
 * والنسخةُ التي يصلُها معرّفُها نفسُه تتجاهلُه فلا يتكرّرُ البثُّ.
 *
 * نسخةٌ واحدةٌ (عنوانٌ واحدٌ أو لا شيء) ⇒ لا نداءَ ألبتّة — السلوكُ كما كان حرفًا.
 * والإشارةُ تسريعٌ لا مصدرُ حقيقة: المحادثةُ تُسترجَعُ من القاعدةِ، والرحلةُ تُقرأُ بالاستطلاع؛
 * ففشلُ نداءٍ لا يفقدُ شيئًا.
 */

import { fanoutSignal } from "../../../../packages/infrastructure/notification/internal-signal-fanout.ts";
import { createGuardedFetch } from "../../../../packages/shared/wasla/egress-gate.ts";

const PEER_SIGNAL_TIMEOUT_MS = 1_500;

export interface PeerSignalDeps {
  /** عناوينُ النسخِ كلِّها (ومنها هذه). أقلُّ من اثنين = معطَّل. */
  readonly targets: readonly string[];
  readonly secret: string | null;
  /** معرّفُ هذه العمليّة — يُرفَقُ بالإشارةِ وتتجاهلُه النسخةُ صاحبتُه. */
  readonly origin: string;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
}

export interface PeerSignal {
  readonly enabled: boolean;
  readonly origin: string;
  /** يُرسلُ ولا ينتظر — لا يُعلَّقُ طلبُ المستخدمِ على نسخةٍ أخرى. */
  readonly send: (path: string, body: Record<string, unknown>) => void;
}

export function createPeerSignal(deps: PeerSignalDeps): PeerSignal {
  const enabled = deps.targets.length > 1 && deps.secret !== null && deps.secret.length >= 16;
  const guardedFetch = deps.fetch ?? createGuardedFetch("gateway-internal-peer-signal");
  return {
    enabled,
    origin: deps.origin,
    send: (path, body) => {
      if (!enabled) return;
      void fanoutSignal({
        fetch: guardedFetch,
        targets: deps.targets,
        path,
        secret: deps.secret as string,
        body: { ...body, origin: deps.origin },
        timeoutMs: PEER_SIGNAL_TIMEOUT_MS,
        onRejected: (status) => deps.log?.("peer_signal.rejected", { path, status }),
      }).catch(() => undefined);
    },
  };
}
