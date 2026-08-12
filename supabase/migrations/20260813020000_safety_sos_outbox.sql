-- SOS safety incidents: database-first outbox and human-only resolution.
-- The prior safety package was a declared skeleton. It is activated on 2026-08-13:
-- write the incident and its delivery work atomically before any Telegram call, so a
-- failed bot request can never erase an emergency report.

create table if not exists safety_incidents (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id) on delete restrict,
  order_id uuid not null references orders(id) on delete restrict,
  reporter_user_id uuid not null references users(id) on delete restrict,
  reporter_role text not null check (reporter_role in ('rider', 'driver')),
  status text not null default 'open' check (status in ('open', 'received', 'closed')),
  last_known_location geography(Point, 4326),
  claimed_by_user_id uuid references users(id) on delete restrict,
  claimed_at timestamptz,
  decision text check (decision in ('close', 'block_reporter')),
  decided_by_user_id uuid references users(id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_incidents_claim_pair check (
    (claimed_by_user_id is null and claimed_at is null) or
    (claimed_by_user_id is not null and claimed_at is not null)
  ),
  constraint safety_incidents_decision_pair check (
    (decision is null and decided_by_user_id is null and decided_at is null) or
    (decision is not null and decided_by_user_id is not null and decided_at is not null)
  ),
  constraint safety_incidents_closed_has_decision check (
    (status <> 'closed') or decision is not null
  )
);
create index if not exists safety_incidents_order_reporter_created_idx
  on safety_incidents(order_id, reporter_user_id, created_at desc);
create index if not exists safety_incidents_open_idx
  on safety_incidents(city_id, status, created_at) where status <> 'closed';
drop trigger if exists safety_incidents_set_updated_at on safety_incidents;
create trigger safety_incidents_set_updated_at before update on safety_incidents
  for each row execute function set_updated_at();

create table if not exists safety_incident_deliveries (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id) on delete restrict,
  incident_id uuid not null unique references safety_incidents(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'delivered')),
  attempts integer not null default 0 check (attempts >= 0),
  claim_token uuid,
  next_attempt_at timestamptz not null default now(),
  delivered_message_id bigint,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_delivery_delivered_pair check (
    (status <> 'delivered') or (delivered_at is not null and delivered_message_id is not null)
  )
);
create index if not exists safety_incident_deliveries_due_idx
  on safety_incident_deliveries(status, next_attempt_at) where status = 'pending';
drop trigger if exists safety_incident_deliveries_set_updated_at on safety_incident_deliveries;
create trigger safety_incident_deliveries_set_updated_at before update on safety_incident_deliveries
  for each row execute function set_updated_at();

alter table safety_incidents enable row level security;
alter table safety_incident_deliveries enable row level security;
drop policy if exists safety_incidents_service_role on safety_incidents;
create policy safety_incidents_service_role on safety_incidents for all to service_role using (true) with check (true);
drop policy if exists safety_incident_deliveries_service_role on safety_incident_deliveries;
create policy safety_incident_deliveries_service_role on safety_incident_deliveries for all to service_role using (true) with check (true);

-- Settings are per-city, as are all SOS deduplication and retry policies.
insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'sos_dedup_window_seconds', '120'::jsonb, 'number',
       'نافذة منع تكرار نداء SOS من الطرف نفسه للطلب نفسه'
from cities
on conflict (city_id, key) do nothing;
insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'sos_delivery_retry_seconds', '30'::jsonb, 'number',
       'الفاصل بين محاولات تسليم بطاقة SOS إلى قروب الإسناد'
from cities
on conflict (city_id, key) do nothing;
insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'sos_delivery_max_attempts', '3'::jsonb, 'number',
       'عدد محاولات تسليم SOS التي ينفذها عامل واحد في شوطه'
from cities
on conflict (city_id, key) do nothing;

create or replace function trigger_sos(
  p_order_id uuid,
  p_actor_telegram_id bigint,
  p_reporter_role text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_actor users%rowtype;
  v_incident safety_incidents%rowtype;
  v_window integer;
  v_location geography(Point, 4326);
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND'); end if;
  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_FOUND'); end if;
  if v_actor.is_blocked then return jsonb_build_object('ok', false, 'error', 'ACTOR_BLOCKED'); end if;
  if p_reporter_role not in ('rider', 'driver') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_REPORTER_ROLE');
  end if;
  if p_reporter_role = 'rider' and not exists (
    select 1 from riders r where r.id = v_order.rider_id and r.user_id = v_actor.id
  ) then return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_OWNED'); end if;
  if p_reporter_role = 'driver' and not exists (
    select 1 from drivers d where d.id = v_order.assigned_driver_id and d.user_id = v_actor.id
  ) then return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_ASSIGNED'); end if;
  if not exists (
    select 1 from cities
     where id = v_order.city_id and is_active and telegram_escalation_group_id is not null
  ) then
    return jsonb_build_object('ok', false, 'error', 'ESCALATION_GROUP_MISSING');
  end if;
  select greatest(1, (value #>> '{}')::integer) into v_window
    from platform_settings where city_id = v_order.city_id and key = 'sos_dedup_window_seconds';
  if v_window is null then return jsonb_build_object('ok', false, 'error', 'SOS_DEDUP_SETTING_MISSING'); end if;
  perform pg_advisory_xact_lock(hashtext('sos:' || p_order_id::text || ':' || v_actor.id::text));
  select * into v_incident from safety_incidents
   where order_id = v_order.id and reporter_user_id = v_actor.id
     and created_at >= now() - make_interval(secs => v_window)
   order by created_at desc limit 1 for update;
  if found then
    insert into safety_incident_deliveries(city_id, incident_id)
      values (v_incident.city_id, v_incident.id) on conflict (incident_id) do nothing;
    return jsonb_build_object('ok', true, 'incident_id', v_incident.id, 'created', false);
  end if;
  if p_reporter_role = 'driver' then
    select d.last_location into v_location from drivers d
      where d.id = v_order.assigned_driver_id;
  else
    v_location := v_order.pickup;
  end if;
  insert into safety_incidents(city_id, order_id, reporter_user_id, reporter_role, last_known_location)
    values (v_order.city_id, v_order.id, v_actor.id, p_reporter_role, v_location)
    returning * into v_incident;
  insert into safety_incident_deliveries(city_id, incident_id) values (v_order.city_id, v_incident.id);
  return jsonb_build_object('ok', true, 'incident_id', v_incident.id, 'created', true);
end $$;

create or replace function claim_safety_incident_delivery()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_delivery safety_incident_deliveries%rowtype;
  v_token uuid := gen_random_uuid();
  v_group bigint;
  v_max integer;
begin
  select d.* into v_delivery from safety_incident_deliveries d
   where d.status = 'pending' and d.next_attempt_at <= now()
   order by d.created_at for update skip locked limit 1;
  if not found then return jsonb_build_object('ok', true, 'delivery', null); end if;
  select c.telegram_escalation_group_id into v_group from cities c where c.id = v_delivery.city_id;
  if v_group is null then return jsonb_build_object('ok', false, 'error', 'ESCALATION_GROUP_MISSING'); end if;
  select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
    where city_id = v_delivery.city_id and key = 'sos_delivery_max_attempts';
  if v_max is null then return jsonb_build_object('ok', false, 'error', 'SOS_RETRY_SETTING_MISSING'); end if;
  update safety_incident_deliveries set status = 'sending', attempts = attempts + 1, claim_token = v_token
   where id = v_delivery.id;
  return (
    select jsonb_build_object('ok', true, 'delivery', jsonb_build_object(
      'delivery_id', v_delivery.id, 'incident_id', i.id, 'claim_token', v_token,
      'group_id', v_group::text, 'order_id', o.id, 'service', o.service::text,
      'reporter_role', i.reporter_role, 'status', i.status,
      'location_wkt', case when i.last_known_location is null then null else st_astext(i.last_known_location::geometry) end,
      'max_attempts', v_max
    ))
    from safety_incidents i join orders o on o.id = i.order_id where i.id = v_delivery.incident_id
  );
end $$;

create or replace function finish_safety_incident_delivery(
  p_delivery_id uuid, p_claim_token uuid, p_message_id bigint, p_delivered boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_retry integer;
begin
  if p_delivered then
    update safety_incident_deliveries set status = 'delivered', delivered_message_id = p_message_id,
      delivered_at = now(), claim_token = null where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token;
  else
    select greatest(1, (s.value #>> '{}')::integer) into v_retry
      from safety_incident_deliveries d join platform_settings s on s.city_id = d.city_id
     where d.id = p_delivery_id and s.key = 'sos_delivery_retry_seconds';
    if v_retry is null then return jsonb_build_object('ok', false, 'error', 'SOS_RETRY_SETTING_MISSING'); end if;
    update safety_incident_deliveries set status = 'pending', claim_token = null,
      next_attempt_at = now() + make_interval(secs => v_retry)
      where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token;
  end if;
  return jsonb_build_object('ok', found);
end $$;

create or replace function claim_safety_incident(p_incident_id uuid, p_actor_telegram_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_incident safety_incidents%rowtype; v_actor users%rowtype;
begin
  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found or v_actor.is_blocked or v_actor.role not in ('support', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_AUTHORIZED');
  end if;
  select * into v_incident from safety_incidents where id = p_incident_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'INCIDENT_NOT_FOUND'); end if;
  if v_incident.status = 'closed' then return jsonb_build_object('ok', false, 'error', 'INCIDENT_ALREADY_CLOSED'); end if;
  if v_incident.status = 'received' then
    return jsonb_build_object('ok', false, 'error', 'INCIDENT_ALREADY_CLAIMED',
      'claimed_by', (select telegram_id::text from users where id = v_incident.claimed_by_user_id));
  end if;
  update safety_incidents set status = 'received', claimed_by_user_id = v_actor.id, claimed_at = now()
    where id = p_incident_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function resolve_safety_incident(
  p_incident_id uuid, p_actor_telegram_id bigint, p_decision text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_incident safety_incidents%rowtype; v_actor users%rowtype; v_block jsonb;
begin
  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found or v_actor.is_blocked or v_actor.role not in ('support', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_AUTHORIZED');
  end if;
  if p_decision not in ('close', 'block_reporter') then return jsonb_build_object('ok', false, 'error', 'INVALID_DECISION'); end if;
  select * into v_incident from safety_incidents where id = p_incident_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'INCIDENT_NOT_FOUND'); end if;
  if v_incident.status = 'closed' then return jsonb_build_object('ok', false, 'error', 'INCIDENT_ALREADY_CLOSED'); end if;
  if v_incident.status <> 'received' or v_incident.claimed_by_user_id <> v_actor.id then
    return jsonb_build_object('ok', false, 'error', 'INCIDENT_NOT_CLAIMED_BY_ACTOR');
  end if;
  if p_decision = 'block_reporter' then
    select admin_set_user_blocked(v_actor.id, v_incident.reporter_user_id, true) into v_block;
    if coalesce((v_block->>'ok')::boolean, false) is not true then
      return jsonb_build_object('ok', false, 'error', coalesce(v_block->>'error', 'BLOCK_REJECTED'));
    end if;
  end if;
  update safety_incidents set status = 'closed', decision = p_decision,
    decided_by_user_id = v_actor.id, decided_at = now() where id = p_incident_id;
  return jsonb_build_object('ok', true, 'decision', p_decision);
end $$;

grant execute on function trigger_sos(uuid, bigint, text) to service_role;
grant execute on function claim_safety_incident_delivery() to service_role;
grant execute on function finish_safety_incident_delivery(uuid, uuid, bigint, boolean) to service_role;
grant execute on function claim_safety_incident(uuid, bigint) to service_role;
grant execute on function resolve_safety_incident(uuid, bigint, text) to service_role;

-- SECURITY DEFINER لا يكفي وحده: الدالة الجديدة تُمنح PUBLIC افتراضياً عند إنشائها.
revoke execute on function trigger_sos(uuid, bigint, text) from public, anon, authenticated;
revoke execute on function claim_safety_incident_delivery() from public, anon, authenticated;
revoke execute on function finish_safety_incident_delivery(uuid, uuid, bigint, boolean) from public, anon, authenticated;
revoke execute on function claim_safety_incident(uuid, bigint) from public, anon, authenticated;
revoke execute on function resolve_safety_incident(uuid, bigint, text) from public, anon, authenticated;
