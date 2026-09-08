# ADR-0061 — صندوقُ الصادرِ الموحَّدُ لكلِّ التسليمات (F6-03 / BUG-004)

- **الحالة**: مقبول — `F6-03` (القسم 6 «دورةُ الطلبِ» — «صندوقُ معاملاتيّ موحّد (BUG-004)»).
- **يبني على**: ADR-0036 (القفلُ الموزَّعُ عبر claim_token)، ADR-0038 (الانحصارُ في الصفِّ الواحد عبر `for update skip locked` + الذرّيّةُ في PostgreSQL)، ADR-0047 (سجلُّ مساراتِ العودة)، ADR-0056 (قابليّةُ تقلُّبِ إعدادِ `pooler`).
- **يُلغي جزءًا من**: انتشارِ صناديقِ الصادرِ الأربعةِ المُتخصِّصةِ — `safety_incident_deliveries` و`subscription_notices` و`broadcast_recipients` — كأنّ كلَّ واحدٍ منها مصدرُ الحقيقةِ لعرضِه. تبقى `notification_outbox` هي المصدرَ الوحيدَ.

## السياق

كان في المنصّةِ أربعةُ صناديقِ صادرٍ منفصلةٍ لكلٍّ منها جدولُهُ و`claim`/`finish` خاصُّه:

1. `notification_outbox` — صارَ موحَّدًا تدريجيًّا (عبر الهجراتِ `20260905…`–`20260906…`) لأنواعِ دورةِ الرحلةِ (offer، dispute_resolution، negotiation، unmatched، cancellation) بدالَّةِ `enqueue_notification` و`claim_notification_delivery` و`finish_notification_delivery`. الإثراءُ حيٌّ من `orders`/`users`.
2. `safety_incident_deliveries` — claimُ صفٍّ واحدٍ، `message_id bigint`، بلا حالةِ فشلٍ نهائيّةٍ (يعيدُ المحاولةَ إلى الأبد)، يُودَعُ صفُّه مباشرةً في `trigger_sos` (لا enqueue)، ويُثريهُ `claim_safety_incident_delivery` حيًّا من `safety_incidents`+`orders`+`cities`.
3. `subscription_notices` — claimُ دفعةٍ لكلِّ مدينةٍ بـtokenٍ مشترك، `message_id bigint`، حالةُ `failed`، يُثبتُ `chat_id`+`language_code` لحظةَ الإنشاء، وإيداعُه بـ`enqueue_subscription_notice`، و`claim_subscription_notices`/`finish_subscription_notice`.
4. `broadcast_recipients` — claimُ دفعةٍ لكلِّ مدينةٍ، `message_id bigint`، حالتا `failed`/`canceled`، يُثبتُ `chat_id`+`language_code` لحظةَ الإنشاء، و`create_broadcast` يُودعُ الصفوفَ، و`claim_broadcast_recipients`/`finish_broadcast_delivery`/`cancel_broadcast`، وآثارُ إكمالِ الحملةِ جانبيّةً.

نصُّ `F6-03`: «صندوقُ معاملاتيّ موحّد (BUG-004)» — والمعيارُ الذي لا يُفلِتُ: «موحّد» يجبُ أن يكونَ **ظاهرًا في القاعدةِ** لا في TypeScript وحدَه. إن بقيت أيُّ من الجداولِ الثلاثةِ مصدرَ الحقيقةِ لعرضِ التسليمِ، فلا يُغلَقُ `F6-03`.

## القرار

تتمدَّدُ `notification_outbox` لتكونَ **صندوقَ الصادرِ الوحيدَ** لكلِّ التسليماتِ. تنتقلُ حالةُ التسليمِ للأنواعِ الثلاثةِ الباقيةِ إلى `notification_outbox`، وتُصبحُ دوالُ `claim`/`finish` القديمةُ أغلفةً رفيقةً (compatibility wrappers) تقرأُ وتكتبُ `notification_outbox`. هذا نهجُ **التوسيعِ ثمّ التقليصِ** (expand-then-contract): الهجرةُ الأولى تُضيفُ الأنواعَ والأعمدةَ والأغلفةَ دونَ أن تكسرَ المنتجينَ أو العاملَ أو الاختباراتِ، وهجرةٌ لاحقةٌ تُسقطُ الجداولَ القديمةَ بعدَ استقرارِ التسليمِ من المصدرِ الموحَّد.

### ١. أنواعٌ جديدةٌ في `notification_outbox`

`kind in (…, 'safety_incident', 'subscription_notice', 'broadcast_recipient')`. والمفتاحُ الإلزاميُّ `(kind, dedup_key)` يُحفظُ التفريدَ لكلِّ نوع:
- `safety_incident` — `dedup_key = 'safety_incident:'||incident_id`.
- `subscription_notice` — `dedup_key = 'subscription:'||subscription_id||':'||kind` (kind = renewal_notice|expiring_soon|inactive_warning|expired_confirmation).
- `broadcast_recipient` — `dedup_key = 'broadcast:'||campaign_id||':'||user_id`.

### ٢. أعمدةٌ جديدة

- `recipient_user_id uuid` — المُستلِمُ المستهدفُ (السائقُ للعرضِ، الراكبُ للإخطارِ، المشتركُ للإشعار، المستلمُ للبثّ). مرجعٌ إلى `users`. فارغٌ للأنواعِ التي تُثرى حيًّا ولا تعرفُ المُستلِمَ عندَ الإيداعِ (offer).
- `chat_id bigint` و`language_code text` — مُلتقطانِ لحظةَ الإيداعِ لأنواعِ الاشتراكِ والبثّ (قرارٌ قائمٌ: `users` لا يَعدِمُ `notifications`; الإذنُ مُقطَّعٌ في `authz.acl_for(...)`؛ يُلتقطُ البديلُ الأرخصُ وهو `chat_id`+`language_code` لا نسخةٌ من `users`). فارغانِ للأنواعِ التي تُثرى حيًّا (offer، safety).
- `error_code text` — رمزُ الفشلِ الدائمِ (للأنواعِ التي تقبلُه: subscription، broadcast). `finish_notification_delivery` تُوسَّعُ لتقبُّلِه.

### ٣. حالاتٌ موحَّدة

`status in ('pending','sending','delivered','dead','failed','canceled')`. خريطةُ الحالاتِ القديمة:
- safety: `pending`/`sending`/`delivered` كما هي؛ لا `dead` (يعيدُ المحاولةَ بلا سقفٍ — يُحفَظُ هذا السلوكُ لأنّ الاستغاثةَ لا تُترَك).
- subscription: `failed` تُحفَظُ (فشلٌ دائمٌ برمزٍ).
- broadcast: `failed`/`canceled` تُحفَظانِ.

### ٤. المُنتجون يُودعون في `notification_outbox`

- `trigger_sos` ينتهي إلى `enqueue_notification(city_id,'safety_incident',payload,'safety_incident:'||v_incident_id)` بدلَ `insert into safety_incident_deliveries`. يبقى `for update` على `safety_incidents` و`orders` و`riders`/`users` ويُولِّدُ `v_reporter_user_id` و`v_reporter_role` كما هو.
- `enqueue_subscription_notice` يصيرُ إيداعًا في `notification_outbox` بـ`dedup_key` أعلاه ويُلتقطُ `chat_id`+`language_code`.
- `create_broadcast` يُودعُ صفوفَ `broadcast_recipient` في `notification_outbox` ويُلتقطُ `chat_id`+`language_code` ويُولِّدُ `campaign_batch_id`.

### ٥. الأغلفةُ التوافقيةُ (لا تُجبِرُ دالّةَ claimَ واحدة)

- `claim_notification_delivery()` تُوسَّعُ بفرعٍ لكلِّ نوعٍ جديدٍ يُثريهُ حيًّا من المصدرِ المناسبِ (safety: `safety_incidents`+`orders`+`cities`+`riders`/`users`).
- `claim_safety_incident_delivery()` → غلافٌ يدعو `claim_notification_delivery` ويُعيدُ التأجيلَ `ESCALATION_GROUP_MISSING` كما هو (الصفُّ يبقى pending بلا استهلاكِ محاولةٍ — سلوكُ «الصفُّ السامّ» محفوظٌ).
- `claim_subscription_notices(city_id)` و`claim_broadcast_recipients(city_id)` → أغلفةٌ تطالبُ بدفعةٍ لكلِّ مدينةٍ بـ`batch_claim_token` مشتركٍ على `notification_outbox` مع `skip locked` وعزلِ المدينة. حقيقةُ الدفعةِ تبقى في القاعدةِ لا في `runner` (الردُّ على نقدِ ADR-0047).
- دوالُ `finish_*` القديمةُ → أغلفةٌ تدعو `finish_notification_delivery` (مع `message_id bigint::text` لأنّ العمودَ الموحَّدَ `text`).
- `cancel_broadcast(actor,batch_id)` → غلافٌ يُلغي صفوفَ `broadcast_recipient` الموحَّدةَ بـ`campaign_batch_id`.

### ٦. `message_id` نصٌّ

`delivered_message_id text` (كما هو في `notification_outbox`) — لا `bigint`. الأغلفةُ تُمرِّرُ `message_id bigint::text`. لا تتشقَّقُ واجهةُ العاملِ ولا اختباراتُه.

### ٧. الحوكمةُ والقيود

- **ح-1**: لا يُغيَّرُ نصُّ `F6-03` ولا معاييرُ قبوله.
- **ح-5**: لا «مُثبَتٌ» لشيءٍ لم يُقَسْ في بيئةٍ شبيهةٍ بالإنتاجِ. التسليمُ يُختبرُ على PostgreSQL حقيقيّةٍ (محليّةٌ)؛ الإنتاجُ غيرُ مُقاسٍ.
- **ح-6**: هذا الـADR متطلَّبٌ قبلَ أيِّ هجرةٍ، وهُنا يُسجَّل.
- **مسارُ العودة**: التوسيعُ أوّلًا (`expand`) — إضافةُ أنواعٍ وأعمدةٍ وأغلفةٍ لا تكسرُ ما كان يعمل. التقليصُ (`contract` — إسقاطُ الجداولِ القديمةِ) في هجرةٍ لاحقةٍ بعدَ استقرارِ التسليمِ من المصدرِ الموحَّد. `coupledDeploy: true` للهجرتَين: الشيفرةُ تُودِعُ وتقرأُ `notification_outbox` فلا يُنشَرُ أحدُهما دونَ الآخر.

## ما فُحص فعلاً، وحكمُ كلٍّ منه

### ١. جدولٌ موحَّدٌ جديدٌ (`delivery_outbox`) — **مرفوضٌ**

إنشاءُ جدولٍ جديدٍ يُضيفُ هجرةً وفهرسًا وقيودًا، ويُنتجُ صندوقَينِ «موحَّدَينِ» (الجديدُ و`notification_outbox` القائمةُ التي بدأَتْ في توحيدِ أنواعِ دورةِ الرحلةِ)، فيُضاعِفُ عبءَ الترحيلِ. والمستودعُ اختارَ بالفعلِ `notification_outbox` كصندوقِ التوحيدِ عبر `enqueue_notification`/`claim_notification_delivery` — فالتمدُّدُ في الاتجاهِ الذي اختارهُ المستودعُ أرخصُ وأصدقُ لـ«موحّد».

### ٢. إرغامُ دالّةِ claimَ واحدة — **مرفوضٌ**

الأنواعُ الأربعةُ لها قيودُ claim مختلفةٌ جوهريًّا: offer وsafety يطالبانِ صفًّا واحدًا بـtokenٍ فردٍ؛ subscription وbroadcast يطالبانِ دفعةً لكلِّ مدينةٍ بـtokenٍ مشتركٍ. إرغامُها على دالّةٍ واحدةٍ يُلغي عزلَ المدينةِ ويُكسِرُ سلوكَ «الصفُّ السامّ» في safety. الأغلفةُ التوافقيةُ تحفظُ كلَّ قيدٍ في مكانهِ وتُوحِّدُ مصدرَ الحقيقةِ (القاعدة) دونَ إرغامِ الواجهة.

### ٣. إبقاءُ الجداولِ القديمةِ كمرايا — **مرفوضٌ**

إبقاءُ `safety_incident_deliveries` و`subscription_notices` و`broadcast_recipients` كمرايا لـ`notification_outbox` يُنتجُ مصدرَينِ للحقيقةِ يتوافقانِ بالنّسخِ لا بالقراءةِ، فلا يظهرُ «موحّدٌ» في القاعدة. معيارُ `F6-03` صريحٌ: المصدرُ الواحدُ لا المرايا.

### ٤. التمدُّدُ في `notification_outbox` مع أغلفةٍ — **مقبولٌ (المُعتمَد)**

الجدولُ الذي اختارَهُ المستودعُ بالفعلِ يصيرُ الصندوقَ الوحيدَ. التوسيعُ لا يكسرُ: المُنتجونَ يُحدَّثونَ للإيداعِ في `notification_outbox`، والعاملُ والاختباراتُ ترى الأغلفةَ بنفسِ الأسماءِ فلا تنكسرُ دفعةً واحدةً. والتقليصُ لاحقًا. وهو يُحقّقُ معيارَ «موحّدٌ ظاهرٌ في القاعدة» مباشرةً.

## العواقب

- **مصدرُ حقيقةٍ واحدٌ**: حالةُ التسليمِ لكلِّ الأنواعِ في `notification_outbox` لا في أربعةِ جداولَ.
- **توافقٌ تدريجيٌّ**: الأغلفةُ تحفظُ أسماءَ الدوالِّ فلا تُكسَرُ شيفرةُ العاملِ ولا الاختباراتُ دفعةً واحدةً.
- **زيادةُ حملِ الإثراءِ الحيّ**: claimُ offer وsafety يقرآنِ من `orders`/`users`/`cities` لكلِّ صفٍّ. وهذا مقبولٌ (القراءةُ محصورةٌ بـ`claim_token`/`status`/`order_id`، والصفوفُ قليلةٌ).
- **هجرةُ التوسيعِ متزامنةٌ مع كودِها**: `coupledDeploy` — لا يُنشَرُ المخطّطُ دونَ الكودِ الذي يُودِعُ ويقرأُ `notification_outbox`.
- **التقليصُ مؤجَّلٌ**: إسقاطُ الجداولِ القديمةِ في هجرةٍ لاحقةٍ بعدَ استقرارِ التسليمِ من المصدرِ الموحَّدِ — لا في هذه المرحلة.

## خطةُ التنفيذِ المرحليّة

اتّباعًا لنمطِ المستودعِ (نوعٌ واحدٌ لكلِّ هجرةٍ كما في `20260905…`–`20260906…`):

1. **توحيدُ `safety_incident`** — هجرةٌ تُضيفُ النوعَ وفرعَ الإثراءِ في `claim_notification_delivery`، وتُحوِّلُ `trigger_sos` للإيداعِ في `notification_outbox`، وتجعلُ `claim_safety_incident_delivery`/`finish_safety_incident_delivery` غلافَين. تحديثُ اختبارِ `safety-sos` ليؤكّدَ على `notification_outbox` حيثُ `kind='safety_incident'`.
2. **توحيدُ `subscription_notice`** — هجرةٌ تُضيفُ الأنواعَ و`enqueue_subscription_notice` و`claim_subscription_notices`/`finish_subscription_notice` كأغلفةِ دفعةٍ بـ`batch_claim_token`.
3. **توحيدُ `broadcast_recipient`** — هجرةٌ تُضيفُ النوعَ و`create_broadcast` و`claim_broadcast_recipients`/`finish_broadcast_delivery`/`cancel_broadcast` كأغلفةٍ مع آثارِ إكمالِ الحملةِ.
4. **التقليص** — هجرةٌ لاحقةٌ تُسقطُ الجداولَ القديمةَ بعدَ استقرارِ التسليمِ من المصدرِ الموحَّد.

كلُّ مرحلةٍ: هجرةٌ + اختبارٌ + `schema-contract` (إعادةُ توليدٍ) + سجلُّ مسارِ العودةِ + ملفُ أدلّةٍ + ثلاثُ دوراتِ CI خضراء قبلَ وضعِ `[x]` (ح-4).
