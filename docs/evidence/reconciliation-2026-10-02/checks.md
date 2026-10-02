# نتائج الفحوص — 2026-10-02

> **الفرع:** `chore/full-project-reconciliation-20261002`
> **رأس main:** `440202e` — `feat: DEC-43 ticket threads + DEC-41 emergency contact + DEC-42 notification prefs (#375)`

## الفحوص المحلية

| الفحص | الأمر | النتيجة | ملاحظات |
|---|---|---|---|
| Lint | `bun run lint` | **passed** | 1931 ملف، 0 أخطاء |
| Typecheck | `bun run typecheck` | **passed** | `tsc --noEmit` + `tsc -p apps/miniapp/tsconfig.json` |
| Build (miniapp) | `bun run build:miniapp` | **passed** | بُني في 457ms |
| Unit tests | `bun run test` | **passed** | 6597 pass · 1616 skip · 0 fail · 8213 tests · 597 files · 38.60s |
| Schema contract | `bun run scripts/check-schema-contract.ts` | **passed** | 163 دالّة و30 جدولاً |
| Boundary audit | `bun run scripts/check-boundary-audit.ts` | **passed** | 65 جدولاً · 7 اختراقات |
| Erasure policy | `bun run scripts/check-erasure-policy.ts` | **passed** | 65 جدولاً · 32 قسم تنزيل |
| Migration matrix | `bun run scripts/check-migration-matrix.ts` | **passed** | 65 جدولاً · 7 خطط عمود |
| Cutover plan | `bun run scripts/check-cutover-plan.ts` | **passed** | 35 خطوة |
| Rate-limit coverage | `bun run scripts/check-rate-limit-coverage.ts` | **passed** | 126 مساراً · 10 محدوداً · 3 معفى |
| Business constants | `bun run scripts/check-business-constants.ts` | **passed** | لا قيمة تجارية مرمّزة |

## فحوص البيئة الحقيقية

| الفحص | النتيجة | ملاحظات |
|---|---|---|
| Gateway `/ready` | **passed** | `{"status":"ready"}` |
| Gateway `/health` | **passed** | `{"status":"ok"}` |
| Miniapp `/` | **passed** | 200 |
| Miniapp `/health` | **passed** | 200 |
| Worker HTTP | **not verifiable** | عامل خلفي بلا HTTP |
| DEC-37 route | **failed (404)** | غير منشور |
| DEC-41 route | **failed (404)** | غير منشور |
| DEC-42 route | **failed (404)** | غير منشور |
| DEC-43 route | **failed (404)** | غير منشور |

## الاختبارات المتخطاة

جميع الاختبارات الـ1616 المتخطاة تتطلب بنية تحتية خارجية غير متوفرة في بيئة الفحص:
- قاعدة بيانات PostgreSQL حقيقية (CI_REQUIRE_DB)
- Redis حقيقي (UPSTASH_REDIS_REST_URL)
- Telegram Bot API حقيقي

**لا يوجد تخطٍّ بلا سبب موثّق.** كل تخطٍّ مرتبط بشرط بيئة واضح.
