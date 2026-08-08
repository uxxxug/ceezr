/**
 * الغرض: تركيب واحد لتبعيات التفاوض على قروب غير المشتركين، تستهلكه البوابة والعامل
 *   الخلفي معاً. قبل استخراجه كان التركيب حبيس حاوية البوابة، فلم يكن للعامل سبيل
 *   إليه إلّا أن يستورد من app آخر أو أن يكرّره — وكلاهما مرفوض.
 * الحالة: منفّذ فعلياً — استُخرِج في المرحلة 2.6 الخطوة 02 بلا تغيير في التوقيعات.
 * ينتمي إلى: infrastructure/dispatch
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، apps/workers/src/container.ts
 * ملاحظات مستقبلية: أي منفذ تفاوض جديد يُضاف هنا مرّة واحدة فيراه المستهلكان.
 */

import type { EscalateUnmatchedOrderDependencies } from "../../application/dispatch/escalate-unmatched-order.ts";
import type { PublishToUnsubscribedGroupDependencies } from "../../application/dispatch/publish-to-unsubscribed-group.ts";
import type { RepublishDependencies } from "../../application/dispatch/republish-order-card.ts";
import type { RotateNegotiationDependencies } from "../../application/dispatch/rotate-negotiation-turn.ts";
import type { TranslateMessageDependencies } from "../../application/i18n-translation/index.ts";
import type { Sql } from "../db/client.ts";
import type { OutboundSender } from "../notification/telegram-driver-notifier.ts";
import {
  createEscalationGroupPublisher,
  createTelegramNegotiationNotifier,
  createTelegramRelaySender,
  createUnsubscribedGroupPublisher,
  type IdentifyingSender,
} from "../notification/telegram-negotiation-notifier.ts";
import { createOrderRepository } from "../transport/order-adapters.ts";
import {
  createActiveNegotiationLookup,
  createClaimRegistrationPort,
  createEscalationPort,
  createNegotiationPartiesReader,
  createNegotiationRotationPort,
  createNegotiationSnapshotReader,
  createNegotiationTimeoutReader,
  createOrderNotesReader,
  createUnsubscribedCyclePort,
} from "./negotiation-adapters.ts";

export interface NegotiationWiringSenders {
  /** مُرسِل بوت السائق: هو من ينشر في القروب لأن أزراره يضغطها سائقون. */
  readonly driverOut: OutboundSender;
  readonly riderOut: OutboundSender;
  readonly identifyingDriver: IdentifyingSender;
  /** الترجمة المتبادلة. غيابها يعني تمريراً بلا ترجمة، لا تعطيلاً للتمرير. */
  readonly translation?: TranslateMessageDependencies;
}

export interface NegotiationWiring {
  readonly snapshots: ReturnType<typeof createNegotiationSnapshotReader>;
  readonly rotate: RotateNegotiationDependencies;
  readonly republish: RepublishDependencies;
  readonly escalate: EscalateUnmatchedOrderDependencies;
  readonly publish: PublishToUnsubscribedGroupDependencies;
  readonly relay: {
    readonly lookup: ReturnType<typeof createActiveNegotiationLookup>;
    readonly sender: ReturnType<typeof createTelegramRelaySender>;
  };
  readonly claims: {
    readonly claims: ReturnType<typeof createClaimRegistrationPort>;
    readonly parties: ReturnType<typeof createNegotiationPartiesReader>;
    readonly notifier: ReturnType<typeof createTelegramNegotiationNotifier>;
    readonly timeouts: ReturnType<typeof createNegotiationTimeoutReader>;
  };
}

export function createNegotiationWiring(
  sql: Sql,
  senders: NegotiationWiringSenders,
): NegotiationWiring {
  const orders = createOrderRepository(sql);
  const notes = createOrderNotesReader(sql);
  const parties = createNegotiationPartiesReader(sql);
  const timeouts = createNegotiationTimeoutReader(sql);
  const notifier = createTelegramNegotiationNotifier(senders.driverOut, senders.riderOut);

  const publish: PublishToUnsubscribedGroupDependencies = {
    orders,
    notes,
    cycles: createUnsubscribedCyclePort(sql),
    publisher: createUnsubscribedGroupPublisher(senders.identifyingDriver),
  };

  return {
    snapshots: createNegotiationSnapshotReader(sql),

    rotate: {
      rotation: createNegotiationRotationPort(sql),
      parties,
      notifier,
      timeouts,
    },

    // النشر وإعادة النشر يشتركان في نفس التبعيات فعلاً: إعادة النشر ليست عملية
    // أخرى بل نفس النشر في دورة تالية، فتوحيدهما وصفٌ للواقع لا اختصار.
    republish: publish,
    publish,

    escalate: {
      orders,
      escalation: createEscalationPort(sql),
      publisher: createEscalationGroupPublisher(senders.identifyingDriver),
    },

    relay: {
      lookup: createActiveNegotiationLookup(sql),
      sender: createTelegramRelaySender(senders.driverOut, senders.riderOut, senders.translation),
    },

    claims: {
      claims: createClaimRegistrationPort(sql),
      parties,
      notifier,
      timeouts,
    },
  };
}
