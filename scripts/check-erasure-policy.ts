#!/usr/bin/env bun
/**
 * الغرض: حاجزُ سجلِّ الحذفِ — `F2-11`. **يُنفِذُ ولا يوصي**: يُقابِلُ سجلَّ
 *   الحذفِ بسجلِّ الاستبقاءِ، وبالهجراتِ، وبـ**التنفيذِ الفعليِّ** — دالّةِ
 *   التنزيلِ في القاعدةِ ودالّةِ الحذفِ — في الاتّجاهَينِ.
 * الحالة: منفّذ فعلياً — البند `F2-11`.
 * ينتمي إلى: scripts
 *
 * **لِمَ حاجزٌ لا مراجعةٌ**: حقُّ الحذفِ يُخترَقُ صامتاً لا صاخباً. جدولٌ جديدٌ
 * يُضافُ في هجرةٍ، ولا أحدَ يذكرُ أنَّ فيه رقمَ هاتفٍ، فيبقى بعدَ «حذفِ
 * الحسابِ» سنينَ. ولا اختبارٌ يكشفُ ذلكَ لأنَّ لا شيءَ يُخفِقُ: الشاشةُ تقولُ
 * «حُذِفَ» والصفُّ باقٍ. فالحاجزُ ههنا هوَ **الشيءُ الوحيدُ** الذي يجعلَ إضافةَ
 * جدولٍ بلا حكمٍ إخفاقاً مرئيّاً (`ح-7`).
 *
 * القواعدُ الثمانُ، وكلٌّ منها له خرقٌ مُصنَّعٌ في
 * `tests/unit/check-erasure-policy.test.ts` — قاعدةٌ لا يُرى الحاجزُ ساقطاً
 * عليها قاعدةٌ غيرُ مُنفَذةٍ.
 */

import {
  DATA_SUBJECTS,
  type DataSubject,
  ERASURE_DISPOSITIONS,
  type ErasureRule,
  exportSectionsForSubject,
  retentionErasureConflicts,
  TABLE_ERASURE,
  tablesOwnedHere,
} from "../packages/shared/config/erasure-policy.ts";
import { TABLE_RETENTION } from "../packages/shared/config/retention-policy.ts";
import { findTableBlocks } from "./check-migrations.ts";
import { DEFERRED_MIGRATION_DIRS, declaredMigrations } from "./lib/migration-sources.ts";

const D = ERASURE_DISPOSITIONS;

/**
 * أسماءُ الأقسامِ التي **تبنيها** دالّةُ التنزيلِ فعلاً، مقروءةً من الهجرةِ.
 *
 * **يُقرَأُ بعُمقِ الأقواسِ لا بنمطٍ نصّيٍّ**: أوّلُ صياغةٍ كانت تُطابِقُ
 * `'اسمٌ', case|coalesce|jsonb_build` أينَ وقعَت، فاقتنصَت `'role', case …`
 * من داخلِ قسمِ التقييماتِ وحسبَتْه قسماً من الأقسامِ. ومفتاحٌ متداخلٌ يُقرأُ
 * قسماً يجعلُ الحاجزَ يُخفِقُ على شيءٍ سليمٍ — وحاجزٌ يكذبُ مرّةً يُعطَّلُ.
 * فالمفاتيحُ المعتبَرةُ هيَ ما كانَ على عُمقٍ واحدٍ داخلَ `jsonb_build_object`
 * التابعةِ لـ`'sections'` وحدَها.
 */
export function sectionsBuiltBySql(sql: string): readonly string[] {
  const body = functionBodyOf(sql, "export_my_data");
  if (body === null) return [];
  const marker = "'sections', jsonb_build_object(";
  const start = body.indexOf(marker);
  if (start < 0) return [];

  const keys = new Set<string>();
  let depth = 1;
  let index = start + marker.length;
  let atKeyPosition = true;

  while (index < body.length && depth > 0) {
    const ch = body[index];
    if (ch === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      index += 1;
      continue;
    }
    if (ch === "'" && depth === 1) {
      const close = body.indexOf("'", index + 1);
      if (close < 0) break;
      if (atKeyPosition) {
        const key = body.slice(index + 1, close);
        if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) keys.add(key);
        atKeyPosition = false;
      }
      index = close + 1;
      continue;
    }
    // الفاصلةُ على العُمقِ الأوّلِ تُنهي قيمةً وتُبدِئُ مفتاحاً.
    if (ch === "," && depth === 1) atKeyPosition = true;
    index += 1;
  }
  return [...keys].sort();
}

/** جسمُ دالّةٍ بينَ `$fn$ … $fn$` بعدَ اسمِها. `null` إن لم توجَدْ. */
export function functionBodyOf(sql: string, name: string): string | null {
  const head = sql.indexOf(`function ${name}(`);
  if (head < 0) return null;
  const open = sql.indexOf("$fn$", head);
  if (open < 0) return null;
  const close = sql.indexOf("$fn$", open + 4);
  if (close < 0) return null;
  return sql.slice(open + 4, close);
}

export interface Violation {
  readonly rule: string;
  readonly message: string;
}

/** الجداولُ المُعلَنةُ في مجلّدٍ مؤجَّلٍ وحدَه. */
export function deferredOnlyTables(root = "."): ReadonlySet<string> {
  const live = new Set<string>();
  const deferred = new Set<string>();
  for (const entry of declaredMigrations(root)) {
    const target = DEFERRED_MIGRATION_DIRS.includes(entry.dir) ? deferred : live;
    for (const block of findTableBlocks(entry.sql)) target.add(block.name);
  }
  return new Set([...deferred].filter((name) => !live.has(name)));
}

export function auditErasurePolicy(options: {
  readonly erasure?: Readonly<Record<string, ErasureRule>>;
  readonly retention?: Readonly<Record<string, string>>;
  readonly deferredOnly?: ReadonlySet<string>;
  readonly exportSql?: string;
  readonly eraseSql?: string;
  readonly implementedSections?: readonly string[];
}): readonly Violation[] {
  const erasure = options.erasure ?? TABLE_ERASURE;
  const retention = options.retention ?? TABLE_RETENTION;
  const deferredOnly = options.deferredOnly ?? deferredOnlyTables();
  const out: Violation[] = [];
  const add = (rule: string, message: string) => out.push({ rule, message });

  // ١) القائمتانِ مغلقتانِ على بعضِهما في الاتّجاهَينِ.
  for (const table of Object.keys(retention)) {
    if (erasure[table] === undefined) {
      add(
        "CLOSED_LIST",
        `\`${table}\` مُصنَّفٌ في سياسةِ الاستبقاءِ ولا حكمَ حذفٍ له — يُضافُ إلى ` +
          "`TABLE_ERASURE` في `packages/shared/config/erasure-policy.ts`: جدولٌ لا يُعرَفُ " +
          "مصيرُه عندَ «احذفْ حسابي» يبقى فيه أثرُ إنسانٍ بلا أن يُخفِقَ شيءٌ.",
      );
    }
  }
  for (const table of Object.keys(erasure)) {
    if (retention[table] === undefined) {
      add("CLOSED_LIST", `\`${table}\` له حكمُ حذفٍ ولا تصنيفَ استبقاءٍ — مُدخلٌ ميّتٌ يُوهِمُ أنَّ شيئاً حُسِمَ.`);
    }
  }

  // ٢) لا حكمَ حذفٍ يُخالِفُ صنفَ استبقاءٍ يُوجِبُ الحفظَ.
  for (const conflict of retentionErasureConflicts(erasure, retention)) {
    add("RETENTION_CONTRADICTION", `${conflict} — تناقضُ إقرارَينِ مُعلَنَينِ، وهوَ أسوأُ من نقصِ أحدِهما.`);
  }

  for (const [table, rule] of Object.entries(erasure)) {
    const personal = rule.subjects.length > 0;

    // ٣) الحكمانِ اللّذانِ يقولانِ «لا بيانةَ ههنا» لا صاحبَ لهما ولا قسمَ.
    if (rule.disposition === D.notPersonal || rule.disposition === D.deferredNotLive) {
      if (personal) {
        add("NO_SUBJECT_NO_CLAIM", `\`${table}\`: حكمُه \`${rule.disposition}\` وله أصحابٌ.`);
      }
      if (rule.exportSection !== null || rule.linkedBy !== null || rule.basis !== null) {
        add(
          "NO_SUBJECT_NO_CLAIM",
          `\`${table}\`: حكمُه \`${rule.disposition}\` ومعه قسمُ تنزيلٍ أو نسبةٌ أو أساسٌ.`,
        );
      }
    } else if (!personal) {
      add(
        "NO_SUBJECT_NO_CLAIM",
        `\`${table}\`: حكمُه \`${rule.disposition}\` ولا صاحبَ بيانةٍ — حكمٌ على لا شيءٍ.`,
      );
    }

    // ٤) `deferredNotLive` يستحيلُ أن يستترَ خلفَه جدولٌ حيٌّ.
    if (rule.disposition === D.deferredNotLive && !deferredOnly.has(table)) {
      add(
        "DEFERRED_MUST_BE_DEFERRED",
        `\`${table}\`: حكمُه «مؤجَّلٌ لا حيٌّ» وهوَ مُنشَأٌ في هجرةٍ مُطبَّقةٍ — فصفوفُه حقيقيّةٌ.`,
      );
    }
    if (deferredOnly.has(table) && rule.disposition !== D.deferredNotLive) {
      add(
        "DEFERRED_MUST_BE_DEFERRED",
        `\`${table}\`: مؤجَّلٌ ولا وجودَ له في الإنتاجِ، وحكمُه \`${rule.disposition}\` يُوهِمُ تنفيذاً.`,
      );
    }

    // ٥) الإبقاءُ والتجهيلُ لا يُقبَلانِ بلا أساسٍ مكتوبٍ، والمحوُ لا أساسَ له.
    if (rule.disposition === D.anonymize || rule.disposition === D.retainLegalBasis) {
      if (rule.basis === null || rule.basis.trim().length === 0) {
        add(
          "BASIS_REQUIRED",
          `\`${table}\`: حكمُه \`${rule.disposition}\` بلا أساسٍ — «يبقى» بلا سببٍ مكتوبٍ لا يُقالُ لصاحبِه.`,
        );
      }
    }
    if (rule.disposition === D.erase && rule.basis !== null) {
      add("BASIS_REQUIRED", `\`${table}\`: يُمحى محواً تامّاً فلا أساسَ إبقاءٍ يُكتَبُ له.`);
    }

    // ٦) جدولٌ فيه بيانةٌ شخصيّةٌ **يجبُ** أن يُنزَّلَ وتُعرَفَ نسبتُه.
    if (personal) {
      if (rule.exportSection === null) {
        add(
          "PERSONAL_MUST_BE_EXPORTABLE",
          `\`${table}\`: فيه بيانةٌ شخصيّةٌ ولا قسمَ تنزيلٍ — نحكمُ عليه بالحذفِ ولا نُرِي صاحبَه ما فيه.`,
        );
      }
      if (rule.linkedBy === null || rule.linkedBy.trim().length === 0) {
        add(
          "PERSONAL_MUST_BE_EXPORTABLE",
          `\`${table}\`: فيه بيانةٌ شخصيّةٌ ولا مسارَ نسبةٍ — لا يُعرَفُ أيُّ صفٍّ لمن.`,
        );
      }
    }

    // ٧) دينٌ بلا اسمِ بندٍ دينٌ منسيٌّ.
    if (rule.deferredTo !== null && !/^[A-Z]+\d*-\d+$/.test(rule.deferredTo)) {
      add(
        "DEBT_NEEDS_AN_ITEM",
        `\`${table}\`: \`deferredTo\` قيمتُه \`${rule.deferredTo}\` وليست معرّفَ بندٍ.`,
      );
    }
  }

  // ٨) **التنفيذُ يُقابَلُ بالسجلِّ**: لا قسمَ يُوعَدُ ولا يُبنى، ولا قسمَ يُبنى
  //    ولا يُوعَدُ، ولا جدولَ يملكُه هذا البندُ ولا تمسُّه دالّةُ الحذفِ.
  const promised = exportSectionsForSubject(DATA_SUBJECTS.rider).filter((section) =>
    tablesOwnedHere(DATA_SUBJECTS.rider).some((table) => erasure[table]?.exportSection === section),
  );
  const built = options.implementedSections ?? sectionsBuiltBySql(options.exportSql ?? "");
  if (options.exportSql !== undefined || options.implementedSections !== undefined) {
    for (const section of promised) {
      if (!built.includes(section)) {
        add(
          "REGISTRY_MATCHES_IMPLEMENTATION",
          `قسمُ التنزيلِ \`${section}\` مُعلَنٌ في السجلِّ ولا تبنيه \`export_my_data\` — وعدٌ بلا يدٍ تُجريه.`,
        );
      }
    }
    for (const section of built) {
      if (!promised.includes(section)) {
        add(
          "REGISTRY_MATCHES_IMPLEMENTATION",
          `\`export_my_data\` تبني قسماً \`${section}\` لا جدولَ له في السجلِّ — قسمٌ بلا مصدرِ حقيقةٍ.`,
        );
      }
    }
  }

  const eraseSql = options.eraseSql;
  if (eraseSql !== undefined) {
    for (const table of tablesOwnedHere(DATA_SUBJECTS.rider)) {
      const rule = erasure[table];
      if (rule === undefined) continue;
      if (rule.disposition !== D.erase && rule.disposition !== D.anonymize) continue;
      if (!new RegExp(`\\b${table}\\b`).test(eraseSql)) {
        add(
          "REGISTRY_MATCHES_IMPLEMENTATION",
          `\`${table}\`: حكمُه \`${rule.disposition}\` ويملكُه \`F2-11\`، ولا تمسُّه \`erase_my_account\` — ` +
            "حكمٌ مكتوبٌ لا يُنفَّذُ، وهوَ بعينِه ما يجعلُ «حُذِفَ حسابُكَ» كذباً.",
        );
      }
    }
  }

  return out;
}

function main(): void {
  const migrations = declaredMigrations();
  const sqlWithExport = migrations.find((entry) => entry.sql.includes("function export_my_data("));
  const sqlWithErase = migrations.find((entry) => entry.sql.includes("function erase_my_account("));

  if (sqlWithExport === undefined || sqlWithErase === undefined) {
    console.error(
      "❌ لا هجرةَ تُعرِّفُ `export_my_data` أو `erase_my_account` — " +
        "سجلُّ الحذفِ حكمٌ بلا يدٍ تُجريه (`F2-11`).",
    );
    process.exit(1);
  }

  const violations = auditErasurePolicy({
    exportSql: sqlWithExport.sql,
    eraseSql: functionBodyOf(sqlWithErase.sql, "erase_my_account") ?? "",
  });

  if (violations.length === 0) {
    const subjects: readonly DataSubject[] = [
      DATA_SUBJECTS.rider,
      DATA_SUBJECTS.driver,
      DATA_SUBJECTS.admin,
    ];
    const counts = subjects
      .map((subject) => `${subject}: ${tablesOwnedHere(subject).length}`)
      .join(" · ");
    console.log(
      `✅ سجلُّ الحذفِ مستقيمٌ: ${Object.keys(TABLE_ERASURE).length} جدولاً محكوماً · ` +
        `${sectionsBuiltBySql(sqlWithExport.sql).length} قسمَ تنزيلٍ مبنيّاً · جداولُ يملكُها البندُ (${counts}).`,
    );
    return;
  }

  for (const violation of violations) {
    console.error(`❌ [${violation.rule}] ${violation.message}`);
  }
  process.exit(1);
}

if (import.meta.main) main();
