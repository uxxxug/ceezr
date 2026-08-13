-- =============================================================================
-- الغرض: إنقاذ الدفعات التي ضاع ويبهوكها. أمران لا ثالث لهما:
--   ١) `record_payment_provider_reference` — يحفظ معرّف عملية المزوّد لحظةَ بدئها
--      لا لحظةَ تأكيدها.
--   ٢) `list_stale_pending_payments` — يعدّ المعاملات المعلّقة القابلة للمراجعة.
-- الحالة: منفّذ فعلياً — إغلاق ثقب «دفع ولم يُفعَّل».
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: apps/workers (مهمّة reconcile-pending-payments)
--
-- ## الثقب الذي تُغلقه هذه الهجرة
--
-- مسار الدفع المستضاف يمضي هكذا: تُنشأ المعاملة بـ`provider_transaction_id = null`،
-- ثمّ يُنادى المزوّد فيعيد معرّف عمليته ورابط الدفع، فيُحفظ الرابط وحده ويُهمَل
-- المعرّف. والمعرّف لا يُكتب إلا داخل `confirm_payment` — أي عند وصول الويبهوك.
--
-- فإن ضاع الويبهوك (انقطاعٌ عند المزوّد، أو إعادة نشرٍ عندنا، أو 503 عابر) صار
-- عندنا صفٌّ معلّقٌ إلى الأبد، ولا سبيل إلى سؤال المزوّد «ما مصير هذه الدفعة؟»
-- لأنّنا لا نعرف رقمها عنده. المعرفة كانت في اتجاه واحد: المزوّد يعرف معاملتنا
-- من `metadata`، ونحن لا نعرف عمليته. فالسائق يدفع ولا يُفعَّل اشتراكه، ولا يظهر
-- ذلك في أي مقياس — وهذا أسوأ من فشلٍ صريح.
--
-- ولذلك يُحفظ المعرّف لحظة بدء العملية: ليس تحسيناً، بل هو الشرط الذي تصير به
-- المراجعة ممكنة أصلاً.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1) فهرس المراجعة
--    جزئيّ على الصفوف القابلة للمراجعة وحدها: المعاملات المنتهية أكثرُ عدداً بمرور
--    الوقت، وفهرسةُ ما لا يُراجَع تكلفة كتابةٍ بلا مقابل قراءة.
-- ----------------------------------------------------------------------------
create index if not exists payment_transactions_reconcile_idx
  on payment_transactions (city_id, updated_at)
  where status in ('pending', 'past_due') and provider_transaction_id is not null;

-- ----------------------------------------------------------------------------
-- 2) record_payment_provider_reference — يحفظ معرّف عملية المزوّد مرّةً واحدة
--
--    لا يُغيّر الحالة ولا المبلغ ولا يُفعّل شيئاً: كتابةُ مرجعٍ فقط. والتفعيل يبقى
--    حقّ `confirm_payment` وحده بعد إعادة القراءة من خادم المزوّد.
-- ----------------------------------------------------------------------------
create or replace function record_payment_provider_reference(
  p_transaction_id uuid,
  p_provider text,
  p_provider_transaction_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx payment_transactions%rowtype;
begin
  if p_provider is null or btrim(p_provider) = '' then
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_REQUIRED');
  end if;
  if p_provider_transaction_id is null or btrim(p_provider_transaction_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_TRANSACTION_ID_REQUIRED');
  end if;

  select * into v_tx from payment_transactions where id = p_transaction_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_FOUND');
  end if;

  -- مزوّدٌ لا يملك الصفّ لا يكتب فيه مرجعاً: وإلا استطاع مزوّدٌ ثانٍ أن يجعل
  -- معاملتنا تُراجَع عنده فيُقرَّر مصيرُها من خادمٍ لم يُنشئها.
  if p_provider <> v_tx.provider then
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_MISMATCH');
  end if;

  if v_tx.provider_transaction_id is not null then
    -- نفس المرجع: المسار الطبيعي لإعادة المحاولة، لا خطأ.
    if v_tx.provider_transaction_id = p_provider_transaction_id then
      return jsonb_build_object('ok', true, 'transaction_id', v_tx.id,
        'provider_transaction_id', v_tx.provider_transaction_id, 'stored', false);
    end if;
    -- مرجعٌ ثانٍ مختلف يعني عمليتين عند المزوّد لمعاملةٍ واحدة. لا يُستبدل
    -- الأوّل بالثاني: استبداله يُخفي دفعةً حقيقية عن كل مراجعةٍ لاحقة.
    return jsonb_build_object('ok', false, 'error', 'PROVIDER_TRANSACTION_MISMATCH',
      'stored_provider_transaction_id', v_tx.provider_transaction_id);
  end if;

  -- معاملةٌ حُسم أمرها لا يُكتب لها مرجعٌ متأخّر: لا فائدة منه، وكتابته تُدخل
  -- صفّاً منتهياً في نطاق المراجعة.
  if v_tx.status not in ('pending', 'past_due') then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_PENDING',
      'status', v_tx.status);
  end if;

  update payment_transactions
     set provider_transaction_id = p_provider_transaction_id,
         updated_at = now()
   where id = p_transaction_id;

  return jsonb_build_object('ok', true, 'transaction_id', v_tx.id,
    'provider_transaction_id', p_provider_transaction_id, 'stored', true);
end;
$$;

revoke all on function record_payment_provider_reference(uuid, text, text) from public;
revoke all on function record_payment_provider_reference(uuid, text, text) from anon;
revoke all on function record_payment_provider_reference(uuid, text, text) from authenticated;

comment on function record_payment_provider_reference(uuid, text, text) is
  'يحفظ معرّف عملية المزوّد مرّةً واحدة لمعاملة معلّقة يملكها المزوّد نفسه؛ لا يغيّر حالةً ولا يُفعّل اشتراكاً.';

-- ----------------------------------------------------------------------------
-- 3) list_stale_pending_payments — نطاق المراجعة
--
--    ونطاقها مدينةٌ واحدة لا القاعدة كلّها: الحدّان الزمنيان يُقرآن من
--    `platform_settings` وهي مُفتاحة بالمدينة، فمراجعةٌ عامّة كانت ستطبّق إعداد
--    مدينةٍ على أخرى. والسقف كذلك يصير سقفاً لكل مدينة لا سقفاً تتسابق عليه.
--
--    حدّان لا حدٌّ واحد:
--      • `p_older_than_seconds`: لا تُراجَع دفعةٌ لم يمضِ عليها ما يكفي — السائق
--        قد يكون في صفحة الدفع الآن، والويبهوك في الطريق.
--      • `p_max_age_seconds`: لا تُراجَع دفعةٌ قديمة إلى حدٍّ يجعل رابطها منتهياً
--        عند المزوّد. مراجعتها استدعاءٌ متكرّرٌ إلى الأبد لصفٍّ لن يتغيّر.
-- ----------------------------------------------------------------------------
create or replace function list_stale_pending_payments(
  p_city_id uuid,
  p_older_than_seconds integer,
  p_max_age_seconds integer,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if p_city_id is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_ID_REQUIRED');
  end if;
  if p_older_than_seconds is null or p_older_than_seconds <= 0 then
    return jsonb_build_object('ok', false, 'error', 'OLDER_THAN_SECONDS_REQUIRED');
  end if;
  if p_max_age_seconds is null or p_max_age_seconds <= p_older_than_seconds then
    return jsonb_build_object('ok', false, 'error', 'MAX_AGE_MUST_EXCEED_OLDER_THAN');
  end if;
  if p_limit is null or p_limit <= 0 then
    return jsonb_build_object('ok', false, 'error', 'LIMIT_REQUIRED');
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.updated_at), '[]'::jsonb)
    into v_rows
    from (
      select id,
             city_id,
             payer_driver_id,
             provider,
             provider_transaction_id,
             amount_minor,
             currency,
             status,
             updated_at
        from payment_transactions
       where city_id = p_city_id
         and status in ('pending', 'past_due')
         and provider_transaction_id is not null
         and updated_at < now() - make_interval(secs => p_older_than_seconds)
         and updated_at > now() - make_interval(secs => p_max_age_seconds)
       order by updated_at
       limit p_limit
    ) t;

  return jsonb_build_object('ok', true, 'transactions', v_rows);
end;
$$;

revoke all on function list_stale_pending_payments(uuid, integer, integer, integer) from public;
revoke all on function list_stale_pending_payments(uuid, integer, integer, integer) from anon;
revoke all on function list_stale_pending_payments(uuid, integer, integer, integer) from authenticated;

comment on function list_stale_pending_payments(uuid, integer, integer, integer) is
  'يعدّ المعاملات المعلّقة التي لها معرّف مزوّد ومضى عليها ما يكفي ولم تتجاوز سقف العمر، لمراجعتها من خادم المزوّد.';
