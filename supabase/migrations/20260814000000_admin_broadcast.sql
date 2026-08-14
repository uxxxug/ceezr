-- =============================================================================
-- الغرض: البثّ الجماعي من لوحة الإدارة إلى السائقين أو الركّاب، بصندوقِ صادرٍ
--   في القاعدة لا في الذاكرة: الحملةُ ومستقبِلوها يُكتبون في معاملةٍ واحدة قبل
--   أيّ نداءِ تلغرام، فسقوطُ الشبكة أو إعادةُ تشغيل العامل لا تُفقد رسالةً ولا
--   تُرسل رسالةً مرّتين.
-- الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: packages/infrastructure/messaging/broadcast-adapters.ts،
--   apps/workers/src/jobs/deliver-broadcasts.ts، apps/gateway/src/routes/admin-ui.ts
-- ملاحظات مستقبلية: الحملةُ صفٌّ لكلّ مدينة بمعرّف دفعةٍ واحد (`batch_id`) — نفسُ
--   نمطِ `db_backups`. «كلّ المدن» ليست صفّاً بلا مدينة: `platform_settings`
--   مُفتاحةٌ بالمدينة، وصفٌّ عابرٌ للمدن كان سيُطبّق إعدادَ مدينةٍ على أخرى.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) الجدولان
-- ---------------------------------------------------------------------------

create table if not exists broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id) on delete restrict,
  -- معرّف الدفعة: بثٌّ واحد إلى «كلّ المدن» يُنتج صفّاً لكلّ مدينة بهذا المعرّف
  -- نفسه، فيُقرأ في اللوحة حملةً واحدة ويُلغى بإلغاءٍ واحد.
  batch_id uuid not null,
  audience text not null check (audience in ('drivers', 'riders')),
  -- المرشّحات كما اختارها المسؤول، محفوظةً كما هي: من يراجع بعد شهرٍ يحتاج أن
  -- يعرف لمن أُرسلت هذه الرسالة بالضبط، لا أن يُعيد تخمينَ الاستعلام.
  filters jsonb not null default '{}'::jsonb,
  body text not null check (length(btrim(body)) between 1 and 3500),
  -- زرٌّ اختياريّ أسفل الرسالة. الرابط يُتحقَّق في الدالّة لا هنا: الرسالةُ
  -- المرفوضة يجب أن تُردّ بسببٍ مقروء لا بانتهاكِ قيد.
  link_label text,
  link_url text,
  silent boolean not null default false,
  status text not null default 'sending'
    check (status in ('sending', 'completed', 'canceled')),
  recipients_total integer not null default 0 check (recipients_total >= 0),
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint broadcast_campaigns_link_pair check (
    (link_label is null and link_url is null) or
    (link_label is not null and link_url is not null)
  ),
  constraint broadcast_campaigns_one_per_city_per_batch unique (batch_id, city_id)
);
create index if not exists broadcast_campaigns_city_created_idx
  on broadcast_campaigns(city_id, created_at desc);
create index if not exists broadcast_campaigns_batch_idx
  on broadcast_campaigns(batch_id);
drop trigger if exists broadcast_campaigns_set_updated_at on broadcast_campaigns;
create trigger broadcast_campaigns_set_updated_at before update on broadcast_campaigns
  for each row execute function set_updated_at();

create table if not exists broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id) on delete restrict,
  campaign_id uuid not null references broadcast_campaigns(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- تُلقَط لحظةَ الإنشاء ولا تُقرأ من `users` عند الإرسال: المستقبِل الذي غيّر
  -- لغته بعد بدء البثّ يجب أن تصله الرسالةُ التي أُعِدّت له، لا نصفُ لغةٍ.
  chat_id bigint not null check (chat_id <> 0),
  language_code text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'canceled')),
  attempts integer not null default 0 check (attempts >= 0),
  claim_token uuid,
  next_attempt_at timestamptz not null default now(),
  message_id bigint,
  error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- لا مستقبِلَ مرّتين في حملةٍ واحدة: هذا هو ضمانُ «لا رسالةَ مكرّرة» في
  -- القاعدة نفسها، لا في منطقِ العامل.
  constraint broadcast_recipients_once unique (campaign_id, user_id),
  constraint broadcast_recipients_sent_pair check (
    (status <> 'sent') or (sent_at is not null and message_id is not null)
  )
);
create index if not exists broadcast_recipients_due_idx
  on broadcast_recipients(city_id, next_attempt_at)
  where status = 'pending';
create index if not exists broadcast_recipients_campaign_status_idx
  on broadcast_recipients(campaign_id, status);
drop trigger if exists broadcast_recipients_set_updated_at on broadcast_recipients;
create trigger broadcast_recipients_set_updated_at before update on broadcast_recipients
  for each row execute function set_updated_at();

alter table broadcast_campaigns enable row level security;
alter table broadcast_recipients enable row level security;
drop policy if exists broadcast_campaigns_service_role on broadcast_campaigns;
create policy broadcast_campaigns_service_role on broadcast_campaigns
  for all to service_role using (true) with check (true);
drop policy if exists broadcast_recipients_service_role on broadcast_recipients;
create policy broadcast_recipients_service_role on broadcast_recipients
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- ٢) الإعدادات — لكلّ مدينة، لا أرقامَ تجارية في الكود
-- ---------------------------------------------------------------------------

insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'broadcast_batch_limit', '25'::jsonb, 'number',
       'عدد رسائل البثّ التي يُسلّمها شوطُ العامل الواحد في المدينة'
from cities on conflict (city_id, key) do nothing;
insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'broadcast_retry_seconds', '60'::jsonb, 'number',
       'الفاصل بين محاولات تسليم رسالة بثّ أخفقت لسببٍ عابر'
from cities on conflict (city_id, key) do nothing;
insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'broadcast_max_attempts', '4'::jsonb, 'number',
       'أقصى عدد محاولات لتسليم رسالة بثّ قبل وسمها فاشلة'
from cities on conflict (city_id, key) do nothing;
insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'broadcast_rider_recent_days', '30'::jsonb, 'number',
       'عدد الأيام التي يُعدّ الراكب فيها «نشطاً» عند ترشيح جمهور البثّ'
from cities on conflict (city_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- ٣) اختيار الجمهور — مصدرُ حقيقةٍ واحد للعدّ والإنشاء
-- ---------------------------------------------------------------------------

-- مُساعدتان تُقرأان داخل الاختيار: القيمُ المسموحة، وعددُ أيّام «النشاط».
-- تُفصلان لأنّ كتابتَهما داخل الاستعلام مرّتين (للعدّ وللإنشاء) كانت ستسمح
-- لإحداهما أن تنزلق عن الأخرى.
create or replace function broadcast_filter_values(p_filters jsonb, p_key text)
returns text[]
language sql
immutable
as $$
  select case
    when jsonb_typeof(coalesce(p_filters, '{}'::jsonb) -> p_key) = 'array'
     and jsonb_array_length(coalesce(p_filters, '{}'::jsonb) -> p_key) > 0
    then array(select jsonb_array_elements_text(coalesce(p_filters, '{}'::jsonb) -> p_key))
    else null::text[]
  end;
$$;

create or replace function broadcast_recent_days(p_city_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(1, coalesce(
    (select (value #>> '{}')::integer from platform_settings
      where city_id = p_city_id and key = 'broadcast_rider_recent_days'), 30));
$$;

-- دالّةٌ واحدة يقرؤها العدّ والإنشاء معاً. لو كُتب الاستعلامُ مرّتين لانزلقت
-- إحداهما عن الأخرى، فيُعرَض للمسؤول عددٌ ثم تُرسَل الرسالةُ إلى جمهورٍ آخر —
-- وهو أسوأُ ما يمكن أن يحدث في شاشةٍ تُرسل إلى الناس.
create or replace function broadcast_audience(
  p_city_id uuid,
  p_audience text,
  p_filters jsonb
) returns table (
  city_id uuid,
  user_id uuid,
  chat_id bigint,
  language_code text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.city_id, b.user_id, b.chat_id, b.language_code
    from (
      select u.city_id, u.id as user_id, u.telegram_id as chat_id, u.language_code,
             d.id as driver_id, r.id as rider_id
        from users u
        left join drivers d on d.user_id = u.id
        left join riders r on r.user_id = u.id
       -- المحظور لا يُراسَل: البثُّ رسالةٌ تجارية، وإرسالُها إلى من حُظر
       -- تناقضٌ صريح مع قرارِ الحظر نفسه.
       where (p_city_id is null or u.city_id = p_city_id)
         and not u.is_blocked
    ) b
   where (
     broadcast_filter_values(p_filters, 'languages') is null
     or b.language_code = any (broadcast_filter_values(p_filters, 'languages'))
   )
     and case p_audience
       when 'drivers' then
         b.driver_id is not null
         and (
           broadcast_filter_values(p_filters, 'verification') is null
           or exists (
             select 1 from drivers dd
              where dd.id = b.driver_id
                and dd.verification_status::text
                    = any (broadcast_filter_values(p_filters, 'verification'))
           )
         )
         and (
           broadcast_filter_values(p_filters, 'subscription') is null
           or coalesce((
             select case when s.status = 'trialing' then 'trialing' else 'active' end
               from subscriptions s
              where s.driver_id = b.driver_id
                and s.status in ('trialing', 'active')
              limit 1
           ), 'none') = any (broadcast_filter_values(p_filters, 'subscription'))
         )
         and (
           coalesce(coalesce(p_filters, '{}'::jsonb) ->> 'availability', 'any') = 'any'
           or (
             coalesce(p_filters, '{}'::jsonb) ->> 'availability' = 'available'
             and exists (
               select 1 from driver_availability da
                where da.driver_id = b.driver_id and da.is_available
             )
           )
           or (
             coalesce(p_filters, '{}'::jsonb) ->> 'availability' = 'unavailable'
             and not exists (
               select 1 from driver_availability da
                where da.driver_id = b.driver_id and da.is_available
             )
           )
         )
       when 'riders' then
         b.rider_id is not null
         and (
           coalesce(coalesce(p_filters, '{}'::jsonb) ->> 'activity', 'any') = 'any'
           or (
             coalesce(p_filters, '{}'::jsonb) ->> 'activity' = 'ordered_recently'
             and exists (
               select 1 from orders o
                where o.rider_id = b.rider_id
                  and o.created_at >= now()
                      - make_interval(days => broadcast_recent_days(b.city_id))
             )
           )
           or (
             coalesce(p_filters, '{}'::jsonb) ->> 'activity' = 'never_ordered'
             and not exists (select 1 from orders o where o.rider_id = b.rider_id)
           )
         )
       else false
     end;
$$;

-- ---------------------------------------------------------------------------
-- ٤) العدّ قبل الإرسال
-- ---------------------------------------------------------------------------

create or replace function count_broadcast_audience(
  p_actor_user_id uuid,
  p_city_id uuid,
  p_audience text,
  p_filters jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor users%rowtype;
  v_rows jsonb;
  v_total integer;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;
  if p_audience not in ('drivers', 'riders') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AUDIENCE');
  end if;
  if p_city_id is not null and not exists (select 1 from cities where id = p_city_id) then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'city_id', x.city_id, 'code', c.code, 'name_ar', c.name_ar,
           'recipients', x.recipients) order by c.code), '[]'::jsonb),
         coalesce(sum(x.recipients), 0)::integer
    into v_rows, v_total
    from (
      select a.city_id, count(*)::integer as recipients
        from broadcast_audience(p_city_id, p_audience, p_filters) a
       group by a.city_id
    ) x
    join cities c on c.id = x.city_id;

  return jsonb_build_object('ok', true, 'cities', v_rows, 'total', v_total);
end $$;

-- ---------------------------------------------------------------------------
-- ٥) الإنشاء — الحملة ومستقبِلوها في معاملةٍ واحدة
-- ---------------------------------------------------------------------------

create or replace function create_broadcast(
  p_actor_user_id uuid,
  p_city_id uuid,
  p_audience text,
  p_filters jsonb,
  p_body text,
  p_link_label text,
  p_link_url text,
  p_silent boolean,
  p_send_after timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor users%rowtype;
  v_batch uuid := gen_random_uuid();
  v_start timestamptz := coalesce(p_send_after, now());
  v_total integer := 0;
  v_cities jsonb := '[]'::jsonb;
  v_city record;
  v_campaign_id uuid;
  v_count integer;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;
  if p_audience not in ('drivers', 'riders') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AUDIENCE');
  end if;
  if coalesce(length(btrim(p_body)), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_BODY');
  end if;
  if length(btrim(p_body)) > 3500 then
    return jsonb_build_object('ok', false, 'error', 'BODY_TOO_LONG');
  end if;
  -- الزرّ إمّا كاملٌ أو لا زرّ: نصفُ زرٍّ رسالةٌ مكسورةٌ عند المستقبِل.
  if (p_link_label is null) <> (p_link_url is null) then
    return jsonb_build_object('ok', false, 'error', 'INCOMPLETE_LINK');
  end if;
  -- رابطٌ غيرُ آمن في رسالةٍ تحمل اسمَ المنصّة يُعلِّم المستقبِل أن يثق بما
  -- لا يُؤمَن. فـhttps فقط، ولا مساحاتٍ بيضاء تُخفي مقصداً آخر.
  if p_link_url is not null and p_link_url !~ '^https://[^\s]{3,}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LINK_URL');
  end if;
  if p_city_id is not null and not exists (select 1 from cities where id = p_city_id) then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND');
  end if;

  for v_city in
    select a.city_id as id, count(*)::integer as recipients
      from broadcast_audience(p_city_id, p_audience, p_filters) a
     group by a.city_id
     order by a.city_id
  loop
    insert into broadcast_campaigns (
      city_id, batch_id, audience, filters, body, link_label, link_url, silent,
      recipients_total, created_by_user_id
    ) values (
      v_city.id, v_batch, p_audience, coalesce(p_filters, '{}'::jsonb), btrim(p_body),
      p_link_label, p_link_url, coalesce(p_silent, false), v_city.recipients, v_actor.id
    ) returning id into v_campaign_id;

    insert into broadcast_recipients (
      city_id, campaign_id, user_id, chat_id, language_code, next_attempt_at
    )
    select a.city_id, v_campaign_id, a.user_id, a.chat_id, a.language_code, v_start
      from broadcast_audience(p_city_id, p_audience, p_filters) a
     where a.city_id = v_city.id
    on conflict (campaign_id, user_id) do nothing;

    v_count := v_city.recipients;
    v_total := v_total + v_count;
    v_cities := v_cities || jsonb_build_array(jsonb_build_object(
      'city_id', v_city.id, 'campaign_id', v_campaign_id, 'recipients', v_count));

    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (v_city.id, v_actor.id, 'broadcast.created', 'broadcast', v_campaign_id,
            jsonb_build_object('batch_id', v_batch, 'audience', p_audience,
                               'filters', coalesce(p_filters, '{}'::jsonb),
                               'recipients', v_count, 'silent', coalesce(p_silent, false),
                               'send_after', v_start));
  end loop;

  if v_total = 0 then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_AUDIENCE');
  end if;

  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'total', v_total,
                            'cities', v_cities, 'send_after', v_start);
end $$;

-- ---------------------------------------------------------------------------
-- ٦) شوط التسليم — حجزٌ ثمّ إعلانُ تسليم، لا إعلانَ نيّة
-- ---------------------------------------------------------------------------

create or replace function claim_broadcast_recipients(p_city_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_max integer;
  v_token uuid := gen_random_uuid();
  v_rows jsonb;
begin
  if p_city_id is null or not exists (select 1 from cities where id = p_city_id) then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND');
  end if;
  select greatest(1, (value #>> '{}')::integer) into v_limit from platform_settings
   where city_id = p_city_id and key = 'broadcast_batch_limit';
  if v_limit is null then
    return jsonb_build_object('ok', false, 'error', 'BROADCAST_BATCH_SETTING_MISSING');
  end if;
  select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
   where city_id = p_city_id and key = 'broadcast_max_attempts';
  if v_max is null then
    return jsonb_build_object('ok', false, 'error', 'BROADCAST_ATTEMPTS_SETTING_MISSING');
  end if;

  with due as (
    select r.id
      from broadcast_recipients r
      join broadcast_campaigns k on k.id = r.campaign_id
     where r.city_id = p_city_id
       and r.status = 'pending'
       and r.next_attempt_at <= now()
       and k.status = 'sending'
     order by r.next_attempt_at, r.created_at
     for update of r skip locked
     limit v_limit
  ),
  claimed as (
    update broadcast_recipients r
       set status = 'sending', attempts = r.attempts + 1, claim_token = v_token
     where r.id in (select id from due)
    returning r.id, r.campaign_id, r.chat_id, r.language_code, r.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipient_id', c.id, 'chat_id', c.chat_id::text,
           'language_code', c.language_code, 'attempts', c.attempts,
           'max_attempts', v_max, 'claim_token', v_token,
           'audience', k.audience, 'body', k.body, 'silent', k.silent,
           'link_label', k.link_label, 'link_url', k.link_url)), '[]'::jsonb)
    into v_rows
    from claimed c join broadcast_campaigns k on k.id = c.campaign_id;

  return jsonb_build_object('ok', true, 'recipients', v_rows);
end $$;

create or replace function finish_broadcast_delivery(
  p_recipient_id uuid,
  p_claim_token uuid,
  p_message_id bigint,
  p_delivered boolean,
  p_permanent boolean,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row broadcast_recipients%rowtype;
  v_retry integer;
  v_max integer;
  v_final boolean;
begin
  select * into v_row from broadcast_recipients
   where id = p_recipient_id and status = 'sending' and claim_token = p_claim_token
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED_BY_CALLER');
  end if;

  if p_delivered then
    -- معرّفُ رسالةٍ حقيقيّ شرطُ إعلانِ التسليم: بلا معرّفٍ ليس عندنا إلّا نيّة.
    if p_message_id is null then
      return jsonb_build_object('ok', false, 'error', 'MESSAGE_ID_REQUIRED');
    end if;
    update broadcast_recipients
       set status = 'sent', message_id = p_message_id, sent_at = now(),
           claim_token = null, error_code = null
     where id = v_row.id;
  else
    select greatest(1, (value #>> '{}')::integer) into v_retry from platform_settings
     where city_id = v_row.city_id and key = 'broadcast_retry_seconds';
    select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
     where city_id = v_row.city_id and key = 'broadcast_max_attempts';
    if v_retry is null or v_max is null then
      return jsonb_build_object('ok', false, 'error', 'BROADCAST_RETRY_SETTING_MISSING');
    end if;
    -- الفشلُ الدائم لا يُعاد: من حجب البوت أو أغلق محادثته لن يستقبلها بعد
    -- أربع محاولات، وإعادتُها تحرق حدَّ تلغرام على من لن يصله شيء.
    v_final := coalesce(p_permanent, false) or v_row.attempts >= v_max;
    if v_final then
      update broadcast_recipients
         set status = 'failed', claim_token = null, error_code = p_error_code
       where id = v_row.id;
    else
      update broadcast_recipients
         set status = 'pending', claim_token = null, error_code = p_error_code,
             next_attempt_at = now() + make_interval(secs => v_retry)
       where id = v_row.id;
    end if;
  end if;

  -- الحملةُ تُختم حين لا يبقى معلَّقٌ ولا جارٍ: الختمُ محسوبٌ من الصفوف لا
  -- مُعلَنٌ من العامل، فإعادةُ تشغيلٍ في منتصف الشوط لا تختم حملةً ناقصة.
  update broadcast_campaigns k
     set status = 'completed'
   where k.id = v_row.campaign_id
     and k.status = 'sending'
     and not exists (
       select 1 from broadcast_recipients r
        where r.campaign_id = k.id and r.status in ('pending', 'sending')
     );

  return jsonb_build_object('ok', true);
end $$;

create or replace function cancel_broadcast(
  p_actor_user_id uuid,
  p_batch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor users%rowtype;
  v_canceled integer := 0;
  v_campaign record;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;
  if not exists (select 1 from broadcast_campaigns where batch_id = p_batch_id) then
    return jsonb_build_object('ok', false, 'error', 'BATCH_NOT_FOUND');
  end if;

  -- المعلَّق وحده يُلغى. الجاري `sending` محجوزٌ بيدِ عاملٍ الآن، وسحبُه منه
  -- كان سيُنتج رسالةً وصلت وصفّاً يقول «أُلغيت».
  for v_campaign in
    select id, city_id from broadcast_campaigns
     where batch_id = p_batch_id and status = 'sending' for update
  loop
    with stopped as (
      update broadcast_recipients set status = 'canceled', claim_token = null
       where campaign_id = v_campaign.id and status = 'pending'
      returning 1
    )
    select v_canceled + count(*)::integer into v_canceled from stopped;

    update broadcast_campaigns set status = 'canceled' where id = v_campaign.id;

    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (v_campaign.city_id, v_actor.id, 'broadcast.canceled', 'broadcast', v_campaign.id,
            jsonb_build_object('batch_id', p_batch_id));
  end loop;

  return jsonb_build_object('ok', true, 'canceled', v_canceled);
end $$;

-- ---------------------------------------------------------------------------
-- ٧) الصلاحيات — SECURITY DEFINER لا يكفي: الدالّة تُمنح PUBLIC عند إنشائها
-- ---------------------------------------------------------------------------

revoke all on function broadcast_filter_values(jsonb, text) from public, anon, authenticated;
revoke all on function broadcast_recent_days(uuid) from public, anon, authenticated;
revoke all on function broadcast_audience(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function count_broadcast_audience(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function create_broadcast(uuid, uuid, text, jsonb, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
revoke all on function claim_broadcast_recipients(uuid) from public, anon, authenticated;
revoke all on function finish_broadcast_delivery(uuid, uuid, bigint, boolean, boolean, text)
  from public, anon, authenticated;
revoke all on function cancel_broadcast(uuid, uuid) from public, anon, authenticated;

grant execute on function broadcast_filter_values(jsonb, text) to service_role;
grant execute on function broadcast_recent_days(uuid) to service_role;
grant execute on function broadcast_audience(uuid, text, jsonb) to service_role;
grant execute on function count_broadcast_audience(uuid, uuid, text, jsonb) to service_role;
grant execute on function create_broadcast(uuid, uuid, text, jsonb, text, text, text, boolean, timestamptz)
  to service_role;
grant execute on function claim_broadcast_recipients(uuid) to service_role;
grant execute on function finish_broadcast_delivery(uuid, uuid, bigint, boolean, boolean, text)
  to service_role;
grant execute on function cancel_broadcast(uuid, uuid) to service_role;
