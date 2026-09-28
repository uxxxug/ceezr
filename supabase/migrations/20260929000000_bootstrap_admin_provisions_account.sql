-- =============================================================================
-- migration-phase: expand
-- ADR-0212: المسؤولُ الأوّلُ يُنشَأُ حسابُه عندَ `/start` — كسرُ حلقةِ الإقلاعِ.
-- الحالة: منفّذ (توسيعٌ: دالّةٌ جديدةٌ، و`grant_bootstrap_admin` لم تُمسَّ حرفاً).
-- يبني على: 20260807130000 (`grant_bootstrap_admin`)، 20260810100000
--   (`admin_update_city_group_ids` — التفعيلُ يشترطُ فاعلاً مسؤولاً).
-- ينتمي إلى: supabase/migrations.
--
-- ## العيبُ الذي تُصلحُه (مُكتشَفٌ في الإنتاجِ 2026-09-29 · `DEC-20`)
--
-- حلقةٌ مغلقةٌ لا مخرجَ منها داخلَ النظامِ:
--   ١) `grant_bootstrap_admin` تُرقّي صفّاً قائماً في `users` وحدَه (`USER_NOT_FOUND`
--      إن غابَ).
--   ٢) صفُّ `users` يُنشَأُ عندَ اكتمالِ تسجيلِ سائقٍ أو راكبٍ، والتسجيلُ يقفُ عندَ
--      «لا توجد مدينة مفعَّلة» ما لم تكن مدينةٌ مفعَّلةً.
--   ٣) المدينةُ تُفعَّلُ بـ`admin_update_city_group_ids` التي تشترطُ فاعلاً مسؤولاً.
-- فعلى قاعدةٍ مبنيّةٍ من الهجراتِ (كلُّ المدنِ غيرُ مفعَّلةٍ) لا يصيرُ أحدٌ مسؤولاً،
-- ولا تُفعَّلُ مدينةٌ. قاعدةُ الاختبارِ لم تكشفْه لأنّها تزرعُ المستخدمينَ مباشرةً.
--
-- ## ما تُضيفُه
--
-- `provision_bootstrap_admin(p_telegram_id)`: إن وُجِدَ صفٌّ فالسلوكُ هو سلوكُ
-- `grant_bootstrap_admin` نفسُه (تُنادى هي — مصدرُ حقيقةٍ واحدٌ للترقيةِ). وإن غابَ
-- أُنشِئَ صفٌّ بدورِ `admin` مربوطاً بأوّلِ مدينةٍ بترتيبِ الرمزِ (`users.city_id`
-- إلزاميٌّ؛ والمسؤولُ غيرُ محصورٍ بمدينةٍ في اللوحةِ)، مع صفِّ تدقيقٍ واحدٍ.
--
-- ## الحدُّ الأمنيُّ
--
-- الدالّةُ لا تعرفُ المعرّفَ المقصودَ؛ حارسُها أنَّ المُنادي الوحيدَ مسارُ `/start`
-- في بوتِ السائقِ حينَ يطابقُ المرسِلُ `BOOTSTRAP_ADMIN_TELEGRAM_ID` — وهو نفسُ حدِّ
-- `grant_bootstrap_admin` منذُ 20260807. والتنفيذُ لـ`service_role` وحدَه.
-- =============================================================================

create or replace function provision_bootstrap_admin(p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city_id uuid;
  v_user_id uuid;
begin
  if p_telegram_id is null or p_telegram_id <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TELEGRAM_ID');
  end if;

  -- الصفُّ قائمٌ: الترقيةُ بمصدرِها الوحيدِ، لا نسخةٌ ثانيةٌ منها هنا.
  perform 1 from users where telegram_id = p_telegram_id;
  if found then
    return grant_bootstrap_admin(p_telegram_id);
  end if;

  select id into v_city_id from cities order by code limit 1;
  if v_city_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_CITY');
  end if;

  insert into users (city_id, telegram_id, role)
  values (v_city_id, p_telegram_id, 'admin')
  on conflict (telegram_id) do nothing
  returning id into v_user_id;

  -- سباقُ `/start` مزدوجٍ: الآخرُ أنشأَه — فالترقيةُ idempotent تحسمُ.
  if v_user_id is null then
    return grant_bootstrap_admin(p_telegram_id);
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_city_id, v_user_id, 'identity.bootstrap_admin_granted', 'user', v_user_id,
          jsonb_build_object('previous_role', null, 'provisioned', true));

  return jsonb_build_object('ok', true, 'granted', true, 'provisioned', true, 'user_id', v_user_id);
end;
$$;

revoke all on function provision_bootstrap_admin(bigint) from public, anon, authenticated;
grant execute on function provision_bootstrap_admin(bigint) to service_role;
