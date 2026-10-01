-- migration-phase: expand
-- ────────────────────────────────────────────────────────────────────────────
-- DEC-42 · تفضيلاتُ الإشعارات — `GET/PUT /v1/me/notification-preferences`
--
-- الغرض: عمودانِ على `users` لتفضيلاتِ الإشعاراتِ غيرِ التشغيليّةِ:
--   `offers_notifications_enabled` (افتراضيٌّ true) — العروضُ الترويجيّةُ.
--   `updates_notifications_enabled` (افتراضيٌّ true) — تحديثاتُ المنتجِ.
--   الإشعاراتُ التشغيليّةُ (الرحلةُ، المَهمّةُ، الاشتراكُ) تصلك في كلِّ الأحوالِ.
--
-- الحالة: منفَّذ.
-- ينتمي إلى: supabase/migrations
-- الحاكم: تنشيطُ `rider.account.debt.notificationPrefs` و`driver.account.debt.notificationPrefs`.
-- ────────────────────────────────────────────────────────────────────────────

alter table users add column if not exists offers_notifications_enabled boolean not null default true;
alter table users add column if not exists updates_notifications_enabled boolean not null default true;

create or replace function upsert_notification_prefs(
  p_telegram_id text,
  p_offers_enabled boolean,
  p_updates_enabled boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if p_telegram_id !~ '^[0-9]{1,19}$' then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id::bigint;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  update users
    set offers_notifications_enabled = p_offers_enabled,
        updates_notifications_enabled = p_updates_enabled,
        updated_at = now()
    where id = v_user_id;

  return jsonb_build_object('ok', true, 'status', 'saved');
end;
$$;

create or replace function read_notification_prefs(
  p_telegram_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if p_telegram_id !~ '^[0-9]{1,19}$' then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select u.offers_notifications_enabled, u.updates_notifications_enabled
    into v_row
    from users u
    where u.telegram_id = p_telegram_id::bigint;

  if v_row is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'found',
    'offers_enabled', v_row.offers_notifications_enabled,
    'updates_enabled', v_row.updates_notifications_enabled
  );
end;
$$;

grant execute on function upsert_notification_prefs(text, boolean, boolean) to service_role;
revoke execute on function upsert_notification_prefs(text, boolean, boolean) from public, anon, authenticated;

grant execute on function read_notification_prefs(text) to service_role;
revoke execute on function read_notification_prefs(text) from public, anon, authenticated;
