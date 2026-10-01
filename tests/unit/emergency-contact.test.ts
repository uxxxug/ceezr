import { describe, expect, it } from "bun:test";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import {
  type EmergencyContactDeps,
  normalizeContactName,
  normalizeContactPhone,
  readEmergencyContact,
  upsertEmergencyContact,
} from "../../packages/application/safety/emergency-contact.ts";
import type {
  EmergencyContactReader,
  EmergencyContactStoreFailure,
  EmergencyContactWriter,
} from "../../packages/application/safety/ports.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

function makeDeps(overrides: Partial<EmergencyContactDeps> = {}): EmergencyContactDeps {
  const noopReader: EmergencyContactReader = {
    read: async () => ok(null),
  };
  const noopWriter: EmergencyContactWriter = {
    upsert: async () => ok({ status: "saved" }),
  };
  const noopSessions: MiniAppSessionReader = {
    read: async () =>
      ok({
        telegramUserId: "123456789",
        bot: "rider",
        sessionId: "s1",
        issuedAtSeconds: 0,
        expiresAtSeconds: 9999999999,
      }),
  } as unknown as MiniAppSessionReader;
  return {
    sessions: noopSessions,
    reader: noopReader,
    writer: noopWriter,
    now: () => new Date(),
    ...overrides,
  } as EmergencyContactDeps;
}

describe("DEC-41 emergency contact validation", () => {
  it("normalizeContactName accepts valid name", () => {
    expect(normalizeContactName("أحمد")).toBe("أحمد");
    expect(normalizeContactName("  John  ")).toBe("John");
  });

  it("normalizeContactName rejects empty and too long", () => {
    expect(normalizeContactName("")).toBeNull();
    expect(normalizeContactName("  ")).toBeNull();
    expect(normalizeContactName("x".repeat(121))).toBeNull();
    expect(normalizeContactName(123)).toBeNull();
  });

  it("normalizeContactPhone accepts digits only", () => {
    expect(normalizeContactPhone("0501234567")).toBe("0501234567");
  });

  it("normalizeContactPhone rejects non-digits and wrong length", () => {
    expect(normalizeContactPhone("+966501234567")).toBeNull();
    expect(normalizeContactPhone("123")).toBeNull();
    expect(normalizeContactPhone("abcdefghijklmnopqrstuvwxyz")).toBeNull();
  });
});

describe("DEC-41 read emergency contact", () => {
  it("قراءةُ جهةٍ موجودةٍ تُرجِعُها", async () => {
    const reader: EmergencyContactReader = {
      read: async () => ok({ name: "أحمد", phone: "0501234567" }),
    };
    const result = await readEmergencyContact(makeDeps({ reader }), { accessToken: "token" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value?.name).toBe("أحمد");
      expect(result.value?.phone).toBe("0501234567");
    }
  });

  it("غيابُ الجلسةِ يُرجِعُ SESSION_REQUIRED", async () => {
    const result = await readEmergencyContact(makeDeps(), { accessToken: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SESSION_REQUIRED");
  });
});

describe("DEC-41 upsert emergency contact", () => {
  it("حفظُ جهةٍ صحيحةٍ يُرجِعُ saved", async () => {
    const result = await upsertEmergencyContact(makeDeps(), {
      accessToken: "token",
      body: { name: "أحمد", phone: "0501234567" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("saved");
  });

  it("اسمٌ فارغٌ يُرجِعُ MALFORMED", async () => {
    const result = await upsertEmergencyContact(makeDeps(), {
      accessToken: "token",
      body: { name: "", phone: "0501234567" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("MALFORMED");
  });

  it("هاتفٌ غيرُ رقميٍّ يُرجِعُ MALFORMED", async () => {
    const result = await upsertEmergencyContact(makeDeps(), {
      accessToken: "token",
      body: { name: "أحمد", phone: "not-a-number" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("MALFORMED");
  });

  it("غيابُ الجلسةِ يُرجِعُ SESSION_REQUIRED", async () => {
    const result = await upsertEmergencyContact(makeDeps(), {
      accessToken: undefined,
      body: { name: "أحمد", phone: "0501234567" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SESSION_REQUIRED");
  });

  it("فشلُ المخزنِ يُرجِعُ EMERGENCY_CONTACT_STORE_NOT_AVAILABLE", async () => {
    const writer: EmergencyContactWriter = {
      upsert: async () =>
        err({
          code: "EMERGENCY_CONTACT_STORE_FAILED",
          reason: "STORE_ERROR",
        } as EmergencyContactStoreFailure),
    };
    const result = await upsertEmergencyContact(makeDeps({ writer }), {
      accessToken: "token",
      body: { name: "أحمد", phone: "0501234567" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("EMERGENCY_CONTACT_STORE_NOT_AVAILABLE");
  });
});
