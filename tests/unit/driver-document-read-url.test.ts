import { describe, expect, it, mock } from "bun:test";
import type {
  DriverDocumentDeps,
  DriverDocumentRejection,
} from "../../packages/application/driver/driver-documents.ts";
import { readDriverDocumentUrl } from "../../packages/application/driver/driver-documents.ts";
import type { ReadUrlSigner } from "../../packages/infrastructure/storage/signed-read.ts";
import { ok } from "../../packages/shared/result/index.ts";

function createMockDeps(overrides?: {
  readonly readSigner?: ReadUrlSigner;
  readonly store?: {
    readObjectPath: ReturnType<typeof mock>;
    readDashboard: ReturnType<typeof mock>;
    submitForReview: ReturnType<typeof mock>;
    record: ReturnType<typeof mock>;
    requestSlot: ReturnType<typeof mock>;
  };
}): DriverDocumentDeps {
  return {
    sessions: {
      read: mock(() => Promise.resolve({ ok: true, value: "123456789" })),
    },
    store: overrides?.store ?? {
      readObjectPath: mock(() => Promise.resolve({ ok: true, value: "driver-123/license.pdf" })),
      readDashboard: mock(() =>
        Promise.resolve({ ok: true, value: { documents: [], missing: [], statuses: [] } }),
      ),
      submitForReview: mock(() =>
        Promise.resolve({ ok: true, value: { submitted: true, statuses: [] } }),
      ),
      record: mock(() =>
        Promise.resolve({
          ok: true,
          value: {
            documentId: "doc-1",
            docType: "driving_license" as const,
            status: "pending_review" as const,
            expiresAt: "2027-01-01",
            replaced: false,
          },
        }),
      ),
      requestSlot: mock(() => Promise.resolve({ ok: true, value: {} })),
    },
    now: () => new Date("2026-10-01"),
    readSigner: overrides?.readSigner,
  } as unknown as DriverDocumentDeps;
}

const validInput = {
  accessToken: "Bearer test-token",
  docType: "driving_license",
};

describe("readDriverDocumentUrl", () => {
  it("يُعيدُ رابطَ قراءةٍ موقَّعًا", async () => {
    const readSigner: ReadUrlSigner = {
      signRead: mock(() =>
        Promise.resolve(
          ok({
            readUrl: "https://storage.example.com/signed/read",
            expiresAtEpochMs: Date.now() + 300000,
          }),
        ),
      ),
    };
    const deps = createMockDeps({ readSigner });

    const result = await readDriverDocumentUrl(deps, validInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.readUrl).toBe("https://storage.example.com/signed/read");
    }
  });

  it("يَرفُضُ بـ OBJECT_NOT_SUBMITTED حينَ لم تُرفَعْ", async () => {
    const readSigner: ReadUrlSigner = {
      signRead: mock(() => Promise.resolve(ok({ readUrl: "", expiresAtEpochMs: 0 }))),
    };
    const store = {
      readObjectPath: mock(() => Promise.resolve(ok(null))),
      readDashboard: mock(() => Promise.resolve(ok({ documents: [], missing: [], statuses: [] }))),
      submitForReview: mock(() => Promise.resolve(ok({ submitted: true, statuses: [] }))),
      record: mock(() => Promise.resolve(ok({}))),
      requestSlot: mock(() => Promise.resolve(ok({}))),
    };
    const deps = createMockDeps({ readSigner, store: store as never });

    const result = await readDriverDocumentUrl(deps, validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as DriverDocumentRejection).code).toBe("OBJECT_NOT_SUBMITTED");
    }
  });

  it("يَرفُضُ بـ UPLOAD_NOT_AVAILABLE حينَ غيابُ المُوقِّعِ", async () => {
    const deps = createMockDeps();

    const result = await readDriverDocumentUrl(deps, validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as DriverDocumentRejection).code).toBe("UPLOAD_NOT_AVAILABLE");
    }
  });

  it("يَرفُضُ بـ DOC_TYPE_UNKNOWN لنوعٍ غيرِ معروفٍ", async () => {
    const readSigner: ReadUrlSigner = {
      signRead: mock(() => Promise.resolve(ok({ readUrl: "", expiresAtEpochMs: 0 }))),
    };
    const deps = createMockDeps({ readSigner });

    const result = await readDriverDocumentUrl(deps, {
      accessToken: "Bearer test-token",
      docType: "unknown_type",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as DriverDocumentRejection).code).toBe("DOC_TYPE_UNKNOWN");
    }
  });
});
