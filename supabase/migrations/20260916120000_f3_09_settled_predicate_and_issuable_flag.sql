-- migration-phase: expand
-- الغرض: محدِّدُ «دفعةٍ مُسدَّدةٍ» **دالّةً واحدةً** يقرؤها الكاتبُ والقارئُ،
--   ورايةُ «أيمكنُ إصدارُ الفاتورةِ الآنَ» تُنطَقُ من القاعدةِ لا من شاشةٍ
--   (البند `F3-09` · `SD-08` · الدفعةُ الثانيةُ).
-- الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `issue_subscription_invoice(uuid)` ·
--   `driver_subscription_payment_status(bigint, uuid)`
-- يُتوقع أن يستخدمه لاحقاً: كلُّ قارئٍ يسألُ «أهيَ مُسدَّدةٌ» — ولا يُنسَخُ
--   المحدِّدُ نصّاً في مِلفٍّ ثانٍ.
-- يحرسُه: scripts/check-tax-invoice-contract.ts
-- الحاكم: docs/adr/0127-simplified-tax-invoice.md · docs/MASTER_DIRECTIVE.md ٠٫٦
--
-- ## لِمَ هذه الهجرةُ الثانيةُ ولم تُعدَّل الأولى
--
-- لأنَّ الهجرةَ الأولى **دُفِعَت ودُمِجَت وطُبِّقَت على محرِّكٍ في CI**، والهجراتُ
-- تُضافُ ولا تُنقَّحُ بأثرٍ رجعيٍّ: مِلفٌّ طُبِّقَ ثمَّ تغيَّرَ نصُّه يجعلُ قاعدتَينِ
-- بتاريخٍ واحدٍ وحالَينِ مختلفَينِ. فالتصحيحُ **بالإضافةِ** (`ح-8`).
--
-- ## وما العطبُ الذي تُغلِقُه
--
-- الدفعةُ الثانيةُ (سطحُ التطبيقِ المُصغَّرِ) تحتاجُ أن تعرفَ **هل تُعرَضُ زرُّ
-- «أصدِرْ فاتورتي»**. وأقصرُ طريقٍ كانَ أن تقيسَ الشاشةُ `status === 'active'` —
-- وهذا **نسخُ محدِّدِ عملٍ في العميلِ**: يومَ يُضافُ حالُ تسويةٍ جديدٌ في القاعدةِ
-- يبقى العميلُ على قائمتِه، فيُخفي زرّاً يحقُّ لصاحبِه. والأسوأُ أنَّ الشاشةَ
-- كُتِبَت أوّلَ الأمرِ تقيسُ `'paid'` — **وهوَ حالٌ لا وجودَ له في القيدِ ألبتّةَ**
-- (`payment_transactions_status_check` يعرفُ `active` و`refunded` وسواهُما)، فكانَ
-- الزرُّ **لا يظهرُ أبداً** ولا اختبارُ وحدةٍ يكشفُه لأنَّه يبذُرُ ما تكتبُه يدُه.
-- فالراية تُنطَقُ من القاعدةِ، والمحدِّدُ دالّةٌ تُقرأُ في الموضعَينِ.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تُغيِّرُ جدولاً ولا قيداً**: لا عمودَ ولا فهرسَ ولا زنادَ جديدٌ.
--   ــ **لا تُوسِّعُ قائمةَ حالاتِ السدادِ**: `active` و`refunded` كما كانتا حرفاً.
--   ــ **لا تفتحُ صلاحيّةً**: الدالّةُ الجديدةُ مُقفَلةٌ عن `anon` و`authenticated`.
--   ــ **لا تلمسُ الفواتيرَ الصادرةَ**: لا تحديثَ لصفٍّ ولا إعادةَ حسابٍ.

-- ── ١) المحدِّدُ الواحدُ ────────────────────────────────────────────────────────
--
-- `immutable` لأنَّه دالّةُ نصٍّ محضةٍ لا تقرأُ جدولاً — فيصحُّ استعمالُها في
-- فهرسٍ أو قيدٍ لاحقاً بلا إعادةِ تصنيفٍ.
create or replace function subscription_payment_is_settled(p_status text)
returns boolean
language sql
immutable
as $fn$
  select p_status in ('active', 'refunded');
$fn$;

comment on function subscription_payment_is_settled(text) is
  'أهيَ دفعةٌ مُسدَّدةٌ يصحُّ أن يُفَوتَرَ عليها: المحدِّدُ الواحدُ للكاتبِ والقارئِ (F3-09).';

revoke all on function subscription_payment_is_settled(text) from public;
revoke all on function subscription_payment_is_settled(text) from anon;
revoke all on function subscription_payment_is_settled(text) from authenticated;
grant execute on function subscription_payment_is_settled(text) to service_role;

-- ── ٢) الكاتبُ يقرأُ المحدِّدَ ولا يُعيدُ كتابتَه ──────────────────────────────
--
-- الجسمُ كما هوَ حرفاً في الهجرةِ الأولى، **وسطرٌ واحدٌ تغيَّرَ**: قائمةُ الحالاتِ
-- صارَت نداءَ الدالّةِ. ولا فعلَ آخرَ ههنا.
create or replace function issue_subscription_invoice(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_payment payment_transactions%rowtype;
  v_invoice subscription_invoices%rowtype;
  v_year integer;
  v_sequence integer;
  v_plan subscription_plan;
  v_seller_name text;
  v_seller_vat text;
  v_rate_bps integer;
  v_vat_minor integer;
  v_excl_minor integer;
  v_issued_at timestamptz := now();
begin
  select * into v_payment from payment_transactions where id = p_payment_id for update;
  if not found
     or v_payment.purpose <> 'driver_subscription'
     or not subscription_payment_is_settled(v_payment.status) then
    return jsonb_build_object('ok', false, 'error', 'CONFIRMED_SUBSCRIPTION_PAYMENT_REQUIRED');
  end if;

  -- الفاتورةُ الموجودةُ تُعادُ كما هيَ: الإصدارُ عمليّةٌ **مُتماثلةٌ**، ونداءٌ
  -- ثانٍ من شاشةٍ أُعيدَ تحميلُها لا يُصدِرُ رقماً ثانياً لتوريدٍ واحدٍ.
  select * into v_invoice
    from subscription_invoices where payment_transaction_id = p_payment_id for update;
  if found then
    return jsonb_build_object(
      'ok', true, 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
      'already_issued', true, 'invoice', subscription_tax_invoice_payload(v_invoice)
    );
  end if;

  v_plan := (v_payment.metadata->>'plan')::subscription_plan;
  if v_plan is null then
    return jsonb_build_object('ok', false, 'error', 'PAYMENT_PLAN_MISSING');
  end if;

  v_seller_name := btrim(coalesce(get_setting(v_payment.city_id, 'tax_seller_name') #>> '{}', ''));
  v_seller_vat := btrim(coalesce(get_setting(v_payment.city_id, 'tax_seller_vat_number') #>> '{}', ''));
  if v_seller_name = '' or v_seller_vat !~ '^[0-9]{15}$' then
    -- **فشلٌ مغلقٌ**: لا فاتورةَ بهويّةٍ ناقصةٍ ولا برقمٍ لا يُشبِهُ رقماً ضريبيّاً.
    return jsonb_build_object('ok', false, 'error', 'TAX_IDENTITY_NOT_CONFIGURED');
  end if;

  -- **قارئُ الإعدادِ واحدٌ** (`get_setting_number`) ولا يُستنسَخُ ههنا؛ لكنّه يرفعُ
  -- استثناءَ `MISSING_SETTING` عندَ الغيابِ، واستثناءٌ يخرُجُ من دالّةٍ يصيرُ عندَ
  -- الطبقةِ **عطبَ مخزنٍ** (`503` بلا اسمٍ) لا سبباً مفهوماً. فيُلتَقَطُ ههنا
  -- ويُترجَمُ رفضاً مُسمّىً — والغيابُ يبقى غياباً ولا يُستبدَلُ بنسبةٍ مُختَرَعةٍ.
  begin
    v_rate_bps := get_setting_number(v_payment.city_id, 'vat_rate_bps')::integer;
  exception
    when raise_exception or invalid_text_representation or numeric_value_out_of_range then
      v_rate_bps := null;
  end;
  if v_rate_bps is null or v_rate_bps < 0 or v_rate_bps > 10000 then
    return jsonb_build_object('ok', false, 'error', 'VAT_RATE_NOT_CONFIGURED');
  end if;

  -- **الاستخراجُ من الشاملِ**: ضريبةٌ = إجماليٌّ × نسبةٌ ÷ (١ + نسبةٌ)، بحسابٍ
  -- عشريٍّ ثمَّ تقريبٍ إلى وحدةٍ صغرى، والوعاءُ هوَ الفرقُ — فالجمعُ يُغلَقُ دائماً.
  v_vat_minor := round(v_payment.amount_minor::numeric * v_rate_bps / (10000 + v_rate_bps))::integer;
  v_excl_minor := v_payment.amount_minor - v_vat_minor;

  v_year := extract(year from v_issued_at)::integer;
  perform pg_advisory_xact_lock(hashtext(v_payment.city_id::text || ':' || v_year::text));
  select coalesce(max(invoice_sequence), 0) + 1 into v_sequence
    from subscription_invoices
   where city_id = v_payment.city_id and invoice_year = v_year;

  insert into subscription_invoices (
    city_id, payment_transaction_id, driver_id, invoice_year, invoice_sequence,
    invoice_number, amount_minor, currency, plan, issued_at,
    document_type, seller_name, seller_vat_number, vat_rate_bps,
    total_excl_vat_minor, vat_amount_minor, qr_tlv_base64
  ) values (
    v_payment.city_id, p_payment_id, v_payment.payer_driver_id, v_year, v_sequence,
    (select code from cities where id = v_payment.city_id)
      || '-' || v_year::text || '-' || lpad(v_sequence::text, 6, '0'),
    v_payment.amount_minor, v_payment.currency, v_plan, v_issued_at,
    'SIMPLIFIED_TAX_INVOICE', v_seller_name, v_seller_vat, v_rate_bps,
    v_excl_minor, v_vat_minor,
    zatca_simplified_invoice_qr(
      v_seller_name, v_seller_vat, v_issued_at, v_payment.amount_minor, v_vat_minor
    )
  ) returning * into v_invoice;

  insert into audit_log (city_id, action, entity_type, entity_id, payload)
  values (
    v_payment.city_id, 'subscription_invoice.issued', 'subscription_invoice', v_invoice.id,
    jsonb_build_object(
      'payment_id', p_payment_id, 'invoice_number', v_invoice.invoice_number,
      'amount_minor', v_invoice.amount_minor, 'plan', v_invoice.plan,
      'vat_amount_minor', v_invoice.vat_amount_minor, 'vat_rate_bps', v_invoice.vat_rate_bps
    )
  );

  return jsonb_build_object(
    'ok', true, 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
    'already_issued', false, 'invoice', subscription_tax_invoice_payload(v_invoice)
  );
end;
$fn$;

comment on function issue_subscription_invoice(uuid) is
  'الكاتبُ الوحيدُ لفاتورةِ اشتراكٍ — ويقرأُ محدِّدَ السدادِ الواحدَ (F3-09 · SD-08).';

-- ── ٣) القارئُ يُنطِقُ رايةَ الإمكانِ ─────────────────────────────────────────
create or replace function driver_subscription_payment_status(
  p_telegram_id bigint,
  p_transaction_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_txn payment_transactions%rowtype;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  select * into v_txn
    from payment_transactions
   where id = p_transaction_id
     and payer_driver_id = v_driver.id
     and purpose = 'driver_subscription';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'server_time', now(),
    'transaction_id', v_txn.id,
    'status', v_txn.status,
    'amount_minor', v_txn.amount_minor,
    'currency', v_txn.currency,
    'created_at', v_txn.created_at,
    'updated_at', v_txn.updated_at,
    'checkout_url', v_txn.metadata #>> '{checkout_url}',
    'invoice_issued', exists (
      select 1 from subscription_invoices where payment_transaction_id = v_txn.id
    ),
    -- **حكمُ «أيمكنُ الإصدارُ الآنَ» يُنطَقُ ههنا** لا في شاشةٍ: الشاشةُ لو
    -- قاسَت `status` بنفسِها لَنسخَت محدِّدَ «مُسدَّدةٍ» ثانيةً، ولَتخلَّفَت عنه
    -- يومَ يزيدُ حالٌ. والمحدِّدُ دالّةٌ واحدةٌ يقرؤها الكاتبُ وهذا القارئُ.
    'invoice_issuable', subscription_payment_is_settled(v_txn.status) and not exists (
      select 1 from subscription_invoices where payment_transaction_id = v_txn.id
    )
  );
end;
$fn$;

comment on function driver_subscription_payment_status(bigint, uuid) is
  'حالُ معاملةِ اشتراكٍ بعينِها لصاحبِها وحدَه، ورايةُ صدورِ الفاتورةِ وإمكانِ إصدارِها (F3-09 · SD-08).';

revoke all on function driver_subscription_payment_status(bigint, uuid) from public;
revoke all on function driver_subscription_payment_status(bigint, uuid) from anon;
revoke all on function driver_subscription_payment_status(bigint, uuid) from authenticated;
grant execute on function driver_subscription_payment_status(bigint, uuid) to service_role;
