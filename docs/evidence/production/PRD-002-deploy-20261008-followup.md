# PRD-002 — متابعةُ النشر إلى رأسِ main الحالي `897dfd58` (2026-10-08 22:53 UTC)

**البند:** PRD-002 · **الحالة:** Verified — الخدمتان تشغّلان `897dfd58` (رأس `main`).
**المصدر:** Render API (موصِّل Render) + طلباتٌ حيّة. **بلا أسرار.**

## 1. الحالة قبل هذا النشر

كانت الخدمتان على التزاماتٍ سابقة (miniapp على `897dfd58` منذ 17:27 UTC — نُشرت TRUTH-01 من فورِ الدمج؛ gateway على `ce14d625` منذ 15:48 UTC — قبل LOC-TRUST-01 لاحقًا وTRUTH-01). أي أنَّ البوّابة كانت متأخرةً برأسَينِ عملٍ كاملَينِ عن `main`.

## 2. النشر

أمرتُ النشرَ عبرَ Render API (`trigger_deploy` · `clearCache: false`) بتاريخ 2026-10-08 22:52:14 UTC، والجوابُ: البوّابةُ `srv-dat37gou01pc739pgnc0` · النشرُ `dep-db41t7k9v7es738q8du0` · الحالة `live` عند 22:53:05 UTC (بُنِيَ في 51 ثانية) · الالتزامُ `897dfd589dbc2e116e2300f830341a35ad39086c` = رأسُ `main`.

**الخدمةُ الأخرى** (`waslah-miniapp`): كانت منشورةً على `897dfd58` منذ 17:27 UTC، فبقيت كما هي.

## 3. التحقّقُ الحيّ

| المقياس | القيمة |
|---|---|
| `GET /ready` | `HTTP 200` · `{"status":"ready","missingEnv":[],"failedChecks":[],"degradedChecks":[]}` |
| `GET /health` | `HTTP 200` |
| `GET /` (miniapp) | `HTTP 200` · `lang=ar dir=rtl` · `frame-ancestors https://telegram.org` |
| `GET /v1/me` | `HTTP 401` (لا حاملًا) — الردُّ الصحيحُ من مسارِ المصادقةِ القائم |
| `GET /v1/destinations/suggest?q=الملك` | `HTTP 404` (لا هويّة) — ردُّ JSON من البوّابةِ نفسِها |
| `last-modified` (miniapp) | `Thu, 08 Oct 2026 17:27:11 UTC` |

لا `connection refused` ولا `503` ولا `degraded` في كلِّ ما قِيس.

## 4. ملاحظةٌ مقيسةٌ لا تنقضُ شيئًا

رأسُ `Cache-Control` لـ`/` على `waslah-miniapp` الحيّ: `public, max-age=0, s-maxage=300` — لا يطابقُ القاعدةَ `path: / ⇒ no-cache` المكتوبةَ في `render.yaml`. وهذا هو عينُ ما وُثِّقَ في ADR 0245 §4 بند 7 وPRD-004: إعادةُ كتابةِ `/v1/*` ورؤوسُ الكاشِ يُدارَانِ من لوحةِ Render وحدَها (Blueprint لم يُطبَّق على الخدمة). يبقى بندًا مفتوحًا (PRD-004 Blocked — قرار مالك)، ولا يعني هذا النشرُ إغلاقَه.

## 5. الخلاصة

PRD-002 **Verified** على لقطةِ 2026-10-08 22:53 UTC: gateway وminiapp كلتاهما على رأس `main` (`897dfd58`)، `/ready` = `ready`، `/health` = 200، و`/v1` يعملُ من البوّابة. بقيت بنودُ PRD-004…PRD-007 (قرارات مالك) وPRD-008 (أجهزة مالك) مانعةً للاعترافِ بـ«Production Ready» — وهذا ليس ادعاءً لذلك.
