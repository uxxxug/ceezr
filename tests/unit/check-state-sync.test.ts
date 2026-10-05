import { describe, expect, it } from "bun:test";
import {
  evaluateGovernanceSync,
  type GovernanceSyncInput,
  resolveRange,
  type WorkPacketManifest,
} from "../../scripts/check-state-sync";

const IMPL_FILE = "scripts/check-state-sync.ts";
const STATE_FILE = "docs/SYSTEM_STATE.md";
const ROADMAP_FILE = "ROADMAP.md";
const MANIFEST_PATH = "docs/work-packets/test.json";

function makeManifest(overrides: Partial<WorkPacketManifest> = {}): WorkPacketManifest {
  return {
    id: "test",
    implementation: [IMPL_FILE],
    state: [STATE_FILE],
    roadmap: [ROADMAP_FILE],
    affected_docs: [],
    no_other_affected_docs_reason: "test reason sufficient length",
    ...overrides,
  };
}

function makeInput(
  files: readonly string[],
  manifests: readonly WorkPacketManifest[] = [],
): GovernanceSyncInput {
  return { changedFiles: files, manifests };
}

describe("check-state-sync — governance evaluation", () => {
  // 1. implementation only → FAIL
  it("1) implementation only → FAIL (no state, no roadmap, no manifest)", () => {
    const result = evaluateGovernanceSync(makeInput([IMPL_FILE]));
    expect(result.ok).toBe(false);
    expect(result.implChanged).toHaveLength(1);
    expect(result.manifestCount).toBe(0);
  });

  // 2. implementation + SYSTEM_STATE → not enough (roadmap + manifest missing)
  it("2) implementation + SYSTEM_STATE only → FAIL (roadmap + manifest missing)", () => {
    const result = evaluateGovernanceSync(makeInput([IMPL_FILE, STATE_FILE]));
    expect(result.ok).toBe(false);
    expect(result.stateChanged).toHaveLength(1);
    expect(result.roadmapChanged).toHaveLength(0);
    expect(result.manifestCount).toBe(0);
  });

  // 3. implementation + ROADMAP → not enough (state + manifest missing)
  it("3) implementation + ROADMAP only → FAIL (state + manifest missing)", () => {
    const result = evaluateGovernanceSync(makeInput([IMPL_FILE, ROADMAP_FILE]));
    expect(result.ok).toBe(false);
    expect(result.stateChanged).toHaveLength(0);
    expect(result.roadmapChanged).toHaveLength(1);
    expect(result.manifestCount).toBe(0);
  });

  // 4. implementation + state + roadmap + manifest with affected docs → pass
  it("4) implementation + state + roadmap + manifest with all docs → PASS", () => {
    const manifest = makeManifest({
      affected_docs: ["docs/design.md"],
    });
    const result = evaluateGovernanceSync(
      makeInput([IMPL_FILE, STATE_FILE, ROADMAP_FILE, MANIFEST_PATH, "docs/design.md"], [manifest]),
    );
    expect(result.ok).toBe(true);
    expect(result.manifestCount).toBe(1);
  });

  // 5. manifest declares affected doc not in diff → FAIL
  it("5) manifest declares affected doc not modified → FAIL", () => {
    const manifest = makeManifest({
      affected_docs: ["docs/missing-doc.md"],
    });
    const result = evaluateGovernanceSync(
      makeInput([IMPL_FILE, STATE_FILE, ROADMAP_FILE, MANIFEST_PATH], [manifest]),
    );
    expect(result.ok).toBe(false);
    expect(result.declaredDocsMissing).toContain("docs/missing-doc.md");
  });

  // 6. docs-only PR → not rejected
  it("6) docs-only PR → PASS (no implementation change)", () => {
    const result = evaluateGovernanceSync(
      makeInput(["docs/README.md", "docs/UI_UX_CANONICAL_DIRECTIVE.md"]),
    );
    expect(result.ok).toBe(true);
    expect(result.implChanged).toHaveLength(0);
  });

  // 7. unaccounted doc (modified doc not in affected_docs) → FAIL
  it("7) modified doc not declared in affected_docs → FAIL", () => {
    const manifest = makeManifest({
      affected_docs: [],
      no_other_affected_docs_reason: "sufficient reason here",
    });
    const result = evaluateGovernanceSync(
      makeInput(
        [IMPL_FILE, STATE_FILE, ROADMAP_FILE, MANIFEST_PATH, "docs/some-other.md"],
        [manifest],
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.unaccountedDocs).toContain("docs/some-other.md");
  });

  // 8. manifest with empty affected_docs and no reason → FAIL
  it("8) empty affected_docs without reason → FAIL", () => {
    const manifest: WorkPacketManifest = {
      id: "test",
      implementation: [IMPL_FILE],
      state: [STATE_FILE],
      roadmap: [ROADMAP_FILE],
      affected_docs: [],
    };
    const result = evaluateGovernanceSync(
      makeInput([IMPL_FILE, STATE_FILE, ROADMAP_FILE, MANIFEST_PATH], [manifest]),
    );
    expect(result.ok).toBe(false);
  });

  // 9. implementation file not declared in manifest → FAIL
  it("9) implementation file not in manifest → FAIL (unaccountedImpl)", () => {
    const manifest = makeManifest({
      implementation: ["scripts/different.ts"],
    });
    const result = evaluateGovernanceSync(
      makeInput([IMPL_FILE, STATE_FILE, ROADMAP_FILE, MANIFEST_PATH], [manifest]),
    );
    expect(result.ok).toBe(false);
    expect(result.unaccountedImpl).toContain(IMPL_FILE);
  });

  // 10. full sync with empty affected_docs + reason → PASS
  it("10) full sync: impl + state + roadmap + manifest + reason → PASS", () => {
    const manifest = makeManifest({
      affected_docs: [],
      no_other_affected_docs_reason: "governance-only change, no product docs affected",
    });
    const result = evaluateGovernanceSync(
      makeInput([IMPL_FILE, STATE_FILE, ROADMAP_FILE, MANIFEST_PATH], [manifest]),
    );
    expect(result.ok).toBe(true);
  });

  // 11. multiple implementation files all declared → PASS
  it("11) multiple impl files all declared → PASS", () => {
    const manifest = makeManifest({
      implementation: [IMPL_FILE, "apps/miniapp/src/App.tsx", ".github/workflows/ci.yml"],
      affected_docs: [],
      no_other_affected_docs_reason: "multi-file governance change",
    });
    const result = evaluateGovernanceSync(
      makeInput(
        [
          IMPL_FILE,
          "apps/miniapp/src/App.tsx",
          ".github/workflows/ci.yml",
          STATE_FILE,
          ROADMAP_FILE,
          MANIFEST_PATH,
        ],
        [manifest],
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.unaccountedImpl).toHaveLength(0);
  });

  // 12. multiple implementation files, one not declared → FAIL
  it("12) multiple impl files, one undeclared → FAIL", () => {
    const manifest = makeManifest({
      implementation: [IMPL_FILE],
      affected_docs: [],
      no_other_affected_docs_reason: "governance change",
    });
    const result = evaluateGovernanceSync(
      makeInput(
        [IMPL_FILE, "apps/miniapp/src/App.tsx", STATE_FILE, ROADMAP_FILE, MANIFEST_PATH],
        [manifest],
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.unaccountedImpl).toContain("apps/miniapp/src/App.tsx");
  });

  // 13. package.json alone → treated as implementation, FAIL without state+roadmap+manifest
  it("13) package.json implementation-only → FAIL", () => {
    const result = evaluateGovernanceSync(makeInput(["package.json"]));
    expect(result.ok).toBe(false);
    expect(result.implChanged).toContain("package.json");
  });

  // 14. package.json + state + roadmap without manifest → FAIL
  it("14) package.json + state + roadmap without manifest → FAIL", () => {
    const result = evaluateGovernanceSync(makeInput(["package.json", STATE_FILE, ROADMAP_FILE]));
    expect(result.ok).toBe(false);
    expect(result.manifestCount).toBe(0);
  });

  // 15. package.json + state + roadmap + manifest correct → PASS
  it("15) package.json + state + roadmap + manifest correct → PASS", () => {
    const manifest = makeManifest({
      implementation: ["package.json"],
      affected_docs: [],
      no_other_affected_docs_reason: "dependency/config update only",
    });
    const result = evaluateGovernanceSync(
      makeInput(["package.json", STATE_FILE, ROADMAP_FILE, MANIFEST_PATH], [manifest]),
    );
    expect(result.ok).toBe(true);
  });

  // 16. implementation + README.md unauthorized → FAIL
  it("16) implementation + README.md unauthorized → FAIL", () => {
    const manifest = makeManifest({
      affected_docs: [],
      no_other_affected_docs_reason: "no docs affected",
    });
    const result = evaluateGovernanceSync(
      makeInput([IMPL_FILE, STATE_FILE, ROADMAP_FILE, MANIFEST_PATH, "README.md"], [manifest]),
    );
    expect(result.ok).toBe(false);
    expect(result.unaccountedDocs).toContain("README.md");
  });

  // 17. implementation + README.md authorized in affected_docs → PASS
  it("17) implementation + README.md authorized → PASS", () => {
    const manifest = makeManifest({
      affected_docs: ["README.md"],
    });
    const result = evaluateGovernanceSync(
      makeInput([IMPL_FILE, STATE_FILE, ROADMAP_FILE, MANIFEST_PATH, "README.md"], [manifest]),
    );
    expect(result.ok).toBe(true);
  });

  // 18. non-doc, non-impl file outside docs/ → not flagged as unaccounted doc
  it("18) misc/plain.txt not classified as doc → no unaccountedDocs", () => {
    const manifest = makeManifest({
      affected_docs: [],
      no_other_affected_docs_reason: "no docs affected",
    });
    const result = evaluateGovernanceSync(
      makeInput([IMPL_FILE, STATE_FILE, ROADMAP_FILE, MANIFEST_PATH, "misc/plain.txt"], [manifest]),
    );
    expect(result.unaccountedDocs).not.toContain("misc/plain.txt");
  });
});

describe("check-state-sync — range resolver", () => {
  // 7. range detection failure → FAIL (not pass)
  it("7) no range resolves → null (gate must fail)", () => {
    const gitFn = () => {
      throw new Error("not found");
    };
    const result = resolveRange(undefined, undefined, {}, gitFn);
    expect(result).toBeNull();
  });

  // 8. first push ZERO_SHA → falls through to merge-base
  it("8) first push ZERO_SHA → merge-base fallback", () => {
    const gitFn = (args: string[]) => {
      if (args[0] === "merge-base") return "abc123\n";
      throw new Error("unexpected");
    };
    const result = resolveRange(
      undefined,
      undefined,
      { BASE_SHA: "0000000000000000000000000000000000000000" },
      gitFn,
    );
    expect(result).not.toBeNull();
    expect(result?.base).toBe("abc123");
    expect(result?.head).toBe("HEAD");
  });

  // 9. merge-base fallback → works
  it("9) env base invalid → merge-base fallback works", () => {
    const gitFn = (args: string[]) => {
      if (args[0] === "rev-parse") throw new Error("invalid sha");
      if (args[0] === "merge-base" && args[1] === "origin/main") return "mergebase123\n";
      throw new Error("unexpected");
    };
    const result = resolveRange(undefined, undefined, { BASE_SHA: "invalidsha" }, gitFn);
    expect(result).not.toBeNull();
    expect(result?.base).toBe("mergebase123");
  });

  // 10. multi-file diff → analyzes full range
  it("10) args override env → uses provided base/head", () => {
    const gitFn = () => {
      throw new Error("should not be called");
    };
    const result = resolveRange("base123", "head456", { BASE_SHA: "should-not-use" }, gitFn);
    expect(result).not.toBeNull();
    expect(result?.base).toBe("base123");
    expect(result?.head).toBe("head456");
  });

  // 11. HEAD_SHA env overrides HEAD default
  it("11) HEAD_SHA env used when set", () => {
    const gitFn = (args: string[]) => {
      if (args[0] === "merge-base" && args[1] === "origin/main") return "mb123\n";
      throw new Error("unexpected");
    };
    const result = resolveRange(undefined, undefined, { HEAD_SHA: "custom-head-sha" }, gitFn);
    expect(result).not.toBeNull();
    expect(result?.head).toBe("custom-head-sha");
  });
});
