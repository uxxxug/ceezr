import { describe, expect, it } from "bun:test";
import {
  auditRequiredJobs,
  auditRunManifest,
  REQUIRED_FIELDS,
  REQUIRED_JOBS,
  type RunManifest,
} from "../../scripts/lib/run-manifest.ts";

/** بصمةٌ صالحةٌ كاملةٌ. */
function validManifest(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    job: "verify",
    runUrl: "https://github.com/example/repo/actions/runs/1",
    commitSha: "abc123",
    ref: "refs/heads/main",
    event: "push",
    verdict: "success",
    bunVersion: "1.4.2",
    nodeVersion: "v22.0.0",
    envKeyFingerprint: "a1b2c3d4e5f6a7b8",
    dbProbe: "alive",
    redisProbe: null,
    migrationFingerprint: "f0e1d2c3b4a5",
    knownLimits: "حدٌّ معلَنٌ.",
    timestamp: "2026-09-18T12:00:00.000Z",
    ...overrides,
  };
}

describe("حاجزُ بصمةِ التشغيل — سالباتٌ مزروعةٌ لكلِّ قاعدةٍ (F9-05)", () => {
  describe("auditRunManifest", () => {
    it("بصمةٌ صالحةٌ تُقبَل", () => {
      const raw = JSON.stringify(validManifest());
      const { manifest, violations } = auditRunManifest(raw, "verify");
      expect(violations).toEqual([]);
      expect(manifest).not.toBeNull();
    });

    it("بصمةٌ ليست JSON تُسقِط", () => {
      const { manifest, violations } = auditRunManifest("not json", "verify");
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe("manifest.parseable");
      expect(manifest).toBeNull();
    });

    it("حقلٌ غائبٌ يُسقِط", () => {
      const m = validManifest();
      const { job, ...rest } = m;
      void job;
      const raw = JSON.stringify(rest);
      const { violations } = auditRunManifest(raw, "verify");
      expect(violations.some((v) => v.rule === "manifest.field-present")).toBe(true);
    });

    it("حكمٌ غيرُ صالحٍ يُسقِط", () => {
      const raw = JSON.stringify(validManifest({ verdict: "maybe" as never }));
      const { violations } = auditRunManifest(raw, "verify");
      expect(violations.some((v) => v.rule === "manifest.verdict-valid")).toBe(true);
    });

    it("اسمُ وظيفةٍ لا يطابق يُسقِط", () => {
      const raw = JSON.stringify(validManifest({ job: "integration" }));
      const { violations } = auditRunManifest(raw, "verify");
      expect(violations.some((v) => v.rule === "manifest.job-matches")).toBe(true);
    });

    it("بصمةُ مفاتيحَ أطولُ من ٢٥٦ تُسقِط", () => {
      const long = "x".repeat(300);
      const raw = JSON.stringify(validManifest({ envKeyFingerprint: long }));
      const { violations } = auditRunManifest(raw, "verify");
      expect(violations.some((v) => v.rule === "manifest.no-env-values")).toBe(true);
    });

    it("dbProbe=null مقبولٌ لكنَّ غيابَ الحقلِ يُسقِط", () => {
      const m = validManifest();
      const { dbProbe, ...rest } = m;
      void dbProbe;
      const raw = JSON.stringify(rest);
      const { violations } = auditRunManifest(raw, "verify");
      expect(violations.some((v) => v.rule === "manifest.field-present")).toBe(true);
    });

    it("dbProbe=null موجودٌ مقبول", () => {
      const raw = JSON.stringify(validManifest({ dbProbe: null }));
      const { violations } = auditRunManifest(raw, "verify");
      expect(violations).toEqual([]);
    });
  });

  describe("auditRequiredJobs", () => {
    it("كلُّ الوظائفِ بصمةٌ صالحةٌ تُقبَل", () => {
      const manifests: Record<string, string | null> = {};
      for (const job of REQUIRED_JOBS) {
        manifests[job] = JSON.stringify(validManifest({ job }));
      }
      const violations = auditRequiredJobs(manifests);
      expect(violations).toEqual([]);
    });

    it("وظيفةٌ غائبةٌ تُسقِط", () => {
      const manifests: Record<string, string | null> = {};
      for (const job of REQUIRED_JOBS) {
        manifests[job] = job === "verify" ? null : JSON.stringify(validManifest({ job }));
      }
      const violations = auditRequiredJobs(manifests);
      expect(violations.some((v) => v.rule === "manifest.job-produced")).toBe(true);
    });

    it("كلُّ الحقولِ الواجبةِ معرُوفةٌ", () => {
      expect(REQUIRED_FIELDS.length).toBe(14);
      expect(REQUIRED_JOBS.length).toBe(4);
    });
  });
});
