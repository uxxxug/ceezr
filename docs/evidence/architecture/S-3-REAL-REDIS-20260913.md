# دليلُ `S-3` — خادمُ Redis حقيقيٌّ في الشغلةِ، و`O-2` مُغلَقٌ

- **البندُ:** `S-3` · يُغلِقُ `O-2`
- **الحاكمُ:** `docs/adr/0096-self-hosted-real-redis-in-ci.md`
- **التاريخُ:** 2026-09-13 · الفرعُ `feat/s3-self-hosted-real-redis` من `main`@`1294059`

## ١. الأحمرُ المقيسُ قبلَ الزيادةِ

الجريةُ `34727402517` (فرعُ `S-2`)، وظيفةُ «تكامل على Redis حقيقي»، الخطوةُ
الثامنةُ — `failure`. ونصُّ السقوطِ من سجلِّ الوظيفةِ نفسِه:

```
error: REQUIRE_REAL_REDIS=1 ولا UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN في البيئةِ
  at assertRealRedisWhenRequired (tests/support/real-redis.ts:52:15)
```

وهذا أحمرُ **تهيئةٍ** لا أحمرُ عيبٍ: السرَّانِ غيرُ مضبوطَينِ في المستودعِ
ألبتّةَ، فأربعٌ وعشرونَ حالةً حقيقيّةً لم تُقَسْ قطُّ، ورُفِعَ المُرفَقُ خالياً
(`No files were found with the provided path: /tmp/real-redis-proof.json`).

## ٢. ما جرى

| المُدخَلُ | القياسُ |
| --- | --- |
| خدمةُ `redis:7-alpine` بفحصِ `redis-cli ping` | خادمٌ حقيقيٌّ في الشغلةِ |
| خدمةُ `hiett/serverless-redis-http` على `8079:80` موصولةٌ بـ`redis://redis:6379` | بروتوكولُ الإنتاجِ نفسُه: `POST` لمصفوفةِ أمرٍ و`Bearer` للرمزِ |
| خطوةُ جهوزيّةٍ تُخاطِبُ `http://localhost:8079` بـ`["PING"]` | لا يُقرَأُ أحمرٌ زمنيٌّ عيباً في الكودِ |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` من الوظيفةِ لا من مخزنِ الأسرارِ | حكمُ CI لا يتوقّفُ على حسابٍ عندَ مُزوِّدٍ (ADR 0094) |

## ٣. ما لم يُمَسَّ — مقيسٌ بالفرقِ لا بالدعوى

`git diff --stat` لا يذكرُ `tests/support/real-redis.ts` ولا
`scripts/check-real-redis-proof.ts` ولا `scripts/lib/real-redis-proof.ts`: صفرُ
سطرٍ في الثلاثةِ. والشرطُ كما هوَ؛ إنّما صارَ مُستوفى.

## ٤. الإنفاذُ المُضافُ

`scripts/check-real-redis-runner.ts` — في `verify` وفي سلسلةِ `ci` — يقيسُ ستَّ
دعاوى (خادمٌ · قشرةٌ · وصلٌ داخليٌّ · اتّفاقُ منفذٍ · اتّفاقُ رمزٍ · جهوزيّةٌ
وشرطُ تفعيلٍ). وسقوطُه مُبرهَنٌ:

```
bun test tests/unit/check-real-redis-runner.test.ts
 12 pass · 0 fail   (11 منها بخللٍ مزروعٍ في نصِّ المسارِ الحقيقيِّ)
```

## ٥. القياسُ المحلّيُّ

| ما قِيسَ | النتيجةُ |
| --- | --- |
| `bun run scripts/check-real-redis-runner.ts` | ✅ |
| `bun test tests/unit/check-real-redis-runner.test.ts` | ✅ 12 / 0 |
| `bun test tests/unit/skip-audit.test.ts` | ✅ 45 / 0 |
| `check-secret-logging` · `check-env-drift` · `check-egress-boundary` · `check-skip-classification` | ✅ · ✅ · ✅ · ✅ |
| `lint` · `typecheck` | ✅ (1157 ملفاً) · ✅ |
| `bun run test` | ✅ 3240 نجحَ · 841 تُجوِّزَت · **0 أخفقَ** (303 ملفاً) |

و**اختباراتُ Redis نفسُها لا تُقاسُ محلّياً**: لا حاويةَ في هذا المُشغِّلِ. فهذا
البندُ لا يُقرَأُ مُغلَقاً إلّا بحكمِ CI — وهذا هوَ عينُ ما يقولُه `ح-8`.

## ٦. حكمُ CI الفعليُّ — بالوظيفةِ والخطوةِ

(يُملأُ بعدَ الدفعِ — لا قبلَه.)
