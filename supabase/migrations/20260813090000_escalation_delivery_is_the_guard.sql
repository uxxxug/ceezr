-- ----------------------------------------------------------------------------
-- التصعيد يكتمل بالتسليم لا بالنيّة
--
-- العطب المقيس: `escalate_order` كانت تكتب أثر 'order.escalated' ثم يُرسل النداءُ
-- بطاقةَ التصعيد إلى قروب الإسناد. فإن أخفق الإرسالُ مرّةً واحدةً — انقطاعُ شبكةٍ
-- أو 429 من تيليجرام — بقي الأثرُ مكتوباً، وحارسُ «تصعيدٌ واحد لكل طلب» يقرأ ذلك
-- الأثرَ فيمنع كلَّ إعادةٍ إلى الأبد. النتيجة الثلاثية:
--   ١) البطاقة لم تصل قروبَ الإسناد أبداً، فلا موظّف يعلم.
--   ٢) الراكب لم يُخبَر أبداً، لأن إخباره معلَّقٌ على تصعيدٍ ناجح.
--   ٣) الطلب يبقى 'searching' إلى الأبد — وهو بعينه اليتمُ الذي جاء التصعيدُ ليمنعه.
-- وأسوأُ من ذلك أنّ الأثرَ يكذب: من يراجع السجلّ يقرأ «صُعِّد» فيطمئنّ، ولم يصل أحداً.
-- قيسَ فعلاً: بإخفاقِ إرسالٍ واحدٍ صار سجلُّ التصعيد ١ والبطاقاتُ ٠ ورسائلُ الراكب ٠،
-- ثم ردَّ الشوطُ الثاني ALREADY_ESCALATED ولم يُرسل شيئاً.
--
-- الإصلاح: الأثرُ يُكتب غيرَ مسلَّم، والحارسُ يمنع المسلَّمَ وحده، والتسليمُ يُعلَن
-- بدالّةٍ ثانية. فإخفاقُ الإرسال يُبقي الطلبَ قابلاً للتصعيد في الشوط التالي.
--
-- والمقايضة مقصودةٌ ومكشوفة: لو نجح الإرسالُ ثم أخفق إعلانُ التسليم، تُرسَل بطاقةٌ
-- ثانيةٌ في شوطٍ لاحق. بطاقةٌ مكرّرةٌ يراها موظّفٌ أهونُ بما لا يُقاس من طلبٍ يتيمٍ
-- صامتٍ لا يراه أحد.
-- ----------------------------------------------------------------------------

create or replace function escalate_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   orders%rowtype;
  v_group   bigint;
  v_pending uuid;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  select telegram_escalation_group_id into v_group
    from cities where id = v_order.city_id;
  if v_group is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_GROUP_MISSING');
  end if;

  -- تصعيدٌ مسلَّمٌ واحدٌ لكل طلب: لا إغراق لقروب الإسناد بنفس الحالة كل دقيقة.
  -- و`coalesce(..., true)` مقصود: الآثارُ المكتوبةُ قبل هذه الهجرة لا تحمل المفتاح،
  -- وهي تصعيداتٌ سلّمت فعلاً — فاعتبارها غيرَ مسلَّمة يُعيد بثَّ بطاقاتٍ قديمة.
  if exists (
    select 1 from audit_log
     where entity_type = 'order' and entity_id = p_order_id
       and action = 'order.escalated'
       and coalesce((payload->>'delivered')::boolean, true) = true
  ) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_ESCALATED',
                              'group_id', v_group);
  end if;

  -- أثرٌ غيرُ مسلَّمٍ قائمٌ من شوطٍ أخفق إرسالُه: يُعاد استخدامه ولا يُكتب ثانٍ،
  -- وإلّا تراكمت في السجلّ آثارُ محاولاتٍ بعددِ أشواط العامل لا بعددِ التصعيدات.
  select id into v_pending
    from audit_log
   where entity_type = 'order' and entity_id = p_order_id
     and action = 'order.escalated'
     and coalesce((payload->>'delivered')::boolean, true) = false
   order by created_at asc
   limit 1;

  if v_pending is null then
    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (v_order.city_id, null, 'order.escalated', 'order', p_order_id,
            jsonb_build_object('reason', p_reason, 'service', v_order.service,
                               'delivered', false));
  end if;

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'group_id', v_group,
                            'city_id', v_order.city_id, 'service', v_order.service);
end;
$$;

-- ----------------------------------------------------------------------------
-- mark_escalation_delivered — التسليمُ يُعلَن بعد وصولِ البطاقة فعلاً
--
-- تُرجع `first_delivery` لأنّ إشعارَ الراكب معلَّقٌ عليها: انتقالُ الصفِّ من غيرِ
-- مسلَّمٍ إلى مسلَّمٍ يحدث مرّةً واحدةً داخل صفٍّ مقفول، فـ«رسالةٌ واحدةٌ للراكب»
-- مضمونةٌ في القاعدة لا رجاءً في ذاكرة العملية.
-- ----------------------------------------------------------------------------
create or replace function mark_escalation_delivered(
  p_order_id   uuid,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from audit_log
   where entity_type = 'order' and entity_id = p_order_id
     and action = 'order.escalated'
     and coalesce((payload->>'delivered')::boolean, true) = false
   order by created_at asc
   limit 1
     for update;

  if v_id is null then
    -- لا أثرَ غيرَ مسلَّم: إمّا سُلِّم في شوطٍ سابق وإمّا لم يُصعَّد الطلبُ قطّ.
    -- الحالتان لا تُخبران الراكب ثانياً، والفرقُ بينهما لا يغيّر تصرّفَ النداء.
    return jsonb_build_object('ok', true, 'first_delivery', false);
  end if;

  update audit_log
     set payload = payload
                 || jsonb_build_object('delivered', true)
                 || case when p_message_id is null then '{}'::jsonb
                         else jsonb_build_object('message_id', p_message_id) end
   where id = v_id;

  return jsonb_build_object('ok', true, 'first_delivery', true);
end;
$$;

-- الصلاحيات على نمط المستودع: لا تُترك دالّةٌ مملوكةٌ مفتوحةً لـanon ولا authenticated.
do $$
declare f text;
begin
  foreach f in array array[
    'escalate_order(uuid,text)',
    'mark_escalation_delivered(uuid,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
