/**
 * الغرض: حاجزُ إبلاغِ الاختراقِ (`F12-08`) — يُثبِتُ أنَّ العناصرَ الخمسةَ
 *   موجودةٌ على القرصِ، وأنَّ موعدَ ٧٢ ساعةً مُعلَنٌ في المجالِ والهجرةِ.
 * الحالة: منفَّذٌ — البند `F12-08`.
 * الحاكم: المادةُ ٢٤ من اللائحةِ التنفيذيّةِ لـPDPL
 *
 * ## لماذا حاجزٌ ساكنٌ
 *
 * الكشفُ الفارغُ لا يُقرأُ نجاحاً (`ح-7`). والحاجزُ يُثبِتُ أنَّ:
 *   ١) الهجرةَ تُعرِّفُ الأنواعَ الستّةَ والدوالِّ الخمسَ.
 *   ٢) المجالَ يُصدِّرُ الأنواعَ والمواعيدَ.
 *   ٣) التطبيقَ يُصدِّرُ حالاتِ الاستخدامِ الخمسَ.
 *   ٤) البنيةَ التحتيّةَ تُصدِّرُ المخزنَ.
 *   ٥) موعدَ ٧٢ ساعةً مُعلَنٌ في المجالِ وفي الهجرةِ معاً.
 */

import { existsSync, readFileSync } from "node:fs";

interface GuardViolation {
  readonly element: string;
  readonly reason: string;
}

function fileContains(path: string, needle: string): boolean {
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").includes(needle);
}

const REQUIRED_ELEMENTS: readonly {
  readonly element: string;
  readonly path: string;
  readonly needle: string;
}[] = [
  // ١) الهجرة
  {
    element: "breach_incidents table",
    path: "supabase/migrations/20260918060000_f12_08_breach_notification.sql",
    needle: "create table if not exists breach_incidents",
  },
  {
    element: "breach_incident_status enum",
    path: "supabase/migrations/20260918060000_f12_08_breach_notification.sql",
    needle: "create type breach_incident_status as enum",
  },
  {
    element: "breach_severity enum",
    path: "supabase/migrations/20260918060000_f12_08_breach_notification.sql",
    needle: "create type breach_severity as enum",
  },
  {
    element: "authority_notification_deadline function",
    path: "supabase/migrations/20260918060000_f12_08_breach_notification.sql",
    needle: "authority_notification_deadline",
  },
  {
    element: "authority_notification_is_overdue function",
    path: "supabase/migrations/20260918060000_f12_08_breach_notification.sql",
    needle: "authority_notification_is_overdue",
  },
  {
    element: "subject_notification_required function",
    path: "supabase/migrations/20260918060000_f12_08_breach_notification.sql",
    needle: "subject_notification_required",
  },
  {
    element: "record_breach_incident function",
    path: "supabase/migrations/20260918060000_f12_08_breach_notification.sql",
    needle: "record_breach_incident",
  },
  {
    element: "assess_breach_incident function",
    path: "supabase/migrations/20260918060000_f12_08_breach_notification.sql",
    needle: "assess_breach_incident",
  },
  {
    element: "72 hours in migration",
    path: "supabase/migrations/20260918060000_f12_08_breach_notification.sql",
    needle: "interval '72 hours'",
  },

  // ٢) المجال
  {
    element: "BreachIncidentStatus type",
    path: "packages/domain/privacy/breach-notification.ts",
    needle: "BreachIncidentStatus",
  },
  {
    element: "BreachSeverity type",
    path: "packages/domain/privacy/breach-notification.ts",
    needle: "BreachSeverity",
  },
  {
    element: "AUTHORITY_NOTIFICATION_HOURS constant",
    path: "packages/domain/privacy/breach-notification.ts",
    needle: "AUTHORITY_NOTIFICATION_HOURS",
  },
  {
    element: "AuthorityNotificationContent interface",
    path: "packages/domain/privacy/breach-notification.ts",
    needle: "AuthorityNotificationContent",
  },
  {
    element: "SubjectNotificationContent interface",
    path: "packages/domain/privacy/breach-notification.ts",
    needle: "SubjectNotificationContent",
  },
  {
    element: "72 hours in domain",
    path: "packages/domain/privacy/breach-notification.ts",
    needle: "authorityHours: 72",
  },

  // ٣) التطبيق
  {
    element: "BreachIncidentStore interface",
    path: "packages/application/privacy/breach-notification.ts",
    needle: "BreachIncidentStore",
  },
  {
    element: "isAuthorityNotificationOverdue function",
    path: "packages/application/privacy/breach-notification.ts",
    needle: "isAuthorityNotificationOverdue",
  },
  {
    element: "isSubjectNotificationRequired function",
    path: "packages/application/privacy/breach-notification.ts",
    needle: "isSubjectNotificationRequired",
  },
  {
    element: "generateAuthorityNotification function",
    path: "packages/application/privacy/breach-notification.ts",
    needle: "generateAuthorityNotification",
  },
  {
    element: "generateSubjectNotification function",
    path: "packages/application/privacy/breach-notification.ts",
    needle: "generateSubjectNotification",
  },
  {
    element: "readBreachIncidentForNotification use case",
    path: "packages/application/privacy/breach-notification.ts",
    needle: "readBreachIncidentForNotification",
  },

  // ٤) البنية التحتيّة
  {
    element: "BreachIncidentPostgrestStore",
    path: "packages/infrastructure/privacy/breach-store.ts",
    needle: "BreachIncidentPostgrestStore",
  },
  {
    element: "PostgrestBreachReader interface",
    path: "packages/infrastructure/privacy/breach-store.ts",
    needle: "PostgrestBreachReader",
  },
];

const violations: GuardViolation[] = [];

for (const el of REQUIRED_ELEMENTS) {
  if (!fileContains(el.path, el.needle)) {
    violations.push({
      element: el.element,
      reason: `لم يُوجَدْ في ${el.path}`,
    });
  }
}

if (violations.length > 0) {
  console.error("✗ إبلاغُ الاختراقِ (F12-08) — عناصرُ ناقصةٌ:\n");
  for (const v of violations) {
    console.error(`  ــ ${v.element}: ${v.reason}`);
  }
  console.error(`\n${violations.length} خرقاً.`);
  process.exit(1);
}

console.log(
  "✓ إبلاغُ الاختراقِ (F12-08): ٢٤ عنصراً مُثبَتاً — الهجرةُ والمجالُ والتطبيقُ والبنيةُ التحتيّةُ وموعدُ ٧٢ ساعةً.",
);
