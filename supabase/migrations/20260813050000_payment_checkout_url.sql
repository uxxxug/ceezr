-- =============================================================================
-- الغرض: حفظ رابط الدفع المستضاف داخل المعاملة، مرّةً واحدة لا تُبدَّل.
-- الحالة: منفّذ فعلياً.
-- ينتمي إلى: supabase/migrations
--
-- ## لماذا هذا الجدول/الدالة موجودة أصلاً؟
--
-- زرّ «اشترك» في بوت السائق يحتاج أن يكون قابلاً للضغط مرّتين بلا كارثة. ومفتاح
-- الإيدمبوتنسي يمنع إنشاء معاملةٍ ثانية، لكنّه كان يعني أنّ الضغطة الثانية تعيد
-- معاملةً موجودة **بلا رابط دفع** — فالرابط كان يعيش في ردّ المزوّد لحظةً واحدة
-- ثمّ يُفقد. فالسائق الذي أغلق التطبيق أو فقد الرسالة كان يبقى بمعاملةٍ معلّقة
-- لا سبيل له إلى دفعها.
--
-- والبديل الظاهر — إنشاء فاتورةٍ جديدة عند كل ضغطة — خطرٌ ماليّ حقيقيّ لا
-- مجرّد فوضى: `activate_subscription` **يستبدل** المدّة (`now() + days`) ولا
-- يجمعها، فسائقٌ دفع فاتورتين يخسر شهراً كاملاً من قيمة ما دفع. فحفظُ الرابط
-- هو ما يجعل «فاتورةً واحدة لكل معاملة» ممكناً عملياً.
--
-- ## القواعد المحرِّمة المطبَّقة هنا:
--   - كل تعديل حرج عبر RPC ذرّي لا UPDATE خام من التطبيق (القاعدة 0.4).
--   - الرابط لا يُبدَّل بعد كتابته: من كتب أوّلاً هو المرجع، وإلاّ صار سباقُ
--     ضغطتين قادراً على استبدال رابطٍ يدفع فيه السائق بآخر.
--   - لا كتابة على معاملةٍ خرجت من `pending`: معاملةٌ مدفوعة لا تُعطى رابط دفع.
-- =============================================================================

create or replace function record_payment_checkout(
  p_transaction_id uuid,
  p_checkout_url text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row payment_transactions%rowtype;
  v_existing text;
begin
  if p_checkout_url is null or length(btrim(p_checkout_url)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'CHECKOUT_URL_REQUIRED');
  end if;

  -- القفل على الصفّ يجعل ضغطتين متزامنتين تتسلسلان، فلا تكتب الثانية فوق الأولى.
  select * into v_row from payment_transactions where id = p_transaction_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_FOUND');
  end if;

  if v_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_PENDING',
                              'status', v_row.status);
  end if;

  v_existing := v_row.metadata #>> '{checkout_url}';
  if v_existing is not null and length(btrim(v_existing)) > 0 then
    -- ليس خطأً: هذا هو المسار الطبيعي للضغطة الثانية. يُعاد الرابط الأوّل نفسه.
    return jsonb_build_object('ok', true, 'checkout_url', v_existing, 'stored', false);
  end if;

  update payment_transactions
     set metadata = v_row.metadata || jsonb_build_object('checkout_url', p_checkout_url)
   where id = p_transaction_id;

  return jsonb_build_object('ok', true, 'checkout_url', p_checkout_url, 'stored', true);
end;
$$;

-- لا EXECUTE لأحدٍ غير الأدوار الخدمية: الدالة تكتب في معاملات الدفع.
revoke all on function record_payment_checkout(uuid, text) from public;
revoke all on function record_payment_checkout(uuid, text) from anon;
revoke all on function record_payment_checkout(uuid, text) from authenticated;

comment on function record_payment_checkout(uuid, text) is
  'يحفظ رابط الدفع المستضاف مرّةً واحدة في metadata.checkout_url لمعاملة pending، ويعيد الرابط المحفوظ إن سبق.';
