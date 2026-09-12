-- migration-phase: expand
-- =============================================================================
-- الغرض: سجلُّ موافقاتِ المستخدمِ على الشروطِ وسياسةِ الخصوصيّةِ **بختمٍ زمنيٍّ
--    مسجَّلٍ** — البند `F2-01` (SR-01) والقسم 9.12.
-- الحالة: منفّذ فعلياً — 2026-09-12 · البند `F2-01`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/consent/consent-store.ts` عبرَ الدالّةِ
--    `record_user_consent` وحدَها، و`apps/gateway/src/routes/consents.ts`.
-- ملاحظات مستقبلية: `F2-11` («تنزيلُ بياناتي» و«حذفُ حسابي») يقرأُ هذا الجدولَ
--    كاملاً؛ وحذفُ الحسابِ لا يحذفُ الموافقةَ بل يُنهيها، فالسجلُّ القانونيُّ
--    يُثبِتُ أنَّ الموافقةَ كانت — وموضعُ ذاكَ هجرةٌ لاحقةٌ بعمودِ إنهاءٍ لا حذفُ
--    صفوفٍ ههنا.
--
-- ## لماذا `city_id` من صفِّ المستخدمِ لا من العميلِ
--
-- القاعدةُ 0.4 تُوجِبُ `city_id` على كلِّ جدولٍ بلا استثناءٍ. ومصدرُه ههنا
-- `users.city_id` الذي هوَ `not null` منذُ المخطَّطِ الأساسيِّ، **يُقرأُ داخلَ
-- الدالّةِ** لا يُمرَّرُ وسيطاً. ولو كانَ وسيطاً لأمكنَ تسجيلُ موافقةٍ في مدينةٍ
-- ليست مدينةَ صاحبِها، وذاكَ تلويثُ بيانٍ لا حقلٌ خاطئٌ يُصحَّحُ لاحقاً.
--
-- ## ولماذا الإصدارُ عمودٌ في المفتاحِ الفريدِ
--
-- الفريدُ `(user_id, kind, version)` لا `(user_id, kind)`: الموافقةُ على إصدارٍ
-- ليست الموافقةَ على تاليه. فلو كانَ الفريدُ بلا إصدارٍ لَوَجَبَ عندَ تحديثِ
-- الوثيقةِ إمّا تحديثُ الصفِّ — فيُمحى أنَّ المستخدمَ وافقَ على القديمِ ومتى — أو
-- إنشاءُ صفٍّ ثانٍ يكسرُ الفريدَ. فالتاريخُ يُحفَظُ صفّاً لكلِّ إصدارٍ، ولا
-- `update` على هذا الجدولِ إطلاقاً.
--
-- ## ولماذا `text` وقيدُ `check` لا نوعٌ معدودٌ
--
-- صنفُ الوثيقةِ مُعلَنٌ في `packages/domain/consent/consent-documents.ts` وهوَ
-- مصدرُ الحقيقةِ الوحيدُ (القاعدةُ 0.6). ونوعٌ معدودٌ في القاعدةِ يصيرُ مصدراً
-- ثانياً يحتاجُ هجرةً مع كلِّ صنفٍ جديدٍ؛ والقيدُ النصّيُّ ههنا يُقابِلُه الحاجزُ
-- `scripts/check-consent-documents.ts` حرفاً بحرفٍ، فينكسرُ البناءُ إن انحرفا —
-- وهذا فرقُ «مصدرانِ يتباعدانِ صامتَينِ» عن «مصدرٌ وصورةٌ مُقابَلةٌ آليّاً».
--
-- ## والختمُ الزمنيُّ من الخادمِ
--
-- `accepted_at` تُمرَّرُ من الخادمِ لا من الجهازِ: ختمُ جهازٍ قابلٌ للتقديمِ
-- والتأخيرِ، وسجلٌّ قانونيٌّ بختمٍ يملكُه المُوافِقُ نفسُه لا يُحتَجُّ به. والدالّةُ
-- لا تأخذُ افتراضاً `now()` كي لا يختلفَ الختمُ عن لحظةِ القرارِ في الطلبِ.
-- =============================================================================

create table if not exists user_consents (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid not null references cities(id),
  user_id     uuid not null references users(id) on delete cascade,
  -- الصنفُ والإصدارُ نصّانِ، ومصدرُهما سجلُّ النطاقِ لا هذا الملفُّ.
  kind        text not null check (kind in ('privacy_policy', 'terms_of_service')),
  version     text not null check (length(version) > 0),
  accepted_at timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (user_id, kind, version)
);

alter table user_consents enable row level security;

-- لا سياسةَ لـ`anon` ولا لـ`authenticated`: لا يلمسُ هذا الجدولَ إلا دورُ الخدمةِ
-- عبرَ الدالّةِ أدناه. والتطبيقُ المصغَّرُ لا يتّصلُ بالقاعدةِ مباشرةً أصلاً: يمرُّ
-- بالبوّابةِ بجلسةٍ موقَّعةٍ منّا (القسم 9.8). وحينَ تُوجَدُ قراءةٌ مباشرةٌ من
-- العميلِ تُضافُ سياستُها بهجرتِها ومُنادِيها واختبارِها لا احتياطاً اليومَ.
drop policy if exists user_consents_service_all on user_consents;
create policy user_consents_service_all on user_consents
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- `record_user_consent` — كتابةٌ ذرّيّةٌ مُتماثِلةٌ (القاعدة 0.5)
--
-- تُعيدُ `jsonb` لا صفّاً: الحالةُ («سُجِّلَ» أم «كانَ مسجَّلاً») جزءٌ من الجوابِ
-- لا يُستنتَجُ من عددِ الصفوفِ المُعادةِ. و`on conflict do nothing` ثمَّ قراءةُ
-- الصفِّ القائمِ تجعلُ النداءَ الثانيَ لا يُحرِّكُ ختمَ الأوّلِ: إعادةُ إرسالٍ من
-- شبكةٍ ضعيفةٍ (UX-4) لا تُقدِّمُ لحظةَ موافقةٍ حدثَت قبلَ دقيقةٍ.
-- ----------------------------------------------------------------------------
drop function if exists record_user_consent(bigint, text, text, timestamptz);

create or replace function record_user_consent(
  p_telegram_id bigint,
  p_kind text,
  p_version text,
  p_accepted_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   users;
  v_row    user_consents;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    -- لا يُنشَأُ صفُّ مستخدمٍ ههنا (ADR 0035): غيابُه حالةٌ تُعادُ لا تُصنَعُ.
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  insert into user_consents (city_id, user_id, kind, version, accepted_at)
  values (v_user.city_id, v_user.id, p_kind, p_version, p_accepted_at)
  on conflict (user_id, kind, version) do nothing;

  select * into v_row from user_consents
    where user_id = v_user.id and kind = p_kind and version = p_version;

  return jsonb_build_object(
    'ok', true,
    -- «سُجِّلَ الآنَ» يُعرَفُ بأنَّ ختمَ الصفِّ هوَ الختمُ المُمرَّرُ: مقارنةٌ على
    -- البيانِ نفسِه لا على `found` الذي تُغيِّرُه العبارةُ التاليةُ.
    'status', case when v_row.accepted_at = p_accepted_at then 'recorded' else 'already_recorded' end,
    'accepted_at', v_row.accepted_at,
    'city_id', v_row.city_id
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- `list_user_consents` — قراءةٌ واحدةٌ لكلِّ ما وافقَ عليه صاحبُ المعرّفِ
--
-- تُعيدُ الصفوفَ كلَّها لا «الجاريَ» منها: قرارُ الكفايةِ في
-- `packages/domain/consent/consent-decision.ts`، وإخراجُ قرارٍ إلى SQL يجعلُ له
-- مصدرَينِ. والقاعدةُ تحفظُ، والنطاقُ يحكمُ.
-- ----------------------------------------------------------------------------
drop function if exists list_user_consents(bigint);

create or replace function list_user_consents(p_telegram_id bigint)
returns table (kind text, version text, accepted_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select c.kind, c.version, c.accepted_at
    from user_consents c
    join users u on u.id = c.user_id
   where u.telegram_id = p_telegram_id
   order by c.accepted_at asc;
$$;
