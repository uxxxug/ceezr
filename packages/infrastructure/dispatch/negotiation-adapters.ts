/**
 * الغرض: كل ما تمسّه دورة غير المشتركين في القاعدة: فتح الدورة، تسجيل الضغطة، التدوير،
 *   الاتفاق، التصعيد، وقراءة طرفَي القناة. لا منطق قرار هنا إطلاقاً — كله تفويض للدوال الذرّية.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.3.
 * ينتمي إلى: infrastructure/dispatch
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، apps/workers
 * ملاحظات مستقبلية: عند تقسيم القاعدة أفقياً تبقى هذه الدوال كما هي لأن كل صفوفها تحمل city_id.
 */

import type {
  EscalationOutcome,
  EscalationPort,
  EscalationReason,
} from "../../application/dispatch/escalate-unmatched-order.ts";
import type {
  OpenCycleOutcome,
  OrderNotesReader,
  UnsubscribedCyclePort,
} from "../../application/dispatch/publish-to-unsubscribed-group.ts";
import type {
  ClaimRegistration,
  ClaimRegistrationPort,
  NegotiationParties,
  NegotiationPartiesReader,
  NegotiationTimeoutReader,
} from "../../application/dispatch/register-unsubscribed-claim.ts";
import type { ActiveNegotiationLookup } from "../../application/dispatch/relay-negotiation-message.ts";
import type {
  AdvanceOutcome,
  NegotiationRotationPort,
  NegotiationSnapshotReader,
  SettleOutcome,
} from "../../application/dispatch/rotate-negotiation-turn.ts";
import type { NegotiationSnapshot, NegotiationStatus } from "../../domain/dispatch/negotiation.ts";
import type { CityId, DriverId, OrderId, RiderId, ServiceType } from "../../shared/kernel/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

/** رسالة الخطأ الموحّدة عند ردّ غير مفهوم — الردّ المكسور عطل تقني لا نتيجة عمل. */
function unreadable(fn: string): never {
  throw new Error(`ردّ ${fn} غير مفهوم`);
}

export function createUnsubscribedCyclePort(sql: Sql): UnsubscribedCyclePort {
  return {
    openCycle: (orderId: OrderId) =>
      guard("rpc.open_unsubscribed_cycle", async (): Promise<OpenCycleOutcome> => {
        const rows = await sql<{ result: unknown }[]>`
          select open_unsubscribed_cycle(${orderId}::uuid) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) unreadable("open_unsubscribed_cycle");
        if (!envelope.ok) {
          return { opened: false, reason: String(envelope.error ?? "UNKNOWN") };
        }
        return {
          opened: true,
          cycle: {
            negotiationId: String(envelope.negotiation_id),
            cycle: Number(envelope.cycle),
            cityId: String(envelope.city_id) as CityId,
            service: String(envelope.service) as ServiceType,
            groupId: String(envelope.group_id),
            collectDeadline: new Date(String(envelope.collect_deadline)),
            excludedDriverIds: ((envelope.excluded_driver_ids ?? []) as string[]).map(
              (id) => id as DriverId,
            ),
          },
        };
      }),

    attachGroupMessage: (negotiationId: string, messageId: string) =>
      guard("negotiations.attachGroupMessage", async () => {
        await sql`
          update unsubscribed_negotiations
             set group_message_id = ${messageId}::bigint
           where id = ${negotiationId}::uuid
        `;
      }),
  };
}

export function createOrderNotesReader(sql: Sql): OrderNotesReader {
  return {
    readNotes: (orderId: OrderId) =>
      guard("orders.readNotes", async () => {
        const rows = await sql<{ notes: string | null }[]>`
          select notes from orders where id = ${orderId}
        `;
        return rows[0]?.notes ?? null;
      }),
  };
}

export function createClaimRegistrationPort(sql: Sql): ClaimRegistrationPort {
  return {
    registerClaim: (negotiationId: string, driverId: DriverId) =>
      guard("rpc.register_unsubscribed_claim", async (): Promise<ClaimRegistration> => {
        const rows = await sql<{ result: unknown }[]>`
          select register_unsubscribed_claim(${negotiationId}::uuid, ${driverId}::uuid) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) unreadable("register_unsubscribed_claim");
        if (!envelope.ok) {
          return { registered: false, reason: String(envelope.error ?? "UNKNOWN") };
        }
        return {
          registered: true,
          claimId: String(envelope.claim_id),
          orderId: String(envelope.order_id) as OrderId,
          position: Number(envelope.position),
          slots: Number(envelope.slots),
          isActive: envelope.is_active === true,
        };
      }),
  };
}

export function createNegotiationRotationPort(sql: Sql): NegotiationRotationPort {
  return {
    advance: (negotiationId: string, reason: "declined" | "expired") =>
      guard("rpc.advance_unsubscribed_negotiation", async (): Promise<AdvanceOutcome> => {
        const rows = await sql<{ result: unknown }[]>`
          select advance_unsubscribed_negotiation(${negotiationId}::uuid, ${reason}) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) unreadable("advance_unsubscribed_negotiation");
        if (!envelope.ok) {
          return { advanced: false, reason: String(envelope.error ?? "UNKNOWN") };
        }
        const orderId = String(envelope.order_id) as OrderId;
        if (envelope.exhausted === true) {
          return { advanced: true, exhausted: true, orderId };
        }
        return {
          advanced: true,
          exhausted: false,
          claimId: String(envelope.claim_id),
          position: Number(envelope.position),
          orderId,
        };
      }),

    settle: (negotiationId: string) =>
      guard("rpc.settle_unsubscribed_negotiation", async (): Promise<SettleOutcome> => {
        const rows = await sql<{ result: unknown }[]>`
          select settle_unsubscribed_negotiation(${negotiationId}::uuid) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) unreadable("settle_unsubscribed_negotiation");
        if (!envelope.ok) {
          return { settled: false, reason: String(envelope.error ?? "UNKNOWN") };
        }
        return {
          settled: true,
          orderId: String(envelope.order_id) as OrderId,
          driverId: String(envelope.driver_id),
        };
      }),

    close: (negotiationId: string, reason: string) =>
      guard("rpc.close_unsubscribed_negotiation", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select close_unsubscribed_negotiation(${negotiationId}::uuid, ${reason}) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) unreadable("close_unsubscribed_negotiation");
        return envelope.ok;
      }),
  };
}

export function createEscalationPort(sql: Sql): EscalationPort {
  return {
    escalate: (orderId: OrderId, reason: EscalationReason) =>
      guard("rpc.escalate_order", async (): Promise<EscalationOutcome> => {
        const rows = await sql<{ result: unknown }[]>`
          select escalate_order(${orderId}::uuid, ${reason}) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) unreadable("escalate_order");
        if (!envelope.ok) {
          return { escalated: false, reason: String(envelope.error ?? "UNKNOWN") };
        }
        return {
          escalated: true,
          groupId: String(envelope.group_id),
          cityId: String(envelope.city_id) as CityId,
          service: String(envelope.service) as ServiceType,
        };
      }),
  };
}

interface PartiesRow {
  readonly negotiation_id: string;
  readonly order_id: string;
  readonly driver_id: string;
  readonly driver_chat_id: string;
  readonly driver_language: string;
  readonly rider_chat_id: string;
  readonly rider_language: string;
  readonly position: number;
}

/**
 * طرفا القناة: معرّفا محادثة تلغرام فقط. رقما الهاتف موجودان في users لكنهما
 * لا يُقرآن هنا إطلاقاً — ما لا يُقرأ لا يُسرَّب.
 */
const PARTIES_SELECT = `
  select n.id            as negotiation_id,
         n.order_id      as order_id,
         c.driver_id     as driver_id,
         du.telegram_id::text as driver_chat_id,
         du.language_code as driver_language,
         ru.telegram_id::text as rider_chat_id,
         ru.language_code as rider_language,
         c.position      as position
    from unsubscribed_negotiations n
    join unsubscribed_claims c on c.id = n.active_claim_id
    join drivers d  on d.id = c.driver_id
    join users   du on du.id = d.user_id
    join orders  o  on o.id = n.order_id
    join riders  r  on r.id = o.rider_id
    join users   ru on ru.id = r.user_id
   where n.status = 'negotiating'
`;

function toParties(row: PartiesRow): NegotiationParties {
  return {
    negotiationId: row.negotiation_id,
    orderId: row.order_id as OrderId,
    driverId: row.driver_id as DriverId,
    driverChatId: row.driver_chat_id,
    driverLanguage: row.driver_language,
    riderChatId: row.rider_chat_id,
    riderLanguage: row.rider_language,
    position: row.position,
  };
}

export function createNegotiationPartiesReader(sql: Sql): NegotiationPartiesReader {
  return {
    findParties: (negotiationId: string) =>
      guard("negotiations.findParties", async () => {
        const rows = await sql.unsafe<PartiesRow[]>(`${PARTIES_SELECT} and n.id = $1::uuid`, [
          negotiationId,
        ]);
        const row = rows[0];
        return row === undefined ? null : toParties(row);
      }),
  };
}

export function createActiveNegotiationLookup(sql: Sql): ActiveNegotiationLookup {
  return {
    forDriver: (driverId: DriverId) =>
      guard("negotiations.forDriver", async () => {
        const rows = await sql.unsafe<PartiesRow[]>(
          `${PARTIES_SELECT} and c.driver_id = $1::uuid limit 1`,
          [driverId],
        );
        const row = rows[0];
        return row === undefined ? null : toParties(row);
      }),

    forRider: (riderId: RiderId) =>
      guard("negotiations.forRider", async () => {
        const rows = await sql.unsafe<PartiesRow[]>(
          `${PARTIES_SELECT} and o.rider_id = $1::uuid limit 1`,
          [riderId],
        );
        const row = rows[0];
        return row === undefined ? null : toParties(row);
      }),
  };
}

export function createNegotiationTimeoutReader(sql: Sql): NegotiationTimeoutReader {
  return {
    negotiateSecondsFor: (negotiationId: string) =>
      guard("negotiations.negotiateSeconds", async () => {
        const rows = await sql<{ seconds: string }[]>`
          select get_setting_number(n.city_id, 'unsubscribed_negotiate_seconds') as seconds
            from unsubscribed_negotiations n
           where n.id = ${negotiationId}::uuid
        `;
        const raw = rows[0]?.seconds;
        if (raw === undefined) throw new Error("دورة غير موجودة عند قراءة مهلة التفاوض");
        return Number(raw);
      }),
  };
}

interface SnapshotRow {
  readonly id: string;
  readonly order_id: string;
  readonly city_id: string;
  readonly cycle: number;
  readonly status: string;
  readonly active_claim_id: string | null;
  readonly active_driver_id: string | null;
  readonly collect_deadline: Date;
  readonly negotiate_deadline: Date | null;
  readonly max_cycles: string;
}

export function createNegotiationSnapshotReader(sql: Sql): NegotiationSnapshotReader {
  return {
    findPending: (cityId: CityId) =>
      guard("negotiations.findPending", async () => {
        const rows = await sql<SnapshotRow[]>`
          select n.id, n.order_id, n.city_id, n.cycle, n.status::text as status,
                 n.active_claim_id,
                 c.driver_id as active_driver_id,
                 n.collect_deadline, n.negotiate_deadline,
                 get_setting_number(n.city_id, 'unsubscribed_max_cycles') as max_cycles
            from unsubscribed_negotiations n
            left join unsubscribed_claims c on c.id = n.active_claim_id
           where n.city_id = ${cityId}
             and n.status in ('collecting', 'negotiating', 'exhausted')
             -- أحدث دورة لكل طلب فقط: دورة قديمة منفودة خُلِفت بأخرى لا يُعاد نشرها
             and n.cycle = (
               select max(m.cycle) from unsubscribed_negotiations m
                where m.order_id = n.order_id
             )
           order by n.created_at
        `;
        return rows.map((row) => ({
          snapshot: {
            negotiationId: row.id,
            orderId: row.order_id as OrderId,
            cityId: row.city_id as CityId,
            cycle: row.cycle,
            status: row.status as NegotiationStatus,
            activeClaimId: row.active_claim_id,
            activeDriverId: row.active_driver_id as DriverId | null,
            collectDeadline: new Date(row.collect_deadline),
            negotiateDeadline:
              row.negotiate_deadline === null ? null : new Date(row.negotiate_deadline),
          } satisfies NegotiationSnapshot,
          maxCycles: Number(row.max_cycles),
        }));
      }),
  };
}
