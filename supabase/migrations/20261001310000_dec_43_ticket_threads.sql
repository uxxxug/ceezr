-- migration-phase: expand
-- ────────────────────────────────────────────────────────────────────────────
-- DEC-43 · محادثةٌ داخلَ التذكرة — `POST/GET /v1/support/tickets/:id/messages`
--   و`POST/GET /v1/driver/support/tickets/:id/messages`
--
-- الغرض: جدولُ رسائلِ التذكرةِ، ودالّتانِ لإضافةِ رسالةٍ وقراءةِ المحادثة.
--   الرسالةُ مرتبطةٌ بالتذكرةِ ومُلكٌ لصاحبِ التذكرةِ (راكبٌ أو سائقٌ).
--   لا رسالةَ بعدَ إغلاقِ التذكرةِ.
--
-- الحالة: منفَّذ.
-- ينتمي إلى: supabase/migrations
-- الحاكم: تنشيطُ `rider.support.debt.thread` و`driver.support.debt.thread`.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references support_tickets(id) on delete cascade,
  city_id     uuid not null references cities(id),
  sender_type text not null check (sender_type in ('rider', 'driver', 'support')),
  sender_telegram_id bigint,
  message     text not null check (length(trim(message)) >= 1 and length(message) <= 2000),
  created_at  timestamptz not null default now()
);

alter table ticket_messages enable row level security;


create or replace function add_ticket_message(
  p_telegram_id text,
  p_ticket_id text,
  p_message text,
  p_sender_type text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket record;
  v_message_id uuid;
begin
  if p_telegram_id !~ '^[0-9]{1,19}$' then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  if p_ticket_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
  end if;

  if length(trim(p_message)) < 1 or length(p_message) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'MESSAGE_INVALID');
  end if;

  if p_sender_type not in ('rider', 'driver') then
    return jsonb_build_object('ok', false, 'error', 'SENDER_TYPE_INVALID');
  end if;

  select t.id, t.status, t.rider_id, t.driver_id, t.city_id
    into v_ticket
    from support_tickets t
    where t.id = p_ticket_id::uuid;

  if v_ticket is null then
    return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
  end if;

  if v_ticket.status != 'open' then
    return jsonb_build_object('ok', false, 'error', 'TICKET_CLOSED');
  end if;

  -- التحقق من الملكية: الراكب يرى تذاكره والسائق يرى تذاكره
  if p_sender_type = 'rider' then
    if not exists (
      select 1 from support_tickets t
      join riders r on r.id = t.rider_id
      join users u on u.id = r.user_id
      where t.id = p_ticket_id::uuid and u.telegram_id = p_telegram_id::bigint
    ) then
      return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
    end if;
  else
    if not exists (
      select 1 from support_tickets t
      join drivers d on d.id = t.driver_id
      join users u on u.id = d.user_id
      where t.id = p_ticket_id::uuid and u.telegram_id = p_telegram_id::bigint
    ) then
      return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
    end if;
  end if;

  insert into ticket_messages (ticket_id, city_id, sender_type, sender_telegram_id, message)
    values (p_ticket_id::uuid, v_ticket.city_id, p_sender_type, p_telegram_id::bigint, p_message)
    returning id into v_message_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'added',
    'message_id', v_message_id,
    'created_at', now()
  );
end;
$$;

create or replace function list_ticket_messages(
  p_telegram_id text,
  p_ticket_id text,
  p_sender_type text,
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_messages jsonb;
begin
  if p_telegram_id !~ '^[0-9]{1,19}$' then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  if p_ticket_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
  end if;

  if p_sender_type not in ('rider', 'driver') then
    return jsonb_build_object('ok', false, 'error', 'SENDER_TYPE_INVALID');
  end if;

  if p_limit < 1 or p_limit > 100 then
    p_limit := 50;
  end if;

  -- التحقق من الملكية
  if p_sender_type = 'rider' then
    if not exists (
      select 1 from support_tickets t
      join riders r on r.id = t.rider_id
      join users u on u.id = r.user_id
      where t.id = p_ticket_id::uuid and u.telegram_id = p_telegram_id::bigint
    ) then
      return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
    end if;
  else
    if not exists (
      select 1 from support_tickets t
      join drivers d on d.id = t.driver_id
      join users u on u.id = d.user_id
      where t.id = p_ticket_id::uuid and u.telegram_id = p_telegram_id::bigint
    ) then
      return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'sender_type', m.sender_type,
    'message', m.message,
    'created_at', m.created_at
  ) order by m.created_at asc), '[]'::jsonb) into v_messages
  from ticket_messages m
  where m.ticket_id = p_ticket_id::uuid
  limit p_limit;

  return jsonb_build_object('ok', true, 'status', 'found', 'messages', v_messages);
end;
$$;

grant execute on function add_ticket_message(text, text, text, text) to service_role;
revoke execute on function add_ticket_message(text, text, text, text) from public, anon, authenticated;

grant execute on function list_ticket_messages(text, text, text, integer) to service_role;
revoke execute on function list_ticket_messages(text, text, text, integer) from public, anon, authenticated;
