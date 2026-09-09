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
import {
  BOOLEAN_ENV_LITERALS,
  PROCESS_TOPOLOGY_NAMES,
} from "../../packages/shared/config/index.ts";
import {
  analyse,
  CLASSIFIED_SERVICES,
  REQUIRED_SERVICES,
  servicesFromManifest,
  VALID_BOOLEAN_LITERALS,
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
  "      - key: RUN_WORKER_IN_GATEWAY",
  '        value: "false"',
  "  - type: worker",
  "    name: waslah-worker",
  "    numInstances: 1",
  "    envVars:",
  "      - key: SESSION_STORE",
  "        value: memory",
  "      - key: PROCESS_TOPOLOGY",
  "        value: single-process",
  "      - key: RUN_WORKER_IN_GATEWAY",
  '        value: "false"',
  "",
].join("\n");

/**
 * نفسُ المخطوطةِ السليمةِ بلا خدمةِ عاملٍ — البوّابةُ وحدَها. تُبنى بقطعِ النصِّ
 * عندَ الخدمةِ الثانيةِ لا بكتابةِ نسخةٍ ثانيةٍ: نسختانِ تتباعدانِ بأوّلِ تعديلٍ.
 */
const GATEWAY_ONLY = `${SOUND.slice(0, SOUND.indexOf("  - type: worker"))}`;

/** يُبدِّل قيمةَ الطوبولوجيا في نصِّ المُدخَلِ كلِّه — زرعُ خرقٍ لا تحريرُ ملفٍّ. */
const withTopology = (content: string, value: string): string =>
  content.replaceAll("        value: single-process", `        value: ${value}`);

/** يحذف إعلانَ الطوبولوجيا كلَّه — لإثباتِ أنّ الغيابَ سقوطٌ لا افتراضٌ صامتٌ. */
const withoutTopology = (content: string): string =>
  content.replaceAll("      - key: PROCESS_TOPOLOGY\n        value: single-process\n", "");

/** يُبدِّل قيمةَ `RUN_WORKER_IN_GATEWAY` في النصِّ كلِّه — زرعُ خرقٍ لا تحريرُ ملفٍّ. */
const withRunWorker = (content: string, value: string): string =>
  content.replaceAll('        value: "false"', `        value: ${value}`);

/** يحذف إعلانَ موضعِ المهامِّ كلَّه — لإثباتِ أنّ الغيابَ سقوطٌ لا افتراضٌ. */
const withoutRunWorker = (content: string): string =>
  content.replaceAll('      - key: RUN_WORKER_IN_GATEWAY\n        value: "false"\n', "");

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
      // يُعلَن كي يبقى المُختبَرُ **غيابَ البوّابةِ وحدَه**: مخطوطةٌ ناقصةُ إعلانِ
      // موضعِ المهامِّ تُسقِط رمزاً ثانياً فتُخفي المقصودَ (ADR 0063).
      "      - key: RUN_WORKER_IN_GATEWAY",
      '        value: "false"',
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
  /**
   * **طبقتانِ لهما قاعدتانِ عن قصدٍ** (ADR 0051 §٢-ب مقابلَ §٢-هـ):
   * في **بيئةِ العمليةِ** غيابُ المفتاحِ يُقرأ `single-process` افتراضاً مُعلَناً
   * (مُثبَّتٌ في `config-loading.test.ts` و`single-instance-invariant.test.ts`)،
   * وفي **ملفِّ النشرِ** غيابُ الإعلانِ **خرقٌ** — لأنّ الملفَّ يُقرأ بجانبِ
   * `numInstances`، وسكوتُه يُبطِل التكافؤَ الذي يفرضه هذا الحاجزُ.
   */
  it("غيابُ PROCESS_TOPOLOGY من ملفِّ النشرِ ⇒ سقوطٌ — لا افتراضَ ههنا", () => {
    expect(codes(withoutTopology(SOUND))).toContain("MISSING_PROCESS_TOPOLOGY");
  });

  it("والغيابُ يُميَّز عن البطلانِ برمزَين مختلفَين لا برمزٍ واحدٍ", () => {
    const missing = codes(withoutTopology(SOUND));
    const invalid = codes(withTopology(SOUND, "many"));
    expect(missing).toContain("MISSING_PROCESS_TOPOLOGY");
    expect(missing).not.toContain("INVALID_PROCESS_TOPOLOGY");
    expect(invalid).toContain("INVALID_PROCESS_TOPOLOGY");
    expect(invalid).not.toContain("MISSING_PROCESS_TOPOLOGY");
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

describe("موضعُ المهامِّ الدوريّةِ — F5-04 / SCL-007 · ADR 0063", () => {
  it("تُقرأ قيمةُ RUN_WORKER_IN_GATEWAY ونوعُ الخدمةِ لكلِّ خدمةٍ", () => {
    const services = servicesFromManifest(SOUND);
    expect(services[0]?.serviceType).toBe("web");
    expect(services[0]?.runWorkerInGateway).toBe("false");
    expect(services[1]?.serviceType).toBe("worker");
  });

  /**
   * برهانُ أنّ الفرزَ الصريحَ في القارئِ يعمل: مفتاحٌ ثالثٌ لا يُلوِّث الطوبولوجيا.
   * ولو أُسنِد بـ`else` جامعٍ لصارت الطوبولوجيا «false» ونجحَ الحاجزُ على ملفٍّ
   * لم يفهمه.
   */
  it("مفتاحُ موضعِ المهامِّ لا يُلوِّث قيمةَ الطوبولوجيا", () => {
    const services = servicesFromManifest(SOUND);
    expect(services[0]?.processTopology).toBe("single-process");
  });

  it("المستودعُ الحقيقيُّ يُعلِن الفصلَ: البوّابةُ false وخدمةُ عاملٍ قائمةٌ", () => {
    const services = servicesFromManifest(REAL_MANIFEST);
    const gateway = services.find((service) => service.name === "waslah-gateway");
    expect(gateway?.runWorkerInGateway).toBe("false");
    expect(services.some((service) => service.serviceType === "worker")).toBe(true);
    for (const service of services) expect(service.runWorkerInGateway).not.toBeNull();
  });

  it("غيابُ الإعلانِ ⇒ سقوطٌ — لأنّ الإنتاجَ لا يُقلع بلا سطرِه", () => {
    expect(codes(withoutRunWorker(SOUND))).toContain("MISSING_RUN_WORKER_DECLARATION");
  });

  it("قيمةٌ لا تُفهَم ⇒ سقوطٌ ولا تُردُّ إلى الافتراضِ", () => {
    expect(codes(withRunWorker(SOUND, '"fasle"'))).toContain("INVALID_RUN_WORKER_VALUE");
  });

  /** الغيابُ والبطلانُ يُميَّزانِ برمزَين: العلاجُ مختلفٌ فلا يُوحَّد الرمزُ. */
  it("الغيابُ والبطلانُ رمزانِ مختلفانِ لا رمزٌ واحدٌ", () => {
    expect(codes(withoutRunWorker(SOUND))).not.toContain("INVALID_RUN_WORKER_VALUE");
    expect(codes(withRunWorker(SOUND, '"maybe"'))).not.toContain("MISSING_RUN_WORKER_DECLARATION");
  });

  /**
   * الخرقُ الجوهريُّ للمرحلةِ: بوّابةٌ تتخلّى عن المهامِّ ولا حاملَ لها. وهذا هو
   * الحالُ المُشخَّصُ في `docs/directive-item-0-live-diagnosis.md` §0.2 — لكنّه
   * كان يقع في المنصّةِ لا في الملفِّ، والحاجزُ يمنع **تعبيرَ الملفِّ عنه**.
   */
  it("بوّابةٌ بـfalse بلا خدمةِ عاملٍ ⇒ نظامٌ بلا مهامَّ ⇒ سقوطٌ", () => {
    expect(codes(GATEWAY_ONLY)).toContain("JOBS_ORPHANED");
  });

  it("بوّابةٌ بـfalse مع خدمةِ عاملٍ ⇒ قبولٌ — هذا هو الفصلُ", () => {
    expect(analyse(SOUND)).toEqual([]);
  });

  /** الإدماجُ بلا خدمةِ عاملٍ حالٌ مقبولةٌ: المهامُّ تعمل في موضعٍ واحدٍ. */
  it("بوّابةٌ بـtrue بلا خدمةِ عاملٍ ⇒ قبولٌ — لا تُتَّهم الحالُ السابقةُ", () => {
    expect(analyse(withRunWorker(GATEWAY_ONLY, '"true"'))).toEqual([]);
  });

  /**
   * القفلُ الموزَّعُ (ADR 0009) يجعل التكرارَ تخطّياً لا تنفيذاً مزدوجاً، فتشغيلُ
   * الموضعَين معاً ليس خرقاً يُسقِط النشرَ. ولو أُسقِط لصار الرجوعُ عن الفصلِ في
   * حادثةٍ مستعجلةٍ ممنوعاً بحاجزٍ — وهو منعُ علاجٍ لا منعُ عطلٍ.
   */
  it("بوّابةٌ بـtrue مع خدمةِ عاملٍ ⇒ قبولٌ — القفلُ يحمي من التكرارِ", () => {
    expect(analyse(withRunWorker(SOUND, '"true"'))).toEqual([]);
  });

  /**
   * الاسمُ لا يكفي: خدمةٌ تُسمّى `waslah-worker` وتُعلَن `type: web` ليست عاملاً،
   * ولو قُبِلت لصار الحاجزُ يُصدِّق تسميةً لا إعلاناً.
   */
  it("خدمةٌ باسمِ عاملٍ ونوعِ web لا تُعَدُّ حاملاً للمهامِّ", () => {
    expect(codes(SOUND.replace("  - type: worker", "  - type: web"))).toContain("JOBS_ORPHANED");
  });

  it("قائمةُ المنطقيِّ في الحاجزِ تُطابِق قائمةَ الضبطِ", () => {
    expect([...VALID_BOOLEAN_LITERALS]).toEqual([...BOOLEAN_ENV_LITERALS]);
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
