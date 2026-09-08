# F6-03 / البندُ `n` — توحيدُ صندوقِ صادرِ الاستغاثةِ: **المرحلةُ الأولى (safety_incident)**

> هذا الملفُّ يُسجِّلُ المرحلةَ الأولى من توحيدِ الصناديقِ المعاملاتيّةِ الثلاثةِ
> الباقيةِ (`safety_incident_deliveries` · `subscription_notices` · `broadcast_recipients`)
> في `notification_outbox` — البندُ `n` في `docs/ROADMAP-MASTER.md` («Outbox معاملاتي
> موحّد (BUG-004)») الذي بقي `[ ]` لأنّ توحيدَها «إعادةُ تصميمٍ لا يأذنُ بها نطاقُ
> بندِ `BUG-004` المُغلَق». والـADR الحاكمُ `ADR-0061`.

> **ولا يُقلَبُ `n` إلى `[x]` هنا** — توحيدُ safety وحده شطرٌ واحدٌ من ثلاثة،
> والقلبُ معلَّقٌ على ثلاثِ جولاتِ CI خضراءَ متتاليةٍ (`ح-4`) لا قبلَها. ولا يُدَّعى
> «مُثبَتٌ» (`ح-5`): المقيسُ سلوكُ القاعدةِ والعاملِ على PostgreSQL حقيقيّةٍ محليّاً،
> لا الإنتاج.

## 1. القرارُ الحاكمُ

`ADR-0061` — صندوقُ الصادرِ الموحَّدُ لكلِّ التسليماتِ (F6-03 / BUG-004). نهجُ
**التوسيعِ ثمّ التقليصِ** (expand-then-contract): تتمدَّدُ `notification_outbox` لتكونَ
المصدرَ الوحيدَ لحالةِ التسليم، وتصيرُ دوالُّ `claim`/`finish` القديمةُ أغلفةً رفيقةً
(compatibility wrappers) تقرأُ وتكتبُ `notification_outbox`. لا يُسقَطُ جدولٌ قديمٌ
في هذه المرحلةِ — يُسقَطُ في هجرةِ التقليصِ اللاحقةِ بعدَ استقرارِ التسليمِ من المصدرِ
الموحَّد.

## 2. الهجرةُ والكودُ

| | |
|---|---|
| الهجرةُ | `supabase/migrations/20260908010000_unified_outbox_safety_incident.sql` |
| الـADR | `docs/adr/0061-unified-transactional-outbox.md` |
| الاختبارُ المُحدَّثُ | `tests/integration/safety-sos.test.ts` (٥ حالاتٍ) |
| سجلُّ مسارِ العودةِ | `scripts/lib/rollback-registry.ts` (٣ مداخلَ) |

تُضيفُ الهجرةُ نوعَ `safety_incident` إلى قيدِ النوعِ في `notification_outbox`،
وتُعيدُ تعريفَ ثلاثِ دوالَّ بـ`create or replace` مع حفظِ تواقيعِها ومُرجَعاتِها
حرفًا بحرفٍ:

- `trigger_sos(uuid, bigint, text)` — يُودِعُ صفَّ التسليمِ في `notification_outbox`
  بـ`dedup_key = 'safety_incident:'||incident_id` و`on conflict (kind, dedup_key) do
  nothing` بدلَ `insert into safety_incident_deliveries`. بقيةُ المنطقِ (قفلُ
  `orders`، التحقّقُ من المُبلِّغ، قفلُ النافذةِ الاستشاريُّ، إنشاءُ الحادثِ) منسوخةٌ
  حرفًا بحرفٍ ولم يُمَسَّ مفتاحٌ من مفاتيحِ المُرجَعِ (`ok`/`incident_id`/`created`/`error`).
- `claim_safety_incident_delivery()` — غلافٌ يفحصُ `notification_outbox` حيثُ
  `kind='safety_incident'`، **محافظًا على سلوكِ scan-skip-defer حرفًا بحرفٍ**: يفحصُ
  حتى ١٠٠ مرشّحٍ `for update skip locked`، يتخطّى صفوفَ المدنِ الناقصةِ الإعداد
  (`ESCALATION_GROUP_MISSING`/`SOS_RETRY_SETTING_MISSING`) ويُرجِعُها في `deferred`
  بلا استهلاكِ محاولةٍ، ويُطالِبُ بأوّلِ صفٍّ مكتملِ الإعداد. والمُرجَعُ بنفسِ الحقولِ
  (`delivery_id`·`incident_id`·`claim_token`·`group_id`·`order_id`·`service`·
  `reporter_role`·`status`·`location_wkt`·`max_attempts`).
- `finish_safety_incident_delivery(uuid, uuid, bigint, boolean)` — يُحدِّثُ
  `notification_outbox`؛ `delivered_message_id` نصٌّ فيُخزَنُ `p_message_id::text`.
  السلوكُ محفوظٌ: النجاحُ يُثبِّتُ `delivered`، والفشلُ يُعيدُ الصفَّ `pending` بموعدٍ
  جديد.

## 3. بصمةُ الإعداداتِ

* لا سرَّ ولا مفتاحَ. المتغيّرُ `TEST_DATABASE_URL` وحده، وفي CI يُلزِمُ `CI_REQUIRE_DB=1`.
* **ولا رقمَ تجاريّاً في الشيفرةِ**: `sos_dedup_window_seconds` (١٢٠) ·
  `sos_delivery_retry_seconds` (٣٠) · `sos_delivery_max_attempts` (٣) — ثلاثتُها في
  `platform_settings` لكلِّ مدينةٍ، والشيفرةُ تقرأُ ولا تُقرِّر.
* بيئةُ القياسِ المحليّةِ: PostgreSQL 18 + PostGIS على `127.0.0.1:5432`، الهجراتُ
  تُطبَّقُ بـ`psql -v ON_ERROR_STOP=1` بالترتيبِ (٦٩ هجرةً + هجرةُ التوحيدِ = ٧٠).

## 4. ما قِيسَ فعلاً

اختبارُ `tests/integration/safety-sos.test.ts` على PostgreSQL حقيقيّةٍ، ٥ حالاتٍ
كلُّها `pass`:

1. **الصفُّ السامُّ لا يمنعُ التسليمَ** — صفٌّ أقدمُ في مدينةٍ بلا مجموعةِ تصعيد
   يُودَعُ في `notification_outbox` (`kind='safety_incident'`)، فيُطالَبُ فيُرجَعُ
   `ESCALATION_GROUP_MISSING` في `deferred` بلا استهلاكِ محاولةٍ (`attempts=0`)،
   ويُسلَّمُ حادثُ جدّة في الدورةِ نفسِها. سلوكُ «الصفُّ السامّ» محفوظٌ بالضبط.
2. **ضغطتا SOS متزامنتان** — حادثٌ واحدٌ وصفُّ تسليمٍ واحدٌ في `notification_outbox`
   (`on conflict (kind, dedup_key) do nothing`).
3. **فشلُ تيليجرام مرة** — الصفُّ يعودُ `pending` بـ`attempts=1` وموعدِ إعادةٍ، ثمّ
   يُسلَّم في المحاولةِ التاليةِ بـ`attempts=2` و`message_id='7788'`.
4. **إغلاقان متزامنان** — قرارٌ واحدٌ (عن `safety_incidents`، لا يتأثّرُ بالتوحيد).
5. **قرارُ الحجب** — يستدعي مسارَ الإدارةِ ويحفظُ من اتخذَه (لا يتأثّرُ بالتوحيد).

## 5. الحرّاسُ محليّاً

`lint`=`0` · `typecheck`=`0` · `check-migrations`=`✅` · `check-adr-numbering`=`61 قراراً` ·
`check-schema-contract`=`87 دالّة و23 جدولاً مطابق` · `check-skip-classification`=`✅` ·
`check-rollback-safety`=`✅` (التحذيراتُ المتبقيةُ موجودةٌ مسبقاً على `main` من هجرةِ
`20260809001000`، ليست من هذه المرحلة). مجموعةُ التكاملِ: `521 pass` · `11 skip` ·
`1 fail` (مهلةُ ٩٠ث في اختبارِ النسخِ الاحتياطيِّ — بيئيٌّ، لا علاقةَ له بالصندوق) —
**لا إخفاقٌ جديدٌ أُدخِلَ**.

## 6. ما لا يُدَّعى

لا `مَقيس` ولا `مُثبَت` ولا `VERIFIED` (`ح-5`): المُرسِلُ في الاختبارِ مزدوجٌ،
والقياسُ على بيئةٍ محليّةٍ لا الإنتاج. ولا يُقلَبُ `n` إلى `[x]` — هذه المرحلةُ
شطرٌ واحدٌ (safety) من ثلاثة (safety · subscription · broadcast)، والقلبُ معلَّقٌ على
ثلاثِ جولاتِ CI خضراءَ متتاليةٍ (`ح-4`) لا قبلَها.
