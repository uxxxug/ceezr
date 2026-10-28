#!/usr/bin/env bun
/**
 * الغرض: حكمُ تجربةِ §5.8 (SINGLE_TRIP) — LOAD-01 المرحلةُ الثانيةُ. يطبّقُ القواعدَ
 *   المسجَّلةَ مسبقًا في PROTOCOL-load01-notice-trace.md (الملحقِ د) حرفيّاً ولا يخترعُ
 *   قاعدةً: P7 (أزواجُ ST/CUR)، والبوّاباتُ، والسلامةُ، والجردُ. «انخفاضُ claim_ms
 *   وحدَه ليسَ قبولاً»، وحتّى ACCEPT لا يرفعُ LOAD-01 ولا LOAD-01M ولا يدمجُ شيئاً
 *   قبلَ المراجعةِ.
 *
 * المدخل: <out.json> <SLOT:ARM:VALIDITY:DIR>… (ST1/CUR1/ST2/CUR2/ST3/CUR3 — الأزواجُ
 *   بالفهرسِ). الموجاتُ غيرُ الصالحةِ تُستبعدُ منَ الحكمِ لا منَ السجلِّ.
 *
 * الخرج: JSON بحكمٍ واحدٍ من: ACCEPT / REJECT / INCONCLUSIVE + الأدلّةُ رقميّاً.
 *   INCONCLUSIVE = لم تتحقّقْ شروطُ الحكمِ (أزواجٌ صالحةٌ < 2، أو جردٌ فاسدٌ) — لا
 *   يُعادُ التشغيلُ تلقائيّاً؛ يُوثَّقُ ويُقرَّرُ وفقَ قاعدةِ الإعادةِ المسجَّلةِ.
 *
 * ينتمي إلى: deploy/capacity-run/monitor (أداةُ حكمٍ لا تعديلُ كودٍ).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface WaveIn {
  readonly slot: string;
  readonly arm: string;
  readonly valid: boolean;
  readonly dir: string;
}

interface BaseWaveIn {
  readonly g1?: { pct?: number };
  readonly failedGates?: string[];
  readonly gates?: Record<string, string>;
}

interface AuditIn {
  readonly snapshot?: {
    readonly outbox?: {
      readonly byKind?: Record<
        string,
        { total?: number; delivered?: number; pending?: number; dead?: number }
      >;
      readonly claimedWithoutRequestId?: { claimed?: number; withoutRequestId?: number } | null;
    };
    readonly engagedDuplicates?: number;
    readonly riderTripChannel?: { duplicateReceipts?: number };
  };
  readonly violations?: unknown[];
  readonly mismatches?: unknown[];
}

interface MockIn {
  readonly by_method?: { sendMessage?: number };
}

interface InventoryIn {
  readonly arm?: string;
  readonly claims?: number | null;
  readonly correlation?: number | null;
  readonly queriesPerClaim?: number | null;
}

export interface ReadWave extends WaveIn {
  readonly p7Sec: number | null;
  readonly g1Pct: number | null;
  readonly failedGates: string[];
  readonly deadRiderNotice: number | null;
  readonly deliveredRiderNotice: number | null;
  readonly kindSumsOk: boolean;
  readonly violations: number;
  readonly mismatches: number;
  readonly engagedDuplicates: number | null;
  readonly duplicateReceipts: number | null;
  readonly sendMessage: number | null;
  readonly claimed: number | null;
  readonly withoutRequestId: number | null;
  readonly inventory: InventoryIn | null;
  /**
   * حضورُ الأدلّةِ لا قيمُها: ملفٌّ غائبٌ أو حقلٌ غائبٌ لا يُقرأ نظافةً ولا صفرًا —
   * موجةٌ صالحةٌ بلا أدلّتِها الأربعةِ تجعلُ الحكمَ INCONCLUSIVE لا ACCEPT
   * (الفشلُ المغلقُ: الدليلُ الغائبُ شرطٌ غيرُ مُثبَتٍ لا شرطٌ مُستوفى).
   */
  readonly evidence: {
    readonly base: boolean;
    readonly audit: boolean;
    readonly mock: boolean;
    readonly inventory: boolean;
  };
}

const P7_MIN_PAIRS = 2;
const P7_MIN_GAP_SEC = 10;

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function readWave(spec: WaveIn): ReadWave {
  const base = readJson<BaseWaveIn>(join(spec.dir, "base-wave.json"), {});
  const audit = readJson<AuditIn>(join(spec.dir, "db-audit-post.json"), {});
  const mock = readJson<MockIn>(join(spec.dir, "mock-stats-post.json"), {});
  const inventory = readJson<InventoryIn | null>(join(spec.dir, "claim-inventory.json"), null);
  const p7Raw = base.gates?.P7 ?? null;
  const p7 = p7Raw === null ? null : Number(/(\d+(?:\.\d+)?)/.exec(p7Raw)?.[1] ?? Number.NaN);
  const byKind = audit.snapshot?.outbox?.byKind ?? {};
  // حضورُ الأدلّةِ: كلُّ ما يستهلكُهُ الحكمُ منَ الملفِّ يجبُ أن يكونَ موجودًا،
  // فالغائبُ ليسَ صفرًا ولا نظافةً — وإلّا صارَ الحكمُ INCONCLUSIVE (فشلٌ مغلقٌ).
  const evidence = {
    base:
      typeof base.gates?.P7 === "string" &&
      Array.isArray(base.failedGates) &&
      typeof base.g1?.pct === "number",
    audit: audit.snapshot?.outbox?.byKind !== undefined,
    mock: typeof mock.by_method?.sendMessage === "number",
    inventory: inventory !== null,
  };
  const rider = byKind.rider_trip_notice ?? {};
  let kindSumsOk = true;
  for (const k of Object.keys(byKind)) {
    const kk = byKind[k] as
      | { total?: number; delivered?: number; pending?: number; dead?: number }
      | undefined;
    if (kk === undefined) kindSumsOk = false;
    else if ((kk.total ?? 0) !== (kk.delivered ?? 0) + (kk.pending ?? 0) + (kk.dead ?? 0))
      kindSumsOk = false;
  }
  return {
    ...spec,
    p7Sec: p7 === null || Number.isNaN(p7) ? null : p7,
    g1Pct: base.g1?.pct ?? null,
    failedGates: base.failedGates ?? [],
    deadRiderNotice: rider.dead ?? null,
    deliveredRiderNotice: rider.delivered ?? null,
    kindSumsOk,
    violations: (audit.violations ?? []).length,
    mismatches: (audit.mismatches ?? []).length,
    engagedDuplicates: audit.snapshot?.engagedDuplicates ?? null,
    duplicateReceipts: audit.snapshot?.riderTripChannel?.duplicateReceipts ?? null,
    sendMessage: mock.by_method?.sendMessage ?? null,
    claimed: audit.snapshot?.outbox?.claimedWithoutRequestId?.claimed ?? null,
    withoutRequestId: audit.snapshot?.outbox?.claimedWithoutRequestId?.withoutRequestId ?? null,
    inventory,
    evidence,
  };
}

interface GateResult {
  readonly rule: string;
  readonly pass: boolean;
  readonly detail: string;
}

/**
 * قواعدُ §5.8 كما سُجِّلَتْ قبلَ التشغيلِ — لا تُعدَّلُ بعدَ رؤيةِ النتائجِ:
 * 1. P7: متوسّطُ ST ≤ متوسّطِ CUR − 10 ثوانٍ، وST < CUR في كلِّ زوجٍ صالحٍ، وزوجانِ
 *    صالحانِ على الأقلّ.
 * 2. البوّاباتُ: لا فشلَ في ST أكثرَ من CUR، ومتوسّطُ G1 في ST ≥ متوسّطِ CUR − 1.
 * 3. السلامةُ لكلِّ موجةِ ST صالحةٍ: violations/mismatches فارغانِ، engagedDuplicates=0،
 *    duplicateReceipts=0، dead(rider_trip_notice) ≤ أقصى CUR، delivered+pending+dead=total
 *    لكلِّ نوعٍ، sendMessage/delivered ≤ أقصى CUR + نقطةٌ مئويّةٌ واحدةٌ، ونسبةُ الالتقاطِ
 *    بلا request_id ≤ أقصى CUR.
 * 4. الجردُ: موجاتُ ST تُظهرُ استعلامَ ارتباطٍ ≈ 0 لكلِّ التقاطٍ (رحلةٌ واحدةٌ)،
 *    وموجاتُ CUR استعلامَينِ. جردٌ فاسدٌ = INCONCLUSIVE لا ACCEPT.
 */
export function computeVerdict(waves: ReadWave[]): {
  readonly verdict: "ACCEPT" | "REJECT" | "INCONCLUSIVE";
  readonly reasons: string[];
  readonly gates: GateResult[];
  readonly pairs: {
    readonly index: number;
    readonly valid: boolean;
    readonly stP7Sec: number | null;
    readonly curP7Sec: number | null;
  }[];
  readonly note: string;
} {
  const st = waves.filter((w) => w.arm === "ST" && w.slot !== "S1");
  const cur = waves.filter((w) => w.arm === "CUR");
  const stValid = st.filter((w) => w.valid);
  const curValid = cur.filter((w) => w.valid);
  const gates: GateResult[] = [];
  const reasons: string[] = [];

  // 0) حضورُ الأدلّةِ — موجةٌ صالحةٌ بلا ملفّاتِها لا يُحكَمُ عليها أصلًا: الغائبُ
  // ليسَ صفرًا ولا نظافةً. أيُّ موجةٍ صالحةٍ (غيرِ S1) بلا أدلّتِها الأربعةِ ⇒
  // INCONCLUSIVE لا ACCEPT مهما بدتِ الأرقامُ.
  const consumed = [...stValid, ...curValid];
  const brokenEvidence = consumed.filter(
    (w) => !(w.evidence.base && w.evidence.audit && w.evidence.mock && w.evidence.inventory),
  );
  const evidenceOk = brokenEvidence.length === 0;
  gates.push({
    rule: "evidence_present_for_every_valid_wave",
    pass: evidenceOk,
    detail:
      brokenEvidence.length === 0
        ? `waves=${consumed.length}`
        : brokenEvidence
            .map(
              (w) =>
                `${w.slot}:${
                  [
                    w.evidence.base ? "" : "base",
                    w.evidence.audit ? "" : "audit",
                    w.evidence.mock ? "" : "mock",
                    w.evidence.inventory ? "" : "inventory",
                  ]
                    .filter((x) => x !== "")
                    .join("+") || "?"
                }!`,
            )
            .join(" "),
  });
  if (!evidenceOk) reasons.push("missing_evidence");

  // 4) الجردُ قبلَ كلِّ شيءٍ — قبولٌ بجردٍ فاسدٍ لا يجوزُ.
  const stInvOk =
    stValid.length > 0 &&
    stValid.every((w) => (w.inventory?.claims ?? 0) > 0 && (w.inventory?.correlation ?? 1) === 0);
  const curInvOk = curValid.length > 0 && curValid.every((w) => (w.inventory?.claims ?? 0) > 0);
  gates.push({
    rule: "inventory_st_single_trip",
    pass: stInvOk,
    detail: stValid
      .map(
        (w) =>
          `${w.slot}:claims=${w.inventory?.claims ?? "?"},corr=${w.inventory?.correlation ?? "?"}`,
      )
      .join(" "),
  });
  gates.push({
    rule: "inventory_cur_two_trips",
    pass: curInvOk,
    detail: curValid
      .map(
        (w) =>
          `${w.slot}:claims=${w.inventory?.claims ?? "?"},corr=${w.inventory?.correlation ?? "?"}`,
      )
      .join(" "),
  });
  if (!stInvOk) reasons.push("st_inventory_broken");
  if (!curInvOk) reasons.push("cur_inventory_broken");

  // 1) P7 — أزواجٌ بالفهرسِ.
  const pairs = [1, 2, 3].map((i) => {
    const s = st.find((w) => w.slot === `ST${i}`);
    const c = cur.find((w) => w.slot === `CUR${i}`);
    return {
      index: i,
      valid:
        (s?.valid ?? false) &&
        (c?.valid ?? false) &&
        s?.p7Sec !== null &&
        s?.p7Sec !== undefined &&
        c?.p7Sec !== null &&
        c?.p7Sec !== undefined,
      stP7Sec: s?.p7Sec ?? null,
      curP7Sec: c?.p7Sec ?? null,
    };
  });
  const validPairs = pairs.filter((p) => p.valid);
  gates.push({
    rule: "p7_min_valid_pairs",
    pass: validPairs.length >= P7_MIN_PAIRS,
    detail: `valid=${validPairs.length}/${pairs.length}`,
  });
  const stMean =
    validPairs.length > 0
      ? validPairs.reduce((a, p) => a + (p.stP7Sec ?? 0), 0) / validPairs.length
      : null;
  const curMean =
    validPairs.length > 0
      ? validPairs.reduce((a, p) => a + (p.curP7Sec ?? 0), 0) / validPairs.length
      : null;
  gates.push({
    rule: "p7_st_mean_le_cur_minus_10s",
    pass: stMean !== null && curMean !== null && stMean <= curMean - P7_MIN_GAP_SEC,
    detail:
      stMean === null || curMean === null
        ? "no_valid_pairs"
        : `st=${stMean.toFixed(1)}s cur=${curMean.toFixed(1)}s`,
  });
  gates.push({
    rule: "p7_st_lt_cur_every_valid_pair",
    pass: validPairs.length > 0 && validPairs.every((p) => (p.stP7Sec ?? 0) < (p.curP7Sec ?? 0)),
    detail: validPairs
      .map((p) => `ST${p.index}:${p.stP7Sec}s<CUR${p.index}:${p.curP7Sec}s`)
      .join(" "),
  });

  // 2) البوّاباتُ.
  const stFailed = stValid.reduce((a, w) => a + w.failedGates.length, 0);
  const curFailed = curValid.reduce((a, w) => a + w.failedGates.length, 0);
  gates.push({
    rule: "gates_no_more_failures_in_st",
    pass: stFailed <= curFailed,
    detail: `stFailed=${stFailed} curFailed=${curFailed}`,
  });
  const g1Mean = (arr: ReadWave[]): number | null =>
    arr.length === 0 ? null : arr.reduce((a, w) => a + (w.g1Pct ?? 0), 0) / arr.length;
  const stG1 = g1Mean(stValid);
  const curG1 = g1Mean(curValid);
  gates.push({
    rule: "g1_st_ge_cur_minus_1",
    pass: stG1 !== null && curG1 !== null && stG1 >= curG1 - 1,
    detail:
      stG1 === null || curG1 === null
        ? "missing_g1"
        : `st=${stG1.toFixed(2)}% cur=${curG1.toFixed(2)}%`,
  });

  // 3) السلامةُ لكلِّ موجةِ ST صالحةٍ.
  const curMaxDead = curValid.reduce((a, w) => Math.max(a, w.deadRiderNotice ?? 0), 0);
  const curMaxSendRatio = curValid.reduce((a, w) => {
    const d = w.deliveredRiderNotice ?? 0;
    const s = w.sendMessage ?? 0;
    return Math.max(a, d > 0 ? (s / d) * 100 : 0);
  }, 0);
  const curMaxNoRid = curValid.reduce((a, w) => {
    const c = w.claimed ?? 0;
    return Math.max(a, c > 0 ? (w.withoutRequestId ?? 0) / c : 0);
  }, 0);
  for (const w of stValid) {
    gates.push({
      rule: `safety_${w.slot}_clean`,
      pass: w.violations === 0 && w.mismatches === 0 && w.kindSumsOk,
      detail: `violations=${w.violations} mismatches=${w.mismatches} kindSumsOk=${w.kindSumsOk}`,
    });
    gates.push({
      rule: `safety_${w.slot}_no_duplicates`,
      pass: w.engagedDuplicates === 0 && w.duplicateReceipts === 0,
      detail: `engaged=${w.engagedDuplicates} receipts=${w.duplicateReceipts}`,
    });
    gates.push({
      rule: `safety_${w.slot}_dead_le_cur_max`,
      pass: w.deadRiderNotice !== null && w.deadRiderNotice <= curMaxDead,
      detail: `dead=${w.deadRiderNotice} curMax=${curMaxDead}`,
    });
    const d = w.deliveredRiderNotice ?? 0;
    const s = w.sendMessage ?? 0;
    gates.push({
      rule: `safety_${w.slot}_send_ratio_le_cur_plus_1pp`,
      pass: d > 0 && (s / d) * 100 <= curMaxSendRatio + 1,
      detail: `ratio=${d > 0 ? ((s / d) * 100).toFixed(2) : "?"}% curMax=${curMaxSendRatio.toFixed(2)}%`,
    });
    const c = w.claimed ?? 0;
    gates.push({
      rule: `safety_${w.slot}_no_request_id_le_cur`,
      pass: c > 0 && (w.withoutRequestId ?? 0) / c <= curMaxNoRid,
      detail: `noRid=${c > 0 ? (((w.withoutRequestId ?? 0) / c) * 100).toFixed(2) : "?"}% curMax=${(curMaxNoRid * 100).toFixed(2)}%`,
    });
  }

  const allPass = gates.every((g) => g.pass);
  const decidable = evidenceOk && stInvOk && curInvOk && validPairs.length >= P7_MIN_PAIRS;
  const verdict: "ACCEPT" | "REJECT" | "INCONCLUSIVE" = decidable
    ? allPass
      ? "ACCEPT"
      : "REJECT"
    : "INCONCLUSIVE";
  if (!decidable) reasons.push("undecidable_preconditions");
  if (decidable && !allPass)
    gates
      .filter((g) => !g.pass)
      .forEach((g) => {
        reasons.push(g.rule);
      });

  return {
    verdict,
    reasons,
    gates,
    pairs,
    note: "قواعدُ §5.8 المسجَّلةُ قبلَ التشغيلِ. ACCEPT لا يرفعُ LOAD-01 ولا LOAD-01M ولا يدمجُ شيئاً قبلَ المراجعةِ؛ وبوابةُ اختباراتِ التكاملِ (التكافؤُ والالتقاطُ المتزامنُ) شرطٌ قبولٍ رابعٌ يُثبَتُ في CI لا هنا.",
  };
}

if (import.meta.main) {
  const [out, ...specs] = process.argv.slice(2);
  if (out === undefined || specs.length === 0) {
    console.error("الاستعمال: single-trip-verdict.ts <out.json> <SLOT:ARM:VALIDITY:DIR>…");
    process.exit(2);
  }
  const waves = specs.map((s) => {
    const [slot, arm, valid, dir] = s.split(":");
    const spec: WaveIn = {
      slot: slot ?? "",
      arm: arm ?? "",
      valid: valid === "VALID",
      dir: dir ?? "",
    };
    return spec;
  });
  const read = waves.map(readWave);
  const verdict = computeVerdict(read);
  writeFileSync(out, JSON.stringify({ waves: read, ...verdict }, null, 2), "utf8");
  console.log(`VERDICT ${verdict.verdict}`);
  for (const g of verdict.gates) {
    console.log(`  ${g.pass ? "PASS" : "FAIL"}  ${g.rule}  ${g.detail}`);
  }
  if (verdict.reasons.length > 0) console.log(`  reasons: ${verdict.reasons.join(", ")}`);
  process.exit(verdict.verdict === "ACCEPT" ? 0 : 1);
}
