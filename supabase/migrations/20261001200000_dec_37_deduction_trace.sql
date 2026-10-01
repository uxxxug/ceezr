-- migration-phase: expand
-- ────────────────────────────────────────────────────────────────────────────
-- DEC-37 · تنشيطُ دَينٍ مُعلَنٍ: كشفُ الخصومِ التفصيليُّ (`driver.support.debt.deductionTrace`)
--
-- الغرض: دالّةٌ تُعيدُ سجلَّ الخصومِ (مُدخَلاتُ المحفظةِ باتّجاهِ `debit`)
--   للسائقِ — مرجعُ كلِّ خصمٍ ونوعُه ومبلغُه وسبَبُه وزمنُه. **قراءةٌ فقط**:
--   لا تُنشئُ قيداً ولا تُعكسُ تلقائياً — الاعتراضُ بلاغٌ يراجعه إنسانٌ
--   (`PD-041` · `ADR 0161`).
--
-- المصدر: `subscription_wallet_entries` بشرطِ `direction = 'debit'` — لا
--   `support_tickets`، فتلكَ للاعتراضاتِ لا للخصومِ.
--
-- الحاكم: `ADR 0161` — سطحُ المالِ للسائقِ، ولا تكرارَ لرقمٍ ماليٍّ في
--   شاشتَينِ.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.driver_deduction_trace(
  p_telegram_id bigint,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user users%rowtype;
  v_driver_id uuid;
  v_limit integer;
  v_rows jsonb;
  v_count integer;
begin
  -- الحدُّ يُرَدُّ خارجاً لا يُقصَرُ صامتاً (درسُ `F2-08`).
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    return jsonb_build_object('ok', false, 'error', 'LIMIT_OUT_OF_RANGE');
  end if;
  v_limit := p_limit;

  -- شطرٌ بلا شطرٍ ليسَ مؤشِّراً: صفحةٌ غيرُ حتميّةٍ (`ADR 0108`).
  if (p_before_created_at is null) <> (p_before_id is null) then
    return jsonb_build_object('ok', false, 'error', 'CURSOR_INCOMPLETE');
  end if;

  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select id into v_driver_id from drivers where user_id = v_user.id;
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  with page as (
    select e.id,
           e.reference,
           e.entry_kind,
           e.amount_minor,
           e.currency,
           e.reason,
           e.created_at
      from subscription_wallet_entries e
     where e.driver_id = v_driver_id
       and e.direction = 'debit'
       and (
         p_before_created_at is null
         or (e.created_at, e.id) < (p_before_created_at, p_before_id)
       )
     order by e.created_at desc, e.id desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc), '[]'::jsonb),
         count(*)::integer
    into v_rows, v_count
    from page p;

  return jsonb_build_object(
    'ok', true,
    'has_more', v_count > v_limit,
    'next_cursor',
      case when v_count > v_limit then jsonb_build_object(
        'created_at', (v_rows -> (v_limit - 1) -> 'created_at'),
        'id',         (v_rows -> (v_limit - 1) -> 'id')
      ) else null end,
    'deductions', case when v_count > v_limit
                    then (select jsonb_agg(e) from jsonb_array_elements(v_rows) with ordinality as x(e, i) where i <= v_limit)
                    else v_rows end
  );
end;
$function$;

comment on function public.driver_deduction_trace(bigint, integer, timestamptz, uuid) is
  'صفحةُ خصومِ السائقِ من سجلِّ المحفظةِ بترقيمِ مفتاحٍ لا إزاحةٍ، والملكيّةُ قيدُ استعلامٍ، و`NOT_A_DRIVER` لمَن ليسَ سائقاً (`DEC-37` · `PD-041` · `ADR 0161`).';

revoke execute on function public.driver_deduction_trace(bigint, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.driver_deduction_trace(bigint, integer, timestamptz, uuid)
  to service_role;
