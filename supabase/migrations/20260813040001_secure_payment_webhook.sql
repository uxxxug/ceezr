-- =============================================================================
-- الغرض: حسم ويبهوك الدفع في RPC واحد ومنع تأكيد حالة نهائية أو تفعيل مزدوج.
-- الحالة: منفّذ فعلياً؛ event_id والمحاسبة والاشتراك في معاملة PostgreSQL واحدة.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: payment-adapters.ts ومسار ويبهوك الدفع فقط.
-- ملاحظات مستقبلية: لا تنقل حسم event_id إلى التطبيق؛ السباق لا يُعالج خارج القاعدة.
-- =============================================================================

create or replace function confirm_payment(
  p_transaction_id uuid,
  p_provider_transaction_id text,
  p_new_status text,
  p_provider text
) returns jsonb
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
  v_is_upgrade boolean;
  v_upgrade jsonb;
begin
  select * into v_tx from payment_transactions where id = p_transaction_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_FOUND');
  end if;

  if p_provider is null or p_provider = '' or p_provider <> v_tx.provider then
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_MISMATCH');
  end if;
  if p_provider_transaction_id is null or p_provider_transaction_id = '' then
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_TRANSACTION_ID_REQUIRED');
  end if;
  if v_tx.provider_transaction_id is not null
     and v_tx.provider_transaction_id <> p_provider_transaction_id then
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_TRANSACTION_MISMATCH');
  end if;
  if p_new_status not in ('active', 'pending', 'past_due', 'failed', 'canceled', 'expired') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYMENT_STATUS');
  end if;

  -- الانتقال النهائي لا يُعاد قبوله: التكرار يعالج فقط من RPC الويبهوك
  -- المعرف بالـevent_id، لا من استدعاء حالة عشوائي.
  if v_tx.status not in ('pending', 'past_due') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS_TRANSITION',
      'current_status', v_tx.status, 'requested_status', p_new_status);
  end if;

  if p_new_status = 'active' then
    if jsonb_typeof(v_tx.metadata) <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'TRANSACTION_METADATA_NOT_OBJECT',
        'metadata_type', jsonb_typeof(v_tx.metadata));
    end if;
    if v_tx.metadata->>'plan' is null then
      return jsonb_build_object('ok', false, 'error', 'TRANSACTION_METADATA_MISSING_PLAN');
    end if;
    if not exists (
      select 1 from unnest(enum_range(null::subscription_plan)) e
       where e::text = v_tx.metadata->>'plan'
    ) then
      return jsonb_build_object('ok', false, 'error', 'TRANSACTION_METADATA_UNKNOWN_PLAN',
        'plan', v_tx.metadata->>'plan');
    end if;
  end if;

  update payment_transactions
     set status = p_new_status,
         provider_transaction_id = p_provider_transaction_id,
         updated_at = now()
   where id = p_transaction_id;

  if p_new_status = 'active' then
    v_plan := (v_tx.metadata->>'plan')::subscription_plan;
    v_is_upgrade := coalesce((v_tx.metadata->>'upgrade')::boolean, false);

    if v_is_upgrade then
      v_upgrade := upgrade_plan(v_tx.payer_driver_id, v_plan, v_tx.id);
      if not (v_upgrade->>'ok')::boolean then
        raise exception 'UPGRADE_FAILED_AFTER_PAYMENT: %', v_upgrade->>'error'
          using errcode = 'raise_exception';
      end if;
      v_sub_id := (v_upgrade->>'subscription_id')::uuid;
      v_period_end := (v_upgrade->>'period_end')::timestamptz;
    else
      v_days := get_setting_number(v_tx.city_id, 'subscription_period_days')::int;
      v_period_end := now() + make_interval(days => v_days);
      perform activate_subscription(v_tx.payer_driver_id, v_plan, v_days);
      select id into v_sub_id from subscriptions
       where driver_id = v_tx.payer_driver_id and status = 'active'
       order by created_at desc limit 1;
    end if;

    insert into ledger_entries
      (city_id, transaction_id, driver_id, entry_type, amount_minor, currency)
    values
      (v_tx.city_id, v_tx.id, v_tx.payer_driver_id, 'credit', v_tx.amount_minor, v_tx.currency);

    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    select v_tx.city_id, d.user_id,
           case when v_is_upgrade then 'subscription.upgraded_via_payment'
                else 'subscription.activated_via_payment' end,
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

-- نحذف النسخة المبكرة إن كانت طُبقت محلياً أثناء التطوير؛ التوقيع الجديد يحمل مبلغ وعملة الخادم.
drop function if exists confirm_webhook_payment(uuid, text, text, text, text, text);

-- يدّعي الحدث ثم يؤكد الدفع في نفس المعاملة. فحص الحدث بعد قفل المعاملة مهم:
-- طلبان متزامنان قد لا يرى الثاني إدخال الأول قبل أن ينتظر القفل.
create or replace function confirm_webhook_payment(
  p_transaction_id uuid,
  p_provider_transaction_id text,
  p_new_status text,
  p_provider_amount integer,
  p_provider_currency text,
  p_provider text,
  p_event_id text,
  p_payload text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx payment_transactions%rowtype;
  v_event webhook_events%rowtype;
  v_result jsonb;
begin
  if coalesce(trim(p_event_id), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'WEBHOOK_EVENT_ID_REQUIRED');
  end if;

  select * into v_event from webhook_events
   where provider = p_provider and event_id = p_event_id
   for update;
  if found then
    return jsonb_build_object('ok', true, 'transaction_id', v_event.transaction_id,
      'duplicate', true);
  end if;

  select * into v_tx from payment_transactions where id = p_transaction_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_FOUND');
  end if;

  -- أعد الفحص بعد القفل حتى لا يحوّل السباق نفسه إلى انتقال حالة نهائية.
  select * into v_event from webhook_events
   where provider = p_provider and event_id = p_event_id
   for update;
  if found then
    return jsonb_build_object('ok', true, 'transaction_id', v_event.transaction_id,
      'duplicate', true);
  end if;

  if p_provider is null or p_provider = '' or p_provider <> v_tx.provider then
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_MISMATCH');
  end if;
  if p_provider_transaction_id is null or p_provider_transaction_id = '' then
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_TRANSACTION_ID_REQUIRED');
  end if;
  if p_provider_amount is null or p_provider_amount <> v_tx.amount_minor
     or upper(coalesce(p_provider_currency, '')) <> upper(v_tx.currency) then
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_AMOUNT_OR_CURRENCY_MISMATCH');
  end if;
  if v_tx.provider_transaction_id is not null
     and v_tx.provider_transaction_id <> p_provider_transaction_id then
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_TRANSACTION_MISMATCH');
  end if;
  if v_tx.status not in ('pending', 'past_due') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS_TRANSITION',
      'current_status', v_tx.status, 'requested_status', p_new_status);
  end if;

  v_result := confirm_payment(
    p_transaction_id, p_provider_transaction_id, p_new_status, p_provider
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    return v_result;
  end if;

  insert into webhook_events (city_id, transaction_id, event_id, provider, payload)
  values (v_tx.city_id, v_tx.id, p_event_id, p_provider, p_payload);
  return v_result || jsonb_build_object('duplicate', false);
end;
$$;

revoke all on function confirm_webhook_payment(uuid, text, text, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function confirm_webhook_payment(uuid, text, text, integer, text, text, text, text)
  to service_role;
