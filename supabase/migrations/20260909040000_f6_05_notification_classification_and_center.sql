-- =============================================================================
-- F6-05 / TG-002 / SS-07 — تصنيفُ الإشعارِ (حرجٌ / داخلَ التطبيقِ) ومركزُ
--   الإشعاراتِ الصامدُ داخلَ التطبيق.
--
-- الحالة: منفّذ فعلياً — 2026-09-09، البند `F6-05` (§F6 من ROADMAP-MASTER).
-- ينتمي إلى: supabase/migrations
-- يبني على: 20260906010000 (صندوقُ الصادرِ الموحَّد) · 20260908010000 (safety) ·
--   20260908020000 (subscription) · 20260908030000 (broadcast) ·
--   20260908021000 (نطاقُ مطالبةِ دورةِ الرحلة) · 20260908050000 (DLQ).
--
-- ## ما المشكلةُ التي يحلُّها هذا الملفّ
--
-- `TG-002` بنصِّه: «مسارٌ حرجٌ معتمدٌ على الرسائلِ». كلُّ ما تُخرِجُه المنصّةُ
-- اليومَ يمرُّ من بابٍ واحدٍ إلى تلغرام، حرجُه وإعلانُه سواءٌ. وذلكَ يُنتِجُ ضررَينِ
-- لا واحداً: الأوّلُ سعةٌ — `TG-001` يحدُّ البوتَ الواحدَ بنحوِ ثلاثينَ رسالةً في
-- الثانيةِ، فحملةُ بثٍّ إعلانيّةٌ تستهلكُ الدلوَ الذي يجبُ أن يمرَّ منه **عرضُ
-- رحلةٍ بمؤقّتٍ**. والثاني ذاكرةٌ — ما أُرسِلَ لا يُقرأُ إلّا في محادثةِ تلغرام،
-- فإن ضاعَ فيها لم يبقَ للمستخدمِ موضعٌ يرجعُ إليه (`SS-07`).
--
-- ## القرارُ: التصنيفُ **بيانٌ في القاعدةِ** لا شرطٌ في الكود
--
-- لكلِّ (مدينةٍ، نوعٍ) صفٌّ في `notification_kind_policy` يُعلِنُ قناتَه:
--   * `critical` — يُرسَلُ عبرَ تلغرام كما كانَ **ويُقيَّدُ في المركزِ أيضاً**.
--   * `in_app`   — يُقيَّدُ في المركزِ **ولا يُرسَل**.
-- ووضعُه في القاعدةِ لا في الكودِ ليسَ تفضيلَ ذوقٍ: إعادةُ تصنيفِ نوعٍ قرارُ
-- منتَجٍ قد يختلفُ بينَ مدينةٍ ومدينةٍ (مدينةٌ تجريبيّةٌ تُهدّئُ الإعلاناتِ وأخرى
-- لا)، وجعلُه في الكودِ كانَ سيجعلَ كلَّ قرارِ منتَجٍ نشرةً.
--
-- ## عدمُ التماثلِ — ولماذا كلُّ حارسٍ ههنا يميلُ إلى «أرسِلْ»
--
-- الخطأُ في الاتّجاهَينِ **ليسَ متساوياً**:
--   * تصنيفُ إعلانٍ `critical` خطأً ⇒ رسالةٌ زائدةٌ تستهلكُ دلوَ `TG-001`. مكلفٌ
--     ومرئيٌّ في المقاييسِ.
--   * تصنيفُ حرجٍ `in_app` خطأً ⇒ **السائقُ لا يرى العرضَ أبداً** إن لم يفتحِ
--     التطبيقَ، **ولا شيءَ يُخفِق**: صفُّ الصندوقِ ينتهي بحالةٍ نهائيّةٍ ناجحةٍ،
--     وصفُّ المركزِ مكتوبٌ، فكلُّ سطحٍ رقابيٍّ يقولُ «سُلِّمَ». **فالضررُ صامتٌ
--     تماماً** — وهذا هوَ الحالُ الذي تحرسُ منه هذه الهجرةُ لا الحالُ الأوّل.
--
-- ولذلكَ ثلاثةُ حرّاسٍ كلُّها تميلُ إلى الإرسالِ لا إلى الصمت:
--   ١) **افتراضُ الغيابِ `critical`**: نوعٌ بلا صفِّ سياسةٍ في مدينةٍ يُرسَلُ.
--      فنسيانُ بذرِ السياسةِ يُنتِجُ رسالةً زائدةً لا صمتاً.
--   ٢) **الأنواعُ المُوجَّهةُ إلى مجموعةٍ لا تُصنَّفُ `in_app` أبداً**
--      (`safety_incident` اليومَ): لا صندوقَ واردٍ شخصيٌّ لها أصلاً، فتصنيفُها
--      داخلَ التطبيقِ **يُعدِمُ بلاغَ استغاثةٍ إعداماً كاملاً** — لا رسالةَ ولا
--      صفَّ مركزٍ. مرفوضٌ بقيدٍ في القاعدةِ لا بمراجعةِ بشرٍ.
--   ٣) **تعذُّرُ تحديدِ المستقبِلِ يُعيدُ النوعَ إلى `critical`** في ذلكَ الصفِّ
--      وحدَه: لو صُنِّفَ نوعٌ `in_app` ثمّ تعذَّرَ ربطُ الصفِّ بمستخدمٍ، فالبديلُ
--      عن الإرسالِ ليسَ «لا شيء» بل الإرسالُ. **لا يُسقَطُ إشعارٌ قطُّ بصمت.**
--
-- ## المركزُ يُكتَبُ في معاملةِ المنتِجِ نفسِها
--
-- صفُّ المركزِ يُكتَبُ بمُطلِقٍ (trigger) على `notification_outbox`، أي **داخلَ
-- معاملةِ تغييرِ الحالةِ نفسِها** التي أودعت الصفَّ. فلا يقعُ «أُرسِلَ ولا أثرَ
-- في المركزِ» ولا «أثرٌ في المركزِ بلا إيداعٍ». وكتابتُه عندَ الإيداعِ لا عندَ
-- التسليمِ عن قصدٍ: الإشعارُ الذي **فشلَ** تسليمُه إلى تلغرام هو أوّلُ ما يحتاجُ
-- المستخدمُ أن يجدَه في المركز؛ فربطُه بنجاحِ التسليمِ كانَ سيُخفيه في الحالِ
-- الوحيدِ الذي يُبرِّرُ وجودَ المركز.
--
-- ## ما لا تفعلُه هذه الهجرةُ عن قصدٍ
--
-- **لا تُعيدُ تصنيفَ نوعٍ واحدٍ.** الأنواعُ الأحدَ عشرَ كلُّها تُبذَرُ `critical`،
-- فسلوكُ الإرسالِ بعدَ هذه الهجرةِ **مطابقٌ لما قبلَها حرفاً**. وذلكَ لأنَّ واجهةَ
-- `SS-07` في التطبيقِ المصغَّرِ **لم تُبنَ بعدُ** (شاشاتُ المنتَجِ في `F2`/`F3`)،
-- وإعادةُ تصنيفِ نوعٍ إلى `in_app` قبلَ وجودِ شاشةٍ تعرضُه **إسكاتٌ لا تهدئةٌ**.
-- فالآليّةُ تُبنى وتُبرهَنُ ههنا، وقلبُ صفٍّ واحدٍ لاحقاً قرارُ منتَجٍ لا نشرةٌ.
--
-- ## العودة
--
-- توسيعٌ خالصٌ (expand): جدولانِ جديدانِ وقيمةُ حالةٍ **مُضافةٌ** إلى قيدٍ قائمٍ
-- ومُطلِقانِ. لا عمودَ يُحذَفُ ولا قيدَ يُضيَّق. والعودةُ بالكودِ وحدَه آمنةٌ:
-- النسخةُ السابقةُ تتجاهلُ الجدولَينِ، وما دامَ كلُّ نوعٍ `critical` فلا صفَّ
-- يحملُ الحالةَ الجديدةَ `in_app_only` أصلاً فلا صفَّ «عالقٌ» تتركُه العودة.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) حالةٌ نهائيّةٌ جديدةٌ: `in_app_only`
--
--    ليست `delivered` لأنَّ `delivered` يلزمُها `delivered_message_id` بقيدٍ
--    قائمٍ — ومعرّفُ رسالةٍ لا وجودَ لها اختراعٌ. وليست `canceled` لأنَّ الإلغاءَ
--    قرارُ مشرفٍ يُلغي إرسالاً مقصوداً، وهذا إيصالٌ ناجحٌ بقناةٍ أخرى. وتمييزُها
--    باسمِها يجعلُ سؤالَ «كم إشعاراً لم يُرسَل؟» استعلاماً لا تخميناً.
-- ---------------------------------------------------------------------------

alter table notification_outbox
  drop constraint if exists notification_outbox_status_check;
alter table notification_outbox
  add constraint notification_outbox_status_check check (
    status in ('pending','sending','delivered','dead','failed','canceled','in_app_only')
  );

-- ---------------------------------------------------------------------------
-- ٢) الأنواعُ المُوجَّهةُ إلى مجموعةٍ — قائمةٌ مغلقةٌ لا نمطٌ
--
--    `safety_incident` يُنشَرُ في مجموعةِ الإسنادِ لا في محادثةِ شخصٍ
--    (20260908010000)، فلا مستقبِلَ فرداً له. والقائمةُ **مغلقةٌ**: توسيعُها
--    تغييرُ هجرةٍ يُقرأُ في المراجعةِ، لا سطرُ بياناتٍ يُكتَبُ بيدٍ.
-- ---------------------------------------------------------------------------

create or replace function notification_kind_is_group_addressed(p_kind text)
returns boolean
language sql
immutable
set search_path = public
as $$ select p_kind in ('safety_incident') $$;

-- ---------------------------------------------------------------------------
-- ٣) جدولُ السياسةِ — لكلِّ (مدينةٍ، نوعٍ) قناةٌ مُعلَنةٌ
-- ---------------------------------------------------------------------------

create table if not exists notification_kind_policy (
  city_id uuid not null references cities(id) on delete cascade,
  kind text not null,
  channel text not null check (channel in ('critical','in_app')),
  description_ar text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (city_id, kind),
  -- الحارسُ الثاني، في القاعدةِ لا في مراجعةٍ: نوعٌ يُوجَّهُ إلى مجموعةٍ لا
  -- يُصنَّفُ داخلَ التطبيقِ أبداً — إذ لا صندوقَ واردٍ شخصيٌّ يستقبلُه، فتصنيفُه
  -- كذلكَ إعدامٌ صامتٌ لا تهدئةٌ.
  constraint notification_policy_group_kinds_stay_critical check (
    not notification_kind_is_group_addressed(kind) or channel = 'critical'
  )
);

drop trigger if exists notification_kind_policy_set_updated_at on notification_kind_policy;
create trigger notification_kind_policy_set_updated_at before update on notification_kind_policy
  for each row execute function set_updated_at();

alter table notification_kind_policy enable row level security;
drop policy if exists notification_kind_policy_service_role on notification_kind_policy;
create policy notification_kind_policy_service_role on notification_kind_policy
  for all to service_role using (true) with check (true);

-- البذرُ: كلُّ نوعٍ قائمٍ × كلُّ مدينةٍ ⇒ `critical`. لا نوعَ يُعادُ تصنيفُه في
-- هذه الهجرةِ (انظر «ما لا تفعلُه» أعلاه).
insert into notification_kind_policy (city_id, kind, channel, description_ar)
select c.id, k.kind, 'critical', k.description_ar
from cities c
cross join (values
  ('offer',                    'عرضُ رحلةٍ بمؤقّتٍ — السائقُ يفوتُه إن لم يُرسَل'),
  ('dispute_resolution',       'نتيجةُ نزاعٍ على تذكرةِ دعمٍ'),
  ('negotiation_turn_opened',  'دورُ تفاوضٍ فُتِحَ بمهلةٍ'),
  ('negotiation_turn_closed',  'دورُ تفاوضٍ أُغلِق'),
  ('negotiation_agreed',       'اتّفاقُ تفاوضٍ'),
  ('wider_circle_opened',      'توسيعُ دائرةِ البحثِ عن سائقٍ'),
  ('no_driver_found',          'لا سائقَ متاحٌ — الراكبُ في انتظارٍ'),
  ('order_cancelled',          'إلغاءُ طلبٍ'),
  ('safety_incident',          'بلاغُ سلامةٍ إلى مجموعةِ الإسنادِ — مُوجَّهٌ لمجموعةٍ'),
  ('subscription_notice',      'إشعارُ اشتراكٍ'),
  ('broadcast_recipient',      'مستقبِلُ حملةِ بثٍّ إداريّةٍ')
) as k(kind, description_ar)
on conflict (city_id, kind) do nothing;

-- ---------------------------------------------------------------------------
-- ٤) مركزُ الإشعاراتِ — `SS-07`
--
--    `outbox_id` فريدٌ: صفُّ صندوقٍ واحدٌ ⇒ مدخلُ مركزٍ واحدٌ. وإعادةُ الإيداعِ
--    بالمفتاحِ نفسِه لا تُنشئُ صفَّ صندوقٍ ثانياً أصلاً، فلا تكرارَ ههنا.
--    و`on delete cascade` عن قصدٍ: حذفُ صفِّ صندوقٍ (لا يقعُ في التشغيلِ العاديِّ)
--    لا يتركُ مدخلاً يتيماً يشيرُ إلى عدمٍ.
-- ---------------------------------------------------------------------------

create table if not exists user_notifications (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id) on delete restrict,
  user_id uuid not null references users(id) on delete cascade,
  outbox_id uuid not null unique references notification_outbox(id) on delete cascade,
  kind text not null,
  channel text not null check (channel in ('critical','in_app')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- فهرسُ الموجَزِ: صفحةُ «إشعاراتي» تقرأُ بالمستخدمِ مرتَّبةً بالأحدثِ، وهو
-- الاستعلامُ الوحيدُ الذي يُخدَمُ ههنا.
create index if not exists user_notifications_feed_idx
  on user_notifications(user_id, created_at desc);
-- فهرسُ عدّادِ غيرِ المقروءِ — جزئيٌّ فلا يحملُ ما قُرِئَ.
create index if not exists user_notifications_unread_idx
  on user_notifications(user_id) where read_at is null;

alter table user_notifications enable row level security;
drop policy if exists user_notifications_service_role on user_notifications;
create policy user_notifications_service_role on user_notifications
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- ٥) تحديدُ المستقبِلِ — موضعٌ **واحدٌ** لا نسخةٌ في كلِّ منتِجٍ
--
--    يُعيدُ `null` عندَ التعذُّرِ ولا يرفعُ خطأً: رفعُ الخطأِ كانَ سيُرجِعُ معاملةَ
--    المنتِجِ — أي أنَّ عطلاً في **دفترِ** الإشعاراتِ كانَ سيمنعُ **إسنادَ رحلةٍ**.
--    وذلكَ يقلبُ الأولويّاتِ: المركزُ خدمةٌ للمستخدمِ، والإسنادُ هوَ المنتَج.
-- ---------------------------------------------------------------------------

create or replace function resolve_notification_recipient(p_row notification_outbox)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  -- ما أعلنَه المنتِجُ صراحةً يسبقُ كلَّ استنتاجٍ.
  if p_row.recipient_user_id is not null then
    return p_row.recipient_user_id;
  end if;

  if p_row.kind = 'offer' then
    select d.user_id into v_user from drivers d where d.id = p_row.driver_id;

  elsif p_row.kind = 'order_cancelled' then
    select d.user_id into v_user from drivers d
     where d.id = (p_row.payload->>'driver_id')::uuid;

  elsif p_row.kind in ('wider_circle_opened', 'no_driver_found') then
    select r.user_id into v_user
      from orders o join riders r on r.id = o.rider_id
     where o.id = (p_row.payload->>'order_id')::uuid;

  elsif p_row.kind = 'dispute_resolution' then
    select coalesce(d.user_id, r.user_id) into v_user
      from support_tickets tk
      left join drivers d on d.id = tk.driver_id
      left join riders r on r.id = tk.rider_id
     where tk.id = (p_row.payload->>'ticket_id')::uuid;

  elsif p_row.kind in (
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed'
  ) then
    -- الطرفُ مُعلَنٌ في الحمولةِ (`side`) لأنَّ الصفَّ الواحدَ يخصُّ طرفاً واحداً.
    select case when p_row.payload->>'side' = 'driver' then d.user_id else r.user_id end
      into v_user
      from unsubscribed_claims cl
      join drivers d on d.id = cl.driver_id
      join orders o on o.id = cl.order_id
      join riders r on r.id = o.rider_id
     where cl.id = (p_row.payload->>'claim_id')::uuid;

  elsif p_row.kind = 'subscription_notice' then
    select d.user_id into v_user
      from subscriptions s join drivers d on d.id = s.driver_id
     where s.id = (p_row.payload->>'subscription_id')::uuid;

  else
    -- `safety_incident` وكلُّ نوعٍ مُوجَّهٍ إلى مجموعةٍ: لا مستقبِلَ فرداً.
    v_user := null;
  end if;

  return v_user;
end $$;

-- ---------------------------------------------------------------------------
-- ٦) المُطلِقُ قبلَ الإدراجِ — يحسمُ القناةَ ويثبِّتُ المستقبِلَ
-- ---------------------------------------------------------------------------

create or replace function notification_outbox_classify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel text;
  v_recipient uuid;
begin
  v_recipient := resolve_notification_recipient(new);
  if new.recipient_user_id is null then
    new.recipient_user_id := v_recipient;
  end if;

  select p.channel into v_channel
    from notification_kind_policy p
   where p.city_id = new.city_id and p.kind = new.kind;

  -- الحارسُ الأوّلُ: غيابُ السياسةِ ⇒ يُرسَل. نسيانُ البذرِ يُنتِجُ رسالةً
  -- زائدةً، ولو كانَ الافتراضُ `in_app` لأنتجَ صمتاً لا يُرى.
  if v_channel is null then
    v_channel := 'critical';
  end if;

  -- الحارسُ الثالثُ: لا مستقبِلَ ⇒ لا مركزَ يستقبلُه ⇒ يُرسَل. والبديلُ عن
  -- الإرسالِ ههنا ليسَ «لا شيءَ» بل الإرسالُ.
  if v_channel = 'in_app' and v_recipient is null then
    v_channel := 'critical';
  end if;

  if v_channel = 'in_app' then
    -- لا يُطالَبُ ولا يُسلَّمُ: حالةٌ نهائيّةٌ من لحظةِ الإيداعِ.
    new.status := 'in_app_only';
    new.next_attempt_at := now();
  end if;

  return new;
end $$;

drop trigger if exists notification_outbox_classify_trg on notification_outbox;
create trigger notification_outbox_classify_trg
  before insert on notification_outbox
  for each row execute function notification_outbox_classify();

-- ---------------------------------------------------------------------------
-- ٧) المُطلِقُ بعدَ الإدراجِ — يُقيِّدُ في المركزِ داخلَ معاملةِ المنتِجِ
--
--    القناةُ المُقيَّدةُ تُشتقُّ من الحالةِ لا من السياسةِ ثانيةً: `in_app_only`
--    هي **ما وقعَ فعلاً**، والسياسةُ ما كانَ مطلوباً. وقراءةُ ما وقعَ تمنعُ أن
--    يقولَ المركزُ «داخلَ التطبيقِ» عن صفٍّ رُدَّ إلى الإرسالِ بالحارسِ الثالث.
-- ---------------------------------------------------------------------------

create or replace function notification_outbox_record_in_center()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.recipient_user_id is null then
    return new;
  end if;

  insert into user_notifications (city_id, user_id, outbox_id, kind, channel, payload)
  values (
    new.city_id,
    new.recipient_user_id,
    new.id,
    new.kind,
    case when new.status = 'in_app_only' then 'in_app' else 'critical' end,
    coalesce(new.payload, '{}'::jsonb)
  )
  on conflict (outbox_id) do nothing;

  return new;
end $$;

drop trigger if exists notification_outbox_record_in_center_trg on notification_outbox;
create trigger notification_outbox_record_in_center_trg
  after insert on notification_outbox
  for each row execute function notification_outbox_record_in_center();

-- ---------------------------------------------------------------------------
-- ٨) قراءةُ المركزِ — التفويضُ على مستوى الكائنِ **في القاعدةِ**
--
--    المدخلُ معرّفُ تلغرامَ المستخرَجُ من رمزٍ وقّعناهُ نحنُ، لا `user_id` يرسلُه
--    العميلُ. فلو مرَّرَ العميلُ معرّفَ غيرِه لم يكن ليصلَ إلى هنا أصلاً: الدالّةُ
--    تشتقُّ المستخدمَ بنفسِها، فقراءةُ موجَزِ غيرِك **غيرُ قابلةٍ للتعبيرِ** لا
--    «ممنوعةٌ بفحصٍ» (القسم 9.8 · وهوَ ما يفرضُه `F8-08` لاحقاً على كلِّ مسارٍ).
-- ---------------------------------------------------------------------------

create or replace function get_user_notifications(
  p_telegram_id bigint,
  p_limit integer default 20,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_items jsonb;
  v_unread integer;
begin
  select u.id into v_user from users u where u.telegram_id = p_telegram_id;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc), '[]'::jsonb)
    into v_items
    from (
      select n.id, n.kind, n.channel, n.payload, n.created_at, n.read_at
        from user_notifications n
       where n.user_id = v_user
         and (p_before is null or n.created_at < p_before)
       order by n.created_at desc
       limit v_limit
    ) t;

  select count(*)::integer into v_unread
    from user_notifications n
   where n.user_id = v_user and n.read_at is null;

  return jsonb_build_object('ok', true, 'items', v_items, 'unread', v_unread);
end $$;

-- ---------------------------------------------------------------------------
-- ٩) وسمُ إشعارٍ مقروءاً — ذرّيٌّ، ولا يُفشي وجودَ صفِّ غيرِك
--
--    معرّفٌ لا يخصُّ صاحبَ الجلسةِ يُعادُ عنه `NOT_FOUND` نفسُه الذي يُعادُ عن
--    معرّفٍ لا وجودَ له: تمييزُهما كانَ سيجعلُ المسارَ عرّافاً يُثبِتُ للمهاجمِ
--    وجودَ إشعارٍ لمستخدمٍ آخر. والوسمُ **ثابتُ الأثر**: إعادةُ الوسمِ لا تُحرِّكُ
--    الطابعَ الزمنيَّ الأوّلَ فلا «قُرِئَ» يُعادُ كتابتُه بكلِّ نقرةٍ.
-- ---------------------------------------------------------------------------

create or replace function mark_notification_read(
  p_telegram_id bigint,
  p_notification_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_prior_read_at timestamptz;
  v_found boolean := false;
  v_read_at timestamptz;
begin
  select u.id into v_user from users u where u.telegram_id = p_telegram_id;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  -- تُقرأُ القيمةُ السابقةُ **تحتَ قفلِ الصفِّ** قبلَ التحديثِ، لأنَّ `returning`
  -- تُعيدُ الجديدةَ وحدَها فلا تُميِّزُ «وُسِمَ الآنَ» من «كانَ موسوماً». وبلا
  -- القفلِ كانَ طلبانِ متزامنانِ يُعيدانِ معاً `already_read = false` فيُحسَبُ
  -- الوسمُ مرّتَينِ في أيِّ قياسٍ لزمنِ التفاعل.
  select n.read_at into v_prior_read_at
    from user_notifications n
   where n.id = p_notification_id and n.user_id = v_user
     for update;
  v_found := found;

  -- لا يُفرَّقُ «لا وجودَ له» من «ليسَ لك»: التفريقُ يجعلُ المسارَ عرّافاً يُثبِتُ
  -- للمهاجمِ وجودَ إشعارٍ لمستخدمٍ آخر.
  if not v_found then
    return jsonb_build_object('ok', false, 'error', 'NOTIFICATION_NOT_FOUND');
  end if;

  update user_notifications n
     set read_at = coalesce(n.read_at, now())
   where n.id = p_notification_id and n.user_id = v_user
  returning n.read_at into v_read_at;

  return jsonb_build_object(
    'ok', true,
    'read_at', v_read_at,
    'already_read', v_prior_read_at is not null
  );
end $$;

-- ---------------------------------------------------------------------------
-- ١٠) مدينةٌ جديدةٌ ترثُ السياسةَ — وترثُ **الأعلى صوتاً** لا الأهدأَ
--
--     البذرُ أعلاه يمسُّ المدنَ القائمةَ لحظةَ الترحيلِ وحدَها. ومدينةٌ تُنشأُ
--     غداً كانت ستبقى بلا صفوفِ سياسةٍ، فتُرسَلُ كلُّ أنواعِها افتراضاً — وهوَ
--     الميلُ الآمنُ لكنّه **ضمنيٌّ لا مُعلَنٌ**، فلا يُقرأُ في الجدولِ ولا يُراجَع.
--
--     والوراثةُ تنحازُ إلى `critical` إن اختلفت المدنُ: مدينةٌ جديدةٌ تُصعِّدُ ولا
--     تُهدِّئُ، لأنَّ إسكاتاً مُوروثاً بالخطأِ لا يُكتشَفُ إلّا بشكوى مستخدمٍ لم
--     يُبلَّغْ، وهوَ اكتشافٌ متأخّرٌ جدّاً. والتهدئةُ قرارٌ يُتَّخذُ لا يُورَث.
--
--     ويقعُ هذا بعدَ مُطلِّبِ `cities_seed_settings` في نفسِ عائلةِ المُطلِقاتِ،
--     ولا يُخفِقُ عندَ إنشاءِ أوّلِ مدينةٍ لعدمِ وجودِ أختٍ: صفرُ صفوفٍ حالةٌ
--     مشروعةٌ يتكفّلُ بها الافتراضُ نحوَ الإرسال.
-- ---------------------------------------------------------------------------

create or replace function seed_city_notification_policy(p_city uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_kind_policy (city_id, kind, channel, description_ar)
  select p_city,
         s.kind,
         -- `min` على ('critical','in_app') يُعيدُ 'critical' أبجديّاً، وهذا
         -- ليسَ اعتماداً على ترتيبِ الحروفِ: الشرطُ صريحٌ أدناه ولا يُقرأُ ضمناً.
         case when bool_or(s.channel = 'critical') then 'critical' else 'in_app' end,
         min(s.description_ar)
    from notification_kind_policy s
   where s.city_id <> p_city
   group by s.kind
  on conflict (city_id, kind) do nothing;
end $$;

create or replace function cities_seed_notification_policy_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_city_notification_policy(new.id);
  return null;
end $$;

revoke all on function seed_city_notification_policy(uuid) from public, anon, authenticated;
revoke all on function cities_seed_notification_policy_after_insert() from public, anon, authenticated;
grant execute on function seed_city_notification_policy(uuid) to service_role;

drop trigger if exists cities_seed_notification_policy on cities;
create trigger cities_seed_notification_policy
  after insert on cities
  for each row execute function cities_seed_notification_policy_after_insert();

-- ترميمُ ما مضى: كلُّ مدينةٍ قائمةٍ تُكمَلُ من أخواتِها. لا أثرَ له اليومَ —
-- البذرُ أعلاه شملَ الجميعَ — لكنَّ الترحيلةَ تُطبَّقُ على قواعدَ لا نراها،
-- وصمتُها عندَ التساوي هوَ الدليلُ لا الافتراض.
do $$
declare
  v_city uuid;
begin
  for v_city in select id from cities order by created_at, code loop
    perform seed_city_notification_policy(v_city);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- ١١) إغلاقُ السطحِ — لا `anon` ولا `authenticated` على شيءٍ ممّا أُنشئ
-- ---------------------------------------------------------------------------

revoke all on table notification_kind_policy from public, anon, authenticated;
revoke all on table user_notifications from public, anon, authenticated;
grant select, insert, update, delete on table notification_kind_policy to service_role;
grant select, insert, update, delete on table user_notifications to service_role;

revoke execute on function notification_kind_is_group_addressed(text) from public, anon, authenticated;
revoke execute on function resolve_notification_recipient(notification_outbox) from public, anon, authenticated;
revoke execute on function notification_outbox_classify() from public, anon, authenticated;
revoke execute on function notification_outbox_record_in_center() from public, anon, authenticated;
revoke execute on function get_user_notifications(bigint, integer, timestamptz) from public, anon, authenticated;
revoke execute on function mark_notification_read(bigint, uuid) from public, anon, authenticated;

grant execute on function notification_kind_is_group_addressed(text) to service_role;
grant execute on function resolve_notification_recipient(notification_outbox) to service_role;
grant execute on function get_user_notifications(bigint, integer, timestamptz) to service_role;
grant execute on function mark_notification_read(bigint, uuid) to service_role;
