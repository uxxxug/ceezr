#!/usr/bin/env bun
/**
 * الغرض: حاجزُ حدِّ الصادرِ — البندُ `W-6` · القرارُ `ADR 0084`.
 *
 * ما يقيسُه: أنَّ كلَّ مقصدٍ شبكيٍّ في شيفرةِ الإنتاجِ **مُعلَنٌ** في
 * `packages/shared/wasla/egress-registry.ts`، وأنَّ لا مرورَ بينَ الأنظمةِ إلّا عبرَ
 * CORE، وأنَّ التكاملَ التجاريَّ المباشرَ **دَينٌ مُعلَنٌ** لا مسكوتٌ عنه، وأنَّ
 * السجلَّ **لا يدّعي إزالةً** لمقصدٍ ما زالَ في الشيفرةِ.
 *
 * التشغيلُ: `bun run scripts/check-egress-boundary.ts`
 * التوليدُ:  `bun run scripts/check-egress-boundary.ts --write`
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BROWSER_FETCH_SITES,
  type BrowserFetchSite,
  CLASSES_WITHOUT_SIBLING_SYSTEM,
  declaredLiteralHosts,
  type EgressPeer,
  exemptHostNames,
  HOST_EXEMPTIONS,
  type HostExemption,
  type PeerClass,
  type RuntimeGate,
  WASLA_EGRESS_REGISTRY,
} from "../packages/shared/wasla/egress-registry.ts";

export interface Problem {
  readonly check: string;
  readonly detail: string;
}

const DOC_PATH = "docs/wasla/egress-boundary.md";
const BEGIN = "<!-- BEGIN GENERATED: egress-boundary -->";
const END = "<!-- END GENERATED: egress-boundary -->";
const SCAN_ROOTS = ["packages", "apps", "supabase"] as const;

/**
 * ملفُّ السجلِّ نفسُه. ويُستثنى من مسحِ المضيفاتِ لأنَّه **إعلانٌ لا موضعُ نداءٍ**:
 * كانَ في `scripts/` فبقيَ خارجَ المسحِ بحكمِ موضعِه، ثمَّ نزلَ إلى `packages/shared`
 * كي تقرأَه بوّابةُ التشغيلِ من مصدرٍ واحدٍ (`ADR 0086`). ولولا الاستثناءُ لوجدَ
 * الفحصُ ٥ («لا مُدخلَ ميّتاً») كلَّ مضيفٍ مُعلَنٍ في السجلِّ نفسِه فيُفرَّغُ من
 * معناه — وذاكَ إضعافُ حاجزٍ قائمٍ، لا إضافةُ حاجزٍ.
 */
const REGISTRY_FILE = "packages/shared/wasla/egress-registry.ts";

/** بوّابةُ التشغيلِ — الموضعُ الوحيدُ الذي يجوزُ أن يلمسَ الناقلَ العامَّ. */
const GATE_FILE = "packages/shared/wasla/egress-gate.ts";

/** ملفّاتٌ لا تُمسَحُ مضيفاتُها: إعلانٌ لا نداءٌ. */
const SCAN_EXCLUDED_FILES: readonly string[] = [REGISTRY_FILE] as const;

/** `fetch` عارياً: لا مسبوقاً بنقطةٍ ولا جزءاً من معرّفٍ آخرَ. */
const BARE_FETCH = /(?<![.\w$])fetch\s*\(/g;

/**
 * الأصنافُ التي تُقاسُ حرفاً في الشيفرةِ. النطاقاتُ المستوى الأعلى مغلقةٌ عن قصدٍ:
 * لائحةٌ مفتوحةٌ تجعلُ كلَّ نصٍّ فيه نقطةٌ مضيفاً مُشتبَهاً، فتُغرَقُ الرسالةُ
 * بالضجيجِ ويُتعلَّمُ تجاهلُها — وحاجزٌ يُتجاهَلُ حاجزٌ مُعطَّلٌ.
 */
const BARE_HOST_TLDS = [
  "com",
  "net",
  "org",
  "io",
  "co",
  "dev",
  "app",
  "ai",
  "sa",
  "me",
  "company",
] as const;

/**
 * يُزيلُ التعليقاتَ ويُبقي النصوصَ الحرفيّةَ. ورابطٌ في تعليقٍ **ليسَ صادراً**:
 * `https://core.telegram.org/bots/api` إحالةُ توثيقٍ لا نداءُ شبكةٍ، ولو عُدَّ
 * مقصداً لصارَ السجلُّ مليئاً بمضيفاتٍ لا تُنادى فيفقدُ معناه.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let inString: false | string = false;
  while (i < src.length) {
    const c = src[i] as string;
    const n = src[i + 1];
    if (inString) {
      if (c === "\\") {
        out += "  ";
        i += 2;
        continue;
      }
      if (c === inString) inString = false;
      out += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      out += "  ";
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      i += 2;
      out += "  ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** مضيفٌ وُجِدَ في الشيفرةِ، ومن أينَ. */
export interface FoundHost {
  readonly host: string;
  readonly files: readonly string[];
}

/**
 * يمسحُ شيفرةَ الإنتاجِ فيُعيدُ كلَّ مضيفٍ مكتوبٍ حرفاً. ويستثني الاختباراتَ:
 * مضيفٌ في اختبارٍ ليسَ صادراً إنتاجيّاً، والاختباراتُ تستعملُ نُوّاباً محفوظةً.
 */
export function scanLiteralHosts(roots: readonly string[] = SCAN_ROOTS): readonly FoundHost[] {
  const found = new Map<string, Set<string>>();
  const add = (host: string, file: string): void => {
    const set = found.get(host) ?? new Set<string>();
    set.add(file);
    found.set(host, set);
  };
  const tldPattern = new RegExp(`\\.(${BARE_HOST_TLDS.join("|")})$`);
  for (const root of roots) {
    for (const file of walk(root)) {
      if (file.includes("/tests/") || file.endsWith(".test.ts")) continue;
      if (SCAN_EXCLUDED_FILES.includes(file)) continue;
      const code = stripComments(readFileSync(file, "utf8"));
      for (const m of code.matchAll(/https:\/\/([a-zA-Z0-9._-]+)/g)) add(m[1] as string, file);
      for (const m of code.matchAll(/["'`]([a-z0-9][a-z0-9.-]*\.[a-z]{2,})["'`]/g)) {
        const host = m[1] as string;
        if (!tldPattern.test(host)) continue;
        add(host, file);
      }
    }
  }
  return [...found.entries()]
    .map(([host, files]) => ({ host, files: [...files].sort() }))
    .sort((a, b) => a.host.localeCompare(b.host));
}

/**
 * المُدخلاتُ التي يقرؤُها الفحصُ. مُمَرَّرةٌ لا مُلتقَطةٌ من الملفِّ مباشرةً، كي
 * تُزرَعَ الخروقُ في اختبارٍ فيُقاسَ **إخفاقُ الحاجزِ** لا نجاحُه وحدَه.
 */
export interface EgressInputs {
  readonly registry: readonly EgressPeer[];
  readonly exemptions: readonly HostExemption[];
  readonly foundHosts: readonly FoundHost[];
  readonly envExampleText: string;
  readonly packageJsonText: string;
  readonly callSiteExists: (path: string) => boolean;
  /** المواضعُ المُعلَنةُ للمتصفّحِ — الفحصُ ١٢. */
  readonly browserFetchSites: readonly BrowserFetchSite[];
  /** كلُّ ملفِّ إنتاجٍ فيه `fetch` عارياً، مقيساً لا مُعلَناً — الفحصُ ١٢. */
  readonly bareFetchFiles: readonly string[];
  /** نصُّ ملفٍّ للقراءةِ، أو `undefined` إن غابَ — الفحصانِ ١١ و١٣. */
  readonly readSource: (path: string) => string | undefined;
}

/** يمسحُ شيفرةَ الإنتاجِ فيُعيدُ كلَّ ملفٍّ يُنادي `fetch` عارياً بلا بوّابةٍ. */
export function scanBareFetchFiles(roots: readonly string[] = SCAN_ROOTS): readonly string[] {
  const out: string[] = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (file.includes("/tests/") || file.endsWith(".test.ts")) continue;
      if (file === GATE_FILE) continue;
      const code = stripComments(readFileSync(file, "utf8"));
      if ([...code.matchAll(BARE_FETCH)].length > 0) out.push(file);
    }
  }
  return out.sort();
}

export const DEFAULT_INPUTS: EgressInputs = {
  registry: WASLA_EGRESS_REGISTRY,
  exemptions: HOST_EXEMPTIONS,
  foundHosts: scanLiteralHosts(),
  envExampleText: existsSync(".env.example") ? readFileSync(".env.example", "utf8") : "",
  packageJsonText: existsSync("package.json") ? readFileSync("package.json", "utf8") : "",
  callSiteExists: (p) => existsSync(p),
  browserFetchSites: BROWSER_FETCH_SITES,
  bareFetchFiles: scanBareFetchFiles(),
  readSource: (p) => (existsSync(p) ? readFileSync(p, "utf8") : undefined),
};

/** المعرّفاتُ المُعلَنةُ في `ROADMAP.md` — تُستعملُ للتحقُّقِ من الإحالاتِ. */
export function declaredRoadmapIds(roadmapText: string): readonly string[] {
  const ids = new Set<string>();
  for (const m of roadmapText.matchAll(/\b(?:W-\d+|B-\d+|DEP-CORE-\d+|O-\d+)\b/g)) ids.add(m[0]);
  return [...ids].sort();
}

/**
 * كلُّ فحوصِ الحاجزِ، دالّةٌ صافيةٌ. تُعيدُ قائمةَ مشكلاتٍ فارغةً عندَ السلامةِ.
 */
export function egressProblems(
  roadmapText: string,
  docText: string,
  inputs: EgressInputs = DEFAULT_INPUTS,
): readonly Problem[] {
  const problems: Problem[] = [];
  const { registry, exemptions, foundHosts, envExampleText, packageJsonText } = inputs;
  const push = (check: string, detail: string): void => {
    problems.push({ check, detail });
  };

  // ١ — لا معرّفَ مكرَّراً، ولا مُدخلَ بلا معرّفٍ أو غرضٍ.
  const seenIds = new Set<string>();
  for (const peer of registry) {
    if (peer.id.trim() === "") push("١ معرّفٌ", "مُدخلٌ بلا معرّفٍ");
    else if (seenIds.has(peer.id)) push("١ معرّفٌ", `معرّفٌ مكرَّرٌ: ${peer.id}`);
    seenIds.add(peer.id);
    if (peer.purpose.trim() === "")
      push("١ معرّفٌ", `المُدخلُ ${peer.id} بلا غرضٍ مكتوبٍ — مُدخلٌ لا يُراجَعُ`);
  }

  // ٢ — الحاكمُ الأوّلُ: لا مقصدَ في MARKET، لا بإعلانٍ ولا بغيرِه.
  for (const peer of registry) {
    if (peer.system === "MARKET")
      push(
        "٢ لا MARKET",
        `المُدخلُ ${peer.id} يُعلِنُ \`system: "MARKET"\` — البندُ \`W-6\` يمنعُ أيَّ مقصدٍ ` +
          "مباشرٍ في MARKET، وكلُّ مرورٍ بينَ الأنظمةِ يمرُّ عبرَ CORE",
      );
  }

  // ٣ — الحاكمُ الثاني: المرورُ بينَ الأنظمةِ لا يخرجُ إلّا من بابِ CORE.
  for (const peer of registry) {
    if (peer.system !== "NONE" && peer.peerClass !== "CORE")
      push(
        "٣ بابٌ واحدٌ",
        `المُدخلُ ${peer.id} يُعلِنُ نظاماً شقيقاً (${peer.system}) وصنفَه ` +
          `${peer.peerClass} لا \`CORE\` — فالمرورُ بينَ الأنظمةِ يخرجُ من بابٍ غيرِ بابِ CORE`,
      );
    if (peer.peerClass === "CORE" && peer.system !== "CORE")
      push(
        "٣ بابٌ واحدٌ",
        `المُدخلُ ${peer.id} صنفُه \`CORE\` ونظامُه ${peer.system} — تنافرٌ يجعلُ البابَ يُقرأُ بغيرِ اسمِه`,
      );
    if (CLASSES_WITHOUT_SIBLING_SYSTEM.includes(peer.peerClass) && peer.system !== "NONE")
      push(
        "٣ بابٌ واحدٌ",
        `المُدخلُ ${peer.id} صنفُه ${peer.peerClass} فلا يجوزُ أن يحملَ نظاماً شقيقاً (${peer.system})`,
      );
  }

  // ٤ — شمولُ القائمةِ: كلُّ مضيفٍ في الشيفرةِ مُعلَنٌ أو معفًى بسببٍ.
  const declared = new Set(declaredLiteralHosts(registry));
  const exempt = new Set(exemptHostNames(exemptions));
  for (const found of foundHosts) {
    if (declared.has(found.host) || exempt.has(found.host)) continue;
    push(
      "٤ قائمةٌ مغلقةٌ",
      `مضيفٌ في شيفرةِ الإنتاجِ غيرُ مُعلَنٍ: ${found.host} (${found.files.join(", ")}) — ` +
        "أعلِنْه في السجلِّ بصنفِه ونظامِه، ولا يُقبَلُ مقصدٌ صامتٌ",
    );
  }

  // ٥ — لا مُدخلَ ميّتاً: مضيفٌ مُعلَنٌ حرفاً يجبُ أن يكونَ في الشيفرةِ فعلاً.
  const foundNames = new Set(foundHosts.map((f) => f.host));
  for (const peer of registry) {
    if (peer.source.kind !== "literal") continue;
    for (const host of peer.source.hosts) {
      if (foundNames.has(host)) continue;
      if (peer.removed) continue;
      push(
        "٥ لا مُدخلَ ميّتاً",
        `المُدخلُ ${peer.id} يُعلِنُ المضيفَ ${host} ولا وجودَ له في الشيفرةِ — ` +
          "إمّا أُزيلَ فيُرفَعُ `removed`، أو السجلُّ متقادمٌ",
      );
    }
  }

  // ٦ — الحاكمُ الثالثُ: لا ادّعاءَ إزالةٍ ومضيفُها ما زالَ في الشيفرةِ.
  for (const peer of registry) {
    if (!peer.removed) continue;
    if (peer.source.kind === "literal") {
      const still = peer.source.hosts.filter((h) => foundNames.has(h));
      if (still.length > 0)
        push(
          "٦ صدقُ الإزالةِ",
          `المُدخلُ ${peer.id} يدّعي \`removed: true\` ومضيفُه ما زالَ في الشيفرةِ ` +
            `(${still.join("، ")}) — فلا يُقرأُ عزمٌ إزالةً`,
        );
    }
    if (peer.source.kind === "env") {
      const still = peer.source.envKeys.filter((k) =>
        new RegExp(`^${k}=`, "m").test(envExampleText),
      );
      if (still.length > 0)
        push(
          "٦ صدقُ الإزالةِ",
          `المُدخلُ ${peer.id} يدّعي \`removed: true\` ومفتاحُ بيئتِه ما زالَ موثَّقاً ` +
            `(${still.join("، ")}) — فلا يُقرأُ عزمٌ إزالةً`,
        );
    }
  }

  // ٧ — الدَّينُ التجاريُّ مُعلَنٌ لا مسكوتٌ عنه، وإحالاتُه حقيقيّةٌ.
  const roadmapIds = new Set(declaredRoadmapIds(roadmapText));
  for (const peer of registry) {
    const isCommercial = peer.peerClass === "COMMERCIAL_PENDING_HANDOVER";
    if (isCommercial && peer.handover === undefined) {
      push(
        "٧ دَينٌ مُعلَنٌ",
        `المُدخلُ ${peer.id} تكاملٌ تجاريٌّ مباشرٌ بلا \`handover\` — ` +
          "فيصيرُ اقتراناً دائماً لا دَيناً مُعلَناً",
      );
      continue;
    }
    if (!isCommercial && peer.handover !== undefined) {
      push("٧ دَينٌ مُعلَنٌ", `المُدخلُ ${peer.id} ليسَ تجاريّاً ويحملُ \`handover\` — إحالةٌ لا معنى لها`);
      continue;
    }
    if (peer.handover === undefined) continue;
    for (const [field, id] of [
      ["removedByItem", peer.handover.removedByItem],
      ["blockedBy", peer.handover.blockedBy],
    ] as const) {
      if (!roadmapIds.has(id))
        push(
          "٧ دَينٌ مُعلَنٌ",
          `المُدخلُ ${peer.id} يُحيلُ في \`${field}\` إلى \`${id}\` وهوَ غيرُ مُعلَنٍ في ` +
            "`ROADMAP.md` — إحالةٌ مُختلَقةٌ تُقرأُ خطّةً ولا وجودَ لها",
        );
    }
  }

  // ٨ — مصدرُ المضيفِ مقيسٌ: مفتاحُ بيئةٍ موثَّقٌ، وحزمةٌ حقيقيّةٌ، وملفٌّ موجودٌ.
  for (const peer of registry) {
    if (!inputs.callSiteExists(peer.callSite))
      push("٨ مصدرٌ مقيسٌ", `المُدخلُ ${peer.id} يُحيلُ إلى موضعِ نداءٍ لا وجودَ له: ${peer.callSite}`);
    if (peer.source.kind === "env") {
      if (peer.source.envKeys.length === 0)
        push("٨ مصدرٌ مقيسٌ", `المُدخلُ ${peer.id} مصدرُه بيئةٌ بلا مفتاحٍ واحدٍ`);
      for (const key of peer.source.envKeys) {
        if (!new RegExp(`^${key}=`, "m").test(envExampleText))
          push(
            "٨ مصدرٌ مقيسٌ",
            `المُدخلُ ${peer.id} يقرأُ \`${key}\` وهوَ غيرُ موثَّقٍ في \`.env.example\` — ` +
              "مقصدٌ يُضبَطُ بمفتاحٍ لا يعرفُه المُشغِّلُ",
          );
      }
    }
    if (peer.source.kind === "library-default") {
      const pkg = peer.source.packageName;
      if (!new RegExp(`"${pkg}"\\s*:`).test(packageJsonText))
        push(
          "٨ مصدرٌ مقيسٌ",
          `المُدخلُ ${peer.id} يُعلِنُ مضيفاً افتراضيّاً للحزمةِ \`${pkg}\` وهيَ ليسَت في ` +
            "`package.json` — مصدرٌ لا يُقاسُ",
        );
      if (peer.source.host.trim() === "")
        push("٨ مصدرٌ مقيسٌ", `المُدخلُ ${peer.id} حزمتُه مُعلَنةٌ بلا مضيفٍ`);
    }
    if (peer.source.kind === "literal" && peer.source.hosts.length === 0)
      push("٨ مصدرٌ مقيسٌ", `المُدخلُ ${peer.id} مصدرُه حرفيٌّ بلا مضيفٍ واحدٍ`);
  }

  // ٩ — الإعفاءُ ليسَ باباً خلفيّاً: نطاقاتٌ محفوظةٌ وسببٌ مكتوبٌ لا أكثرُ.
  const RESERVED = /(^|\.)(example\.(com|net|org)|example|invalid|test|localhost)$/;
  for (const ex of exemptions) {
    if (ex.reason.trim() === "") push("٩ إعفاءٌ مُقيَّدٌ", `الإعفاءُ ${ex.host} بلا سببٍ مكتوبٍ`);
    if (ex.host.includes(".") && !RESERVED.test(ex.host))
      push(
        "٩ إعفاءٌ مُقيَّدٌ",
        `الإعفاءُ ${ex.host} ليسَ نطاقاً محفوظاً (RFC 2606) — ` +
          "الإعفاءُ للنُّوّابِ وحدَها، والمضيفُ الحقيقيُّ يُعلَنُ في السجلِّ",
      );
    if (declared.has(ex.host))
      push("٩ إعفاءٌ مُقيَّدٌ", `المضيفُ ${ex.host} مُعلَنٌ ومعفًى في وقتٍ واحدٍ — تنافرٌ`);
    if (!foundNames.has(ex.host))
      push(
        "٩ إعفاءٌ مُقيَّدٌ",
        `الإعفاءُ ${ex.host} لا وجودَ له في المسحِ — إعفاءٌ ميّتٌ: ثقبٌ مفتوحٌ بلا مقابلٍ، ` +
          "يبقى حتّى يمرَّ منه مضيفٌ حقيقيٌّ فيُقالَ «كانَ مُعفًى من قبلُ»",
      );
  }

  // ١١ — استثناءُ المسحِ ليسَ متقادماً: كلُّ ملفٍّ مُستثنًى موجودٌ وهوَ ما يُقالُ إنَّه.
  for (const excluded of SCAN_EXCLUDED_FILES) {
    const text = inputs.readSource(excluded);
    if (text === undefined) {
      push(
        "١١ استثناءُ مسحٍ",
        `الملفُّ المُستثنى من المسحِ لا وجودَ له: ${excluded} — استثناءٌ متقادمٌ ` +
          "يُخرِجُ من المسحِ مساراً لا أحدَ يقرؤُه، فيبقى ثقباً باسمِ ملفٍّ ميّتٍ",
      );
      continue;
    }
    if (!text.includes("WASLA_EGRESS_REGISTRY"))
      push(
        "١١ استثناءُ مسحٍ",
        `الملفُّ ${excluded} مُستثنًى من المسحِ وليسَ ملفَّ السجلِّ — الاستثناءُ ` +
          "للإعلانِ وحدَه، ولا يُوسَّعُ إلى شيفرةٍ تُنادي",
      );
  }
  const gateText = inputs.readSource(GATE_FILE);
  if (gateText === undefined)
    push(
      "١١ استثناءُ مسحٍ",
      `بوّابةُ التشغيلِ مفقودةٌ: ${GATE_FILE} — الفحصُ ١٢ يُعفي هذا المسارَ وحدَه ` +
        "من `fetch` العاريِ، فغيابُه يعني إعفاءً بلا مُعفًى",
    );

  // ١٢ — لا نداءَ خارجَ البوّابةِ: `fetch` عارياً في الخادمِ مرفوضٌ.
  const browserPaths = new Set(inputs.browserFetchSites.map((b) => b.path));
  for (const file of inputs.bareFetchFiles) {
    if (browserPaths.has(file)) continue;
    push(
      "١٢ بابٌ واحدٌ للتشغيلِ",
      `الملفُّ ${file} يُنادي \`fetch\` عارياً بلا بوّابةٍ — كلُّ صادرٍ من هذه ` +
        `العمليّةِ يمرُّ من \`createGuardedFetch("<معرّفُ المقصدِ>")\`، وإن كانَ ` +
        "النداءُ يعملُ في متصفّحِ المستخدمِ فيُعلَنُ في `BROWSER_FETCH_SITES` بسببِه",
    );
  }
  const bareSet = new Set(inputs.bareFetchFiles);
  for (const site of inputs.browserFetchSites) {
    if (site.reason.trim() === "")
      push("١٢ بابٌ واحدٌ للتشغيلِ", `الموضعُ ${site.path} مُعلَنٌ للمتصفّحِ بلا سببٍ مكتوبٍ`);
    if (inputs.readSource(site.path) === undefined) {
      push("١٢ بابٌ واحدٌ للتشغيلِ", `الموضعُ المُعلَنُ للمتصفّحِ لا وجودَ له: ${site.path} — إعلانٌ ميّتٌ`);
      continue;
    }
    if (!bareSet.has(site.path))
      push(
        "١٢ بابٌ واحدٌ للتشغيلِ",
        `الموضعُ ${site.path} مُعلَنٌ للمتصفّحِ ولا \`fetch\` فيه — إعلانٌ ميّتٌ: ` +
          "يبقى مكتوباً حتّى يُضافَ فيه غداً نداءٌ من الخادمِ فيمرَّ بلا حاجزٍ",
      );
  }

  // ١٣ — البوّابةُ موصولةٌ فعلاً: كلُّ مقصدٍ مُلزَمٍ يُنادي بوّابتَه بمعرّفِه.
  for (const peer of registry) {
    /**
     * مُدخلٌ بلا حقلِ بوّابةٍ ألبتّةَ يُرفَضُ لا يُتجاوَزُ: النوعُ يُلزِمُ الحقلَ في
     * TypeScript، والحاجزُ يُنادى أيضاً من JavaScript ومن اختبارٍ يزرعُ مُدخلاً
     * ناقصاً؛ والسكوتُ عنه يعني أنَّ حذفَ سطرٍ واحدٍ يُخرِجُ مقصداً من الإنفاذِ صامتاً.
     */
    const gate = peer.runtimeGate as RuntimeGate | undefined;
    if (gate === undefined) {
      push(
        "١٣ بوّابةٌ موصولةٌ",
        `المُدخلُ ${peer.id} بلا حقلِ \`runtimeGate\` — لا إلزامَ ولا إعفاءَ مكتوبٌ`,
      );
      continue;
    }
    if (gate.kind === "not-applicable") {
      if (gate.reason.trim() === "")
        push(
          "١٣ بوّابةٌ موصولةٌ",
          `المُدخلُ ${peer.id} يُعلِنُ أنَّ البوّابةَ لا تنطبقُ عليه بلا سببٍ مكتوبٍ — إعفاءٌ بلا مقابلٍ`,
        );
      continue;
    }
    const source = inputs.readSource(peer.callSite);
    if (source === undefined) continue; // الفحصُ ٨ يُبلِّغُ عن الملفِّ الغائبِ
    /**
     * شرطانِ يُقاسانِ معاً: أنَّ الملفَّ يستوردُ البوّابةَ، وأنَّ معرّفَ المقصدِ
     * مكتوبٌ فيه حرفاً. ولِمَ لا يُطلَبُ نصُّ النداءِ كاملاً: ملفٌّ واحدٌ فيه ثلاثةُ
     * مقاصدَ (مزوّدو الترجمةِ) يُمرِّرُ المعرّفَ من جدولٍ لا يكتبُه في موضعِ النداءِ،
     * فطلبُ النصِّ الكاملِ كانَ سيدفعُ إلى تكرارِ ثلاثةِ نداءاتٍ لأجلِ الحاجزِ لا
     * لأجلِ الصوابِ. والشرطانِ معاً يمنعانِ الحالتَينِ اللتَينِ تُهِمَّانِ:
     * مقصدٌ مُلزَمٌ في ملفٍّ لا بوّابةَ فيه، وبوّابةٌ في ملفٍّ لمقصدٍ غيرِ هذا.
     */
    const importsGate = source.includes("wasla/egress-gate.ts");
    const namesPeer = source.includes(`"${peer.id}"`);
    if (!importsGate || !namesPeer)
      push(
        "١٣ بوّابةٌ موصولةٌ",
        `المُدخلُ ${peer.id} مُلزَمٌ بالبوّابةِ و${peer.callSite} ` +
          `${importsGate ? "لا يذكرُ معرّفَه حرفاً" : "لا يستوردُ البوّابةَ"} — ` +
          "فالإلزامُ مكتوبٌ في السجلِّ وغيرُ موصولٍ في الشيفرةِ",
      );
  }

  // ١٠ — الوثيقةُ مُولَّدةٌ من السجلِّ لا مكتوبةٌ بيدٍ.
  const expected = renderDoc(registry, exemptions);
  const actual = generatedSlice(docText);
  if (actual === undefined) push("١٠ وثيقةٌ مُولَّدةٌ", `علامتا التوليدِ مفقودتانِ من ${DOC_PATH}`);
  else if (actual.trim() !== expected.trim())
    push(
      "١٠ وثيقةٌ مُولَّدةٌ",
      `${DOC_PATH} يفترقُ عن السجلِّ — شغّلْ \`bun run scripts/check-egress-boundary.ts --write\``,
    );

  return problems;
}

/** الكتلةُ المُولَّدةُ من الوثيقةِ، أو `undefined` إن فُقِدَت علامتُها. */
export function generatedSlice(docText: string): string | undefined {
  const a = docText.indexOf(BEGIN);
  const b = docText.indexOf(END);
  if (a === -1 || b === -1 || b < a) return undefined;
  return docText.slice(a + BEGIN.length, b);
}

const CLASS_LABEL: Record<PeerClass, string> = {
  CORE: "CORE — البابُ الوحيدُ بينَ الأنظمةِ",
  CHANNEL: "قناةُ المستخدمِ",
  INFRASTRUCTURE: "بنيةٌ تحتيّةٌ",
  OPTIONAL_AUXILIARY: "خدمةٌ اختياريّةٌ مُعطَّلةٌ افتراضيّاً",
  COMMERCIAL_PENDING_HANDOVER: "تكاملٌ تجاريٌّ مباشرٌ — دَينٌ مُعلَنٌ",
  BROWSER_ASSET: "أصلُ متصفّحٍ",
  USER_LINK: "رابطُ مستخدمٍ — لا نداءَ شبكةٍ",
};

const CLASS_ORDER: readonly PeerClass[] = [
  "CORE",
  "CHANNEL",
  "COMMERCIAL_PENDING_HANDOVER",
  "INFRASTRUCTURE",
  "OPTIONAL_AUXILIARY",
  "BROWSER_ASSET",
  "USER_LINK",
] as const;

function sourceCell(peer: EgressPeer): string {
  if (peer.source.kind === "literal")
    return `حرفاً: ${peer.source.hosts.map((h) => `\`${h}\``).join(" · ")}`;
  if (peer.source.kind === "env")
    return `بيئةٌ: ${peer.source.envKeys.map((k) => `\`${k}\``).join(" · ")}`;
  return `افتراضُ حزمةِ \`${peer.source.packageName}\`: \`${peer.source.host}\``;
}

/** يُولِّدُ الكتلةَ المحصورةَ بعلامتَي التوليدِ في الوثيقةِ. */
export function renderDoc(
  registry: readonly EgressPeer[] = WASLA_EGRESS_REGISTRY,
  exemptions: readonly HostExemption[] = HOST_EXEMPTIONS,
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    "> هذه الكتلةُ **مُولَّدةٌ** من `packages/shared/wasla/egress-registry.ts`. لا تُحرَّرْ بيدٍ:",
    "> حاجزُ `check-egress-boundary` يُسقِطُ البناءَ إن فارقَت السجلَّ.",
    "",
  );
  for (const peerClass of CLASS_ORDER) {
    const rows = registry.filter((p) => p.peerClass === peerClass);
    if (rows.length === 0) continue;
    lines.push(`### ${CLASS_LABEL[peerClass]}`, "");
    lines.push("| المقصدُ | الغرضُ | المصدرُ | موضعُ النداءِ | بوّابةُ التشغيلِ | أُزيلَ؟ |");
    lines.push("|---|---|---|---|---|---|");
    for (const p of rows) {
      const handover =
        p.handover === undefined
          ? ""
          : ` (يُزيلُه \`${p.handover.removedByItem}\`، يحجبُه \`${p.handover.blockedBy}\`)`;
      const gate =
        p.runtimeGate.kind === "gated"
          ? "نعم — `createGuardedFetch`"
          : `لا تنطبقُ: ${p.runtimeGate.reason}`;
      lines.push(
        `| \`${p.id}\` | ${p.purpose}${handover} | ${sourceCell(p)} | \`${p.callSite}\` | ` +
          `${gate} | ${p.removed ? "نعم" : "لا"} |`,
      );
    }
    lines.push("");
  }
  lines.push("### مضيفاتٌ معفاةٌ — نُوّابٌ لا مقاصدُ", "");
  lines.push("| المضيفُ | السببُ |");
  lines.push("|---|---|");
  for (const ex of exemptions) lines.push(`| \`${ex.host}\` | ${ex.reason} |`);
  lines.push("");
  lines.push(
    `**العدُّ**: ${registry.length} مقصداً مُعلَناً · ` +
      `${registry.filter((p) => p.peerClass === "COMMERCIAL_PENDING_HANDOVER").length} تكاملاً ` +
      `تجاريّاً مباشراً ينتظرُ التسليمَ · ${exemptions.length} مضيفاً معفًى · ` +
      "**صفرَ مقصدٍ في MARKET**.",
  );
  lines.push("");
  return lines.join("\n");
}

/** يُعيدُ نصَّ الوثيقةِ وقد استُبدِلَت كتلتُها المُولَّدةُ. */
export function withGeneratedBlock(docText: string, generated: string): string {
  const a = docText.indexOf(BEGIN);
  const b = docText.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error(`علامتا التوليدِ مفقودتانِ من ${DOC_PATH}`);
  return docText.slice(0, a + BEGIN.length) + generated + docText.slice(b);
}

function main(): void {
  const write = process.argv.includes("--write");
  const roadmapText = readFileSync("ROADMAP.md", "utf8");

  if (write) {
    const existing = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, "utf8") : "";
    const shell =
      existing.includes(BEGIN) && existing.includes(END)
        ? existing
        : [
            "# حدُّ الصادرِ في MOVE — كلُّ مقصدٍ شبكيٍّ مُعلَنٌ ومحروسٌ",
            "",
            "الحاكمُ `ADR 0084` · البندُ `W-6` · الحاجزُ `scripts/check-egress-boundary.ts`.",
            "",
            "البندُ `W-6` يقولُ: لا اقترانَ تجاريَّ مباشرَ مع MARKET، وكلُّ مرورٍ بينَ الأنظمةِ",
            "عبرَ CORE. وذلكَ كانَ **صحيحاً بالمصادفةِ لا بالإنفاذِ**: لا سطرَ في المستودعِ",
            "يُخفِقُ لو أُضيفَ نداءٌ مباشرٌ إلى MARKET غداً. فصارَت القائمةُ **مغلقةً**:",
            "مقصدٌ غيرُ مُعلَنٍ يُسقِطُ البناءَ، وإعلانُه يقتضي نظاماً، و`MARKET` مرفوضٌ نصّاً.",
            "",
            BEGIN,
            END,
            "",
          ].join("\n");
    writeFileSync(DOC_PATH, withGeneratedBlock(shell, renderDoc()), "utf8");
    console.log(`✅ وُلِّدَت ${DOC_PATH} من السجلِّ.`);
    return;
  }

  const docText = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, "utf8") : "";
  const problems = egressProblems(roadmapText, docText);
  if (problems.length > 0) {
    console.error(`❌ حدُّ الصادرِ: ${problems.length} مشكلةً.\n`);
    for (const p of problems) console.error(`  • [${p.check}] ${p.detail}`);
    console.error(
      "\nالقاعدةُ: كلُّ مقصدٍ مُعلَنٌ، ولا مرورَ بينَ الأنظمةِ إلّا عبرَ CORE، " +
        "ولا ادّعاءَ إزالةٍ بلا إزالةٍ (ADR 0084).",
    );
    process.exit(1);
  }

  const counts = CLASS_ORDER.map((c) => {
    const n = WASLA_EGRESS_REGISTRY.filter((p) => p.peerClass === c).length;
    return n > 0 ? `${CLASS_LABEL[c].split(" ")[0]}=${n}` : undefined;
  }).filter((x): x is string => x !== undefined);
  console.log(
    `✅ حدُّ الصادرِ مُعلَنٌ بالكاملِ: ${WASLA_EGRESS_REGISTRY.length} مقصداً ` +
      `(${counts.join(" · ")})، و**صفرَ مقصدٍ في MARKET**، ` +
      `و${WASLA_EGRESS_REGISTRY.filter((p) => p.peerClass === "COMMERCIAL_PENDING_HANDOVER").length} تكاملاً تجاريّاً ` +
      "مباشراً مُعلَناً ديناً يُزيلُه `W-7`، والوثيقةُ مطابقةٌ للسجلِّ.",
  );
}

if (import.meta.main) main();
