/**
 * الغرض: برهانُ **رفضِ** الإقلاعِ متعدّدِ المثيلاتِ في رصةٍ حقيقيّةٍ من ثلاثِ حاوياتٍ —
 *   القياسُ الوحيدُ المشروعُ اليومَ في مسارِ `F5-06`. `ADR 0050` §٣-ب يوجبُ أن يكونَ
 *   كسرُ شرطِ النسخةِ الواحدةِ **صاخباً لا صامتاً**، وهذا الملفُّ يقيسُ الصخبَ حيثُ
 *   يقعُ: ثلاثُ حاوياتٍ تُعلِنُ `PROCESS_TOPOLOGY=multi-process` وآليةُ التوزيعِ
 *   المُقرَّرةُ «in-process»، فالمُنتظَرُ خروجٌ غيرُ صفريٍّ برمزِ
 *   `SINGLE_INSTANCE_INVARIANT` في كلِّ واحدةٍ — لا إقلاعٌ ولا تدهورٌ صامتٌ.
 * الحالة: منفَّذٌ — يُستدعى من وظيفةِ CI `chaos-multi-instance`.
 * ينتمي إلى: scripts
 * الاستعمال: bun run scripts/f5-06-invariant-refusal.ts [ملفُّ compose]
 *
 * ## لماذا هذا القياسُ لا رحلةُ الفوضى
 *
 * رحلةُ الفوضى (`scripts/f5-06-chaos.ts`) تشترطُ إقلاعَ ثلاثِ بوّاباتٍ، والإقلاعُ
 * **مرفوضٌ سياديّاً** حتّى تُقرَّرَ آليةُ توزيعٍ تعبرُ حدودَ العمليةِ بـADR ناسخٍ
 * لـ`ADR 0050` §٨. فالسقوطُ في CI ليسَ عطباً يُصلَحُ بالشيفرةِ بل **حاجزٌ يُقرأُ**؛
 * وإجبارُ الرحلةِ على المرورِ يقتضي إمّا تعطيلَ الحاجزِ (ممنوعٌ نصًّا: «ولا تجاوزَ
 * بمتغيّرِ بيئةٍ») وإمّا إعلانَ طوبولوجيا واحدةٍ ثمَّ تشغيلَ ثلاثِ نسخٍ — وهو
 * **الكذبُ نفسُه** الذي جاءَ `R-17` يمنعُه. فيُقاسُ ما يُمكِنُ قياسُه صادقاً.
 */

const DEFAULT_COMPOSE_FILE = "docker-compose.f5-06.yml";

/** الخدماتُ التي يجبُ أن تُرفَضَ. الثلاثُ معاً: رفضٌ في واحدةٍ لا يُغني. */
export const REFUSAL_SERVICES = ["gateway-1", "gateway-2", "gateway-3"] as const;

/** رمزُ الخرقِ كما يُطبَعُ من `packages/shared/config/single-instance.ts`. */
export const INVARIANT_CODE = "SINGLE_INSTANCE_INVARIANT";

export interface ServiceObservation {
  readonly service: string;
  /** رمزُ الخروجِ، أو `null` إن كانتِ الحاويةُ لم تخرج بعدُ. */
  readonly exitCode: number | null;
  readonly logs: string;
}

export type RefusalFindingCode =
  | "SERVICE_MISSING"
  | "BOOTED_INSTEAD_OF_REFUSING"
  | "EXITED_ZERO"
  | "INVARIANT_CODE_ABSENT";

export interface RefusalFinding {
  readonly code: RefusalFindingCode;
  readonly service: string;
  readonly detail: string;
}

/**
 * الحكمُ نقيّاً: يُعيدُ المخالفاتِ. لا يُنادي docker ولا يقرأُ بيئةً — كي يُختبَرَ
 * بلا رصةٍ، ولأنَّ Docker غيرُ متاحٍ خارجَ CI فيبقى المنطقُ مقيساً محلّيّاً.
 */
export function analyseRefusal(observations: readonly ServiceObservation[]): RefusalFinding[] {
  const findings: RefusalFinding[] = [];
  for (const service of REFUSAL_SERVICES) {
    const observation = observations.find((candidate) => candidate.service === service);
    if (observation === undefined) {
      findings.push({
        code: "SERVICE_MISSING",
        service,
        detail: "الخدمةُ غائبةٌ عن الرصةِ — لا يُحكَمُ برفضٍ لم يُشاهَد",
      });
      continue;
    }
    if (observation.exitCode === null) {
      findings.push({
        code: "BOOTED_INSTEAD_OF_REFUSING",
        service,
        detail: "الحاويةُ لم تخرج: الإقلاعُ لم يُرفَض وشرطُ الصحّةِ لم يُنفَّذ",
      });
      continue;
    }
    if (observation.exitCode === 0) {
      findings.push({
        code: "EXITED_ZERO",
        service,
        detail: "خروجٌ برمزِ صفرٍ — خروجٌ لا رفضٌ",
      });
      continue;
    }
    if (!observation.logs.includes(INVARIANT_CODE)) {
      findings.push({
        code: "INVARIANT_CODE_ABSENT",
        service,
        detail: `خروجٌ برمزِ ${observation.exitCode} بلا ${INVARIANT_CODE} — سقوطٌ لسببٍ آخرَ يُخفي الحاجزَ`,
      });
    }
  }
  return findings;
}

async function run(command: readonly string[]): Promise<string> {
  const proc = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
  const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return out;
}

interface ComposePsRow {
  readonly Service?: string;
  readonly ExitCode?: number;
  readonly State?: string;
}

/** `docker compose ps -a --format json` يُخرِجُ سطراً لكلِّ خدمةٍ أو مصفوفةً واحدةً. */
export function parseComposePs(stdout: string): readonly ComposePsRow[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed) as ComposePsRow[];
  return trimmed
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ComposePsRow);
}

async function observe(composeFile: string): Promise<ServiceObservation[]> {
  const rows = parseComposePs(
    await run(["docker", "compose", "-f", composeFile, "ps", "-a", "--format", "json"]),
  );
  const observations: ServiceObservation[] = [];
  for (const service of REFUSAL_SERVICES) {
    const row = rows.find((candidate) => candidate.Service === service);
    if (row === undefined) continue;
    const exited = row.State === "exited" || row.State === "dead";
    observations.push({
      service,
      exitCode: exited ? (row.ExitCode ?? 1) : null,
      logs: await run(["docker", "compose", "-f", composeFile, "logs", "--no-color", service]),
    });
  }
  return observations;
}

async function main(): Promise<void> {
  const composeFile = Bun.argv[2] ?? DEFAULT_COMPOSE_FILE;
  const deadline = Date.now() + 120_000;
  let findings: RefusalFinding[] = [];
  let observations: ServiceObservation[] = [];
  // انتظارٌ حتّى تخرجَ الحاوياتُ الثلاثُ — لا حكمٌ على لحظةٍ واحدةٍ.
  while (Date.now() < deadline) {
    observations = await observe(composeFile);
    findings = analyseRefusal(observations);
    if (findings.length === 0) break;
    if (findings.every((finding) => finding.code === "BOOTED_INSTEAD_OF_REFUSING")) {
      await Bun.sleep(3000);
      continue;
    }
    break;
  }
  for (const observation of observations) {
    console.log(
      `▶ [F5-06] ${observation.service}: رمزُ الخروجِ ${observation.exitCode ?? "قائمةٌ بعدُ"}`,
    );
  }
  if (findings.length > 0) {
    console.error("\n❌ [F5-06] شرطُ صحّةِ النسخةِ الواحدةِ لم يُنفَّذ كما يوجبه ADR 0050 §٣-ب:");
    for (const finding of findings)
      console.error(`   • ${finding.service} — ${finding.code}: ${finding.detail}`);
    process.exit(1);
  }
  console.log(
    `\n✅ [F5-06] البوّاباتُ الثلاثُ رفضَتِ الإقلاعَ برمزِ ${INVARIANT_CODE} في رصةٍ حقيقيّةٍ — الكسرُ صاخبٌ لا صامتٌ (ADR 0050 §٣-ب · R-17).`,
  );
  console.log(
    "   ولا يُقرأُ هذا إغلاقاً لـF5-06: رحلةُ الفوضى تشترطُ آليةَ توزيعٍ تعبرُ حدودَ العمليةِ (ADR 0050 §٣-د · §٨).",
  );
}

if (import.meta.main) await main();
