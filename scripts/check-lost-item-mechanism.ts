#!/usr/bin/env bun
/**
 * # حاجزُ آليّةِ بلاغِ المفقودِ — `F12-07`
 *
 * **الغرض:** يفرضُ البندَ `F12-07` بقراءةِ نصِّ الهجراتِ والكودِ معًا، فلا يُبنى
 * البلاغُ في موضعٍ ويُنسى في آخرَ:
 *
 * ١) `lost_item_report` في قيدِ `notification_outbox_kind_check` (القاعدةُ).
 * ٢) `lost_item_report` مبذورٌ في سياسةِ قناةٍ (`cross join (values ...)`).
 * ٣) `lost_item_report` في القائمةِ المغلقةِ `NOTIFICATION_KINDS` وله قناةٌ في
 *    `SEEDED_NOTIFICATION_CHANNELS`.
 * ٤) `lost_item_report` له رتبةٌ في `NOTIFICATION_KIND_PRIORITY`.
 * ٥) `open_support_ticket` — **آخِرُ تعريفٍ لها** — تُودِعُ بلاغَ `lost_item_report`
 *    **مشروطاً** بسائقٍ مُسنَدٍ (`v_lost_driver is not null`) ورحلةٍ منتهيةٍ
 *    (`v_order_status = 'completed'`)، لا ردَّ `ORDER_REQUIRED` ولا
 *    `NO_DRIVER_ON_ORDER` — التذكرةُ تُفتَحُ دائماً (`ح-8`). وحارسُ `ORDER_NOT_YOURS`
 *    قائمٌ أصلاً لكلِّ تذكرةٍ ذاتِ طلبٍ — يُفحَصُ أنَّهُ لم يُنزَعْ. ومفتاحُ منعِ
 *    التكرارِ `'lost_item:' || ticket_id`.
 *
 * **الحالة:** `F12-07` — مُنفَّذ · مُختبَر.
 *
 * **ينتمي إلى:** سلسلةَ `bun run ci` · خطوةً مُسمّاةً في `.github/workflows/ci.yml`.
 *
 * **ما لا يفعله هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يلمسُ قاعدةً.** يقرأُ نصَّ الهجراتِ؛ فإثباتُ أنَّ المُطلِقَ يعملُ فعلاً
 *   في اختبارِ التكاملِ (`tests/integration/lost-item-mechanism.test.ts`) لا ههنا.
 * - **لا يحكمُ على صوابِ تصنيفٍ.** المفروضُ أن يكونَ العقدُ **موجودًا ومتّسقاً**،
 *   لا أن يكونَ صواباً.
 * - **لا يُثبتُ شيئاً لم يُبنَ.** لا طاولةَ مفقوداتٍ ولا سيرَ إرجاعٍ ولا شاشةَ
 *   تطبيقٍ — البندُ إيداعُ البلاغِ وحسبُ، والحاجزُ لا يدّعي غيرَ ذلك.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOTIFICATION_KINDS,
  SEEDED_NOTIFICATION_CHANNELS,
} from "../packages/shared/config/notification-kinds.ts";
import { NOTIFICATION_KIND_PRIORITY } from "../packages/shared/config/traffic-priority.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const KIND = "lost_item_report";

export interface Migration {
  readonly file: string;
  readonly sql: string;
}

function readMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
}

/** آخِرُ قيدِ النوعِ — كما في check-notification-classification. */
function kindsFromConstraint(migrations: readonly Migration[]): Set<string> {
  const pattern = /notification_outbox_kind_check\s+check\s*\(\s*kind\s+in\s*\(([\s\S]*?)\)\s*\)/g;
  let last: string | null = null;
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(pattern)) {
      const body = match[1];
      if (body !== undefined) last = body;
    }
  }
  if (last === null) return new Set();
  return new Set([...last.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string));
}

/** أنواعُ السياسةِ المبذورةُ — اتحادُ كلِّ كتلةِ `cross join (values ...)`. */
function seededKinds(migrations: readonly Migration[]): Set<string> {
  const pattern = /cross join \(values([\s\S]*?)\) as k\(kind, description_ar\)/g;
  const kinds = new Set<string>();
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(pattern)) {
      const body = match[1];
      if (body === undefined) continue;
      for (const kindMatch of body.matchAll(/\(\s*'([a-z_]+)'/g)) {
        const kind = kindMatch[1];
        if (kind !== undefined) kinds.add(kind);
      }
    }
  }
  return kinds;
}

/**
 * جسمُ **آخِرِ** تعريفٍ لـ`open_support_ticket` بلا تعليقاتٍ، أو `null`. يُفصَلُ عن
 * فحوصِ النصِّ كي يُقرأَ منه أكثرُ من دعوى واحدةٍ.
 */
function openSupportTicketBody(migrations: readonly Migration[]): string | null {
  const pattern =
    /create or replace function\s+public\.open_support_ticket\s*\([\s\S]*?as \$function\$([\s\S]*?)\$function\$;/g;
  let body: string | null = null;
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(pattern)) {
      if (match[1] !== undefined) body = match[1];
    }
  }
  return body === null ? null : body.replace(/--[^\n]*/g, "");
}

export interface LostItemDeclaration {
  /** هل النوعُ `lost_item_report` في القائمةِ المغلقةِ؟ */
  readonly kindDeclared: boolean;
  /** هل له قناةٌ مُعلَنةٌ؟ */
  readonly channelDeclared: boolean;
  /** هل له رتبةُ مرورٍ؟ */
  readonly priorityDeclared: boolean;
}

export const REPOSITORY_DECLARATION: LostItemDeclaration = {
  kindDeclared: NOTIFICATION_KINDS.some((entry) => entry === KIND),
  channelDeclared:
    SEEDED_NOTIFICATION_CHANNELS[KIND as keyof typeof SEEDED_NOTIFICATION_CHANNELS] !== undefined,
  priorityDeclared:
    NOTIFICATION_KIND_PRIORITY[KIND as keyof typeof NOTIFICATION_KIND_PRIORITY] !== undefined,
};

export function findViolations(
  migrations: readonly Migration[],
  declared: LostItemDeclaration,
): string[] {
  const violations: string[] = [];

  const constraintKinds = kindsFromConstraint(migrations);
  if (!constraintKinds.has(KIND)) {
    violations.push(`النوعُ «${KIND}» ليسَ في قيدِ notification_outbox_kind_check — لا يُكتَبُ صفٌّ منه.`);
  }

  if (!seededKinds(migrations).has(KIND)) {
    violations.push(`النوعُ «${KIND}» ليسَ مبذوراً في سياسةِ قناةٍ — لا قناةَ تُقرأُ له عندَ الإرسالِ.`);
  }

  if (!declared.kindDeclared) {
    violations.push(`النوعُ «${KIND}» ليسَ في NOTIFICATION_KINDS — القائمةُ المغلقةُ ناقصةٌ.`);
  }
  if (!declared.channelDeclared) {
    violations.push(`النوعُ «${KIND}» بلا قناةٍ في SEEDED_NOTIFICATION_CHANNELS.`);
  }
  if (!declared.priorityDeclared) {
    violations.push(`النوعُ «${KIND}» بلا رتبةٍ في NOTIFICATION_KIND_PRIORITY — يُولَدُ بلا رتبةٍ.`);
  }

  const body = openSupportTicketBody(migrations);
  if (body === null) {
    violations.push("لم يُعثر على تعريفِ open_support_ticket في أيِّ هجرةٍ.");
  } else {
    if (!/p_type\s*=\s*'lost_item'/.test(body)) {
      violations.push("open_support_ticket لا تُفرِّقُ النوعَ «lost_item» — بلاغُ المفقودِ بلا حارسٍ.");
    }
    // مِلكيّةُ الطلبِ قائمةٌ أصلاً لكلِّ تذكرةٍ ذاتِ طلبٍ — يُفحَصُ أنَّها لم تُنزَعْ.
    if (!/'ORDER_NOT_YOURS'/.test(body)) {
      violations.push(
        "open_support_ticket لا تردُّ «ORDER_NOT_YOURS» — نُزِعَ حارسُ مِلكيّةِ الطلبِ القائمُ.",
      );
    }
    // الإيداعُ مشروطٌ بسائقٍ مُسنَدٍ ورحلةٍ منتهيةٍ (`ح-8`): لا ردَّ ORDER_REQUIRED ولا
    // NO_DRIVER_ON_ORDER — التذكرةُ تُفتَحُ دائماً، والبلاغُ مشروطٌ. ويُفحَصُ أنَّ
    // الشرطَيْنِ معاً قائمانِ لا أحدهُما وحده.
    if (!/v_lost_driver\s+is\s+not\s+null/.test(body)) {
      violations.push(
        "open_support_ticket لا تشترطُ سائقاً مُسنَداً لإيداعِ بلاغِ المفقودِ — صفٌّ ميّتٌ يُحاولُ التسليمَ أبداً.",
      );
    }
    if (!/v_order_status\s*=\s*'completed'/.test(body)) {
      violations.push(
        "open_support_ticket لا تشترطُ رحلةً منتهيةً («completed») لإيداعِ بلاغِ المفقودِ — بلاغٌ قبلَ انتهاءِ الرحلةِ.",
      );
    }
    if (!/enqueue_notification[\s\S]*?'lost_item_report'/.test(body)) {
      violations.push("open_support_ticket لا تُودِعُ بلاغَ «lost_item_report» في معاملةِ التذكرةِ.");
    }
    if (!/'lost_item:'\s*\|\|/.test(body)) {
      violations.push("open_support_ticket لا تُبنِي مفتاحَ منعِ التكرارِ «'lost_item:' || ticket_id».");
    }
  }

  return violations;
}

function main(): void {
  const migrations = readMigrations();
  const violations = findViolations(migrations, REPOSITORY_DECLARATION);

  if (violations.length > 0) {
    console.error("❌ حاجزُ آليّةِ بلاغِ المفقودِ أخفقَ:");
    for (const violation of violations) console.error(`   - ${violation}`);
    process.exit(1);
  }

  console.log(
    `✅ آليّةُ بلاغِ المفقودِ متّسقةٌ — «${KIND}» في القيدِ والسياسةِ والقائمةِ والرتبةِ، وopen_support_ticket تشترطُ سائقاً مُسنَداً ورحلةً منتهيةً لإيداعِ البلاغِ في معاملةِ التذكرةِ.`,
  );
}

if (import.meta.main) main();
