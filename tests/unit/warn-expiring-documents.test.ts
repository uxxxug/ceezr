import { describe, expect, it } from "bun:test";
import {
  warnExpiringDocuments,
  type DocumentExpiryRpcPort,
  type DocumentExpiryWarningSender,
} from "../../packages/application/driver/warn-expiring-documents.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";

const cityId = "00000000-0000-0000-0000-000000000001" as CityId;

interface MockDocument {
  documentId: string;
  driverId: string;
  telegramId: string;
  languageCode: string;
  docType: string;
  expiresAt: string;
  daysLeft: number;
}

function createMockRpc(documents: readonly MockDocument[]): DocumentExpiryRpcPort {
  return {
    expiringSoon: async () => ok(documents),
    recordWarning: async () => ok(undefined),
  };
}

function createMockSender(shouldFail = false): DocumentExpiryWarningSender & {
  sent: { chatId: string; text: string }[];
} {
  const sent: { chatId: string; text: string }[] = [];
  return {
    send: async ({ chatId, text }) => {
      sent.push({ chatId, text });
      if (shouldFail) {
        return err(new PortFailureError("telegram.sendMessage", "blocked"));
      }
      return ok(undefined);
    },
    sent,
  };
}

describe("warnExpiringDocuments", () => {
  it("يرسل إشعارًا لكل وثيقة تنتهي قريبًا", async () => {
    const rpc = createMockRpc([
      {
        documentId: "doc-1",
        driverId: "driver-1",
        telegramId: "12345",
        languageCode: "ar",
        docType: "driving_license",
        expiresAt: "2026-11-01",
        daysLeft: 25,
      },
    ]);
    const sender = createMockSender();

    const result = await warnExpiringDocuments({ cityId, days: 30 }, { rpc, sender });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.examined).toBe(1);
      expect(result.value.warned).toBe(1);
      expect(result.value.failed).toHaveLength(0);
    }
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].chatId).toBe("12345");
    expect(sender.sent[0].text).toContain("رخصة القيادة");
  });

  it("يسجل التحذير بعد الإرسال الناجح", async () => {
    let warningRecorded = false;
    const rpc = createMockRpc([
      {
        documentId: "doc-1",
        driverId: "driver-1",
        telegramId: "12345",
        languageCode: "ar",
        docType: "medical_exam",
        expiresAt: "2026-11-01",
        daysLeft: 20,
      },
    ]);
    const rpcWithTracking: DocumentExpiryRpcPort = {
      expiringSoon: rpc.expiringSoon,
      recordWarning: async (id) => {
        warningRecorded = id === "doc-1";
        return ok(undefined);
      },
    };
    const sender = createMockSender();

    await warnExpiringDocuments({ cityId, days: 30 }, { rpc: rpcWithTracking, sender });

    expect(warningRecorded).toBe(true);
  });

  it("لا يسجل التحذير عند فشل الإرسال ويضع الوثيقة في قائمة الفشل", async () => {
    const rpc = createMockRpc([
      {
        documentId: "doc-1",
        driverId: "driver-1",
        telegramId: "12345",
        languageCode: "ar",
        docType: "insurance",
        expiresAt: "2026-11-01",
        daysLeft: 15,
      },
    ]);
    const sender = createMockSender(true);

    const result = await warnExpiringDocuments({ cityId, days: 30 }, { rpc, sender });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.examined).toBe(1);
      expect(result.value.warned).toBe(0);
      expect(result.value.failed).toEqual(["doc-1"]);
    }
  });

  it("يعمل بلا وثائق منتهية قريبًا", async () => {
    const rpc = createMockRpc([]);
    const sender = createMockSender();

    const result = await warnExpiringDocuments({ cityId, days: 30 }, { rpc, sender });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.examined).toBe(0);
      expect(result.value.warned).toBe(0);
    }
    expect(sender.sent).toHaveLength(0);
  });

  it("يعيد فشل RPC عند فشل الاستعلام", async () => {
    const rpc: DocumentExpiryRpcPort = {
      expiringSoon: async () => err(new PortFailureError("rpc", "connection lost")),
      recordWarning: async () => ok(undefined),
    };
    const sender = createMockSender();

    const result = await warnExpiringDocuments({ cityId, days: 30 }, { rpc, sender });

    expect(result.ok).toBe(false);
  });

  it("يواصل بقية الدفعة عند فشل إرسال واحد", async () => {
    const rpc = createMockRpc([
      {
        documentId: "doc-1",
        driverId: "driver-1",
        telegramId: "111",
        languageCode: "ar",
        docType: "driving_license",
        expiresAt: "2026-11-01",
        daysLeft: 25,
      },
      {
        documentId: "doc-2",
        driverId: "driver-2",
        telegramId: "222",
        languageCode: "ar",
        docType: "insurance",
        expiresAt: "2026-11-01",
        daysLeft: 25,
      },
    ]);
    const sender: DocumentExpiryWarningSender & { sent: { chatId: string; text: string }[] } = {
      send: async ({ chatId }) => {
        if (chatId === "111") {
          return err(new PortFailureError("telegram.sendMessage", "blocked"));
        }
        return ok(undefined);
      },
      sent: [],
    };

    const result = await warnExpiringDocuments({ cityId, days: 30 }, { rpc, sender });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.examined).toBe(2);
      expect(result.value.warned).toBe(1);
      expect(result.value.failed).toEqual(["doc-1"]);
    }
  });
});
