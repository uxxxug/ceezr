-- =============================================================================
-- وَصْلة — المرحلة 2.3 — قروب السائقين غير المشتركين وآلية الثلاثة (القسم 3.4)
--
-- القواعد الحاكمة المطبَّقة هنا حرفياً:
--   (0.3) لا قيمة تجارية داخل الكود  -> عدد المقاعد والمهل ودورات الإعادة كلها في platform_settings
--   (0.4) كل جدول يحمل city_id       -> الجدولان الجديدان يحملانه
--   (0.5) كل عملية حرجة عبر RPC ذرّي -> التسجيل والتدوير والاتفاق كلها دوال أدناه
--
-- لماذا جدولان لا جدول واحد:
--   الدورة (negotiation) كيان له حالة ومهلة وبطاقة منشورة في القروب، والمطالبة (claim)
--   كيان له ترتيب ومصير. دمجهما كان سيعني تكرار حالة الدورة في كل صفّ مطالبة،
--   وهو أصل كل تعارض بيانات لاحق.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- الأنواع المعدودة
-- ----------------------------------------------------------------------------
do $$ begin
  create type negotiation_status as enum
    ('collecting', 'negotiating', 'agreed', 'exhausted', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type claim_outcome as enum
    ('waiting', 'negotiating', 'declined', 'expired', 'agreed', 'cancelled');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 1) unsubscribed_negotiations — دورة نشرٍ واحدة لطلب واحد في قروب غير المشتركين
-- ----------------------------------------------------------------------------
create table if not exists unsubscribed_negotiations (
  id                  uuid primary key default gen_random_uuid(),
  city_id             uuid not null references cities(id),
  order_id            uuid not null references orders(id) on delete cascade,
  -- رقم الدورة يبدأ من 1 ويتصاعد عند كل إعادة نشر (الخطوة 5 من القسم 3.4)
  cycle               integer not null check (cycle >= 1),
  status              negotiation_status not null default 'collecting',
  -- معرّف رسالة البطاقة في القروب — يُملأ بعد نشرها فعلاً، ويبقى null إن فشل النشر
  group_message_id    bigint,
  -- المطالبة النشطة الآن: من فُتح معه التواصل. null قبل أول تسجيل وبعد النفاد
  active_claim_id     uuid,
  -- مهلة جمع المطالبات، ومهلة تفاوض المطالبة النشطة — كلتاهما من platform_settings
  collect_deadline    timestamptz not null,
  negotiate_deadline  timestamptz,
  settled_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint unsubscribed_negotiations_order_cycle_unique unique (order_id, cycle),
  -- التفاوض يقتضي مطالبة نشطة، والاتفاق يقتضي وقتاً مسجَّلاً — لا حالة معلَّقة بلا سبب
  constraint unsubscribed_negotiations_active_requires_claim check (
    status <> 'negotiating' or active_claim_id is not null
  ),
  constraint unsubscribed_negotiations_agreed_requires_time check (
    status <> 'agreed' or settled_at is not null
  )
);

-- دورة واحدة حيّة لكل طلب: لا نشرتان متزامنتان لنفس الطلب في القروب نفسه
create unique index if not exists unsubscribed_negotiations_single_open
  on unsubscribed_negotiations (order_id)
  where status in ('collecting', 'negotiating');

create index if not exists unsubscribed_negotiations_city_status_idx
  on unsubscribed_negotiations (city_id, status);

-- ----------------------------------------------------------------------------
-- 2) unsubscribed_claims — ضغطة زرّ «قبول» مسجَّلة بترتيبها
-- ----------------------------------------------------------------------------
create table if not exists unsubscribed_claims (
  id              uuid primary key default gen_random_uuid(),
  city_id         uuid not null references cities(id),
  negotiation_id  uuid not null references unsubscribed_negotiations(id) on delete cascade,
  order_id        uuid not null references orders(id) on delete cascade,
  driver_id       uuid not null references drivers(id),
  -- ترتيب الضغطة: 1 هو الأول الذي يُفتح معه التواصل. الحدّ الأعلى من الإعدادات لا من قيد
  position        integer not null check (position >= 1),
  outcome         claim_outcome not null default 'waiting',
  opened_at       timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- الشرطان اللذان يمنعان الغشّ: لا تسجيل مكرّر لنفس السائق، ولا ترتيبان متطابقان
  constraint unsubscribed_claims_one_per_driver unique (negotiation_id, driver_id),
  constraint unsubscribed_claims_position_unique unique (negotiation_id, position)
);

create index if not exists unsubscribed_claims_order_idx
  on unsubscribed_claims (order_id);
create index if not exists unsubscribed_claims_driver_idx
  on unsubscribed_claims (driver_id);

alter table unsubscribed_negotiations
  add constraint unsubscribed_negotiations_active_claim_fk
  foreign key (active_claim_id) references unsubscribed_claims(id) on delete set null;

-- محفّزات updated_at
drop trigger if exists set_updated_at_unsubscribed_negotiations on unsubscribed_negotiations;
create trigger set_updated_at_unsubscribed_negotiations
  before update on unsubscribed_negotiations
  for each row execute function set_updated_at();

drop trigger if exists set_updated_at_unsubscribed_claims on unsubscribed_claims;
create trigger set_updated_at_unsubscribed_claims
  before update on unsubscribed_claims
  for each row execute function set_updated_at();

-- RLS مفعّلة منذ الإنشاء (ADR 0006 يوثّق أن التطبيق يتصل كمالك فيتجاوزها اليوم)
alter table unsubscribed_negotiations enable row level security;
alter table unsubscribed_claims        enable row level security;

-- ----------------------------------------------------------------------------
-- 3) الإعدادات الجديدة — لا رقم من هذه الأربعة داخل الكود إطلاقاً
-- ----------------------------------------------------------------------------
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, s.key, s.value, s.value_type, s.description_ar, s.is_provisional
from cities c
cross join (values
  ('unsubscribed_claim_slots',       '3'::jsonb,   'number',
   'عدد السائقين غير المشتركين الذين تُسجَّل ضغطاتهم في الدورة الواحدة', false),
  ('unsubscribed_collect_seconds',   '120'::jsonb, 'number',
   'مهلة جمع الضغطات على بطاقة القروب قبل إغلاق الدورة', true),
  ('unsubscribed_negotiate_seconds', '180'::jsonb, 'number',
   'مهلة تفاوض السائق الواحد مع الزبون قبل الانتقال للذي يليه', true),
  ('unsubscribed_max_cycles',        '3'::jsonb,   'number',
   'عدد دورات إعادة النشر قبل التصعيد إلى قروب الإسناد', true)
) as s(key, value, value_type, description_ar, is_provisional)
on conflict (city_id, key) do nothing;

-- ----------------------------------------------------------------------------
-- 4) open_unsubscribed_cycle — فتح دورة نشر جديدة لطلب لم يجد سائقاً مشتركاً
--
-- يعيد أيضاً معرّفات سائقي الدورة السابقة: هم الممنوعون من التسجيل في هذه الدورة
-- (الخطوة 5 من القسم 3.4). المنع نفسه مُطبَّق داخل register_unsubscribed_claim،
-- والقائمة تُعاد هنا ليعرف البوت من يُخفي عنه الزرّ بدل أن يُحبطه برفض بعد الضغط.
-- ----------------------------------------------------------------------------
create or replace function open_unsubscribed_cycle(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      orders%rowtype;
  v_now        timestamptz := now();
  v_cycle      integer;
  v_max_cycles integer;
  v_collect    integer;
  v_group      bigint;
  v_prev_id    uuid;
  v_excluded   uuid[] := array[]::uuid[];
  v_new_id     uuid;
begin
  select * into v_order
    from orders
   where id = p_order_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  -- دورة القروب لا تُفتح إلا لطلب ما زال يبحث فعلاً
  if v_order.status <> 'searching' then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_SEARCHING');
  end if;

  -- القروب شرط: مدينة بلا معرّف قروب غير مشتركين لا تُنشر فيها بطاقة
  select telegram_unsubscribed_drivers_group_id into v_group
    from cities where id = v_order.city_id;
  if v_group is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_GROUP_MISSING');
  end if;

  -- دورة حيّة قائمة؟ لا نفتح ثانية فوقها
  if exists (
    select 1 from unsubscribed_negotiations
     where order_id = p_order_id and status in ('collecting', 'negotiating')
  ) then
    return jsonb_build_object('ok', false, 'error', 'CYCLE_ALREADY_OPEN');
  end if;

  v_max_cycles := get_setting_number(v_order.city_id, 'unsubscribed_max_cycles')::integer;
  v_collect    := get_setting_number(v_order.city_id, 'unsubscribed_collect_seconds')::integer;

  select coalesce(max(cycle), 0) + 1 into v_cycle
    from unsubscribed_negotiations where order_id = p_order_id;

  -- نفدت الدورات: هذا هو مدخل قروب الإسناد، لا حلقة لا نهائية
  if v_cycle > v_max_cycles then
    return jsonb_build_object('ok', false, 'error', 'CYCLES_EXHAUSTED',
                              'cycles', v_cycle - 1);
  end if;

  -- سائقو الدورة المباشرة السابقة ممنوعون من التسجيل في هذه
  if v_cycle > 1 then
    select id into v_prev_id
      from unsubscribed_negotiations
     where order_id = p_order_id and cycle = v_cycle - 1;
    select coalesce(array_agg(driver_id), array[]::uuid[]) into v_excluded
      from unsubscribed_claims where negotiation_id = v_prev_id;
  end if;

  insert into unsubscribed_negotiations
    (city_id, order_id, cycle, status, collect_deadline)
  values
    (v_order.city_id, p_order_id, v_cycle, 'collecting',
     v_now + make_interval(secs => v_collect))
  returning id into v_new_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, null, 'unsubscribed.cycle_opened', 'order', p_order_id,
          jsonb_build_object('negotiation_id', v_new_id, 'cycle', v_cycle,
                             'excluded_driver_ids', to_jsonb(v_excluded)));

  return jsonb_build_object(
    'ok', true,
    'negotiation_id', v_new_id,
    'cycle', v_cycle,
    'city_id', v_order.city_id,
    'service', v_order.service,
    'group_id', v_group,
    'collect_deadline', v_now + make_interval(secs => v_collect),
    'excluded_driver_ids', to_jsonb(v_excluded)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) register_unsubscribed_claim — ضغطة «قبول» واحدة، ذرّية
--
-- يمنع: تسجيل نفس السائق مرتين، تجاوز عدد المقاعد، تسجيل سائق الدورة السابقة،
-- والسائق من مدينة أخرى. أول من يُسجَّل يُفتح معه التواصل فوراً بلا انتظار اكتمال الثلاثة.
-- ----------------------------------------------------------------------------
create or replace function register_unsubscribed_claim(
  p_negotiation_id uuid,
  p_driver_id      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neg       unsubscribed_negotiations%rowtype;
  v_driver    drivers%rowtype;
  v_now       timestamptz := now();
  v_slots     integer;
  v_negotiate integer;
  v_taken     integer;
  v_position  integer;
  v_claim_id  uuid;
  v_prev_id   uuid;
  v_is_active boolean := false;
begin
  -- القفل على صفّ الدورة هو ما يجعل «أول ثلاث ضغطات» صحيحاً تحت التزامن
  select * into v_neg
    from unsubscribed_negotiations
   where id = p_negotiation_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NEGOTIATION_NOT_FOUND');
  end if;

  if v_neg.status not in ('collecting', 'negotiating') then
    return jsonb_build_object('ok', false, 'error', 'NEGOTIATION_CLOSED');
  end if;

  if v_neg.collect_deadline <= v_now then
    return jsonb_build_object('ok', false, 'error', 'COLLECT_WINDOW_CLOSED');
  end if;

  select * into v_driver from drivers where id = p_driver_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;
  if v_driver.city_id <> v_neg.city_id then
    return jsonb_build_object('ok', false, 'error', 'CITY_MISMATCH');
  end if;
  if v_driver.verification_status <> 'verified' then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_VERIFIED');
  end if;

  if exists (
    select 1 from unsubscribed_claims
     where negotiation_id = p_negotiation_id and driver_id = p_driver_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_CLAIMED');
  end if;

  -- الممنوعون: سائقو الدورة المباشرة السابقة لنفس الطلب
  if v_neg.cycle > 1 then
    select id into v_prev_id
      from unsubscribed_negotiations
     where order_id = v_neg.order_id and cycle = v_neg.cycle - 1;
    if exists (
      select 1 from unsubscribed_claims
       where negotiation_id = v_prev_id and driver_id = p_driver_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'EXCLUDED_PREVIOUS_CYCLE');
    end if;
  end if;

  v_slots := get_setting_number(v_neg.city_id, 'unsubscribed_claim_slots')::integer;

  select count(*) into v_taken
    from unsubscribed_claims where negotiation_id = p_negotiation_id;

  if v_taken >= v_slots then
    return jsonb_build_object('ok', false, 'error', 'SLOTS_FULL', 'slots', v_slots);
  end if;

  v_position := v_taken + 1;
  v_is_active := (v_position = 1);

  insert into unsubscribed_claims
    (city_id, negotiation_id, order_id, driver_id, position, outcome, opened_at)
  values
    (v_neg.city_id, p_negotiation_id, v_neg.order_id, p_driver_id, v_position,
     case when v_is_active then 'negotiating'::claim_outcome else 'waiting'::claim_outcome end,
     case when v_is_active then v_now else null end)
  returning id into v_claim_id;

  -- الأول يفتح التفاوض فوراً؛ من بعده ينتظر دوره بلا أن يُعطَّل جمع البقية
  if v_is_active then
    v_negotiate := get_setting_number(v_neg.city_id, 'unsubscribed_negotiate_seconds')::integer;
    update unsubscribed_negotiations
       set status = 'negotiating',
           active_claim_id = v_claim_id,
           negotiate_deadline = v_now + make_interval(secs => v_negotiate)
     where id = p_negotiation_id;
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_neg.city_id, v_driver.user_id, 'unsubscribed.claim_registered', 'order',
          v_neg.order_id,
          jsonb_build_object('negotiation_id', p_negotiation_id, 'claim_id', v_claim_id,
                             'driver_id', p_driver_id, 'position', v_position,
                             'cycle', v_neg.cycle));

  return jsonb_build_object('ok', true, 'claim_id', v_claim_id, 'position', v_position,
                            'slots', v_slots, 'is_active', v_is_active,
                            'order_id', v_neg.order_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) advance_unsubscribed_negotiation — إغلاق المطالبة النشطة وفتح التي تليها
--
-- يُستدعى عند رفض الزبون، أو انتهاء مهلة التفاوض بلا اتفاق صريح.
-- إن لم يبقَ أحد: الدورة 'exhausted' — وعندها يقرّر العامل إعادة النشر أو التصعيد.
-- ----------------------------------------------------------------------------
create or replace function advance_unsubscribed_negotiation(
  p_negotiation_id uuid,
  p_reason         text default 'declined'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neg       unsubscribed_negotiations%rowtype;
  v_active    unsubscribed_claims%rowtype;
  v_next      unsubscribed_claims%rowtype;
  v_now       timestamptz := now();
  v_negotiate integer;
  v_outcome   claim_outcome;
begin
  select * into v_neg
    from unsubscribed_negotiations
   where id = p_negotiation_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NEGOTIATION_NOT_FOUND');
  end if;
  if v_neg.status <> 'negotiating' or v_neg.active_claim_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_NEGOTIATING');
  end if;

  v_outcome := case when p_reason = 'expired' then 'expired'::claim_outcome
                    else 'declined'::claim_outcome end;

  select * into v_active from unsubscribed_claims where id = v_neg.active_claim_id;

  update unsubscribed_claims
     set outcome = v_outcome, closed_at = v_now
   where id = v_neg.active_claim_id;

  -- التالي في الترتيب، لا الأقرب ولا الأعلى تقييماً: الترتيب هو العدل هنا
  select * into v_next
    from unsubscribed_claims
   where negotiation_id = p_negotiation_id
     and outcome = 'waiting'
   order by position
   limit 1
     for update;

  if not found then
    update unsubscribed_negotiations
       set status = 'exhausted', active_claim_id = null, negotiate_deadline = null
     where id = p_negotiation_id;

    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (v_neg.city_id, null, 'unsubscribed.cycle_exhausted', 'order', v_neg.order_id,
            jsonb_build_object('negotiation_id', p_negotiation_id, 'cycle', v_neg.cycle,
                               'last_position', v_active.position, 'reason', p_reason));

    return jsonb_build_object('ok', true, 'exhausted', true,
                              'order_id', v_neg.order_id, 'cycle', v_neg.cycle);
  end if;

  v_negotiate := get_setting_number(v_neg.city_id, 'unsubscribed_negotiate_seconds')::integer;

  update unsubscribed_claims
     set outcome = 'negotiating', opened_at = v_now
   where id = v_next.id;

  update unsubscribed_negotiations
     set active_claim_id = v_next.id,
         negotiate_deadline = v_now + make_interval(secs => v_negotiate)
   where id = p_negotiation_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_neg.city_id, null, 'unsubscribed.negotiation_advanced', 'order', v_neg.order_id,
          jsonb_build_object('negotiation_id', p_negotiation_id,
                             'from_position', v_active.position,
                             'to_position', v_next.position, 'reason', p_reason));

  return jsonb_build_object('ok', true, 'exhausted', false,
                            'claim_id', v_next.id, 'position', v_next.position,
                            'driver_id', v_next.driver_id, 'order_id', v_neg.order_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) settle_unsubscribed_negotiation — الزبون ضغط «تم الاتفاق»
--
-- الاتفاق هنا يعادل claim_ride في المسار المشترك: الطلب يصير matched بنفس الذرّية
-- ونفس الحراسة (الطلب ما زال يبحث، ولا إسناد مزدوج).
-- ----------------------------------------------------------------------------
create or replace function settle_unsubscribed_negotiation(p_negotiation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neg    unsubscribed_negotiations%rowtype;
  v_claim  unsubscribed_claims%rowtype;
  v_order  orders%rowtype;
  v_driver drivers%rowtype;
  v_now    timestamptz := now();
begin
  select * into v_neg
    from unsubscribed_negotiations
   where id = p_negotiation_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NEGOTIATION_NOT_FOUND');
  end if;
  if v_neg.status <> 'negotiating' or v_neg.active_claim_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_NEGOTIATING');
  end if;

  select * into v_order
    from orders
   where id = v_neg.order_id and status = 'searching'
     for update skip locked;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_CLAIMABLE');
  end if;

  select * into v_claim from unsubscribed_claims where id = v_neg.active_claim_id;
  select * into v_driver from drivers where id = v_claim.driver_id;

  update unsubscribed_claims
     set outcome = 'agreed', closed_at = v_now
   where id = v_claim.id;

  -- من لم يصل دوره لا يبقى معلَّقاً: الاتفاق يُغلق الدورة كلّها
  update unsubscribed_claims
     set outcome = 'cancelled', closed_at = v_now
   where negotiation_id = p_negotiation_id and outcome = 'waiting';

  update unsubscribed_negotiations
     set status = 'agreed', settled_at = v_now, negotiate_deadline = null
   where id = p_negotiation_id;

  -- أي عرض معلَّق في المسار المشترك يُلغى: لا مسارا إسناد لطلب واحد
  update order_offers
     set status = 'cancelled', responded_at = v_now
   where order_id = v_neg.order_id and status = 'pending';

  update orders
     set status = 'matched', assigned_driver_id = v_claim.driver_id, matched_at = v_now
   where id = v_neg.order_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_neg.city_id, v_driver.user_id, 'unsubscribed.agreed', 'order', v_neg.order_id,
          jsonb_build_object('negotiation_id', p_negotiation_id, 'claim_id', v_claim.id,
                             'driver_id', v_claim.driver_id, 'position', v_claim.position,
                             'cycle', v_neg.cycle));

  return jsonb_build_object('ok', true, 'order_id', v_neg.order_id,
                            'driver_id', v_claim.driver_id, 'matched_at', v_now);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8) escalate_order — التصعيد إلى قروب الإسناد بعد نفاد الدورات
--
-- التصعيد لا يُلغي الطلب: يبقى 'searching' ليتمكّن موظف الإسناد من التصرّف،
-- والأثر يُسجَّل في audit_log ليكون قابلاً للمراجعة لا مجرّد رسالة عابرة.
-- ----------------------------------------------------------------------------
create or replace function escalate_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_group bigint;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  select telegram_escalation_group_id into v_group
    from cities where id = v_order.city_id;
  if v_group is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_GROUP_MISSING');
  end if;

  -- تصعيد واحد لكل طلب: لا إغراق لقروب الإسناد بنفس الحالة كل دقيقة
  if exists (
    select 1 from audit_log
     where entity_type = 'order' and entity_id = p_order_id
       and action = 'order.escalated'
  ) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_ESCALATED',
                              'group_id', v_group);
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, null, 'order.escalated', 'order', p_order_id,
          jsonb_build_object('reason', p_reason, 'service', v_order.service));

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'group_id', v_group,
                            'city_id', v_order.city_id, 'service', v_order.service);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9) close_unsubscribed_negotiation — إغلاق نهائي لدورة لم تعد تنتظر شيئاً
--
-- بلا هذه الدالة تبقى الدورة المنفودة في نتائج العامل إلى الأبد، فيُعاد التصعيد
-- كل دقيقة على نفس الطلب. الإغلاق هو ما يجعل المهمة الدورية idempotent فعلاً.
-- ----------------------------------------------------------------------------
create or replace function close_unsubscribed_negotiation(
  p_negotiation_id uuid,
  p_reason         text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neg unsubscribed_negotiations%rowtype;
  v_now timestamptz := now();
begin
  select * into v_neg
    from unsubscribed_negotiations
   where id = p_negotiation_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NEGOTIATION_NOT_FOUND');
  end if;

  -- الاتفاق لا يُنقض بإغلاق: من اتُّفق معه اتُّفق
  if v_neg.status = 'agreed' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_AGREED');
  end if;
  if v_neg.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_CLOSED');
  end if;

  update unsubscribed_claims
     set outcome = 'cancelled', closed_at = v_now
   where negotiation_id = p_negotiation_id
     and outcome in ('waiting', 'negotiating');

  update unsubscribed_negotiations
     set status = 'cancelled', active_claim_id = null, negotiate_deadline = null
   where id = p_negotiation_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_neg.city_id, null, 'unsubscribed.cycle_closed', 'order', v_neg.order_id,
          jsonb_build_object('negotiation_id', p_negotiation_id, 'cycle', v_neg.cycle,
                             'reason', p_reason));

  return jsonb_build_object('ok', true, 'negotiation_id', p_negotiation_id,
                            'order_id', v_neg.order_id);
end;
$$;
