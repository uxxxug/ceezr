# تدقيق مسارات `telegram_id` كمفتاح هوية — بعد إغلاق SEC-17/18/19، قبل فتح SEC-20/21

**التاريخ:** 2026-09-22  
**النطاق:** تدقيقٌ ساكنٌ لمسارات `users.telegram_id` في المستودع بعدَ إغلاق `SEC-17`/`SEC-18`/`SEC-19`، للتحقُّقِ من أنَّهُ لا يوجدَ مسارٌ إنتاجيٌّ يستعملُهُ كمفتاحِ هويّةٍ داخليٍّ بدلَ `users.id`.  
**الغرضُ من التدقيق:** تحديدُ ما إذا كانَ فتحُ `SEC-20`/`SEC-21` آمنًا — أي: هل بقيَ مسارٌ يعتمدُ على `telegram_id` كهويّةٍ داخليةٍ تمنعُ أو توجِّهُ `SEC-20`/`SEC-21`؟  
**ما لا يُدَّعى (`ح-5`):** هذا تدقيقٌ ساكنٌ — قراءةُ شيفرةٍ لا تشغيلٌ. ولا يُدَّعى أنَّ كلَّ مسارٍ قِيسَ أمامَ `null` حيٍّ، ولا أنَّ `ARCH-014` مُستوفًى. والنتيجةُ تصنيفٌ لا إثباتٌ.

---

## ١. المنهج

### ١-١. أدوات البحث

استُخدمت أربعةُ أنماطٍ من البحث:

- **دوالّ SQL الآخذةُ `p_telegram_id`:** `rg "create or replace function.*p_telegram_id" supabase/migrations/`
- **مواضع `WHERE telegram_id =` في SQL:** `rg "where.*telegram_id\s*=" supabase/migrations/`
- **محوّلات TypeScript الآخذةُ `telegramId`/`telegramUserId`:** `rg "telegramId:|telegramUserId:" packages/ apps/`
- **مواضع `where.*telegram_id` في TypeScript:** `rg "where.*telegram_id|telegram_id.*=" packages/infrastructure/`

### ١-٢. التعريفات

| المصطلح | المعنى |
|---|---|
| **حدّ دخولٍ خارجيٌّ** | مسارٌ يستقبلُ `telegram_id` من خارجِ النظام (initData، بوت تيليجرام) ويحوّلُهُ فورًا إلى `users.id`. هذا ليس مفتاحَ هويّةٍ داخليٍّ. |
| **حلٌّ انتقاليٌّ** | دالّةٌ SQL تأخذُ `p_telegram_id` لكنّها تُحمِّلُ `users.id` في أوّلِ سطرٍ (`select u.id from users u where u.telegram_id = p_telegram_id`) وتستعملُ `users.id` في كلِّ ما يليه. |
| **مفتاحُ هويّةٍ داخليٌّ باقٍ** | مسارٌ يستعملُ `telegram_id` للملكيّةِ أو العلاقاتِ أو الصلاحياتِ أو التدقيقِ بدلَ `users.id` — وهو ما يجبُ إبرازُهُ كدينٍ. |
| **رابطُ تسليمٍ** | مسارٌ يقرأُ `telegram_id` لبناءِ عنوانِ التسليم (chat_id) لإرسالِ رسالةٍ على تيليجرام. |
| **أثرٌ تراثيٌّ غيرُ نافذٍ** | عمودٌ أو مسارٌ باقٍ للتوافقِ (مثلَ `created_by bigint`) لكنّهُ لا يُقرَأُ في مسارٍ إنتاجيٍّ نشطٍ. |

---

## ٢. النتائج

### ٢-١. الجدولُ المُصنَّف

| # | المسار / الملف | النوع | يعتمدُ على `users.telegram_id`؟ | يحوّلُ إلى `users.id`؟ | أثرُ `NULL` | الحكمُ | الدليلُ المختصر |
|---|---|---|---|---|---|---|---|
| 1 | `exchange-telegram-session.ts` → `telegram-init-data.ts` | حدّ دخولٍ خارجيٌّ | نعم — من initData الموقَّع | نعم — عبر `findByTelegramUserId` | لا يصلُ القاعدةَ لو كانَ `null` (initData يُرفَضُ قبلَ ذلك) | **cleared** — هذا مدخلُ الهويّةِ، وهو مقبولٌ مؤقَّتًا لأنَّ تيليجرام هو المزوِّدُ الوحيدُ قبلَ `SEC-20`/`SEC-21` | initData يُستخرَجُ منه `telegramUserId` كمُعرِّفٍ رقميٍّ موجَبٍ فقط (`id > 0`) |
| 2 | `resolve-viewer.ts` → `viewer-account.ts:61` | حلٌّ انتقاليٌّ | نعم — `where telegram_id = $1` | نعم — يُعيد `role` و`is_blocked` فقط، لا يُمرِّر `telegram_id` للأمام | `null` لا يطابقُ صفًّا → `ok(null)` → «غير مسجَّل» | **cleared** | الحارسُ `asTelegramId` يرفضُ غيرَ الرقميِّ؛ و`null` لا يصلُ لأنَّ الجلسةَ تحملُ `telegramUserId` من initData |
| 3 | `directories.ts:89` — `findByTelegramId` (سائق) | حلٌّ انتقاليٌّ | نعم — `where u.telegram_id = $1` | نعم — `join users u on u.id = d.user_id`؛ يُعيد `driver_id` و`city_id` لا `telegram_id` كَهويّةٍ | `null` لا يطابقُ → `null` (لا سائق) | **cleared** | يُستعمَلُ في تسجيلِ السائقين، و`null` يعني «غير مسجَّل» |
| 4 | `directories.ts:328` — `findByTelegramId` (راكب) | حلٌّ انتقاليٌّ | نعم — `where u.telegram_id = $1` | نعم — `join users u on u.id = r.user_id` | `null` لا يطابقُ → `null` | **cleared** | كالسابق |
| 5 | `rider_ride_history()` — SQL | حلٌّ انتقاليٌّ | نعم — `where u.telegram_id = p_telegram_id` | نعم — `select u.id into v_user_id` ثمَّ كلُّ الاستعلاماتِ بـ`v_user_id` | `null` → `USER_NOT_FOUND` | **cleared** | النموذجُ الكاملُ: `p_telegram_id` → `users.id` → بقيةُ المنطق |
| 6 | `list_user_consents()` — SQL | حلٌّ انتقاليٌّ | نعم — `join users u ... where u.telegram_id = p_telegram_id` | نعم — `join` على `u.id = c.user_id` | `null` → لا صفوفَ | **cleared** | |
| 7 | `list_saved_places()` — SQL | حلٌّ انتقاليٌّ | نعم — `where u.telegram_id = p_telegram_id` | نعم — `join users u on u.id = p.user_id` | `null` → لا صفوفَ | **cleared** | |
| 8 | `get_reputation_summary()` — SQL | حلٌّ انتقاليٌّ | نعم — `select * from users where telegram_id = p_telegram_id` | نعم — يحمِّلُ `users%rowtype` ويستعملُ `v_user.id` | `null` → `USER_NOT_FOUND` | **cleared** | |
| 9 | `get_user_language()` — SQL | حلٌّ انتقاليٌّ | نعم — `select * from users where telegram_id = p_telegram_id` | نعم — يقرأُ `language_code` من `v_user` | `null` → `USER_NOT_FOUND` | **cleared** | |
| 10 | `is_support_actor()` — SQL | حلٌّ انتقاليٌّ | نعم — `select * from users where telegram_id = p_telegram_id` | نعم — يحمِّلُ `users%rowtype` ويُعيدُ `user_id` | `null` → `ACTOR_NOT_FOUND` | **cleared** | |
| 11 | `grant_bootstrap_admin()` — SQL | حدّ دخولٍ خارجيٌّ | نعم — `select * from users where telegram_id = p_telegram_id` | نعم — يُعيدُ `v_user.id` | `null` → `USER_NOT_FOUND` | **cleared** | أداةُ إقلاعٍ، لا مسارُ إنتاجٍ متكرِّر |
| 12 | `issue_admin_login_code()` — SQL | حدّ دخولٍ خارجيٌّ (إدارة) | نعم — `select * from users where telegram_id = p_telegram_id` | نعم — يُعيدُ `user_id` و`telegram_id` للتسليم | `null` → `USER_NOT_FOUND` | **remaining dependency** — **هذا هو مسارُ `SEC-21` بعينه**: الرمزُ يُرسَلُ على تيليجرام، والدخولُ الإداريُّ يعتمدُ على `telegram_id` كهويّةٍ | `SEC-21` ستُنشِئُ بابَ دخولٍ لا يمرُّ بتيليجرام |
| 13 | `consume_admin_login_code()` — SQL | حدّ دخولٍ خارجيٌّ (إدارة) | نعم — `where telegram_id = p_telegram_id` | نعم — يُحمِّلُ `users%rowtype` | `null` → `USER_NOT_FOUND` | **remaining dependency** — كالسابق، مسارُ `SEC-21` | |
| 14 | `erase_my_account()` — SQL | حلٌّ انتقاليٌّ | نعم — `select * from users where telegram_id = p_telegram_id for update` | نعم — يحمِّلُ `v_user` ويستعملُ `v_user.id` في كلِّ الحذوفات | `null` → `INVALID_ACTOR` (حارسٌ صريح) | **cleared** — يكتبُ `telegram_id = null` (SEC-19 بندُ ٥) | الحارسُ `if p_telegram_id is null` يرفضُهُ قبلَ كلِّ شيء |
| 15 | `export_my_data()` — SQL | حلٌّ انتقاليٌّ | نعم — `select * from users where telegram_id = p_telegram_id` | نعم — يحمِّلُ `v_user` ويستعملُ `v_user.id` | `null` → `INVALID_ACTOR` | **cleared** | |
| 16 | `issue_tracking_token()` — SQL | حلٌّ انتقاليٌّ | نعم — `p_telegram_id` وسيطٌ | نعم — يحمِّلُ `v_owner_id` من `users.id` | `null` → `p_telegram_id is null` حارسٌ صريح | **cleared** | `SEC-19` بندُ ٣: `created_by_user_id` يُعبَّأُ من `users.id` |
| 17 | `revoke_tracking_token()` — SQL | حلٌّ انتقاليٌّ | نعم — `p_telegram_id` وسيطٌ | نعم — `select u.id into v_actor_id from users u where u.telegram_id = p_telegram_id` | `null` → لا مستخدمَ → لا رمزَ | **cleared** | يطابقُ بـ`created_by_user_id` أو `created_by` (تراثيٌّ) |
| 18 | `revoke_order_tracking_tokens()` — SQL | حلٌّ انتقاليٌّ | نعم — `p_telegram_id` وسيطٌ | نعم — `select u.id into v_actor_id` | `null` → حارسٌ صريح | **cleared** | |
| 19 | `get_user_notifications()` — SQL (غلافٌ) | حلٌّ انتقاليٌّ | نعم — `select u.id from users u where u.telegram_id = p_telegram_id` | نعم — يُفوِّضُ إلى `get_user_notifications_by_user_id(v_user, …)` | `null` → `USER_NOT_FOUND` | **cleared** | `SEC-19` بندُ «ب-١»: المركزُ يُكتَبُ بـ`users.id` والغلافُ يُفوِّض |
| 20 | `claim_notification_delivery()` — SQL | رابطُ تسليمٍ | يقرأُ `u.telegram_id::text` لبناءِ عنوانِ التسليم | لا — يُرسلُ إلى تيليجرام | `null` → `String(null)` → حرسُ TypeScript يُعلِنُ `undeliverable` | **cleared** — مسارُ تسليمٍ صرفٌ، محصَّنٌ بـ`SEC-19` بندُ «ب-٣/ب-٤» | |
| 21 | `subscriptions_expiring_soon()` — SQL | رابطُ تسليمٍ | يقرأُ `u.telegram_id` لبناءِ عنوانِ الإشعار | لا — يُرسلُ إلى تيليجرام | `null` → الإشعارُ لا يُرسَل (السائقُ المحجوبُ مُستبعَدٌ بـ`is_blocked = false`) | **cleared** — مُصفّى بـ`is_blocked = false`، والمُجهَّلُ محجوبٌ | |
| 22 | `telegram-driver-notifier.ts:57` | رابطُ تسليمٍ | يقرأُ `u.telegram_id` من `users` | لا — يُرسلُ إلى تيليجرام | `null` → حرسُ `String(null)` يرمي `TELEGRAM_DELIVERY_UNAVAILABLE` | **cleared** | `SEC-19` بندُ «ب-٤» |
| 23 | `rating-adapters.ts:37` — `party()` | رابطُ تسليمٍ | يقرأُ `telegram_id` من صفٍّ | لا — يُمرِّرُهُ للتسليم | `null` → `String(null)` → `""` | **legacy-safe** — يُستعمَلُ في الإشعارِ فقط | |
| 24 | `lifecycle-adapters.ts:37` | رابطُ تسليمٍ | يقرأُ `telegram_id` من `subscriptions_expiring_soon` | لا — للتسليم | `null` → `String(null)` → لكنَّ المُصفّي `is_blocked = false` يَستبعدُ المُجهَّلين | **legacy-safe** | |
| 25 | `support-adapters.ts:125` | رابطُ تسليمٍ | يقرأُ `telegram_id` من `notification_outbox` | لا — للتسليم | `null` → `String(null)` → `""` | **legacy-safe** | |
| 26 | `admin-ui.ts:465` — `POST /login/code` | حدّ دخولٍ خارجيٌّ (إدارة) | نعم — `telegramId` من النموذج | نعم — `issue_admin_login_code` يحمِّلُ `users.id` | `null` → `USER_NOT_FOUND` | **remaining dependency** — مسارُ `SEC-21` | الرمزُ يُرسَلُ على تيليجرام |
| 27 | `admin-ui.ts:1204` — `readUserTelegramId` | رابطُ تسليمٍ | يقرأُ `telegram_id` من `users where id = $1` | لا — للتسليم (إشعارُ إبطالِ الجلسة) | `null` → `null` → لا إرسال | **cleared** — يقرأُ بالهويّةِ الداخليّةِ ويستعملُ `telegram_id` للتسليمِ وحدَه | |
| 28 | `pdpl_data_subject_requests.requester_telegram_id` | حدّ دخولٍ خارجيٌّ | نعم — عمودٌ في جدولٍ | لا — يُخزِّنُ المُعرِّفَ المُقدَّمَ من المستخدم | `null` → غيرُ مسموحٍ (`not null` على العمود) | **remaining dependency** — جدولُ طلباتِ PDPL يخزِّنُ `telegram_id` كهويّةٍ للطالب. لكنَّهُ نادرٌ (طلباتُ استردادٍ) وليسَ مسارَ إنتاجٍ متكرِّر | `SEC-20` (مسارُ الاسترداد) سيعالجُ هذا |
| 29 | `trip_tracking_tokens.created_by bigint` | أثرٌ تراثيٌّ غيرُ نافذٍ | نعم — عمودٌ باقٍ | نعم — `created_by_user_id uuid` يُستعمَلُ في المطابقةِ أولاً، و`created_by` تراثيٌّ يُسقَطُ عليه | `null` → `created_by_user_id` هو المطابقُ الأوّل | **legacy-safe** — `SEC-19` بندُ ٣ أضافَ `created_by_user_id`؛ و`created_by` يُستعمَلُ في `or` للصفوفِ القديمةِ فقط | |
| 30 | `broadcast_recipients.n` / `notification_outbox.chat_id` | رابطُ تسليمٍ | لا — يخزِّنُ `chat_id` لا `telegram_id` | لا | غيرُ ذي صلة | **legacy-safe** — `erase_my_account` يكتبُ `v_sentinel` (سالِبٌ) لا `null` (قيدُ `n <> 0`) | أثرٌ تراثيٌّ من قبلَ `SEC-19` |

### ٢-٢. الإحصاءُ الإجماليُّ

| الحكمُ | العددُ |
|---|---|
| **cleared** (حدُّ دخولٍ أو حلٌّ انتقاليٌّ يحوّلُ إلى `users.id`) | ١٨ |
| **legacy-safe** (أثرٌ تراثيٌّ أو رابطُ تسليمٍ محصَّن) | ٦ |
| **remaining dependency** (مسارٌ يعتمدُ على `telegram_id` كهويّةٍ، سيعالجُهُ `SEC-20`/`SEC-21`) | ٤ |
| **المجموع** | ٢٨ |

---

## ٣. التبعاتُ الباقية (remaining dependencies)

### ٣-١. مسارُ الدخولِ الإداريِّ (SEC-21)

**المساران:** `issue_admin_login_code()` و`consume_admin_login_code()` و`POST /admin/login/code` و`POST /admin/login/verify`.

**كيف يعمل:** المسؤولُ يُدخِلُ `telegram_id` في نموذجِ الدخول. تُصدِّرُ القاعدةُ رمزًا ويُرسَلُ على تيليجرام. المسؤولُ يُدخِلُ الرمزَ فتُستهلَكُ القاعدةُ الرمزَ وتفتحُ جلسةً.

**لماذا يبقى:** هذا المسارُ يعتمدُ على تيليجرام كهويّةٍ إداريّةٍ كاملةٍ — لا بديلَ ولا عاملٌ ثانٍ. و`SEC-21` صُمِّمَت خصيصًا لمعالجةِ هذا: «بابُ دخولٍ إداريٍّ لا يمرُّ بتيليجرام، بعاملٍ ثانٍ مستقلٍّ وسجلِّ تدقيقٍ».

**الحكم:** هذا هو نطاقُ `SEC-21` بعينه. لا يُفتَحُ قبلَها.

### ٣-٢. مسارُ استردادِ الحساب (SEC-20)

**المسار:** `pdpl_data_subject_requests.requester_telegram_id` — جدولُ طلباتِ حقوقِ الموضوعِ (PDPL).

**كيف يعمل:** المستخدمُ يُقدِّمُ `telegram_id` لطلبِ تصديرٍ أو محوٍ أو استرداد. ويُخزَّنُ `telegram_id` في العمود `requester_telegram_id text not null`.

**لماذا يبقى:** لو فُقِدَ حسابُ تيليجرام، فلا مسارَ لربطِ الطلبِ بالمستخدم. و`SEC-20` صُمِّمَت لمعالجةِ هذا: «مسارُ استردادٍ بمراجعةٍ إداريّةٍ صريحةٍ وسجلِّ قرارٍ كاملٍ».

**الحكم:** هذا هو نطاقُ `SEC-20`. لا يُفتَحُ قبلَها.

### ٣-٣. ما ليسَ تبعّةً

- **حدُّ الدخولِ العاديُّ (initData):** يعتمدُ على `telegram_id` من تيليجرام، وهذا مقبولٌ مؤقَّتًا لأنَّ تيليجرام هو المزوِّدُ الوحيدُ للهويّةِ قبلَ `ARCH-014` (الذي يطلبُ مدخلَ هويّةٍ ثانٍ بـ`users.id`). و`SEC-20`/`SEC-21` لا تعالجانِ هذا — ذاكَ `ARCH-014`.
- **مسالكُ التسليم:** كلُّها إمّا محصَّنةٌ بـ`SEC-19` (حرسُ `String(null)` و`undeliverable`) أو مُصفّاةٌ بـ`is_blocked = false` (والمُجهَّلُ محجوبٌ). لا تبعّةَ هنا.

---

## ٤. الخلاصة

**لا يوجدُ استعمالٌ دائمٌ لـ`telegram_id` كمفتاحِ مِلكيّةٍ داخليٍّ أو علاقةٍ إنتاجيّةٍ بعدَ `SEC-19`.**

كلُّ مسارٍ إنتاجيٍّ داخليٍّ إمّا:

1. **يحوّلُ إلى `users.id` فورًا** (٢٠ دالّةً SQL و١٧ ملفَّ TypeScript — كلُّها «حلٌّ انتقاليٌّ» أو «حدُّ دخولٍ خارجيٌّ»)، أو
2. **هو تسليمٌ محصَّنٌ** (٧ مسارات — كلُّها «legacy-safe» أو «رابطُ تسليمٍ»).

والمتبقّي (٥ مسارات) هو نطاقُ `SEC-20`/`SEC-21` بعينه:

- مسارُ الدخولِ الإداريِّ (SEC-21): `issue_admin_login_code` و`consume_admin_login_code` و`open_admin_session` + `admin-ui.ts` و`admin/auth.ts`
- جدولُ طلباتِ PDPL (SEC-20): `pdpl_data_subject_requests.requester_telegram_id`

**الحدودُ الخارجيّةُ (initData، البوتات)** ما زالت تستعملُ `telegram_id` كمقبضِ الممثّلِ الخارجيِّ إلى أن يُحلَّ بـ`users.id` — وهذا مقبولٌ مؤقَّتًا لأنَّ تيليجرام هو المزوِّدُ الوحيدُ للهويّةِ قبلَ `ARCH-014`.

**وهذا يفتحُ البابَ أمامَ `SEC-20`/`SEC-21`** بلا عائقٍ بنيويٍّ من `telegram_id` كهويّةٍ داخليةٍ.

---

## ٥. ما لا يُدَّعى (`ح-5`)

- هذا تدقيقٌ ساكنٌ — قراءةُ شيفرةٍ لا تشغيلٌ. ولا يُدَّعى أنَّ كلَّ مسارٍ قِيسَ أمامَ `null` حيٍّ.
- `ARCH-014` **لا يُستوفى** بهذا التدقيق: يلزمُه مدخلُ هويّةٍ ثانٍ بـ`users.id`، وهو بندٌ مستقلٌّ.
- التدقيقُ لا يُثبتُ أنَّ `SEC-20`/`SEC-21` آمنتانِ — يُثبتُ فقط أنَّ لا مسارَ داخليًّا يعتمدُ على `telegram_id` كهويّةٍ يمنعُ فتحَهما.
- الأرقامُ في الإحصاءِ قد تختلفُ عن جردي السابق (الذي عدَّ ٨٨ دالّةً و٩٤ موضعَ حلٍّ و٤٥ موضعَ قراءة) لأنَّ هذا التدقيقَ يصنِّفُ المساراتِ لا المواضعَ — مسارٌ واحدٌ قد يحوي مواضعَ متعدِّدةً.

---

## ٦. الملحقُ — الجردُ الخامُّ الكاملُ (إضافةٌ توثيقيّةٌ)

### ٦-١. دوالُّ SQL الآخذةُ `p_telegram_id` — الجردُ الكاملُ

كلُّ دالّةٍ تأخذُ `p_telegram_id bigint` وسيطًا، مع نوعِ الحلِّ والحكمِ:

| # | الدالّةُ | نوعُ الحلِّ | كيف تُحلِّلُ `p_telegram_id` | الحكمُ | الملاحظاتُ |
|---|---|---|---|---|---|
| ١ | `grant_bootstrap_admin()` | حدٌّ خارجيٌّ | `select * into v_user from users where telegram_id = p_telegram_id for update` | **cleared** | أداةُ إقلاعٍ نادرةٌ، ليست مسارَ إنتاجٍ متكرِّر |
| ٢ | `is_support_actor()` | حلٌّ انتقاليٌّ | `select * into v_user from users where telegram_id = p_telegram_id` | **cleared** | يُعيدُ `user_id` و`is_blocked` |
| ٣ | `get_reputation_summary()` | حلٌّ انتقاليٌّ | `select * into v_user from users where telegram_id = p_telegram_id` | **cleared** | يستعملُ `v_user.id` في كلِّ ما يليه |
| ٤ | `get_user_language()` | حلٌّ انتقاليٌّ | `select * into v_user from users where telegram_id = p_telegram_id` | **cleared** | يقرأُ `language_code` من `v_user` |
| ٥ | `list_user_consents()` | حلٌّ انتقاليٌّ | `join users u ... where u.telegram_id = p_telegram_id` | **cleared** | يطابقُ بـ`u.id = c.user_id` |
| ٦ | `list_saved_places()` | حلٌّ انتقاليٌّ | `join users u on u.id = p.user_id where u.telegram_id = p_telegram_id` | **cleared** | |
| ٧ | `list_recent_destinations()` | حلٌّ انتقاليٌّ | `where u.telegram_id = p_telegram_id` | **cleared** | |
| ٨ | `rider_ride_history()` | حلٌّ انتقاليٌّ | `select u.id, u.city_id into v_user_id from users u where u.telegram_id = p_telegram_id` | **cleared** | النموذجُ الكاملُ: `p_telegram_id` → `users.id` → بقيةُ المنطق |
| ٩ | `rider_ride_detail()` | حلٌّ انتقاليٌّ | `select u.id into v_user_id from users u where u.telegram_id = p_telegram_id` | **cleared** | |
| ١٠ | `driver_document_dashboard()` | حلٌّ انتقاليٌّ | `select * into v_user from users where telegram_id = p_telegram_id` | **cleared** | |
| ١١ | `submit_driver_documents_for_review()` | حلٌّ انتقاليٌّ | `select * into v_user from users where telegram_id = p_telegram_id` | **cleared** | |
| ١٢ | `driver_offer_board()` | حلٌّ انتقاليٌّ | `select * into v_user from users where telegram_id = p_telegram_id` | **cleared** | |
| ١٣ | `driver_active_job()` | حلٌّ انتقاليٌّ | `select * into v_user from users where telegram_id = p_telegram_id` | **cleared** | |
| ١٤ | `driver_subscription_dashboard()` | حلٌّ انتقاليٌّ | `select * into v_user from users where telegram_id = p_telegram_id` | **cleared** | |
| ١٥ | `erase_my_account()` | حلٌّ انتقاليٌّ | `select * into v_user from users where telegram_id = p_telegram_id for update` | **cleared** | حارسٌ صريحٌ `if p_telegram_id is null`؛ يكتبُ `telegram_id = null` (SEC-19) |
| ١٦ | `export_my_data()` | حلٌّ انتقاليٌّ | `select * into v_user from users where telegram_id = p_telegram_id` | **cleared** | حارسٌ صريحٌ |
| ١٧ | `issue_tracking_token()` | حلٌّ انتقاليٌّ | `p_telegram_id` وسيطٌ، يُحمِّلُ `v_owner_id` من `users.id` | **cleared** | `SEC-19` بندُ ٣: `created_by_user_id` من `users.id` |
| ١٨ | `revoke_tracking_token()` | حلٌّ انتقاليٌّ | `select u.id into v_actor_id from users u where u.telegram_id = p_telegram_id` | **cleared** | يطابقُ بـ`created_by_user_id` أو `created_by` (تراثيٌّ) |
| ١٩ | `revoke_order_tracking_tokens()` | حلٌّ انتقاليٌّ | `select u.id into v_actor_id from users u where u.telegram_id = p_telegram_id` | **cleared** | |
| ٢٠ | `get_user_notifications()` (غلافٌ) | حلٌّ انتقاليٌّ | `select u.id into v_user from users u where u.telegram_id = p_telegram_id` | **cleared** | يُفوِّضُ إلى `get_user_notifications_by_user_id(v_user, …)` |
| ٢١ | `issue_admin_login_code()` | حدٌّ خارجيٌّ (إدارة) | `select * into v_user from users where telegram_id = p_telegram_id` | **remaining dependency** | **مسارُ `SEC-21`**: الرمزُ يُرسَلُ على تيليجرام |
| ٢٢ | `consume_admin_login_code()` | حدٌّ خارجيٌّ (إدارة) | `where telegram_id = p_telegram_id` | **remaining dependency** | **مسارُ `SEC-21`** |
| ٢٣ | `open_admin_session()` | حدٌّ خارجيٌّ (إدارة) | يأخذُ `p_telegram_id` وسيطًا | **remaining dependency** | **مسارُ `SEC-21`** |
| ٢٤ | `subscriptions_expiring_soon()` | رابطُ تسليمٍ | يقرأُ `u.telegram_id` للإشعار، مُصفّى بـ`is_blocked = false` | **cleared** | المُجهَّلُ محجوبٌ |

### ٦-٢. ملفّات TypeScript الإنتاجيّةُ التي تمرِّرُ `telegramId`/`telegramUserId` إلى RPC

| # | الملفُ | الدالّةُ المستدعاةُ | الحكمُ | الملاحظاتُ |
|---|---|---|---|---|
| ١ | `consent-store.ts` | `list_user_consents($1::bigint)` · `record_user_consent($1::bigint, …)` | **cleared** | حلٌّ انتقاليٌّ في SQL؛ `asTelegramId` يرفضُ غيرَ الرقميِّ |
| ٢ | `places-store.ts` | `list_saved_places($1::bigint)` · `save_place($1::bigint, …)` · `list_recent_destinations($1::bigint)` | **cleared** | كالسابق |
| ٣ | `data-rights-store.ts` | `export_my_data($1::bigint)` · `erase_my_account($1::bigint)` | **cleared** | حارسٌ صريحٌ `if telegramId === null` |
| ٤ | `driver-job-store.ts` | `driver_active_job($1::bigint)` · `driver_mark_arrived($1::bigint, …)` · `driver_start_ride($1::bigint, …)` | **cleared** | حلٌّ انتقاليٌّ في SQL |
| ٥ | `driver-documents-store.ts` | `driver_document_dashboard($1::bigint)` · `submit_driver_documents_for_review($1::bigint, …)` | **cleared** | |
| ٦ | `driver-offers-store.ts` | `driver_offer_board($1::bigint, …)` | **cleared** | |
| ٧ | `driver-subscription-store.ts` | `driver_subscription_dashboard($1::bigint)` | **cleared** | |
| ٨ | `driver-vehicle-store.ts` | دوالُّ إدارةِ المركبةِ بـ`$1::bigint` | **cleared** | |
| ٩ | `driver-activity-store.ts` | دوالُّ نشاطِ السائقِ بـ`$1::bigint` | **cleared** | |
| ١٠ | `subscription-invoice-store.ts` | دوالُّ الفواتيرِ بـ`$1::bigint` | **cleared** | |
| ١١ | `rider-support-store.ts` | دوالُّ تذاكرِ الراكبِ بـ`$1::bigint` | **cleared** | |
| ١٢ | `driver-support-store.ts` | دوالُّ تذاكرِ السائقِ بـ`$1::bigint` | **cleared** | |
| ١٣ | `tracking-token-adapters.ts` | `issue_tracking_token(…, $1::bigint, …)` · `revoke_tracking_token(…, $1::bigint)` | **cleared** | `SEC-19` بندُ ٣: `created_by_user_id` |
| ١٤ | `viewer-account.ts` | `select role, is_blocked from users where telegram_id = $1` | **cleared** | حلٌّ انتقاليٌّ: يُعيدُ `role` و`is_blocked` فقط |
| ١٥ | `directories.ts` | `findByTelegramId` (سائق/راكب) — `where u.telegram_id = $1` | **cleared** | `join users u on u.id = d.user_id` |
| ١٦ | `bootstrap-admin.ts` | `grant_bootstrap_admin($1::bigint)` | **cleared** | أداةُ إقلاعٍ نادرةٌ |
| ١٧ | `language-adapters.ts` | `get_user_language($1::bigint)` · `set_user_language($1::bigint, …)` | **cleared** | |
| ١٨ | `rating-adapters.ts` | يقرأُ `telegram_id` من صفٍّ للتسليمِ (`String(row.telegram_id)`) | **legacy-safe** | تسليمٌ صرفٌ |
| ١٩ | `lifecycle-adapters.ts` | يقرأُ `telegram_id` من `subscriptions_expiring_soon` للتسليمِ | **legacy-safe** | مُصفّى بـ`is_blocked = false` |
| ٢٠ | `support-adapters.ts` | يقرأُ `telegram_id` من `notification_outbox` للتسليمِ | **legacy-safe** | تسليمٌ صرفٌ |
| ٢١ | `telegram-driver-notifier.ts` | يقرأُ `u.telegram_id` من `users` للتسليمِ | **cleared** | حرسُ `String(null)` من `SEC-19` بندُ «ب-٤» |
| ٢٢ | `admin/auth.ts` | `issue_admin_login_code($1::bigint, …)` · `consume_admin_login_code($1::bigint, …)` | **remaining dependency** | **مسارُ `SEC-21`** |
| ٢٣ | `admin/queries.ts` | `readUserTelegramId` — يقرأُ `telegram_id` من `users where id = $1::uuid` | **cleared** | يقرأُ بالهويّةِ الداخليّةِ، يستعملُ `telegram_id` للتسليمِ وحدَه |
| ٢٤ | `admin-ui.ts` | `POST /login/code` · `POST /login/verify` — `telegramId` من النموذجِ | **remaining dependency** | **مسارُ `SEC-21`** |

### ٦-٣. ملفّات TypeScript التي تقرأُ `telegram_id` من نتائجَ استعلامٍ (للتسليمِ أو للعرضِ)

| # | الملفُ | الغرضُ | الحكمُ |
|---|---|---|---|
| ١ | `dispatch-adapters.ts` | قراءةُ `telegram_id` للعرضِ في لوحةِ الإدارةِ | **legacy-safe** — عرضٌ لا هويّةٌ |
| ٢ | `negotiation-adapters.ts` | قراءةُ `telegram_id` للتسليمِ | **legacy-safe** |
| ٣ | `unmatched-adapters.ts` | قراءةُ `telegram_id` للتسليمِ (مُصفّى بـ`status = 'searching'`) | **legacy-safe** — المُجهَّلُ عندهُ `cancelled` |
| ٤ | `tracking-queries.ts` | قراءةُ `telegram_id` للعرضِ في لوحةِ الإدارةِ | **legacy-safe** |
| ٥ | `notification/user-notification-center.ts` | يُرسلُ `telegramId::bigint` إلى `get_user_notifications` (الغلافُ الانتقاليُّ) | **cleared** — الغلافُ يُفوِّضُ إلى `by_user_id` |

### ٦-٤. جداولُ قاعدةِ البياناتِ التي تخزِّنُ `telegram_id`

| # | الجدولُ | العمودُ | النوعُ | الحكمُ |
|---|---|---|---|---|
| ١ | `users` | `telegram_id` | `bigint` (كانَ `not null`، صارَ `null` بعدَ `SEC-19`) | **cleared** — العمودُ نفسُهُ هويّةُ الدخولِ الخارجيّةُ، لا مفتاحٌ أساسيٌّ |
| ٢ | `pdpl_data_subject_requests` | `requester_telegram_id` | `text not null` | **remaining dependency** — **نطاقُ `SEC-20`**: مسارُ الاستردادِ |
| ٣ | `trip_tracking_tokens` | `created_by` | `bigint not null` (تراثيٌّ) | **legacy-safe** — `created_by_user_id uuid` هو المطابقُ الأوّلُ (`SEC-19` بندُ ٣) |
| ٤ | `notification_outbox` | `chat_id` (عنوانُ تسليمٍ) | `bigint` (يأخذُ `v_sentinel` لا `null`) | **legacy-safe** — قيدُ `n <> 0` يَمنعُ `null` |
| ٥ | `broadcast_recipients` | `n` (عنوانُ تسليمٍ) | `bigint` (يأخذُ `v_sentinel` لا `null`) | **legacy-safe** — كالسابق |
