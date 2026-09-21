# PD-053 — دليل التنفيذ: أدلة الدعم وحالة المفقودات تتبعان المستخدم عبر القناة

**التاريخ:** 2026-09-21
**الفرع:** `feat/pd-053-ticket-tracking`
**PR:** (يُحدَّث بعد الدفع)

## ما نُفِّذ

### 1. أمر `/tickets` في بوت الراكب
- يعرض آخر ١٠ تذاكر دعم للراكب: المرجع، الصنف، الحالة، والقرار (إن وُجد).
- يستخدم `SupportTicketStore.listTickets` القائم — لا قاعدة بيانات جديدة.
- زرّ «تذاكري» في القائمة الدائمة.

### 2. القواميس
- ١٦ مفتاحاً جديداً في ثلاث لغات (ar/en/ur):
  - `support.my_tickets`, `support.no_tickets`
  - `support.status_*` (open, claimed, resolved, closed)
  - `support.category_*` (lost_item, ride_dispute, driver_conduct, app_problem, deduction, subscription, other)
  - `support.resolution_label`
  - `menu.rider.tickets`, `menu.rider.tickets.description`

### 3. الحاوية
- `apps/gateway/src/container.ts` — `ticketLister` يُربط بـ `PostgresRiderSupportStore`.

## الملفات المُعدَّلة

| الملف | التغيير |
|---|---|
| `packages/application/bots/rider-dialog.ts` | `/tickets` command + `formatTicketLine` + `formatTicketsPage` + `ticketLister` dep |
| `packages/application/bots/main-menu.ts` | زرّ «تذاكري» في قائمة الراكب |
| `apps/gateway/src/container.ts` | `ticketLister` wiring with `PostgresRiderSupportStore` |
| `packages/shared/i18n/ar.json` | ١٦ مفتاحاً جديداً |
| `packages/shared/i18n/en.json` | ١٦ مفتاحاً جديداً |
| `packages/shared/i18n/ur.json` | ١٦ مفتاحاً جديداً |

## الفحوص المحلية

- `typecheck` — نجاح
- `lint` — نجاح (٣٢ تحذيراً سابقاً، ٠ خطأ)
- `check-i18n` — نجاح

## ما لم يُدَّعَ

- لا يُدَّعى حل فوري للمفقودات — يُعرض الحال لا يُحل.
- لا يُدَّعى أن كل تذكرة لها قرار — بعضها مفتوح.
- لا يُدَّعى بث حي — القائمة تُقرأ عند الطلب.
