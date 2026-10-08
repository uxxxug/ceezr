# PRD-008 — Smoke من عميل Telegram حقيقي — سجلٌّ جزئيّ (2026-10-08)

**البند:** PRD-008 · **الحالة:** Blocked — جزئيّ. المُختبَرُ: مسارُ رسائلِ البوتَين، وStep 1 للـMini App (launch + sign-in) على Android وحدَه (§1ب).
**المصدر:** رسالتان حقيقيّتان أرسلَهما المالكُ من عميلِ Telegram (11:02–11:03 UTC) + قاعدةُ الإنتاج (`telegram_update_jobs`) + Render app logs. لا لقطاتِ شاشة، ونسخةُ العميلِ ونظامُه غيرُ مُسجَّلَين.
**ما لا يحتويه:** لا نصَّ رسائل، ولا مُعرِّفاتِ Telegram (`actor` مُجزَّأ)، ولا أسرار.

## 1. ما اختُبِرَ حيًّا

| الخطوة | الدليل | النتيجة |
|---|---|---|
| تحديثٌ حقيقيٌّ يصلُ webhook بوتِ **السائق** ويُعالَج | `telegram_update_jobs`: `bot=driver` · 11:02:36 → `done` 11:02:43 · `attempts=1` · لا `error_code` | ناجح |
| تحديثٌ حقيقيٌّ يصلُ webhook بوتِ **الراكب** ويُعالَج | `telegram_update_jobs`: `bot=rider` · 11:03:20 → `done` 11:03:25 · `attempts=1` | ناجح |
| جلسةُ الحوار على Redis (`GET` ثمّ `SET EX`) | `language.hydrated from=absent_session` لكلٍّ منهما؛ لا `session.redis_failed` ولا `hydrate_save_failed` | ناجح (التفصيل: `PRD-001-redis-healthy-20261008.md` §4ب) |
| زمنُ المعالجة (من الإدراجِ إلى `done`) | 6.6ث (driver) · 4.3ث (rider) | مقيس؛ لا حدَّ مُعتمَدٌ له بعد (PRD-009) |

**ما لا يُثبِتُه هذا:** أنَّ الردَّ وصلَ العميلَ وظهرَ صحيحًا (يُرى على الجهازِ وحدَه؛ ولا `bot.telegram_send_failed` في السجلّ).

## 1ب. الـMini App على Android — Step 1 (launch + sign-in)

**الجهاز (من المالك):** TECNO POVA Slim 5G (KM9) · HiOS 16.3.0 / Android · Telegram 12.10.6. الواجهةُ ظهرَت عربيّةً RTL بشاشةِ الراكبِ كاملة (لقطةُ المالك).
**النشرُ الحيّ (Render API):** `waslah-gateway` على `3024990c` (`dep-db3o0h7avr4c73aihe8g` · `live` منذ 11:37 UTC)؛ `waslah-miniapp` على `e5282587` ولا فرقَ في `apps/miniapp` ولا `packages/shared` بينَه وبينَ `main`.

| الخطوة | الدليلُ الخادميّ (Render app logs) | النتيجة |
|---|---|---|
| auth — `POST /v1/session/telegram` بـ`initData` حقيقيّ | `session.issued` `bot=rider` 12:06:31 UTC، ثمّ 12:30:40 UTC | ناجح |
| تجديدُ الجلسة | `session.renewed` `generation=1` 12:30:16 و`generation=2` 12:30:41 | ناجح |
| رفضٌ مرصود (غيرُ مانع) | `session.telegram_proof_rejected` `HASH_MISSING` ×2 عند 12:09:15–16 (فتحٌ بلا `initData` موقَّع — على الأرجحِ رابطٌ خارجَ زرِّ الـMini App)؛ `AUTH_DATE_STALE` 12:30:16 تلاهُ تجديدٌ ناجحٌ في الثانيةِ نفسِها؛ `session.refresh_token_rejected` `ABSOLUTE_EXPIRED` 12:06:31 (رمزٌ قديمٌ قبلَ الإصدار) | مُسجَّل |
| consent — `/v1/consents` | آخرُ صفٍّ في `user_consents` بتاريخ 2026-10-02؛ الحسابُ وافقَ سابقاً | **Not Tested** |

لا `error` في سجلِّ البوابةِ منذ النشرِ إلا `move_event_outbox.shipper_not_configured` عندَ الإقلاع (تهيئةٌ سابقة، لا علاقةَ لها بالـMini App).

## 1ج. فجوةُ الدليلِ لـStep 2 وسدُّها

خطّةُ Render المجانيّةُ **لا تحفظُ سجلَّ طلباتٍ** (أنواعُ السجلِّ المتاحة: `app` و`build` فقط) **ولا مقاييسَ HTTP** (`http_request_count` فارغ). والمساران `GET /v1/destinations/search` و`POST /v1/destinations/resolve` و`POST /v1/quote/ride` قراءةٌ بلا كتابةٍ في القاعدة، وكانا لا يكتبانِ سطراً عندَ النجاح — فلا أثرَ خادميَّ مباشرَ لنجاحِ Step 2.

السدُّ (Work Packet `prd-008-success-logs`): سطرٌ واحدٌ عندَ جوابِ `200` وحدَه، برموزِ النتيجةِ وحدَها:

| الحدث | الحقول |
|---|---|
| `destinations.search_answered` | `outcome`: `SUGGESTIONS` \| `NO_MATCH` |
| `destinations.resolve_answered` | `accepted`، `refusal` (رمزٌ أو `null`) |
| `quote.answered` | `accepted`، `refusal`، `distanceKind`، `eta` (`ROUTED` أو `UNAVAILABLE:<سبب>`) |

لا استفهامَ ولا اسمَ ولا إحداثيّةَ ولا مسافةَ ولا مدينةَ ولا مُعرِّفَ Telegram؛ و`request_id` يُضافُ من المُسجِّلِ كسائرِ الأسطر. الحمولاتُ والعقودُ لم تتغيّر (اختبارُ تطابقٍ بايتيّ). **خطُّ الأساسِ لعدمِ إنشاءِ رحلة:** `orders` = 3 (آخرُها 2026-10-03) · `order_offers` = 4.

## 1د. Step 2 — الوجهةُ والاقتباس على Android (13:31–13:36 UTC)

**المصدر:** Render app logs بعدَ نشرِ `2787e09` (`dep-db3pk1vavr4c73anvrag`) + قاعدةُ الإنتاج + 3 لقطاتٍ من المالك (16:33–16:35 بتوقيت السعودية).

| الحدث (Render) | العدد | النتيجة |
|---|---|---|
| `session.issued` `bot=rider` | 1 (13:31:49) | ناجح (سبقَه `AUTH_DATE_STALE` ×2 و`refresh_token_rejected` من نافذةٍ قديمة — تعافٍ تلقائيّ) |
| `destinations.search_answered` `outcome=SUGGESTIONS` | 11 | ناجح |
| `destinations.resolve_answered` `accepted=true` | 9 | ناجح |
| `quote.answered` `accepted=true` `distanceKind=STRAIGHT_LINE` `eta=ROUTED` | 4 | ناجح (اللقطة: 7.6 كم · 17 دقيقة إلى مسجد قباء) |
| `orders` / `order_offers` بعدَ الاختبار | 3 / 4 | **لا رحلةَ أُنشئَت** (مطابقٌ لخطِّ الأساس) |

لا `error` ولا `route_disabled` في النافذة.

### عيبُ ثقةٍ مفتوح: LOC-TRUST-01 — «موقعي الحاليّ» قرأ نقطةً بعيدةً عن الراكب

**المُشاهَد:** بطاقةُ «موقعي الحاليّ» في شاشةِ الالتقاطِ قالت «قربَ مسجدِ بلال بن رباح — نحوَ 122 متر بخطٍّ مستقيم»، والمالكُ يقولُ إنَّ موقعَه غيرُ ذلك؛ ثمّ اختارَ الالتقاطَ بالاسم.

**ما ثبتَ أنّه ليسَ السبب:**
- `resolve_destination` في قاعدةِ الإنتاجِ تُعيدُ `lat`/`lng` **نقطةَ المستخدمِ بعينِها** (`p_lat`/`p_lng`)، والمعلَمُ الأقربُ حقلُ `nearest` وصفيٌّ منفصل.
- `acceptedSummary` و`onConfirmed` في `DestinationScreen.tsx` يأخذانِ إحداثيّاتِ الجوابِ (نقطةَ الجهاز) لا إحداثيّاتِ المعلَم، والوسمُ «موقعي الحاليّ» لا اسمُ المعلَم.
- لا تخزينَ محلّيَّ للموقع (لا `localStorage`/`CloudStorage`)، وكلُّ ضغطةٍ تستدعي `LocationManager.init` ثمّ `getLocation` من جديد. ومضيفُ الاختبارِ (`tg/test-host.ts`) غيرُ مُركَّبٍ في الإنتاج.

**ما ثبتَ أنّه السبب (بالحساب):** المعلَمُ «مسجد بلال بن رباح» في `destination_landmarks` عندَ (24.4615، 39.6118) — وسطُ المدينةِ قربَ المسجدِ النبويّ. فالنقطةُ التي أعادَها Telegram كانت ضمنَ ~122 م منه، وهيَ بإفادةِ المالكِ ليسَت موضعَه (لا تُدوَّنُ ههنا إحداثيّاتُه ولا حيُّه). **الخطأُ في الإحداثيّةِ التي سلَّمَها Telegram، لا في استبدالِها باسمِ معلَم.**

**السببُ الجذريُّ المرجَّح:** `LocationManager.getLocation` على Telegram لـAndroid يُعيدُ موقعاً **راكداً** لا يتحدّثُ ما لم يُحرِّكْ خدمةَ الموقعِ مصدرٌ آخر — عيبٌ مفتوحٌ لدى Telegram ([Telegram-Mini-Apps/issues#56](https://github.com/Telegram-Mini-Apps/issues/issues/56)). ولا يحملُ `LocationData` طابعاً زمنيّاً ([Telegram Mini Apps — LocationData](https://core.telegram.org/bots/webapps))، فلا يستطيعُ التطبيقُ وحدَه إثباتَ حداثتِه.

**ما يجعلُ العيبَ خطِراً في كودِنا:**
1. `horizontal_accuracy` يُقرأُ في `tg/location.ts` ثمّ **يُرمى** في `defaultDeviceLocation` (شاشتا الوجهةِ والاقتباس): لا رفضَ لقراءةٍ ضعيفةِ الدقّةِ ولا عرضَ لها.
2. لا خريطةَ ولا نقطةَ معروضةً للراكب: الشيءُ الوحيدُ الظاهرُ هوَ اسمُ المعلَمِ و«122 متر» — دقّةٌ ظاهريّةٌ عن مسافةِ المعلَمِ لا عن صحّةِ الموقع، فيُقرأُ الاسمُ كأنّه الموقع.
3. لا تأكيدَ صريحٌ من الراكبِ أنَّ النقطةَ صحيحةٌ قبلَ اعتمادِها.
4. الوسمُ «موقعي الحاليّ» يُرسَلُ `pickup_label` كما هوَ — لا يفيدُ السائقَ شيئاً.

**الحالة:** مفتوح — لا تغييرَ في السلوكِ قبلَ قرارِ المالك. **لا يُنتقَلُ إلى Step 3+ (إنشاءُ الطلبِ والسائق) قبلَ حسمِه وإعادةِ الاختبارِ على الجهاز.** Step 2 نفسُه (بحثٌ ومصادقةٌ واقتباسٌ ولا رحلة) ناجحٌ بدليلٍ خادميٍّ مباشر.

## 2. ما لم يُختبَر

لا أثرَ في السجلِّ منذ 10:40 UTC لأيٍّ ممّا يلي (بحثٌ عن `auth`/`initData`/`consent`/`miniapp`: لا شيء):

| خطوة شرطِ القبول | الحالة |
|---|---|
| launch — فتحُ الـMini App من البوت | Android: ناجح (§1ب) · iOS/Desktop: لم يُختبَر |
| auth — `POST /v1/session/telegram` بـ`initData` موقَّعٍ حقيقيًّا | Android: ناجح (§1ب) · iOS/Desktop: لم يُختبَر |
| consent — `/v1/consents` | Not Tested (الحسابُ وافقَ سابقاً) |
| rider — طلبُ رحلة (`/v1/quote` ← `/v1/rides`) | الاقتباسُ: Android ناجح (§1د) · الإنشاء: لم يُختبَر — محجوبٌ على LOC-TRUST-01 |
| driver — استلامُ العرضِ وقبولُه (`/v1/driver/offers`) | لم يُختبَر |
| tracking — الموقعُ الحيّ وصفحةُ التتبّع | لم يُختبَر |
| SOS — `/v1/safety/sos` · `/v1/driver/safety/sos` | لم يُختبَر |
| emergency contact — `/v1/me/emergency-contact` | لم يُختبَر |
| BackButton · Haptics · `themeChanged` | لم يُختبَر (سلوكُ عميلٍ — لا أثرَ له في الخادم؛ لقطةٌ/تسجيلٌ من الجهاز وحدَه) |
| المصفوفة: iOS · Android · Desktop | لم يُختبَر أيٌّ منها بالـMini App |

## 3. بروتوكولُ الإكمال — المالكُ على الجهاز، والوكيلُ على الخادم

لكلِّ جهازٍ (iOS ثمّ Android ثمّ Desktop) يُسجِّلُ المالكُ: **الجهاز · نظامُه · نسخةُ Telegram · الوقت (UTC تقريبًا) · لقطةُ شاشة**. ويتحقّقُ الوكيلُ من الخادمِ بعدَ كلِّ خطوة:

| # | على الجهاز (المالك) | التحقّقُ من الخادم (الوكيل) |
|---|---|---|
| 1 | فتحُ بوتِ الراكبِ ← زرُّ الـMini App | لا 4xx/5xx في السجلّ؛ الـminiapp الحيّةُ = بصمةُ `main` (PRD-002) |
| 2 | التطبيقُ يفتحُ ويُسجِّلُ الدخول | جلسةٌ صادرةٌ من `/v1/session/telegram`؛ لا `initData` مرفوض |
| 3 | الموافقةُ على الشروط | صفٌّ جديدٌ في `user_consents` |
| 4 | طلبُ رحلةٍ في المدينة | صفٌّ في `orders` + عرضٌ في `order_offers` |
| 5 | بوتُ السائقِ (حسابٌ ثانٍ/جهازٌ ثانٍ): قبولُ العرض | العرضُ `accepted`، والطلبُ ينتقلُ؛ لا `bot.telegram_send_failed` |
| 6 | السائقُ يشاركُ الموقعَ الحيّ | `job.ran flush-driver-locations … drained>0`؛ صفوفٌ في `driver_location_history_20261008` |
| 7 | الراكبُ يرى التتبّع | صفٌّ في `tracking_sessions`؛ لا خطأ |
| 8 | SOS من الراكب (في اختبار — يُبلَغُ المشرفُ سلفًا) | صفٌّ في `safety_incidents` + تسليمٌ في `safety_incident_deliveries` |
| 9 | فتحُ جهةِ الطوارئ وحفظُها | `/v1/me/emergency-contact` ناجح؛ `read_emergency_contact` تُعيدُ القيمة |
| 10 | زرُّ الرجوع، الاهتزاز، تبديلُ سمةِ Telegram (فاتح/داكن) | لقطةٌ قبلَ وبعد — سلوكُ عميلٍ لا أثرَ خادميٌّ له |

ثمّ إلغاءُ الرحلةِ التجريبيّةِ وتعليمُها، ويُضافُ لكلِّ جهازٍ قسمٌ بالنتائج إلى هذا الملفّ. **شرطُ Verified:** الخطواتُ 1–10 ناجحةٌ على الأجهزةِ الثلاثة بلقطاتٍ ودليلٍ خادميّ.

## 4. النتيجة

PRD-008 **Blocked**: المُختبَرُ حيًّا مسارُ رسائلِ البوتَين (وصولٌ ومعالجةٌ وجلسةُ Redis) وStep 1 للـMini App على Android وحدَه. وStep 2 (الوجهةُ والاقتباسُ بلا رحلةٍ) على Android؛ ومفتوحٌ عيبُ الثقةِ LOC-TRUST-01 (§1د) ويحجبُ Step 3+. بقيّةُ رحلةِ الـMini App (Steps 3–10) وBackButton/Haptics/themeChanged ومصفوفةُ الأجهزةِ الثلاثةِ لم تُختبَر، وتحتاجُ أجهزةَ المالك.
