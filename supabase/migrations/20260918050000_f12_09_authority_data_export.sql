-- ═══════════════════════════════════════════════════════════════════════════════
-- F12-09 — قدرةُ تزويدِ الهيئةِ بالبيانات: حزمةٌ مُتعلَّمةٌ لا بثٌّ حيٌّ
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- البندُ: F12-09 في §16 — «قدرةُ تزويدِ الهيئةِ بالبياناتِ خلالَ 6 ساعاتٍ
-- (عاجل) و48 ساعةً (غيرُ عاجل)».
--
-- ADR 0040 يُفرِّقُ صراحةً بين F12-02 (تكاملٌ مستمرٌّ — محجوبٌ) وF12-09
-- («قدرةُ تزويدٍ عندَ الطلبِ لا تكاملَ نظامٍ مستمرّاً»). هذا البندُ يبني
-- القدرةَ لا التكاملَ: طلبٌ مُسجَّلٌ ⇒ تصنيفُ الموعدِ ⇒ توليدُ حزمةٍ ⇒ إيصالٌ
-- نحويٌّ. ولا إرسالَ خارجيَّ ولا قناةَ ولا مزوِّدَ.
--
-- الأقسامُ الستّةُ مصادرُها الجداولُ السياديّةُ القائمةُ:
--   drivers · riders · orders · safety_incidents · driver_documents · audit_log
--
-- قاعدةُ 0-4: city_id على كلِّ جدولٍ.
-- قاعدةُ 0-3: الإعداداتُ من platform_settings لا ثوابتَ.
-- قاعدةُ 0-6: المصدرُ واحدٌ، ولا يُكرَّر.
-- ح-8: لا يُمسُّ نصُّ بندٍ ولا توقيعُ دالّةٍ قائمة.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── ١) النوعُ: عاجلٌ أم آجل ───────────────────────────────────────────────────

do $$ begin
  create type authority_request_urgency as enum ('urgent', 'non_urgent');
exception when duplicate_object then null; end $$;

-- ── ٢) النوعُ: حالةُ الطلب ────────────────────────────────────────────────────

do $$ begin
  create type authority_request_status as enum ('requested', 'generated', 'delivered');
exception when duplicate_object then null; end $$;

-- ── ٣) جدولُ الطلبات ─────────────────────────────────────────────────────────

create table if not exists authority_data_requests (
  id              uuid primary key default gen_random_uuid(),
  city_id         uuid not null references cities(id) on delete restrict,
  requested_by    uuid not null references users(id) on delete restrict,
  urgency         authority_request_urgency not null,
  status          authority_request_status not null default 'requested',
  deadline_at     timestamptz not null,
  generated_at    timestamptz,
  package         jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists authority_data_requests_city_idx
  on authority_data_requests (city_id, created_at desc);
create index if not exists authority_data_requests_status_idx
  on authority_data_requests (status, deadline_at);

create trigger authority_data_requests_set_updated_at before update on authority_data_requests
  for each row execute function set_updated_at();

-- ── ٤) دالّةُ الموعدِ والانقضاءِ ─────────────────────────────────────────────

-- المواعيدُ النظاميّةُ: 6 ساعاتٍ للعاجلِ و48 للآجلِ. ولا يُعطى رقمٌ غيرُهما.
-- والدالّةُ نقيّةٌ تُحسَبُ من طلبٍ قائمٍ لا تُقاسُ بالساعةِ الداخليّةِ.

create or replace function authority_data_request_deadline(
  p_urgency authority_request_urgency,
  p_requested_at timestamptz
)
returns timestamptz
language sql
immutable
as $$
  select case
    when p_urgency = 'urgent' then p_requested_at + interval '6 hours'
    when p_urgency = 'non_urgent' then p_requested_at + interval '48 hours'
    else null
  end
$$;

comment on function authority_data_request_deadline(authority_request_urgency, timestamptz) is
  'F12-09: الموعدُ النظاميُّ لتزويدِ الهيئةِ — 6 ساعاتٍ للعاجلِ و48 للآجلِ. حكمٌ نقيٌّ يُحسَبُ لا يُخزَّن.';

-- هل انقضى الموعدُ؟
create or replace function authority_data_request_is_overdue(
  p_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from authority_data_requests
    where id = p_request_id
      and deadline_at < now()
      and status != 'delivered'
  )
$$;

comment on function authority_data_request_is_overdue(uuid) is
  'F12-09: هل انقضى موعدُ تزويدِ الهيئةِ بلا تسليمٍ.';

-- ── ٥) إنشاءُ الطلب ──────────────────────────────────────────────────────────

create or replace function create_authority_data_request(
  p_requested_by uuid,
  p_city_id uuid,
  p_urgency authority_request_urgency
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_request_id uuid;
  v_user_exists boolean;
begin
  if p_requested_by is null then
    raise exception 'INVALID_ACTOR';
  end if;

  select exists(select 1 from users where id = p_requested_by) into v_user_exists;
  if not v_user_exists then
    raise exception 'USER_NOT_FOUND';
  end if;

  if p_urgency is null then
    raise exception 'INVALID_URGENCY';
  end if;

  insert into authority_data_requests (
    city_id, requested_by, urgency, deadline_at
  ) values (
    p_city_id, p_requested_by, p_urgency,
    authority_data_request_deadline(p_urgency, now())
  )
  returning id into v_request_id;

  return v_request_id;
end;
$fn$;

comment on function create_authority_data_request(uuid, uuid, authority_request_urgency) is
  'F12-09: إنشاءُ طلبِ تزويدِ الهيئةِ بالبيانات. يُسجِّلُ الطلبَ ويُصنِّفُ الموعدَ.';

revoke execute on function create_authority_data_request(uuid, uuid, authority_request_urgency) from public, anon, authenticated;
grant execute on function create_authority_data_request(uuid, uuid, authority_request_urgency) to service_role;

-- ── ٦) توليدُ الحزمة ─────────────────────────────────────────────────────────

-- الحزمةُ ستّةُ أقسامٍ: سائق · سيارة · رحلة · سلامة · وثائق · تدقيق.
-- كلُّ قسمٍ مصدرُه جدولُه. وغيابُ قسمٍ يُنشَرُ باسمِه لا يُسكَتُ.
-- والبياناتُ تُجمَعُ JSONB لا تُرسَلُ — فالإرسالُ قرارُ مالكٍ لا قرارَ منفِّذ.

create or replace function generate_authority_data_package(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_request    authority_data_requests;
  v_drivers    jsonb;
  v_riders     jsonb;
  v_orders     jsonb;
  v_safety     jsonb;
  v_documents  jsonb;
  v_audit      jsonb;
begin
  select * into v_request from authority_data_requests where id = p_request_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'REQUEST_NOT_FOUND');
  end if;

  if v_request.status = 'delivered' then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_DELIVERED');
  end if;

  -- الأقسامُ الستّةُ — كلٌّ منها يَردُّ ببياناتٍ أو بـDOMAIN_NOT_AVAILABLE
  -- السائقون
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', d.id, 'user_id', d.user_id, 'city_id', d.city_id,
      'verification_status', d.verification_status,
      'vehicle_type', d.vehicle_type, 'plate_number', d.plate_number,
      'rating_average', d.rating_average, 'rating_count', d.rating_count,
      'created_at', d.created_at, 'updated_at', d.updated_at
    )),
    jsonb_build_array()
  ) into v_drivers
  from drivers d where d.city_id = v_request.city_id;

  -- الراكبون
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', r.id, 'user_id', r.user_id, 'city_id', r.city_id,
      'created_at', r.created_at, 'updated_at', r.updated_at
    )),
    jsonb_build_array()
  ) into v_riders
  from riders r where r.city_id = v_request.city_id;

  -- الرحلات
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', o.id, 'city_id', o.city_id, 'rider_id', o.rider_id,
      'service', o.service, 'status', o.status,
      'assigned_driver_id', o.assigned_driver_id,
      'matched_at', o.matched_at, 'started_at', o.started_at,
      'completed_at', o.completed_at, 'cancelled_reason', o.cancelled_reason,
      'created_at', o.created_at, 'updated_at', o.updated_at
    )),
    jsonb_build_array()
  ) into v_orders
  from orders o where o.city_id = v_request.city_id;

  -- السلامة
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', s.id, 'city_id', s.city_id, 'order_id', s.order_id,
      'reporter_user_id', s.reporter_user_id, 'reporter_role', s.reporter_role,
      'status', s.status, 'created_at', s.created_at, 'updated_at', s.updated_at
    )),
    jsonb_build_array()
  ) into v_safety
  from safety_incidents s where s.city_id = v_request.city_id;

  -- الوثائق
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', doc.id, 'driver_id', doc.driver_id, 'city_id', doc.city_id,
      'doc_type', doc.doc_type, 'status', doc.status,
      'expires_at', doc.expires_at, 'submitted_at', doc.submitted_at,
      'reviewed_at', doc.reviewed_at
    )),
    jsonb_build_array()
  ) into v_documents
  from driver_documents doc where doc.city_id = v_request.city_id;

  -- التدقيق
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', a.id, 'city_id', a.city_id, 'actor_user_id', a.actor_user_id,
      'action', a.action, 'entity_type', a.entity_type, 'entity_id', a.entity_id,
      'created_at', a.created_at
    )),
    jsonb_build_array()
  ) into v_audit
  from audit_log a where a.city_id = v_request.city_id;

  -- الحزمةُ الكاملةُ — كلُّ قسمٍ يُنشَرُ باسمِه
  -- والقسمُ الفارغُ يُنشَرُ بـDOMAIN_NOT_AVAILABLE لا يُسكَتُ
  update authority_data_requests
  set status = 'generated',
      generated_at = now(),
      package = jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'generated_at', now(),
    'deadline_at', v_request.deadline_at,
    'sections', jsonb_build_object(
      'drivers', case when v_drivers = jsonb_build_array() then to_jsonb('DOMAIN_NOT_AVAILABLE'::text) else v_drivers end,
      'riders', case when v_riders = jsonb_build_array() then to_jsonb('DOMAIN_NOT_AVAILABLE'::text) else v_riders end,
      'orders', case when v_orders = jsonb_build_array() then to_jsonb('DOMAIN_NOT_AVAILABLE'::text) else v_orders end,
      'safety', case when v_safety = jsonb_build_array() then to_jsonb('DOMAIN_NOT_AVAILABLE'::text) else v_safety end,
      'documents', case when v_documents = jsonb_build_array() then to_jsonb('DOMAIN_NOT_AVAILABLE'::text) else v_documents end,
      'audit', case when v_audit = jsonb_build_array() then to_jsonb('DOMAIN_NOT_AVAILABLE'::text) else v_audit end
    )
  )
  where id = p_request_id;

  return jsonb_build_object('ok', true, 'request_id', p_request_id);
end;
$fn$;

comment on function generate_authority_data_package(uuid) is
  'F12-09: توليدُ حزمةِ بياناتٍ من ستّةِ أقسامٍ للهيئة. الحزمةُ JSONB لا إرسالَ خارجيَّ.';

revoke execute on function generate_authority_data_package(uuid) from public, anon, authenticated;
grant execute on function generate_authority_data_package(uuid) to service_role;

-- ── ٧) RLS ────────────────────────────────────────────────────────────────────

alter table authority_data_requests enable row level security;
create policy authority_data_requests_service_role_all
  on authority_data_requests
  for all
  to service_role
  using (true)
  with check (true);
revoke all on authority_data_requests from public, anon, authenticated;
grant select, insert, update on authority_data_requests to service_role;
