import { describe, expect, test } from "bun:test";
import { checkProductionReadinessGate } from "../../scripts/check-production-readiness-gate";

// Helper: builds a minimal gate with items of the given statuses.
// Each item gets an evidence path if `evidence` is true, an ADR path if `adr` is true.
function makeGate(
  items: { id: string; status: string; evidence?: boolean; adr?: boolean }[],
): string {
  let content = "# بوابة جاهزية الإنتاج\n\n## المرحلة\n\n";

  for (const item of items) {
    content += `### ${item.id}: بند اختبار\n\n| الحقل | القيمة |\n|---|---|\n`;
    content += `| المالك | Owner |\n`;
    content += `| الإجراء | إجراء اختبار |\n`;
    content += `| شرط القبول | شرط اختبار |\n`;
    if (item.evidence) {
      content += `| الدليل | docs/evidence/production/${item.id}-YYYYMMDD.md |\n`;
    }
    if (item.adr) {
      content += `| الدليل | docs/adr/0300-${item.id}-test.md |\n`;
    }
    content += `| الحالة | **${item.status}** |\n\n`;
  }

  return content;
}

const CLEAN_SYSTEM_STATE = "# System State\n\n> ليس Production Ready\n";
const CLEAN_ROADMAP = "# Roadmap\n\n> ليس Production Ready\n";
const CLEAN_ROADMAP_MASTER = "# Roadmap Master\n\n> ليس Production Ready\n";
const CLAIMING_READY = "# System State\n\n> Production Ready\n";

const CLEAN_INPUT = {
  systemStateContent: CLEAN_SYSTEM_STATE,
  roadmapContent: CLEAN_ROADMAP,
  roadmapMasterContent: CLEAN_ROADMAP_MASTER,
};

describe("check-production-readiness-gate", () => {
  // --- الحالات المانعة ---

  test("Open يمنع Production Ready لكن لا يُفشل CI وحده", () => {
    const gate = makeGate([
      { id: "PRD-001", status: "Open" },
      { id: "PRD-002", status: "Verified", evidence: true },
      ...Array.from({ length: 19 }, (_, i) => ({
        id: `PRD-${String(i + 10).padStart(3, "0")}`,
        status: "Verified",
        evidence: true,
      })),
    ]);
    const result = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
    });

    expect(result.fails).toBe(false); // البوابة المفتوحة حالة طبيعية
    expect(result.blockingItems).toContain("PRD-001 (Open)");
    // لكن ادعاء Production Ready معها يفشل
  });

  test("Open + ادعاء Production Ready يفشل CI", () => {
    const gate2 = makeGate([
      { id: "PRD-001", status: "Open" },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `PRD-${String(i + 2).padStart(3, "0")}`,
        status: "Verified" as const,
        evidence: true,
      })),
    ]);
    const result2 = checkProductionReadinessGate({
      gateContent: gate2,
      systemStateContent: CLAIMING_READY,
      roadmapContent: CLEAN_ROADMAP,
      roadmapMasterContent: CLEAN_ROADMAP_MASTER,
    });
    expect(result2.fails).toBe(true);
    expect(result2.falseReadyClaim).toBe(true);
  });

  test("Blocked يمنع Production Ready لكن لا يُفشل CI وحده", () => {
    const gate = makeGate([
      { id: "PRD-001", status: "Blocked" },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `PRD-${String(i + 2).padStart(3, "0")}`,
        status: "Verified",
        evidence: true,
      })),
    ]);
    const result = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
    });

    expect(result.fails).toBe(false); // البوابة المفتوحة حالة طبيعية
    expect(result.blockingItems).toContain("PRD-001 (Blocked)");
  });

  test("Blocked + ادعاء Production Ready يفشل CI", () => {
    const gate2 = makeGate([
      { id: "PRD-001", status: "Blocked" },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `PRD-${String(i + 2).padStart(3, "0")}`,
        status: "Verified" as const,
        evidence: true,
      })),
    ]);
    const result2 = checkProductionReadinessGate({
      gateContent: gate2,
      systemStateContent: CLAIMING_READY,
      roadmapContent: CLEAN_ROADMAP,
      roadmapMasterContent: CLEAN_ROADMAP_MASTER,
    });
    expect(result2.fails).toBe(true);
    expect(result2.falseReadyClaim).toBe(true);
  });

  test("Ready يمنع Production Ready لكن لا يُفشل CI وحده", () => {
    const gate = makeGate([
      { id: "PRD-001", status: "Ready" },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `PRD-${String(i + 2).padStart(3, "0")}`,
        status: "Verified",
        evidence: true,
      })),
    ]);
    const result = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
    });

    expect(result.fails).toBe(false); // البوابة المفتوحة حالة طبيعية
    expect(result.blockingItems).toContain("PRD-001 (Ready)");
  });

  test("Ready + ادعاء Production Ready يفشل CI", () => {
    const gate2 = makeGate([
      { id: "PRD-001", status: "Ready" },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `PRD-${String(i + 2).padStart(3, "0")}`,
        status: "Verified" as const,
        evidence: true,
      })),
    ]);
    const result2 = checkProductionReadinessGate({
      gateContent: gate2,
      systemStateContent: CLAIMING_READY,
      roadmapContent: CLEAN_ROADMAP,
      roadmapMasterContent: CLEAN_ROADMAP_MASTER,
    });
    expect(result2.fails).toBe(true);
    expect(result2.falseReadyClaim).toBe(true);
  });

  // --- Verified بلا evidence ---

  test("Verified بلا evidence path يفشل", () => {
    const gate = makeGate([
      { id: "PRD-001", status: "Verified", evidence: false },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `PRD-${String(i + 2).padStart(3, "0")}`,
        status: "Verified",
        evidence: true,
      })),
    ]);
    const result = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
    });

    expect(result.fails).toBe(true);
    expect(result.verifiedWithoutEvidence).toContain("PRD-001");
  });

  // --- ADR-Closed ---

  test("ADR-Closed بمسار ADR صالح لا يمنع البوابة", () => {
    const gate = makeGate([
      { id: "PRD-001", status: "ADR-Closed", adr: true },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `PRD-${String(i + 2).padStart(3, "0")}`,
        status: "Verified",
        evidence: true,
      })),
    ]);
    const result = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
    });

    expect(result.fails).toBe(false);
    expect(result.adrClosedWithoutAdr).toHaveLength(0);
  });

  test("ADR-Closed بلا مسار ADR يفشل", () => {
    const gate = makeGate([
      { id: "PRD-001", status: "ADR-Closed", adr: false },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `PRD-${String(i + 2).padStart(3, "0")}`,
        status: "Verified",
        evidence: true,
      })),
    ]);
    const result = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
    });

    expect(result.fails).toBe(true);
    expect(result.adrClosedWithoutAdr).toContain("PRD-001");
  });

  // --- حالة غير معروفة ---

  test("حالة غير معروفة تفشل", () => {
    const gate = makeGate([
      { id: "PRD-001", status: "Closed" },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `PRD-${String(i + 2).padStart(3, "0")}`,
        status: "Verified",
        evidence: true,
      })),
    ]);
    const result = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
    });

    expect(result.fails).toBe(true);
    expect(result.unknownStatusItems).toContain("PRD-001 (Closed)");
  });

  // --- ادّعاء Production Ready ---

  test("لا يمكن لوثيقة حاكمة أن تعلن Production Ready بينما البوابة مانعة", () => {
    const gate = makeGate([
      { id: "PRD-001", status: "Blocked" },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `PRD-${String(i + 2).padStart(3, "0")}`,
        status: "Verified",
        evidence: true,
      })),
    ]);
    const result = checkProductionReadinessGate({
      gateContent: gate,
      systemStateContent: CLAIMING_READY,
      roadmapContent: CLEAN_ROADMAP,
      roadmapMasterContent: CLEAN_ROADMAP_MASTER,
    });

    expect(result.fails).toBe(true);
    expect(result.falseReadyClaim).toBe(true);
  });

  test("لا يمكن لوثيقة ROADMAP أن تعلن Production Ready بينما البوابة مانعة", () => {
    const gate = makeGate([
      { id: "PRD-001", status: "Open" },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `PRD-${String(i + 2).padStart(3, "0")}`,
        status: "Verified",
        evidence: true,
      })),
    ]);
    const result = checkProductionReadinessGate({
      gateContent: gate,
      systemStateContent: CLEAN_SYSTEM_STATE,
      roadmapContent: CLAIMING_READY,
      roadmapMasterContent: CLEAN_ROADMAP_MASTER,
    });

    expect(result.fails).toBe(true);
    expect(result.falseReadyClaim).toBe(true);
  });

  // --- بوابة مغلقة بالكامل ---

  test("بوابة بكل بنود Verified (مع evidence) لا تفشل", () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
      id: `PRD-${String(i + 1).padStart(3, "0")}`,
      status: "Verified" as const,
      evidence: true,
    }));
    const gate = makeGate(items);
    const result = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
    });

    expect(result.fails).toBe(false);
    expect(result.blockingItems).toHaveLength(0);
  });

  test("بوابة بكل بنود Verified أو ADR-Closed (مع مسارات) لا تفشل", () => {
    const items = [
      ...Array.from({ length: 15 }, (_, i) => ({
        id: `PRD-${String(i + 1).padStart(3, "0")}`,
        status: "Verified" as const,
        evidence: true,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `PRD-${String(i + 100).padStart(3, "0")}`,
        status: "ADR-Closed" as const,
        adr: true,
      })),
    ];
    const gate = makeGate(items);
    const result = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
    });

    expect(result.fails).toBe(false);
    expect(result.blockingItems).toHaveLength(0);
    expect(result.verifiedWithoutEvidence).toHaveLength(0);
    expect(result.adrClosedWithoutAdr).toHaveLength(0);
  });

  // --- عدد بنود ناقص ---

  test("أقل من 21 بندًا يفشل (parsing ناقص)", () => {
    const gate = makeGate([
      { id: "PRD-001", status: "Verified", evidence: true },
      { id: "PRD-002", status: "Verified", evidence: true },
    ]);
    const result = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
    });

    expect(result.fails).toBe(true);
    expect(result.parsedItemCount).toBe(2);
  });

  // --- نمطُ الإعلانِ (--require-ready) — ADR 0246 · ح-PRD-8 ---

  for (const status of ["Open", "Blocked", "Ready"] as const) {
    test(`نمطُ الإعلانِ: ${status} وحدَه يُفشل`, () => {
      const gate = makeGate([
        { id: "PRD-001", status },
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `PRD-${String(i + 2).padStart(3, "0")}`,
          status: "Verified",
          evidence: true,
        })),
      ]);
      const ci = checkProductionReadinessGate({ gateContent: gate, ...CLEAN_INPUT });
      const strict = checkProductionReadinessGate({
        gateContent: gate,
        ...CLEAN_INPUT,
        requireReady: true,
      });
      expect(ci.fails).toBe(false);
      expect(strict.fails).toBe(true);
      expect(strict.blockingItems).toContain(`PRD-001 (${status})`);
    });
  }

  test("نمطُ الإعلانِ: بوابةٌ مُغلقةٌ كلُّها تنجح", () => {
    const gate = makeGate(
      Array.from({ length: 21 }, (_, i) => ({
        id: `PRD-${String(i + 1).padStart(3, "0")}`,
        status: "Verified",
        evidence: true,
      })),
    );
    const strict = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
      requireReady: true,
    });
    expect(strict.fails).toBe(false);
  });

  test("الحارسُ كعمليّةٍ على البوابةِ الحقيقيّة: CI يخرجُ 0 والإعلانُ يخرجُ 1", () => {
    const ci = Bun.spawnSync(["bun", "scripts/check-production-readiness-gate.ts"]);
    const strict = Bun.spawnSync([
      "bun",
      "scripts/check-production-readiness-gate.ts",
      "--require-ready",
    ]);
    expect(ci.exitCode).toBe(0);
    // ما دامَ في البوابةِ الحقيقيّةِ بندٌ مانعٌ فإعلانُ الجاهزيّةِ مرفوض.
    expect(strict.exitCode).toBe(1);
  });

  test("بنودُ P2 المفتوحةُ لا تمنعُ نمطَ الإعلانِ متى أُغلِقَ P0 وP1", () => {
    const gate = makeGate([
      ...Array.from({ length: 16 }, (_, i) => ({
        id: `PRD-${String(i + 1).padStart(3, "0")}`,
        status: "Verified",
        evidence: true,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `PRD-${String(i + 201)}`,
        status: "Blocked",
      })),
    ]);
    const strict = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
      requireReady: true,
    });
    expect(strict.fails).toBe(false);
    expect(strict.blockingItems).toHaveLength(0);
    expect(strict.commercialOpenItems).toContain("PRD-201 (Blocked)");
  });

  test("بندُ P1 مانعٌ يمنعُ نمطَ الإعلان", () => {
    const gate = makeGate([
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `PRD-${String(i + 1).padStart(3, "0")}`,
        status: "Verified",
        evidence: true,
      })),
      { id: "PRD-104", status: "Open" },
    ]);
    const strict = checkProductionReadinessGate({
      gateContent: gate,
      ...CLEAN_INPUT,
      requireReady: true,
    });
    expect(strict.fails).toBe(true);
    expect(strict.blockingItems).toContain("PRD-104 (Open)");
  });
});
