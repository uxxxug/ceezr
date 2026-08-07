-- =====================================================================================
-- المرحلة 2.5 — التقييم المتبادل ودورة حياة الرحلة حتى نهايتها
--
-- بلا رحلة تنتهي لا يوجد تقييم، وبلا تقييم يبقى وزن التقييم في معادلة المطابقة
-- وزناً على ثابت واحد لكل السائقين — أي لا وزن على الإطلاق. فهذه الهجرة تضيف:
--   1) انتقالات الحالة الناقصة: matched ← in_progress ← completed
--   2) جدول ratings بتقييم متبادل واتجاهين، وقيد يمنع تقييماً ثانياً بالاتجاه نفسه
--   3) تقييم rider_average على الزبون كما على السائق — التقييم متبادل فعلاً لا شكلاً
--   4) recompute_rating_averages() لإعادة الحساب دورياً من المصدر لا تراكمياً
--
-- كل قرار عددي (الحد الأدنى للنجوم، عدد التقييمات التي يُعتد بها) لا يُرمَّز هنا:
-- النجوم 1..5 قيد سلامة في نوع البيانات، وما عدا ذلك في platform_settings.
-- =====================================================================================

-- 1) اتجاه التقييم -------------------------------------------------------------------
do $$ begin
  create type rating_direction as enum ('rider_to_driver', 'driver_to_rider');
exception when duplicate_object then null; end $$;

-- 2) متوسط تقييم الزبون --------------------------------------------------------------
alter table riders add column if not exists rating_average numeric(3, 2);
alter table riders add column if not exists rating_count integer not null default 0;

-- 3) جدول التقييمات ------------------------------------------------------------------
create table if not exists ratings (
  id            uuid primary key default gen_random_uuid(),
  city_id       uuid not null references cities (id) on delete restrict,
  order_id      uuid not null references orders (id) on delete cascade,
  direction     rating_direction not null,
  -- من قيَّم ومن قُيِّم: بـ user_id لا driver_id/rider_id، فالتقييم على الإنسان
  -- لا على صفته، ومن كان زبوناً اليوم قد يكون سائقاً غداً بالحساب نفسه.
  rater_user_id uuid not null references users (id) on delete restrict,
  ratee_user_id uuid not null references users (id) on delete restrict,
  stars         smallint not null check (stars between 1 and 5),
  comment       text,
  -- علَم إساءة يرفعه فريق الدعم: التقييم المُعلَّم يبقى في السجلّ للتدقيق
  -- لكنه يُستثنى من المتوسط، فلا تُمحى شهادة ولا يُظلم مُقيَّم.
  is_flagged    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint ratings_no_self_rating check (rater_user_id <> ratee_user_id),
  constraint ratings_comment_length check (comment is null or char_length(comment) <= 1000)
);

-- تقييم واحد لكل اتجاه لكل رحلة: القيد في القاعدة لا في التطبيق، فلا سباق
create unique index if not exists ratings_one_per_order_direction
  on ratings (order_id, direction);
create index if not exists ratings_ratee_idx on ratings (ratee_user_id) where is_flagged = false;
create index if not exists ratings_city_created_idx on ratings (city_id, created_at desc);

drop trigger if exists ratings_set_updated_at on ratings;
create trigger ratings_set_updated_at before update on ratings
  for each row execute function set_updated_at();

alter table ratings enable row level security;

-- 4) إعدادات المرحلة لكل مدينة -------------------------------------------------------
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, s.key, s.value, s.value_type, s.description_ar, s.is_provisional
  from cities c
 cross join (values
   ('rating_min_count_for_trust', '3'::jsonb,   'number',
    'عدد التقييمات التي يبدأ عندها الاعتماد على متوسط السائق بدل التقييم الافتراضي', true),
   ('rating_prompt_window_hours', '48'::jsonb,  'number',
    'المدة التي يُقبل فيها تقييم رحلة منتهية قبل أن يُغلق بابها', true)
 ) as s(key, value, value_type, description_ar, is_provisional)
on conflict (city_id, key) do nothing;

-- 5) بدء الرحلة ----------------------------------------------------------------------
create or replace function start_ride(p_order_id uuid, p_driver_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  orders%rowtype;
  v_driver drivers%rowtype;
  v_user   users%rowtype;
  v_now    timestamptz := now();
begin
  select * into v_user from users where telegram_id = p_driver_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  -- القفل على الصف: لا يبدأ الرحلة إلا من أُسندت إليه، ولا تُبدأ مرتين
  select * into v_order
    from orders
   where id = p_order_id and status = 'matched' and assigned_driver_id = v_driver.id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_STARTABLE');
  end if;

  update orders set status = 'in_progress', started_at = v_now where id = p_order_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_user.id, 'order.started', 'order', p_order_id,
          jsonb_build_object('driver_id', v_driver.id));

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'started_at', v_now);
end;
$$;

-- 6) إنهاء الرحلة: يفتح باب التقييم للطرفين ------------------------------------------
create or replace function complete_ride(p_order_id uuid, p_driver_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders%rowtype;
  v_driver   drivers%rowtype;
  v_user     users%rowtype;
  v_rider    riders%rowtype;
  v_rider_u  users%rowtype;
  v_now      timestamptz := now();
  v_duration integer;
begin
  select * into v_user from users where telegram_id = p_driver_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  select * into v_order
    from orders
   where id = p_order_id and status = 'in_progress' and assigned_driver_id = v_driver.id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_COMPLETABLE');
  end if;

  update orders set status = 'completed', completed_at = v_now where id = p_order_id;

  -- السائق يعود متاحاً تلقائياً: من أنهى رحلته جاهز للتالية بلا أمر إضافي
  update driver_availability
     set is_available = true, updated_at = v_now
   where driver_id = v_driver.id;

  select * into v_rider from riders where id = v_order.rider_id;
  select * into v_rider_u from users where id = v_rider.user_id;

  v_duration := greatest(0, extract(epoch from (v_now - coalesce(v_order.started_at, v_now)))::integer);

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_user.id, 'order.completed', 'order', p_order_id,
          jsonb_build_object('driver_id', v_driver.id, 'duration_seconds', v_duration));

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'completed_at', v_now,
    'duration_seconds', v_duration,
    'service', v_order.service,
    'pickup_label', v_order.pickup_label,
    'dropoff_label', v_order.dropoff_label,
    -- الطرفان بمعرّف تلغرام ولغته: من يُطلب منه التقييم يُخاطب بلغته
    'driver', jsonb_build_object('telegram_id', v_user.telegram_id,
                                 'language_code', v_user.language_code,
                                 'full_name', v_user.full_name),
    'rider',  jsonb_build_object('telegram_id', v_rider_u.telegram_id,
                                 'language_code', v_rider_u.language_code,
                                 'full_name', v_rider_u.full_name)
  );
end;
$$;

-- 7) تسجيل تقييم ---------------------------------------------------------------------
create or replace function submit_rating(
  p_order_id uuid,
  p_rater_telegram_id bigint,
  p_stars smallint,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order     orders%rowtype;
  v_rater     users%rowtype;
  v_driver    drivers%rowtype;
  v_rider     riders%rowtype;
  v_driver_u  users%rowtype;
  v_rider_u   users%rowtype;
  v_direction rating_direction;
  v_ratee     uuid;
  v_window    integer;
  v_now       timestamptz := now();
  v_rating_id uuid;
begin
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    return jsonb_build_object('ok', false, 'error', 'STARS_OUT_OF_RANGE');
  end if;

  select * into v_rater from users where telegram_id = p_rater_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'RATER_NOT_FOUND');
  end if;

  select * into v_order from orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  if v_order.status <> 'completed' then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_COMPLETED');
  end if;

  select * into v_driver from drivers where id = v_order.assigned_driver_id;
  select * into v_driver_u from users where id = v_driver.user_id;
  select * into v_rider from riders where id = v_order.rider_id;
  select * into v_rider_u from users where id = v_rider.user_id;

  -- الاتجاه يُستنتج من هوية المُقيِّم لا يُمرَّر من الخارج: من ليس طرفاً في الرحلة لا يقيّمها
  if v_rater.id = v_rider_u.id then
    v_direction := 'rider_to_driver';
    v_ratee := v_driver_u.id;
  elsif v_rater.id = v_driver_u.id then
    v_direction := 'driver_to_rider';
    v_ratee := v_rider_u.id;
  else
    return jsonb_build_object('ok', false, 'error', 'RATER_NOT_PARTY_TO_ORDER');
  end if;

  v_window := coalesce(get_setting_number(v_order.city_id, 'rating_prompt_window_hours'), 48);
  if v_order.completed_at + make_interval(hours => v_window) < v_now then
    return jsonb_build_object('ok', false, 'error', 'RATING_WINDOW_CLOSED');
  end if;

  begin
    insert into ratings (city_id, order_id, direction, rater_user_id, ratee_user_id,
                         stars, comment)
    values (v_order.city_id, p_order_id, v_direction, v_rater.id, v_ratee,
            p_stars, nullif(btrim(coalesce(p_comment, '')), ''))
    returning id into v_rating_id;
  exception when unique_violation then
    -- القيد الفريد هو الحكم، لا فحص سابق في التطبيق: لا سباق ولا تقييم مكرَّر
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RATED');
  end;

  -- التحديث فوري ليُثمر التقييم في المطابقة التالية مباشرة، والجوب الدوري
  -- يعيد الحساب من المصدر ليصحّح أي انحراف تراكمي.
  if v_direction = 'rider_to_driver' then
    update drivers d
       set rating_average = agg.avg_stars, rating_count = agg.total
      from (select round(avg(stars)::numeric, 2) as avg_stars, count(*)::integer as total
              from ratings
             where ratee_user_id = v_ratee and is_flagged = false) as agg
     where d.id = v_driver.id;
  else
    update riders r
       set rating_average = agg.avg_stars, rating_count = agg.total
      from (select round(avg(stars)::numeric, 2) as avg_stars, count(*)::integer as total
              from ratings
             where ratee_user_id = v_ratee and is_flagged = false) as agg
     where r.id = v_rider.id;
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_rater.id, 'rating.submitted', 'rating', v_rating_id,
          jsonb_build_object('order_id', p_order_id, 'direction', v_direction,
                             'stars', p_stars, 'ratee_user_id', v_ratee));

  return jsonb_build_object('ok', true, 'rating_id', v_rating_id,
                            'direction', v_direction, 'stars', p_stars);
end;
$$;

-- 8) علَم الإساءة: يستثني التقييم من المتوسط بلا محوه ------------------------------
create or replace function flag_rating(p_rating_id uuid, p_actor_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rating ratings%rowtype;
  v_actor  users%rowtype;
begin
  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_FOUND');
  end if;
  if v_actor.role not in ('admin', 'support') then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_AUTHORIZED');
  end if;

  update ratings set is_flagged = true
   where id = p_rating_id and is_flagged = false
   returning * into v_rating;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'RATING_NOT_FLAGGABLE');
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_rating.city_id, v_actor.id, 'rating.flagged', 'rating', p_rating_id,
          jsonb_build_object('order_id', v_rating.order_id, 'stars', v_rating.stars));

  return jsonb_build_object('ok', true, 'rating_id', p_rating_id);
end;
$$;

-- 9) إعادة الحساب الدورية من المصدر --------------------------------------------------
create or replace function recompute_rating_averages()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_drivers integer := 0;
  v_riders  integer := 0;
begin
  -- من لا تقييم له يعود إلى NULL لا إلى صفر: الصفر تقييم سيّئ، والغياب ليس تقييماً
  with agg as (
    select u.id as user_id,
           round(avg(r.stars)::numeric, 2) as avg_stars,
           count(r.id)::integer as total
      from users u
      left join ratings r
             on r.ratee_user_id = u.id
            and r.is_flagged = false
            and r.direction = 'rider_to_driver'
     group by u.id
  )
  update drivers d
     set rating_average = agg.avg_stars, rating_count = coalesce(agg.total, 0)
    from agg
   where agg.user_id = d.user_id
     and (d.rating_average is distinct from agg.avg_stars
          or d.rating_count is distinct from coalesce(agg.total, 0));
  get diagnostics v_drivers = row_count;

  with agg as (
    select u.id as user_id,
           round(avg(r.stars)::numeric, 2) as avg_stars,
           count(r.id)::integer as total
      from users u
      left join ratings r
             on r.ratee_user_id = u.id
            and r.is_flagged = false
            and r.direction = 'driver_to_rider'
     group by u.id
  )
  update riders rd
     set rating_average = agg.avg_stars, rating_count = coalesce(agg.total, 0)
    from agg
   where agg.user_id = rd.user_id
     and (rd.rating_average is distinct from agg.avg_stars
          or rd.rating_count is distinct from coalesce(agg.total, 0));
  get diagnostics v_riders = row_count;

  return jsonb_build_object('ok', true, 'drivers_updated', v_drivers,
                            'riders_updated', v_riders);
end;
$$;

-- 10) ملخّص سمعة مستخدم لواجهة الإدارة والبوت --------------------------------------
create or replace function get_reputation_summary(p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'as_driver', (select jsonb_build_object('average', d.rating_average, 'count', d.rating_count)
                    from drivers d where d.user_id = v_user.id),
    'as_rider',  (select jsonb_build_object('average', r.rating_average, 'count', r.rating_count)
                    from riders r where r.user_id = v_user.id),
    'received',  coalesce((select jsonb_agg(jsonb_build_object(
                             'stars', r.stars, 'direction', r.direction,
                             'comment', r.comment, 'created_at', r.created_at)
                             order by r.created_at desc)
                    from ratings r
                   where r.ratee_user_id = v_user.id and r.is_flagged = false), '[]'::jsonb)
  );
end;
$$;
