-- =============================================================================
-- F6-06 / ADR-0066: ضغطٌ عكسيٌّ لكلِّ طابورٍ صامدٍ — سعةٌ، وعمرُ أقدمِ حدثٍ،
--   وحدُّ إعادةِ محاولةٍ، وحدُّ طابورِ موتى، وحدُّ منتِجٍ، وتزامنُ مستهلكٍ.
-- الحالة: منفّذ (توسيعٌ لا كسرٌ — `expand` بحتٌ).
-- يبني على: 20260905030000 (صندوقُ الصادرِ)، 20260906010000 (التوحيدُ)،
--   20260908021000 (نطاقُ مطالبةِ دورةِ الرحلةِ)، 20260909040000 (تصنيفُ F6-05)،
--   20260814050000 (توريثُ إعداداتِ مدينةٍ جديدةٍ)، 20260907090000 (طابورُ الوارِدِ).
-- ينتمي إلى: supabase/migrations.
--
-- ## ما تُغيّره هذه الهجرة
--
-- ١) تبذُرُ خمسةَ مفاتيحَ لكلِّ مدينةٍ: حدودُ طابورِ الصادرِ الخمسةُ التي لم تكن
--    معلومةً (والسادسُ — سقفُ المحاولاتِ — مبذورٌ منذُ `20260905030000`).
-- ٢) `queue_backpressure_events`: أثرُ الخرقِ **مُلخَّصاً بالدقيقةِ** لا صفّاً
--    لكلِّ حادثةٍ. ولماذا لا يُشتَقُّ من الطابورِ لاحقاً: الطابورُ يُفرَّغُ فيُمحى
--    أثرُ ضغطِه معه، فيُقرأُ في اللوحةِ صحوٌ تامٌّ بعدَ عاصفةٍ لم يُبقِ لها
--    الشفاءُ دليلاً — وهوَ العطبُ الذي أنكرَه `F6-05` بعينِه: القرارُ الصامتُ
--    لا يُراجَعُ. **وليسَ عدّاداً موازياً**: العمقُ والعمرُ يُقرآنِ من الطابورِ
--    دائماً، وهذا الجدولُ يحفظُ **قرارَ التأجيلِ** وحدَه، وهوَ حدثٌ لا يُشتَقُّ.
-- ٣) `notification_outbox_load` / `_backpressure` و`telegram_update_jobs_load`:
--    قياسٌ من الطابورِ نفسِه — لا جدولَ عدّاداتٍ يُصدَّقُ ويكذبُ.
-- ٤) `notification_outbox_backpressure_trg`: مُطلِّبٌ قبلَ الإدراجِ يُؤجِّلُ
--    **ولا يُسقِطُ**، وللأصنافِ القابلةِ للتأجيلِ وحدَها. الحرجُ يُودَعُ فوراً
--    ولو أُشبِعَ الطابورُ. ومُطلِّبٌ لا تعديلٌ في `enqueue_notification` لأنَّ
--    للصندوقِ ثلاثةَ أبوابٍ، ولا يمرُّ على العامِّ منها صنفٌ قابلٌ للتأجيلِ
--    واحدٌ اليومَ — فحمايةٌ هناكَ فرعٌ لا يُنفَّذُ (§٨).
-- ٥) `claim_notification_delivery`: سقفُ التزامنِ يُنفَّذُ في القاعدةِ، ويُرجَعُ
--    `batch_limit` من مفتاحِه الصحيحِ — تصحيحُ عطبٍ قائمٍ (انظر §«العطبان»).
--
-- ## العطبان المُصحَّحان — لا تحسينان
--
-- أ) `deliverNotificationBatch` كانت تضبطُ سقفَ **صفوفِ الشوطِ** من
--    `notification_delivery_max_attempts`، وهوَ مفتاحُ سقفِ **محاولاتِ الصفِّ
--    الواحدِ** الذي تُنفِّذُه `finish_notification_delivery` لتُميتَه (`CAP-002`).
--    معنيانِ على مفتاحٍ واحدٍ: من رفعَ سقفَ المحاولاتِ ليَصمُدَ أمامَ انقطاعٍ
--    عارضٍ كان يُطيلُ الشوطَ من حيثُ لا يدري، ومن قصَّرَ الشوطَ كان يُميتُ
--    الصفوفَ أسرعَ. فيُفرَدُ المعنيانِ بمفتاحَينِ، ويُرجَعُ الجديدُ في مغلَّفِ
--    الالتقاطِ نفسِه كما كانَ يُرجَعُ الأوّلُ — فلا استدعاءَ ثانياً ولا قراءةً
--    غيرَ ذرّيّةٍ.
-- ب) قراءةُ `notification_claim_timeout_seconds` بـ`where key = … limit 1` بلا
--    مدينةٍ: `platform_settings.city_id` هوَ `NOT NULL` فلا صفَّ عامّاً فيه —
--    فالقراءةُ تُصيبُ **مدينةً عشوائيّةً**. لا يُوسَّعُ هذا النمطُ ههنا: كلُّ
--    قراءةٍ جديدةٍ مقيَّدةٌ بـ`city_id`. وتصحيحُ القراءةِ القائمةِ خارجُ نطاقِ
--    هذا البندِ (يمسُّ مهلةَ الحجزِ لا الضغطَ العكسيَّ) ومُسجَّلٌ في ADR-0066.
--
-- ## لماذا حدٌّ مفقودٌ يُقرأُ مخروقاً لا مفتوحاً
--
-- لو قُرِئَ غيابُ المفتاحِ «بلا حدٍّ» لكانَ خطأُ إعدادٍ واحدٌ يُطفئُ الضغطَ
-- العكسيَّ كلَّه بصمتٍ. فالغيابُ يُقرأُ خرقاً: يُرى في اللوحةِ ويُصحَّح. والأثرُ
-- محدودٌ بالبناءِ: الخرقُ يُؤجِّلُ **القابلَ للتأجيلِ وحدَه** — بثّاً جماهيريّاً
-- لا استغاثةً. وثلاثةُ حُرّاسٍ قائمةٍ تجعلَ الغيابَ شبهَ مستحيلٍ: البذرُ أدناه،
-- وتوريثُ `cities_seed_settings`، ومنعُ `cities_require_complete_settings`
-- تفعيلَ مدينةٍ ينقصُها مفتاحٌ.
--
-- ## العودة (rollback)
--
-- توسيعٌ بحتٌ: صفوفُ إعداداتٍ، وجدولٌ جديدٌ، ودوالٌّ جديدةٌ، وإعادةُ تعريفِ
-- دالّتَينِ **بنفسِ البصمةِ** (فتُحفَظُ الصلاحيّاتُ ولا يُنشَأُ حملٌ زائدٌ).
-- والنسخةُ السابقةُ من الشيفرةِ تعملُ على هذا المخطّطِ بلا تغييرٍ: `batch_limit`
-- حقلٌ زائدٌ يُهمَلُ، والتأجيلُ يُبطِلُه غيابُ قارئٍ له. فلا `breaksPreviousRelease`
-- ولا نشرٌ مقترنٌ.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) الحدودُ الخمسةُ لطابورِ الصادرِ — صفٌّ لكلِّ مدينةٍ (القاعدة ٠.٣)
--
--    ولا مُطلِّبَ جديدٌ لتوريثِها: `cities_seed_settings` (20260814050000) ينسخُ
--    **كلَّ** مفاتيحِ أقدمِ مدينةٍ إلى كلِّ مدينةٍ تُنشأ، فالمفاتيحُ الخمسةُ
--    تُورَّثُ آليّاً. ومُطلِّبٌ خاصٌّ ههنا يكونُ مصدرَ حقيقةٍ ثانياً لا زيادةَ أمانٍ.
--
--    والأرقامُ ابتدائيّةٌ صريحاً (`is_provisional = true`): لم تُقَس تحتَ حملٍ
--    إنتاجيٍّ بعدُ، ومعايرتُها عملُ `F10-05` بمنهجِه (قياسٌ ⇒ عنقٌ واحدٌ ⇒ إصلاحٌ
--    واحدٌ ⇒ إعادةُ قياسٍ). وادّعاءُ نهائيّتِها الآنَ ادّعاءُ قياسٍ لم يقع.
-- ---------------------------------------------------------------------------

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'outbox_queue_depth_limit', '5000'::jsonb, 'number',
       'سعةُ طابورِ الصادرِ: أقصى صفوفٍ غيرِ منتهيةٍ قبلَ أن يُعدَّ الطابورُ مُشبَعاً فتُؤجَّلُ الأصنافُ القابلةُ للتأجيل',
       true
from cities on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'outbox_queue_oldest_age_limit_seconds', '180'::jsonb, 'number',
       'أقصى عمرٍ مقبولٍ لأقدمِ صفٍّ مستحقٍّ للالتقاطِ في طابورِ الصادرِ، ثوانيَ — يُقاسُ من موعدِ الاستحقاقِ لا من الإنشاءِ فلا تُحسَبُ فترةُ الاحتياطِ عُلوقاً',
       true
from cities on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'outbox_queue_dead_limit', '100'::jsonb, 'number',
       'أقصى صفوفٍ ميّتةٍ مقبولةٍ في ساعةٍ واحدةٍ في طابورِ الصادرِ — ارتفاعُها علّةٌ في الإرسالِ لا حِمْلٌ في الطابورِ',
       true
from cities on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'outbox_queue_producer_limit', '1000'::jsonb, 'number',
       'أقصى ما ينتظرُ لصنفٍ واحدٍ قابلٍ للتأجيلِ في طابورِ الصادرِ — يحمي بقيّةَ المنتِجينَ من واحدٍ يستولي على السعةِ',
       true
from cities on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'outbox_queue_consumer_concurrency', '8'::jsonb, 'number',
       'أقصى صفوفٍ محجوزةٍ في وقتٍ واحدٍ في طابورِ الصادرِ لمدينةٍ — يحمي حدَّ معدَّلِ تيليجرام من عُمّالٍ يحجزونَ معاً، وهوَ سقفُ صفوفِ الشوطِ الواحدِ',
       true
from cities on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'outbox_queue_producer_defer_seconds', '30'::jsonb, 'number',
       'مقدارُ تأجيلِ الصفِّ القابلِ للتأجيلِ عندَ الإشباعِ، ثوانيَ — تأجيلٌ لا إسقاطٌ: الصفُّ يُودَعُ ويُؤخَّرُ موعدُه',
       true
from cities on conflict (city_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- ٢) أثرُ الخرقِ — مُلخَّصاً بالدقيقةِ لا صفّاً لكلِّ حادثةٍ
--
--    حملةُ بثٍّ لعشرةِ آلافِ مستقبِلٍ تُؤجَّلُ عشرةَ آلافِ مرّةٍ. وصفٌّ لكلِّ
--    تأجيلٍ يجعلُ الحارسَ من الضغطِ ضاغطاً: عشرةُ آلافِ كتابةٍ في الطابورِ
--    نفسِه الذي نُهدِّئُه. فالمفتاحُ الفريدُ على الدقيقةِ يُحوِّلُ الكتابةَ إلى
--    `on conflict do update` على صفٍّ واحدٍ، فيُحفَظُ **العددُ الكاملُ** في
--    `occurrences` بلا تضخُّمٍ في الصفوفِ. سقفُ الصفوفِ صار زمناً لا حملاً.
--
--    و`queue` مقصورٌ على طابورِ الصادرِ لا لسهوٍ: طابورُ الوارِدِ
--    (`telegram_update_jobs`) **لا `city_id` له** بنصِّ الملحقِ الحاكمِ
--    2026-09-07، وهذا الجدولُ `city_id`ه `NOT NULL` بالقاعدةِ ٠.٤ — ومِلءُ
--    مدينةٍ مصطنَعةٍ منهيٌّ عنه نهياً مطلقاً، وجدولٌ ثالثٌ بلا مدينةٍ يتطلّبُ
--    **ملحقاً حاكماً جديداً** لا هجرةً. فأثرُ ضغطِ الوارِدِ مقاييسُ وسجلٌّ
--    مُهيكَلٌ في البوابةِ حيثُ يقعُ القرارُ — لا صفٌّ يخالفُ القاعدةَ. وهذا
--    التباينُ مُسجَّلٌ حُجّةً في ADR-0066 لا مسكوتٌ عنه.
-- ---------------------------------------------------------------------------

create table if not exists queue_backpressure_events (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id) on delete cascade,
  queue text not null check (queue in ('notification_outbox')),
  reason text not null check (
    reason in ('DEPTH', 'OLDEST_AGE', 'DEAD_LETTER', 'PRODUCER', 'CONSUMER_CONCURRENCY')
  ),
  -- بدايةُ الدقيقةِ التي وقعَ فيها الخرقُ — مفتاحُ التلخيصِ.
  minute_bucket timestamptz not null,
  occurrences bigint not null default 1 check (occurrences > 0),
  -- الأرقامُ لحظةَ **أوّلِ** خرقٍ في الدقيقةِ: تُقرأُ حجّةً على الحكمِ لا حِمْلاً
  -- يُتابَعُ. والمتابعةُ من الطابورِ نفسِه، فلا يُكتَبُ ههنا ما يُقرأُ هناك.
  detail jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (city_id, queue, reason, minute_bucket)
);

create index if not exists queue_backpressure_events_recent_idx
  on queue_backpressure_events (city_id, queue, minute_bucket desc);

alter table queue_backpressure_events enable row level security;

-- لا `anon` ولا `authenticated`: أثرٌ تشغيليٌّ يُقرأُ من الخدمةِ ومن اللوحةِ
-- الإداريّةِ عبرَ `service_role`، ولا مستخدِمَ نهائيٍّ له فيه شأنٌ.
revoke all on table queue_backpressure_events from public, anon, authenticated;
grant select, insert, update on table queue_backpressure_events to service_role;

-- ---------------------------------------------------------------------------
-- ٣) قراءةُ حدٍّ بلا رمي — `get_setting_number` يرمي `MISSING_SETTING`
--
--    وبابُ الإيداعِ يُنادى **داخلَ معاملةِ العملِ** (إنشاءُ رحلةٍ، حلُّ نزاعٍ،
--    بلاغُ استغاثةٍ). فرميٌ ههنا يُسقِطُ المعاملةَ كلَّها: مفتاحُ إعدادٍ ناقصٌ
--    يمنعُ إنشاءَ رحلةٍ. فالقراءةُ صامتةٌ عن الرميِ، و`null` تُقرأُ خرقاً أعلاه.
-- ---------------------------------------------------------------------------

create or replace function queue_limit_or_null(p_city_id uuid, p_key text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  v := get_setting(p_city_id, p_key);
  -- رقمٌ خُزِّنَ نصّاً (`'"5"'::jsonb`) يُقرأُ `null` أي خرقاً، لا يُسقِطُ
  -- المعاملةَ برميِ تحويلٍ. و`jsonb_typeof` يفحصُ قبلَ التحويلِ فلا يُحتاجُ
  -- كتلةُ استثناءٍ — وكتلةُ الاستثناءِ تفتحُ معاملةً فرعيّةً في **كلِّ** قراءةٍ،
  -- وهذا مسارٌ يُقرأُ في كلِّ التقاطٍ. والقيدُ `platform_settings_value_type_coherent`
  -- يمنعُ أكثرَ هذا أصلاً، وما نفذَ منه يُقرأُ إنذاراً لا انهياراً.
  if v is null or jsonb_typeof(v) <> 'number' then return null; end if;
  return floor((v #>> '{}')::numeric)::integer;
end $$;

revoke all on function queue_limit_or_null(uuid, text) from public, anon, authenticated;
grant execute on function queue_limit_or_null(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- ٤) الأصنافُ القابلةُ للتأجيلِ — مرآةُ `DEFERRABLE_UNDER_BACKPRESSURE_KINDS`
--
--    القسمُ ١٥ من الخارطةِ: «يؤجَّلُ البثُّ غيرُ الضروريِّ»، وتُحمى الرحلاتُ
--    النشطةُ والدفعُ والاستغاثةُ. والقائمةُ **بالأسماءِ** لا برتبةٍ: الرتبةُ
--    الكاملةُ للأحدَ عشرَ صنفاً هيَ `F6-07`، وبناؤها ههنا استباقُ بندٍ.
--    وميلُها آمنٌ بالبناءِ: صنفٌ لا يُذكَرُ **لا يُؤجَّلُ**، فالسهوُ يُبقي
--    الإشعارَ عاجلاً لا يُسكِتُه. وحارسُ `check-queue-backpressure` يُطابِقُ
--    هذه القائمةَ بنظيرتِها في الشيفرةِ حرفاً، فلا تفترقانِ بلا سقوطِ CI.
-- ---------------------------------------------------------------------------

create or replace function notification_kind_is_deferrable(p_kind text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_kind in ('broadcast_recipient');
$$;

revoke all on function notification_kind_is_deferrable(text) from public, anon, authenticated;
grant execute on function notification_kind_is_deferrable(text) to service_role;

-- ---------------------------------------------------------------------------
-- ٥) قياسُ الحِمْلِ — من الطابورِ نفسِه
--
--    العمرُ يُقاسُ من `next_attempt_at` لا من `created_at`: صفٌّ في فترةِ
--    احتياطٍ بينَ محاولتَينِ **ينتظرُ موعدَه** لا عالقٌ، وحسبانُه عالقاً إنذارٌ
--    كاذبٌ دائمٌ يُعلِّمُ المناوِبَ أن يُهمِلَ اللوحةَ.
--
--    والموتى في **نافذةٍ**: عدٌّ مطلقٌ يتجاوزُ الحدَّ يوماً ثمَّ يبقى متجاوزاً
--    إلى الأبدِ فيصيرُ صمتاً — إنذارٌ لا يُطفأُ إنذارٌ لا يُقرأُ.
--
--    و`in_app_only` (`F6-05`) ليسَ حِمْلاً: صفٌّ مُصنَّفٌ للعرضِ في المركزِ لا
--    يُلتقَطُ ولا يُرسَلُ، فحسبانُه عمقاً يجعلُ كلَّ مدينةٍ مُشبَعةً بالتصنيفِ.
-- ---------------------------------------------------------------------------

create or replace function notification_outbox_load(
  p_city_id uuid,
  p_dead_window_seconds integer default 3600
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'queue', 'notification_outbox',
    'city_id', p_city_id,
    'depth', coalesce(count(*) filter (where n.status in ('pending', 'sending')), 0),
    'claimed', coalesce(count(*) filter (where n.status = 'sending'), 0),
    'oldest_due_age_seconds', coalesce(
      floor(extract(epoch from (
        now() - min(n.next_attempt_at) filter (
          where n.status = 'pending' and n.next_attempt_at <= now()
        )
      )))::bigint, 0),
    'dead_in_window', coalesce(count(*) filter (
      where n.status = 'dead'
        and n.died_at is not null
        and n.died_at > now() - make_interval(secs => greatest(1, p_dead_window_seconds))
    ), 0),
    'dead_window_seconds', greatest(1, p_dead_window_seconds)
  )
  from notification_outbox n
  where n.city_id = p_city_id;
$$;

revoke all on function notification_outbox_load(uuid, integer) from public, anon, authenticated;
grant execute on function notification_outbox_load(uuid, integer) to service_role;

create or replace function telegram_update_jobs_load(
  p_dead_window_seconds integer default 3600
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  -- قياسٌ بلا حكمٍ: حدودُ هذا الطابورِ ثوابتُ مُعلَنةٌ في
  -- `packages/shared/config/domain-ingress.ts` (لا مدينةَ له فلا صفَّ إعدادٍ)،
  -- فالحكمُ يقعُ في الشيفرةِ التي تملكُ الحدودَ، وههنا الأرقامُ وحدَها.
  -- و`completed_at` لا يُعتَمَدُ عمراً: `next_attempt_at` هوَ الاستحقاقُ.
  select jsonb_build_object(
    'queue', 'telegram_update_jobs',
    'depth', coalesce(count(*) filter (where j.status in ('pending', 'claimed')), 0),
    'claimed', coalesce(count(*) filter (where j.status = 'claimed'), 0),
    'oldest_due_age_seconds', coalesce(
      floor(extract(epoch from (
        now() - min(coalesce(j.next_attempt_at, j.created_at)) filter (
          where j.status = 'pending' and coalesce(j.next_attempt_at, j.created_at) <= now()
        )
      )))::bigint, 0),
    'dead_in_window', coalesce(count(*) filter (
      where j.status = 'dead'
        and j.completed_at is not null
        and j.completed_at > now() - make_interval(secs => greatest(1, p_dead_window_seconds))
    ), 0),
    'dead_window_seconds', greatest(1, p_dead_window_seconds)
  )
  from telegram_update_jobs j;
$$;

revoke all on function telegram_update_jobs_load(integer) from public, anon, authenticated;
grant execute on function telegram_update_jobs_load(integer) to service_role;

-- ---------------------------------------------------------------------------
-- ٦) الحكمُ على طابورِ الصادرِ — قياسٌ وحدودٌ وأسبابٌ في ردٍّ واحدٍ
--
--    يُقرأُ في اللوحةِ وفي الاختبارِ معاً، ويُقابَلُ بحكمِ
--    `evaluateQueueBackpressure` في الشيفرةِ: اختبارُ تكاملٍ يُطابِقُ الحكمَينِ
--    على الحِمْلِ نفسِه، فالتكرارُ (قاعدةٌ تُنفِّذُ ذرّيّاً وشيفرةٌ تُفسِّرُ)
--    **مُقاسٌ لا مُدَّعىً**. ولا يُلخَّصُ في `boolean`: «مُشبَعٌ» بلا سببٍ
--    إنذارٌ لا يُعالَجُ.
-- ---------------------------------------------------------------------------

create or replace function notification_outbox_backpressure(
  p_city_id uuid,
  p_dead_window_seconds integer default 3600
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_load jsonb;
  v_depth_limit integer;
  v_age_limit integer;
  v_dead_limit integer;
  v_producer_limit integer;
  v_consumer_limit integer;
  v_retry_limit integer;
  v_reasons text[] := array[]::text[];
begin
  v_load := notification_outbox_load(p_city_id, p_dead_window_seconds);

  v_depth_limit := queue_limit_or_null(p_city_id, 'outbox_queue_depth_limit');
  v_age_limit := queue_limit_or_null(p_city_id, 'outbox_queue_oldest_age_limit_seconds');
  v_dead_limit := queue_limit_or_null(p_city_id, 'outbox_queue_dead_limit');
  v_producer_limit := queue_limit_or_null(p_city_id, 'outbox_queue_producer_limit');
  v_consumer_limit := queue_limit_or_null(p_city_id, 'outbox_queue_consumer_concurrency');
  v_retry_limit := queue_limit_or_null(p_city_id, 'notification_delivery_max_attempts');

  -- حدٌّ غائبٌ أو غيرُ موجبٍ ⇒ خرقٌ. مرآةُ `breached` في الشيفرةِ حرفاً.
  if v_depth_limit is null or v_depth_limit <= 0
     or (v_load->>'depth')::bigint >= v_depth_limit then
    v_reasons := v_reasons || 'DEPTH';
  end if;
  if v_age_limit is null or v_age_limit <= 0
     or (v_load->>'oldest_due_age_seconds')::bigint >= v_age_limit then
    v_reasons := v_reasons || 'OLDEST_AGE';
  end if;
  if v_dead_limit is null or v_dead_limit <= 0
     or (v_load->>'dead_in_window')::bigint >= v_dead_limit then
    v_reasons := v_reasons || 'DEAD_LETTER';
  end if;

  return jsonb_build_object(
    'queue', 'notification_outbox',
    'city_id', p_city_id,
    'load', v_load,
    'limits', jsonb_build_object(
      'depth_limit', v_depth_limit,
      'oldest_age_limit_seconds', v_age_limit,
      'dead_limit', v_dead_limit,
      'dead_window_seconds', v_load->'dead_window_seconds',
      'producer_limit', v_producer_limit,
      'consumer_concurrency', v_consumer_limit,
      'retry_limit', v_retry_limit
    ),
    'saturated', array_length(v_reasons, 1) is not null,
    'reasons', to_jsonb(v_reasons),
    'consumer_at_capacity',
      v_consumer_limit is null or v_consumer_limit <= 0
      or (v_load->>'claimed')::bigint >= v_consumer_limit
  );
end $$;

revoke all on function notification_outbox_backpressure(uuid, integer)
  from public, anon, authenticated;
grant execute on function notification_outbox_backpressure(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- ٧) تسجيلُ الخرقِ — بلا رميٍ أبداً
--
--    تُنادى من داخلِ معاملةِ العملِ. فلو رمَت لأيِّ سببٍ (قيدٌ، صلاحيّةٌ،
--    تسابُقٌ) لأسقطَت **إنشاءَ الرحلةِ** لأنَّ سطرَ سجلٍّ لم يُكتَب. فالتسجيلُ
--    يبتلعُ خطأَه: أثرٌ ناقصٌ أهونُ من رحلةٍ لم تُنشأ.
-- ---------------------------------------------------------------------------

create or replace function record_queue_backpressure_event(
  p_city_id uuid,
  p_queue text,
  p_reason text,
  p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into queue_backpressure_events (city_id, queue, reason, minute_bucket, detail)
  values (p_city_id, p_queue, p_reason, date_trunc('minute', now()), coalesce(p_detail, '{}'::jsonb))
  on conflict (city_id, queue, reason, minute_bucket) do update
     set occurrences = queue_backpressure_events.occurrences + 1,
         last_seen_at = now();
exception when others then
  return;
end $$;

revoke all on function record_queue_backpressure_event(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function record_queue_backpressure_event(uuid, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- ٨) بابُ الإيداعِ — مُطلِّبٌ قبلَ الإدراجِ يُؤجِّلُ ولا يُسقِطُ
--
--    ## لماذا مُطلِّبٌ لا تعديلٌ في `enqueue_notification`
--
--    لصندوقِ الصادرِ **ثلاثةُ أبوابٍ** لا بابٌ واحدٌ: `enqueue_notification`
--    العامُّ، و`open_offer_round` يُدرِجُ مباشرةً، و`create_broadcast` يُدرِجُ
--    **دفعةً واحدةً** (`insert … select` من `broadcast_audience`). وحُرِّرَ
--    الأخيرُ من الأوّلِ في `20260908030000` عندَ توحيدِ البثِّ.
--
--    فحدُّ منتِجٍ في `enqueue_notification` وحدَه **لا يمرُّ عليه صنفٌ قابلٌ
--    للتأجيلِ واحدٌ اليومَ**: `broadcast_recipient` — الصنفُ الوحيدُ القابلَ
--    للتأجيلِ بنصِّ القسمِ ١٥ — يُدرَجُ من `create_broadcast` لا منه. فذلكَ
--    فرعٌ لا يُنفَّذُ أبداً، أي حمايةٌ مكتوبةٌ لا واقعةٌ — وهوَ ما تنهى عنه
--    القاعدةُ ٠.١ نصّاً.
--
--    والمُطلِّبُ قبلَ الإدراجِ يُنفَّذُ على **كلِّ** بابٍ قائمٍ أو مُستحدَثٍ،
--    فلا يُتجاوَزُ بإدراجٍ مباشرٍ نسيَ صاحبُه الحدَّ. والسابقةُ في الصندوقِ
--    نفسِه: `notification_outbox_classify_trg` (`F6-05`) اختارَ المُطلِّبَ
--    لعينِ هذه الحُجّةِ. وترتيبُ المُطلِّبَينِ غيرُ ذي أثرٍ: هذا يمسُّ
--    `next_attempt_at` وذاكَ يمسُّ `status`.
--
--    ## لماذا مُذكِّرةٌ محدودةٌ بالمعاملةِ
--
--    حملةُ بثٍّ لعشرةِ آلافِ مستقبِلٍ إدراجٌ **واحدٌ** يُطلِقُ المُطلِّبَ عشرةَ
--    آلافِ مرّةٍ. وعدُّ الطابورِ في كلِّ صفٍّ يجعلُ الحارسَ من الضغطِ ضاغطاً:
--    عشرةُ آلافِ عدٍّ على جدولٍ ينمو. فالحكمُ يُحسَبُ **مرّةً** ويُحفَظُ في
--    `set_config(…, is_local => true)` — قيمةٌ تموتُ بانتهاءِ المعاملةِ حتماً،
--    فلا تُعمَّرُ عبرَ اتّصالٍ مجمَّعٍ (pooled) ولا تُرى في معاملةٍ أخرى.
--
--    وهذا ليسَ تحسيناً فقط بل **الدلالةُ الصحيحةُ**: الحملةُ تُقبَلُ أو تُؤجَّلُ
--    **كوحدةٍ**، فلا يُقبَلُ نصفُ مستقبِليها ويُؤجَّلُ نصفُهم على عتبةٍ عبَرَتها
--    الحملةُ بنفسِها في منتصفِ إدراجِها.
-- ---------------------------------------------------------------------------

create or replace function notification_outbox_backpressure_defer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_memo text;
  v_defer_seconds integer;
  v_reason text;
  v_depth bigint;
  v_producer_pending bigint;
  v_depth_limit integer;
  v_producer_limit integer;
begin
  -- الحرجُ لا يُقاسُ ولا يُؤجَّلُ: لا قراءةَ إعدادٍ ولا عدَّ صفوفٍ في مسارِ
  -- الاستغاثةِ أو العرضِ، فلا يُثقَلُ بحسابٍ لن يُغيِّرَ قرارَه. وتأجيلُ بلاغِ
  -- استغاثةٍ لأنَّ حملةَ بثٍّ ملأت الطابورَ قتلٌ بالحسابِ.
  if not notification_kind_is_deferrable(new.kind) then
    return new;
  end if;

  v_key := 'waslah.bp_defer_' || replace(new.city_id::text, '-', '');
  v_memo := nullif(current_setting(v_key, true), '');

  if v_memo is null then
    v_depth_limit := queue_limit_or_null(new.city_id, 'outbox_queue_depth_limit');
    v_producer_limit := queue_limit_or_null(new.city_id, 'outbox_queue_producer_limit');

    -- عدٌّ محدودٌ بالحدِّ لا عدٌّ كاملٌ: السؤالُ «أبلغَ الحدَّ؟» لا «كم هوَ؟»،
    -- فالمسحُ يتوقّفُ عندَ الحدِّ. ورقمُ اللوحةِ يُقرأُ من `…_load` لا من ههنا.
    select count(*) into v_depth from (
      select 1 from notification_outbox n
       where n.city_id = new.city_id and n.status in ('pending', 'sending')
       limit greatest(1, coalesce(v_depth_limit, 1))
    ) probe;

    select count(*) into v_producer_pending from (
      select 1 from notification_outbox n
       where n.city_id = new.city_id and n.kind = new.kind
         and n.status in ('pending', 'sending')
       limit greatest(1, coalesce(v_producer_limit, 1))
    ) probe;

    v_defer_seconds := 0;
    if v_depth_limit is null or v_depth_limit <= 0 or coalesce(v_depth, 0) >= v_depth_limit then
      v_reason := 'DEPTH';
    elsif v_producer_limit is null or v_producer_limit <= 0
          or coalesce(v_producer_pending, 0) >= v_producer_limit then
      v_reason := 'PRODUCER';
    end if;

    if v_reason is not null then
      v_defer_seconds := queue_limit_or_null(new.city_id, 'outbox_queue_producer_defer_seconds');
      -- مفتاحٌ غائبٌ ⇒ أقصرُ تأجيلٍ ذي معنىً (ثانيةٌ): الميلُ نحوَ التسليمِ لا
      -- نحوَ الحبسِ، فحدٌّ معطوبٌ يُهدِّئُ ولا يمنعُ.
      if v_defer_seconds is null or v_defer_seconds <= 0 then v_defer_seconds := 1; end if;

      -- سطرُ أثرٍ **واحدٌ لكلِّ معاملةٍ** لا سطرٌ لكلِّ صفٍّ: الأثرُ يُقرأُ
      -- قراراً لا يُعَدُّ صفوفاً، وعدُّ الصفوفِ في الطابورِ نفسِه.
      perform record_queue_backpressure_event(
        new.city_id, 'notification_outbox', v_reason,
        jsonb_build_object(
          'kind', new.kind, 'depth_probe', v_depth, 'producer_probe', v_producer_pending,
          'depth_limit', v_depth_limit, 'producer_limit', v_producer_limit,
          'deferred_seconds', v_defer_seconds
        )
      );
    end if;

    perform set_config(v_key, v_defer_seconds::text, true);
  else
    v_defer_seconds := v_memo::integer;
  end if;

  if v_defer_seconds > 0 then
    -- `greatest` تحفظُ موعداً أبعدَ اختارَه المُنتِجُ صراحةً (حملةٌ مجدولةٌ
    -- لغدٍ): التأجيلُ يُؤخِّرُ ولا يُقدِّمُ أبداً.
    new.next_attempt_at := greatest(
      coalesce(new.next_attempt_at, now()),
      now() + make_interval(secs => v_defer_seconds)
    );
  end if;

  return new;
end $$;

revoke all on function notification_outbox_backpressure_defer()
  from public, anon, authenticated;

drop trigger if exists notification_outbox_backpressure_trg on notification_outbox;
create trigger notification_outbox_backpressure_trg
  before insert on notification_outbox
  for each row execute function notification_outbox_backpressure_defer();

-- ---------------------------------------------------------------------------
-- ٩) الالتقاطُ — سقفُ تزامنٍ يُنفَّذُ في القاعدةِ، و`batch_limit` من مفتاحِه
--
--    لماذا في القاعدةِ لا في العاملِ: أكثرُ من عمليةٍ تستهلكُ (`F5-04` فصلَ
--    العاملَ عن البوابةِ)، وسقفٌ في ذاكرةِ عمليةٍ واحدةٍ يُضرَبُ في عددِ
--    النسخِ فيصيرُ لا سقفاً. والقاعدةُ هيَ نقطةُ التسلسلِ الوحيدةُ.
--
--    والترتيبُ مقصودٌ: **الاسترجاعُ قبلَ السقفِ**. إيجاراتٌ منتهيةٌ تُحسَبُ
--    `sending` وهيَ متروكةٌ، فلو قِيسَ السقفُ قبلَ استرجاعِها لأغلقَ عاملٌ ماتَ
--    البابَ على الأحياءِ إلى الأبدِ — سقفُ حمايةٍ يصيرُ قفلَ جمودٍ.
-- ---------------------------------------------------------------------------

create or replace function claim_notification_delivery()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery notification_outbox%rowtype;
  v_token uuid := gen_random_uuid();
  v_max integer;
  v_timeout integer;
  v_payload jsonb;
  v_owner_telegram bigint;
  v_owner_language text;
  v_owner_kind text;
  v_claim record;
  v_rider record;
  v_driver record;
  v_batch_limit integer;
  v_concurrency integer;
  v_claimed bigint;
  v_ride_kinds text[] := array[
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found', 'order_cancelled'
  ];
begin
  select greatest(1, (value #>> '{}')::integer) into v_timeout from platform_settings
   where key = 'notification_claim_timeout_seconds' limit 1;
  if v_timeout is null then v_timeout := 300; end if;

  -- استرجاعُ الحجوزِ المتروكةِ لأنواعِ دورةِ الرحلةِ وحدَها — ما للعاملِ الأساسيِّ
  -- معالجُه. الأنواعُ الموحَّدةُ (safety_incident، subscription_notice) لها
  -- عوّالُها ومطالِبُها الخاصُّ فلا يُمسُّها هذا الاسترجاعُ.
  update notification_outbox n
     set status = 'pending', claim_token = null, claimed_at = null, next_attempt_at = now()
   where n.status = 'sending'
     and n.kind = any(v_ride_kinds)
     and n.claimed_at is not null
     and n.claimed_at < now() - make_interval(secs => v_timeout);

  select n.* into v_delivery from notification_outbox n
   where n.status = 'pending' and n.next_attempt_at <= now()
     and n.kind = any(v_ride_kinds)
   order by n.created_at
   for update skip locked limit 1;
  if not found then return jsonb_build_object('ok', true, 'delivery', null); end if;

  -- سقفُ التزامنِ: يُقاسُ بعدَ الاسترجاعِ وبعدَ اختيارِ الصفِّ — فلا يُقرأُ
  -- إعدادٌ ولا يُعَدُّ صفٌّ إن كان الطابورُ فارغاً (الحالةُ الغالبةُ في كلِّ
  -- شوطٍ). والصفُّ المختارُ محجوزٌ بـ`for update` فلا يسبقُنا إليه غيرُنا، فإن
  -- رُدَّ الالتقاطُ عادَ إلى `pending` بانتهاءِ المعاملةِ سليماً كما كان.
  v_concurrency := queue_limit_or_null(v_delivery.city_id, 'outbox_queue_consumer_concurrency');
  select count(*) into v_claimed from notification_outbox n
   where n.city_id = v_delivery.city_id and n.status = 'sending';

  if v_concurrency is null or v_concurrency <= 0 or coalesce(v_claimed, 0) >= v_concurrency then
    perform record_queue_backpressure_event(
      v_delivery.city_id, 'notification_outbox', 'CONSUMER_CONCURRENCY',
      jsonb_build_object('claimed', v_claimed, 'consumer_concurrency', v_concurrency)
    );
    -- `delivery: null` كحالةِ «لا معلَّقَ»، و`backpressure` يُميِّزُ السببَ: شوطٌ
    -- يتوقّفُ لضغطٍ ليسَ شوطاً وجدَ الطابورَ فارغاً، ولا يُقرآنِ واحداً.
    return jsonb_build_object(
      'ok', true, 'delivery', null, 'backpressure', 'CONSUMER_CONCURRENCY',
      'claimed', coalesce(v_claimed, 0), 'consumer_concurrency', v_concurrency
    );
  end if;

  select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
    where city_id = v_delivery.city_id and key = 'notification_delivery_max_attempts';
  if v_max is null then v_max := 3; end if;

  -- سقفُ صفوفِ الشوطِ: من مفتاحِ التزامنِ لا من سقفِ المحاولاتِ (تصحيحُ العطبِ «أ»).
  v_batch_limit := greatest(1, v_concurrency);

  update notification_outbox set status = 'sending', attempts = attempts + 1,
         claim_token = v_token, claimed_at = now()
   where id = v_delivery.id;

  if v_delivery.kind = 'offer' then
    select jsonb_build_object(
             'offer_id', o.id, 'order_id', o.order_id, 'driver_id', o.driver_id,
             'distance_km', o.distance_km::text, 'expires_at', o.expires_at,
             'offer_status', o.status::text
           )
      into v_payload
      from order_offers o where o.id = v_delivery.offer_id;
  elsif v_delivery.kind = 'dispute_resolution' then
    select u.telegram_id, u.language_code,
           case when tk.driver_id is not null then 'driver' else 'rider' end
      into v_owner_telegram, v_owner_language, v_owner_kind
      from support_tickets tk
      left join drivers d on d.id = tk.driver_id
      left join riders r on r.id = tk.rider_id
      join users u on u.id = coalesce(d.user_id, r.user_id)
     where tk.id = (v_delivery.payload->>'ticket_id')::uuid;
    v_payload := v_delivery.payload || jsonb_build_object(
      'owner_telegram_id', v_owner_telegram::text,
      'owner_language', coalesce(v_owner_language, 'ar'),
      'owner_kind', v_owner_kind
    );
  elsif v_delivery.kind in (
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed'
  ) then
    select c.negotiation_id, c.order_id, c.position,
           du.telegram_id::text as driver_chat_id, du.language_code as driver_language,
           ru.telegram_id::text as rider_chat_id, ru.language_code as rider_language,
           get_setting_number(c.city_id, 'unsubscribed_negotiate_seconds')::integer as seconds
      into v_claim
      from unsubscribed_claims c
      join drivers d on d.id = c.driver_id
      join users du on du.id = d.user_id
      join orders o on o.id = c.order_id
      join riders r on r.id = o.rider_id
      join users ru on ru.id = r.user_id
     where c.id = (v_delivery.payload->>'claim_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'negotiation_id', v_claim.negotiation_id,
      'order_id', v_claim.order_id,
      'position', v_claim.position,
      'deadline_seconds', v_claim.seconds,
      'chat_id', case when v_delivery.payload->>'side' = 'driver'
                      then v_claim.driver_chat_id else v_claim.rider_chat_id end,
      'language', coalesce(
        case when v_delivery.payload->>'side' = 'driver'
             then v_claim.driver_language else v_claim.rider_language end,
        'ar'
      )
    );
  elsif v_delivery.kind in ('wider_circle_opened', 'no_driver_found') then
    select ru.telegram_id::text as chat_id, ru.language_code as language,
           o.service::text     as service
      into v_rider
      from orders o
      join riders r on r.id = o.rider_id
      join users ru on ru.id = r.user_id
     where o.id = (v_delivery.payload->>'order_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_rider.chat_id,
      'language', coalesce(v_rider.language, 'ar'),
      'service', v_rider.service
    );
  elsif v_delivery.kind = 'order_cancelled' then
    select du.telegram_id::text as chat_id, du.language_code as language
      into v_driver
      from drivers d
      join users du on du.id = d.user_id
     where d.id = (v_delivery.payload->>'driver_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_driver.chat_id,
      'language', coalesce(v_driver.language, 'ar')
    );
  else
    v_payload := v_delivery.payload;
  end if;

  return (
    select jsonb_build_object('ok', true, 'delivery', jsonb_build_object(
      'delivery_id', n.id, 'kind', n.kind, 'city_id', n.city_id,
      'claim_token', v_token, 'attempts', n.attempts, 'max_attempts', v_max,
      'batch_limit', v_batch_limit,
      'payload', coalesce(v_payload, '{}'::jsonb)
    )) from notification_outbox n where n.id = v_delivery.id
  );
end $$;

revoke execute on function claim_notification_delivery() from public, anon, authenticated;
grant execute on function claim_notification_delivery() to service_role;

-- ---------------------------------------------------------------------------
-- ١٠) حدُّ المنتِجِ لطابورِ وظائفِ تيليجرام — حِملٌ زائدٌ يُردُّ بـ429 لا يُبتلَعُ
--
--    ## لماذا حِملٌ ثانٍ في القاعدةِ لا فحصٌ في TypeScript
--
--    الفحصُ في المسارِ يعني قراءةً ثمّ كتابةً من طبقتَينِ، ونافذةً بينهما
--    تُقتنَص، وذَهاباً ثانياً إلى القاعدةِ في **كلِّ** تحديثٍ. والأخيرُ ثمنٌ
--    في زمنِ الويبهوكِ نفسِه الذي يحميه هذا البندُ. فالحدُّ يُمرَّرُ **وسيطاً**
--    من موضعِه المُعلَنِ (`TELEGRAM_JOB_PRODUCER_LIMIT` في
--    `packages/shared/config/domain-ingress.ts` — حيثُ يسكنُ حدُّ إعادةِ
--    المحاولةِ لهذا الطابورِ نفسِه)، والقرارُ يقعُ في المعاملةِ الواحدةِ.
--
--    ## لماذا حِملٌ زائدٌ (overload) لا تعديلُ التوقيعِ القائمِ
--
--    `create or replace` لا يُغيِّرُ قائمةَ الوسطاءِ، وإسقاطُ الرباعيّةِ
--    يكسِرُ الإصدارَ السابقَ لحظةَ التراجعِ. فالخماسيّةُ **بلا قيمةٍ
--    افتراضيّةٍ** للوسيطِ الخامسِ: نداءٌ برباعيّةٍ يَحسِمُ إلى القديمةِ بلا
--    لَبْسٍ، فالهجرةُ توسيعيّةٌ محضةٌ.
--
--    ## لماذا الرفضُ **قبلَ** إدراجِ الإيصالِ
--
--    وسمُ `update_id` مستهلَكاً ثمّ الرفضُ يعني ابتلاعَ التحديثِ: إعادةُ
--    إرسالِ تيليجرام بعدَ 429 تُقرأُ «مكرَّراً» فتُهمَلُ، فيضيعُ العملُ.
--    فالخروجُ ههنا قبلَ أيِّ كتابةٍ، وأثرُهُ أنَّ الإعادةَ **مقبولةٌ**.
--    وهذا عينُ حُجّةِ ترتيبِ حدِّ المعدَّلِ في ADR 0054 §٦.
--
--    والعمقُ يُعَدُّ محدوداً (`limit`): سؤالُنا «أبلغَ الحدَّ؟» لا «كم عددُه؟»،
--    فمسحُ طابورٍ مكتظٍّ كاملاً في مسارِ الويبهوكِ هوَ العطبُ لا الحمايةُ.
-- ---------------------------------------------------------------------------

create or replace function claim_and_enqueue_telegram_update(
  p_bot text,
  p_update_id bigint,
  p_payload jsonb,
  p_claim_timeout_seconds integer,
  p_producer_depth_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_depth integer;
begin
  -- حدٌّ مفقودٌ أو غيرُ موجَبٍ خرقٌ لا إذنٌ: الصمتُ عن الحدِّ لا يُقرأُ سعةً
  -- لا نهائيّةً. وهوَ عينُ ما تفعلُه `breached` في الشطرِ الآخرِ حرفاً بحرفٍ.
  if p_producer_depth_limit is null or p_producer_depth_limit <= 0 then
    return jsonb_build_object('ok', true, 'outcome', 'shed', 'reason', 'PRODUCER');
  end if;

  select count(*) into v_depth
    from (
      select 1
        from telegram_update_jobs
       where status in ('pending', 'claimed')
       limit p_producer_depth_limit
    ) probe;

  if v_depth >= p_producer_depth_limit then
    return jsonb_build_object(
      'ok', true, 'outcome', 'shed', 'reason', 'PRODUCER',
      'depth', v_depth, 'limit', p_producer_depth_limit
    );
  end if;

  -- دونَ الحدِّ: القرارُ كما هوَ بلا تكرارِ منطقٍ — مصدرُ الحقيقةِ واحدٌ.
  return claim_and_enqueue_telegram_update(
    p_bot, p_update_id, p_payload, p_claim_timeout_seconds
  );
end $$;

revoke execute on function
  claim_and_enqueue_telegram_update(text, bigint, jsonb, integer, integer)
  from public, anon, authenticated;
grant execute on function
  claim_and_enqueue_telegram_update(text, bigint, jsonb, integer, integer)
  to service_role;

comment on function claim_and_enqueue_telegram_update(text, bigint, jsonb, integer, integer) is
  'حِملٌ زائدٌ يُطبِّقُ حدَّ المنتِجِ (F6-06) قبلَ استهلاكِ update_id، ثمّ يُفوِّضُ للرباعيّةِ.';
