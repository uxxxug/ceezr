-- migration-phase: expand
-- =============================================================================
-- D-39: حجزُ استغاثةٍ متروكٌ يعلَقُ في `sending` إلى الأبدِ.
-- الحالة: منفّذ (توسيعٌ: `create or replace` لدالّةٍ قائمةٍ بتوقيعِها نفسِه
--   ومُخرَجِها نفسِه حرفاً؛ أُضيفَ قبلَ المسحِ استردادُ الحجزِ المتروكِ وحدَه).
-- يبني على: 20260813070000 (`claim_safety_incident_delivery` · تخطّي ناقصِ الإعدادِ)،
--   20260908030000 (الصندوقُ الموحَّدُ `notification_outbox`)،
--   20260814040000 (النمطُ نفسُه للبثِّ وإشعاراتِ الاشتراكِ).
-- ينتمي إلى: supabase/migrations.
--
-- ## العيبُ
--
-- `claim_safety_incident_delivery` تلتقطُ `pending` وحدَه، و`finish_safety_incident_delivery`
-- لا تمسُّ إلّا صفّاً بحجزِه الحيِّ. فعاملٌ حجزَ صفَّ استغاثةٍ ثمَّ ماتَ قبلَ أن
-- يُعلِنَ نتيجتَه (إعادةُ نشرٍ · `SIGKILL` · انقطاعُ القاعدةِ) تركَ الصفَّ `sending`
-- بلا مخرجٍ: لا بطاقةَ تصلُ فريقَ الإسنادِ ولا سطرَ خطأٍ ولا محاولةَ تالية. وأصنافُ
-- الرحلةِ (`claim_notification_delivery`) والبثُّ وإشعاراتُ الاشتراكِ تستردُّ حجوزَها
-- المتروكةَ داخلَ المطالبةِ نفسِها؛ والاستغاثةُ — أخطرُها — وحدَها بلا استردادٍ.
-- شوهِدَ حيّاً على البيئةِ التجريبيّةِ: صفٌّ `sending` منذُ 2026-09-30 03:06 UTC.
--
-- ## العلاجُ
--
-- الاستردادُ داخلَ المطالبةِ نفسِها (لا جارفٌ منفصلٌ يُنسى)، بمهلةِ الإعدادِ نفسِه
-- الذي يحكمُ الصندوقَ (`notification_claim_timeout_seconds`) وبالافتراضِ نفسِه.
-- =============================================================================

create or replace function claim_safety_incident_delivery()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_candidate record;
  v_token uuid := gen_random_uuid();
  v_group bigint;
  v_max integer;
  v_deferred jsonb := '[]'::jsonb;
  v_scanned integer := 0;
  c_scan_limit constant integer := 100;
begin
  -- D-39: استردادُ حجزٍ متروكٍ قبلَ المسحِ — عاملٌ حجزَ ثمَّ ماتَ قبلَ `finish`.
  -- المهلةُ إعدادُ المدينةِ نفسُه الذي يحكمُ أصنافَ الرحلةِ في الصندوقِ نفسِه
  -- (`notification_claim_timeout_seconds` · `claim_notification_delivery`) لا
  -- إعدادٌ ثانٍ بالمعنى نفسِه. والمحاولاتُ لا تُعَدُّ هنا: تُعَدُّ عندَ المطالبةِ
  -- التاليةِ. الدلالةُ «مرّةً على الأقلّ»: بطاقةٌ نُشِرَت قبلَ موتِ العاملِ قد تُنشَرُ
  -- ثانيةً — وتكرارُ نداءِ استغاثةٍ أهونُ من ضياعِه.
  update notification_outbox n
     set status = 'pending', claim_token = null, claimed_at = null, next_attempt_at = now()
   where n.kind = 'safety_incident'
     and n.status = 'sending'
     and n.claimed_at is not null
     and n.claimed_at < now() - make_interval(secs => coalesce(
           (select greatest(1, (ps.value #>> '{}')::integer)
              from platform_settings ps
             where ps.city_id = n.city_id
               and ps.key = 'notification_claim_timeout_seconds'),
           300));

  for v_candidate in
    select n.id, n.city_id, (n.payload->>'incident_id')::uuid as incident_id
      from notification_outbox n
     where n.kind = 'safety_incident'
       and n.status = 'pending'
       and n.next_attempt_at <= now()
     order by n.created_at
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

    update notification_outbox
       set status = 'sending', attempts = attempts + 1,
           claim_token = v_token, claimed_at = now()
     where id = v_candidate.id;

    return (
      select jsonb_build_object('ok', true, 'deferred', v_deferred, 'delivery', jsonb_build_object(
        'delivery_id', n.id, 'incident_id', i.id, 'claim_token', v_token,
        'group_id', v_group::text, 'order_id', o.id, 'service', o.service::text,
        'reporter_role', i.reporter_role, 'status', i.status, 'reason', i.reason,
        'location_wkt', case
          when i.last_known_location is null then null
          else st_astext(i.last_known_location::geometry) end,
        'max_attempts', v_max
      ))
      from notification_outbox n
      join safety_incidents i on i.id = (n.payload->>'incident_id')::uuid
      left join orders o on o.id = i.order_id
     where n.id = v_candidate.id
    );
  end loop;

  -- لا شيء صالحٌ للمطالبة: إمّا الطابور فارغ، وإمّا كلّ ما فيه ناقص الإعداد.
  return jsonb_build_object('ok', true, 'delivery', null, 'deferred', v_deferred);
end $function$;
