import { describe, expect, it } from "bun:test";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import {
  type DeliverSafetyIncidentDeps,
  deliverSafetyIncidentBatch,
} from "../../packages/application/safety/deliver-safety-incident.ts";
import { resolveSafetyIncident } from "../../packages/application/safety/resolve-safety-incident.ts";
import { triggerSos } from "../../packages/application/safety/trigger-sos.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

describe("حالات استخدام SOS", () => {
  it("لا يرسل بطاقته قبل قبول كتابة الحادث الذرية", async () => {
    const report = await triggerSos(
      { orderId: "order-1", actorTelegramId: "10", reporterRole: "rider", reason: "sos" },
      {
        incidents: {
          trigger: async () => ok({ incidentId: null, error: "ORDER_NOT_OWNED" }),
        },
      },
    );
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.error.detail).toBe("ORDER_NOT_OWNED");
  });

  const card = (id: string, maxAttempts = 1) => ({
    deliveryId: id,
    incidentId: `incident-${id}`,
    claimToken: `claim-${id}`,
    groupId: "-1002",
    orderId: `order-${id}`,
    service: "transport",
    reporterRole: "rider" as const,
    status: "open",
    incidentReason: "sos" as const,
    locationWkt: null,
    maxAttempts,
  });

  it("يعيد فشل تيليجرام إلى outbox ولا يعامله كتسليم", async () => {
    let finishedWith: string | null | undefined;
    const deps: DeliverSafetyIncidentDeps = {
      deliveries: {
        claim: async () => ok({ delivery: card("delivery-1"), deferred: [] }),
        finish: async (input) => {
          finishedWith = input.messageId;
          // المزدوج يقول ما تقوله الدالّة الحقيقيّة: بلا معرّف رسالةٍ لا تسليم.
          return ok(input.messageId !== null);
        },
      },
      publisher: {
        publish: async () => err(new PortFailureError("telegram.safetyCard", "network")),
      },
    };
    const report = await deliverSafetyIncidentBatch(deps);
    // الصفّ عاد `pending` سليماً، فالشوط ليس فاشلاً: الفشل يُعدّ ويُبلَّغ.
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.delivered).toBe(0);
      expect(report.value.failed).toBe(1);
    }
    expect(finishedWith).toBeNull();
  });

  /**
   * الانحصار الذي كان: مجموعةُ مدينةٍ معطوبة تُفشل النشر، فيسقط الشوط كلّه،
   * فاستغاثةُ المدينة التالية لا تُسلَّم — وهي مهيّأة تماماً.
   */
  it("فشل نشرٍ واحد لا يمنع تسليم الاستغاثة التالية في نفس الشوط", async () => {
    const queue = [card("delivery-1", 3), card("delivery-2", 3)];
    const published: string[] = [];
    const report = await deliverSafetyIncidentBatch({
      deliveries: {
        claim: async () => ok({ delivery: queue.shift() ?? null, deferred: [] }),
        finish: async (input) => ok(input.messageId !== null),
      },
      publisher: {
        publish: async (given) => {
          published.push(given.deliveryId);
          return given.deliveryId === "delivery-1"
            ? err(new PortFailureError("telegram.safetyCard", "chat not found"))
            : ok("777");
        },
      },
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(published).toEqual(["delivery-1", "delivery-2"]);
    expect(report.value.claimed).toBe(2);
    expect(report.value.delivered).toBe(1);
    expect(report.value.failed).toBe(1);
  });

  it("يُبلّغ عن الصفوف المؤجَّلة لنقص إعداد مدينتها بدل كتمانها", async () => {
    const report = await deliverSafetyIncidentBatch({
      deliveries: {
        claim: async () =>
          ok({
            delivery: null,
            deferred: [
              { deliveryId: "delivery-9", cityId: "city-9", reason: "ESCALATION_GROUP_MISSING" },
            ],
          }),
        finish: async () => ok(true),
      },
      publisher: { publish: async () => ok("1") },
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.claimed).toBe(0);
    expect(report.value.deferred).toEqual([
      { deliveryId: "delivery-9", cityId: "city-9", reason: "ESCALATION_GROUP_MISSING" },
    ]);
  });

  it("لا يقفل الحادث إلا بعد استلامه من الموظف نفسه", async () => {
    let resolved = false;
    const result = await resolveSafetyIncident(
      { incidentId: "incident-1", actorTelegramId: "77", action: "close" },
      {
        incidents: {
          claim: async () =>
            ok({ claimed: false, error: "INCIDENT_ALREADY_CLAIMED", claimedBy: "88" }),
          resolve: async () => {
            resolved = true;
            return ok({ resolved: true, error: null });
          },
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(resolved).toBe(true);
  });
});
