/**
 * الغرض: برهانُ سقوطِ حاجزِ `numInstances` بخرقٍ مزروعٍ، ونجاحِه على المستودعِ
 *    الحقيقيِّ في حالتِه الراهنةِ (`R-17` · ADR 0050).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ `verify` في CI — وهي المنفذُ الذي يجعل الحاجزَ
 *    يعمل في CI العامِّ لا في `bun run ci` وحدَه.
 * ملاحظات مستقبلية: يومَ تُضاف خدمةٌ إلى `render.yaml` يسقط الحاجزُ حتّى تُصنَّف،
 *    وهذا مقصودٌ — يُحدَّث `CLASSIFIED_SERVICES` بسببٍ مكتوبٍ لا يُوسَّع النمطُ.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROCESS_TOPOLOGY_NAMES } from "../../packages/shared/config/index.ts";
import {
  analyse,
  CLASSIFIED_SERVICES,
  REQUIRED_SERVICES,
  servicesFromManifest,
  VALID_PROCESS_TOPOLOGIES,
} from "../../scripts/check-instance-invariant.ts";

const REAL_MANIFEST = readFileSync("render.yaml", "utf8");

const SOUND = [
  "services:",
  "  - type: web",
  "    name: waslah-gateway",
  "    numInstances: 1",
  "    envVars:",
  "      - key: SESSION_STORE",
  "        value: memory",
  "      - key: PROCESS_TOPOLOGY",
  "        value: single-process",
  "  - type: worker",
  "    name: waslah-worker",
  "    numInstances: 1",
  "    envVars:",
  "      - key: SESSION_STORE",
  "        value: memory",
  "      - key: PROCESS_TOPOLOGY",
  "        value: single-process",
  "",
].join("\n");

/** يُبدِّل قيمةَ الطوبولوجيا في نصِّ المُدخَلِ كلِّه — زرعُ خرقٍ لا تحريرُ ملفٍّ. */
const withTopology = (content: string, value: string): string =>
  content.replaceAll("        value: single-process", `        value: ${value}`);

/** يحذف إعلانَ الطوبولوجيا كلَّه — لإثباتِ أنّ الغيابَ سقوطٌ لا افتراضٌ صامتٌ. */
const withoutTopology = (content: string): string =>
  content.replaceAll("      - key: PROCESS_TOPOLOGY\n        value: single-process\n", "");

const codes = (content: string): readonly string[] => analyse(content).map((f) => f.code);

describe("قراءةُ الخدماتِ من ملفِّ النشرِ", () => {
  it("تقرأ الاسمَ وعددَ النسخِ ومخزنَ الجلساتِ لكلِّ خدمةٍ", () => {
    const services = servicesFromManifest(SOUND);
    expect(services.length).toBe(2);
    expect(services[0]?.name).toBe("waslah-gateway");
    expect(services[0]?.numInstances).toBe("1");
    expect(services[0]?.sessionStore).toBe("memory");
    expect(services[0]?.processTopology).toBe("single-process");
    expect(services[1]?.name).toBe("waslah-worker");
    expect(services[1]?.processTopology).toBe("single-process");
  });

  it("تقرأ المستودعَ الحقيقيَّ فتجد الخدمتَين بعددٍ واحدٍ", () => {
    const services = servicesFromManifest(REAL_MANIFEST);
    const gateway = services.find((service) => service.name === "waslah-gateway");
    expect(gateway).toBeDefined();
    expect(gateway?.numInstances).toBe("1");
    expect(gateway?.processTopology).toBe("single-process");
    for (const service of services) {
      expect(service.numInstances).toBe("1");
      expect(service.processTopology).toBe("single-process");
    }
  });

  /** التعليقُ اللاحقُ لا يُفسِد القيمةَ: `autoDeploy: false # …` سطرٌ قائمٌ فعلاً. */
  it("تُجرِّد التعليقَ اللاحقَ من القيمةِ", () => {
    const services = servicesFromManifest(
      ["services:", "  - name: waslah-gateway", "    numInstances: 1 # نسخةٌ واحدةٌ", ""].join("\n"),
    );
    expect(services[0]?.numInstances).toBe("1");
  });
});

describe("الحكمُ — قبولٌ ورفضٌ", () => {
  it("numInstances = 1 لكلِّ خدمةٍ مصنَّفةٍ ⇒ قبولٌ", () => {
    expect(analyse(SOUND)).toEqual([]);
  });

  it("المستودعُ الحقيقيُّ في حالتِه الراهنةِ ⇒ قبولٌ", () => {
    expect(analyse(REAL_MANIFEST)).toEqual([]);
  });

  it("numInstances > 1 ⇒ رفضٌ", () => {
    expect(codes(SOUND.replace("numInstances: 1", "numInstances: 2"))).toContain(
      "INSTANCES_ABOVE_ONE",
    );
  });

  /** رفعُ النسخِ مع `memory` خرقٌ مزدوجٌ: شرطُ R-17 وإلزامُ ADR 0011 معاً. */
  it("رفعُ النسخِ مع SESSION_STORE=memory ⇒ خرقانِ لا خرقٌ", () => {
    const found = codes(SOUND.replace("numInstances: 1", "numInstances: 4"));
    expect(found).toContain("INSTANCES_ABOVE_ONE");
    expect(found).toContain("SESSION_STORE_INCOHERENT");
  });

  it("قيمةٌ غيرُ عدديّةٍ ⇒ سقوطٌ محدَّدٌ لا تخطٍّ", () => {
    expect(codes(SOUND.replace("numInstances: 1", 'numInstances: "auto"'))).toContain(
      "INVALID_NUM_INSTANCES",
    );
  });

  it("غيابُ الحقلِ ⇒ سقوطٌ محدَّدٌ — لأنّ الغيابَ افتراضُ منصّةٍ لا واحدةٌ", () => {
    expect(codes(SOUND.replace("    numInstances: 1\n", ""))).toContain("MISSING_NUM_INSTANCES");
  });

  it("ملفٌّ فارغٌ أو بنيةٌ لا تُفهَم ⇒ سقوطٌ لا نجاحٌ صامتٌ", () => {
    expect(codes("")).toEqual(["NO_SERVICES"]);
    expect(codes("services: []\n")).toEqual(["NO_SERVICES"]);
  });

  it("غيابُ الخدمةِ المعنيّةِ ⇒ سقوطٌ — الحاجزُ لا ينجح على ملفٍّ لا يفحص فيه شيئاً", () => {
    const withoutGateway = [
      "services:",
      "  - type: worker",
      "    name: waslah-worker",
      "    numInstances: 1",
      "    envVars:",
      "      - key: PROCESS_TOPOLOGY",
      "        value: single-process",
      "",
    ].join("\n");
    expect(codes(withoutGateway)).toEqual(["MISSING_REQUIRED_SERVICE"]);
  });

  it("خدمةٌ جديدةٌ غيرُ مصنَّفةٍ ⇒ سقوطٌ حتّى تُصنَّف", () => {
    const withNew = `${SOUND}  - type: web\n    name: waslah-something-new\n    numInstances: 3\n`;
    expect(codes(withNew)).toContain("UNCLASSIFIED_SERVICE");
  });

  /**
   * ## الطوبولوجيا (ADR 0051) — التكافؤُ في الاتّجاهَين
   */
  it("غيابُ PROCESS_TOPOLOGY ⇒ سقوطٌ — الغيابُ ليس «عمليةً واحدةً»", () => {
    expect(codes(withoutTopology(SOUND))).toContain("MISSING_PROCESS_TOPOLOGY");
  });

  it("قيمةُ طوبولوجيا غيرُ صالحةٍ ⇒ سقوطٌ ولا تُردّ إلى الافتراضِ", () => {
    expect(codes(withTopology(SOUND, "many"))).toContain("INVALID_PROCESS_TOPOLOGY");
  });

  it("multi-process مع numInstances = 1 ⇒ تنافرُ إعلانَين", () => {
    const found = codes(withTopology(SOUND, "multi-process"));
    expect(found).toContain("TOPOLOGY_INSTANCES_MISMATCH");
    expect(found).toContain("MULTI_PROCESS_WITHOUT_DISTRIBUTION");
  });

  it("رفعُ النسخِ مع بقاءِ single-process ⇒ تنافرُ إعلانَين كذلك", () => {
    const found = codes(SOUND.replace("    numInstances: 1", "    numInstances: 2"));
    expect(found).toContain("TOPOLOGY_INSTANCES_MISMATCH");
    expect(found).toContain("INSTANCES_ABOVE_ONE");
  });

  it("multi-process معلَنةٌ ⇒ سقوطٌ ما دام التوزيعُ داخلَ العمليةِ — أيّاً كان مخزنُ الجلساتِ", () => {
    const raised = withTopology(SOUND, "multi-process").replaceAll(
      "    numInstances: 1",
      "    numInstances: 2",
    );
    const withRedis = raised.replaceAll("        value: memory", "        value: redis");
    expect(codes(raised)).toContain("MULTI_PROCESS_WITHOUT_DISTRIBUTION");
    expect(codes(withRedis)).toContain("MULTI_PROCESS_WITHOUT_DISTRIBUTION");
    // وredis يرفع خرقَ ADR 0011 وحدَه، ولا يُسقِط خرقَ التوزيعِ.
    expect(codes(withRedis)).not.toContain("SESSION_STORE_INCOHERENT");
  });

  /**
   * قائمةُ الحاجزِ مكرَّرةٌ عن قصدٍ (أداةُ مستودعٍ لا تستورد شيفرةَ إنتاجٍ)،
   * والتكرارُ نفسُه محروسٌ ههنا كي لا يتباعد الموضعانِ صامتَين.
   */
  it("قائمةُ الطوبولوجيا في الحاجزِ تُطابِق قائمةَ الضبطِ", () => {
    expect([...VALID_PROCESS_TOPOLOGIES]).toEqual([...PROCESS_TOPOLOGY_NAMES]);
  });

  it("الحاجزُ يفحص الخدمةَ الصحيحةَ لا خدمةً غيرَ مرتبطةٍ", () => {
    expect(Object.keys(CLASSIFIED_SERVICES).sort()).toEqual(["waslah-gateway", "waslah-worker"]);
    expect(REQUIRED_SERVICES).toContain("waslah-gateway");
  });
});

describe("رمزُ خروجِ الحاجزِ لا نصُّه", () => {
  const runBarrier = async (content: string | null): Promise<number> => {
    let path = "/tmp/لا-يوجد-ملفُّ-نشرٍ-قط.yaml";
    if (content !== null) {
      const dir = mkdtempSync(join(tmpdir(), "instance-invariant-"));
      path = join(dir, "render.yaml");
      writeFileSync(path, content);
    }
    const child = Bun.spawn(["bun", "scripts/check-instance-invariant.ts", path], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return await child.exited;
  };

  it("خرقٌ مزروعٌ ⇒ رمزٌ غيرُ صفريٍّ، وإزالتُه ⇒ صفرٌ", async () => {
    expect(await runBarrier(SOUND.replace("numInstances: 1", "numInstances: 2"))).toBe(1);
    expect(await runBarrier(SOUND)).toBe(0);
  }, 30_000);

  it("خرقُ طوبولوجيا مزروعٌ ⇒ رمزٌ غيرُ صفريٍّ في كلِّ صورةٍ من صورِه", async () => {
    expect(await runBarrier(withoutTopology(SOUND))).toBe(1);
    expect(await runBarrier(withTopology(SOUND, "many"))).toBe(1);
    expect(await runBarrier(withTopology(SOUND, "multi-process"))).toBe(1);
    expect(await runBarrier(SOUND.replace("    numInstances: 1", "    numInstances: 2"))).toBe(1);
    // وإزالةُ الخرقِ تُعيد الصفرَ — كي لا يكون السقوطُ دائماً.
    expect(await runBarrier(SOUND)).toBe(0);
  }, 60_000);

  it("خرقُ طوبولوجيا مزروعٌ في نسخةٍ من الملفِّ الحقيقيِّ ⇒ سقوطٌ", async () => {
    expect(await runBarrier(withoutTopology(REAL_MANIFEST))).toBe(1);
    expect(await runBarrier(withTopology(REAL_MANIFEST, "multi-process"))).toBe(1);
  }, 60_000);

  it("ملفٌّ غائبٌ أو فارغٌ ⇒ سقوطٌ لا تخطٍّ", async () => {
    expect(await runBarrier(null)).toBe(1);
    expect(await runBarrier("")).toBe(1);
  }, 30_000);

  it("خرقٌ مزروعٌ في نسخةٍ من الملفِّ الحقيقيِّ ⇒ سقوطٌ، والملفُّ الحقيقيُّ ⇒ صفرٌ", async () => {
    expect(await runBarrier(REAL_MANIFEST.replace("numInstances: 1", "numInstances: 3"))).toBe(1);

    const onRealRepo = Bun.spawn(["bun", "scripts/check-instance-invariant.ts"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await onRealRepo.exited).toBe(0);
  }, 30_000);
});
