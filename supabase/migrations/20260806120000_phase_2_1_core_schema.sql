-- =============================================================================
-- وَصْلة — المرحلة 2.1 — المخطط الأساسي
-- القواعد الحاكمة المطبَّقة هنا حرفياً:
--   (0.3) لا قيمة تجارية داخل الكود  -> كلها في platform_settings
--   (0.4) كل جدول يحمل city_id       -> بلا استثناء، حتى cities و platform_settings
--   (0.5) كل عملية حرجة عبر RPC ذرّي -> ملف 20260806120100
--   RLS مفعّلة على كل جدول منذ إنشائه
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists postgis;

-- ----------------------------------------------------------------------------
-- الأنواع المعدودة
-- ----------------------------------------------------------------------------
do $$ begin
  create type service_type as enum ('transport', 'delivery');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role as enum ('rider', 'driver', 'support', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type verification_status as enum ('pending', 'verified', 'rejected', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_plan as enum ('transport', 'delivery', 'both');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('trialing', 'active', 'expired', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum
    ('searching', 'matched', 'in_progress', 'completed', 'cancelled', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type offer_status as enum
    ('pending', 'accepted', 'rejected', 'expired', 'cancelled');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- محفّز updated_at
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) cities — المدن الأربع وقروباتها الثلاثة
--    city_id عمود مولَّد يساوي id، حتى لا يُستثنى هذا الجدول من القاعدة (0.4)
-- ----------------------------------------------------------------------------
create table if not exists cities (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid generated always as (id) stored,
  code        text not null unique,
  name_ar     text not null,
  name_en     text not null,
  is_active   boolean not null default false,
  telegram_support_group_id              bigint,
  telegram_escalation_group_id           bigint,
  telegram_unsubscribed_drivers_group_id bigint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- لا تُفعَّل مدينة قبل ربط قروباتها الثلاثة — يمنع تشغيل مدينة بلا مسار إسناد
  constraint cities_active_requires_groups check (
    is_active = false or (
      telegram_support_group_id is not null and
      telegram_escalation_group_id is not null and
      telegram_unsubscribed_drivers_group_id is not null
    )
  )
);
create trigger cities_set_updated_at before update on cities
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 2) platform_settings — كل قيمة تجارية قابلة للتغيير، لكل مدينة
-- ----------------------------------------------------------------------------
create table if not exists platform_settings (
  id             uuid primary key default gen_random_uuid(),
  city_id        uuid not null references cities(id) on delete cascade,
  key            text not null,
  value          jsonb not null,
  value_type     text not null check (value_type in ('number', 'string', 'boolean', 'array')),
  description_ar text not null,
  is_provisional boolean not null default false, -- قيمة مبدئية تنتظر مراجعة المالك
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (city_id, key)
);
create trigger platform_settings_set_updated_at before update on platform_settings
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 3) users
-- ----------------------------------------------------------------------------
create table if not exists users (
  id                uuid primary key default gen_random_uuid(),
  city_id           uuid not null references cities(id),
  telegram_id       bigint not null unique,
  telegram_username text,
  full_name         text,
  phone             text,
  language_code     text not null default 'ar',
  role              user_role not null,
  is_blocked        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists users_city_idx on users (city_id);
create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 4) drivers
-- ----------------------------------------------------------------------------
create table if not exists drivers (
  id                  uuid primary key default gen_random_uuid(),
  city_id             uuid not null references cities(id),
  user_id             uuid not null unique references users(id) on delete cascade,
  verification_status verification_status not null default 'pending',
  vehicle_type        text,
  plate_number        text,
  last_location       geography(Point, 4326),
  last_location_at    timestamptz,
  rating_average      numeric(3,2),   -- يبقى NULL حتى المرحلة 2.5؛ البديل من platform_settings
  rating_count        integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists drivers_city_idx on drivers (city_id);
create index if not exists drivers_location_gix on drivers using gist (last_location);
create trigger drivers_set_updated_at before update on drivers
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 5) riders
-- ----------------------------------------------------------------------------
create table if not exists riders (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references cities(id),
  user_id    uuid not null unique references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists riders_city_idx on riders (city_id);
create trigger riders_set_updated_at before update on riders
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 6) driver_capabilities — نوع الخدمة المفعَّلة للسائق
-- ----------------------------------------------------------------------------
create table if not exists driver_capabilities (
  id           uuid primary key default gen_random_uuid(),
  city_id      uuid not null references cities(id),
  driver_id    uuid not null references drivers(id) on delete cascade,
  service      service_type not null,
  is_enabled   boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (driver_id, service)
);
create index if not exists driver_capabilities_city_idx on driver_capabilities (city_id);
create trigger driver_capabilities_set_updated_at before update on driver_capabilities
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 7) subscriptions
-- ----------------------------------------------------------------------------
create table if not exists subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  city_id            uuid not null references cities(id),
  driver_id          uuid not null references drivers(id) on delete cascade,
  plan               subscription_plan not null,
  status             subscription_status not null,
  trial_ends_at      timestamptz,
  current_period_end timestamptz,
  price_amount       numeric(10,2),  -- لقطة تاريخية للسعر وقت التفعيل، مصدرها platform_settings
  currency           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists subscriptions_city_idx on subscriptions (city_id);
-- اشتراك فعّال واحد فقط لكل سائق
create unique index if not exists subscriptions_one_live_per_driver
  on subscriptions (driver_id) where status in ('trialing', 'active');
create trigger subscriptions_set_updated_at before update on subscriptions
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 8) driver_availability — الحالة الحالية
-- ----------------------------------------------------------------------------
create table if not exists driver_availability (
  id           uuid primary key default gen_random_uuid(),
  city_id      uuid not null references cities(id),
  driver_id    uuid not null unique references drivers(id) on delete cascade,
  is_available boolean not null default false,
  changed_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists driver_availability_city_idx on driver_availability (city_id);
create trigger driver_availability_set_updated_at before update on driver_availability
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 9) attendance_log — سجل كل تبديل
-- ----------------------------------------------------------------------------
create table if not exists attendance_log (
  id           uuid primary key default gen_random_uuid(),
  city_id      uuid not null references cities(id),
  driver_id    uuid not null references drivers(id) on delete cascade,
  is_available boolean not null,
  source       text not null default 'driver_bot',
  changed_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists attendance_log_city_idx on attendance_log (city_id);
create index if not exists attendance_log_driver_time_idx on attendance_log (driver_id, changed_at desc);

-- ----------------------------------------------------------------------------
-- 10) orders
-- ----------------------------------------------------------------------------
create table if not exists orders (
  id                 uuid primary key default gen_random_uuid(),
  city_id            uuid not null references cities(id),
  rider_id           uuid not null references riders(id) on delete cascade,
  service            service_type not null,
  status             order_status not null default 'searching',
  pickup             geography(Point, 4326) not null,
  dropoff            geography(Point, 4326),
  pickup_label       text,
  dropoff_label      text,
  notes              text,
  assigned_driver_id uuid references drivers(id),
  broadcast_round    integer not null default 0,
  matched_at         timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  cancelled_reason   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint orders_matched_requires_driver check (
    status not in ('matched', 'in_progress', 'completed') or assigned_driver_id is not null
  )
);
create index if not exists orders_city_status_idx on orders (city_id, status);
create index if not exists orders_pickup_gix on orders using gist (pickup);
create trigger orders_set_updated_at before update on orders
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 11) order_offers — العروض المبثوثة
-- ----------------------------------------------------------------------------
create table if not exists order_offers (
  id            uuid primary key default gen_random_uuid(),
  city_id       uuid not null references cities(id),
  order_id      uuid not null references orders(id) on delete cascade,
  driver_id     uuid not null references drivers(id) on delete cascade,
  round         integer not null default 1,
  score         numeric(10,4),
  distance_km   numeric(10,3),
  status        offer_status not null default 'pending',
  expires_at    timestamptz not null,
  responded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (order_id, driver_id, round)
);
create index if not exists order_offers_city_idx on order_offers (city_id);
create index if not exists order_offers_pending_idx on order_offers (status, expires_at)
  where status = 'pending';
-- عرض مقبول واحد فقط لكل طلب — حاجز أخير فوق ذرّية claim_ride
create unique index if not exists order_offers_single_accepted
  on order_offers (order_id) where status = 'accepted';
create trigger order_offers_set_updated_at before update on order_offers
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 12) audit_log
-- ----------------------------------------------------------------------------
create table if not exists audit_log (
  id            uuid primary key default gen_random_uuid(),
  city_id       uuid not null references cities(id),
  actor_user_id uuid references users(id),
  action        text not null,
  entity_type   text not null,
  entity_id     uuid,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists audit_log_city_time_idx on audit_log (city_id, created_at desc);
create index if not exists audit_log_entity_idx on audit_log (entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- RLS: مفعّلة على كل جدول، ومرفوضة افتراضياً لكل الأدوار العامة.
-- الوصول في المرحلة 2.1 يتم حصراً من الخادم بمفتاح service_role (يتجاوز RLS)،
-- وسياسات المستخدم النهائي تُضاف عند بناء واجهة تستخدم anon key.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'cities','platform_settings','users','drivers','riders','driver_capabilities',
    'subscriptions','driver_availability','attendance_log','orders','order_offers','audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;
