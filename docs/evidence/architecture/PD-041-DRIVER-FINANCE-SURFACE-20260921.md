# PD-041 — دليل التنفيذ: مسار مالي واحد للسائق

**التاريخ:** 2026-09-21
**الفرع:** `feat/pd-041-driver-finance-surface`
**PR:** (يُحدَّث بعد الدفع)

## ما نُفِّذ

### 1. المركز المالي (`/finance`)
- أمر `/finance` في بوت السائق يعرض بطاقة مالية واحدة: الاشتراك + العملة + زرّ الاعتراض المالي.
- زرّ القائمة الدائم تحول من «اشتراكي» إلى «مركزي المالي».
- `/subscription` يبقى يعمل للتوافق.

### 2. الاعتراض المالي
- زرّ «اعتراض مالي» يفتح تذكرة `deduction` من السطح نفسه — لا قناة منفصلة.
- يستخدم `SUPPORT_TICKET_TYPES` القائم — لا enum جديد.

### 3. الإصلاح الجانبي: `SupportTicketType`
- `domain/dispute/value-objects.ts` كان يعرّف `SupportTicketType` بنوعين فقط (`subscription` و`ride_dispute`).
- صُحِّح ليُعاد تصديره من `domain/support/ticket-types.ts` الذي يطابق `pg_enum` (٩ أنواع).

### 4. نموذج القراءة
- `packages/application/financial/driver-finance-overview.ts` — نموذج قراءة يجمع البيانات المالية.

## الملفات المُعدَّلة

| الملف | التغيير |
|---|---|
| `packages/application/bots/driver-dialog.ts` | `/finance` command + `fin:` callback + `describeFinanceCenter` + `handleFinanceCallback` |
| `packages/application/bots/main-menu.ts` | زرّ القائمة: `/subscription` → `/finance` |
| `packages/application/bots/types.ts` | `draftSupportType` يضم `deduction` |
| `packages/application/financial/driver-finance-overview.ts` | جديد — نموذج قراءة مالية |
| `packages/application/financial/index.ts` | تصدير النموذج الجديد |
| `packages/domain/dispute/value-objects.ts` | `SupportTicketType` يُعاد تصديره من `domain/support` |
| `packages/shared/i18n/ar.json` | ٩ مفاتيح جديدة |
| `packages/shared/i18n/en.json` | ٩ مفاتيح جديدة |
| `packages/shared/i18n/ur.json` | ٩ مفاتيح جديدة |

## الفحوص المحلية

- `typecheck` — نجاح
- `lint` — نجاح (٣٢ تحذيراً سابقاً، ٠ خطأ)
- `check-i18n` — نجاح (٤١٠ مفاتيح بوت، ١٢١٨ مفتاح تطبيق)
- `tests/unit/driver-dialog.test.ts` — ٨٨ نجاح، ٠ فشل

## ما لم يُدَّعَ

- لا يُدَّعى أن السطح المالي يحل كل فجوة في السياسة — هو يربط ما هو قائم.
- لا يُدَّعى وصول فوري للاعتراض — يفتح كتذكرة ويُتلى حالها.
- لا يُدَّعى استرداد حيث لا مزود يدعمه.
