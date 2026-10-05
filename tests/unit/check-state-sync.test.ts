import { checkStateSync, type StateSyncInput } from "../../scripts/check-state-sync";

describe("check-state-sync", () => {
  it("passes when no implementation files changed", () => {
    const input: StateSyncInput = {
      changedFiles: ["docs/README.md", "README.md"],
    };
    const result = checkStateSync(input);
    expect(result.ok).toBe(true);
    expect(result.implChanged).toHaveLength(0);
  });

  it("fails when implementation files changed without state docs", () => {
    const input: StateSyncInput = {
      changedFiles: ["apps/miniapp/src/App.tsx", "packages/shared/index.ts"],
    };
    const result = checkStateSync(input);
    expect(result.ok).toBe(false);
    expect(result.implChanged).toHaveLength(2);
    expect(result.stateChanged).toHaveLength(0);
  });

  it("passes when implementation files changed with state docs", () => {
    const input: StateSyncInput = {
      changedFiles: ["apps/miniapp/src/App.tsx", "docs/SYSTEM_STATE.md"],
    };
    const result = checkStateSync(input);
    expect(result.ok).toBe(true);
    expect(result.implChanged).toHaveLength(1);
    expect(result.stateChanged).toHaveLength(1);
  });

  it("passes when only docs changed", () => {
    const input: StateSyncInput = {
      changedFiles: ["docs/UI_UX_CANONICAL_DIRECTIVE.md"],
    };
    const result = checkStateSync(input);
    expect(result.ok).toBe(true);
    expect(result.implChanged).toHaveLength(0);
  });

  it("detects render.yaml as implementation", () => {
    const input: StateSyncInput = {
      changedFiles: ["render.yaml"],
    };
    const result = checkStateSync(input);
    expect(result.ok).toBe(false);
    expect(result.implChanged).toHaveLength(1);
  });

  it("detects .github/workflows as implementation", () => {
    const input: StateSyncInput = {
      changedFiles: [".github/workflows/ci.yml"],
    };
    const result = checkStateSync(input);
    expect(result.ok).toBe(false);
    expect(result.implChanged).toHaveLength(1);
  });

  it("detects supabase migrations as implementation", () => {
    const input: StateSyncInput = {
      changedFiles: ["supabase/migrations/001.sql"],
    };
    const result = checkStateSync(input);
    expect(result.ok).toBe(false);
    expect(result.implChanged).toHaveLength(1);
  });

  it("detects scripts as implementation", () => {
    const input: StateSyncInput = {
      changedFiles: ["scripts/check-state-sync.ts"],
    };
    const result = checkStateSync(input);
    expect(result.ok).toBe(false);
    expect(result.implChanged).toHaveLength(1);
  });

  it("passes when scripts changed with ROADMAP.md", () => {
    const input: StateSyncInput = {
      changedFiles: ["scripts/check-state-sync.ts", "ROADMAP.md"],
    };
    const result = checkStateSync(input);
    expect(result.ok).toBe(true);
    expect(result.stateChanged).toHaveLength(1);
  });

  it("passes when implementation changed with UI_UX_CANONICAL_DIRECTIVE", () => {
    const input: StateSyncInput = {
      changedFiles: ["apps/miniapp/src/styles/global.css", "docs/UI_UX_CANONICAL_DIRECTIVE.md"],
    };
    const result = checkStateSync(input);
    expect(result.ok).toBe(true);
  });
});
