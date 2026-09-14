-- migration-phase: expand
-- =============================================================================
-- `F2-12` · `SR-11` — الدعمُ والشكوى من داخلِ التطبيقِ **بمرجعِ تذكرةٍ**.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
-- ينتمي إلى: supabase/migrations
-- يحرسُه: tests/integration/rider-support-intake.test.ts ·
--          scripts/check-support-intake-contract.ts
-- الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
--
-- ## لِمَ مرجعٌ نصّيٌّ ولا يكفي `uuid`
--
-- نصُّ البندِ يقولُ «**مع مرجعِ تذكرةٍ**»، والمرجعُ الذي لا يُنطَقُ في هاتفٍ
-- ولا يُكتَبُ في رسالةٍ ليسَ مرجعاً: `3f2b9c81-…` **يُقرأُ خطأً ويُنقَلُ خطأً**.
-- فالمرجعُ `WSL-000042`: بادئةٌ ثابتةٌ ورقمٌ من تسلسلٍ، **بلا حرفٍ ملتبِسٍ**
-- ولا عشوائيّةٍ تُصادَمُ. **ولا يُشتَقُّ من `uuid`** لأنَّ اشتقاقَ نصٍّ قصيرٍ
-- من مئةٍ وثمانيةٍ وعشرينَ بتّاً تصادُمٌ مؤجَّلٌ يُكتشَفُ بعدَ سنةٍ.
--
-- **والمرجعُ ليسَ مفتاحاً**: `id` يبقى المفتاحَ الأساسيَّ وكلُّ المفاتيحِ
-- الأجنبيّةِ عليه بلا حرفٍ يُمَسُّ. والمرجعُ عمودٌ **يُعرَضُ** ويُبحَثُ به.
--
-- ## ولِمَ تُوسَّعُ الأصنافُ في النوعِ المعدودِ ولا يُزادُ عمودُ صنفٍ ثانٍ
--
-- `support_ticket_type` قائمٌ ويُقرأُ منه الدعمُ وبطاقةُ القروبِ ومُوجِّهُ
-- التذاكرِ. **وعمودُ صنفٍ ثانٍ بجوارِه مصدرُ حقيقةٍ مكرَّرٌ** يُسألُ أيُّهما
-- يَحكُمُ عندَ اختلافِهما. فتُضافُ أصنافُ الراكبِ إلى النوعِ نفسِه:
-- `lost_item` (مفقوداتٌ — منصوصةٌ في `SR-11` حرفاً) · `driver_conduct`
-- (سلوكُ سائقٍ) · `app_problem` (عطبُ تطبيقٍ) · `other` (أخرى).
-- **ولا تُستعمَلُ قيمةٌ منها في هذه الهجرةِ**: `alter type … add value` لا
-- يُقرأُ في المعاملةِ التي أضافَه (قيدُ PostgreSQL)، فالاستعمالُ في زمنِ
-- التشغيلِ لا في الهجرةِ.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ
--
--   ــ **لا تُنشئُ جدولاً** فلا سؤالَ عن `city_id` جديدٍ (القاعدة 0.4):
--      `support_tickets` يحملُه `not null` منذُ ٢٠٢٦٠٨٠٧.
--   ــ **لا تُكرِّرُ منطقَ `open_support_ticket`**: التهدئةُ ومِلكيّةُ الطلبِ
--      والحظرُ وقروبُ المدينةِ وسجلُّ التدقيقِ كلُّها فيها منذُ المرحلةِ ٢٫٤،
--      **وتُستبدَلُ لتقولَ المرجعَ فحسب** — سطرٌ في `returning` وسطرٌ في
--      الجوابِ، ولا حرفَ في حكمٍ.
--   ــ **لا تلمسُ الأجرةَ ولا الإيصالَ** (`ADR 0039` §٤ · `DEC-11`).
--   ــ **لا تضعُ قيمةً تجاريّةً في الشِفرةِ** (القاعدة 0.3): زمنُ الاستجابةِ
--      المتوقَّعُ إعدادٌ لكلِّ مدينةٍ `is_provisional = true`.
--   ــ **لا `set not null`** على العمودِ الجديدِ (قفلٌ حاجزٌ ممنوعٌ في
--      `CAP-007`): الحضورُ يُفرَضُ بقيدٍ `not valid` يُصدَّقُ في طورِ
--      `validate`، والافتراضيُّ يملأُه لكلِّ صفٍّ جديدٍ.
-- =============================================================================

-- ── ١) أصنافُ الراكبِ الأربعةُ ────────────────────────────────────────────
-- `if not exists` يجعلُ العبارةَ idempotent، فإعادةُ التطبيقِ بلا أثرٍ.
alter type support_ticket_type add value if not exists 'lost_item';
alter type support_ticket_type add value if not exists 'driver_conduct';
alter type support_ticket_type add value if not exists 'app_problem';
alter type support_ticket_type add value if not exists 'other';

-- ── ٢) المرجعُ: تسلسلٌ وبادئةٌ ─────────────────────────────────────────────
-- التسلسلُ **لا يُعادُ استعمالُه** حتّى عندَ تراجُعِ معاملةٍ، وهذا مقصودٌ:
-- ثقبٌ في الترقيمِ أهونُ من مرجعَينِ لتذكرتَينِ. والعرضُ `WSL-` ثمَّ ستُّ
-- خاناتٍ بحدٍّ أدنى، ويطولُ من نفسِه بعدَ المليونِ بلا هجرةٍ ثانيةٍ.
create sequence if not exists support_ticket_reference_seq as bigint start with 1;

alter table support_tickets
  add column if not exists reference text
  default 'WSL-' || lpad(nextval('support_ticket_reference_seq')::text, 6, '0');

comment on column support_tickets.reference is
  'مرجعُ التذكرةِ المنطوقُ (`WSL-000042`) — يُعرَضُ للإنسانِ ويُبحَثُ بهِ، ولا يُستعمَلُ مفتاحاً (`ADR 0114`).';

-- الحضورُ قيداً لا `not null`: القفلُ الحاجزُ ممنوعٌ خارجَ طورِ `contract`،
-- والقيدُ `not valid` لا يفحصُ الصفوفَ القائمةَ فلا يحجبُ كتابةً.
do $$ begin
  alter table support_tickets
    add constraint support_tickets_reference_present
    check (reference is not null) not valid;
exception when duplicate_object then null; end $$;

-- ── ٣) زمنُ الاستجابةِ المتوقَّعُ — إعدادٌ لا رقمٌ في شِفرةٍ ────────────────
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, s.key, s.value, s.value_type, s.description_ar, s.is_provisional
  from cities c
 cross join (values
   ('support_expected_response_minutes', '120'::jsonb, 'number',
    'الزمنُ المتوقَّعُ لأوّلِ ردٍّ على تذكرةِ دعمٍ بالدقائقِ — يُعرَضُ للمستخدمِ', true)
 ) as s(key, value, value_type, description_ar, is_provisional)
 on conflict (city_id, key) do nothing;

-- ── ٤) `open_support_ticket` تقولُ المرجعَ ─────────────────────────────────
-- **منقولةٌ حرفاً عن النسخةِ القائمةِ في `20260813000000`** ولا حرفَ في حكمٍ:
-- الفرقُ `returning id, reference` وسطرُ `'reference'` في الجوابِ. ولو نُسِخَ
-- المنطقُ إلى دالّةٍ ثانيةٍ للراكبِ لَصارَ للتهدئةِ حكمانِ يفترقانِ بعدَ شهرٍ.
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
  if p_type = 'subscription' and v_driver_id is null then
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
  'تفتحُ تذكرةَ دعمٍ وتُعيدُ **مرجعَها المنطوقَ** معَ قروبِ مدينتِها. حكمُها كما كانَ منذُ المرحلةِ ٢٫٤ ولا حرفَ فيهِ تغيَّرَ (`ADR 0114`).';

revoke execute on function public.open_support_ticket(bigint, support_ticket_type, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.open_support_ticket(bigint, support_ticket_type, text, text, uuid)
  to service_role;

-- ── ٥) `rider_support_tickets` — «تذاكري وحالاتُها» ───────────────────────
-- **ترقيمُ مفتاحٍ لا إزاحةٍ** لعِلَّةِ `ADR 0108`: الإزاحةُ تُكرِّرُ صفّاً
-- وتُسقِطُ آخرَ بصمتٍ عندَ كتابةٍ بينَ صفحتَينِ. والمؤشِّرُ `(created_at, id)`
-- يمرُّ نصّاً كما نطقَت بهِ القاعدةُ.
--
-- **والمِلكيّةُ قيدُ استعلامٍ لا فحصٌ بعدَ القراءةِ**: صفوفُ غيرِ صاحبِها لا
-- تُقرأُ أصلاً، فلا يُنسى فحصٌ في مسارٍ ثانٍ.
--
-- **ولا رسالةَ الدعمِ الكاملةَ ولا قرارَ الحلِّ يُعادانِ ههنا**؟ بلى يُعادانِ:
-- هُما بيانةُ صاحبِها يقرؤها في تذكرتِه، **ولا يُعادُ مَن استلمَ ولا مَن حلَّ**
-- — أسماءُ موظّفينَ ليسَت بيانةَ الراكبِ ولا حاجةَ له بها.
create or replace function public.rider_support_tickets(
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
  v_rider_id uuid;
  v_limit integer;
  v_rows jsonb;
  v_count integer;
  v_expected integer;
begin
  -- الحدُّ يُرَدُّ خارجاً لا يُقصَرُ صامتاً (درسُ `F2-08`): طالبُ ألفِ صفٍّ
  -- يُجابُ بعطبٍ يُقرأُ لا بعشرينَ صفّاً يظنُّها ألفاً.
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

  select id into v_rider_id from riders where user_id = v_user.id;
  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_RIDER');
  end if;

  -- **`get_setting` لا `get_setting_number`** عن قصدٍ: الثانيةُ تُطلِقُ
  -- `MISSING_SETTING` فتُسقِطُ القراءةَ كلَّها. وزمنُ الاستجابةِ **قيمةُ عرضٍ**
  -- لا حكمٌ؛ فمدينةٌ فُعِّلَت ولم يُوضَعْ لها الإعدادُ بعدُ تُظهِرُ تذاكرَ
  -- صاحبِها بلا سطرِ زمنٍ — ولا تُحجَبُ تذاكرُه لأجلِ سطرٍ إعلاميٍّ.
  -- وأمّا التهدئةُ فتبقى على `get_setting_number` في `open_support_ticket`:
  -- إعدادٌ **حاكمٌ** غيابُه يجبُ أن يُسقِطَ الفعلَ لا أن يُفتَرَضَ صفراً.
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
     where t.rider_id = v_rider_id
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

comment on function public.rider_support_tickets(bigint, integer, timestamptz, uuid) is
  'صفحةُ تذاكرِ الراكبِ بمرجعِها وحالتِها **بترقيمِ مفتاحٍ لا إزاحةٍ**، والمِلكيّةُ قيدُ استعلامٍ (`ADR 0114`).';

revoke execute on function public.rider_support_tickets(bigint, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.rider_support_tickets(bigint, integer, timestamptz, uuid)
  to service_role;
