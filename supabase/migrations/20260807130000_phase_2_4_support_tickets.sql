-- =============================================================================
-- وَصْلة — المرحلة 2.4 — قروب الدعم والنزاعات ومسار تفعيل الاشتراك الكامل (القسم 3.5)
--
-- القواعد الحاكمة المطبَّقة هنا حرفياً:
--   (0.3) لا قيمة تجارية داخل الكود  -> مهلة تكرار التذاكر ومدّة التفعيل في platform_settings
--   (0.4) كل جدول يحمل city_id       -> support_tickets يحمله ولا يقبل null
--   (0.5) كل عملية حرجة عبر RPC ذرّي -> الفتح والاستلام والحلّ كلها دوال أدناه
--
-- قرار تصميمي: لا صورة تُخزَّن عندنا.
--   تلغرام يحفظ الصورة ويعطينا file_id يصلح لإعادة الإرسال إلى أي محادثة يملكها البوت.
--   تنزيلها وتخزينها كان سيُدخلنا في تخزين ملفّات ونسخ احتياطي وحذف بيانات شخصية بلا
--   مقابل تشغيلي واحد. نخزّن المعرّف فقط، ونعيد إرسال الصورة نفسها للقروب عبره.
--
-- قرار تصميمي: لقطة الاشتراك تُقرأ لحظة الإرسال لا وقت الفتح.
--   الموظّف يقرّر بناءً على ما يراه في البطاقة. لو كانت اللقطة محفوظة وقت فتح التذكرة
--   فقد يُفعِّل اشتراكاً فعّله زميله قبل دقيقة. لذلك get_support_ticket_context تقرأ
--   subscriptions حياً في كل مرّة، ولا يوجد أي عمود مخزَّن لحالة الاشتراك في التذكرة.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- الأنواع المعدودة
-- ----------------------------------------------------------------------------
do $$ begin
  create type support_ticket_type as enum ('subscription', 'ride_dispute');
exception when duplicate_object then null; end $$;

-- claimed حالة وسيطة مقصودة: من استلم الحالة يظهر للبقية فلا يعمل اثنان على تذكرة واحدة
do $$ begin
  create type support_ticket_status as enum ('open', 'claimed', 'resolved', 'rejected');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 1) support_tickets — تذكرة واحدة لكل شكوى أو طلب تفعيل
-- ----------------------------------------------------------------------------
create table if not exists support_tickets (
  id                   uuid primary key default gen_random_uuid(),
  city_id              uuid not null references cities(id),
  type                 support_ticket_type not null,
  -- طرف واحد على الأقل: تذكرة بلا صاحب لا معنى لها ولا يمكن الردّ عليها
  driver_id            uuid references drivers(id) on delete cascade,
  rider_id             uuid references riders(id) on delete cascade,
  -- الطلب المرتبط بالنزاع إن وُجد — طلبات الاشتراك لا ترتبط بطلب
  order_id             uuid references orders(id) on delete set null,
  message              text not null,
  -- معرّف صورة تلغرام فقط: لا بايت واحد من الصورة عندنا
  attachment_file_id   text,
  status               support_ticket_status not null default 'open',
  -- من استلم الحالة من فريق الدعم، ومن حلّها — قد يكونان مختلفين
  claimed_by_user_id   uuid references users(id),
  resolved_by_user_id  uuid references users(id),
  resolution           text,
  group_message_id     bigint,
  claimed_at           timestamptz,
  resolved_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint support_tickets_requires_party check (
    driver_id is not null or rider_id is not null
  ),
  -- طلب التفعيل لا يأتي إلا من سائق: العميل لا اشتراك له
  constraint support_tickets_subscription_from_driver check (
    type <> 'subscription' or driver_id is not null
  ),
  -- كل حالة نهائية لها وقت ومَن نفّذها، وإلا صار سجلّ الدعم بلا مساءلة
  constraint support_tickets_settled_requires_actor check (
    status not in ('resolved', 'rejected')
    or (resolved_at is not null and resolved_by_user_id is not null)
  ),
  constraint support_tickets_claimed_requires_actor check (
    status <> 'claimed' or (claimed_at is not null and claimed_by_user_id is not null)
  )
);

create index if not exists support_tickets_city_status_idx
  on support_tickets (city_id, status, created_at desc);
create index if not exists support_tickets_driver_idx
  on support_tickets (driver_id, created_at desc);
create index if not exists support_tickets_rider_idx
  on support_tickets (rider_id, created_at desc);

drop trigger if exists support_tickets_set_updated_at on support_tickets;
create trigger support_tickets_set_updated_at
  before update on support_tickets
  for each row execute function set_updated_at();

alter table support_tickets enable row level security;

-- ----------------------------------------------------------------------------
-- 2) إعدادات الدعم لكل مدينة — لا رقم منها في الكود
-- ----------------------------------------------------------------------------
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, s.key, s.value, s.value_type, s.description_ar, s.is_provisional
  from cities c
 cross join (values
   -- مهلة بين تذكرتين من الشخص نفسه: تمنع إغراق قروب الدعم بالتكرار
   ('support_ticket_cooldown_seconds', '300'::jsonb, 'number',
    'أقلّ مدة بين تذكرتي دعم من الشخص نفسه', true),
   -- مدّة التفعيل الافتراضية عند موافقة الدعم
   ('support_activation_days', '30'::jsonb, 'number',
    'مدة الاشتراك بالأيام عند تفعيله يدوياً من قروب الدعم', true)
 ) as s(key, value, value_type, description_ar, is_provisional)
 on conflict (city_id, key) do nothing;

-- ----------------------------------------------------------------------------
-- 3) is_support_actor — من يملك التصرّف في تذاكر الدعم
--    الفحص هنا لا في التطبيق: صلاحية تُفحَص في مكان واحد لا في كل مسار استدعاء
-- ----------------------------------------------------------------------------
create or replace function is_support_actor(p_telegram_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_FOUND');
  end if;
  if v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_BLOCKED');
  end if;
  if v_user.role not in ('admin', 'support') then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_AUTHORIZED');
  end if;
  return jsonb_build_object(
    'ok', true,
    'user_id', v_user.id,
    'role', v_user.role,
    'city_id', v_user.city_id
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) open_support_ticket — يفتح تذكرة ويعيد كل ما تحتاجه البطاقة
--    يُستدعى من البوت مباشرة بمعرّف تلغرام: البوت لا يعرف معرّفاتنا الداخلية.
-- ----------------------------------------------------------------------------
create or replace function open_support_ticket(
  p_telegram_id bigint,
  p_type support_ticket_type,
  p_message text,
  p_file_id text default null,
  p_order_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
  v_driver_id uuid;
  v_rider_id uuid;
  v_city_id uuid;
  v_cooldown integer;
  v_last timestamptz;
  v_group bigint;
  v_id uuid;
begin
  if p_message is null or btrim(p_message) = '' then
    return jsonb_build_object('ok', false, 'error', 'MESSAGE_EMPTY');
  end if;

  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'USER_BLOCKED');
  end if;

  select id into v_driver_id from drivers where user_id = v_user.id;
  select id into v_rider_id from riders where user_id = v_user.id;
  if v_driver_id is null and v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_REGISTERED');
  end if;
  if p_type = 'subscription' and v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  v_city_id := v_user.city_id;

  select telegram_support_group_id into v_group from cities where id = v_city_id;
  if v_group is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_GROUP_MISSING');
  end if;

  -- حدّ التكرار: يُقاس على آخر تذكرة لهذا الشخص لا على عدد التذاكر، فلا يُعاقَب
  -- من فتح تذكرتين مشروعتين متباعدتين.
  v_cooldown := coalesce(get_setting_number(v_city_id, 'support_ticket_cooldown_seconds'), 0);
  if v_cooldown > 0 then
    select max(created_at) into v_last
      from support_tickets
     where (driver_id is not null and driver_id = v_driver_id)
        or (rider_id is not null and rider_id = v_rider_id);
    if v_last is not null and v_last > now() - make_interval(secs => v_cooldown) then
      return jsonb_build_object(
        'ok', false,
        'error', 'COOLDOWN_ACTIVE',
        'retry_after_seconds',
          ceil(extract(epoch from (v_last + make_interval(secs => v_cooldown)) - now()))::integer
      );
    end if;
  end if;

  -- النزاع يجب أن يتعلّق بطلب يملكه صاحب التذكرة فعلاً، وإلا صار باباً للتلصّص
  if p_order_id is not null then
    if not exists (
      select 1 from orders o
       where o.id = p_order_id
         and (o.rider_id = v_rider_id or o.assigned_driver_id = v_driver_id)
    ) then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_YOURS');
    end if;
  end if;

  insert into support_tickets
    (city_id, type, driver_id, rider_id, order_id, message, attachment_file_id)
  values
    (v_city_id, p_type,
     case when p_type = 'subscription' then v_driver_id else v_driver_id end,
     v_rider_id, p_order_id, btrim(p_message), nullif(btrim(coalesce(p_file_id, '')), ''))
  returning id into v_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_city_id, v_user.id, 'support.ticket_opened', 'support_ticket', v_id,
          jsonb_build_object('type', p_type, 'has_attachment', p_file_id is not null));

  return jsonb_build_object(
    'ok', true,
    'ticket_id', v_id,
    'city_id', v_city_id,
    'group_id', v_group,
    'type', p_type
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) get_support_ticket_context — كل ما تُظهره البطاقة، مقروءاً الآن
--    حالة الاشتراك تُقرأ من subscriptions في هذه اللحظة: لا ذاكرة وسيطة ولا لقطة قديمة.
-- ----------------------------------------------------------------------------
create or replace function get_support_ticket_context(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ticket support_tickets%rowtype;
  v_user users%rowtype;
  v_city cities%rowtype;
  v_sub subscriptions%rowtype;
begin
  select * into v_ticket from support_tickets where id = p_ticket_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
  end if;

  select * into v_city from cities where id = v_ticket.city_id;

  -- صاحب التذكرة: السائق إن وُجد، وإلا العميل
  if v_ticket.driver_id is not null then
    select u.* into v_user from users u join drivers d on d.user_id = u.id
     where d.id = v_ticket.driver_id;
    -- الاشتراك السارِي إن وُجد، وإلا آخر اشتراك مسجَّل ليرى الموظّف السياق كاملاً
    select * into v_sub from subscriptions
     where driver_id = v_ticket.driver_id
     order by (status in ('trialing', 'active')) desc, created_at desc
     limit 1;
  else
    select u.* into v_user from users u join riders r on r.user_id = u.id
     where r.id = v_ticket.rider_id;
  end if;

  if v_user.id is null then
    return jsonb_build_object('ok', false, 'error', 'TICKET_OWNER_MISSING');
  end if;

  return jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket.id,
    'type', v_ticket.type,
    'status', v_ticket.status,
    'message', v_ticket.message,
    'attachment_file_id', v_ticket.attachment_file_id,
    'order_id', v_ticket.order_id,
    'group_id', v_city.telegram_support_group_id,
    'city_id', v_ticket.city_id,
    'city_name', v_city.name_ar,
    'created_at', v_ticket.created_at,
    -- الهوية: الاسم والهاتف ومعرّف تلغرام دائماً، والمعرّف النصّي إن وُجد فقط
    'full_name', v_user.full_name,
    'phone', v_user.phone,
    'telegram_id', v_user.telegram_id,
    'telegram_username', v_user.telegram_username,
    'language_code', v_user.language_code,
    'driver_id', v_ticket.driver_id,
    'rider_id', v_ticket.rider_id,
    -- حالة الاشتراك لحظةَ القراءة
    'subscription', case when v_sub.id is null then null else jsonb_build_object(
      'plan', v_sub.plan,
      'status', v_sub.status,
      'current_period_end', v_sub.current_period_end,
      'trial_ends_at', v_sub.trial_ends_at,
      'is_live', v_sub.status in ('trialing', 'active')
                 and (v_sub.current_period_end is null or v_sub.current_period_end > now())
    ) end
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) attach_support_ticket_card — يحفظ معرّف رسالة البطاقة بعد نشرها فعلاً
-- ----------------------------------------------------------------------------
create or replace function attach_support_ticket_card(
  p_ticket_id uuid,
  p_message_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update support_tickets set group_message_id = p_message_id where id = p_ticket_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) claim_support_ticket — «استلام الحالة»: أوّل من يضغط يملكها
-- ----------------------------------------------------------------------------
create or replace function claim_support_ticket(
  p_ticket_id uuid,
  p_actor_telegram_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor jsonb;
  v_actor_id uuid;
  v_ticket support_tickets%rowtype;
  v_holder text;
begin
  v_actor := is_support_actor(p_actor_telegram_id);
  if not (v_actor->>'ok')::boolean then
    return v_actor;
  end if;
  v_actor_id := (v_actor->>'user_id')::uuid;

  -- القفل قبل الفحص: ضغطتان متزامنتان على «استلام» لا تُنتجان مالكين
  select * into v_ticket from support_tickets where id = p_ticket_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
  end if;
  if v_ticket.status in ('resolved', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'TICKET_ALREADY_SETTLED');
  end if;
  if v_ticket.status = 'claimed' then
    select full_name into v_holder from users where id = v_ticket.claimed_by_user_id;
    return jsonb_build_object(
      'ok', false,
      'error', 'TICKET_ALREADY_CLAIMED',
      'claimed_by', coalesce(v_holder, '')
    );
  end if;

  update support_tickets
     set status = 'claimed', claimed_by_user_id = v_actor_id, claimed_at = now()
   where id = p_ticket_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_ticket.city_id, v_actor_id, 'support.ticket_claimed', 'support_ticket', p_ticket_id,
          jsonb_build_object('role', v_actor->>'role'));

  return jsonb_build_object('ok', true, 'ticket_id', p_ticket_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8) resolve_support_ticket — القرار: تفعيل، أو إنهاء يدوي، أو رفض
--    الثلاثة في دالة واحدة لأنها كلها انتقال واحد للتذكرة + أثر واحد على الاشتراك،
--    وفصلها كان سيسمح بحالة «فُعِّل الاشتراك ولم تُقفل التذكرة».
-- ----------------------------------------------------------------------------
create or replace function resolve_support_ticket(
  p_ticket_id uuid,
  p_actor_telegram_id bigint,
  p_action text,
  p_note text default null,
  p_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor jsonb;
  v_actor_id uuid;
  v_ticket support_tickets%rowtype;
  v_days integer;
  v_activated jsonb;
  v_status support_ticket_status;
  v_owner_telegram bigint;
  v_owner_language text;
  v_terminated integer := 0;
begin
  if p_action not in ('activate', 'terminate', 'reject') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_ACTION');
  end if;

  v_actor := is_support_actor(p_actor_telegram_id);
  if not (v_actor->>'ok')::boolean then
    return v_actor;
  end if;
  v_actor_id := (v_actor->>'user_id')::uuid;

  select * into v_ticket from support_tickets where id = p_ticket_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
  end if;
  if v_ticket.status in ('resolved', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'TICKET_ALREADY_SETTLED');
  end if;

  if p_action in ('activate', 'terminate') and v_ticket.driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'TICKET_HAS_NO_DRIVER');
  end if;

  if p_action = 'activate' then
    v_days := coalesce(p_days, get_setting_number(v_ticket.city_id, 'support_activation_days')::integer);
    if v_days is null or v_days <= 0 then
      return jsonb_build_object('ok', false, 'error', 'ACTIVATION_DAYS_MISSING');
    end if;
    -- الخطّة: خطّة آخر اشتراك للسائق إن وُجدت، وإلا نقل. لا نخترع خطّة «both».
    v_activated := activate_subscription(
      v_ticket.driver_id,
      coalesce(
        (select plan from subscriptions where driver_id = v_ticket.driver_id
          order by created_at desc limit 1),
        'transport'::subscription_plan
      ),
      v_days
    );
    if not (v_activated->>'ok')::boolean then
      return v_activated;
    end if;
    v_status := 'resolved';

  elsif p_action = 'terminate' then
    update subscriptions
       set status = 'cancelled'
     where driver_id = v_ticket.driver_id and status in ('trialing', 'active');
    v_terminated := coalesce((select count(*) from subscriptions
                               where driver_id = v_ticket.driver_id
                                 and status = 'cancelled'), 0);
    v_status := 'resolved';

  else
    v_status := 'rejected';
  end if;

  update support_tickets
     set status = v_status,
         resolved_by_user_id = v_actor_id,
         resolved_at = now(),
         resolution = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_ticket_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_ticket.city_id, v_actor_id, 'support.ticket_' || p_action, 'support_ticket', p_ticket_id,
          jsonb_build_object('role', v_actor->>'role', 'days', v_days, 'note', p_note));

  -- معرّف تلغرام لصاحب التذكرة ولغته: البوت يحتاجهما ليبلّغه بالقرار بلغته
  -- بلا استعلام ثانٍ، ولأن التبليغ بلغة النظام لمن لا يقرؤها إخطارٌ ضائع.
  if v_ticket.driver_id is not null then
    select u.telegram_id, u.language_code into v_owner_telegram, v_owner_language
      from users u join drivers d on d.user_id = u.id where d.id = v_ticket.driver_id;
  else
    select u.telegram_id, u.language_code into v_owner_telegram, v_owner_language
      from users u join riders r on r.user_id = u.id where r.id = v_ticket.rider_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ticket_id', p_ticket_id,
    'action', p_action,
    'status', v_status,
    'type', v_ticket.type,
    'owner_telegram_id', v_owner_telegram,
    'owner_language', v_owner_language,
    'subscription', v_activated,
    'terminated_count', v_terminated
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 9) grant_bootstrap_admin — سدّ الفجوة: لا مسار لتعيين أول مسؤول
--    يُستدعى من مسار /start بمعرّف تلغرام واحد يأتي من متغيّر بيئة.
--    idempotent: من كان admin يبقى admin بلا صفّ تدقيق مكرَّر في كل /start.
-- ----------------------------------------------------------------------------
create or replace function grant_bootstrap_admin(p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
begin
  select * into v_user from users where telegram_id = p_telegram_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if v_user.role = 'admin' then
    return jsonb_build_object('ok', true, 'granted', false, 'user_id', v_user.id);
  end if;

  update users set role = 'admin' where id = v_user.id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'identity.bootstrap_admin_granted', 'user', v_user.id,
          jsonb_build_object('previous_role', v_user.role));

  return jsonb_build_object('ok', true, 'granted', true, 'user_id', v_user.id);
end;
$$;
