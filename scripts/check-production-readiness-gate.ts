#!/usr/bin/env bun
/**
 * # check-production-readiness-gate — حارسُ بوابة جاهزية الإنتاج (fail-closed)
 *
 * **الغرض:** حارسُ نمطَين صريحَين (ADR 0246 · ح-PRD-8 بعدَ تعديلِ 2026-10-08):
 *
 * - **نمطُ CI (الافتراضيُّ، كلُّ دفعةٍ وطلبِ دمج):** يُفشلُ (exit 1) على خللِ البوابةِ
 *   وعلى ادّعاءِ «Production Ready» الكاذبِ. البنودُ المانعةُ (`Open`/`Blocked`/`Ready`)
 *   **تُطبَعُ ولا تُفشلُ** — وإلّا صارَ كلُّ طلبِ دمجٍ أحمرَ حتّى الإطلاقِ، ومنها
 *   طلباتُ إصلاحِ البنودِ نفسِها، فيتعلّمُ الفريقُ تجاهلَ الأحمر.
 * - **نمطُ الإعلانِ (`--require-ready`):** يُفشلُ (exit 1) على **أيِّ** بندٍ مانعٍ.
 *   هوَ البوابةُ الوحيدةُ التي يُحتجُّ بنجاحِها لإعلانِ Production Ready (ح-PRD-7)،
 *   ويُشغَّلُ بـ`bun run check:production-readiness` وبسيرِ
 *   `.github/workflows/production-readiness.yml`.
 *
 * **خمسُ حالاتٍ في البوابة (ADR 0246):**
 *
 * | الحالة | المعنى | مانعة؟ |
 * |---|---|---|
 * | `Open` | عملٌ مطلوبٌ لم يُبدَأ | نعم |
 * | `Ready` | جاهزٌ للتنفيذ/التحقّق، لم يُغلَق | نعم |
 * | `Blocked` | محجوبٌ — ينتظرُ قرارًا أو موردًا | نعم |
 * | `Verified` | أُنجزَ وتُحقّقَ منه بدليلٍ إنتاجي | لا (بشرط وجود evidence path) |
 * | `ADR-Closed` | أُغلقَ بقرارِ مالكٍ موثَّقٍ في ADR | لا (بشرط وجود مسار ADR) |
 *
 * **فشلٌ صريحٌ (exit 1) عند:**
 * 1. وجودُ بندٍ بصورةٍ مانعة (`Open`/`Blocked`/`Ready`) — **في نمطِ `--require-ready` وحدَه**.
 * 2. وجودُ بندٍ `Verified` بلا مسارِ دليلٍ في `docs/evidence/production/`.
 * 3. وجودُ بندٍ `ADR-Closed` بلا مسارِ ADR في `docs/adr/`.
 * 4. وجودُ بندٍ بحالةٍ غيرِ معروفةٍ.
 * 5. ادّعاءُ «Production Ready» في وثيقةٍ حاكمةٍ (SYSTEM_STATE / ROADMAP /
 *    ROADMAP-MASTER) بينما البوابةُ مانعة.
 * 6. عددُ البنود المستخرجةِ أقلُّ من المتوقّع (21) — parsing ناقص.
 *
 * **ينتمي إلى:** حوكمة المستودع — ADR 0246.
 * **يُستخدَم من:** سلسلة `bun run ci` و `.github/workflows/ci.yml`.
 * **وحداته النقية:** قابلة للحقن بالكامل — `gateContent` و`systemStateContent` و
 * `roadmapContent` و`roadmapMasterContent` مدخلات.
 */

import { existsSync, readFileSync } from "node:fs";

const GATE_PATH = "docs/governance/PRODUCTION_READINESS_GATE.md";
const SYSTEM_STATE_PATH = "docs/SYSTEM_STATE.md";
const ROADMAP_PATH = "ROADMAP.md";
const ROADMAP_MASTER_PATH = "docs/ROADMAP-MASTER.md";

/** الحالاتُ المسموحةُ في البوابة (ADR 0246). */
const VALID_STATUSES = new Set(["Open", "Blocked", "Ready", "Verified", "ADR-Closed"]);

/** أقلُّ عددِ بنودٍ متوقَّع. إن كانَ أقلَّ، فالـparsing ناقصٌ. */
const MIN_EXPECTED_ITEMS = 21;

/** الحالاتُ المانعةُ — وجودُ أيٍّ منها في نطاقِ الجاهزيّةِ يمنعُ إعلانَ Production Ready. */
const BLOCKING_STATUSES = new Set(["Open", "Blocked", "Ready"]);

/**
 * نطاقُ إعلانِ Production Ready = P0 (`PRD-0NN`) وP1 (`PRD-1NN`) وحدَهما، كما في
 * «شروط إعلان Production Ready» في البوابة. وبنودُ P2 (`PRD-2NN`) **بواباتُ إطلاقٍ
 * تجاريٍّ تُفتحُ بعدَه** — فعدُّها مانعةً كانَ يجعلُ الإعلانَ مستحيلاً قبلَ الإطلاقِ
 * التجاريِّ، خلافاً للوثيقة. تُطبَعُ ولا تمنع.
 */
function inReadinessScope(id: string): boolean {
  const n = Number.parseInt(id.replace(/^PRD-/, ""), 10);
  return Number.isFinite(n) && n < 200;
}

export interface GateItem {
  readonly id: string;
  readonly status: string;
  readonly hasEvidencePath: boolean;
  readonly hasAdrPath: boolean;
}

export interface ProductionReadinessCheckInput {
  readonly gateContent: string;
  readonly systemStateContent: string;
  readonly roadmapContent: string;
  readonly roadmapMasterContent: string;
  /**
   * نمطُ الإعلانِ: البنودُ المانعةُ تُفشلُ. الافتراضُ `false` (نمطُ CI). صريحٌ لا
   * مُستنتَجٌ، كي لا يصيرَ الفرقُ بينَ النمطَين سلوكاً خفيّاً.
   */
  readonly requireReady?: boolean;
}

export interface ProductionReadinessCheckResult {
  /** بنودٌ مانعةٌ (Open/Blocked/Ready) في نطاقِ الجاهزيّةِ (P0/P1). */
  readonly blockingItems: readonly string[];
  /** بنودُ P2 المفتوحةُ — بواباتُ إطلاقٍ تجاريٍّ لا تمنعُ إعلانَ Production Ready. */
  readonly commercialOpenItems: readonly string[];
  /** بنودٌ Verified بلا مسار دليل — تفشل CI. */
  readonly verifiedWithoutEvidence: readonly string[];
  /** بنودٌ ADR-Closed بلا مسار ADR — تفشل CI. */
  readonly adrClosedWithoutAdr: readonly string[];
  /** بنودٌ بحالةٍ غيرِ معروفة — تفشل CI. */
  readonly unknownStatusItems: readonly string[];
  /** ادّعاءُ Production Ready في وثيقةٍ حاكمةٍ — يفشل CI. */
  readonly falseReadyClaim: boolean;
  /** عددُ البنود المستخرجة. */
  readonly parsedItemCount: number;
  /** هل البوابةُ مانعة؟ (true = افشل CI) */
  readonly fails: boolean;
  /** سببُ الفشل أو النجاح. */
  readonly reason: string;
}

/**
 * يستخرجُ بنودَ البوابة وحالاتها من محتوى الملف.
 * يقسّمُ المحتوى إلى كُتلٍ مفصولةٍ بعناوين `### PRD-NNN:`.
 */
function parseGateItems(content: string): readonly GateItem[] {
  const items: GateItem[] = [];

  const headerRegex = /^###\s+(PRD-\d+):/gm;
  const sections: { id: string; body: string }[] = [];

  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let lastId: string | null = null;

  match = headerRegex.exec(content);
  while (match !== null) {
    const currentId = match[1];
    if (lastId !== null) {
      sections.push({ id: lastId, body: content.slice(lastIndex, match.index) });
    }
    lastId = currentId ?? null;
    lastIndex = match.index;
    match = headerRegex.exec(content);
  }
  if (lastId !== null) {
    sections.push({ id: lastId, body: content.slice(lastIndex) });
  }

  for (const section of sections) {
    const body = section.body;

    // ابحث عن `| الحالة | **Status** |`
    // يدعم: Open · Blocked · Ready · Verified · ADR-Closed
    // وأي حالة أخرى (للكشف عن الحالات غير المعروفة)
    // `[^|]*?` غيرُ جشعٍ لئلا يتجاوزَ `**` الأولى
    const statusMatch = body.match(/\|\s*الحالة\s*\|\s*\*\*([^*]+)\*\*/);
    if (!statusMatch) continue;

    const status = statusMatch[1]?.trim() ?? "";

    // ابحث عن مسار دليل إنتاجي
    const evidenceMatch = body.match(/docs\/evidence\/production\/[^\s|)]+/);

    // ابحث عن مسار ADR
    const adrMatch = body.match(/docs\/adr\/\d{4}-[^\s|)]+\.md/);

    items.push({
      id: section.id,
      status,
      hasEvidencePath: Boolean(evidenceMatch),
      hasAdrPath: Boolean(adrMatch),
    });
  }

  return items;
}

/**
 * يتحقّقُ من أنَّ المحتوى لا يدّعي «Production Ready» في سياقٍ إيجابي.
 * يبحثُ عن «Production Ready» أو «جاهز للإنتاج» في سياقٍ
 * غير مشروطٍ بـ«ليس» أو «لا» أو «غير» أو «عند».
 */
function hasFalseReadyClaim(content: string): boolean {
  const lines = content.split("\n");

  for (const line of lines) {
    if (/(ليس|لا|غير|لم يُتحقَّق|not|isn't|is not)/i.test(line)) {
      continue;
    }

    if (/عند|إذا|عندما|شرط|بعد|then|when|after/i.test(line)) {
      continue;
    }

    if (/Production Ready/i.test(line)) {
      return true;
    }

    if (/جاهز\s*للإنتاج|جاهزٌ? للإنتاج/i.test(line)) {
      return true;
    }
  }

  return false;
}

export function checkProductionReadinessGate(
  input: ProductionReadinessCheckInput,
): ProductionReadinessCheckResult {
  const items = parseGateItems(input.gateContent);

  const blockingItems = items
    .filter((item) => BLOCKING_STATUSES.has(item.status) && inReadinessScope(item.id))
    .map((item) => `${item.id} (${item.status})`);

  const commercialOpenItems = items
    .filter((item) => BLOCKING_STATUSES.has(item.status) && !inReadinessScope(item.id))
    .map((item) => `${item.id} (${item.status})`);

  const verifiedWithoutEvidence = items
    .filter((item) => item.status === "Verified" && !item.hasEvidencePath)
    .map((item) => item.id);

  const adrClosedWithoutAdr = items
    .filter((item) => item.status === "ADR-Closed" && !item.hasAdrPath)
    .map((item) => item.id);

  const unknownStatusItems = items
    .filter((item) => !VALID_STATUSES.has(item.status))
    .map((item) => `${item.id} (${item.status})`);

  const hasBlocking = blockingItems.length > 0;
  const hasVerifiedWithoutEvidence = verifiedWithoutEvidence.length > 0;
  const hasAdrClosedWithoutAdr = adrClosedWithoutAdr.length > 0;
  const hasUnknownStatus = unknownStatusItems.length > 0;
  const hasTooFewItems = items.length < MIN_EXPECTED_ITEMS;

  // ادّعاء Production Ready مانعٌ فقط إن وُجدَ بندٌ مانعٌ
  const falseReadyClaim =
    hasBlocking &&
    (hasFalseReadyClaim(input.systemStateContent) ||
      hasFalseReadyClaim(input.roadmapContent) ||
      hasFalseReadyClaim(input.roadmapMasterContent));

  // نمطُ CI يُفشلُ عند:
  // 1. ادعاء Production Ready في وثيقة حاكمة بينما البوابة مانعة
  // 2. Verified بلا دليل
  // 3. ADR-Closed بلا ADR
  // 4. حالة غير معروفة
  // 5. parsing ناقص
  // ونمطُ الإعلانِ (`requireReady`) يُضيفُ: 6. أيُّ بندٍ مانعٍ (Open/Blocked/Ready).
  const requireReady = input.requireReady === true;
  const fails =
    (requireReady && hasBlocking) ||
    falseReadyClaim ||
    hasVerifiedWithoutEvidence ||
    hasAdrClosedWithoutAdr ||
    hasUnknownStatus ||
    hasTooFewItems;

  const reasons: string[] = [];
  if (hasTooFewItems) {
    reasons.push(
      `عددُ البنود المستخرجة (${items.length}) أقلُّ من المتوقّع (${MIN_EXPECTED_ITEMS}) — parsing ناقص`,
    );
  }
  if (hasBlocking) {
    reasons.push(
      requireReady
        ? `بنودٌ مانعةٌ تمنعُ إعلانَ Production Ready: ${blockingItems.join("، ")}`
        : `بنودٌ مانعةٌ (لا تُفشل نمطَ CI وحدها): ${blockingItems.join("، ")}`,
    );
  }
  if (hasVerifiedWithoutEvidence) {
    reasons.push(
      `بنودٌ Verified بلا دليلٍ في docs/evidence/production/: ${verifiedWithoutEvidence.join("، ")}`,
    );
  }
  if (hasAdrClosedWithoutAdr) {
    reasons.push(`بنودٌ ADR-Closed بلا مسار ADR في docs/adr/: ${adrClosedWithoutAdr.join("، ")}`);
  }
  if (hasUnknownStatus) {
    reasons.push(`بنودٌ بحالةٍ غيرِ معروفة: ${unknownStatusItems.join("، ")}`);
  }
  if (falseReadyClaim) {
    reasons.push("ادّعاءُ «Production Ready» في وثيقةٍ حاكمةٍ بينما البوابةُ مانعة");
  }

  const reason =
    reasons.length > 0
      ? reasons.join("؛ ")
      : "بوابة جاهزية الإنتاج: كلُّ البنود مُغلَقة — Production Ready ممكن";

  return {
    blockingItems,
    commercialOpenItems,
    verifiedWithoutEvidence,
    adrClosedWithoutAdr,
    unknownStatusItems,
    falseReadyClaim,
    parsedItemCount: items.length,
    fails,
    reason,
  };
}

// --- CLI entry point ---
if (import.meta.main) {
  if (!existsSync(GATE_PATH)) {
    console.error(`::error::بوابة جاهزية الإنتاج غير موجودة: ${GATE_PATH}`);
    console.error("   يجب أن تكون موجودةً وفق ADR 0246.");
    process.exit(1);
  }

  if (!existsSync(SYSTEM_STATE_PATH)) {
    console.error(`::error::SYSTEM_STATE.md غير موجود: ${SYSTEM_STATE_PATH}`);
    process.exit(1);
  }

  if (!existsSync(ROADMAP_PATH)) {
    console.error(`::error::ROADMAP.md غير موجود: ${ROADMAP_PATH}`);
    process.exit(1);
  }

  const gateContent = readFileSync(GATE_PATH, "utf-8");
  const systemStateContent = readFileSync(SYSTEM_STATE_PATH, "utf-8");
  const roadmapContent = readFileSync(ROADMAP_PATH, "utf-8");

  let roadmapMasterContent = "";
  if (existsSync(ROADMAP_MASTER_PATH)) {
    roadmapMasterContent = readFileSync(ROADMAP_MASTER_PATH, "utf-8");
  }

  const requireReady = process.argv.includes("--require-ready");
  const result = checkProductionReadinessGate({
    gateContent,
    systemStateContent,
    roadmapContent,
    roadmapMasterContent,
    requireReady,
  });
  console.log(`النمط: ${requireReady ? "إعلان (--require-ready)" : "CI"}`);

  const gateStatus = result.blockingItems.length > 0 ? "مانعة" : "مُغلَقة";
  console.log(`بوابة جاهزية الإنتاج: ${result.parsedItemCount} بندًا — ${gateStatus}`);

  if (result.blockingItems.length > 0) {
    console.log(`ℹ️  بنودٌ مانعةٌ في بوابة جاهزية الإنتاج (${result.blockingItems.length}):`);
    for (const item of result.blockingItems) {
      console.log(`   — ${item}`);
    }
    console.log(
      requireReady
        ? "   البوابةُ مانعةٌ — إعلانُ Production Ready مرفوض."
        : "   البوابةُ مانعةٌ — ليس Production Ready (نمطُ CI لا يُفشلُ عليها؛ نمطُ --require-ready يُفشل).",
    );
  }

  if (result.commercialOpenItems.length > 0) {
    console.log(
      `ℹ️  بواباتُ الإطلاقِ التجاريِّ (P2) المفتوحةُ — لا تمنعُ الإعلان (${result.commercialOpenItems.length}): ${result.commercialOpenItems.join("، ")}`,
    );
  }

  if (result.verifiedWithoutEvidence.length > 0) {
    console.error(
      `::error::بنودٌ Verified بلا دليلٍ في docs/evidence/production/: ${result.verifiedWithoutEvidence.join("، ")}`,
    );
  }

  if (result.adrClosedWithoutAdr.length > 0) {
    console.error(
      `::error::بنودٌ ADR-Closed بلا مسار ADR في docs/adr/: ${result.adrClosedWithoutAdr.join("، ")}`,
    );
  }

  if (result.unknownStatusItems.length > 0) {
    console.error(`::error::بنودٌ بحالةٍ غيرِ معروفة: ${result.unknownStatusItems.join("، ")}`);
  }

  if (result.falseReadyClaim) {
    console.error(`::error::ادّعاءُ «Production Ready» في وثيقةٍ حاكمةٍ بينما البوابةُ مانعة`);
    console.error("   راجع ADR 0246 — القاعدة ح-PRD-2.");
  }

  if (result.parsedItemCount < MIN_EXPECTED_ITEMS) {
    console.error(
      `::error::عددُ البنود المستخرجة (${result.parsedItemCount}) أقلُّ من المتوقّع (${MIN_EXPECTED_ITEMS}).`,
    );
    console.error("   قد يكون الـparsing ناقصًا — راجع تنسيق البوابة.");
  }

  if (result.fails) {
    console.error(`::error::${result.reason}`);
    process.exit(1);
  }

  if (result.blockingItems.length > 0) {
    console.log("ℹ️  بوابة جاهزية الإنتاج: مانعةٌ — ليس Production Ready.");
  } else {
    console.log("✅ بوابة جاهزية الإنتاج: كلُّ البنود مُغلَقة — Production Ready ممكن.");
  }
}
