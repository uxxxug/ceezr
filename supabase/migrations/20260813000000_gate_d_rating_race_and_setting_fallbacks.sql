-- ==========================================================================
-- الغرض: إصلاح خمسة عيوب أثبتتها بوابة D (الفحص اليدويّ لدالّات PL/pgSQL) في
--   أمر الإغلاق الشامل. لكلٍّ منها دليل حرفيّ في
--   docs/evidence/gate-d-rating-race-20260813.txt
--
--   (١) سباق «فحص-ثم-كتابة بلا قفل» في submit_rating. كانت الدالّة تُدرج التقييم
--       ثم تُعيد حساب متوسط الطرف المُقيَّم عبر `update ... from (select avg(...))`
--       بلا قفل على صفّه. راكبان يقيّمان السائق نفسه على طلبين مختلفين في اللحظة
--       نفسها ⇒ كلٌّ يحسب المتوسط في لقطته الخاصة، فيكتب الثاني فوق الأول ويضيع
--       تقييم كامل من الرقم المعروض. أُثبِت تجريبياً بجلستَي psql متزامنتين:
--       المُخزَّن 1.00 من تقييم واحد، والحقيقة في جدول ratings 3.00 من تقييمين.
--       وأثره ليس تجميلياً: §4.3 من أمر المالك يجعل السمعة رادع العبث، ورقمٌ
--       يضيع منه نصف التقييمات لا يردع، بل يظلم سائقاً حُسِب له أسوأ تقييميه.
--
--   (٢) الحساب الفوريّ في submit_rating كان يجمع تقييمات المستخدم بلا تمييز
--       اتجاه، بينما المهمة الدورية recompute_rating_averages تفلتر بالاتجاه.
--       فمستخدمٌ هو سائق وراكب في آن (وهو ممكن: نفس صفّ users يحمل كلا الدورين
--       عبر جدولَي drivers و riders) كان متوسطه كسائق يتلوّث بتقييمه كراكب، ثم
--       يتغيّر الرقم من تلقاء نفسه عند أول تشغيل للمهمة الدورية. مصدرا حقيقة
--       متضاربان لنفس البيانات.
--
--   (٣) flag_rating يشطب تقييماً (is_flagged = true) ثم لا يُعيد حساب المتوسط،
--       فيبقى الرقم المعروض محتسِباً تقييماً مشطوباً إلى أن تمرّ المهمة الدورية.
--       أي أن قرار الشطب — وغرضه كلّه رفع أثر تقييم عابث — كان بلا أثر فوريّ.
--
--   (٤) قيمتان تجاريّتان مرمَّزتان ظاهرياً كبديل عند غياب صفّ الإعداد:
--         coalesce(get_setting_number(city,'rating_prompt_window_hours'), 48)
--         coalesce(get_setting_number(city,'support_ticket_cooldown_seconds'), 0)
--
--       تصحيح لتشخيصٍ أوّليٍّ خاطئ منّي، أُثبت خطؤه بالتشغيل لا بالقراءة: ظننتُ
--       هذين بديلَين صامتَين يخترعان سياسةً عند غياب الإعداد — وأخطرهما الثاني،
--       إذ صفرُ ثانية يعني إلغاء حماية الإساءة كلّها. ثم أظهر التشغيل الفعليّ أن
--       `get_setting_number` تُطلق `raise exception 'MISSING_SETTING:%'` عند غياب
--       الصفّ ولا تُعيد NULL قطّ، فذراع البديل في `coalesce` غير قابلة للوصول
--       أصلاً. أي أن الخطر المزعوم لا وجود له، ولا سلوك يتغيّر بهذه الهجرة.
--
--       فما بقي عيباً؟ رقمان تجاريّان مكتوبان في الكود يقرأهما المراجع فيظنّ
--       السياسة 48 ساعة وصفر ثانية، وهما لا يُنفَّذان. وتوثيقٌ كاذب أسوأ من غيابه:
--       يُطمئن مراجعاً إلى بديلٍ آمن غير موجود، ويُخفي عنه أن غياب الإعداد يُسقط
--       المسار باستثناءٍ لا برقمٍ بديل. فالعلاج إزالة غلاف `coalesce` الميت ليقول
--       الكود ما يفعله. والفارق الفعليّ في السلوك: صفر.
--
--   (٥) close_admin_session كان يُدرج صفّ تدقيق «أُغلقت الجلسة» حتى إن لم يُغلق
--       شيئاً فعلاً: إغلاقان متزامنان لنفس الرمز ⇒ صفّا تدقيق لحدث واحد، وسجلّ
--       تدقيق يروي ما لم يحدث. وهو يقرأ الصفّ بلا قفل ثم يكتب — نفس نمط العيب.
--
-- الحالة: هجرة إصلاح فعليّ — بوابة D، 2026-08-13.
-- ينتمي إلى: supabase/migrations
-- لا حذف: لا تُحذف دالّة ولا يُسقط جدول؛ كل التعديل عبر create or replace.
-- قابلة لإعادة التنفيذ بالكامل.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- دالّة مشتركة: إعادة حساب متوسط طرف واحد، بقفل صفّه قبل قراءة تقييماته.
-- القفل قبل القراءة لا بعدها: عند READ COMMITTED تأخذ كل عبارة لقطةً جديدة،
-- فمن ينتظر على `for update` يقرأ — بعد تحرّر القفل — حالةً تضمّ إدراج منافسه
-- المُتمّ. فيصير التسلسل محتوماً داخل القاعدة بلا منطق تزامن في طبقة التطبيق.
-- ووجودها في موضع واحد يمنع عودة التضارب بين مسار فوريّ ومسار دوريّ.
-- --------------------------------------------------------------------------
create or replace function public.recompute_ratee_averages(
  p_ratee_user_id uuid,
  p_direction rating_direction
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_avg   numeric(3,2);
  v_total integer;
begin
  if p_direction = 'rider_to_driver' then
    perform 1 from drivers where user_id = p_ratee_user_id for update;
  else
    perform 1 from riders where user_id = p_ratee_user_id for update;
  end if;

  -- من لا تقييم له يعود إلى NULL لا إلى صفر: الصفر تقييم سيّئ، والغياب ليس تقييماً.
  select round(avg(stars)::numeric, 2), count(*)::integer
    into v_avg, v_total
    from ratings
   where ratee_user_id = p_ratee_user_id
     and is_flagged = false
     and direction = p_direction;

  if p_direction = 'rider_to_driver' then
    update drivers set rating_average = v_avg, rating_count = coalesce(v_total, 0)
     where user_id = p_ratee_user_id;
  else
    update riders set rating_average = v_avg, rating_count = coalesce(v_total, 0)
     where user_id = p_ratee_user_id;
  end if;
end;
$function$;

revoke all on function public.recompute_ratee_averages(uuid, rating_direction) from public;

-- --------------------------------------------------------------------------
-- submit_rating — منقولة حرفياً عن النسخة القائمة، بثلاثة فروق فقط:
--   • نافذة التقييم تُقرأ من الإعداد بلا غلاف `coalesce` ميت (عيب ٤): غياب
--     الإعداد كان — ولا يزال — يُسقط النداء باستثناء MISSING_SETTING.
--   • إعادة الحساب تمرّ عبر recompute_ratee_averages المقفولة (عيبا ١ و٢).
--   • لا شيء غير ذلك: نفس رموز الأخطاء ونفس شكل الناتج، فلا يتغيّر أي متعامل.
-- --------------------------------------------------------------------------
create or replace function public.submit_rating(
  p_order_id uuid,
  p_rater_telegram_id bigint,
  p_stars smallint,
  p_comment text default null::text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order     orders%rowtype;
  v_rater     users%rowtype;
  v_driver    drivers%rowtype;
  v_rider     riders%rowtype;
  v_driver_u  users%rowtype;
  v_rider_u   users%rowtype;
  v_direction rating_direction;
  v_ratee     uuid;
  v_window    numeric;
  v_now       timestamptz := now();
  v_rating_id uuid;
begin
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    return jsonb_build_object('ok', false, 'error', 'STARS_OUT_OF_RANGE');
  end if;

  select * into v_rater from users where telegram_id = p_rater_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'RATER_NOT_FOUND');
  end if;

  select * into v_order from orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  if v_order.status <> 'completed' then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_COMPLETED');
  end if;

  select * into v_driver from drivers where id = v_order.assigned_driver_id;
  select * into v_driver_u from users where id = v_driver.user_id;
  select * into v_rider from riders where id = v_order.rider_id;
  select * into v_rider_u from users where id = v_rider.user_id;

  -- الاتجاه يُستنتج من هوية المُقيِّم لا يُمرَّر من الخارج: من ليس طرفاً في الرحلة لا يقيّمها
  if v_rater.id = v_rider_u.id then
    v_direction := 'rider_to_driver';
    v_ratee := v_driver_u.id;
  elsif v_rater.id = v_driver_u.id then
    v_direction := 'driver_to_rider';
    v_ratee := v_rider_u.id;
  else
    return jsonb_build_object('ok', false, 'error', 'RATER_NOT_PARTY_TO_ORDER');
  end if;

  -- بلا رقم مرمَّز: get_setting_number تُطلق MISSING_SETTING عند غياب الصفّ،
  -- فإعدادٌ غائب خطأ تشغيليّ يُعلَن، لا سياسةٌ تُخترع في القاعدة.
  v_window := get_setting_number(v_order.city_id, 'rating_prompt_window_hours');
  if v_order.completed_at + make_interval(hours => v_window::integer) < v_now then
    return jsonb_build_object('ok', false, 'error', 'RATING_WINDOW_CLOSED');
  end if;

  begin
    insert into ratings (city_id, order_id, direction, rater_user_id, ratee_user_id,
                         stars, comment)
    values (v_order.city_id, p_order_id, v_direction, v_rater.id, v_ratee,
            p_stars, nullif(btrim(coalesce(p_comment, '')), ''))
    returning id into v_rating_id;
  exception when unique_violation then
    -- القيد الفريد هو الحكم، لا فحص سابق في التطبيق: لا سباق ولا تقييم مكرَّر
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RATED');
  end;

  -- التحديث فوري ليُثمر التقييم في المطابقة التالية مباشرة، والمهمة الدورية
  -- تعيد الحساب من المصدر لتصحّح أي انحراف تراكمي. القفل داخل الدالّة المشتركة.
  perform recompute_ratee_averages(v_ratee, v_direction);

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_rater.id, 'rating.submitted', 'rating', v_rating_id,
          jsonb_build_object('order_id', p_order_id, 'direction', v_direction,
                             'stars', p_stars, 'ratee_user_id', v_ratee));

  return jsonb_build_object('ok', true, 'rating_id', v_rating_id,
                            'direction', v_direction, 'stars', p_stars);
end;
$function$;

-- --------------------------------------------------------------------------
-- flag_rating — نفس المنطق والصلاحيات ورموز الأخطاء حرفياً، مضافاً إليه أثر
-- الشطب الفوريّ (عيب ٣)، ومُضافاً إلى صفّ التدقيق مَن تضرَّر واتجاه التقييم
-- كي يكون سجلّ التدقيق كافياً للمراجعة البشرية بلا استعلام ثانٍ.
-- --------------------------------------------------------------------------
create or replace function public.flag_rating(
  p_rating_id uuid,
  p_actor_telegram_id bigint
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rating ratings%rowtype;
  v_actor  users%rowtype;
begin
  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_FOUND');
  end if;
  if v_actor.role not in ('admin', 'support') then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_AUTHORIZED');
  end if;

  update ratings set is_flagged = true
   where id = p_rating_id and is_flagged = false
   returning * into v_rating;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'RATING_NOT_FLAGGABLE');
  end if;

  -- أثر الشطب فوريّ: بلا هذه الخطوة يبقى الرقم المعروض محتسِباً تقييماً مشطوباً
  -- إلى أن تمرّ المهمة الدورية، فيُحرَم المتضرِّر من أثر قرارٍ اتُّخذ لصالحه.
  perform recompute_ratee_averages(v_rating.ratee_user_id, v_rating.direction);

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_rating.city_id, v_actor.id, 'rating.flagged', 'rating', p_rating_id,
          jsonb_build_object('order_id', v_rating.order_id, 'stars', v_rating.stars,
                             'ratee_user_id', v_rating.ratee_user_id,
                             'direction', v_rating.direction));

  return jsonb_build_object('ok', true, 'rating_id', p_rating_id);
end;
$function$;

-- --------------------------------------------------------------------------
-- open_support_ticket — منقولة حرفياً عن النسخة القائمة (بما فيها القفل
-- `for update` على صفّ المستخدم الذي أصلح سباق التهدئة سابقاً)، بفرقين:
--   • مدّة التهدئة بلا غلاف `coalesce` ميت: الصفر البديل لم يكن يُنفَّذ قطّ، وكان
--     يوهم المراجع بأن غياب الإعداد يعني «بلا تهدئة» (عيب ٤).
--   • أُزيل شرط ميّت كان يُنتج القيمة نفسها في فرعيه:
--       case when p_type = 'subscription' then v_driver_id else v_driver_id end
--     وهو لا يُغيّر سلوكاً، لكنه يوهم قارئ الكود بتفريق لا وجود له.
-- --------------------------------------------------------------------------
create or replace function public.open_support_ticket(
  p_telegram_id bigint,
  p_type support_ticket_type,
  p_message text,
  p_file_id text default null::text,
  p_order_id uuid default null::uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

  -- حدّ التكرار: يُقاس على آخر تذكرة لهذا الشخص لا على عدد التذاكر، فلا يُعاقَب
  -- من فتح تذكرتين مشروعتين متباعدتين.
  -- الصفر البديل المحذوف كان يوهم بأن غياب الإعداد يعني «بلا تهدئة»، والواقع أن
  -- get_setting_number تُطلق MISSING_SETTING فيسقط النداء. أُبقي السلوك وأُزيل الوهم.
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

  -- النزاع يجب أن يتعلّق بطلب يملكه صاحب التذكرة فعلاً، وإلا صار باباً للتلصّص
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
  returning id into v_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_city_id, v_user.id, 'support.ticket_opened', 'support_ticket', v_id,
          jsonb_build_object('type', p_type, 'has_attachment', p_file_id is not null));

  return jsonb_build_object(
    'ok', true,
    'ticket_id', v_id,
    'city_id', v_city_id,
    'group_id', v_group,
    'type', p_type
  );
end;
$function$;

-- --------------------------------------------------------------------------
-- close_admin_session — التحديث الشرطيّ صار هو القراءة نفسها، فذهب نمط
-- «اقرأ ثم اكتب» من أصله، وصار صفّ التدقيق معلَّقاً على إغلاقٍ حقيقيّ (عيب ٥).
-- ملاحظة على تغيّر الناتج: رمزٌ أُغلق سلفاً كان يُعيد closed=true (وهو غير
-- صحيح: لم يُغلق شيء في هذا النداء)، وصار يُعيد closed=false كما رمزٍ لا وجود
-- له. النتيجة العملية للمُنادي واحدة — `ok=true` ولا جلسة قائمة بعد النداء —
-- وقارئ سجلّ التدقيق صار يرى حدثاً واحداً لكل إغلاق فعليّ.
-- --------------------------------------------------------------------------
create or replace function public.close_admin_session(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session admin_sessions%rowtype;
begin
  update admin_sessions set revoked_at = now()
   where token_hash = p_token_hash and revoked_at is null
   returning * into v_session;

  if not found then
    return jsonb_build_object('ok', true, 'closed', false);
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_session.city_id, v_session.user_id, 'admin.session_closed', 'user',
          v_session.user_id, '{}'::jsonb);

  return jsonb_build_object('ok', true, 'closed', true);
end;
$function$;
