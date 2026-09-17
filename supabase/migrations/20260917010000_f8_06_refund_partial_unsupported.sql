-- migration-phase: expand
-- الغرض: إغلاقُ عطبِ **الاستردادِ الجزئيِّ** الذي كشفَته مصفوفةُ دورةِ حياةِ
--   الدفعِ (البند `F8-06`): مبلغٌ أقلُّ من المدفوعِ كانَ يُقبَلُ ثمَّ يُوسَمُ الصفُّ
--   `refunded` كاملاً، فيُغلَقُ الباقي بلا رجعةٍ.
-- الحالة: منفَّذٌ فعليّاً — البند `F8-06`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `refund_subscription_payment(uuid, integer, text, uuid, text, text)`
-- يحرسُه: scripts/check-payment-lifecycle-matrix.ts ·
--   tests/integration/payment-lifecycle-matrix.test.ts
-- الحاكم: docs/MASTER_DIRECTIVE.md ٠٫٦ (فشلٌ مغلقٌ) · ADR 0023
--
-- ## العطبُ كما قِيسَ لا كما يُرجى
--
-- `refund_subscription_payment` كانَ يقبلُ `p_amount_minor` أيَّ قيمةٍ **موجبةٍ لا
-- تتجاوزُ** المدفوعَ، ثمَّ يُنفِّذُ ثلاثةَ أفعالٍ بلا تمييزٍ بينَ الكاملِ والجزئيِّ:
--
--   ١) يكتبُ صفّاً في `subscription_refunds` — وفيها `unique(payment_transaction_id)`،
--      فصفٌّ واحدٌ لكلِّ دفعةٍ **إلى الأبدِ**.
--   ٢) يضعُ `payment_transactions.status = 'refunded'` — أي «مُستَرَدَّةٌ» مطلقاً.
--   ٣) يُقيِّدُ المحفظةَ بالمبلغِ الجزئيِّ.
--
-- فمَن استردَّ عشرةً من مئةٍ صارَ الصفُّ **مُستَرَدّاً كاملاً** في كلِّ قراءةٍ،
-- **والتسعونَ الباقيةُ لا تُستَرَدُّ أبداً**: النداءُ الثاني يُصادِفُ الصفَّ
-- الموجودَ فيردُّ `already_refunded: true` — **جواباً ناجحاً** لطلبٍ لم يُنفَّذْ.
-- ولا خطأَ ولا سجلَّ: مالٌ يبقى عندَ المنصّةِ وسِجِلٌّ يقولُ إنَّهُ رُدَّ.
--
-- **ولم يكشِفْه اختبارٌ** لأنَّ الحالةَ القائمةَ تستردُّ المبلغَ كاملاً
-- (`tests/integration/financial-wallet.test.ts`)، والجزئيُّ **لم يُقَسْ قطُّ**.
--
-- ## والعلاجُ رفضٌ صريحٌ لا حساباً جديداً
--
-- الاستردادُ الجزئيُّ **يقتضي محاسبةً** لا يملكُها المخطَّطُ اليومَ: عمودَ
-- مُستَرَدٍّ تراكميٍّ، وقيداً يمنعُ التجاوزَ، وحالاً وسطى (`partially_refunded`)،
-- وقراراً في الفاتورةِ الضريبيّةِ. وبناءُ ذلكَ كلِّه **خارجَ نطاقِ `F8-06`**،
-- **واختلاقُ نصفِه أسوأُ من رفضِه**. فيُرفَضُ صريحاً بـ`REFUND_PARTIAL_UNSUPPORTED`
-- (فشلٌ مغلقٌ · القاعدة ٠٫٦)، **ويبقى الجزئيُّ دَيناً مُعلَناً** (`ح-5`).
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ
--
--   ــ **لا تُغيِّرُ جدولاً ولا قيداً ولا فهرساً ولا زناداً**: لا حالَ جديدةً في
--      `payment_transactions_status_check`، ولا عمودَ استردادٍ تراكميّاً.
--   ــ **ولا تُصلِحُ صفّاً ماضياً**: مَن استردَّ جزئيّاً قبلَ اليومِ يبقى صفُّه كما
--      هوَ، **ولا يُدَّعى أنَّ الماضيَ سلِمَ** — ومعالجتُه قرارُ مالٍ لا شغلُ هجرةٍ.
--   ــ **ولا تفتحُ صلاحيّةً**: الصلاحيّاتُ كما هيَ، والدالَّةُ مقفَلةٌ عن
--      `anon`/`authenticated` كما كانت.
--   ــ **ولا تُعادُ كتابةُ الهجرةِ الأولى**: التصحيحُ بالإضافةِ (`ح-8`).

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
  -- السطرُ الوحيدُ المُضافُ: الجزئيُّ يُرفَضُ صريحاً ولا يُوسَمُ الصفُّ `refunded`
  -- بمبلغٍ ناقصٍ. والرفضُ يُسمّي المبلغَينِ كي يُقرأَ السببُ لا يُخمَّنَ.
  if p_amount_minor <> v_payment.amount_minor then
    return jsonb_build_object('ok',false,'error','REFUND_PARTIAL_UNSUPPORTED',
      'paid_minor',v_payment.amount_minor,'requested_minor',p_amount_minor);
  end if;
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

comment on function refund_subscription_payment(uuid, integer, text, uuid, text, text) is
  'استردادُ دفعةِ اشتراكٍ **كاملةً وحدَها**: الجزئيُّ مرفوضٌ بـREFUND_PARTIAL_UNSUPPORTED حتّى تُبنى محاسبتُه (F8-06).';

revoke all on function refund_subscription_payment(uuid, integer, text, uuid, text, text) from public;
revoke all on function refund_subscription_payment(uuid, integer, text, uuid, text, text) from anon;
revoke all on function refund_subscription_payment(uuid, integer, text, uuid, text, text) from authenticated;
grant execute on function refund_subscription_payment(uuid, integer, text, uuid, text, text) to service_role;
