import { describe, expect, it, mock } from "bun:test";
import type {
  DriverDocumentDeps,
  DriverDocumentRejection,
} from "../../packages/application/driver/driver-documents.ts";
import { recordDriverDocument } from "../../packages/application/driver/driver-documents.ts";
import type { ObjectExistenceChecker, ObjectExistenceFailure } from "../../packages/application/driver/ports.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

function createMockDeps(overrides?: {
  readonly existenceChecker?: ObjectExistenceChecker;
}): DriverDocumentDeps {
  return {
    sessions: {
      read: mock(() => Promise.resolve({ ok: true, value: "123456789" })),
    },
    store: {
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
      dashboard: mock(() =>
        Promise.resolve({
          ok: true,
          value: { documents: [], missing: [], statuses: [] },
        }),
      ),
      submitForReview: mock(() =>
        Promise.resolve({
          ok: true,
          value: { submitted: true, statuses: [] },
        }),
      ),
    },
    now: () => new Date("2026-10-01"),
    existenceChecker: overrides?.existenceChecker,
  } as unknown as DriverDocumentDeps;
}

const validInput = {
  accessToken: "Bearer test-token",
  docType: "driving_license",
  objectPath: "driver-123/license.pdf",
  expiresAt: "2027-01-01",
};

describe("recordDriverDocument — existenceChecker", () => {
  it("يُسجِّلُ حينَ الكائنُ موجودٌ", async () => {
    const checker: ObjectExistenceChecker = {
      checkExists: mock(() => Promise.resolve(ok(true))),
    };
    const deps = createMockDeps({ existenceChecker: checker });

    const result = await recordDriverDocument(deps, validInput);

    expect(result.ok).toBe(true);
  });

  it("يَرفُضُ بـ OBJECT_NOT_FOUND حينَ الكائنُ غيرُ موجودٍ", async () => {
    const checker: ObjectExistenceChecker = {
      checkExists: mock(() => Promise.resolve(ok(false))),
    };
    const deps = createMockDeps({ existenceChecker: checker });

    const result = await recordDriverDocument(deps, validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as DriverDocumentRejection).code).toBe("OBJECT_NOT_FOUND");
    }
  });

  it("يَرفُضُ بـ OBJECT_PATH_NOT_MINE حينَ الفاحصُ يَفشَلُ", async () => {
    const checker: ObjectExistenceChecker = {
      checkExists: mock(() => Promise.resolve(err<ObjectExistenceFailure>("CHECKER_UNAVAILABLE"))),
    };
    const deps = createMockDeps({ existenceChecker: checker });

    const result = await recordDriverDocument(deps, validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as DriverDocumentRejection).code).toBe("OBJECT_PATH_NOT_MINE");
    }
  });

  it("يُسجِّلُ بلا فاحصٍ — السلوكُ كالسابقِ", async () => {
    const deps = createMockDeps();

    const result = await recordDriverDocument(deps, validInput);

    expect(result.ok).toBe(true);
  });
});
