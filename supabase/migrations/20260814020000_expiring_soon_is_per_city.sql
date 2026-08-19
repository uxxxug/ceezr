-- ---------------------------------------------------------------------------
-- الغرض: حصرُ `subscriptions_expiring_soon` بمدينةٍ واحدة. الدالّةُ كانت تُعيد
--   اشتراكاتِ **كلّ** المدن، والمهمّةُ التي تُناديها مسجَّلةٌ لكلّ مدينة
--   (`warn-expiring:<cityId>`)، والمشغّلُ يُطلق المهامَّ المستحقّةَ بـ`Promise.all`
--   في نفس النبضة، والقفلُ الموزّع مفتاحُه اسمُ المهمّة — فأقفالُ المدن الخمس
--   مختلفة ولا تمنع التزامن.
--   والنتيجةُ المقيسة: خمسُ مهامٍّ تقرأ نفسَ القائمة قبل أن تكتب أيٌّ منها
--   `subscription.expiry_warned`، فيصل السائقَ الواحدَ **خمسُ** رسائلِ تحذيرٍ
--   متطابقة. وشرطُ `not exists` يمنع التكرارَ بين الأشواط لا داخل الشوط.
--   والعيبُ الثاني أهدأ وأسوأ: `days` تُقرأ من إعدادات مدينةِ المهمّة ثمّ تُطبَّق
--   على سائقي المدن الأخرى — فمدينةٌ ضبطت التحذيرَ على يومٍ يُحذَّر سائقوها قبل
--   خمسة أيّامٍ لأنّ مدينةً أخرى ضبطته على خمسة.
-- الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً:
--   packages/infrastructure/subscription/lifecycle-adapters.ts،
--   packages/application/subscription/expire-subscriptions.ts،
--   apps/workers/src/container.ts (مهمّة warn-expiring لكلّ مدينة)
-- ملاحظات مستقبلية: أيُّ دالّةٍ تُناديها مهمّةٌ مسجَّلةٌ لكلّ مدينة يجب أن تأخذ
--   `p_city_id` وتُرشِّح به. القاعدةُ العامّة: نطاقُ المهمّة ونطاقُ استعلامها واحد.
--
-- الصيغةُ القديمة (`integer` وحدَها) تُحذَف لا تُترَك: بقاؤها يعني أنّ نداءً ناسياً
-- للمدينة يُترجم صامتاً إلى النسخةِ العابرةِ للمدن فيعود العيبُ نفسُه.
-- ---------------------------------------------------------------------------

drop function if exists subscriptions_expiring_soon(integer);

create or replace function subscriptions_expiring_soon(
  p_city_id uuid,
  p_days integer default 2
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if p_city_id is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_REQUIRED');
  end if;

  if p_days is null or p_days < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_DAYS');
  end if;

  if not exists (select 1 from cities where id = p_city_id) then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND');
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_rows
    from (
      select s.id            as subscription_id,
             s.city_id       as city_id,
             s.driver_id     as driver_id,
             s.status        as status,
             s.plan          as plan,
             u.telegram_id   as telegram_id,
             u.language_code as language_code,
             e.ends_at       as ends_at,
             greatest(0, ceil(extract(epoch from (e.ends_at - now())) / 86400.0)::integer)
                             as days_left
        from subscriptions s
        join drivers d on d.id = s.driver_id
        join users   u on u.id = d.user_id
        cross join lateral (
          select case when s.status = 'trialing' then s.trial_ends_at else s.current_period_end end
        ) as e(ends_at)
       -- الترشيحُ بمدينة الاشتراك لا بمدينة السائق: هما واحدٌ اليوم، والاشتراكُ هو
       -- ما يُحذَّر عليه، فالنطاقُ يُقرأ من صفّه.
       where s.city_id = p_city_id
         and s.status in ('trialing', 'active')
         and e.ends_at is not null
         and e.ends_at > now()
         and e.ends_at <= now() + make_interval(days => p_days)
         and u.is_blocked = false
         -- المقارنة بين تاريخين كلاهما من القاعدة نفسها (انظر تعليق الترحيل الأصلي):
         -- تمريرُ التاريخ عبر التطبيق يقتطع الميكرو ثانية فلا يُطابق الأصل.
         and not exists (
               select 1 from audit_log a
                where a.action = 'subscription.expiry_warned'
                  and a.entity_id = s.id
                  and (a.payload ->> 'ends_at')::timestamptz = e.ends_at
             )
       order by e.ends_at asc
    ) x;

  return jsonb_build_object('ok', true, 'subscriptions', v_rows);
end;
$$;

revoke all on function subscriptions_expiring_soon(uuid, integer)
  from public, anon, authenticated;
grant execute on function subscriptions_expiring_soon(uuid, integer) to service_role;
