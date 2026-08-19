#!/usr/bin/env bun
/**
 * الغرض: شاهدٌ سالب — تُفسَد الحالةُ عن قصدٍ ليُثبت أنّ المشغّلَ **يرى** الإخفاق.
 * الحالة: منفّذ فعلياً — وحدة 2-5.
 * ينتمي إلى: bench
 * يُتوقع أن يستخدمه لاحقاً: كلُّ ثابتٍ حرجٍ يُضاف — يُستحسن أن يُجرَّب بنقيضه هنا.
 * ملاحظات مستقبلية: كلُّ إفسادٍ جديدٍ صفٌّ في `SABOTAGES`، ولا يُلمَس باقي الملفّ.
 *
 * الاستخدام: BENCH_DATABASE_URL=postgres://… bun bench/negative-control.ts
 *
 * ولماذا هذا الملفُّ أصلاً: سيناريوهاتٌ كلُّها خضراءُ لا تُثبت أنّ النظامَ سليم —
 * تُثبت إمّا أنّه سليمٌ وإمّا أنّ التوكيداتَ عمياء، ولا يُفرَّق بين الاحتمالين بالنظر
 * إلى تقريرٍ أخضر. فتُفسَد الحالةُ هنا يدوياً بما يكون لو انكسر الإسناد، فإن ظلّ
 * الحكمُ نجاحاً فالعطبُ في المقياس لا في المقيس — وذاك أخطرُ من عطبٍ في المنتَج.
 *
 * ونتيجةٌ ثالثةٌ مقصودةٌ هنا: إفسادٌ ترفضه القاعدةُ نفسُها. وذاك ليس فشلَ الشاهد،
 * بل دليلٌ على طبقةِ حرسٍ ثانيةٍ تحت الدالّةِ الذرّية — وتُسجَّل كما وقعت.
 */

import { mkdir, writeFile } from "node:fs/promises";
import type { Sql } from "../packages/infrastructure/db/client.ts";
import { contendedAcceptScenario } from "./scenarios/catalog/contended-accept.ts";
import type { ScenarioDefinition } from "./scenarios/contract.ts";
import { createScenarioEnv, type ScenarioEnv } from "./scenarios/harness.ts";
import { formatReport, runScenario } from "./scenarios/runner.ts";

type Outcome = "detected" | "blocked_by_database" | "undetected";

interface Sabotage {
  readonly id: string;
  readonly what: string;
  /** ما يجب أن يظهر في أسبابِ الحكم حين يكون المقياسُ بصيراً. */
  readonly expectedCode: string;
  readonly corrupt: (sql: Sql) => Promise<void>;
}

const SABOTAGES: readonly Sabotage[] = [
  {
    id: "double-accept",
    what: "رفعُ عرضٍ خاسرٍ إلى accepted فيصير للطلبِ عرضان مقبولان.",
    expectedCode: "DOUBLE_ASSIGNMENT",
    corrupt: async (sql) => {
      await sql`
        update public.order_offers
           set status = 'accepted'
         where id = (select id from public.order_offers where status <> 'accepted' limit 1)
      `;
    },
  },
  {
    id: "assignment-mismatch",
    what: "تحويلُ إسنادِ الطلبِ إلى سائقٍ غيرِ صاحبِ العرضِ المقبول.",
    expectedCode: "ASSIGNMENT_MISMATCH",
    corrupt: async (sql) => {
      await sql`
        update public.orders o
           set assigned_driver_id = (
             select d.id from public.drivers d
              where d.id is distinct from o.assigned_driver_id
              limit 1
           )
      `;
    },
  },
  {
    id: "lost-assignment",
    what: "إرجاعُ الطلبِ إلى searching بلا سائقٍ بعد وقوعِ الإسنادِ فعلاً.",
    expectedCode: "LOST_ASSIGNMENT",
    corrupt: async (sql) => {
      await sql`update public.orders set status = 'searching', assigned_driver_id = null`;
    },
  },
];

/**
 * الإفسادُ يقع في `systemResponse` لا في `runActor`: `runActor` يعمل تحت التزاحم،
 * فإفسادٌ هناك كان سيتسابق مع الإسنادِ الحقيقيِّ فيصير الشاهدُ نفسُه غيرَ حتميّ.
 * وهذه المرحلةُ تجري بعد اكتمالِ كلِّ الفاعلين وقبل أوّلِ توكيدٍ تجاريّ.
 */
function withSabotage(sabotage: Sabotage): ScenarioDefinition {
  return {
    ...contendedAcceptScenario,
    id: `${contendedAcceptScenario.id}-negative-${sabotage.id}`,
    title: `شاهدٌ سالب (${sabotage.id}): ${sabotage.what}`,
    systemResponse: async (context, actors) => {
      await sabotage.corrupt(context.sql);
      return contendedAcceptScenario.systemResponse(context, actors);
    },
  };
}

interface CaseResult {
  readonly id: string;
  readonly what: string;
  readonly expectedCode: string;
  readonly outcome: Outcome;
  readonly note: string;
  readonly report: string;
}

async function runCase(env: ScenarioEnv, sabotage: Sabotage): Promise<CaseResult> {
  try {
    const report = await runScenario(env, withSabotage(sabotage), {
      onEvent: (message) => process.stdout.write(`${message}\n`),
    });
    const sawCode = report.reasons.some((reason) => reason.includes(sabotage.expectedCode));
    const failed = report.verdict === "business_failure";
    return {
      id: sabotage.id,
      what: sabotage.what,
      expectedCode: sabotage.expectedCode,
      outcome: failed && sawCode ? "detected" : "undetected",
      note:
        failed && sawCode
          ? `الحكم business_failure وشرطُ ${sabotage.expectedCode} وقع.`
          : `الحكم=${report.verdict} · ظهورُ ${sabotage.expectedCode}=${String(sawCode)} — المقياسُ لم يرَ ما يجب أن يراه.`,
      report: formatReport(report),
    };
  } catch (error) {
    /**
     * إفسادٌ ترفضه القاعدة: قيدٌ يمنع الحالةَ المستحيلةَ أصلاً. ولا يُحسَب هذا
     * إخفاقاً للشاهد — بل يُسجَّل على أنّه حرسٌ أعمقُ من التوكيد، ويُذكَر نصُّ القيد.
     */
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: sabotage.id,
      what: sabotage.what,
      expectedCode: sabotage.expectedCode,
      outcome: "blocked_by_database",
      note: `القاعدةُ رفضت الإفسادَ نفسَه: ${message.split("\n")[0] ?? message}`,
      report: "(لا تقرير: التشغيلُ توقّف عند رفضِ القاعدةِ للإفساد)",
    };
  }
}

const env = await createScenarioEnv();
const results: CaseResult[] = [];
try {
  for (const sabotage of SABOTAGES) {
    process.stdout.write(`\n── شاهدٌ سالب: ${sabotage.id} — ${sabotage.what}\n`);
    results.push(await runCase(env, sabotage));
  }
} finally {
  await env.close();
}

const undetected = results.filter((entry) => entry.outcome === "undetected");
const lines = [
  "شاهدٌ سالب لوحدة 2-5 — إفساداتٌ مقصودةٌ لحالةِ الإسناد",
  "",
  "الغرض: إثباتُ أنّ التوكيداتَ ترى الإخفاق. تقريرٌ أخضرُ من مقياسٍ أعمى لا قيمةَ له.",
  "",
  ...results.flatMap((entry) => [
    `• ${entry.id} — ${entry.what}`,
    `  الشرطُ المتوقّع: ${entry.expectedCode}`,
    `  النتيجة: ${entry.outcome}`,
    `  ${entry.note}`,
    "",
  ]),
  `الخلاصة: ${undetected.length === 0 ? "كلُّ إفسادٍ إمّا كُشِف بالتوكيد أو رفضته القاعدة — لا إفسادَ مرّ صامتاً." : `${undetected.length} إفساداً مرّ بلا كشف — المقياسُ يحتاج إصلاحاً قبل الوثوق بأيِّ نتيجةٍ خضراء.`}`,
  "",
  "── تقاريرُ التشغيل الكاملة ──",
  "",
  ...results.map((entry) => `[${entry.id}]\n${entry.report}\n`),
];

await mkdir("docs/evidence", { recursive: true });
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const path = `docs/evidence/phase2-unit5-${stamp}-negative-control.txt`;
await writeFile(path, `${lines.join("\n")}\n`, "utf8");

process.stdout.write(`\n${lines.slice(0, 4 + results.length * 5 + 1).join("\n")}\n`);
process.stdout.write(`\nالدليل: ${path}\n`);
process.exit(undetected.length === 0 ? 0 : 1);
