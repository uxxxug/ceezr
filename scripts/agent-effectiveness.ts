/**
 * الغرض: تقرير جدوى اقتراحات الوكيل، ومسار التوسيم اليدوي (تصدير دفعة ← حكم عليها).
 *   الطريقة الثالثة من طرق التقاط النتيجة، ولوحة القراءة للطريقتين الأخريين.
 * الحالة: منفّذ فعلياً — أمر «فعّل الطبقة على عيّنة حقيقية وابدأ قياس الجدوى».
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: صاحب المشروع أسبوعياً، ولوحة الإدارة حين تعرض الرقم نفسه
 * ملاحظات مستقبلية: حين تُعرض هذه الأرقام في لوحة الإدارة تُقرأ من `agent_effectiveness`
 *   نفسها لا باستعلامٍ موازٍ، وإلا اختلف رقمان عن الشيء الواحد.
 *
 * التشغيل:
 *   DATABASE_URL=postgres://... bun run scripts/agent-effectiveness.ts
 *   DATABASE_URL=postgres://... bun run scripts/agent-effectiveness.ts --export-unlabeled 20
 *   DATABASE_URL=postgres://... bun run scripts/agent-effectiveness.ts --label <traceId> --verdict accepted
 */

import { createSql } from "../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (DATABASE_URL === undefined || DATABASE_URL === "") {
  console.error("❌ عيّن DATABASE_URL.");
  process.exit(1);
}

/**
 * أقلّ عدد أحكام يُسمح بعده بقراءة نسبةٍ على أنها دلالة.
 *
 * ⚠️ ليس هذا الرقم `AGENT_CORE_MIN_SUPPORT` (=3) ولا يُخلط به: ذاك أدنى تكرارٍ
 * لنمطٍ داخل الذاكرة، وهذا **أدنى حجم عيّنة قبل الحكم على الطبقة كلّها**. وثلاثةٌ
 * لا تكفي لهذا الثاني بحال: اقتراحان صائبان من ثلاثة تعطي 67% وهي رقمٌ بلا معنى.
 */
const MIN_SAMPLE = 30;

const sql = createSql({ connectionString: DATABASE_URL });

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

interface SummaryRow {
  total: string;
  judged: string;
  accepted: string;
  rejected: string;
  ignored: string;
  by_button: string;
  by_manual: string;
  by_inferred: string;
  unpublished: string;
}

async function summary(): Promise<void> {
  const rows = await sql<SummaryRow[]>`
    select count(*)                                                        as total,
           count(verdict)                                                  as judged,
           count(*) filter (where verdict = 'accepted')                    as accepted,
           count(*) filter (where verdict = 'rejected')                    as rejected,
           count(*) filter (where verdict = 'ignored')                     as ignored,
           count(*) filter (where verdict_source = 'button')               as by_button,
           count(*) filter (where verdict_source = 'manual')               as by_manual,
           count(*) filter (where verdict_source = 'inferred')             as by_inferred,
           count(*) filter (where not published)                           as unpublished
      from agent_effectiveness
  `;
  const r = rows[0];
  if (r === undefined) throw new Error("تعذّرت قراءة agent_effectiveness");

  const total = Number(r.total);
  const judged = Number(r.judged);
  const accepted = Number(r.accepted);

  console.log("\n═══ جدوى اقتراحات وكيل تصنيف تذاكر الدعم ═══\n");
  console.log(`  اقتراحات مسجَّلة:      ${total}`);
  console.log(`  منها لم تُنشر:         ${r.unpublished}`);
  console.log(`  حُكم عليها:            ${judged}`);
  console.log(`    ✔ مقبولة:            ${accepted}`);
  console.log(`    ✘ مرفوضة:            ${r.rejected}`);
  console.log(`    ○ متجاهَلة:           ${r.ignored}`);
  console.log(
    `\n  مصدر الحكم النافذ:    نقرة ${r.by_button} · توسيم ${r.by_manual} · استنتاج ${r.by_inferred}`,
  );

  if (judged < MIN_SAMPLE) {
    // ⚠️ لا تُطبع نسبةٌ هنا عمداً. رقمٌ مصحوبٌ بتحذير يُنقل بلا تحذيره بعد أسبوع،
    // فالامتناع عن طباعته أصلاً هو الحماية الوحيدة التي تصمد.
    console.log(
      `\n  ⏳ العيّنة دون الحدّ (${judged}/${MIN_SAMPLE}) — لا نسبة تُعلَن بعد.` +
        `\n     نسبةٌ من عيّنة صغيرة تُقرأ كأنها حكم، وهي ضجيج.`,
    );
    console.log("\n");
    return;
  }

  const rate = Math.round((accepted / judged) * 1000) / 10;
  console.log(`\n  📊 نسبة القبول: ${rate}%  (من ${judged} حكماً)`);

  // ═══ حصّة الاستنتاج الآلي: قيدٌ على قراءة الرقم أعلاه ═══
  // كلّما علت هذه الحصّة قلّت ثقة النسبة، لأنها حينئذٍ رأي آلتنا في اقتراح آلتنا.
  const inferredShare = Number(r.by_inferred) / judged;
  if (inferredShare > 0.7) {
    console.log(
      `  ⚠️ ${Math.round(inferredShare * 100)}% من الأحكام استنتاجٌ آلي لا حكمُ إنسان.` +
        `\n     النسبة أعلاه تقيس اتّساق الوكيل مع قواعدنا أكثر ممّا تقيس صوابه.`,
    );
  }
  console.log("\n");

  const byClass = await sql<{ classification: string; n: string; ok: string }[]>`
    select coalesce(classification, '—') as classification,
           count(verdict) as n,
           count(*) filter (where verdict = 'accepted') as ok
      from agent_effectiveness
     group by 1
     having count(verdict) > 0
     order by count(verdict) desc
  `;
  if (byClass.length > 0) {
    console.log("  حسب التصنيف:");
    for (const row of byClass) {
      console.log(`    ${row.classification.padEnd(22)} ${row.ok}/${row.n}`);
    }
    console.log("\n");
  }
}

/** يصدّر قرارات بلا حكم بشري ليوسمها المراجع يدوياً. */
async function exportUnlabeled(limit: number): Promise<void> {
  const rows = await sql<
    { trace_id: string; classification: string | null; confidence: string; message: string }[]
  >`
    select e.trace_id, e.classification, e.confidence, t.message
      from agent_effectiveness e
      join support_tickets t on t.id = e.ticket_id
     -- بلا حكمٍ بشري: المستنتَج آلياً يُعرض للمراجعة أيضاً، فتصحيحه هو الغاية.
     where e.verdict_source is null or e.verdict_source = 'inferred'
     order by e.created_at desc
     limit ${limit}
  `;
  console.log(JSON.stringify(rows, null, 2));
  console.error(`\n${rows.length} قراراً بانتظار توسيم بشري.`);
  console.error("وسّم كلّاً منها بـ: --label <traceId> --verdict accepted|rejected|ignored\n");
}

async function label(traceId: string, verdict: string, note: string | null): Promise<void> {
  const rows = await sql<{ result: unknown }[]>`
    select record_agent_outcome(${traceId}, ${verdict}, 'manual', ${note}, null) as result
  `;
  console.log(JSON.stringify(rows[0]?.result));
}

const traceId = arg("label");
const exportLimit = arg("export-unlabeled");

if (traceId !== null) {
  const verdict = arg("verdict");
  if (verdict === null) {
    console.error("❌ --label يحتاج --verdict accepted|rejected|ignored");
    process.exit(1);
  }
  await label(traceId, verdict, arg("note"));
} else if (exportLimit !== null) {
  await exportUnlabeled(Number(exportLimit) || 20);
} else {
  await summary();
}

await sql.end({ timeout: 5 });
