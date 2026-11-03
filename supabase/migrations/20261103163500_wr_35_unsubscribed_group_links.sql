-- migration-phase: switch
-- =============================================================================
-- WR-35 — روابطُ قروباتِ سائقي المدنِ غيرِ المشتركين + ضوابطُ إشعارِ الانتهاء
-- =============================================================================
--
-- ## القرارُ (طلبُ المالكِ 2026-11-03 — استثناءٌ معتمَدٌ على تجميدِ PRD-010)
--
-- عندَ انتهاءِ الاشتراكِ المجانيِّ يصلُ السائقَ رابطُ قروبِ سائقي مدينتِه
-- غيرِ المشتركين. الروابطُ الخمسةُ التاليةُ **يعتمدُها المالكُ حصرًا**:
--
--   JED → https://t.me/ODD_Jeddah_drivers
--   MKK → https://t.me/ODD_Mecca_drivers
--   RUH → https://t.me/ODD_AL_Riyadh_drivers
--   TIF → https://t.me/ODD_AL_Taif_drivers
--   MED → https://t.me/ODD_AL_Madinah_drivers
--
-- ## الجزءُ الأوّلُ — البذرُ (idempotent، لا يُفقِدُ قيمةً قائمةً)
--
-- - يُكتَبُ الرابطُ حيثُ الإعدادُ **غائبٌ** أو **فارغٌ** (`""` أو `null` JSON أو
--   نصٌّ من مسافاتٍ) فقط، ويُرفَعُ عنه وسمُ `is_provisional` (قيمةٌ معتمَدةٌ).
-- - قيمةٌ **غيرُ فارغةٍ** مختلفةٌ لا تُمَسُّ: تُعلَنُ بـ`raise warning` ويبقى
--   القرارُ للمالكِ من لوحةِ الإعداداتِ. فلا تُطمَسُ قيمةٌ وضعها إنسانٌ.
-- - إعادةُ التشغيلِ لا تُغيِّرُ شيئًا (القيمةُ صارت غيرَ فارغةٍ ومطابِقةً).
-- - مدنٌ غيرُ الخمسِ لا تُمَسُّ: يبقى إعدادُها `""` فيُحالُ سائقُها إلى الدعمِ.
--
-- ## الجزءُ الثاني — `claim_subscription_notices` بضوابطِ لحظةِ التسليم
--
-- التوقيعُ والمُرجَعُ كما كانا. يُضافُ قبلَ الحجزِ وأثناءَه:
-- 1. **إلغاءُ ما لم يَعُد مناسبًا** (`status='canceled'` برمزٍ مقروءٍ، لا حذف):
--    - `RECIPIENT_BLOCKED`: صاحبُه محظورٌ أو ممسوحٌ الآنَ — امتدادٌ للسياسةِ
--      القائمةِ في `enqueue_subscription_notice` (المحظورُ لا يُشعَرُ) إلى لحظةِ
--      التسليمِ، فلا يُرسَلُ لمن حُظِرَ بعدَ الإيداعِ.
--    - `SUPERSEDED_BY_RENEWAL`: إشعارُ نهايةٍ (`trial_expired`/`expired`/
--      `cancelled`) وللسائقِ الآنَ اشتراكٌ ساري (`trialing`/`active` لم تنتهِ
--      مدّتُه). فمن دفعَ قبلَ التسليمِ لا تصلُه «انتهى اشتراكُك» بعدَ «فُعِّل».
-- 2. **تحديثُ الرابطِ لحظةَ الحجزِ** لا لحظةَ الإيداعِ: يُقرأُ إعدادُ المدينةِ
--    الآنَ (فتصلُ الإشعاراتُ المعلَّقةُ القديمةُ بالرابطِ المعتمَدِ)، ويُقبَلُ
--    فقط رابطُ `https://t.me/…` سليمُ الشكلِ، ولسائقٍ `verified` فقط (بوّابةُ
--    الانضمامِ ترفضُ غيرَه أصلًا). وتُحفَظُ الحالةُ في الحمولةِ:
--    `group_link_status` ∈ {`ok`,`missing`,`invalid`,`driver_not_verified`} —
--    سجلٌّ مقروءٌ لكلِّ إشعارٍ لم يحمل رابطًا، ومسارُه الدعمُ (`/support`).
--    ويُضافُ اسمُ المدينةِ (`city_name_ar`/`city_name_en`) لصياغةِ «قروب سائقي
--    مدينتك» — فلا يُرسَلُ رابطُ مدينةٍ لسائقِ أخرى: الإعدادُ لكلِّ مدينةٍ
--    و`get_setting` لا يرجعُ إلى قيمةٍ عامّةٍ.
--
-- ## التراجعُ
--
-- البذرُ: `update platform_settings ps set value = '""'::jsonb, is_provisional = true
--   from cities c where c.id = ps.city_id and ps.key = 'unsubscribed_drivers_group_link'
--   and ps.value #>> '{}' = <الرابطُ المعتمَدُ لـc.code>;` — يعيدُ الحالةَ السابقةَ
--   بعينِها (كانت فارغةً، والفراغُ والغيابُ سلوكٌ واحدٌ: إحالةٌ إلى الدعم).
-- الدالّةُ: إعادةُ تطبيقِ نصِّها من `20260908020000_unified_outbox_subscription_notice.sql`.
-- =============================================================================

-- ١. البذرُ ------------------------------------------------------------------

do $$
declare
  v_row record;
begin
  for v_row in
    select c.id as city_id, c.code, l.link, ps.value as current_value
      from (values
              ('JED', 'https://t.me/ODD_Jeddah_drivers'),
              ('MKK', 'https://t.me/ODD_Mecca_drivers'),
              ('RUH', 'https://t.me/ODD_AL_Riyadh_drivers'),
              ('TIF', 'https://t.me/ODD_AL_Taif_drivers'),
              ('MED', 'https://t.me/ODD_AL_Madinah_drivers')
           ) as l(code, link)
      join cities c on c.code = l.code
      left join platform_settings ps
        on ps.city_id = c.id and ps.key = 'unsubscribed_drivers_group_link'
  loop
    if v_row.current_value is null then
      insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
      values (v_row.city_id, 'unsubscribed_drivers_group_link', to_jsonb(v_row.link), 'string',
              'رابط دعوة قروب السائقين غير المشتركين في المدينة — يُرسل لمن انتهت فترته ولم يشترك (معتمَد من المالك، WR-35)',
              false)
      on conflict (city_id, key) do nothing;
    elsif jsonb_typeof(v_row.current_value) = 'null'
       or btrim(coalesce(v_row.current_value #>> '{}', '')) = '' then
      update platform_settings
         set value = to_jsonb(v_row.link), is_provisional = false, updated_at = now()
       where city_id = v_row.city_id and key = 'unsubscribed_drivers_group_link';
    elsif v_row.current_value #>> '{}' is distinct from v_row.link then
      raise warning 'WR-35: unsubscribed_drivers_group_link لمدينة % قيمتُه قائمةٌ غيرُ فارغةٍ (%) — تُركت كما هي؛ الرابطُ المعتمَد %',
        v_row.code, v_row.current_value #>> '{}', v_row.link;
    end if;
  end loop;
end;
$$;

-- ٢. الحجزُ بضوابطِ لحظةِ التسليم ---------------------------------------------

create or replace function claim_subscription_notices(p_city_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_max_attempts integer;
  v_timeout integer;
  v_token uuid := gen_random_uuid();
  v_rows jsonb;
  v_link text;
  v_link_ok boolean;
  v_city cities%rowtype;
  v_skipped integer := 0;
  v_count integer;
begin
  select * into v_city from cities where id = p_city_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND');
  end if;

  v_limit := get_setting_number(p_city_id, 'subscription_notice_batch_limit');
  if v_limit is null then
    return jsonb_build_object('ok', false, 'error', 'NOTICE_BATCH_SETTING_MISSING');
  end if;
  v_max_attempts := get_setting_number(p_city_id, 'subscription_notice_max_attempts');
  if v_max_attempts is null then
    return jsonb_build_object('ok', false, 'error', 'NOTICE_ATTEMPTS_SETTING_MISSING');
  end if;

  -- استرجاعُ الحجوزِ المتروكةِ كما كان (عاملٌ حجز ثمّ مات).
  v_timeout := coalesce(get_setting_number(p_city_id, 'notification_claim_timeout_seconds'), 300);
  update notification_outbox
     set status = 'pending', claim_token = null, claimed_at = null, next_attempt_at = now()
   where kind = 'subscription_notice'
     and city_id = p_city_id
     and status = 'sending'
     and claimed_at is not null
     and claimed_at < now() - make_interval(secs => v_timeout);

  -- (أ) المحظورُ أو الممسوحُ الآنَ: لا يُرسَلُ له شيءٌ (السياسةُ القائمةُ عندَ الإيداعِ).
  update notification_outbox n
     set status = 'canceled', error_code = 'RECIPIENT_BLOCKED',
         claim_token = null, claimed_at = null
    from subscriptions s
    join drivers d on d.id = s.driver_id
    join users u on u.id = d.user_id
   where n.kind = 'subscription_notice'
     and n.city_id = p_city_id
     and n.status = 'pending'
     and s.id = (n.payload->>'subscription_id')::uuid
     and (u.is_blocked or u.erased_at is not null);
  get diagnostics v_count = row_count;
  v_skipped := v_skipped + v_count;

  -- (ب) إشعارُ نهايةٍ تجاوزه تجديدٌ: للسائقِ اشتراكٌ ساري الآنَ.
  update notification_outbox n
     set status = 'canceled', error_code = 'SUPERSEDED_BY_RENEWAL',
         claim_token = null, claimed_at = null
    from subscriptions s
   where n.kind = 'subscription_notice'
     and n.city_id = p_city_id
     and n.status = 'pending'
     and n.payload->>'notice_kind' in ('trial_expired', 'expired', 'cancelled')
     and s.id = (n.payload->>'subscription_id')::uuid
     and exists (
       select 1
         from subscriptions live
        where live.driver_id = s.driver_id
          and live.id <> s.id
          and live.status in ('trialing', 'active')
          and coalesce(case when live.status = 'trialing' then live.trial_ends_at
                            else live.current_period_end end, 'infinity'::timestamptz) > now());
  get diagnostics v_count = row_count;
  v_skipped := v_skipped + v_count;

  -- (ج) الرابطُ المعتمَدُ الآنَ لهذه المدينةِ وحدَها، بشكلٍ سليمٍ أو لا رابط.
  v_link := btrim(coalesce(get_setting(p_city_id, 'unsubscribed_drivers_group_link') #>> '{}', ''));
  v_link_ok := v_link ~ '^https://t\.me/(\+[A-Za-z0-9_-]{8,}|joinchat/[A-Za-z0-9_-]{8,}|[A-Za-z][A-Za-z0-9_]{3,31})/?$';

  with due as (
    select n.id
      from notification_outbox n
     where n.kind = 'subscription_notice'
       and n.city_id = p_city_id
       and n.status = 'pending'
       and n.next_attempt_at <= now()
     order by n.next_attempt_at
     limit v_limit
     for update skip locked
  ),
  facts as (
    select due.id,
           coalesce(d.verification_status = 'verified', false) as verified
      from due
      join notification_outbox n on n.id = due.id
      left join subscriptions s on s.id = (n.payload->>'subscription_id')::uuid
      left join drivers d on d.id = s.driver_id
  ),
  claimed as (
    update notification_outbox n
       set status = 'sending',
           attempts = n.attempts + 1,
           claim_token = v_token,
           claimed_at = now(),
           payload = n.payload || jsonb_build_object(
             'group_link',
               case when v_link_ok and f.verified then v_link else '' end,
             'group_link_status',
               case when v_link = '' then 'missing'
                    when not v_link_ok then 'invalid'
                    when not f.verified then 'driver_not_verified'
                    else 'ok' end,
             'city_name_ar', v_city.name_ar,
             'city_name_en', v_city.name_en)
      from facts f
     where n.id = f.id
    returning n.id, n.payload->>'notice_kind' as kind, n.chat_id, n.language_code,
              n.payload, n.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'notice_id', c.id,
           'kind', c.kind,
           'chat_id', c.chat_id::text,
           'language_code', c.language_code,
           'payload', c.payload,
           'attempts', c.attempts,
           'max_attempts', v_max_attempts,
           'claim_token', v_token
         )), '[]'::jsonb)
    into v_rows
    from claimed c;

  return jsonb_build_object('ok', true, 'notices', v_rows, 'skipped', v_skipped);
end;
$$;

comment on function claim_subscription_notices(uuid) is
    'حجزُ دفعةِ إشعاراتِ الاشتراكِ لمدينةٍ (WR-35): يُلغي إشعارَ المحظورِ (RECIPIENT_BLOCKED) وإشعارَ النهايةِ الذي تجاوزه تجديدٌ (SUPERSEDED_BY_RENEWAL)، ويُحدِّثُ رابطَ قروبِ غيرِ المشتركين من إعدادِ المدينةِ لحظةَ الحجزِ مع group_link_status.';

revoke execute on function claim_subscription_notices(uuid) from public, anon, authenticated;
grant execute on function claim_subscription_notices(uuid) to service_role;
