-- migration-phase: expand
-- =============================================================================
-- `F3-08` · `SD-10` — **حكمُ أصنافِ السائقِ وقراءةُ تذاكرِه** في المحرِّكِ.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F3-08` (الزيادةُ `S-2` في حجزِ `ROADMAP.md`).
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/support/driver-support-store.ts` عبرَ
--   `apps/gateway/src/routes/support-tickets.ts`
-- يحرسُه: tests/integration/driver-support-intake.test.ts ·
--   scripts/check-driver-support-account-contract.ts
-- الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
--
-- ## لِمَ ملفٌّ ثانٍ ولا سطرٌ في الأوّلِ
--
-- الملفُّ `…010000` أضافَ ثلاثَ قيمٍ إلى `support_ticket_type`، وPostgreSQL **لا
-- يقرأُ قيمةً أُضيفَت في المعاملةِ نفسِها**، و`scripts/migrate.ts` يُطبِّقُ كلَّ
-- ملفٍّ في معاملةٍ واحدةٍ. فالحكمُ بها يقعُ ههنا **أو لا يقعُ أبداً**.
--
-- ## ولِمَ يُوسَّعُ `open_support_ticket` ولا تُنشَأُ دالّةُ فتحٍ للسائقِ
--
-- الدالّةُ القائمةُ **لا دورَ في توقيعِها**: تستنبطُ `driver_id` و`rider_id` من
-- صفِّ صاحبِ الحسابِ، وتحكمُ التهدئةَ والحظرَ ومِلكيّةَ الطلبِ وقروبَ المدينةِ
-- وتكتبُ سجلَّ التدقيقِ. ودالّةُ فتحٍ ثانيةٌ للسائقِ تعني **حكمَينِ للتهدئةِ**
-- يفترقانِ بعدَ شهرٍ، وسجلَّ تدقيقٍ ينقصُ في أحدِهما. **فالزيادةُ سطرُ حكمٍ
-- واحدٌ**: أصنافُ السائقِ الأربعةُ تُردُّ لمَن لا صفَّ سائقٍ لهُ.
--
-- **والحكمُ القائمُ لم يُنقَصْ حرفاً** (`ح-8`): `p_type = 'subscription'` كانَ
-- يُردُّ بـ`NOT_A_DRIVER`، وصارَ ذلكَ **حالةً من أربعٍ** بالمنطقِ نفسِه والرمزِ
-- نفسِه — فمَن كانَ يُردُّ يُردُّ، ولا سبيلَ جديدَ لقبولٍ كانَ مرفوضاً.
--
-- ## ولِمَ لا يُشتَرَطُ صفُّ راكبٍ لأصنافِ الراكبِ في المقابلِ
--
-- لأنَّ ذاكَ **تشديدٌ على سلوكٍ قائمٍ** لا زيادةٌ عليه: اليومَ يفتحُ صاحبُ حسابٍ
-- مُسجَّلٌ (سائقاً أو راكباً) `lost_item` وتُقبَلُ. ومنعُ ذلكَ الآنَ يُغيِّرُ
-- جواباً كانَ ناجحاً — وهذا خارجَ حجزِ `F3-08` (`ح-8`). **وإغلاقُ المجالِ في
-- الطبقةِ كافٍ للعرضِ**: سطحُ السائقِ لا يعرضُ إلّا أصنافَه، وسطحُ الراكبِ لا
-- يعرضُ إلّا أصنافَه، والقاعدةُ تحرسُ **ما لا يُقبَلُ منهُ ضرراً** لا ما يُعرَضُ
-- ذوقاً. ومِلكيّةُ الطلبِ محروسةٌ أصلاً بـ`ORDER_NOT_YOURS` للطرفَينِ.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تُنشئُ جدولاً ولا عموداً**: `support_tickets` يحملُ `driver_id`
--      و`city_id` و`reference` منذُ ما قبلَها.
--   ــ **لا تُعيدُ اسمَ موظّفٍ**: مَن استلمَ ومَن حلَّ ليسا بيانةَ السائقِ —
--      كما في قراءةِ الراكبِ حرفاً.
--   ــ **لا تُعيدُ هويّةَ راكبٍ**: `order_id` يُعادُ، **ولا اسمَ ولا هاتفَ ولا
--      معرِّفَ تلغرامَ** — تذكرةُ «راكبٌ مسيءٌ» تُقرأُ من السائقِ بمعرِّفِ رحلتِها
--      لا بسجلٍّ عن إنسانٍ.
--   ــ **لا تكتبُ شيئاً في القراءةِ**: `stable` لا `volatile`.
--   ــ **لا تضعُ رقمَ عملٍ في الشِّفرةِ** (القاعدة 0.3): زمنُ الاستجابةِ يُقرأُ
--      بـ`get_setting` — **لا `get_setting_number`** — فمدينةٌ بلا الإعدادِ
--      تُظهِرُ تذاكرَ صاحبِها بلا سطرِ زمنٍ ولا تُحجَبُ كلُّها لأجلِ سطرٍ
--      إعلاميٍّ (العِلَّةُ نفسُها المكتوبةُ في قراءةِ الراكبِ).
--   ــ **لا تُخفِّفُ شرطَ قراءةِ الراكبِ**: `rider_support_tickets` لم تُمَسَّ،
--      و`NOT_A_RIDER` فيها كما هوَ. الحلُّ **نظيرٌ يُزادُ** لا شرطٌ يُنزَعُ.
-- =============================================================================

-- ── ١) الفتحُ: أصنافُ السائقِ تُردُّ لمَن ليسَ سائقاً ──────────────────────
-- **منقولةٌ حرفاً عن نسخةِ `20260914220000`** ولا حرفَ في حكمٍ آخرَ: الفرقُ
-- الوحيدُ أنَّ شرطَ `subscription` صارَ `p_type = any(...)` بأربعِ قيمٍ.
create or replace function public.open_support_ticket(
  p_telegram_id bigint,
  p_type support_ticket_type,
  p_message text,
  p_file_id text default null::text,
  p_order_id uuid default null::uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user users%rowtype;
  v_driver_id uuid;
  v_rider_id uuid;
  v_city_id uuid;
  v_cooldown integer;
  v_last timestamptz;
  v_group bigint;
  v_id uuid;
  v_reference text;
begin
  if p_message is null or btrim(p_message) = '' then
    return jsonb_build_object('ok', false, 'error', 'MESSAGE_EMPTY');
  end if;

  select * into v_user from users where telegram_id = p_telegram_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'USER_BLOCKED');
  end if;

  select id into v_driver_id from drivers where user_id = v_user.id;
  select id into v_rider_id from riders where user_id = v_user.id;
  if v_driver_id is null and v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_REGISTERED');
  end if;
  -- أصنافُ السائقِ الأربعةُ (`SD-10`): اشتراكٌ · خصمٌ · راكبٌ مسيءٌ · مركبةٌ.
  -- والقائمةُ **مكتوبةٌ ههنا مرّةً** ويُقابِلُها مجالٌ مغلقٌ في طبقةِ التطبيقِ،
  -- وحاجزٌ ساكنٌ يمنعُ افتراقَهما.
  if p_type = any (array['subscription', 'deduction', 'rider_conduct', 'vehicle']::support_ticket_type[])
     and v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  v_city_id := v_user.city_id;

  select telegram_support_group_id into v_group from cities where id = v_city_id;
  if v_group is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_GROUP_MISSING');
  end if;

  v_cooldown := get_setting_number(v_city_id, 'support_ticket_cooldown_seconds')::integer;
  if v_cooldown > 0 then
    select max(created_at) into v_last
      from support_tickets
     where (driver_id is not null and driver_id = v_driver_id)
        or (rider_id is not null and rider_id = v_rider_id);
    if v_last is not null and v_last > now() - make_interval(secs => v_cooldown) then
      return jsonb_build_object(
        'ok', false,
        'error', 'COOLDOWN_ACTIVE',
        'retry_after_seconds',
          ceil(extract(epoch from (v_last + make_interval(secs => v_cooldown)) - now()))::integer
      );
    end if;
  end if;

  if p_order_id is not null then
    if not exists (
      select 1 from orders o
       where o.id = p_order_id
         and (o.rider_id = v_rider_id or o.assigned_driver_id = v_driver_id)
    ) then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_YOURS');
    end if;
  end if;

  insert into support_tickets
    (city_id, type, driver_id, rider_id, order_id, message, attachment_file_id)
  values
    (v_city_id, p_type, v_driver_id, v_rider_id, p_order_id, btrim(p_message),
     nullif(btrim(coalesce(p_file_id, '')), ''))
  returning id, reference into v_id, v_reference;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_city_id, v_user.id, 'support.ticket_opened', 'support_ticket', v_id,
          jsonb_build_object('type', p_type, 'has_attachment', p_file_id is not null));

  return jsonb_build_object(
    'ok', true,
    'ticket_id', v_id,
    'reference', v_reference,
    'city_id', v_city_id,
    'group_id', v_group,
    'type', p_type
  );
end;
$function$;

comment on function public.open_support_ticket(bigint, support_ticket_type, text, text, uuid) is
  'تفتحُ تذكرةَ دعمٍ وتُعيدُ **مرجعَها المنطوقَ** معَ قروبِ مدينتِها. حكمُها كما كانَ، وأصنافُ السائقِ الأربعةُ تُردُّ لمَن ليسَ سائقاً (`ADR 0114` · `SD-10`).';

revoke execute on function public.open_support_ticket(bigint, support_ticket_type, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.open_support_ticket(bigint, support_ticket_type, text, text, uuid)
  to service_role;

-- ── ٢) `driver_support_tickets` — «تذاكري وحالاتُها» للسائقِ ───────────────
-- **نظيرُ قراءةِ الراكبِ** في شكلِ الجوابِ وترقيمِه ورموزِ رفضِه، والفرقُ
-- المقصودُ اثنانِ: `driver_id` قيدُ الاستعلامِ، و`NOT_A_DRIVER` رمزُ الرفضِ.
-- **وترقيمُ مفتاحٍ لا إزاحةٍ** (`ADR 0108`): الإزاحةُ تُكرِّرُ صفّاً وتُسقِطُ
-- آخرَ بصمتٍ عندَ كتابةٍ بينَ صفحتَينِ.
--
-- **والمِلكيّةُ قيدُ استعلامٍ لا فحصٌ بعدَ القراءةِ**: صفوفُ غيرِ صاحبِها لا
-- تُقرأُ أصلاً، فلا يُنسى فحصٌ في مسارٍ ثانٍ.
create or replace function public.driver_support_tickets(
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
  v_expected integer;
begin
  -- الحدُّ يُرَدُّ خارجاً لا يُقصَرُ صامتاً (درسُ `F2-08`).
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    return jsonb_build_object('ok', false, 'error', 'LIMIT_OUT_OF_RANGE');
  end if;
  v_limit := p_limit;

  -- مؤشِّرٌ نصفُه ليسَ مؤشِّراً: شطرٌ بلا شطرٍ يُنتِجُ صفحةً غيرَ حتميّةٍ.
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

  -- **`get_setting` لا `get_setting_number`** عن قصدٍ: زمنُ الاستجابةِ قيمةُ
  -- عرضٍ لا حكمٌ، وغيابُه لا يحجبُ تذاكرَ صاحبِها.
  v_expected := nullif(get_setting(v_user.city_id, 'support_expected_response_minutes') #>> '{}', '')::integer;

  with page as (
    select t.id,
           t.reference,
           t.type::text        as type,
           t.status::text      as status,
           t.message,
           t.resolution,
           t.order_id,
           t.created_at,
           t.resolved_at
      from support_tickets t
     where t.driver_id = v_driver_id
       and (
         p_before_created_at is null
         or (t.created_at, t.id) < (p_before_created_at, p_before_id)
       )
     order by t.created_at desc, t.id desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc), '[]'::jsonb),
         count(*)::integer
    into v_rows, v_count
    from page p;

  return jsonb_build_object(
    'ok', true,
    'expected_response_minutes', v_expected,
    -- «مزيدٌ» يُعرَفُ بصفٍّ زائدٍ قُرِئَ ولا يُعادُ — لا بعدٍّ ثانٍ للجدولِ.
    'has_more', v_count > v_limit,
    'next_cursor',
      case when v_count > v_limit then jsonb_build_object(
        'created_at', (v_rows -> (v_limit - 1) -> 'created_at'),
        'id',         (v_rows -> (v_limit - 1) -> 'id')
      ) else null end,
    'tickets', case when v_count > v_limit
                    then (select jsonb_agg(e) from jsonb_array_elements(v_rows) with ordinality as x(e, i) where i <= v_limit)
                    else v_rows end
  );
end;
$function$;

comment on function public.driver_support_tickets(bigint, integer, timestamptz, uuid) is
  'صفحةُ تذاكرِ السائقِ بمرجعِها وحالتِها **بترقيمِ مفتاحٍ لا إزاحةٍ**، والمِلكيّةُ قيدُ استعلامٍ، و`NOT_A_DRIVER` لمَن ليسَ سائقاً (`ADR 0114` · `SD-10`).';

revoke execute on function public.driver_support_tickets(bigint, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.driver_support_tickets(bigint, integer, timestamptz, uuid)
  to service_role;
