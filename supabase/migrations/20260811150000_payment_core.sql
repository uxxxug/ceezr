-- =============================================================================
-- الغرض: جداول الدفع لاشتراك السائق الشهري فقط — البند 8.
--   payment_transactions: معاملة دفع مستقلّة (لا ترتبط بطلب ولا رحلة — البند 8.5).
--   ledger_entries: دفتر الأستاذ، السطر الوحيد المكتوب فيه الآن هو دفعة اشتراك السائق.
--   webhook_events: تخزين أحداث الويبهوك لمنع المعالجة المكررة (Idempotency).
--     جدول عام (global) — لا city_id: الحدث لا ينتمي لمدينة بل لمزوّد دفع.
--     هذا استثناء موثَّق من قاعدة city_id في كل جدول.
-- الحالة: منفّذ فعلياً.
-- ينتمي إلى: supabase/migrations
--
-- ## القواعد المحرِّمة المطبَّقة هنا:
--   - لا float: المبلغ بوحدات صغرى (integer) لا numeric عشريّ.
--   - city_id في كل جدول (القاعدة 0.4) — عبر driver_id الذي يحمل مدينته.
--     الاستثناء الوحيد: webhook_events (جدول عام لا ينتمي لمدينة).
--   - كل عملية حرجة عبر RPC ذرّي (القاعدة 0.4) — لا UPDATE خام.
--   - لا قيمة تجارية في الكود (القاعدة 0.2) — المدة تُقرأ من platform_settings.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1) payment_transactions — معاملة دفع مستقلّة
-- ----------------------------------------------------------------------------
create table if not exists payment_transactions (
  id                     uuid primary key default gen_random_uuid(),
  city_id                uuid not null references cities(id),
  payer_driver_id        uuid not null references drivers(id) on delete cascade,
  payee_id               text not null default 'platform',
  purpose                text not null default 'driver_subscription',
  amount_minor           integer not null check (amount_minor > 0),
  currency               text not null check (length(currency) = 3),
  provider               text not null,
  provider_transaction_id text,
  status                 text not null default 'pending'
                         check (status in ('active','pending','past_due','failed','canceled','expired')),
  idempotency_key        text not null,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists payment_transactions_idempotency_key_uniq
  on payment_transactions (idempotency_key);
create index if not exists payment_transactions_city_idx on payment_transactions (city_id);
create index if not exists payment_transactions_driver_idx on payment_transactions (payer_driver_id);
create index if not exists payment_transactions_status_idx on payment_transactions (status);

create trigger payment_transactions_set_updated_at before update on payment_transactions
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 2) ledger_entries — دفتر الأستاذ (سطر اشتراك السائق وحده يُكتب الآن)
-- ----------------------------------------------------------------------------
create table if not exists ledger_entries (
  id                uuid primary key default gen_random_uuid(),
  city_id           uuid not null references cities(id),
  transaction_id    uuid not null references payment_transactions(id) on delete cascade,
  driver_id         uuid not null references drivers(id) on delete cascade,
  entry_type        text not null check (entry_type in ('debit','credit','fee','commission','refund','payout','settlement')),
  amount_minor      integer not null check (amount_minor > 0),
  currency          text not null check (length(currency) = 3),
  created_at        timestamptz not null default now()
);

create index if not exists ledger_entries_city_idx on ledger_entries (city_id);
create index if not exists ledger_entries_driver_idx on ledger_entries (driver_id);
create index if not exists ledger_entries_transaction_idx on ledger_entries (transaction_id);

-- ----------------------------------------------------------------------------
-- 3) webhook_events — منع معالجة الحدث مرّتين (Idempotency)
--    جدول عام (global) — لا city_id: الحدث ينتمي لمزوّد دفع لا لمدينة.
--    استثناء موثَّق من قاعدة city_id في كل جدول.
-- ----------------------------------------------------------------------------
create table if not exists webhook_events (
  id              uuid primary key default gen_random_uuid(),
  event_id        text not null,
  provider        text not null,
  payload         text not null,
  created_at      timestamptz not null default now()
);

create unique index if not exists webhook_events_event_provider_uniq
  on webhook_events (provider, event_id);

-- ----------------------------------------------------------------------------
-- RPC: create_payment — إنشاء معاملة ذرّياً مع حماية الإيدمبوتنسي
-- يعيد المعاملة الموجودة إن كان المفتاح مكرَّراً، فلا يُنشئ ثانية.
-- ----------------------------------------------------------------------------
create or replace function create_payment(
  p_city_id uuid,
  p_driver_id uuid,
  p_purpose text,
  p_amount_minor integer,
  p_currency text,
  p_provider text,
  p_provider_transaction_id text,
  p_status text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing payment_transactions%rowtype;
  v_id uuid;
begin
  -- الإيدمبوتنسي: إن وُجدت معاملة بنفس المفتاح أعددها لا تُنشئ ثانية.
  select * into v_existing
    from payment_transactions
   where idempotency_key = p_idempotency_key
   for update;
  if found then
    return jsonb_build_object('ok', true, 'transaction_id', v_existing.id,
      'status', v_existing.status, 'provider_transaction_id', v_existing.provider_transaction_id,
      'already_exists', true);
  end if;

  insert into payment_transactions
    (city_id, payer_driver_id, purpose, amount_minor, currency, provider,
     provider_transaction_id, status, idempotency_key, metadata)
  values
    (p_city_id, p_driver_id, p_purpose, p_amount_minor, p_currency, p_provider,
     p_provider_transaction_id, p_status, p_idempotency_key, p_metadata)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'transaction_id', v_id, 'status', p_status,
    'provider_transaction_id', p_provider_transaction_id, 'already_exists', false);
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: confirm_payment — تأكيد ذرّي: يحدّث المعاملة + يُفعّل الاشتراك + دفتر الأستاذ
-- كلها في معاملة واحدة لا تُكسر. يعيد المعاملة المحدّثة.
--
-- يُعيد استخدام activate_subscription القائمة (تقرأ السعر والعملة والمدة من
-- platform_settings) بدلاً من تكرار منطقها — لا قيمة تجارية في الكود (القاعدة 0.2).
-- ----------------------------------------------------------------------------
create or replace function confirm_payment(
  p_transaction_id uuid,
  p_provider_transaction_id text,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx payment_transactions%rowtype;
  v_plan subscription_plan;
  v_sub_id uuid;
  v_period_end timestamptz;
  v_days integer;
begin
  select * into v_tx from payment_transactions where id = p_transaction_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_FOUND');
  end if;

  -- لا تؤكَّد معاملة منتهية: active/failed/canceled/expired نهائية.
  if v_tx.status not in ('pending', 'past_due') then
    return jsonb_build_object('ok', true, 'transaction_id', v_tx.id,
      'status', v_tx.status, 'already_confirmed', true);
  end if;

  update payment_transactions
     set status = p_new_status,
         provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id),
         updated_at = now()
   where id = p_transaction_id;

  -- فقط الناجح (active) يُفعّل الاشتراك ويكتب دفتر الأستاذ.
  -- نُعيد استخدام activate_subscription القائمة: تقرأ السعر والعملة من
  -- platform_settings، وتنهي الاشتراك السابق، وتُنشئ الجديد. لا نكرّر منطقها.
  if p_new_status = 'active' then
    v_plan := coalesce(v_tx.metadata->>'plan', 'both')::subscription_plan;
    v_days := get_setting_number(v_tx.city_id, 'trial_days')::int;
    v_period_end := now() + make_interval(days => v_days);

    -- activate_subscription يقرأ السعر والعملة من platform_settings بنفس المنطق القائم.
    perform activate_subscription(v_tx.payer_driver_id, v_plan, v_days);

    -- نقرأ معرّف الاشتراك المنشأ لتسجيله في دفتر الأستاذ والتدقيق.
    select id into v_sub_id from subscriptions
     where driver_id = v_tx.payer_driver_id and status = 'active'
     order by created_at desc limit 1;

    -- دفتر الأستاذ: سطر دائن واحد لدفعة الاشتراك (السطر الوحيد المكتوب الآن).
    insert into ledger_entries
      (city_id, transaction_id, driver_id, entry_type, amount_minor, currency)
    values
      (v_tx.city_id, v_tx.id, v_tx.payer_driver_id, 'credit', v_tx.amount_minor, v_tx.currency);

    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    select v_tx.city_id, d.user_id, 'subscription.activated_via_payment',
           'subscription', v_sub_id,
           jsonb_build_object('transaction_id', v_tx.id, 'plan', v_plan,
                              'amount_minor', v_tx.amount_minor, 'currency', v_tx.currency,
                              'period_end', v_period_end)
      from drivers d where d.id = v_tx.payer_driver_id;
  end if;

  return jsonb_build_object('ok', true, 'transaction_id', v_tx.id,
    'status', p_new_status, 'subscription_id', v_sub_id, 'already_confirmed', false);
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: record_webhook_event — Idempotency للويبهوك
-- يعيد true إن كان جديداً، false إن كان مكرَّراً.
-- ----------------------------------------------------------------------------
create or replace function record_webhook_event(
  p_event_id text,
  p_provider text,
  p_payload text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into webhook_events (event_id, provider, payload)
  values (p_event_id, p_provider, p_payload)
  on conflict (provider, event_id) do nothing;
  return jsonb_build_object('ok', true, 'is_new', found);
end;
$$;
