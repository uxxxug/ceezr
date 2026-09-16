-- migration-phase: expand
-- =============================================================================
-- `F7-08` · `CAP-011` — **لقطةُ مقاييسِ الإدارةِ**: تجميعٌ مادّيٌّ مُصنَّفٌ
--   محروسٌ، **لا رقمَ فيهِ يُنشَرُ بلا عُمرِه**.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F7-08` (الرِّجلُ الثانيةُ وحدَها).
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `apps/gateway/src/admin/queries.ts` (القراءةُ) ·
--   `packages/infrastructure/admin/metric-snapshot-store.ts` (التحديثُ)
-- يحرسُه: tests/integration/admin-metric-snapshots.test.ts ·
--   scripts/check-admin-metric-snapshot-contract.ts
-- الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
--
-- ## العطبُ الذي تُعالِجُه: مقروءٌ في الشِفرةِ لا مُتخيَّلٌ
--
-- `overviewCounters` في `apps/gateway/src/admin/queries.ts` جملةٌ واحدةٌ فيها
-- **أربعةَ عشرَ استعلاماً فرعياً قياسياً**، منها ثلاثةُ `count(*)` على `orders`
-- **بلا حدِّ مدينةٍ**، وعدَّانِ على `drivers`، وعدَّانِ على `subscriptions`،
-- وثلاثةُ عدَّاداتِ نافذةٍ، ومتوسّطانِ. و`cityPulse` ثلاثةُ عدَّاداتٍ **مضروبةٍ
-- في عددِ المدنِ**. وتُنفَّذُ كلُّها **في كلِّ فتحةِ صفحةِ إدارةٍ** على القاعدةِ
-- الرئيسيّةِ نفسِها التي تُسنِدُ الطلباتَ الحيّةَ. وهذا نصُّ `CAP-011` بحرفِه:
-- «استعلامات الإدارة تضرب القاعدة الرئيسية».
--
-- ## ولِمَ جدولٌ حقيقيٌّ لا `materialized view`
--
-- `materialized view` في `public` **تخرجُ من كلِّ حاجزٍ يحمي بقيّةَ المخطَّطِ**:
-- لا RLS عليها، ولا يراها `scripts/check-migrations.ts` فلا تُطالَبُ بـ`city_id`
-- (القاعدة 0.4)، ولا تُصنَّفُ في `TABLE_RETENTION` فلا يسألُ عنها أحدٌ، وتُنشَرُ
-- عبرَ PostgREST إن نُسِيَ نزعُ صلاحيّةٍ (`ADR 0014`). والحاجزُ الذي وجدَ **ثلاثةً
-- وأربعينَ جدولاً لم يُنظَرْ في استبقائِها** يجبُ أن يرى هذا الجدولَ أيضاً.
-- فالتجميعُ المادّيُّ ههنا **جدولٌ مُصنَّفٌ محروسٌ**، والمادّيّةُ في أنَّ الأرقامَ
-- تُحسَبُ مرّةً في الدورةِ لا مرّةً في كلِّ قارئٍ.
--
-- ## ولِمَ بسطٌ ومقامٌ لا متوسّطٌ
--
-- متوسّطُ المتوسّطاتِ خطأٌ حسابيٌّ: مدينةٌ بعشرِ مطابقاتٍ ومدينةٌ بألفٍ لا
-- يُجمَعُ متوسّطاهُما بالقسمةِ على اثنَينِ. فيُخزَّنُ `match_seconds_sum` مع
-- `match_seconds_count`، و`rating_stars_sum` مع `rating_count`، ويُشتَقُّ
-- المتوسّطُ عندَ القراءةِ **و`null` عندَ مقامٍ صفرٍ** — على قاعدةِ `ADR 0120`
-- نفسِها: «كلُّ نسبةٍ تُنشَرُ بمقامِها». وبذاكَ يكونُ مجموعُ المدنِ **مطابِقاً**
-- للحسابِ الحيِّ لا مُقارِباً لهُ، وذلكَ **شرطُ صدقِ القياسِ** لا تحسينٌ.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تُغلِقُ `CAP-011`**: الرِّجلُ الثالثةُ من نصِّ البندِ («نسخةٌ
--      تحليليّةٌ») **ليست ههنا ولا يُدَّعى بناؤها** — تقتضي عتاداً وقراراً
--      ماليّاً، وهيَ من صنفِ `F7-05` نفسِه، ومُسجَّلةٌ `DEC-16` في §26.
--   ــ **لا تُصيرُ مصدرَ حقيقةٍ**: لا صفَّ ههنا يُقرأُ في قرارِ إسنادٍ ولا في
--      حكمِ أهليّةٍ ولا في مالٍ. جدولُ **عرضٍ إداريٍّ** خالصٌ، وكلُّ صفٍّ فيهِ
--      قابلٌ للحذفِ وإعادةِ البناءِ من الجداولِ الأصليّةِ بشوطٍ واحدٍ.
--   ــ **لا تُخفي عُمراً**: `computed_at` عمودٌ **not null** بلا قيمةٍ افتراضيّةٍ
--      من `now()` في التحديثِ الصامتِ — تكتبُه الدالّةُ بزمنِ بدءِ الشوطِ، فلا
--      يبدو صفٌّ أحدثَ من الحقيقةِ التي قِيسَت.
--   ــ **لا تحملُ هويّةَ إنسانٍ**: لا اسمَ ولا هاتفَ ولا معرِّفَ تلغرامَ ولا
--      معرِّفَ مستخدمٍ. عدَداتٌ ومجاميعُ فحسبُ — فلا يدخلُ الجدولُ في محوِ
--      البيانةِ الشخصيّةِ أصلاً.
--   ــ **لا تحذفُ استعلاماً قائماً ولا تُغيِّرُ عموداً في جدولٍ قائمٍ**: توسيعٌ
--      خالصٌ، فالعودةُ صورةُ شيفرةٍ وحدَها ولا مسارَ تضييقٍ يُسجَّلُ.
-- =============================================================================

-- ── ١) الجدولُ: صفٌّ واحدٌ لكلِّ مدينةٍ ونافذةٍ ───────────────────────────────
--
-- **لا تاريخَ يُكدَّسُ**: الصفُّ يُحدَّثُ في موضعِه. لأنَّ الغرضَ **حاضرٌ يُعرَضُ**
-- لا سلسلةٌ زمنيّةٌ تُحلَّلُ — وسلسلةُ الزمنِ محلُّها الرِّجلُ الثالثةُ (النسخةُ
-- التحليليّةُ) لا جدولُ عرضٍ ينمو بلا حدٍّ في القاعدةِ الرئيسيّةِ التي نحاولُ
-- تخفيفَها. فالجدولُ يبقى **بعددِ المدنِ في عددِ النوافذِ** صفّاً، وذلكَ سقفٌ
-- معروفٌ لا يُفاجئُ.
create table if not exists admin_metric_snapshots (
  id                       uuid primary key default gen_random_uuid(),
  city_id                  uuid not null references cities(id) on delete cascade,
  -- نافذةُ العدَّاداتِ المُدّيّةِ بالساعاتِ. عمودٌ لا ثابتٌ: القارئُ يطلبُ نافذتَه
  -- ويجدُ صفَّها أو **لا يجدُ شيئاً** — ولا يُعطى صفُّ نافذةٍ أخرى بدلاً منهُ.
  window_hours             integer not null,
  -- زمنُ **قياسِ** الأرقامِ لا زمنُ كتابةِ الصفِّ. هوَ عينُ ما يُنشَرُ للمُشغِّلِ.
  computed_at              timestamptz not null,
  -- ١-أ) العدَّاداتُ الآنيّةُ (حالةٌ راهنةٌ بلا نافذةٍ)
  searching_orders         integer not null default 0,
  matched_orders           integer not null default 0,
  in_progress_orders       integer not null default 0,
  available_drivers        integer not null default 0,
  verified_drivers         integer not null default 0,
  pending_drivers          integer not null default 0,
  active_subscriptions     integer not null default 0,
  trial_subscriptions      integer not null default 0,
  open_tickets             integer not null default 0,
  -- ١-ب) عدَّاداتُ النافذةِ
  completed_orders_window  integer not null default 0,
  failed_orders_window     integer not null default 0,
  cancelled_orders_window  integer not null default 0,
  -- ١-ج) المتوسّطاتُ بسطاً ومقاماً — لا متوسّطَ مخزوناً
  match_seconds_sum        numeric(18,3) not null default 0,
  match_seconds_count      integer not null default 0,
  rating_stars_sum         numeric(18,3) not null default 0,
  rating_count             integer not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- صفٌّ واحدٌ لا صفّانِ: بلا هذا القيدِ يصيرُ للمدينةِ لقطتانِ متناقضتانِ
  -- وقارئٌ يختارُ إحداهُما بالحظِّ.
  constraint admin_metric_snapshots_one_per_window unique (city_id, window_hours),
  constraint admin_metric_snapshots_window_positive check (window_hours > 0),
  -- عدَدٌ سالبٌ لا يعني «قليلاً» بل يعني **عطباً في الكاتبِ**، وأولى أن يُردَّ
  -- عندَ الكتابةِ من أن يُعرَضَ على مُشغِّلٍ يظنُّه حقيقةً.
  constraint admin_metric_snapshots_counts_non_negative check (
    searching_orders >= 0 and matched_orders >= 0 and in_progress_orders >= 0
    and available_drivers >= 0 and verified_drivers >= 0 and pending_drivers >= 0
    and active_subscriptions >= 0 and trial_subscriptions >= 0 and open_tickets >= 0
    and completed_orders_window >= 0 and failed_orders_window >= 0
    and cancelled_orders_window >= 0
    and match_seconds_sum >= 0 and match_seconds_count >= 0
    and rating_stars_sum >= 0 and rating_count >= 0
  )
);

comment on table admin_metric_snapshots is
  'لقطةُ عدَّاداتِ لوحةِ الإدارةِ لكلِّ مدينةٍ ونافذةٍ (F7-08 · CAP-011). جدولُ عرضٍ مُشتَقٌّ لا مصدرَ حقيقةٍ: يُعادُ بناؤه كلُّه من الجداولِ الأصليّةِ بشوطٍ واحدٍ، ولا يُقرأُ في أيِّ قرارِ إسنادٍ أو أهليّةٍ أو مالٍ. computed_at زمنُ القياسِ ويُنشَرُ معَ كلِّ رقمٍ.';

comment on column admin_metric_snapshots.computed_at is
  'زمنُ قياسِ الأرقامِ لا زمنُ كتابةِ الصفِّ. يُنشَرُ للمُشغِّلِ دائماً: رقمٌ بلا عُمرِه لا يُعرَضُ.';

comment on column admin_metric_snapshots.match_seconds_sum is
  'بسطُ متوسّطِ زمنِ المطابقةِ بالثواني. المتوسّطُ يُشتَقُّ عندَ القراءةِ ويكونُ null عندَ مقامٍ صفرٍ — كي يُجمَعَ عبرَ المدنِ جمعاً صحيحاً لا متوسّطَ متوسّطاتٍ (ADR 0120).';

do $$ begin
  create trigger admin_metric_snapshots_set_updated_at before update on admin_metric_snapshots
  for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ── ٢) الإغلاقُ: RLS مفعَّلةٌ وصلاحيّاتٌ منزوعةٌ ─────────────────────────────
--
-- لا سطحَ عامَّ لهذا الجدولِ ألبتّةَ: يُكتَبُ بدالّةٍ لـ`service_role` ويُقرأُ من
-- الخادمِ. ونزعُ `public` صريحٌ **زائداً على** `anon`/`authenticated`، لأنَّ
-- المنحَ الافتراضيَّ في PostgreSQL يقعُ على `public` فيُورَثُ لكلِّ دورٍ جديدٍ
-- يُنشَأُ لاحقاً — والحاجزُ الذي يُنسى هوَ الذي يُخترَقُ.
alter table admin_metric_snapshots enable row level security;
revoke all on table admin_metric_snapshots from public;
revoke all on table admin_metric_snapshots from anon, authenticated;

-- ── ٣) الإعدادانِ: لا رقمَ قرارٍ في الشِفرةِ (القاعدة 0.3) ────────────────────
--
-- عتبةُ التقادُمِ وإذنُ السقوطِ إلى الحيِّ قرارا **مُشغِّلٍ** يُضبَطانِ بلا نشرِ
-- حزمةٍ، و**يُقرأانِ في كلِّ طلبٍ** فيُطاعُ التغييرُ فوراً.
--
-- **ولا إعدادَ لدورةِ التحديثِ عن قصدٍ**: تواتُرُ الجوبِ يُقرأُ مرّةً واحدةً عندَ
-- بناءِ حاويةِ العاملِ (`JOB_INTERVALS`)، فإعدادٌ في القاعدةِ يُغيَّرُ ولا يُتبَعُ
-- **وعدٌ مكتوبٌ لا يُوفى**: مُشغِّلٌ يرفعُ التواتُرَ ولا يجدُ أثراً يظنُّ العطبَ في
-- القياسِ لا في الإعدادِ. وموضِعُ التواتُرِ واحدٌ معَ بقيّةِ المهامِّ بنصِّ ما
-- أُعلِنَ هناكَ: «تقنيّةٌ لا تجاريّةٌ».
--
-- والعتبةُ المبذورةُ **مبدئيّةٌ مُعلَنةٌ** (`is_provisional = true`) لا مُصادَقةً:
-- لم يُقَس حِملٌ عندَ مليونَينِ بعدُ، فالرقمُ المبذورُ اليومَ نقطةُ بدءٍ
-- يُراجِعُها المالكُ لا حقيقةٌ مُثبَتةٌ. وهيَ أطولُ من دورةِ الجوبِ بفارقٍ يحتملُ
-- شوطاً ساقطاً أو اثنَينِ، لا لأنَّ التقادُمَ مقبولٌ بل لأنَّ وسماً يُطلَقُ عندَ
-- أوّلِ تأخُّرٍ طبيعيٍّ يُقرَأُ ضجيجاً فيُهمَلُ.
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, 'admin_metrics_stale_after_seconds', to_jsonb(180), 'number',
       'بعدَ كم ثانيةً تُعَدُّ لقطةُ المقاييسِ متقادِمةً فتُوسَمُ للمُشغِّلِ', true
  from cities c
on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, 'admin_overview_live_fallback_enabled', to_jsonb(false), 'boolean',
       'هل يُسمَحُ بمسحٍ حيٍّ عندَ غيابِ اللقطةِ أو تقادُمِها. مُطفأً افتراضاً: غيابُ اللقطةِ يُقالُ ولا يُستَرُ بمسحٍ يُثقِلُ القاعدةَ', false
  from cities c
on conflict (city_id, key) do nothing;
