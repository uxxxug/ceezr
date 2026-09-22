-- migration-phase: expand
-- ---------------------------------------------------------------------------
-- `SEC-19` · الخطوةُ الأولى — مركزُ الإشعاراتِ يُقرَأُ بالهويّةِ الداخليّةِ
--
-- **المسألةُ مقيسةٌ لا مُستنتَجةٌ**: مركزُ الإشعاراتِ **يُكتَبُ** بمفتاحٍ داخليٍّ
-- — `notification_outbox_record_in_center()` تُدرِجُ `user_id = recipient_user_id`
-- وهيَ تأتي من `resolve_notification_recipient(...)` التي تُحوِّلُ **كلَّ نوعٍ**
-- إلى `users.id` — **ويُقرَأُ** بمفتاحٍ خارجيٍّ:
--
--     get_user_notifications(p_telegram_id bigint, ...)
--     mark_notification_read(p_telegram_id bigint, ...)
--
-- فمَن فُكَّ ربطُه بتيليجرام تُكتَبُ إشعاراتُه ولا يقدرُ على قراءتِها. وأثرُ
-- ذلكَ أنَّ **القناةَ البديلةَ ليست بديلاً**: هيَ مستقلّةٌ في التخزينِ وتابعةٌ
-- في القراءةِ، فتسقُطُ بسقوطِ الأصلِ لاشتراكِهما في المفتاحِ عينِه.
--
-- ووجودُ مركزٍ في المخطَّطِ **لا يُثبِتُ وجودَ قناةٍ بديلةٍ**؛ لا تُعَدُّ موجودةً
-- حتّى يقرأَ مَن لا يملِكُ `telegram_id` إشعاراتَه بهويّتِه الداخليّةِ. ولذلكَ
-- تسبِقُ هذه الهجرةُ كلَّ حرسٍ على مسالكِ الإرسالِ: بلا بديلٍ عاملٍ يصيرُ وصفُ
-- إشعارٍ بأنّه «غيرُ جوهريٍّ» دعوىً بلا سندٍ.
--
-- **وما لا تفعلُه هذه الهجرةُ (`ح-5` · حصرُ الأثرِ):**
--   · لا تلمسُ `users` ولا `telegram_id` ولا قيدَ `not null` — ولا عمودَ فيه.
--   · لا تنزِعُ التوقيعَ القديمَ ولا تُغيِّرُ عقدَه: نفسُ المُدخَلاتِ، ونفسُ
--     المُخرَجاتِ، ونفسُ رمزِ الخطأِ `USER_NOT_FOUND` — فلا متعامِلٌ ينكسِرُ،
--     ولا سطرَ TypeScript يُعدَّلُ في هذه الهجرةِ (`ح-8` · إضافةٌ لا حذفٌ).
--   · لا تُحصِّنُ مسلكَ إرسالٍ واحداً؛ ذاكَ طورٌ تالٍ.
--
-- **والمنطقُ يُنقَلُ ولا يُنسَخُ**: التوقيعُ القديمُ يصيرُ **غلافاً** يحلُّ
-- الهويّةَ ثمَّ يُفوِّضُ. ونسختانِ من منطقِ القراءةِ كانتا ستتباعَدانِ عندَ أوّلِ
-- تصحيحٍ يُطبَّقُ على إحداهما، وذاكَ مصدرُ حقٍّ ثانٍ يُخالِفُ الأوّلَ.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ١) القراءةُ بالهويّةِ الداخليّةِ — وهيَ الآنَ موضعُ المنطقِ
--
--    التفويضُ ههنا **مفروضٌ على المنادي** لا مُشتَقٌّ في الدالّةِ: الغلافُ
--    القديمُ يشتقُّ المستخدمَ من معرِّفٍ مُستخرَجٍ من رمزٍ وقّعناهُ، أمّا هذه
--    فتأخُذُ `users.id` مُسلَّماً. فهيَ **لا تُمنَحُ لـ`anon` ولا
--    `authenticated`** ألبتّةَ — كحالِ سابقتِها — ويبقى سطحُها `service_role`
--    وحدَه، أي البوّابةَ بعدَ تحقُّقِ جلسةٍ. ولو مُنِحَت للعميلِ لصارَت قراءةُ
--    موجَزِ غيرِكَ **قابلةً للتعبيرِ** بتمريرِ معرِّفٍ آخرَ، وذاكَ نقضٌ لِما
--    بُنيَ في `F6-05` قصداً (القسم 9.8).
--
--    و«لا مستخدمَ بهذا المعرِّفِ» يُعادُ عنه `USER_NOT_FOUND` عينُه: رمزٌ ثالثٌ
--    كانَ سيُفشي للمنادي أنَّ الصفَّ موجودٌ وأنَّ الخللَ في مكانٍ آخرَ.
-- ---------------------------------------------------------------------------

create or replace function get_user_notifications_by_user_id(
  p_user_id uuid,
  p_limit integer default 20,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_items jsonb;
  v_unread integer;
  v_exists boolean;
begin
  -- وجودُ المستخدِمِ يُتحقَّقُ صراحةً: بلا ذلكَ كانَ معرِّفٌ لا وجودَ لهُ
  -- يُعيدُ موجَزاً فارغاً `ok = true` فلا يُميَّزُ «لا إشعاراتَ لكَ» من
  -- «لا وجودَ لكَ» — وهوَ صمتٌ يُخفي عطبَ استدعاءٍ في البوّابةِ.
  select exists (select 1 from users u where u.id = p_user_id) into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc), '[]'::jsonb)
    into v_items
    from (
      select n.id, n.kind, n.channel, n.payload, n.created_at, n.read_at
        from user_notifications n
       where n.user_id = p_user_id
         and (p_before is null or n.created_at < p_before)
       order by n.created_at desc
       limit v_limit
    ) t;

  select count(*)::integer into v_unread
    from user_notifications n
   where n.user_id = p_user_id and n.read_at is null;

  return jsonb_build_object('ok', true, 'items', v_items, 'unread', v_unread);
end $$;

-- ---------------------------------------------------------------------------
-- ٢) التوقيعُ القديمُ يبقى — غلافاً يحلُّ الهويّةَ ثمَّ يُفوِّضُ
--
--    ولا يُنزَعُ: كلُّ مَن لهُ ربطٌ قائمٌ يقرأُ بهِ اليومَ، ونزعُه نقضٌ لِـ`ح-8`
--    وانحدارٌ بلا سببٍ. ومتى غابَ الربطُ أعادَ `USER_NOT_FOUND` كما كانَ
--    يفعلُ حرفاً — **وهذا هوَ بعينِه العطبُ الذي يُصلِحُهُ المسلكُ الجديدُ**،
--    لا عطبٌ في الغلافِ: فالسؤالُ «مَن يملِكُ هذا المعرِّفَ الخارجيَّ؟» ليسَ
--    لهُ جوابٌ متى لم يَعُدْ أحدٌ يملِكُه.
-- ---------------------------------------------------------------------------

create or replace function get_user_notifications(
  p_telegram_id bigint,
  p_limit integer default 20,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  select u.id into v_user from users u where u.telegram_id = p_telegram_id;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  return get_user_notifications_by_user_id(v_user, p_limit, p_before);
end $$;

-- ---------------------------------------------------------------------------
-- ٣) الوسمُ مقروءاً — بالهويّةِ الداخليّةِ كذلكَ
--
--    ولا قيمةَ لموجَزٍ يُقرَأُ ولا يُوسَمُ: عدَّادُ «غيرِ المقروءِ» يبقى يعلو
--    بلا سبيلٍ إلى إنقاصِه، فيصيرُ المركزُ مُشتكىً لا بديلاً.
--
--    وخصائصُ السابقةِ محفوظةٌ بحرفِها ولم تُلمَسْ: القيمةُ السابقةُ تُقرَأُ
--    **تحتَ قفلِ الصفِّ** فيُميَّزُ «وُسِمَ الآنَ» من «كانَ موسوماً»؛ و«لا وجودَ
--    له» لا يُفرَّقُ من «ليسَ لك» فلا يصيرُ المسارُ عرّافاً يُثبِتُ للمهاجمِ
--    وجودَ إشعارِ غيرِه؛ والوسمُ ثابتُ الأثرِ بـ`coalesce` فلا يُعادُ كتابةُ
--    الطابعِ الأوّلِ بكلِّ نقرةٍ.
-- ---------------------------------------------------------------------------

create or replace function mark_notification_read_by_user_id(
  p_user_id uuid,
  p_notification_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior_read_at timestamptz;
  v_found boolean := false;
  v_read_at timestamptz;
  v_exists boolean;
begin
  select exists (select 1 from users u where u.id = p_user_id) into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select n.read_at into v_prior_read_at
    from user_notifications n
   where n.id = p_notification_id and n.user_id = p_user_id
     for update;
  v_found := found;

  if not v_found then
    return jsonb_build_object('ok', false, 'error', 'NOTIFICATION_NOT_FOUND');
  end if;

  update user_notifications n
     set read_at = coalesce(n.read_at, now())
   where n.id = p_notification_id and n.user_id = p_user_id
  returning n.read_at into v_read_at;

  return jsonb_build_object(
    'ok', true,
    'read_at', v_read_at,
    'already_read', v_prior_read_at is not null
  );
end $$;

create or replace function mark_notification_read(
  p_telegram_id bigint,
  p_notification_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  select u.id into v_user from users u where u.telegram_id = p_telegram_id;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  return mark_notification_read_by_user_id(v_user, p_notification_id);
end $$;

-- ---------------------------------------------------------------------------
-- ٤) إغلاقُ السطحِ — و`create or replace` يُعيدُ المنحَ ضمنيّاً فيُنزَعُ صراحةً
--
--    هذا ليسَ احتياطاً زائداً: `create or replace` على دالّةٍ قائمةٍ **يُعيدُ
--    منحَ التنفيذِ**، فهجرةٌ تُعيدُ كتابةَ دالّةٍ ولا تنزعُ تنفيذَها تفتحُ بابَها
--    من جديدٍ للمفتاحِ العامِّ — وذاكَ ما يقيسُه حاجزُ عقدِ سطحِ الدعمِ.
-- ---------------------------------------------------------------------------

revoke execute on function get_user_notifications_by_user_id(uuid, integer, timestamptz) from public, anon, authenticated;
revoke execute on function mark_notification_read_by_user_id(uuid, uuid) from public, anon, authenticated;
revoke execute on function get_user_notifications(bigint, integer, timestamptz) from public, anon, authenticated;
revoke execute on function mark_notification_read(bigint, uuid) from public, anon, authenticated;

grant execute on function get_user_notifications_by_user_id(uuid, integer, timestamptz) to service_role;
grant execute on function mark_notification_read_by_user_id(uuid, uuid) to service_role;
grant execute on function get_user_notifications(bigint, integer, timestamptz) to service_role;
grant execute on function mark_notification_read(bigint, uuid) to service_role;
