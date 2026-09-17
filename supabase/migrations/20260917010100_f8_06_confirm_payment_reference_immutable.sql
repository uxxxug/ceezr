-- migration-phase: expand
-- الغرض: إغلاقُ **تجاوُزِ حصانةِ مرجعِ المزوّدِ** في الحملِ الزائدِ الثلاثيِّ من
--   `confirm_payment`: `record_payment_provider_reference` يرفضُ مرجعاً ثانياً
--   مختلفاً، وكانَ الثلاثيُّ **يكتبُه فوقَ الأوّلِ بلا سؤالٍ** (البند `F8-06`).
-- الحالة: منفَّذٌ فعليّاً — البند `F8-06`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/financial/payment-adapters.ts` (المسارُ بلا
--   مزوّدٍ) · `confirm_webhook_payment` يستعملُ الرباعيَّ لا هذا.
-- يحرسُه: scripts/check-payment-lifecycle-matrix.ts ·
--   tests/integration/payment-lifecycle-matrix.test.ts
-- الحاكم: docs/MASTER_DIRECTIVE.md ٠٫٦ · ADR 0023
--
-- ## العطبُ: ضمانةٌ واحدةٌ يحرسُها كاتبانِ ويثقبُها ثالثٌ
--
-- `record_payment_provider_reference` يقولُها صريحاً: «مرجعٌ ثانٍ مختلفٌ يعني
-- عمليتَينِ عندَ المزوّدِ لمعاملةٍ واحدةٍ… استبدالُه يُخفي دفعةً حقيقيّةً عن كلِّ
-- مراجعةٍ لاحقةٍ» — فيردُّ `PROVIDER_TRANSACTION_MISMATCH`. والرباعيُّ من
-- `confirm_payment` يحرسُ الضمانةَ عينَها.
--
-- **والثلاثيُّ كانَ يكتبُ**: `provider_transaction_id = coalesce(p_..., provider_transaction_id)`.
-- فمَن نادى الثلاثيَّ على صفٍّ معلَّقٍ يحملُ مرجعَ `A` بمرجعِ `B` **استبدلَه**،
-- ولا خطأَ ولا سجلَّ. فالدفعةُ `A` القائمةُ عندَ المزوّدِ تختفي من كلِّ تسويةٍ:
-- `reconcilePendingPayments` يسألُ المزوّدَ عن `B` وحدَها. والحملُ الثلاثيُّ
-- **ليسَ ميّتاً**: `payment-adapters.ts` يُنادِيه في المسارِ بلا مزوّدٍ.
--
-- **ولم يكشِفْه اختبارٌ** لأنَّ الاختباراتَ تُنادي الثلاثيَّ بمرجعٍ واحدٍ دائماً،
-- **فالتناقُضُ لم يُبذَرْ قطُّ** — وحاجزٌ لا يبذُرُ النقيضَ لا يقيسُ شيئاً (ADR 0135).
--
-- ## والعلاجُ توحيدُ الضمانةِ لا حذفُ الحملِ
--
-- **لا يُحذَفُ الحملُ الثلاثيُّ**: حذفُه يكسِرُ مسارَ إنتاجٍ قائماً، وذاكَ نقلٌ
-- للمشكلةِ لا حلٌّ لها. بل يُحمَلُ عليهِ **نفسُ الشرطِ حرفاً**: مرجعٌ محفوظٌ
-- مخالفٌ ⇒ `PROVIDER_TRANSACTION_MISMATCH` قبلَ أيِّ كتابةٍ. والمطابقُ يمرُّ،
-- و`null` يمرُّ (فيبقى `coalesce` على حالِه للمسارِ الذي لا يحملُ مرجعاً).
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تُوحِّدُ الحملَينِ في واحدٍ**: توقيعانِ يبقيانِ، والضمانةُ صارت واحدةً.
--      وإسقاطُ أحدِهما قرارُ سطحٍ لا شغلُ بندِ اختبارٍ.
--   ــ **ولا تُغيِّرُ جوابَ التكرارِ**: الثلاثيُّ يظلُّ يردُّ `already_confirmed`
--      على الحالِ النهائيِّ، والرباعيُّ يظلُّ يردُّ `INVALID_STATUS_TRANSITION`.
--      **الاختلافُ في الرسالةِ مُعلَنٌ**، والمقيسُ أنَّ الحالَ لا يُنقَضُ في كليهما.
--   ــ **ولا تلمسُ جدولاً ولا قيداً ولا صلاحيّةً**، ولا تُصلِحُ صفّاً ماضياً
--      استُبدِلَ مرجعُه: **لا يُدَّعى أنَّ الماضيَ سلِمَ**.

create or replace function confirm_payment(
  p_transaction_id uuid,
  p_provider_transaction_id text,
  p_new_status text
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

  -- لا تؤكَّد معاملة منتهية: active/failed/canceled/expired نهائية.
  if v_tx.status not in ('pending', 'past_due') then
    return jsonb_build_object('ok', true, 'transaction_id', v_tx.id,
      'status', v_tx.status, 'already_confirmed', true);
  end if;

  -- الشرطُ المُضافُ في `F8-06`: مرجعُ مزوّدٍ محفوظٌ **لا يُستبدَلُ**، كما في
  -- `record_payment_provider_reference` حرفاً. والمطابقُ وnull يمرّان.
  if p_provider_transaction_id is not null
     and v_tx.provider_transaction_id is not null
     and v_tx.provider_transaction_id <> p_provider_transaction_id then
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_TRANSACTION_MISMATCH',
      'stored_provider_transaction_id', v_tx.provider_transaction_id);
  end if;

  -- التحقّق قبل أي كتابة: خطّةٌ مجهولة تُرفض ولا تُفترض.
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
         provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id),
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

comment on function confirm_payment(uuid, text, text) is
  'تأكيدُ دفعةٍ بلا مزوّدٍ صريحٍ — ومرجعُ المزوّدِ المحفوظُ لا يُستبدَلُ (F8-06).';

revoke all on function confirm_payment(uuid, text, text) from public;
revoke all on function confirm_payment(uuid, text, text) from anon;
revoke all on function confirm_payment(uuid, text, text) from authenticated;
grant execute on function confirm_payment(uuid, text, text) to service_role;
