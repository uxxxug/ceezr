# دليل تنفيذ PD-021 — سبب داخلي إلزامي ورسالة حالة عامة

**التاريخ:** 2026-09-21
**البند:** `PD-021`
**الحالة:** منفذ، بانتظار حكم CI

## المقيس

`resolve_safety_incident(p_incident_id, p_actor_telegram_id, p_decision)` كانت تُغلق البلاغ أو تحظر المُبلِّغ بلا سبب داخلي مطلوب في القاعدة. العمود `decision` يخزِّن ما فُعل (`close`/`block_reporter`) لكن لماذا غير محفوظ ولا مُلزَم. وأثر الحظر في `audit_log` يخلو من سبب القرار. والمُبلِّغ لا يصله شيء بعد الإغلاق.

## العلاج المنفذ

### الهجرة: `20260921000000_pd_021_decision_reason.sql`

1. **عمود `decision_reason text`** على `safety_incidents` مع قيدين:
   - `safety_incidents_closed_has_decision_reason`: `CHECK (status <> 'closed' OR decision_reason IS NOT NULL) NOT VALID`
   - `safety_incidents_decision_reason_domain`: قيد على الرموز المغلقة

2. **`resolve_safety_incident` بتوقيع رابع** `p_decision_reason text`:
   - الدالة القديمة (3 معاملات) تُسقَط صراحةً
   - السبب مُلزَم ولا يقبل الفراغ
   - الرمز مغلق — قيمة خارج المجموعة تُرفض
   - السبب يُكتَب في `audit_log` مع القرار
   - إشعار عام للمُبلِّغ يُكتَب في `notification_outbox` في المعاملة نفسها

3. **`claim_notification_delivery`** تُعاد تعريفها بالكامل:
   - الأنواع الجديدة `safety_resolution_closed` و `safety_resolution_blocked` تُضاف لمصفوفة `v_ride_kinds`
   - فرع إثراء جديد يقرأ محادثة المُبلِّغ ولغته من `safety_incidents` انضماماً مع `users`

4. **قيد `notification_outbox_kind_check`** يُوسَّع لاستقبال النوعين الجديدين

### طبقة التطبيق

- `packages/application/safety/ports.ts`: `SafetyDecisionReason` type + `SafetyResolutionPort.resolve` يأخذ `decisionReason`
- `packages/application/safety/resolve-safety-incident.ts`: `ResolveSafetyIncidentInput` يأخذ `decisionReason`
- `packages/application/safety/deliver-safety-resolution.ts`: معالج تسليم الإشعار العام
- `packages/application/bots/driver-dialog.ts`: `handleSafetyGroupAction` — مسار زرين (عرض أسباب ثم تنفيذ)
- `packages/infrastructure/safety/safety-adapters.ts`: تمرير `decisionReason` للـ RPC
- `packages/infrastructure/notification/telegram-safety-resolution-notifier.ts`: مُرسِل تيليجرام للإشعار العام

### i18n

مفاتيح جديدة في `ar.json` و `en.json` و `ur.json`:
- `safety.reason_required`, `safety.choose_reason`
- `safety.reason_resolved`, `safety.reason_false_report`, `safety.reason_duplicate`, `safety.reason_escalated`, `safety.reason_safety_risk`, `safety.reason_policy_violation`
- `safety.resolution_closed`, `safety.resolution_blocked`

### الاختبارات

- `tests/unit/safety.test.ts`: اختبار نقل السبب الداخلي إلى منفذ الإغلاق
- `tests/integration/safety-sos.test.ts`: ثلاثة اختبارات تكامل على PostgreSQL حقيقي:
  - الإغلاق بلا سبب يُرفض
  - الإشعار العام يُكتَب في `notification_outbox` بلا كشف السبب الداخلي
  - السبب يُكتَب في `audit_log`
- `tests/integration/audit-trail-authority.test.ts`: اختبار رفض الإغلاق بلا سبب + تحديث التوقيعات

## ما تم التحقق منه

- typecheck: نجاح
- lint: نجاح (ملفاتي فقط — أخطاء سابقة في ملفات أخرى)
- اختبارات الوحدة: 6/6 نجاح
