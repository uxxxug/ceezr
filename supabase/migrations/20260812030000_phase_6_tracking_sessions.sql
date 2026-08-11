-- المرحلة ٦ — جلسة التتبّع تُركَّب على القاعدة.
--
-- في المرحلة ٥ بُنيت آلة حالة الجلسة نقيّةً في المجال، وبقيت الوقائع في خريطةٍ
-- داخل العملية (`TrackingService.sessions`). وقد صُرِّح في تقرير تلك المرحلة أن
-- هذا **خطر مفتوح** (R-10/R-14) لا قرارٌ نهائي: خريطةٌ في الذاكرة تضيع مع كل
-- إعادة نشر، ولا تُشارَك بين نسختين، ولا يمسحها ماسحٌ فتبقى جلساتٌ أبديّة.
--
-- ولم يُنقَل إلى القاعدة في المرحلة ٥ عن قصد: لم يكن للجلسة مستهلكٌ واحد —
-- والجدول الذي لا يقرؤه أحد بنيةٌ توحي بمسارٍ معتمدٍ وليس خلفه شيء. الآن
-- تُركَّب في المسار الحيّ فعلاً (كل موقع يصل من بوت السائق يفتح الجلسة أو
-- يقدّمها، وكل إنهاء رحلة يُغلقها)، فصار للجدول قارئٌ وكاتبٌ حقيقيّان.
--
-- ## لا عمود `status` هنا — وهذا قرار لا سهو
--
-- الحالة تُشتقّ من الوقائع عند القراءة (`sessionStateAt`)، ولا تُخزَّن. والسبب
-- أن `STALE` انتقالٌ **بغياب حدث**: السائق توقّف عن الإرسال، ولا كاتب يجري في
-- تلك اللحظة ليكتب. فعمودٌ للحالة يوجب ماسحاً دوريّاً، ويكون العمود كاذباً في
-- كل لحظة بين تشغيلين — تقرؤه العمليات `ACTIVE` والسائق منقطع منذ دقيقتين.
-- المخزَّن وقائع، والمحسوب حكم. راجع packages/domain/tracking/session.ts.

create table if not exists tracking_sessions (
  id uuid primary key default gen_random_uuid(),

  driver_id uuid not null references drivers (id) on delete cascade,

  /*
   * المدينة **واقعةٌ في الجلسة** لا نسخةٌ من `drivers.city_id`.
   *
   * القاعدة 0.4 في هذا المستودع تُوجب `city_id` على كل جدول، ويفرضها
   * `scripts/check-migrations.ts`. والالتزام بها هنا ليس امتثالاً شكلياً:
   * السائق ينقل مدينته (مسار تغيير المدينة قائم ومُختبَر)، والجلسة التي جرت
   * في جدة جرت في جدة إلى الأبد. فقراءة المدينة بالانضمام إلى `drivers` كانت
   * تُعيد كتابة تاريخ كل جلسةٍ قديمة عند أول نقل — فتنتقل جلسات الأمس إلى مدينة
   * اليوم في كل تقرير.
   *
   * ولا يُملأ من العميل: الكاتب يشتقّه من `drivers` عند الفتح (راجع
   * session-repository.ts)، فلا مجال لجلسةٍ تُنسب إلى مدينةٍ ليست مدينة سائقها.
   */
  city_id uuid not null references cities (id),

  -- `null` = جلسة تتبّعٍ بلا رحلة: السائق متاح ويُرسل موقعه للمطابقة. وهي الحال
  -- الغالبة في المستودع اليوم، فلا يجوز أن تكون الرحلة إلزامية.
  -- `on delete set null` لا `cascade`: حذف طلبٍ لا يجوز أن يمحو واقعة أن السائق
  -- كان يُتابَع في ذلك الوقت — وهي المعلومة التي يُبنى عليها التحقيق في نزاع.
  trip_id uuid references orders (id) on delete set null,

  started_at timestamptz not null default now(),

  -- زمن **جهاز السائق** لآخر إصلاحة مقبولة، لا زمن الخادم — كما في
  -- drivers.last_location_recorded_at (المرحلة ٥). مقارنة ساعتين مختلفتين
  -- لقياس الانقطاع تُنتج انقطاعاً وهمياً مقداره زمن الشبكة.
  last_fix_at timestamptz,

  ended_at timestamptz,
  end_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- الوقت والسبب يقعان معاً أو لا يقعان: «انتهت بلا سبب» تُفقد التحقيق أهمّ حقل،
-- و«سببٌ بلا وقت» جلسةٌ قائمة تحمل سبب إنهائها — وكلاهما حالة لا معنى لها.
alter table tracking_sessions
  drop constraint if exists tracking_sessions_end_pair;

alter table tracking_sessions
  add constraint tracking_sessions_end_pair
  check ((ended_at is null) = (end_reason is null));

-- المفردات نفسها الموجودة في المجال (SessionEndReason). قيدٌ نصّي لا نوع enum:
-- إضافة سببٍ جديد إلى enum في PostgreSQL تعديلُ نوعٍ يُقفل الجدول، والقيد
-- يُبدَّل بجملة واحدة. والغرض واحد: منع سببٍ لم يُعرَّف في المجال.
alter table tracking_sessions
  drop constraint if exists tracking_sessions_end_reason_known;

alter table tracking_sessions
  add constraint tracking_sessions_end_reason_known
  check (
    end_reason is null
    or end_reason in ('TRIP_COMPLETED', 'DRIVER_STOPPED', 'TRIP_CANCELLED',
                      'EXPIRED', 'ADMIN_TERMINATED')
  );

-- إصلاحةٌ أقدم من بداية الجلسة تخصّ جلسةً أخرى أو ساعةً معطوبة — ترفضها آلة
-- المجال (`FIX_BEFORE_SESSION_START`)، والقيد يمنع أن تدخل من مسارٍ آخر.
alter table tracking_sessions
  drop constraint if exists tracking_sessions_fix_after_start;

alter table tracking_sessions
  add constraint tracking_sessions_fix_after_start
  check (last_fix_at is null or last_fix_at >= started_at - interval '1 minute');

-- **جلسة مفتوحة واحدة لكل سائق.** هذا القيد هو ما يجعل «الجلسة الحالية» سؤالاً
-- له جواب واحد. بلا فهرسٍ فريد جزئي، سباقُ رسالتَي موقعٍ متزامنتين يفتح جلستين،
-- فتُقدَّم إحداهما وتبقى الأخرى مفتوحةً أبداً، ويرى المشغّل السائق مرّتين.
create unique index if not exists tracking_sessions_one_open_per_driver
  on tracking_sessions (driver_id)
  where ended_at is null;

-- استعلام العمليات: الجلسات المفتوحة في مدينةٍ مرتّبةً بآخر إصلاحة. الفهرس على
-- المفتوحة وحدها لأن المنتهية لا تُعرض لحظياً وحجمها ينمو بلا حدّ.
create index if not exists tracking_sessions_open_recent
  on tracking_sessions (city_id, last_fix_at desc nulls last)
  where ended_at is null;

create index if not exists tracking_sessions_trip
  on tracking_sessions (trip_id)
  where trip_id is not null;

comment on table tracking_sessions is
  'وقائع جلسات تتبّع السائقين — المرحلة ٦. لا عمود حالة بقصد: الحالة تُشتقّ عند القراءة.';

comment on column tracking_sessions.last_fix_at is
  'زمن جهاز السائق لآخر إصلاحة مقبولة. أساس اشتقاق ACTIVE/STALE.';

-- الجدول مغلق كسائر الجدد: القراءة والكتابة عبر اتصال الخادم وحده (ADR-0006/0014).
alter table tracking_sessions enable row level security;

revoke all on table tracking_sessions from anon, authenticated;
