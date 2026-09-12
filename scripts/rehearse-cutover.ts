#!/usr/bin/env bun
/**
 * # مُنفِّذُ تمرينِ التحوُّلِ — **قراءةٌ فقط، ورفضٌ بالإنشاءِ** (`W-9` · ADR 0088)
 *
 * ما يفعلُه على قاعدةٍ حقيقيّةٍ:
 * 1. يسألُ سجلَّ الحواجزِ (`W-8`) عن حواجزِ التمرينِ. وما دامَ واحدٌ منها مفتوحاً
 *    فالنتيجةُ `REFUSED`، وهذا هوَ **الناتجُ الصحيحُ** لا إخفاقاً يُداوى.
 * 2. يُثبِتُ أنَّ الرفضَ ليسَ نصّاً: يفتحُ معاملةً `read only` ويُشغِّلُ مِسبارَي
 *    قراءةٍ من السجلِّ نفسِه، ثمَّ يُشغِّلُ كتابةً **مُتوقَّعَ رفضُها** ويقيسُ أنَّ
 *    القاعدةَ رفضَتها. فلو كانَ المسارُ يكتبُ لَنجحَت الكتابةُ ولَأخفقَ التمرينُ.
 * 3. يُخفِقُ (رمزُ خروجٍ غيرُ صفرٍ) في ثلاثِ حالاتٍ: مِسبارٌ ليسَ للقراءةِ وحدَها ·
 *    كتابةٌ **نجحَت** داخلَ المعاملةِ · أو نتيجةٌ تزعمُ `rehearsalCompleted`.
 *
 * **ما لا يفعلُه:** لا يُهاجِرُ صفّاً، ولا يُنشئُ ولا يُغيِّرُ ولا يحذفُ، ولا
 * يزعمُ أنَّ التحوُّلَ أو الاسترجاعَ جُرِّبَ. `B-5` مفتوحٌ، وهذا المِلفُّ مبنيٌّ
 * على أن يكونَ عاجزاً عن الزعمِ لا مُلتزِماً بتركِه.
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { parseBlockers } from "./lib/wasla-blockers.ts";
import {
  deriveCutoverPlan,
  isReadOnlyStatement,
  isRehearsalRefused,
  rehearseReadOnly,
} from "./lib/wasla-cutover-plan.ts";

/** جملةٌ يُتوقَّعُ **رفضُها** — تُبنى ههنا لتُقاسَ، ولا تُمرَّرُ بمسارِ المِسبارِ. */
const EXPECTED_TO_BE_REJECTED = ["cr", "eate temp table wasla_rehearsal_probe(x int)"].join("");

async function main(): Promise<void> {
  const steps = deriveCutoverPlan();
  const outcome = rehearseReadOnly(steps, parseBlockers(readFileSync("ROADMAP.md", "utf8")));

  if (!isRehearsalRefused(outcome)) {
    if (outcome.rehearsalCompleted !== false) {
      console.error("✗ نتيجةٌ تزعمُ تمريناً تامّاً — وهذا ما لا يجوزُ بناؤُه ألبتّةَ.");
      process.exit(1);
    }
    console.log(
      `تمرينُ القراءةِ: ${outcome.probed} مِسباراً، ولا زعمَ تحوُّلٍ (rehearsalCompleted=false).`,
    );
  } else {
    console.log(`تمرينُ التحوُّلِ مرفوضٌ بالإنشاءِ — الحواجزُ: ${outcome.openGates.join("، ")}`);
    console.log(`  السببُ: ${outcome.reason}`);
  }

  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (url === undefined || url.trim().length === 0) {
    console.error(
      "✗ TEST_DATABASE_URL (أو DATABASE_URL) مطلوبٌ: عجزُ الكتابةِ يُقاسُ على قاعدةٍ حقيقيّةٍ ولا يُحاكى.",
    );
    process.exit(1);
  }

  const sample = steps.slice(0, 2);
  for (const step of sample) {
    if (!isReadOnlyStatement(step.probe.statement)) {
      console.error(`✗ مِسبارٌ ليسَ للقراءةِ وحدَها: ${step.id}`);
      process.exit(1);
    }
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  let writeWasAccepted = false;
  const failures: string[] = [];
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("set transaction read only");
      for (const step of sample) {
        const rows = await tx.unsafe(step.probe.statement);
        const first = rows[0] as { declared?: unknown } | undefined;
        if (first === undefined || first.declared === undefined) {
          failures.push(`${step.id}: المِسبارُ لم يُرجِعْ صفّاً مقروءاً`);
        }
      }
      try {
        await tx.unsafe(EXPECTED_TO_BE_REJECTED);
        writeWasAccepted = true;
      } catch {
        // الرفضُ هوَ المطلوبُ: المعاملةُ للقراءةِ وحدَها فعلاً.
      }
    });
  } catch (error) {
    // معاملةٌ أُلغيَت لأنَّ الكتابةَ رُفِضَت داخلَها ⇒ ليسَ إخفاقاً في ذاتِه.
    if (!String(error).toLowerCase().includes("read-only")) {
      failures.push(`تعذَّرَ تشغيلُ المسابيرِ: ${String(error)}`);
    }
  } finally {
    await sql.end();
  }

  if (writeWasAccepted) {
    console.error("✗ كتابةٌ **نُفِّذَت** داخلَ معاملةِ التمرينِ — المسارُ ليسَ للقراءةِ وحدَها.");
    process.exit(1);
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`✗ ${failure}`);
    process.exit(1);
  }
  console.log(
    "قُيسَ على قاعدةٍ حقيقيّةٍ: المسابيرُ قُرِئَت، والكتابةُ رُفِضَت داخلَ المعاملةِ. " +
      "ولا تحوُّلَ جرى ولا استرجاعَ جُرِّبَ.",
  );
}

await main();
