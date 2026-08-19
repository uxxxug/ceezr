-- =============================================================================
-- الغرض: منع صفٍّ واحدٍ سيّئ الإعداد من تعطيل تسليم نداءات الاستغاثة كلّها.
-- الحالة: منفّذ فعلياً — إصلاح انحصار رأس الطابور (head-of-line blocking).
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: apps/workers (مهمّة deliver-safety-incidents)
--
-- ## العطل الذي تُصلحه هذه الهجرة
--
-- `claim_safety_incident_delivery` كانت تختار أقدم صفٍّ مستحقّ، ثم تُرجع
-- `ESCALATION_GROUP_MISSING` إن كانت مدينة ذلك الصفّ بلا مجموعة تصعيد، أو
-- `SOS_RETRY_SETTING_MISSING` إن غاب إعدادها. والصفّ في هاتين الحالتين لا
-- يُعلَّم `sending` ولا يُؤجَّل موعده — يبقى كما هو تماماً.
--
-- والمطالبة عامّة لا مقيَّدة بمدينة: تمسح المدن كلّها بترتيب `created_at`. فمدينةٌ
-- واحدة ناقصة الإعداد كانت تُنتج صفّاً يُختار أوّلاً في كل دورة، ويُرجع خطأً،
-- فيسقط الشوط كلّه — وحوادث المدن الأخرى، المهيّأة تماماً، لا تُسلَّم أبداً.
-- عطلٌ دائمٌ في مسار الاستغاثة كلّه، سببه حقلٌ فارغ في مدينةٍ واحدة.
--
-- ## المعالجة
--
-- الدالة الآن تمرّ على المرشّحين واحداً واحداً: ما كان ناقص الإعداد يُتخطّى
-- ويُسجَّل سببه في `deferred`، وأوّل صفٍّ مكتمل الإعداد يُطالَب به ويُعاد.
--
-- ولا يُلمس `next_attempt_at` للمتخطَّى: لا موعد مُختلَق ولا محاولة محسوبة عليه.
-- فحين تُضبط المدينة يُسلَّم حادثها فوراً في الدورة التالية، ولا يُدفن في
-- المستقبل بمهلةٍ اخترعناها. والصفّ يبقى مرئياً في كل دورة — وهذا مقصود:
-- استغاثةٌ غير قابلة للتسليم يجب أن تُصرّح عن نفسها لا أن تصمت.
--
-- `deferred` ليس حقلاً تجميلياً: هو ما يجعل التخطّي مسموعاً. تخطٍّ صامتٌ
-- لنداء استغاثة أسوأ من العطل الذي نُصلحه، لأنّ العطل على الأقل كان يصرخ.
-- =============================================================================

create or replace function claim_safety_incident_delivery()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_candidate record;
  v_token uuid := gen_random_uuid();
  v_group bigint;
  v_max integer;
  v_deferred jsonb := '[]'::jsonb;
  v_scanned integer := 0;
  -- سقف مسحٍ تشغيليّ لا إعداد عمل: يمنع دورةً تمرّ على طابورٍ ضخم بلا نهاية.
  -- بلوغه يعني أنّ المائة الأولى كلّها ناقصة الإعداد، وذلك مُبلَّغٌ في `deferred`.
  c_scan_limit constant integer := 100;
begin
  for v_candidate in
    select d.id, d.city_id
      from safety_incident_deliveries d
     where d.status = 'pending' and d.next_attempt_at <= now()
     order by d.created_at
     for update skip locked
     limit c_scan_limit
  loop
    v_scanned := v_scanned + 1;
    v_group := null;
    v_max := null;

    select c.telegram_escalation_group_id into v_group
      from cities c where c.id = v_candidate.city_id;
    if v_group is null then
      v_deferred := v_deferred || jsonb_build_object(
        'delivery_id', v_candidate.id, 'city_id', v_candidate.city_id,
        'reason', 'ESCALATION_GROUP_MISSING'
      );
      continue;
    end if;

    select greatest(1, (value #>> '{}')::integer) into v_max
      from platform_settings
     where city_id = v_candidate.city_id and key = 'sos_delivery_max_attempts';
    if v_max is null then
      v_deferred := v_deferred || jsonb_build_object(
        'delivery_id', v_candidate.id, 'city_id', v_candidate.city_id,
        'reason', 'SOS_RETRY_SETTING_MISSING'
      );
      continue;
    end if;

    update safety_incident_deliveries
       set status = 'sending', attempts = attempts + 1, claim_token = v_token
     where id = v_candidate.id;

    return (
      select jsonb_build_object('ok', true, 'deferred', v_deferred, 'delivery', jsonb_build_object(
        'delivery_id', d.id, 'incident_id', i.id, 'claim_token', v_token,
        'group_id', v_group::text, 'order_id', o.id, 'service', o.service::text,
        'reporter_role', i.reporter_role, 'status', i.status,
        'location_wkt', case
          when i.last_known_location is null then null
          else st_astext(i.last_known_location::geometry) end,
        'max_attempts', v_max
      ))
      from safety_incident_deliveries d
      join safety_incidents i on i.id = d.incident_id
      join orders o on o.id = i.order_id
     where d.id = v_candidate.id
    );
  end loop;

  -- لا شيء صالحٌ للمطالبة: إمّا الطابور فارغ، وإمّا كلّ ما فيه ناقص الإعداد.
  return jsonb_build_object('ok', true, 'delivery', null, 'deferred', v_deferred);
end $$;

comment on function claim_safety_incident_delivery() is
  'يطالب بأقدم تسليم استغاثة مكتمل الإعداد، ويُبلّغ عن كل صفٍّ تخطّاه لنقص إعداد مدينته في deferred بدل إسقاط الشوط كلّه.';

revoke execute on function claim_safety_incident_delivery() from public, anon, authenticated;
grant execute on function claim_safety_incident_delivery() to service_role;
