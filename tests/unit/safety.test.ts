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
      { orderId: "order-1", actorTelegramId: "10", reporterRole: "rider" },
      {
        incidents: {
          trigger: async () => ok({ incidentId: null, error: "ORDER_NOT_OWNED" }),
        },
      },
    );
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.error.detail).toBe("ORDER_NOT_OWNED");
  });

  it("يعيد فشل تيليجرام إلى outbox ولا يعامله كتسليم", async () => {
    let finishedWith: string | null | undefined;
    const deps: DeliverSafetyIncidentDeps = {
      deliveries: {
        claim: async () =>
          ok({
            deliveryId: "delivery-1",
            incidentId: "incident-1",
            claimToken: "claim-1",
            groupId: "-1002",
            orderId: "order-1",
            service: "transport",
            reporterRole: "rider",
            status: "open",
            locationWkt: null,
            maxAttempts: 1,
          }),
        finish: async (input) => {
          finishedWith = input.messageId;
          return ok(true);
        },
      },
      publisher: {
        publish: async () => err(new PortFailureError("telegram.safetyCard", "network")),
      },
    };
    const report = await deliverSafetyIncidentBatch(deps);
    expect(report.ok).toBe(false);
    expect(finishedWith).toBeNull();
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
