-- اشتراكات السائق فقط: محفظة ائتمان ودفترها، ردّ دفعات الاشتراك، فواتيرها، وتسوية خطأ نظام موثقة.
-- لا يوجد في هذا المخطط أي حجز أو عمولة أو تمرير لأجرة رحلة.

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'subscription_wallet_currency', '"SAR"'::jsonb, 'string',
       'عملة محفظة ائتمان الاشتراك للسائق؛ لا تقبل المحفظة أكثر من عملة واحدة.', true
from cities
on conflict (city_id, key) do update
set value = excluded.value, value_type = excluded.value_type,
    description_ar = excluded.description_ar, is_provisional = excluded.is_provisional;

create table if not exists subscription_wallets (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id),
  driver_id uuid not null references drivers(id) on delete cascade,
  currency text not null check (length(currency) = 3),
  created_at timestamptz not null default now(),
  unique (driver_id)
);
create index if not exists subscription_wallets_city_idx on subscription_wallets(city_id);

create table if not exists subscription_wallet_entries (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id),
  wallet_id uuid not null references subscription_wallets(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  source_payment_id uuid references payment_transactions(id),
  entry_kind text not null check (entry_kind in ('subscription_top_up','subscription_refund','subscription_charge','administrative_system_error_adjustment')),
  direction text not null check (direction in ('credit','debit')),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (length(currency) = 3),
  idempotency_key text not null,
  actor_user_id uuid references users(id),
  reason text,
  reference text,
  created_at timestamptz not null default now(),
  unique (idempotency_key),
  unique (source_payment_id)
);
create index if not exists subscription_wallet_entries_wallet_idx on subscription_wallet_entries(wallet_id, created_at);
create index if not exists subscription_wallet_entries_city_idx on subscription_wallet_entries(city_id);

create table if not exists subscription_refunds (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id),
  payment_transaction_id uuid not null references payment_transactions(id),
  driver_id uuid not null references drivers(id),
  wallet_id uuid references subscription_wallets(id),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (length(currency) = 3),
  destination text not null check (destination in ('wallet_credit','provider_refund')),
  actor_user_id uuid references users(id),
  reason text not null,
  reference text not null,
  created_at timestamptz not null default now(),
  unique (payment_transaction_id)
);
create index if not exists subscription_refunds_city_idx on subscription_refunds(city_id);

create table if not exists subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id),
  payment_transaction_id uuid not null references payment_transactions(id),
  driver_id uuid not null references drivers(id),
  invoice_year integer not null,
  invoice_sequence integer not null check (invoice_sequence > 0),
  invoice_number text not null,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (length(currency) = 3),
  plan subscription_plan not null,
  issued_at timestamptz not null default now(),
  unique (payment_transaction_id),
  unique (city_id, invoice_year, invoice_sequence),
  unique (city_id, invoice_number)
);
create index if not exists subscription_invoices_city_idx on subscription_invoices(city_id, invoice_year);

alter table payment_transactions drop constraint if exists payment_transactions_status_check;
alter table payment_transactions add constraint payment_transactions_status_check
  check (status in ('active','pending','past_due','failed','canceled','expired','refunded'));

create or replace function create_subscription_wallet(p_driver_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_driver drivers%rowtype; v_wallet subscription_wallets%rowtype; v_currency text;
begin
  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND'); end if;
  select * into v_wallet from subscription_wallets where driver_id = p_driver_id for update;
  if found then return jsonb_build_object('ok', true, 'wallet_id', v_wallet.id, 'currency', v_wallet.currency, 'already_exists', true); end if;
  v_currency := get_setting(v_driver.city_id, 'subscription_wallet_currency') #>> '{}';
  if v_currency is null or length(v_currency) <> 3 then return jsonb_build_object('ok', false, 'error', 'WALLET_CURRENCY_NOT_CONFIGURED'); end if;
  insert into subscription_wallets(city_id, driver_id, currency) values(v_driver.city_id, p_driver_id, upper(v_currency)) returning * into v_wallet;
  insert into audit_log(city_id, actor_user_id, action, entity_type, entity_id, payload)
  values(v_wallet.city_id, v_driver.user_id, 'subscription_wallet.created', 'subscription_wallet', v_wallet.id, jsonb_build_object('driver_id', p_driver_id, 'currency', v_wallet.currency));
  return jsonb_build_object('ok', true, 'wallet_id', v_wallet.id, 'currency', v_wallet.currency, 'already_exists', false);
end $$;

create or replace function subscription_wallet_balance(p_driver_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_wallet subscription_wallets%rowtype; v_balance bigint;
begin
  select * into v_wallet from subscription_wallets where driver_id = p_driver_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'WALLET_NOT_FOUND'); end if;
  select coalesce(sum(case direction when 'credit' then amount_minor else -amount_minor end), 0) into v_balance from subscription_wallet_entries where wallet_id = v_wallet.id;
  return jsonb_build_object('ok', true, 'wallet_id', v_wallet.id, 'currency', v_wallet.currency, 'balance_minor', v_balance);
end $$;

create or replace function top_up_subscription_wallet(
  p_driver_id uuid, p_payment_id uuid, p_amount_minor integer, p_actor_user_id uuid,
  p_reason text, p_reference text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_driver drivers%rowtype; v_wallet subscription_wallets%rowtype; v_payment payment_transactions%rowtype; v_actor users%rowtype; v_entry subscription_wallet_entries%rowtype; v_kind text; v_amount integer; v_balance bigint;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED'); end if;
  select * into v_entry from subscription_wallet_entries where idempotency_key = p_idempotency_key for update;
  if found then
    select coalesce(sum(case direction when 'credit' then amount_minor else -amount_minor end),0) into v_balance from subscription_wallet_entries where wallet_id=v_entry.wallet_id;
    return jsonb_build_object('ok', true, 'wallet_id', v_entry.wallet_id, 'entry_id', v_entry.id, 'already_exists', true, 'balance_minor', v_balance);
  end if;
  select * into v_driver from drivers where id=p_driver_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND'); end if;
  perform create_subscription_wallet(p_driver_id);
  select * into v_wallet from subscription_wallets where driver_id=p_driver_id for update;
  if p_payment_id is not null then
    select * into v_payment from payment_transactions where id=p_payment_id for update;
    if not found or v_payment.payer_driver_id <> p_driver_id or v_payment.city_id <> v_driver.city_id then return jsonb_build_object('ok', false, 'error', 'SUBSCRIPTION_PAYMENT_NOT_FOUND'); end if;
    if v_payment.purpose <> 'driver_subscription' or v_payment.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'PAYMENT_NOT_CONFIRMED'); end if;
    if p_amount_minor <> v_payment.amount_minor or v_payment.currency <> v_wallet.currency then return jsonb_build_object('ok', false, 'error', 'PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH'); end if;
    select * into v_entry from subscription_wallet_entries where source_payment_id=p_payment_id for update;
    if found then return jsonb_build_object('ok', true, 'wallet_id', v_entry.wallet_id, 'entry_id', v_entry.id, 'already_exists', true); end if;
    v_kind := 'subscription_top_up'; v_amount := v_payment.amount_minor;
  else
    select * into v_actor from users where id=p_actor_user_id and city_id=v_driver.city_id for update;
    if not found or v_actor.role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'ADMIN_ACTOR_REQUIRED'); end if;
    if p_amount_minor is null or p_amount_minor <= 0 or coalesce(trim(p_reason),'')='' or coalesce(trim(p_reference),'')='' then return jsonb_build_object('ok', false, 'error', 'ADMIN_DECISION_INCOMPLETE'); end if;
    v_kind := 'administrative_system_error_adjustment'; v_amount := p_amount_minor;
  end if;
  insert into subscription_wallet_entries(city_id,wallet_id,driver_id,source_payment_id,entry_kind,direction,amount_minor,currency,idempotency_key,actor_user_id,reason,reference)
  values(v_driver.city_id,v_wallet.id,p_driver_id,p_payment_id,v_kind,'credit',v_amount,v_wallet.currency,p_idempotency_key,p_actor_user_id,p_reason,p_reference)
  on conflict (idempotency_key) do nothing returning * into v_entry;
  if not found then
    select * into v_entry from subscription_wallet_entries where idempotency_key=p_idempotency_key or source_payment_id=p_payment_id order by created_at limit 1;
    select coalesce(sum(case direction when 'credit' then amount_minor else -amount_minor end),0) into v_balance from subscription_wallet_entries where wallet_id=v_entry.wallet_id;
    return jsonb_build_object('ok',true,'wallet_id',v_entry.wallet_id,'entry_id',v_entry.id,'already_exists',true,'balance_minor',v_balance);
  end if;
  select coalesce(sum(case direction when 'credit' then amount_minor else -amount_minor end),0) into v_balance from subscription_wallet_entries where wallet_id=v_wallet.id;
  insert into audit_log(city_id,actor_user_id,action,entity_type,entity_id,payload) values(v_driver.city_id,coalesce(p_actor_user_id,v_driver.user_id),'subscription_wallet.topped_up','subscription_wallet_entry',v_entry.id,jsonb_build_object('wallet_id',v_wallet.id,'payment_id',p_payment_id,'amount_minor',v_amount,'reference',p_reference));
  return jsonb_build_object('ok',true,'wallet_id',v_wallet.id,'entry_id',v_entry.id,'already_exists',false,'balance_minor',v_balance);
end $$;

create or replace function refund_subscription_payment(p_payment_id uuid, p_amount_minor integer, p_destination text, p_actor_user_id uuid, p_reason text, p_reference text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_payment payment_transactions%rowtype; v_refund subscription_refunds%rowtype; v_driver drivers%rowtype; v_wallet subscription_wallets%rowtype; v_entry subscription_wallet_entries%rowtype;
begin
  select * into v_payment from payment_transactions where id=p_payment_id for update;
  if not found or v_payment.purpose <> 'driver_subscription' then return jsonb_build_object('ok',false,'error','SUBSCRIPTION_PAYMENT_NOT_FOUND'); end if;
  select * into v_refund from subscription_refunds where payment_transaction_id=p_payment_id for update;
  if found then return jsonb_build_object('ok',true,'refund_id',v_refund.id,'already_refunded',true,'destination',v_refund.destination); end if;
  if v_payment.status <> 'active' then return jsonb_build_object('ok',false,'error','PAYMENT_NOT_REFUNDABLE'); end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > v_payment.amount_minor then return jsonb_build_object('ok',false,'error','REFUND_AMOUNT_INVALID'); end if;
  if p_destination not in ('wallet_credit','provider_refund') or coalesce(trim(p_reason),'')='' or coalesce(trim(p_reference),'')='' then return jsonb_build_object('ok',false,'error','REFUND_DETAILS_INVALID'); end if;
  select * into v_driver from drivers where id=v_payment.payer_driver_id for update;
  if p_actor_user_id is not null and not exists(select 1 from users where id=p_actor_user_id and city_id=v_payment.city_id and role='admin') then return jsonb_build_object('ok',false,'error','ADMIN_ACTOR_REQUIRED'); end if;
  if p_destination='wallet_credit' then
    perform create_subscription_wallet(v_payment.payer_driver_id);
    select * into v_wallet from subscription_wallets where driver_id=v_payment.payer_driver_id for update;
    if v_wallet.currency <> v_payment.currency then return jsonb_build_object('ok',false,'error','WALLET_CURRENCY_MISMATCH'); end if;
    insert into subscription_wallet_entries(city_id,wallet_id,driver_id,source_payment_id,entry_kind,direction,amount_minor,currency,idempotency_key,actor_user_id,reason,reference)
    values(v_payment.city_id,v_wallet.id,v_payment.payer_driver_id,p_payment_id,'subscription_refund','credit',p_amount_minor,v_payment.currency,'refund:'||p_payment_id::text,p_actor_user_id,p_reason,p_reference) returning * into v_entry;
  end if;
  insert into subscription_refunds(city_id,payment_transaction_id,driver_id,wallet_id,amount_minor,currency,destination,actor_user_id,reason,reference)
  values(v_payment.city_id,p_payment_id,v_payment.payer_driver_id,case when p_destination='wallet_credit' then v_wallet.id else null end,p_amount_minor,v_payment.currency,p_destination,p_actor_user_id,p_reason,p_reference) returning * into v_refund;
  update payment_transactions set status='refunded',updated_at=now() where id=p_payment_id;
  insert into audit_log(city_id,actor_user_id,action,entity_type,entity_id,payload) values(v_payment.city_id,coalesce(p_actor_user_id,v_driver.user_id),'subscription_payment.refunded','payment_transaction',p_payment_id,jsonb_build_object('refund_id',v_refund.id,'amount_minor',p_amount_minor,'destination',p_destination,'reference',p_reference));
  return jsonb_build_object('ok',true,'refund_id',v_refund.id,'wallet_id',case when p_destination='wallet_credit' then v_wallet.id else null end,'already_refunded',false);
end $$;

create or replace function issue_subscription_invoice(p_payment_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_payment payment_transactions%rowtype; v_invoice subscription_invoices%rowtype; v_year integer; v_sequence integer; v_plan subscription_plan;
begin
  select * into v_payment from payment_transactions where id=p_payment_id for update;
  if not found or v_payment.purpose <> 'driver_subscription' or v_payment.status not in ('active','refunded') then return jsonb_build_object('ok',false,'error','CONFIRMED_SUBSCRIPTION_PAYMENT_REQUIRED'); end if;
  select * into v_invoice from subscription_invoices where payment_transaction_id=p_payment_id for update;
  if found then return jsonb_build_object('ok',true,'invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'already_issued',true); end if;
  v_plan := (v_payment.metadata->>'plan')::subscription_plan;
  if v_plan is null then return jsonb_build_object('ok',false,'error','PAYMENT_PLAN_MISSING'); end if;
  v_year := extract(year from now())::integer;
  perform pg_advisory_xact_lock(hashtext(v_payment.city_id::text || ':' || v_year::text));
  select coalesce(max(invoice_sequence),0)+1 into v_sequence from subscription_invoices where city_id=v_payment.city_id and invoice_year=v_year;
  insert into subscription_invoices(city_id,payment_transaction_id,driver_id,invoice_year,invoice_sequence,invoice_number,amount_minor,currency,plan)
  values(v_payment.city_id,p_payment_id,v_payment.payer_driver_id,v_year,v_sequence,(select code from cities where id=v_payment.city_id)||'-'||v_year::text||'-'||lpad(v_sequence::text,6,'0'),v_payment.amount_minor,v_payment.currency,v_plan) returning * into v_invoice;
  insert into audit_log(city_id,action,entity_type,entity_id,payload) values(v_payment.city_id,'subscription_invoice.issued','subscription_invoice',v_invoice.id,jsonb_build_object('payment_id',p_payment_id,'invoice_number',v_invoice.invoice_number,'amount_minor',v_invoice.amount_minor,'plan',v_invoice.plan));
  return jsonb_build_object('ok',true,'invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'already_issued',false);
end $$;

create or replace function settle_subscription_wallet_system_error(p_driver_id uuid, p_adjustment_minor integer, p_actor_user_id uuid, p_reason text, p_reference text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_driver drivers%rowtype; v_wallet subscription_wallets%rowtype; v_actor users%rowtype; v_entry subscription_wallet_entries%rowtype; v_balance bigint;
begin
  if p_adjustment_minor is null or p_adjustment_minor=0 or coalesce(trim(p_reason),'')='' or coalesce(trim(p_reference),'')='' or coalesce(trim(p_idempotency_key),'')='' then return jsonb_build_object('ok',false,'error','SETTLEMENT_DETAILS_INVALID'); end if;
  select * into v_entry from subscription_wallet_entries where idempotency_key=p_idempotency_key for update;
  if found then return jsonb_build_object('ok',true,'entry_id',v_entry.id,'already_exists',true); end if;
  select * into v_driver from drivers where id=p_driver_id for update; if not found then return jsonb_build_object('ok',false,'error','DRIVER_NOT_FOUND'); end if;
  select * into v_actor from users where id=p_actor_user_id and city_id=v_driver.city_id and role='admin' for update; if not found then return jsonb_build_object('ok',false,'error','ADMIN_ACTOR_REQUIRED'); end if;
  perform create_subscription_wallet(p_driver_id); select * into v_wallet from subscription_wallets where driver_id=p_driver_id for update;
  select coalesce(sum(case direction when 'credit' then amount_minor else -amount_minor end),0) into v_balance from subscription_wallet_entries where wallet_id=v_wallet.id;
  if p_adjustment_minor < 0 and v_balance + p_adjustment_minor < 0 then return jsonb_build_object('ok',false,'error','INSUFFICIENT_WALLET_CREDIT'); end if;
  insert into subscription_wallet_entries(city_id,wallet_id,driver_id,entry_kind,direction,amount_minor,currency,idempotency_key,actor_user_id,reason,reference)
  values(v_driver.city_id,v_wallet.id,p_driver_id,'administrative_system_error_adjustment',case when p_adjustment_minor>0 then 'credit' else 'debit' end,abs(p_adjustment_minor),v_wallet.currency,p_idempotency_key,p_actor_user_id,p_reason,p_reference)
  on conflict (idempotency_key) do nothing returning * into v_entry;
  if not found then
    select * into v_entry from subscription_wallet_entries where idempotency_key=p_idempotency_key;
    return jsonb_build_object('ok',true,'entry_id',v_entry.id,'wallet_id',v_entry.wallet_id,'already_exists',true);
  end if;
  insert into audit_log(city_id,actor_user_id,action,entity_type,entity_id,payload) values(v_driver.city_id,p_actor_user_id,'subscription_wallet.system_error_settled','subscription_wallet_entry',v_entry.id,jsonb_build_object('wallet_id',v_wallet.id,'adjustment_minor',p_adjustment_minor,'reason',p_reason,'reference',p_reference));
  return jsonb_build_object('ok',true,'entry_id',v_entry.id,'wallet_id',v_wallet.id,'already_exists',false);
end $$;

do $$ declare t text; begin
  foreach t in array array['subscription_wallets','subscription_wallet_entries','subscription_refunds','subscription_invoices'] loop
    execute format('alter table %I enable row level security',t);
    execute format('revoke all on table %I from anon, authenticated',t);
    execute format('drop policy if exists %I on %I', t || '_service_role', t);
    execute format('create policy %I on %I for all to service_role using (true) with check (true)', t || '_service_role', t);
  end loop;
end $$;

grant execute on function create_subscription_wallet(uuid), subscription_wallet_balance(uuid), top_up_subscription_wallet(uuid,uuid,integer,uuid,text,text,text), refund_subscription_payment(uuid,integer,text,uuid,text,text), issue_subscription_invoice(uuid), settle_subscription_wallet_system_error(uuid,integer,uuid,text,text,text) to service_role;
revoke execute on function create_subscription_wallet(uuid), subscription_wallet_balance(uuid), top_up_subscription_wallet(uuid,uuid,integer,uuid,text,text,text), refund_subscription_payment(uuid,integer,text,uuid,text,text), issue_subscription_invoice(uuid), settle_subscription_wallet_system_error(uuid,integer,uuid,text,text,text) from public, anon, authenticated;
grant execute on function create_subscription_wallet(uuid), subscription_wallet_balance(uuid), top_up_subscription_wallet(uuid,uuid,integer,uuid,text,text,text), refund_subscription_payment(uuid,integer,text,uuid,text,text), issue_subscription_invoice(uuid), settle_subscription_wallet_system_error(uuid,integer,uuid,text,text,text) to service_role;
