-- OPS-ALERT-01 — إعدادُ مراقبِ البوّابةِ على Supabase.
-- ليسَ هجرةَ تطبيقٍ ولا يوضَعُ في supabase/migrations: يعتمدُ على pg_cron وpg_net الخاصّين بـSupabase
-- (غيرُ موجودَين في PostgreSQL الذي يُشغِّلُه CI)، ويعيشُ في مخطَّطِ `ops` المعزولِ عن `public` وعن PostgREST.
-- يُعادُ تشغيلُه بأمان (idempotent). المستلِمونَ لا يُكتَبونَ هنا (المستودَعُ عامّ) — انظر README.md.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

create table if not exists ops.watchdog_config (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  test_pending boolean not null default false,
  target_url text not null default 'https://waslah-gateway.onrender.com/ready',
  telegram_chat_ids text[] not null default '{}',
  email_to text[] not null default '{}',
  email_from text not null default '',
  fail_threshold int not null default 2,          -- فحصانِ فاشلانِ متتاليانِ (~دقيقتان) قبلَ «متوقّفة»
  down_tg_every_s int not null default 60,        -- Telegram كلَّ دقيقةٍ أثناءَ التوقّف
  down_email_every_s int not null default 600,    -- بريدٌ كلَّ 10 دقائق أثناءَ التوقّف
  degraded_grace_s int not null default 600,      -- التدهورُ يُنبَّهُ عنه بعدَ 10 دقائقَ متّصلة
  degraded_tg_every_s int not null default 600,
  degraded_email_every_s int not null default 3600,
  daily_utc_hour int not null default 6           -- 09:00 بتوقيتِ الرياض
);

create table if not exists ops.watchdog_state (
  id int primary key default 1 check (id = 1),
  status text not null default 'unknown' check (status in ('unknown','up','degraded','down')),
  since timestamptz not null default now(),
  consecutive_failures int not null default 0,
  last_check_at timestamptz,
  last_detail text,
  last_ms int,
  last_tg_at timestamptz,
  last_email_at timestamptz,
  alerted boolean not null default false,
  last_daily_on text
);

create table if not exists ops.watchdog_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,
  detail text
);

insert into ops.watchdog_config (id) values (1) on conflict do nothing;
insert into ops.watchdog_state (id) values (1) on conflict do nothing;

-- تنظيفُ السجلِّ: يُبقي 30 يوماً.
select cron.schedule('ops-watchdog-events-prune', '17 3 * * *',
  $$delete from ops.watchdog_events where at < now() - interval '30 days'$$);

-- مفتاحُ الاستدعاءِ (المفتاحُ العامُّ anon للمشروع؛ ليسَ سرّاً لكنّه لا يُكتَبُ هنا) يُحفَظُ مرّةً في Vault:
--   select vault.create_secret('<anon key>', 'watchdog_invoke_key');
-- النبضُ كلَّ دقيقة. الدالّةُ تتحمّلُ الاستدعاءَ المتكرّرَ (تتجاهلُ ما يأتي قبلَ 40 ثانيةً من الفحصِ السابق).
select cron.schedule('ops-gateway-watchdog', '* * * * *', $$
  select net.http_post(
    url := 'https://jafuchojgxzeuvibkkfx.supabase.co/functions/v1/gateway-watchdog',
    headers := jsonb_build_object('content-type','application/json',
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'watchdog_invoke_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000)
$$);
