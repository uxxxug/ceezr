# Safety classification delta — 2026-08-13

| مسار الملف | فئته الجديدة | الدليل المثبت |
|---|---|---|
| `packages/application/safety/trigger-sos.ts` | منفذ فعلياً 2026-08-13 | `tests/integration/safety-sos.test.ts:87` يثبت ضغطتي SOS متزامنتين؛ المخرج الحرفي في `docs/evidence/safety-20260813.txt`. |
| `packages/application/safety/resolve-safety-incident.ts` | منفذ فعلياً 2026-08-13 | `tests/integration/safety-sos.test.ts:166` يثبت إغلاقين متزامنين، و`:209` يثبت الحجب الإداري البشري. |
| `packages/domain/safety/{entity,errors,events,index,value-objects}.ts` | منفذ فعلياً 2026-08-13 | الأنواع والقيود المستخدمة من حالتي الاستخدام، واختبار التكامل نفسه. |
| `packages/infrastructure/safety/{index,safety-adapters}.ts` | منفذ فعلياً 2026-08-13 | محولات RPC `trigger_sos` و`claim_safety_incident` و`resolve_safety_incident` وoutbox؛ مخرج قاعدة حقيقية في ملف الدليل. |
| `apps/gateway/src/groups/escalation-group.ts` | منفذ فعلياً 2026-08-13 | يصف الربط الحي ببطاقات outbox وأزرار `sos:*` التي يعالجها `driver-dialog.ts`. |
