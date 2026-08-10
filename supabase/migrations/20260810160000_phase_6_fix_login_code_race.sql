-- ----------------------------------------------------------------------------
-- الغرض: سدّ سباق (race condition) في حدّ إصدار رموز دخول لوحة الإدارة.
--
-- العطل المكتشَف في الاختبار العدائي (القسم 4.4):
--   كانت `issue_admin_login_code` تفحص ثم تكتب بلا قفل:
--
--       select count(*) into v_recent from admin_login_codes ...   -- فحص
--       if v_recent >= p_max_per_window then ... end if;           -- قرار
--       insert into admin_login_codes ...                          -- كتابة
--
--   وبين الفحص والكتابة نافذةٌ مفتوحة. تحت عزل READ COMMITTED — وهو الافتراضي
--   في Postgres — لا ترى المعاملة المتزامنة صفوف غيرها غير المُثبَّتة، فتقرأ كل
--   واحدة عدداً أقلّ من الحدّ وتُقرّر الإصدار. النتيجة المرصودة فعلياً: عشرون
--   طلباً متزامناً أصدرت **ستّة** رموز والحدّ خمسة.
--
--   الأثر: مَن يطلب رموزاً بالتوازي يتجاوز الحدّ الذي وُضع أصلاً لمنع إغراق
--   صندوق المسؤول على تلغرام — أي أن حماية معدّل الإرسال تُلتَفّ بالتزامن وحده.
--
-- الإصلاح: قفل صفّ المستخدم `for update` قبل الفحص. يُسلسِل إصدار الرموز
--   للمستخدم الواحد فلا يقرأ اثنان العدّاد نفسه، ولا يمسّ مستخدمين آخرين لأن
--   القفل على صفّه هو. وهو نفس الاصطلاح المستعمَل في atomic_rpcs للسائقين
--   (`select * into v_driver ... for update`) — لا نمط جديد ولا آلية جديدة.
--
-- ما لم يتغيّر: التوقيع، والردّ، وكل فروع الرفض، ورسائل الأخطاء. التغيير
--   الوحيد هو `for update` على قراءة صفّ المستخدم.
-- ----------------------------------------------------------------------------

create or replace function issue_admin_login_code(
  p_telegram_id   bigint,
  p_code_hash     text,
  p_ttl_seconds   integer,
  p_max_per_window integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   users%rowtype;
  v_recent integer;
begin
  -- `for update`: القفل هنا هو الإصلاح. من دونه يقرأ المتزامنون عدّاداً واحداً
  -- قديماً فيتجاوزون الحدّ جميعاً.
  select * into v_user from users where telegram_id = p_telegram_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if v_user.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;
  if v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'USER_BLOCKED');
  end if;

  select count(*) into v_recent
  from admin_login_codes
  where user_id = v_user.id
    and created_at > now() - make_interval(secs => p_window_seconds);

  if v_recent >= p_max_per_window then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  -- رمز جديد يُبطل ما قبله: وجود رمزين صالحين معاً يوسّع سطح التخمين بلا فائدة
  update admin_login_codes
     set consumed_at = now()
   where user_id = v_user.id and consumed_at is null;

  insert into admin_login_codes (city_id, user_id, code_hash, expires_at)
  values (v_user.city_id, v_user.id, p_code_hash,
          now() + make_interval(secs => p_ttl_seconds));

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'admin.login_code_issued', 'user', v_user.id,
          jsonb_build_object('ttl_seconds', p_ttl_seconds));

  return jsonb_build_object(
    'ok', true,
    'user_id', v_user.id,
    'city_id', v_user.city_id,
    'telegram_id', v_user.telegram_id::text,
    'language_code', v_user.language_code
  );
end;
$$;

-- الصلاحيات تُعاد كما كانت: `create or replace` لا يُسقط المنِح، لكنّ إعادة
-- التصريح بها هنا تجعل الملف مقروءاً وحده بلا رجوع إلى هجرة سابقة.
revoke all on function issue_admin_login_code(bigint, text, integer, integer, integer) from public;
revoke all on function issue_admin_login_code(bigint, text, integer, integer, integer) from anon;
revoke all on function issue_admin_login_code(bigint, text, integer, integer, integer) from authenticated;
