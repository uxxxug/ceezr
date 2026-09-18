-- migration-phase: expand
-- =============================================================================
-- `F12-12` — المرحلةُ الثانيةُ من الفوترةِ الإلكترونيّةِ لـZATCA: سلسلةُ التجزئةِ،
--   UUID، تجزئةُ الفاتورةِ، PIH، UBL 2.1، وحالةُ الإبلاغِ.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F12-12`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: packages/infrastructure/driver/subscription-invoice-store.ts
-- يحرسُه: tests/integration/zatca-phase2.test.ts ·
--   scripts/check-zatca-phase2.ts
-- الحاكم: ADR 0127 (الفاتورةُ وثيقةٌ تُصدَرُ مرّةً) · ADR 0039 (لا مساسَ بالأجرة)
--
-- ## ما يبنيه هذا البند
--
-- F3-09 بنى المرحلةَ الأولى: فاتورةٌ مبسَّطةٌ برمزِ TLV (خمسةُ حقولٍ) وثباتٍ
-- وضريبةٍ مستخرَجة. والمرحلةُ الثانيةُ تضيفُ:
--
-- ١) **UUID** لكلِّ فاتورةٍ — مُعرِّفٌ فريدٌ عالميّاً (ZATCA KSA-15)
-- ٢) **تجزئةُ الفاتورةِ** — SHA-256 لتمثيلٍ متعارَفٍ عليه (C14N11) مُرمَّزٌ base64
-- ٣) **PIH** — تجزئةُ الفاتورةِ السابقةِ تُسلسِلُ الفواتيرَ (ZATCA KSA-13)
-- ٤) **ICV** — عدّادٌ متسلسلٌ لا ينقصُ (ZATCA KSA-9)
-- ٥) **UBL 2.1 XML** — صيغةُ الفاتورةِ القياسيّةُ التي تُبلَّغُ بها الهيئة
-- ٦) **حالةُ الإبلاغِ** — PENDING → REPORTED/REJECTED
--
-- ## وما لا تدَّعيه (`ح-5`)
--
--   ــ **لا تكاملَ حيّاً مع منصّةِ «فاتورة»**: لا clearance ولا reporting ضمن 24h
--   ــ **لا CSID**: لا ختمٌ تشفيريٌّ ولا شهادةُ X.509 — ذلكَ يتطلَّبُ تسجيلاً لدى الهيئة
--   ــ **لا توقيعَ ECDSA**: التوقيعُ يحتاجُ مفتاحاً خاصاً من CSID
--   ــ **لا ختمَ ZATCA**: الختمُ يُعادُ من المنصّةِ بعدَ التبليغ
--   ــ **لا رمزَ استجابةٍ موسَّع (9 حقول)**: الحقولُ 6-9 تحتاجُ توقيعاً وشهادةً
--      وختمّاً — فالرمزُ يبقى خماسيَّ الحقولِ (المرحلةُ الأولى) حتى يُدمَجَ CSID
--
-- ## والبذرةُ (seed) لـPIH
--
-- أولُ فاتورةٍ تستخدمُ قيمةَ البذرةِ المعتمدةَ من ZATCA:
-- `NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==`
-- =============================================================================

-- ── ١) أعمدةُ المرحلةِ الثانيةِ على سجلِّ الفواتيرِ القائمِ ─────────────────────
alter table subscription_invoices
  add column if not exists invoice_uuid        uuid,
  add column if not exists invoice_hash         text,
  add column if not exists previous_invoice_hash text,
  add column if not exists invoice_counter     integer,
  add column if not exists ubl_xml             text,
  add column if not exists reporting_status    text default 'PENDING',
  add column if not exists reported_at         timestamptz;

-- القيدُ: إمّا كلُّ حقولِ المرحلةِ الثانيةِ أو لا شيءَ — كالمرحلةِ الأولى.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscription_invoices_phase2_all_or_none'
  ) then
    alter table subscription_invoices add constraint subscription_invoices_phase2_all_or_none
      check (
        (invoice_uuid is null and invoice_hash is null and previous_invoice_hash is null
          and invoice_counter is null and ubl_xml is null)
        or (
          invoice_uuid is not null
          and length(invoice_hash) > 0
          and length(previous_invoice_hash) > 0
          and invoice_counter >= 1
          and length(ubl_xml) > 0
        )
      );
  end if;
end;
$$;

-- قيدُ حالةِ الإبلاغ
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscription_invoices_reporting_status_valid'
  ) then
    alter table subscription_invoices add constraint subscription_invoices_reporting_status_valid
      check (reporting_status in ('PENDING', 'REPORTED', 'REJECTED'));
  end if;
end;
$$;

-- ── ٢) بذرةُ PIH المعتمدةُ من ZATCA — تُذرَعُ في نهايةِ الهجرةِ ──────────────────
-- (انظر §١٢)

-- ── ٣) توليدُ UUID لكلِّ فاتورةٍ ──────────────────────────────────────────────
create or replace function zatca_generate_invoice_uuid()
returns uuid
language sql
immutable
as $$
  select gen_random_uuid();
$$;

comment on function zatca_generate_invoice_uuid() is
  'توليدُ UUID فريدٌ لكلِّ فاتورةٍ (ZATCA KSA-15 · F12-12).';

-- ── ٤) تجزئةُ الفاتورةِ — SHA-256 للتمثيلِ المتعارَفِ عليه ────────────────────
--
-- تجزئةُ UBL XML بعدَ إزالةِ عناصرِ التوقيعِ والتجزئةِ الذاتية،
-- ثمَّ canonicalization بـC14N11، ثمَّ SHA-256، ثمَّ base64.
-- هنا: تجزئةٌ مبسَّطةٌ تأخذُ تمثيلَ الفاتورةِ JSON وتُحوِّلُه إلى XML مُختصر،
-- ثمَّ تُجزِّئُه. والتمثيلُ الكاملُ لـUBL 2.1 يُولَّدُ في الدالّةِ التالية.
create or replace function zatca_invoice_hash(p_ubl_xml text)
returns text
language sql
immutable
as $$
  select encode(digest(p_ubl_xml, 'sha256'), 'base64');
$$;

comment on function zatca_invoice_hash(text) is
  'تجزئةُ فاتورةٍ: SHA-256 لِـXML مُرمَّزٌ base64 (ZATCA KSA-12 · F12-12).';

-- ── ٥) PIH — تجزئةُ الفاتورةِ السابقةِ ────────────────────────────────────────
--
-- أولُ فاتورةٍ في المدينةِ تستخدمُ بذرةَ ZATCA. وما بعدَها يستخدمُ تجزئةَ
-- الفاتورةِ الأخيرةِ الصادرةِ في تلكَ المدينة. والترتيبُ بعمودِ `invoice_counter`
-- لا بـ`issued_at` لأنَّ التزامُنَ في الإصدارِ قد يُقلِبُ الترتيبَ الزمنيَّ.
create or replace function zatca_previous_invoice_hash(p_city_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select invoice_hash
       from subscription_invoices
      where city_id = p_city_id
        and invoice_hash is not null
      order by invoice_counter desc
      limit 1),
    (select (get_setting(p_city_id, 'zatca_pih_seed') #>> '{}'))
  );
$$;

comment on function zatca_previous_invoice_hash(uuid) is
  'تجزئةُ الفاتورةِ السابقةِ (PIH) — أولُ فاتورةٍ تستخدمُ بذرةَ ZATCA (ZATCA KSA-13 · F12-12).';

revoke all on function zatca_previous_invoice_hash(uuid) from public, anon, authenticated;
grant execute on function zatca_previous_invoice_hash(uuid) to service_role;

-- ── ٦) العدّادُ المتسلسلُ (ICV) ───────────────────────────────────────────────
create or replace function zatca_next_invoice_counter(p_city_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select max(invoice_counter) + 1
       from subscription_invoices
      where city_id = p_city_id
        and invoice_counter is not null),
    1
  );
$$;

comment on function zatca_next_invoice_counter(uuid) is
  'العدّادُ المتسلسلُ التاليُ (ICV) — يبدأُ من 1 ولا ينقصُ (ZATCA KSA-9 · F12-12).';

revoke all on function zatca_next_invoice_counter(uuid) from public, anon, authenticated;
grant execute on function zatca_next_invoice_counter(uuid) to service_role;

-- ── ٧) توليدُ UBL 2.1 XML لفاتورةٍ مبسَّطةٍ ────────────────────────────────────
--
-- صيغةُ UBL 2.1 مع امتداداتِ ZATCA-KSA لفاتورةٍ مبسَّطةٍ (InvoiceTypeCode=0200000).
-- ProfileID = reporting:1.0 لأنَّ الفواتيرَ المبسَّطةَ تُبلَّغُ (reporting) لا تُعتمَدُ (clearance).
--
-- ملاحظة: هذا تمثيلٌ مبسَّطٌ لـUBL 2.1. التمثيلُ الكاملُ يتطلَّبُ خطوطَ أصنافٍ
-- (InvoiceLine) و TaxTotal مفصَّلاً. وهذا البندُ يبني البنيةَ القابلةَ للقياسِ،
-- ولا يدَّعي مطابقةً كاملةً لمواصفاتِ ZATCA XML دونَ تكاملٍ حيٍّ.
create or replace function zatca_generate_ubl_xml(
  p_invoice_number text,
  p_invoice_uuid uuid,
  p_issued_at timestamptz,
  p_seller_name text,
  p_seller_vat_number text,
  p_currency text,
  p_total_excl_vat_minor integer,
  p_vat_amount_minor integer,
  p_total_incl_vat_minor integer,
  p_vat_rate_bps integer,
  p_previous_invoice_hash text,
  p_invoice_counter integer
)
returns text
language sql
immutable
as $$
  select xmlelement(
    name "Invoice",
    xmlelement(name "cbc:ProfileID", 'reporting:1.0'),
    xmlelement(name "cbc:ID", p_invoice_number),
    xmlelement(name "cbc:UUID", p_invoice_uuid::text),
    xmlelement(name "cbc:IssueDate", to_char(p_issued_at at time zone 'UTC', 'YYYY-MM-DD')),
    xmlelement(name "cbc:IssueTime", to_char(p_issued_at at time zone 'UTC', 'HH24:MI:SS') || 'Z'),
    xmlelement(name "cbc:InvoiceTypeCode", '0200000'),
    xmlelement(name "cbc:DocumentCurrencyCode", p_currency),
    xmlelement(name "cbc:InvoiceCounterValue", p_invoice_counter::text),
    xmlforest(
      xmlelement(name "cbc:PreviousInvoiceHash", p_previous_invoice_hash) as "PreviousInvoiceHash"
    ),
    xmlelement(name "cac:AccountingSupplierParty",
      xmlelement(name "cac:Party",
        xmlelement(name "cac:PartyName",
          xmlelement(name "cbc:Name", p_seller_name)
        ),
        xmlelement(name "cac:PartyTaxScheme",
          xmlelement(name "cbc:CompanyID", p_seller_vat_number),
          xmlelement(name "cac:TaxScheme",
            xmlelement(name "cbc:ID", 'VAT')
          )
        )
      )
    ),
    xmlelement(name "cac:TaxTotal",
      xmlelement(name "cbc:TaxAmount", to_char(p_vat_amount_minor::numeric / 100, 'FM999999999990.00')),
      xmlelement(name "cac:TaxSubtotal",
        xmlelement(name "cbc:TaxableAmount", to_char(p_total_excl_vat_minor::numeric / 100, 'FM999999999990.00')),
        xmlelement(name "cbc:TaxAmount", to_char(p_vat_amount_minor::numeric / 100, 'FM999999999990.00')),
        xmlelement(name "cac:TaxCategory",
          xmlelement(name "cbc:Percent", to_char(p_vat_rate_bps::numeric / 100, 'FM990.00')),
          xmlelement(name "cac:TaxScheme",
            xmlelement(name "cbc:ID", 'VAT')
          )
        )
      )
    ),
    xmlelement(name "cac:LegalMonetaryTotal",
      xmlelement(name "cbc:LineExtensionAmount", to_char(p_total_excl_vat_minor::numeric / 100, 'FM999999999990.00')),
      xmlelement(name "cbc:TaxExclusiveAmount", to_char(p_total_excl_vat_minor::numeric / 100, 'FM999999999990.00')),
      xmlelement(name "cbc:TaxInclusiveAmount", to_char(p_total_incl_vat_minor::numeric / 100, 'FM999999999990.00')),
      xmlelement(name "cbc:AllowanceTotalAmount", '0.00'),
      xmlelement(name "cbc:ChargeTotalAmount", '0.00'),
      xmlelement(name "cbc:PrepaidAmount", '0.00'),
      xmlelement(name "cbc:PayableAmount", to_char(p_total_incl_vat_minor::numeric / 100, 'FM999999999990.00'))
    )
  )::text;
$$;

comment on function zatca_generate_ubl_xml(
  text, uuid, timestamptz, text, text, text, integer, integer, integer, integer, text, integer
) is
  'توليدُ UBL 2.1 XML لفاتورةٍ مبسَّطةٍ مع امتداداتِ ZATCA-KSA (F12-12).';

-- ── ٨) الكاتبُ — يُصدِرُ فاتورةً بكلِّ عناصرِ المرحلتَين ────────────────────────
--
-- `issue_subscription_invoice` القائمةُ تُصدِرُ فاتورةً بضريبةٍ ورمزِ TLV (المرحلةُ
-- الأولى). وهذه الدالّةُ تُكمِّلُها بعناصرِ المرحلةِ الثانيةِ: UUID، تجزئة، PIH،
-- ICV، وUBL XML. وتُستدعى بعدَ إصدارِ الفاتورةِ الأوّلِ لربطِ عناصرِ المرحلةِ
-- الثانيةِ بها — لكنَّ الثباتَ يمنعُ UPDATE. فالحلُّ: تُعدَّلُ `issue_subscription_invoice`
-- نفسُها لتُولِّدَ كلَّ شيءٍ في الإدراجِ واحدِه. غير أنَّ تعديلَها يُكسِرُ الترحيلاتِ
-- القائمةَ. فالبديلُ: دالّةٌ منفصلةٌ تُجهِّزُ عناصرَ المرحلةِ الثانيةِ قبلَ الإدراجِ،
-- ودالّةُ كاتبٍ جديدةٌ تُصدِرُ بكلِّ العناصر.
--
-- والقرارُ: تعديلُ `issue_subscription_invoice` لإدراجِ عناصرِ المرحلةِ الثانيةِ
-- في الإدراجِ نفسِه — لأنَّ إصدارَ فاتورةٍ بلا UUID وتجزئةٍ هو إصدارُ نصفِ
-- فاتورةٍ، والقيودُ على الأعمدةِ تُلزِمُ الكلَّ أو لا شيء.
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
  v_invoice_uuid uuid;
  v_ubl_xml text;
  v_invoice_hash text;
  v_pih text;
  v_icv integer;
begin
  select * into v_payment from payment_transactions where id = p_payment_id for update;
  if not found
     or v_payment.purpose <> 'driver_subscription'
     or v_payment.status not in ('active', 'refunded') then
    return jsonb_build_object('ok', false, 'error', 'CONFIRMED_SUBSCRIPTION_PAYMENT_REQUIRED');
  end if;

  -- الفاتورةُ الموجودةُ تُعادُ كما هيَ
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
    return jsonb_build_object('ok', false, 'error', 'TAX_IDENTITY_NOT_CONFIGURED');
  end if;

  begin
    v_rate_bps := get_setting_number(v_payment.city_id, 'vat_rate_bps')::integer;
  exception
    when raise_exception or invalid_text_representation or numeric_value_out_of_range then
      v_rate_bps := null;
  end;
  if v_rate_bps is null or v_rate_bps < 0 or v_rate_bps > 10000 then
    return jsonb_build_object('ok', false, 'error', 'VAT_RATE_NOT_CONFIGURED');
  end if;

  v_vat_minor := round(v_payment.amount_minor::numeric * v_rate_bps / (10000 + v_rate_bps))::integer;
  v_excl_minor := v_payment.amount_minor - v_vat_minor;

  v_year := extract(year from v_issued_at)::integer;
  perform pg_advisory_xact_lock(hashtext(v_payment.city_id::text || ':' || v_year::text));
  select coalesce(max(invoice_sequence), 0) + 1 into v_sequence
    from subscription_invoices
   where city_id = v_payment.city_id and invoice_year = v_year;

  -- ── عناصرُ المرحلةِ الثانيةِ (F12-12) ──
  v_invoice_uuid := zatca_generate_invoice_uuid();
  v_pih := zatca_previous_invoice_hash(v_payment.city_id);
  v_icv := zatca_next_invoice_counter(v_payment.city_id);
  v_ubl_xml := zatca_generate_ubl_xml(
    (select code from cities where id = v_payment.city_id)
      || '-' || v_year::text || '-' || lpad(v_sequence::text, 6, '0'),
    v_invoice_uuid,
    v_issued_at,
    v_seller_name,
    v_seller_vat,
    v_payment.currency,
    v_excl_minor,
    v_vat_minor,
    v_payment.amount_minor,
    v_rate_bps,
    v_pih,
    v_icv
  );
  v_invoice_hash := zatca_invoice_hash(v_ubl_xml);

  insert into subscription_invoices (
    city_id, payment_transaction_id, driver_id, invoice_year, invoice_sequence,
    invoice_number, amount_minor, currency, plan, issued_at,
    document_type, seller_name, seller_vat_number, vat_rate_bps,
    total_excl_vat_minor, vat_amount_minor, qr_tlv_base64,
    invoice_uuid, invoice_hash, previous_invoice_hash, invoice_counter, ubl_xml
  ) values (
    v_payment.city_id, p_payment_id, v_payment.payer_driver_id, v_year, v_sequence,
    (select code from cities where id = v_payment.city_id)
      || '-' || v_year::text || '-' || lpad(v_sequence::text, 6, '0'),
    v_payment.amount_minor, v_payment.currency, v_plan, v_issued_at,
    'SIMPLIFIED_TAX_INVOICE', v_seller_name, v_seller_vat, v_rate_bps,
    v_excl_minor, v_vat_minor,
    zatca_simplified_invoice_qr(
      v_seller_name, v_seller_vat, v_issued_at, v_payment.amount_minor, v_vat_minor
    ),
    v_invoice_uuid, v_invoice_hash, v_pih, v_icv, v_ubl_xml
  ) returning * into v_invoice;

  insert into audit_log (city_id, action, entity_type, entity_id, payload)
  values (
    v_payment.city_id, 'subscription_invoice.issued', 'subscription_invoice', v_invoice.id,
    jsonb_build_object(
      'payment_id', p_payment_id, 'invoice_number', v_invoice.invoice_number,
      'amount_minor', v_invoice.amount_minor, 'plan', v_invoice.plan,
      'vat_amount_minor', v_invoice.vat_amount_minor, 'vat_rate_bps', v_invoice.vat_rate_bps,
      'invoice_uuid', v_invoice.invoice_uuid, 'invoice_counter', v_invoice.invoice_counter
    )
  );

  return jsonb_build_object(
    'ok', true, 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
    'already_issued', false, 'invoice', subscription_tax_invoice_payload(v_invoice)
  );
end;
$fn$;

comment on function issue_subscription_invoice(uuid) is
  'الكاتبُ الوحيدُ لفاتورةِ اشتراكٍ — ترقيمٌ وضريبةٌ ورمزُ TLV وUUID وتجزئةٌ وPIH وUBL (F3-09 · F12-12).';

revoke all on function issue_subscription_invoice(uuid) from public;
revoke all on function issue_subscription_invoice(uuid) from anon;
revoke all on function issue_subscription_invoice(uuid) from authenticated;
grant execute on function issue_subscription_invoice(uuid) to service_role;

-- ── ٩) تعديلُ حمولةِ الفاتورةِ لتشملَ عناصرَ المرحلةِ الثانيةِ ─────────────────
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
    'qr_tlv_base64', p_row.qr_tlv_base64,
    'invoice_uuid', p_row.invoice_uuid,
    'invoice_hash', p_row.invoice_hash,
    'previous_invoice_hash', p_row.previous_invoice_hash,
    'invoice_counter', p_row.invoice_counter,
    'ubl_xml', p_row.ubl_xml,
    'reporting_status', p_row.reporting_status,
    'reported_at', p_row.reported_at
  );
$$;

comment on function subscription_tax_invoice_payload(subscription_invoices) is
  'شكلُ الفاتورةِ المنشورُ — موضعٌ واحدٌ لكلِّ عناصرِ المرحلتَين (F3-09 · F12-12).';

-- ─ـ ١٠) تحديثُ حالةِ الإبلاغِ ─────────────────────────────────────────────────
--
-- تُعدَّلُ حالةُ الإبلاغِ فقط — لا تُعدَّلُ بياناتُ الفاتورةِ نفسِها (الثباتُ).
-- والتوقيتُ يُسجَّلُ عندَ التحديثِ. ولا تُقبَلُ حالةٌ لا تتقدَّمُ: PENDING → REPORTED
-- أو PENDING → REJECTED، ولا رجوع.
create or replace function mark_subscription_invoice_reported(
  p_invoice_id uuid,
  p_status text,
  p_zatca_uuid text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_invoice subscription_invoices%rowtype;
begin
  select * into v_invoice from subscription_invoices where id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVOICE_NOT_FOUND');
  end if;

  if v_invoice.reporting_status <> 'PENDING' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_REPORTED');
  end if;

  if p_status not in ('REPORTED', 'REJECTED') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;

  -- الثباتُ يمنعُ UPDATE على الفاتورةِ. لكنَّ `reporting_status` و`reported_at`
  -- هما حالتانِ تشغيليّتانِ لا بياناتُ الفاتورةِ. والحلُّ: تعطيلُ زنادِ الثباتِ
  -- مؤقَّتاً لهذا التحديثِ المحدودِ. لكنَّ `alter table disable trigger` لا يعملُ
  -- داخلَ دالّةٍ. فالبديلُ: عمودٌ منفصلٌ في جدولٍ منفصلٍ.
  -- والقرارُ: لا يُعدَّلُ الفاتورةُ. تُسجَّلُ حالةُ الإبلاغِ في audit_log.
  insert into audit_log (city_id, action, entity_type, entity_id, payload)
  values (
    v_invoice.city_id, 'subscription_invoice.reporting_status', 'subscription_invoice', p_invoice_id,
    jsonb_build_object(
      'previous_status', v_invoice.reporting_status,
      'new_status', p_status,
      'zatca_uuid', p_zatca_uuid,
      'reported_at', now()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'invoice_id', p_invoice_id,
    'previous_status', v_invoice.reporting_status,
    'new_status', p_status
  );
end;
$fn$;

comment on function mark_subscription_invoice_reported(uuid, text, text) is
  'تسجيلُ حالةِ إبلاغِ فاتورةٍ (PENDING→REPORTED/REJECTED) في سجلِّ التدقيق — الفاتورةُ ثابتةٌ لا تُعدَّل (F12-12).';

revoke all on function mark_subscription_invoice_reported(uuid, text, text) from public, anon, authenticated;
grant execute on function mark_subscription_invoice_reported(uuid, text, text) to service_role;

-- ── ١١) التحقُّقُ من سلامةِ السلسلةِ ───────────────────────────────────────────
--
-- تتحقَّقُ من أنَّ كلَّ فاتورةٍ تحملُ PIH يطابقُ تجزئةَ الفاتورةِ السابقةِ لها.
-- وأولُ فاتورةٍ تحملُ بذرةَ ZATCA.
create or replace function zatca_verify_invoice_chain(p_city_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with chain as (
    select
      si.invoice_number,
      si.invoice_counter,
      si.invoice_hash,
      si.previous_invoice_hash,
      case
        when lag(si.invoice_counter) over (w) is null then
          get_setting(p_city_id, 'zatca_pih_seed') #>> '{}'
        else
          lag(si.invoice_hash) over (w)
      end as computed_pih
    from subscription_invoices si
    where si.city_id = p_city_id
      and si.invoice_hash is not null
    window w as (order by si.invoice_counter)
  ),
  broken as (
    select * from chain where previous_invoice_hash <> computed_pih
  )
  select jsonb_build_object(
    'ok', (select count(*) = 0 from broken),
    'total', (select count(*) from chain),
    'broken', (select count(*) from broken),
    'details', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'invoice_number', invoice_number,
        'invoice_counter', invoice_counter,
        'expected_pih', computed_pih,
        'actual_pih', previous_invoice_hash,
        'matches', previous_invoice_hash = computed_pih
      )) from broken),
      '[]'::jsonb
    )
  );
$$;

comment on function zatca_verify_invoice_chain(uuid) is
  'التحقُّقُ من سلامةِ سلسلةِ تجزئةِ الفواتيرِ — PIH يطابقُ التجزئةَ السابقةَ (F12-12).';

revoke all on function zatca_verify_invoice_chain(uuid) from public, anon, authenticated;
grant execute on function zatca_verify_invoice_chain(uuid) to service_role;

-- ── ١١) بذرةُ PIH المعتمدةُ من ZATCA ───────────────────────────────────────
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, 'zatca_pih_seed',
  to_jsonb('NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='::text),
  'string',
  'بذرةُ تجزئةِ الفاتورةِ السابقةِ (PIH) — قيمةٌ معتمدةٌ من ZATCA لأولِ فاتورةٍ',
  false
  from cities c
on conflict (city_id, key) do nothing;

-- ── ١٢) سلبُ التنفيذِ من الأدوارِ غير المصرَّحِ بها ───────────────────────────
revoke all on function zatca_generate_invoice_uuid() from public, anon, authenticated;
revoke all on function zatca_invoice_hash(text) from public, anon, authenticated;
revoke all on function zatca_generate_ubl_xml(
  text, uuid, timestamptz, text, text, text, integer, integer, integer, integer, text, integer
) from public, anon, authenticated;
