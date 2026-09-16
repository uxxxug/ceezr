-- migration-phase: expand
-- `SEC-12` — **أخطرُ فعلَينِ في النظامِ كانا بلا أثرٍ تدقيقيٍّ**.
--
-- العطبُ المقيسُ من كاتالوجِ المحرِّكِ لا من النصِّ: من بينِ دوالِّ الفاعلِ
-- الإداريِّ/الداعمِ كلِّها، `claim_safety_incident` و`resolve_safety_incident`
-- **وحدَهما** لا تكتبانِ سطراً في `audit_log`. وهما فعلانِ على بلاغِ استغاثةٍ
-- (`SOS`): الأوّلُ يُسنِدُ البلاغَ إلى موظَّفٍ بعينِه، والثاني **يُغلِقُه** وقد
-- **يحظِرُ المُبلِّغَ نفسَه** (`decision = 'block_reporter'`).
--
-- وهذا أسوأُ موضعٍ يُترَكُ بلا أثرٍ: حظرُ المستخدمِ من `admin_set_user_blocked`
-- يُكتَبُ فاعلُه، لكنَّ **القرارَ الذي أمرَ بالحظرِ** — إغلاقُ بلاغٍ باستنتاجِ
-- «المُبلِّغُ مُسيءٌ» — لم يكنْ يُكتَبُ. فمَن قرأَ `audit_log` رأى حظراً معلَّلاً
-- بلا بلاغٍ، ولم يجدْ مَن ادَّعى البلاغَ ولا متى ولا بأيِّ قرارٍ أُغلِقَ.
--
-- **ولا يُقالُ إنَّ `safety_incidents` نفسَه أثرٌ كافٍ.** الجدولُ يحملُ **الحالةَ
-- الأخيرةَ** (`claimed_by_user_id` · `decided_by_user_id`) لا **تسلسُلَ الأفعالِ**:
-- تُكتَبُ فوقَها فتُمحى سابقتُها، ولا زمنَ مستقلَّاً لكلِّ فعلٍ، ولا `request_id`
-- يصلُ الفعلَ بالطلبِ الذي أحدثَه (`F8-01`). والأثرُ التدقيقيُّ **مُلحَقٌ لا
-- مُحدَّثٌ** — وذاكَ الفرقُ بينَ حالةٍ وسِجلٍّ.
--
-- ثلاثةُ قراراتٍ مكتوبةٌ على وجهِها:
--
--   ١) **الإلحاقُ بعدَ الكتابةِ لا قبلَها.** الإدراجُ يقعُ بعدَ `update` الناجحِ
--      وفي المعاملةِ نفسِها: فإن سقطَ التحديثُ لم يبقَ سطرُ تدقيقٍ يشهدُ بفعلٍ لم
--      يقعْ، وإن سقطَ الإدراجُ سقطَ الفعلُ كلُّه. **والأثرُ ليسَ أثراً إن جازَ أن
--      يوجدَ بلا فعلِه أو أن يوجدَ الفعلُ بلا أثرِه.**
--
--   ٢) **`city_id` من البلاغِ لا من الفاعلِ.** الموظَّفُ قد يخدمُ مدينةً غيرَ
--      مدينةِ البلاغِ، والصفُّ يُنسَبُ إلى مدينةِ **الحادثةِ** كي تُقرأَ الأفعالُ
--      بمدينتِها لا بمكانِ جالسِها.
--
--   ٣) **قرارُ `block_reporter` يُكتَبُ في الحمولةِ صراحةً** لا يُستنتَجُ من
--      وجودِ سطرِ حظرٍ مجاورٍ: مَن استنتجَ ربطاً من التجاورِ الزمنيِّ قرأَ صُدفةً.
--
-- **ومُسترجَعةٌ** (القاعدةُ ٥): `create or replace` تُعيدُ الحالةَ نفسَها مهما
-- كُرِّرَت، ولا جدولَ يُنشَأُ ولا عمودَ يُضافُ.

create or replace function public.claim_safety_incident(p_incident_id uuid, p_actor_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_incident safety_incidents%rowtype; v_actor users%rowtype;
begin
  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found or v_actor.is_blocked or v_actor.role not in ('support', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_AUTHORIZED');
  end if;
  select * into v_incident from safety_incidents where id = p_incident_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'INCIDENT_NOT_FOUND'); end if;
  if v_incident.status = 'closed' then return jsonb_build_object('ok', false, 'error', 'INCIDENT_ALREADY_CLOSED'); end if;
  if v_incident.status = 'received' then
    return jsonb_build_object('ok', false, 'error', 'INCIDENT_ALREADY_CLAIMED',
      'claimed_by', (select telegram_id::text from users where id = v_incident.claimed_by_user_id));
  end if;
  update safety_incidents set status = 'received', claimed_by_user_id = v_actor.id, claimed_at = now()
    where id = p_incident_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_incident.city_id, v_actor.id, 'safety.incident_claimed', 'safety_incident', v_incident.id,
          jsonb_build_object('order_id', v_incident.order_id, 'reporter_role', v_incident.reporter_role));

  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.resolve_safety_incident(p_incident_id uuid, p_actor_telegram_id bigint, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_incident safety_incidents%rowtype; v_actor users%rowtype; v_block jsonb;
begin
  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found or v_actor.is_blocked or v_actor.role not in ('support', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_AUTHORIZED');
  end if;
  if p_decision not in ('close', 'block_reporter') then return jsonb_build_object('ok', false, 'error', 'INVALID_DECISION'); end if;
  select * into v_incident from safety_incidents where id = p_incident_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'INCIDENT_NOT_FOUND'); end if;
  if v_incident.status = 'closed' then return jsonb_build_object('ok', false, 'error', 'INCIDENT_ALREADY_CLOSED'); end if;
  if v_incident.status <> 'received' or v_incident.claimed_by_user_id <> v_actor.id then
    return jsonb_build_object('ok', false, 'error', 'INCIDENT_NOT_CLAIMED_BY_ACTOR');
  end if;
  if p_decision = 'block_reporter' then
    select admin_set_user_blocked(v_actor.id, v_incident.reporter_user_id, true) into v_block;
    if coalesce((v_block->>'ok')::boolean, false) is not true then
      return jsonb_build_object('ok', false, 'error', coalesce(v_block->>'error', 'BLOCK_REJECTED'));
    end if;
  end if;
  update safety_incidents set status = 'closed', decision = p_decision,
    decided_by_user_id = v_actor.id, decided_at = now() where id = p_incident_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_incident.city_id, v_actor.id, 'safety.incident_resolved', 'safety_incident', v_incident.id,
          jsonb_build_object('decision', p_decision, 'order_id', v_incident.order_id,
                             'reporter_blocked', p_decision = 'block_reporter'));

  return jsonb_build_object('ok', true, 'decision', p_decision);
end $function$;
