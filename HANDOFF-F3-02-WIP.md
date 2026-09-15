# تسليمُ `F3-02` — سجلُّ الفحصِ قيدَ التقدُّمِ (2026-09-15)

> **الدعوى السابقةُ باقيةٌ بحرفِها ولم تُمحَ (`ح-8`)**: كُتِبَ في الالتزامِ
> `151958b` أنَّ هذا الرمزَ **لم يُشغَّلْ عليهِ فحصٌ واحدٌ ولا اختبارٌ واحدٌ**،
> وأنَّه قد لا يُصرَّفُ أصلاً. وذلكَ كانَ صادقاً لحظتَه. وما بعدَه تصحيحٌ
> بالإضافةِ: يُقرأُ **سجلُّ أحكامِ الفحصِ** في §٠ أدناهُ، وكلُّ ما لم يُذكَرْ
> فيهِ بحكمٍ صريحٍ **فلم يُشغَّلْ بعدُ**.

## ٠) سجلُّ أحكامِ الفحصِ — مقروءٌ من الناتجِ لا مُفترَضٌ

كلُّها على `feature/wasla-build-wip` في البيئةِ المحليّةِ
(bun 1.4.2 · PostgreSQL 18 + PostGIS · Redis).

| المرحلةُ | الأمرُ | الحكمُ |
|---|---|---|
| ١ التصريفُ | `bun run typecheck` (`tsc --noEmit` + مُخطَّطُ التطبيقِ) | **أخضرُ** · خروجٌ `0` · لا خطأَ واحدٌ — فدعوى «قد لا يُصرَّفُ» **انتفَت** |
| ٢ الصياغةُ | `bunx biome check --write` على 18 ملفّاً جديداً/مُعدَّلاً | **أخضرُ** · `Checked 18 files in 83ms. No fixes applied.` — فلا سطرَ احتاجَ تصحيحاً |
| ٣ الفحصُ الساكنُ العامُّ | `bun run lint` | **أخضرُ** · `Checked 1377 files` · **25 تحذيراً و1 info** — وهوَ **خطُّ الأساسِ السابقُ عينُه** الموروثُ عن `main`، فلا تحذيرَ جديداً أحدثَه هذا العملُ |
| ٤ الحواجزُ الساكنةُ الاثنا عشرَ | `check-driver-offers-contract` · `check-i18n` · `check-css-class-coverage` · `check-schema-contract` · `check-migrations` · `check-migration-safety` · `check-adr-numbering` · `check-docs-budget` · `check-integration-city-precondition` · `check-skip-classification` · `check-test-city-activation` · `check-roadmap.mjs` | **كلُّها خضراءُ**. ومن ناتجِها: الحاجزُ الجديدُ قرأَ 5 ملفّاتِ سطحٍ و68 مفتاحاً · و`i18n` **ثلاثةُ قواميسَ متطابقةٍ بـ376 مفتاحاً لكلٍّ** · وعقدُ المُخطَّطِ مطابقٌ (121 دالّةً و25 جدولاً) · وسلامةُ الهجراتِ 129 هجرةً · و`OPS-019` على **97 ملفّاً** فالاختبارُ الجديدُ **ملتزمٌ بشرطِ المدينةِ المفعَّلةِ** · وميزانُ التوثيقِ 365 وثيقةً دونَ السقفِ |
| ٥ اختباراتُ الوحدةِ | `bun test tests/unit` | **أخضرُ بعدَ إصلاحٍ جذريٍّ** · `3975 pass · 0 fail` · 13360 توكيداً · 236 ملفّاً. **وأوّلُ جولةٍ سقطَت** — انظُرْ §٠-أ |

وما بعدَ المرحلةِ الخامسةِ: انظُرْ §٥ — ما لم يُعلَنْ حكمُه ههنا **لم يُشغَّلْ**.

### ٠-أ) الإخفاقُ الوحيدُ الذي وقفَ الفحصَ — مسجَّلٌ لا مُتجاوَزٌ

أوّلُ تشغيلٍ لـ`tests/unit`: `3974 pass · 1 fail`. والساقطُ
`tests/unit/skip-audit.test.ts:629` — توكيدُ جردٍ مُثبَّتٍ:
`Expected length: 99 · Received length: 100`.

**السببُ الجذريُّ**: `F3-02` أضافَ مدخلاً واحداً إلى `scripts/lib/skip-registry.ts`
(لـ`tests/integration/driver-offers.test.ts`: 24 حالةً مرهونةً
بـ`TEST_DATABASE_URL`)، وجردُ التجاوزِ يُثبِّتُ العددَ **بقصدٍ** حتّى لا يدخُلَ
تجاوزٌ صامتاً. فإسقاطُه **أداءُ الحاجزِ وظيفتَه لا عطبٌ فيه**.

**العلاجُ**: رُفِعَ المُثبَّتُ من `99 → 100` ومن `1019 → 1043` (مقروءَينِ منَ
السجلِّ لا مُقدَّرَينِ)، **بالزيادةِ لا بالاستبدالِ** (`ح-8`): بقيَ نصُّ كلِّ
رقمٍ سابقٍ وأُضيفَ بندٌ يسمّي `F3-02` وسببَ الزيادةِ. **ولم يُعطَّلِ
الاختبارُ ولم يُخفَّفْ ولم يُصنَّفْ تجاوزاً**، وهذا عينُ ما فُعِلَ في `F2-12`
(من 97·978 إلى 98·994) و`F3-01` فهوَ مسلكُ المستودعِ المُقرَّرُ.

**ومُدخلُ السجلِّ فُحِصَ قبلَ رفعِ الرقمِ** ولم يُقبَلْ على عماًً: يحملُ
ستّةَ أسماءِ حزمٍ، وسبباً مكتوباً يُبينُ لمَ لا يُقاسُ المُدَّعى على محرِّكٍ
مُصنَّعٍ، ومالكاً، وشرطَ تفعيلٍ، ومساراً حرجاً، و`whyNotRun: null`. فهوَ تجاوزٌ
**مُعلَنٌ بمُشغِّلٍ** لا تجاوزٌ مسكوتٌ عنه.

وأُعيدَ القياسُ بعدَ الإصلاحِ: `3975 pass · 0 fail`.

> **دعوى مُعلَّقةٌ لم تُصدَّقْ بعدُ**: `docs/adr/0117-*.md` يحملُ في ترويستِه
> أرقاماً (٢٤ حالةَ تكاملٍ · ٤١ حالةَ وحدةٍ · ثمانُ قواعدَ لكلٍّ افتراقٌ
> مزروعٌ) **كتبَها البناءُ ولم يُصدِّقْها تشغيلٌ**. فهي دعاوى لا مقيساتٌ
> (`ح-5`)، وتُصحَّحُ بالإضافةِ (`ح-8`) أو تُحذَفُ من الترويسةِ قبلَ أيِّ دمجٍ.

## ١) أينَ هذا العملُ

- الفرعُ: `feature/wasla-build-wip`
- مقطوعٌ من: `feat/f3-02-driver-offers-timer-atomic-accept` وهوَ من
  `main`@`727a87b` (آخرُ أخضرَ مدموجٍ — `OPS-019` · PR #41).
- البندُ: `F3-02` — `SD-03` (قائمةُ العروضِ بمؤقّتٍ) + `SD-04` (تفاصيلُ عرضٍ)
  بقبولٍ ذرّيٍّ. المرجعُ: `docs/ROADMAP-MASTER.md` سطرُ 476-477 و799.
- الموجزُ الذي بُنِيَ عليهِ: `/home/user/workspace/ceezr-briefs/f3-02.md` (خارجَ
  المستودعِ؛ يحملُ القواعدَ والقُدوةَ المعماريّةَ وأوامرَ البيئةِ).

## ٢) ما أُنشِئَ فعلاً — ملفّاتٌ جديدةٌ

| الملفُّ | الأسطرُ | الدورُ |
|---|---|---|
| `supabase/migrations/20260915020000_f3_02_driver_offer_functions.sql` | 296 | ثلاثُ دوالَّ: `driver_offer_board(bigint)` · `driver_offer_detail(...)` · `driver_accept_offer(...)` |
| `packages/domain/driver/driver-offers.ts` | 168 | أنواعُ النطاقِ ومنطقٌ نقيٌّ |
| `packages/application/driver/driver-offers.ts` | 244 | طبقةُ التطبيقِ — `Result` ورموزُ خطأٍ عامّةٌ |
| `packages/application/driver/offer-ports.ts` | 90 | المنافذُ |
| `packages/infrastructure/driver/driver-offers-store.ts` | 337 | مُحقِّقُ المنفذِ على PostgreSQL |
| `apps/gateway/src/routes/driver-offers.ts` | 243 | مساراتُ البوّابةِ |
| `apps/miniapp/src/surfaces/driver/offers/offers-contract.ts` | 111 | عقدُ الشاشةِ |
| `apps/miniapp/src/surfaces/driver/offers/offers-view.ts` | 282 | منطقُ عرضٍ نقيٌّ |
| `apps/miniapp/src/surfaces/driver/offers/offers-api.ts` | 59 | نداءُ الخادمِ |
| `apps/miniapp/src/surfaces/driver/offers/OffersScreen.tsx` | 385 | شاشةُ `SD-03` |
| `apps/miniapp/src/surfaces/driver/offers/OfferDetailScreen.tsx` | 330 | شاشةُ `SD-04` |
| `scripts/lib/driver-offers-contract.ts` | 599 | منطقُ الحاجزِ النقيُّ |
| `scripts/check-driver-offers-contract.ts` | 80 | غلافُ الحاجزِ الرقيقُ |
| `tests/unit/check-driver-offers-contract.test.ts` | 525 | حالاتُ الحاجزِ السالبةُ المزروعةُ — **لم تُشغَّلْ** |
| `tests/integration/driver-offers.test.ts` | 568 | اختباراتُ تكاملٍ — **لم تُشغَّلْ** |
| `docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md` | 195 | القرارُ الحاكمُ |

## ٣) ما عُدِّلَ من ملفّاتٍ قائمةٍ

- `.github/workflows/ci.yml` — خطوتانِ مُسمّاتانِ في وظيفةِ `verify`.
- `package.json` — إدخالُ الحاجزِ في سلسلةِ `ci`.
- `apps/gateway/src/container.ts` · `index.ts` · `server.ts` — تركيبُ المساراتِ.
- `apps/miniapp/src/surfaces/driver/DriverRoot.tsx` — وصلُ الشاشتَينِ.
- `apps/miniapp/src/styles/global.css` + `scripts/lib/css-class-coverage.ts` —
  أصنافُ العرضِ ورفعُ عددِها في الحاجزِ القائمِ.
- `packages/shared/i18n/miniapp/{ar,en,ur}.json` — **+69 سطراً لكلِّ لغةٍ**
  (اللغاتُ الثلاثُ كلُّها؛ `check-i18n.ts` هوَ الحَكَمُ ولم يُشغَّلْ).
- `packages/infrastructure/db/schema-contract.ts` — عقدُ المُخطَّطِ.
- `scripts/lib/skip-registry.ts` — تصنيفُ تجاوزٍ.
- `ROADMAP.md` · `docs/ROADMAP-MASTER.md` · `docs/SYSTEM_STATE.md` — تحديثُ حالةٍ.
  **راجِعْ نصَّها**: إن قلبَت البندَ إلى `[x]` فذلكَ مخالفٌ لـ`ح-4` (لا `[x]`
  قبلَ ثلاثِ جولاتِ CI خضراءَ متتاليةٍ)، وأقصى المسموحِ `[~]`.

## ٤) الأحكامُ المعماريّةُ المُعلَنةُ في `ADR 0117`

تُقرأُ **نيّةَ تصميمٍ** لا واقعاً مُصدَّقاً:

1. **المؤقّتُ حقيقةُ خادمٍ**: يُنشَرُ الباقي محسوباً من ساعةِ القاعدةِ ولا
   يُقارَنُ `expires_at` بساعةِ الجهازِ — فساعةُ الهاتفِ تُعدَّلُ يدويّاً
   فتُخفي زرّاً يعملُ أو تُظهِرُ زرّاً يُرَدُّ.
2. **للقبولِ كاتبٌ واحدٌ**: `driver_accept_offer` **تُفوِّضُ** إلى `claim_ride`
   القائمةِ (`20260814160000`) ولا تكتُبُ ذرّيّةً ثانيةً — التزاماً بأقلِّ
   مصادرِ حقيقةٍ مكرَّرةٍ.
3. **المسافةُ موسومةٌ بجنسِها** فلا تُقرأُ مسافةَ طريقٍ وهي وترُ دائرةٍ كبرى.
4. **الطبقةُ الماليّةُ غائبةٌ بإعلانٍ**: جدولُ `orders` **لا عمودَ أجرةٍ فيهِ
   ولا تقديرٍ** (مقروءٌ من الكاتالوجِ)، فـ«التقديرُ» في `SD-03`/`SD-04` لم
   يُخترَعْ ولم يُعرَضْ صفراً كاذباً. **وهذا هوَ أهمُّ قرارٍ يلزمُ مراجعتَه**:
   اقرأْ §٤ في القرارِ وتحقَّقْ أنَّ الشاشةَ تُعلِنُ الغيابَ ولا تعرِضُ رقماً
   بلا سَنَدٍ.

## ٥) ما بقيَ — قائمةٌ صريحةٌ

### أ) لم يُشغَّلْ شيءٌ من هذهِ

```
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
bunx biome check --write <المسارات المعدَّلة>
bun run lint                                   # 25 تحذيراً سابقاً مقبولٌ
bun run scripts/check-i18n.ts
bun run scripts/check-driver-offers-contract.ts
bun run scripts/check-css-class-coverage.ts
bun run scripts/check-schema-contract.ts
bun run scripts/check-migrations.ts && bun run scripts/check-migration-safety.ts
bun run scripts/check-adr-numbering.ts
bun run scripts/check-docs-budget.ts
node scripts/check-roadmap.mjs
bun test tests/unit
TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/waslah" bun test tests/integration/driver-offers.test.ts
```

والهجرةُ `20260915020000` **لم تُطبَّقْ على أيِّ قاعدةٍ** — فلا يُعلَمُ أتُصرَّفُ
دوالُّها أصلاً أم لا.

### ب) ما لم يُنجَزْ من دورةِ العملِ

- لا طلبَ دمجٍ مفتوحٌ لهذا العملِ.
- لا جولةَ CI واحدةً عليهِ — **والأخضرُ المحليُّ ليسَ حكماً، فما لا محليَّ لهُ
  ولا CI فليسَ لهُ حكمٌ بحالٍ**.
- لا قياسَ «قبلَ/بعدَ» لحزمةِ التكاملِ، فلا يُعلَمُ أأحدَثَ انحداراً أم لا.
- تدقيقُ نصوصِ `ROADMAP.md` و`SYSTEM_STATE.md` و`ADR 0117` مقابلَ `ح-4` و`ح-5`
  (دعاوى الأرقامِ في §٠ أعلاهُ).

### ج) إخفاقاتٌ قائمةٌ على `main` نفسِهِ — لا تُنسَبُ إلى هذا العملِ

قِيسَت محليّاً على `main`@`db84827` في البيئةِ عينِها، وكلُّها **خضراءُ في CI**
(التشغيلُ `34917336328`: 898 ناجحاً · 0 ساقطاً على PostgreSQL 17):

- `tests/integration/safe-migration-runner.test.ts` — مهلةُ خُطّافٍ.
- `tests/integration/dispatch-nearby-candidates-postgis.test.ts` ×٢ — مهلةُ
  `truncate` (تنجحُ منفردةً).
- `tests/integration/hot-query-index-plans.test.ts` — مُخطِّطُ PG18 محليّاً
  يختارُ فهرساً حيثُ يختارُ PG17 مسحاً تسلسليّاً.

فمن قاسَ محليّاً فليَقِسْ `main` أوّلاً في البيئةِ نفسِها، ولا يَنسُبْ إخفاقاً
سابقاً إلى فرعٍ جديدٍ.

### د) شرطُ المدينةِ المفعَّلةِ — مُلزِمٌ (`OPS-019`، مدموجٌ)

`tests/integration/driver-offers.test.ts` **لم يُفحَصْ** مقابلَ هذا الشرطِ.
يجبُ أن يستعملَ `tests/support/active-city.ts`:
`ensureActiveCity(sql, {prior})` ثمَّ `restoreCityBaseline(sql, handle)`، ولا
`where c.is_active` لاختيارِ مدينةٍ، ولا تفعيلَ بلا ردٍّ. وسجلُّ إعفاءاتِ
الحاجزِ `check-integration-city-precondition.ts` **فارغٌ بقصدٍ فلا يُضافُ إليهِ**.

### هـ) حجزٌ قائمٌ لا يُمَسُّ

`OPS-020` (توحيدُ حاجزَي تفعيلِ المدينةِ) محجوزٌ في `ROADMAP.md` ولم يُنفَّذْ.
ولا يُخلَطُ بهذا العملِ.

## ٦) البيئةُ المحليّةُ (قائمةٌ في هذهِ الجلسةِ)

```
sudo pg_ctlcluster 18 main start
redis-server --daemonize yes --port 6379
DATABASE_URL="postgres://postgres:postgres@localhost:5432/waslah" bun run scripts/migrate.ts
# تصفيرُ خطِّ الأساسِ قبلَ أيِّ قياسٍ منفردٍ:
psql "postgres://postgres:postgres@localhost:5432/waslah" -c "update cities set is_active=false, telegram_support_group_id=null, telegram_escalation_group_id=null, telegram_unsubscribed_drivers_group_id=null"
```

خطُّ الأساسِ: خمسُ مدنٍ كلُّها `is_active = false` (قرارُ `F2-05`)، وصفٌّ
`city_service_areas` مفعَّلٌ واحدٌ لـ`JED`، وقيدُ `cities_active_requires_groups`
يشترطُ أعمدةَ القروباتِ الثلاثةَ عندَ التفعيلِ.
والتشغيلُ الخلفيُّ يلزمُهُ
`setsid bash -c '...' >/dev/null 2>&1 </dev/null & disown` — وحزمةُ التكاملِ
٩–١٤ دقيقةً.
