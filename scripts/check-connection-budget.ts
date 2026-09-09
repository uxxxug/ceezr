#!/usr/bin/env bun
/**
 * # الحاجزُ: ميزانيّةُ الاتّصالاتِ مصدرُ حقيقةٍ واحدٌ لا فقرةٌ في وثيقةٍ — `F7-04` · `CAP-004`
 *
 * **الغرض:** أن يستحيلَ فتحُ تجمُّعِ اتّصالاتٍ في شيفرةِ الإنتاجِ بسقفٍ **لا تعرفُه
 * الميزانيّةُ**، وأن يستحيلَ أن تتباعدَ الميزانيّةُ عن مانيفستِ النشرِ بلا سقوطِ بناءٍ.
 *
 * والعيبُ المُعالَجُ ليس خطأً في حسابٍ: `ADR 0056` §٣-ج أعلنَ الصيغةَ `5N + 10M`
 * **نصّاً**، فتقادَمَت بلا أن يُخطِرَ بها شيءٌ — فُصِلَت خدمةُ اللوحةِ بتجمُّعِها
 * (`F5-08` · ADR 0064) فصارَ حدٌّ كاملٌ خارجَ الصيغةِ، و`RUN_WORKER_IN_GATEWAY`
 * تُضاعِفُ حِملَ البوّابةِ والصيغةُ لا تراها. **ووثيقةٌ لا يُنفِذُها شيءٌ تتقادَمُ
 * بالتعريفِ**، فالإنفاذُ ههنا.
 *
 * **الحالة:** منفّذ فعلياً · مبرهَنُ السقوطِ بخرقٍ مزروعٍ
 * (`tests/unit/check-connection-budget.test.ts`).
 *
 * **ينتمي إلى:** البند `F7-04` (ROADMAP §12 · F7) · `CAP-004` · ADR 0073 · ADR 0056.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** سلسلةُ `bun run ci` وخطوةٌ في `.github/workflows/ci.yml`.
 *
 * ## كيف يُشغَّل
 *
 * ```
 * bun run scripts/check-connection-budget.ts [جذرُ المستودعِ]
 * ```
 *
 * ## الفحوصُ الثلاثةُ
 *
 * ١. **لا سقفَ حرفيّاً في شيفرةِ الإنتاجِ.** كلُّ `createSql({ … max: … })` في
 *    `apps/` و`packages/` إمّا يُغفِلُ `max` (فيأخذُ الافتراضيَّ المُعلَنَ) أو
 *    يُمرِّرُ حقلاً من `DB_POOL_MAX`. ورقمٌ حرفيٌّ سقوطٌ — وهو الشكلُ الذي كانَ.
 * ٢. **لا دورَ ميّتاً.** كلُّ دورٍ في `DB_POOL_MAX` يُستعمَلُ فعلاً في شيفرةِ
 *    الإنتاجِ. ودورٌ يُعلَنُ ولا يُستعمَلُ ميزانيّةٌ تحسبُ ما لا يُفتَحُ — وهو كذبٌ
 *    في الاتّجاهِ الآخرِ.
 * ٣. **تكافؤُ الطوبولوجيا مع المانيفستِ.** `DECLARED_TOPOLOGY` تُساوي ما في
 *    `render.yaml`: `numInstances` لكلِّ خدمةٍ، و`RUN_WORKER_IN_GATEWAY` للبوّابةِ.
 *    وإعلانانِ عن شيءٍ واحدٍ في موضعَين، وتنافرُهما أسوأُ من خطأِ أحدِهما لأنّ كلَّ
 *    قارئٍ يُصدِّقُ ما تحتَ يدِه.
 *
 * ## ما لا يفعله هذا الحاجزُ عن قصد
 *
 * - **لا يُقارِنُ المجموعَ بسقفِ المزوِّدِ.** سقفُ Supabase مُدخَلٌ من خارجِ
 *   المستودعِ (خطّةُ الحسابِ · إعدادُ pooler) لا يُشتقُّ من شيفرةٍ، وحاجزٌ أخضرُ
 *   على رقمٍ مُخترَعٍ يُطمئنُ زوراً (`ح-5`). فالمحسوبُ **الطلبُ** لا **العرضُ**.
 * - **لا يحكمُ على `tests/` ولا `scripts/` ولا `bench/`.** تلكَ تفتحُ تجمُّعاتٍ
 *   عابرةً بأحجامٍ تخصُّ سيناريو السباقِ نفسِه، وإلزامُها بميزانيّةِ الإنتاجِ
 *   يُفسِدُ الاختبارَ ولا يحمي الإنتاجَ.
 * - **لا يُحلِّلُ YAML تحليلاً عامّاً** — على نهجِ `check-instance-invariant.ts`:
 *   شكلٌ ضيّقٌ مُلزَمٌ، وما خرجَ عنه سقوطٌ. ولا مكتبةَ YAML تُضافُ لأجلِ حاجزٍ.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  DB_POOL_MAX,
  DB_POOL_ROLES,
  type DbPoolRole,
  DECLARED_TOPOLOGY,
} from "../packages/shared/config/connection-budget.ts";

/** أشجارُ شيفرةِ الإنتاجِ وحدَها. */
export const PRODUCTION_TREES = ["apps", "packages"] as const;

/** الملفُّ الذي يُعرِّفُ الميزانيّةَ نفسَها — يُستثنى فلا يُحاكَمُ بقواعدِه. */
export const BUDGET_MODULE = join("packages", "shared", "config", "connection-budget.ts");

/** مانيفستُ النشرِ، ومطابقةُ أسماءِ خدماتِه بحقولِ الطوبولوجيا. */
export const MANIFEST_NAME = "render.yaml";
export const GATEWAY_SERVICE = "waslah-gateway";
export const WORKER_SERVICE = "waslah-worker";
export const ADMIN_SERVICE = "waslah-admin";

/**
 * الدورُ الذي لا يظهرُ في نداءٍ لأنّ صاحبَه يُغفِلُ `max` عن قصدٍ
 * (`apps/gateway/src/container.ts` يأخذُ الافتراضيَّ) — فيُحسَبُ مُستعمَلاً بحكمِ
 * كونِه الافتراضيَّ لا بحكمِ ظهورِه.
 */
export const IMPLICIT_DEFAULT_ROLE: DbPoolRole = "gatewayRequest";

export interface Finding {
  readonly code: string;
  readonly detail: string;
}

// ── قراءةُ مواضعِ إنشاءِ التجمُّعاتِ ───────────────────────────────────────────

/**
 * يلتقطُ نصَّ وسائطِ `createSql` بالأقواسِ المتوازنةِ. **لا مُحلِّلَ TypeScript**،
 * وما لم يُغلَق قوسُه سقوطٌ لا تجاهُلٌ.
 */
export function extractCallArguments(source: string, openIndex: number): string | null {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return null;
}

export interface SourceVerdict {
  readonly findings: readonly Finding[];
  readonly roles: readonly DbPoolRole[];
  readonly calls: number;
}

/** يحكمُ على نصِّ ملفٍّ واحدٍ: مواضعُ `createSql` فيه وأسقفُها. */
export function analyseSource(rel: string, source: string): SourceVerdict {
  const findings: Finding[] = [];
  const roles: DbPoolRole[] = [];
  let calls = 0;
  let cursor = source.indexOf("createSql(");

  while (cursor !== -1) {
    const args = extractCallArguments(source, cursor + "createSql".length);
    if (args === null) {
      findings.push({
        code: "UNPARSEABLE_CALL",
        detail: `${rel}: نداءُ createSql بلا قوسٍ مُغلَقٍ — بنيةٌ لا تُفهَم سقوطٌ`,
      });
      break;
    }
    calls += 1;
    const maxMatch = /\bmax\s*:\s*([^,}\n]+)/.exec(args);
    if (maxMatch !== null) {
      const expression = (maxMatch[1] ?? "").trim();
      const roleMatch = /^DB_POOL_MAX\.([A-Za-z]+)$/.exec(expression);
      if (roleMatch === null) {
        findings.push({
          code: "MAX_NOT_FROM_BUDGET",
          detail:
            `${rel}: سقفُ تجمُّعٍ «${expression}» ليس حقلاً من DB_POOL_MAX — ` +
            `كلُّ سقفٍ في شيفرةِ الإنتاجِ يُقرأُ من نموذجِ الميزانيّةِ (F7-04)`,
        });
      } else if (!(DB_POOL_ROLES as readonly string[]).includes(roleMatch[1] ?? "")) {
        findings.push({
          code: "UNKNOWN_ROLE",
          detail: `${rel}: الدورُ «${roleMatch[1] ?? ""}» غيرُ مُعلَنٍ في DB_POOL_ROLES`,
        });
      } else {
        roles.push(roleMatch[1] as DbPoolRole);
      }
    }
    cursor = source.indexOf("createSql(", cursor + 1);
  }

  return { findings, roles, calls };
}

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
      continue;
    }
    if (full.endsWith(".ts") || full.endsWith(".tsx")) found.push(full);
  }
  return found;
}

// ── قراءةُ المانيفستِ ────────────────────────────────────────────────────────

export interface ManifestService {
  readonly name: string;
  readonly numInstances: number | null;
  readonly runWorkerInGateway: boolean | null;
}

/**
 * يقرأُ المانيفستَ بشكلٍ ضيّقٍ: خدمةٌ تبدأُ بـ`  - type:`، واسمُها و`numInstances`
 * عندَ أربعِ مسافاتٍ، والمتغيّراتُ عندَ ستٍّ (`      - key:`).
 */
export function servicesFromManifest(text: string): ManifestService[] {
  const services: ManifestService[] = [];
  let name: string | null = null;
  let numInstances: number | null = null;
  let runWorker: boolean | null = null;
  let pendingKey: string | null = null;

  const flush = (): void => {
    if (name !== null) services.push({ name, numInstances, runWorkerInGateway: runWorker });
    name = null;
    numInstances = null;
    runWorker = null;
  };

  for (const line of text.split("\n")) {
    if (/^ {2}- type:/.test(line)) {
      flush();
      continue;
    }
    const nameMatch = /^ {4}name:\s*(\S+)/.exec(line);
    if (nameMatch !== null) {
      name = nameMatch[1] ?? null;
      continue;
    }
    const instancesMatch = /^ {4}numInstances:\s*(\d+)/.exec(line);
    if (instancesMatch !== null) {
      numInstances = Number(instancesMatch[1]);
      continue;
    }
    const keyMatch = /^ {6}- key:\s*(\S+)/.exec(line);
    if (keyMatch !== null) {
      pendingKey = keyMatch[1] ?? null;
      continue;
    }
    const valueMatch = /^ {8}value:\s*"?([^"\n#]*)"?/.exec(line);
    if (valueMatch !== null && pendingKey === "RUN_WORKER_IN_GATEWAY") {
      runWorker = (valueMatch[1] ?? "").trim() === "true";
      pendingKey = null;
    }
  }
  flush();
  return services;
}

/** يحكمُ على تكافؤِ المانيفستِ مع `DECLARED_TOPOLOGY`. */
export function analyseManifest(text: string): Finding[] {
  const findings: Finding[] = [];
  const services = servicesFromManifest(text);
  const expected: Readonly<Record<string, number>> = {
    [GATEWAY_SERVICE]: DECLARED_TOPOLOGY.gatewayInstances,
    [WORKER_SERVICE]: DECLARED_TOPOLOGY.workerInstances,
    [ADMIN_SERVICE]: DECLARED_TOPOLOGY.adminInstances,
  };

  for (const [serviceName, declared] of Object.entries(expected)) {
    const service = services.find((candidate) => candidate.name === serviceName);
    if (service === undefined) {
      findings.push({
        code: "MISSING_SERVICE",
        detail: `الخدمةُ «${serviceName}» ليست في ${MANIFEST_NAME} — والميزانيّةُ تُعلنُ لها نسخاً`,
      });
      continue;
    }
    if (service.numInstances === null) {
      findings.push({
        code: "MISSING_NUM_INSTANCES",
        detail: `الخدمةُ «${serviceName}» بلا numInstances في ${MANIFEST_NAME}`,
      });
      continue;
    }
    if (service.numInstances !== declared) {
      findings.push({
        code: "INSTANCES_MISMATCH",
        detail:
          `تنافرُ إعلانَين: ${MANIFEST_NAME} يقولُ numInstances=${service.numInstances} ` +
          `لـ«${serviceName}» و DECLARED_TOPOLOGY تقولُ ${declared}`,
      });
    }
  }

  const gateway = services.find((candidate) => candidate.name === GATEWAY_SERVICE);
  if (gateway !== undefined) {
    if (gateway.runWorkerInGateway === null) {
      findings.push({
        code: "MISSING_RUN_WORKER",
        detail: `الخدمةُ «${GATEWAY_SERVICE}» بلا RUN_WORKER_IN_GATEWAY في ${MANIFEST_NAME}`,
      });
    } else if (gateway.runWorkerInGateway !== DECLARED_TOPOLOGY.workerRunsInGateway) {
      findings.push({
        code: "RUN_WORKER_MISMATCH",
        detail:
          `تنافرُ إعلانَين: ${MANIFEST_NAME} يقولُ ` +
          `RUN_WORKER_IN_GATEWAY=${String(gateway.runWorkerInGateway)} و DECLARED_TOPOLOGY ` +
          `تقولُ ${String(DECLARED_TOPOLOGY.workerRunsInGateway)}`,
      });
    }
  }

  return findings;
}

// ── الحكمُ على مستودعٍ كاملٍ ──────────────────────────────────────────────────

export interface RepoVerdict {
  readonly findings: readonly Finding[];
  readonly inspectedCalls: number;
}

export function analyseRepo(repoRoot: string): RepoVerdict {
  const findings: Finding[] = [];
  const usedRoles = new Set<DbPoolRole>([IMPLICIT_DEFAULT_ROLE]);
  let inspectedCalls = 0;

  for (const tree of PRODUCTION_TREES) {
    const treePath = join(repoRoot, tree);
    if (!existsSync(treePath)) {
      findings.push({
        code: "MISSING_TREE",
        detail: `شجرةُ الإنتاجِ «${tree}» غيرُ موجودةٍ — الحاجزُ لا ينجح على مُدخلٍ لم يفهمه`,
      });
      continue;
    }
    for (const file of walk(treePath)) {
      const rel = relative(repoRoot, file);
      if (rel === BUDGET_MODULE) continue;
      const verdict = analyseSource(rel, readFileSync(file, "utf8"));
      findings.push(...verdict.findings);
      for (const role of verdict.roles) usedRoles.add(role);
      inspectedCalls += verdict.calls;
    }
  }

  if (inspectedCalls === 0) {
    findings.push({
      code: "NO_CALLS",
      detail: "لم يُعثَر على نداءِ createSql واحدٍ في شيفرةِ الإنتاجِ — حاجزٌ لا يرى شيئاً ليس حاجزاً",
    });
  }

  for (const role of DB_POOL_ROLES) {
    if (!usedRoles.has(role)) {
      findings.push({
        code: "UNUSED_ROLE",
        detail:
          `الدورُ «${role}» مُعلَنٌ في DB_POOL_MAX ولا يُستعمَلُ في شيفرةِ الإنتاجِ — ` +
          `ميزانيّةٌ تحسبُ ما لا يُفتَحُ كذبٌ في الاتّجاهِ الآخرِ`,
      });
    }
    if (!Number.isInteger(DB_POOL_MAX[role]) || DB_POOL_MAX[role] < 1) {
      findings.push({
        code: "INVALID_ROLE_LIMIT",
        detail: `الدورُ «${role}» سقفُه ${String(DB_POOL_MAX[role])} — والسقفُ عددٌ صحيحٌ موجبٌ`,
      });
    }
  }

  const manifestPath = join(repoRoot, MANIFEST_NAME);
  if (!existsSync(manifestPath)) {
    findings.push({
      code: "MISSING_MANIFEST",
      detail: `${MANIFEST_NAME} غيرُ موجودٍ — غيابُ المانيفستِ سقوطٌ لا تخطٍّ`,
    });
  } else {
    findings.push(...analyseManifest(readFileSync(manifestPath, "utf8")));
  }

  return { findings, inspectedCalls };
}

// ── نقطةُ التشغيلِ ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const { findings, inspectedCalls } = analyseRepo(process.argv[2] ?? process.cwd());
  if (findings.length > 0) {
    for (const finding of findings) console.error(`✗ [${finding.code}] ${finding.detail}`);
    console.error(`\nميزانيّةُ الاتّصالاتِ: ${findings.length} خرقاً (F7-04)`);
    process.exit(1);
  }
  console.log(`✓ ميزانيّةُ الاتّصالاتِ: ${inspectedCalls} موضعَ إنشاءٍ مفحوصاً، ولا سقفَ خارجَ النموذجِ`);
}
