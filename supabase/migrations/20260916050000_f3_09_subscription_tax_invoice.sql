-- migration-phase: expand
-- =============================================================================
-- `F3-09` — **الفاتورةُ الضريبيّةُ المبسَّطةُ** لدفعةِ اشتراكِ السائقِ، وحالةُ
--   العمليةِ لمعاملةٍ بعينِها.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F3-09` (`SD-08`).
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/driver/subscription-invoice-store.ts`
--   عبرَ نداءِ `issue_subscription_tax_invoice` و`driver_subscription_tax_invoice`
--   و`driver_subscription_payment_status`.
-- يحرسُه: tests/integration/subscription-tax-invoice.test.ts ·
--   scripts/check-tax-invoice-contract.ts
-- الحاكم: docs/adr/0127-simplified-tax-invoice.md
--
-- ## ١) تعارضٌ وُجِدَ فحُلَّ: **سجلُّ الفواتيرِ واحدٌ لا اثنانِ**
--
-- كانَ في المستودعِ سجلُّ فواتيرِ اشتراكٍ قائمٌ منذُ
-- `20260813010000_subscription_financial_wallets.sql`: جدولُ `subscription_invoices`
-- بترقيمٍ لكلِّ مدينةٍ وسنةٍ (`CODE-YYYY-NNNNNN`)، ودالّةُ `issue_subscription_invoice`
-- كاتبةً وحيدةً له، ومَنفذٌ في `packages/infrastructure/financial/subscription-wallet-adapters.ts`،
-- وتصنيفُ استبقاءٍ ماليٌّ ستَّ سنينَ في `packages/shared/config/retention-policy.ts`،
-- وعدَّادٌ يقرأُه سطحُ المحوِ (`SD-12`).
--
-- وكانَ يخلو من الضريبةِ: لا نسبةً، ولا وعاءً، ولا هويّةَ بائعٍ، ولا رمزَ استجابةٍ.
-- فأوّلُ ما كُتِبَ في هذا البندِ كانَ **جدولاً ثانياً** (`tax_invoices`) بترقيمٍ
-- ثانٍ لواقعةٍ واحدةٍ — وذاكَ نقضٌ صريحٌ للقاعدةِ ٠٫٦، وأثرُه ليسَ نظريّاً:
-- فاتورتانِ برقمَينِ مختلفَينِ لتوريدٍ واحدٍ، والمحاسبُ يقرأُ إحداهما والسائقُ
-- الأخرى. **فحُذِفَ الجدولُ الثاني قبلَ أن يُدفَعَ**، وامتدَّ السجلُّ القائمُ
-- بأعمدةِ الضريبةِ. والحاجزُ الذي كشفَ التعارضَ هوَ اختبارُ سياسةِ الاستبقاءِ:
-- جدولٌ جديدٌ بلا تصنيفٍ يُسقِطُ `tests/unit/retention-policy.test.ts` — فقُرِئَ
-- إسقاطُه إشارةَ تكرارٍ لا عقبةَ تصنيفٍ.
--
-- ## ٢) ولِمَ أعمدةٌ تقبلُ العدمَ في جدولٍ قائمٍ
--
-- الأعمدةُ الضريبيّةُ تُضافُ **قابلةً للعدمِ** لا لأنَّها اختياريّةٌ، بل لأنَّ
-- صفّاً قد يكونُ سبقَ الهجرةَ، و**اختراعُ ضريبةٍ لفاتورةٍ ماضيةٍ تلفيقٌ**. فقيدُ
-- «الكلُّ أو لا شيءَ» يمنعُ صفّاً نصفَ ضريبيٍّ، و`document_type` يقولُ صريحاً أيَّ
-- وثيقةٍ هوَ، وقراءةُ السائقِ لصفٍّ بلا حقولٍ ضريبيّةٍ **رفضٌ مُسمّىً**
-- (`INVOICE_WITHOUT_TAX_FIELDS`) لا فاتورةٌ بخاناتٍ فارغةٍ.
--
-- ## ٣) ولِمَ السعرُ **شاملٌ** للضريبةِ فتُستخرَجُ منه ولا تُضافُ إليه
--
-- `subscription_price_<plan>` هوَ ما يُعرَضُ للسائقِ وما يُطالَبُ به فعلاً، وسعرُ
-- المستهلكِ في المملكةِ يُعرَضُ شاملاً للضريبةِ. فلو أُضيفَت الضريبةُ فوقَه
-- لَدفعَ السائقُ أكثرَ مما رأى في `F3-06`، **ولَاختلفَ ما في الفاتورةِ عمّا في
-- المعاملةِ** — وذاكَ أسوأُ من خطأٍ حسابيٍّ: هوَ وثيقةٌ تُكذِّبُ سجلّاً.
-- فالمخزونُ في `payment_transactions.amount_minor` هوَ **الإجماليُّ شاملَ
-- الضريبةِ**، والضريبةُ تُستخرَجُ منه، والوعاءُ هوَ الفرقُ.
--
-- ## ٤) ولِمَ هويّةُ البائعِ الضريبيّةُ **إعدادٌ غائبٌ** لا قيمةٌ مبذورةٌ
--
-- لا نملكُ رقمَ تسجيلٍ ضريبيٍّ اليومَ. وبذرُ رقمٍ صوريٍّ يجعلُ الفاتورةَ تُصدَرُ
-- **ببياناتٍ كاذبةٍ** ويُخفي النقصَ عن المشغِّلِ إلى أن يراهُ مُدقِّقٌ. فالغيابُ
-- **يُفشِلُ الإصدارَ فشلاً مغلقاً** (`TAX_IDENTITY_NOT_CONFIGURED`) — لا فاتورةَ
-- بخانةٍ فارغةٍ ولا فاتورةَ برقمٍ مُختلَقٍ. **وهذا يُغيِّرُ عقدَ الكاتبِ القائمِ**:
-- `issue_subscription_invoice` كانَت تُصدِرُ دائماً، وصارَت تُغلِقُ عندَ غيابِ
-- الهويّةِ — وذاكَ مقصودٌ: وثيقةٌ بلا هويّةِ بائعٍ ليسَت فاتورةً، وإصدارُها
-- الصامتُ يُنتِجُ رقماً لا يُمكِنُ ترقيتُه بعدَ ذلكَ (الصفُّ ثابتٌ لا يُعدَّلُ).
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تدَّعي امتثالاً للمرحلةِ الثانيةِ من الفوترةِ الإلكترونيّةِ**: لا ربطَ
--      بمنصّةِ «فاتورة»، ولا إبلاغَ خلالَ أربعٍ وعشرينَ ساعةً، ولا ختمَ تشفيريّاً
--      (`CSID`)، ولا `UBL 2.1`. المبنيُّ ههنا **وثيقةٌ بحقولِ الطورِ الأوّلِ
--      ورمزِ استجابةٍ بترميزِ `TLV`** — وذاكَ يُقالُ بحدِّه.
--   ــ **لا تُحصِّلُ مالاً ولا تُغيِّرُ حالَ معاملةٍ**: التحصيلُ عندَ المزوّدِ،
--      والحالُ من الويبهوكِ.
--   ــ **لا تُصدِرُ فاتورةً لمعاملةٍ غيرِ ناجحةٍ**: `pending` ليسَ توريداً.
--   ــ **لا تُخزِّنُ بيانةَ بطاقةٍ**: لا عمودَ ولا حقلَ — ويحرسُه حاجزٌ ساكنٌ.
--   ــ **لا تُصلِحُ صفّاً ماضياً ولا تُعيدُ ترقيمَه**: الماضي يُقرأُ كما هوَ.
--   ــ **لا إشعارَ ولا بريدَ**: إصدارُ الفاتورةِ ليسَ إبلاغاً.
--   ــ **لا فهرسَ جديدٌ**: كلُّ قراءةٍ ههنا تدخُلُ من `payment_transaction_id` وله
--      قيدُ تفرُّدٍ قائمٌ فهوَ فهرسٌ. وفهرسٌ بلا مُستدعٍ مُصرَّحٍ وخطّةٍ مقيسةٍ
--      كلفةُ كتابةٍ دائمةٌ ودعوى سرعةٍ لم تُقَسْ.
-- =============================================================================

-- ── ١) نسبةُ الضريبةِ إعدادٌ لا رقمٌ في شِفرةٍ (القاعدة ٠.٣) ────────────────────
--
-- بنقاطِ الأساسِ (`bps`) لا بكسرٍ عشريٍّ: عددٌ صحيحٌ لا يفقدُ شيئاً في الضربِ،
-- و١٥٪ = ١٥٠٠. و`is_provisional = false` لأنَّ هذه **نسبةٌ منشورةٌ نظاماً** لا
-- قيمةٌ اخترناها بلا بياناتٍ — وذاكَ معنى الرايةِ في هذا المستودعِ.
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, 'vat_rate_bps', to_jsonb(1500::integer), 'number',
       'نسبةُ ضريبةِ القيمةِ المضافةِ بنقاطِ الأساسِ — ١٥٠٠ تعني ١٥٪. تُستخرَجُ من السعرِ الشاملِ لا تُضافُ إليه',
       false
  from cities c
on conflict (city_id, key) do nothing;

-- **ولا يُبذَرُ اسمُ بائعٍ ولا رقمُه الضريبيُّ**: غيابُهما فشلٌ مغلقٌ عن قصدٍ.
-- المفتاحانِ المقروءانِ: `tax_seller_name` و`tax_seller_vat_number`.

-- ── ٢) امتدادُ سجلِّ الفواتيرِ القائمِ — لا جدولَ ثانيَ ────────────────────────
alter table subscription_invoices
  add column if not exists document_type        text,
  add column if not exists seller_name          text,
  add column if not exists seller_vat_number    text,
  add column if not exists vat_rate_bps         integer,
  add column if not exists total_excl_vat_minor integer,
  add column if not exists vat_amount_minor     integer,
  add column if not exists qr_tlv_base64        text;

-- **ولا عمودَ لِـ«الإجماليِّ شاملَ الضريبةِ»**: هوَ `amount_minor` القائمُ نفسُه،
-- وعمودٌ ثانٍ بنفسِ المعنى مصدرُ حقيقةٍ مُكرَّرٌ ينحرِفُ عن أخيهِ بعدَ تعديلٍ.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscription_invoices_tax_all_or_none'
  ) then
    alter table subscription_invoices add constraint subscription_invoices_tax_all_or_none
      check (
        (document_type is null and seller_name is null and seller_vat_number is null
          and vat_rate_bps is null and total_excl_vat_minor is null
          and vat_amount_minor is null and qr_tlv_base64 is null)
        or (
          document_type = 'SIMPLIFIED_TAX_INVOICE'
          and length(btrim(seller_name)) > 0
          and seller_vat_number ~ '^[0-9]{15}$'
          and vat_rate_bps between 0 and 10000
          and total_excl_vat_minor >= 0
          and vat_amount_minor >= 0
          and length(qr_tlv_base64) > 0
          -- **الجمعُ مُغلَقٌ في المخطَّطِ**: فاتورةٌ لا تجمعُ لا تُكتَبُ ولو أخطأَ
          -- حاسبٌ فوقَها.
          and total_excl_vat_minor + vat_amount_minor = amount_minor
        )
      );
  end if;
end;
$$;

-- ── ٣) الثباتُ — وثيقةٌ تُصحَّحُ بإشعارٍ دائنٍ لا بكتابةٍ فوقَها ────────────────
--
-- والزنادُ في القاعدةِ لا في طبقةٍ: امتناعُ طبقةٍ أدبٌ، ومنعُ القاعدةِ حكمٌ.
create or replace function subscription_invoices_are_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'TAX_INVOICE_IS_IMMUTABLE:%', coalesce(old.invoice_number, '?');
end;
$$;

comment on function subscription_invoices_are_immutable() is
  'زنادُ ثباتِ الفاتورةِ: لا تعديلَ ولا حذفَ لصفٍّ صدرَ (F3-09 · SD-08).';

drop trigger if exists subscription_invoices_no_update on subscription_invoices;
create trigger subscription_invoices_no_update before update on subscription_invoices
  for each row execute function subscription_invoices_are_immutable();

drop trigger if exists subscription_invoices_no_delete on subscription_invoices;
create trigger subscription_invoices_no_delete before delete on subscription_invoices
  for each row execute function subscription_invoices_are_immutable();

-- ── ٤) شكلُ الفاتورةِ المنشورُ — موضعٌ واحدٌ يُبنى منه الجوابُ ─────────────────
--
-- ثلاثُ دوالَّ تُعيدُ فاتورةً (إصدارٌ · قراءةٌ · وقراءةٌ بعدَ إصدارٍ)، ولو بنى
-- كلٌّ منها الحمولةَ بيدِه لَافترقَت الحقولُ بعدَ تعديلٍ. فالبناءُ ههنا وحدَه.
--
-- **والعنوانُ حقلٌ لا نصٌّ في شاشةٍ**: `document_type` يقولُ إنَّها فاتورةٌ
-- ضريبيّةٌ مبسَّطةٌ، والشاشةُ تترجمُ مفتاحاً ولا تُقرِّرُ نوعَ وثيقةٍ.
create or replace function subscription_tax_invoice_payload(p_row subscription_invoices)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'invoice_number', p_row.invoice_number,
    'document_type', p_row.document_type,
    'issued_at', p_row.issued_at,
    'transaction_id', p_row.payment_transaction_id,
    'seller_name', p_row.seller_name,
    'seller_vat_number', p_row.seller_vat_number,
    'vat_rate_bps', p_row.vat_rate_bps,
    'currency', p_row.currency,
    'total_excl_vat_minor', p_row.total_excl_vat_minor,
    'vat_amount_minor', p_row.vat_amount_minor,
    'total_incl_vat_minor', p_row.amount_minor,
    'qr_tlv_base64', p_row.qr_tlv_base64
  );
$$;

comment on function subscription_tax_invoice_payload(subscription_invoices) is
  'شكلُ الفاتورةِ المنشورُ — موضعٌ واحدٌ لثلاثِ دوالَّ (F3-09 · SD-08).';

-- ── ٥) ترميزُ `TLV` لرمزِ الاستجابةِ — حقلٌ واحدٌ في دالّةٍ واحدةٍ ──────────────
--
-- الشكلُ: بايتُ وسمٍ، ثمَّ بايتُ طولٍ بالبايتاتِ (لا بالمحارفِ — والعربيّةُ
-- محرفُها بايتانِ فالفرقُ ليسَ نظريّاً)، ثمَّ القيمةُ بترميزِ `UTF-8`.
create or replace function zatca_tlv_field(p_tag integer, p_value text)
returns bytea
language plpgsql
immutable
as $$
declare
  v_bytes bytea := convert_to(coalesce(p_value, ''), 'UTF8');
begin
  if p_tag < 1 or p_tag > 255 then
    raise exception 'TLV_TAG_OUT_OF_RANGE:%', p_tag;
  end if;
  if octet_length(v_bytes) > 255 then
    raise exception 'TLV_VALUE_TOO_LONG:%', p_tag;
  end if;
  return set_byte(set_byte('\x0000'::bytea, 0, p_tag), 1, octet_length(v_bytes)) || v_bytes;
end;
$$;

comment on function zatca_tlv_field(integer, text) is
  'حقلُ TLV واحدٌ: وسمٌ فطولٌ بالبايتاتِ فقيمةٌ UTF-8 (F3-09 · SD-08).';

-- الحقولُ الخمسةُ التي تُوجِبُها الهيئةُ لرمزِ الفاتورةِ المبسَّطةِ، بترتيبِها:
--   ١ اسمُ البائعِ · ٢ رقمُه الضريبيُّ · ٣ ختمُ الزمنِ · ٤ الإجماليُّ شاملَ
--   الضريبةِ · ٥ إجماليُّ الضريبةِ.
-- والزمنُ بـ`UTC` بصيغةِ `ISO 8601`، والمبالغُ نصّاً بخانتَينِ عشريّتَينِ.
create or replace function zatca_simplified_invoice_qr(
  p_seller_name text,
  p_seller_vat_number text,
  p_issued_at timestamptz,
  p_total_incl_vat_minor integer,
  p_vat_amount_minor integer
)
returns text
language sql
immutable
as $$
  select encode(
    zatca_tlv_field(1, p_seller_name)
    || zatca_tlv_field(2, p_seller_vat_number)
    || zatca_tlv_field(3, to_char(p_issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    || zatca_tlv_field(4, to_char(p_total_incl_vat_minor::numeric / 100, 'FM999999999990.00'))
    || zatca_tlv_field(5, to_char(p_vat_amount_minor::numeric / 100, 'FM999999999990.00')),
    'base64'
  );
$$;

comment on function zatca_simplified_invoice_qr(text, text, timestamptz, integer, integer) is
  'رمزُ الاستجابةِ للفاتورةِ المبسَّطةِ: خمسةُ حقولِ TLV بترتيبِها ثمَّ base64 (F3-09 · SD-08).';

-- ── ٦) الكاتبُ الواحدُ — نفسُ الدالّةِ القائمةِ، وقد صارَت تُفَوتِرُ ضريبيّاً ───
--
-- **ولا كاتبَ ثانياً**: `issue_subscription_tax_invoice` أدناهُ لا تُدرِجُ صفّاً
-- بيدِها بل تُنادي هذه. فالترقيمُ موضعٌ واحدٌ، والقيدُ موضعٌ واحدٌ، والحسابُ
-- موضعٌ واحدٌ — وذاكَ ما يجعلُ نداءَينِ متوازيَينِ رقماً واحداً.
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
     or v_payment.status not in ('active', 'refunded') then
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
  'الكاتبُ الوحيدُ لفاتورةِ اشتراكٍ — ترقيمٌ لكلِّ مدينةٍ وسنةٍ وضريبةٌ مستخرَجةٌ من مبلغٍ شاملٍ (F3-09 · SD-08).';

revoke all on function issue_subscription_invoice(uuid) from public;
revoke all on function issue_subscription_invoice(uuid) from anon;
revoke all on function issue_subscription_invoice(uuid) from authenticated;
grant execute on function issue_subscription_invoice(uuid) to service_role;

-- ── ٧) الإصدارُ من التطبيقِ المُصغَّرِ — مِلكيّةٌ في القاعدةِ ثمَّ تفويضٌ ───────
create or replace function issue_subscription_tax_invoice(
  p_telegram_id bigint,
  p_transaction_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_txn payment_transactions%rowtype;
  v_result jsonb;
  v_row subscription_invoices%rowtype;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  -- **المِلكيّةُ قيدُ استعلامٍ لا شرطٌ بعدَه**: معاملةُ غيرِه لا تُوجَدُ عندَه،
  -- فلا يُفرَّقُ في الجوابِ بينَ «ليسَت لكَ» و«لا وجودَ لها» — وذاكَ يمنعُ
  -- استخراجَ وجودِ معاملةٍ بمعرِّفٍ مُجرَّبٍ.
  select * into v_txn
    from payment_transactions
   where id = p_transaction_id
     and payer_driver_id = v_driver.id
     and purpose = 'driver_subscription';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_FOUND');
  end if;

  v_result := issue_subscription_invoice(p_transaction_id);
  if (v_result->>'ok')::boolean is not true then
    -- **ترجمةُ رفضٍ لا اختراعُه**: رفضُ الكاتبِ يُقرأُ بمعناهُ عندَ السائقِ.
    return case v_result->>'error'
      when 'CONFIRMED_SUBSCRIPTION_PAYMENT_REQUIRED'
        then jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_PAID')
      else v_result
    end;
  end if;

  select * into v_row
    from subscription_invoices where payment_transaction_id = p_transaction_id;
  if not found or v_row.document_type is null then
    return jsonb_build_object('ok', false, 'error', 'INVOICE_WITHOUT_TAX_FIELDS');
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_issued', (v_result->>'already_issued')::boolean,
    'invoice', subscription_tax_invoice_payload(v_row)
  );
end;
$fn$;

comment on function issue_subscription_tax_invoice(bigint, uuid) is
  'إصدارُ فاتورةٍ ضريبيّةٍ مبسَّطةٍ لدفعةِ اشتراكٍ ناجحةٍ — مرّةً واحدةً، والمِلكيّةُ في القاعدةِ (F3-09 · SD-08).';

revoke all on function issue_subscription_tax_invoice(bigint, uuid) from public;
revoke all on function issue_subscription_tax_invoice(bigint, uuid) from anon;
revoke all on function issue_subscription_tax_invoice(bigint, uuid) from authenticated;
grant execute on function issue_subscription_tax_invoice(bigint, uuid) to service_role;

-- ── ٨) قراءةُ الفاتورةِ وحالةِ العمليةِ ────────────────────────────────────────
create or replace function driver_subscription_tax_invoice(
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
  v_row subscription_invoices%rowtype;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  select si.* into v_row
    from subscription_invoices si
    join payment_transactions pt on pt.id = si.payment_transaction_id
   where si.payment_transaction_id = p_transaction_id
     and pt.payer_driver_id = v_driver.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVOICE_NOT_ISSUED');
  end if;

  -- **صفٌّ سبقَ هذه الهجرةَ لا يُلفَّقُ له ضريبةٌ**: يُقالُ إنَّه بلا حقولٍ
  -- ضريبيّةٍ، ويُصحَّحُ بإشعارٍ دائنٍ وإصدارٍ جديدٍ لا بكتابةٍ فوقَه.
  if v_row.document_type is null then
    return jsonb_build_object('ok', false, 'error', 'INVOICE_WITHOUT_TAX_FIELDS');
  end if;

  return jsonb_build_object('ok', true, 'invoice', subscription_tax_invoice_payload(v_row));
end;
$fn$;

comment on function driver_subscription_tax_invoice(bigint, uuid) is
  'قراءةُ فاتورةِ معاملةٍ بعينِها لصاحبِها وحدَه (F3-09 · SD-08).';

revoke all on function driver_subscription_tax_invoice(bigint, uuid) from public;
revoke all on function driver_subscription_tax_invoice(bigint, uuid) from anon;
revoke all on function driver_subscription_tax_invoice(bigint, uuid) from authenticated;
grant execute on function driver_subscription_tax_invoice(bigint, uuid) to service_role;

-- حالةُ العمليةِ لمعاملةٍ بعينِها — تُقرأُ عندَ الرجوعِ من صفحةِ الدفعِ.
-- **ولا تُنشَرُ حالةُ المزوّدِ الخامُ ولا معرِّفُه**: حالُنا نحنُ وحدَه، ورايةٌ
-- تقولُ هل صارَ للفاتورةِ صفٌّ — فلا تسألُ الشاشةُ مرّتَينِ.
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
    )
  );
end;
$fn$;

comment on function driver_subscription_payment_status(bigint, uuid) is
  'حالُ معاملةِ اشتراكٍ بعينِها لصاحبِها وحدَه، ورايةُ صدورِ الفاتورةِ (F3-09 · SD-08).';

revoke all on function driver_subscription_payment_status(bigint, uuid) from public;
revoke all on function driver_subscription_payment_status(bigint, uuid) from anon;
revoke all on function driver_subscription_payment_status(bigint, uuid) from authenticated;
grant execute on function driver_subscription_payment_status(bigint, uuid) to service_role;
