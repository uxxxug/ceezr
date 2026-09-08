-- ============================================================================
-- CAP-002 (النصفُ الثاني) — طابورُ الموتى للصندوقِ الصادرِ للإشعاراتِ
--
-- العطبُ المُعالَجُ: `finish_notification_delivery` في
-- `20260905030000_notification_outbox.sql` تُعيدُ الصفَّ إلى `pending` عندَ كلِّ
-- إخفاقٍ **بلا سقفٍ**. فـ`claim_notification_delivery` تحسبُ
-- `notification_delivery_max_attempts` وتُعيدُها في الحمولةِ باسمِ `max_attempts`
-- **ولا أحدَ يُنفِّذُها**. فصفٌّ إلى مُحادثةٍ حظرَتِ البوتَ (`403 Forbidden`) يُعادُ
-- محاولتُه أبدَ الدهرِ كلَّ ثلاثينَ ثانيةً: عملٌ لا ينتهي، وسجلٌّ يمتلئُ، وحصّةٌ
-- من حدِّ تيليجرام تُهدَرُ على ما لن ينجحَ أبداً.
--
-- والمقابلُ في هذا المستودعِ صحيحٌ أصلاً: `finish_telegram_update_job` في
-- `20260907090000_telegram_update_jobs.sql` تُميتُ الوظيفةَ عندَ
-- `attempts >= max_attempts`. فهذه الهجرةُ تُسوّي الصندوقَ الصادرَ على النمطِ
-- نفسِه: `delivered` أو `dead` أو `retried`، لا رابعَ.
--
-- ١) أعمدةٌ ثلاثةٌ للسببِ: `last_error` و`dead_reason` و`died_at`.
-- ٢) `finish_notification_delivery` تُعادُ بتوقيعٍ جديدٍ: `p_error`، وتُميتُ الصفَّ
--    عندَ استنفادِ المحاولاتِ بدلَ إعادتِه أبداً.
-- ٣) `abandon_notification_delivery` تُعادُ بسببٍ صريحٍ.
-- ٤) تراجعٌ أُسّيٌّ مسقوفٌ بدلَ الثابتِ، مع رَجرجةٍ (jitter) تمنعُ القطيعَ.
--
-- ولا سياسةَ جديدةً تُدخَلُ (القاعدةُ 0.3): السقفُ من
-- `notification_delivery_max_attempts` والأساسُ من
-- `notification_delivery_retry_seconds` — وكلاهما في `platform_settings` أصلاً،
-- ويُقرآنِ بنطاقِ المدينةِ كما تقرؤُهما `claim_notification_delivery` حرفاً.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ١) أعمدةُ السببِ
-- ----------------------------------------------------------------------------
alter table notification_outbox
  add column if not exists last_error  text,
  add column if not exists dead_reason text,
  add column if not exists died_at     timestamptz;

comment on column notification_outbox.last_error is
  'آخرُ خطأٍ نصّيٍّ من المُرسِلِ. يُمسحُ عندَ التسليمِ الناجحِ.';
comment on column notification_outbox.dead_reason is
  'سببُ الموتِ: MAX_ATTEMPTS من finish، أو ABANDONED/نصٌّ صريحٌ من abandon.';
comment on column notification_outbox.died_at is
  'لحظةُ الموتِ. لا صفَّ ميّتاً بلا لحظةٍ (قيدُ notification_dead_pair).';

-- الصفوفُ الميّتةُ السابقةُ ماتت قبلَ وجودِ العمودَينِ. تُملأُ من `updated_at`
-- (وهي لحظةُ آخرِ تغييرٍ، وآخرُ تغييرٍ لصفٍّ ميّتٍ هو إماتتُه) حتى يصحَّ القيدُ.
update notification_outbox
   set died_at = coalesce(updated_at, created_at),
       dead_reason = coalesce(dead_reason, 'ABANDONED')
 where status = 'dead' and died_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notification_dead_pair'
  ) then
    alter table notification_outbox
      add constraint notification_dead_pair check (
        (status <> 'dead') or (died_at is not null and dead_reason is not null)
      );
  end if;
end $$;

-- فهرسُ الطابورِ الميّتِ: لوحةُ الإدارةِ تسألُ «ما ماتَ في هذه المدينةِ حديثاً؟».
create index if not exists notification_outbox_dead_idx
  on notification_outbox (city_id, died_at desc)
  where status = 'dead';

-- ----------------------------------------------------------------------------
-- ٢) finish_notification_delivery — التوقيعُ يتغيّرُ فلا يكفي `create or replace`
--
--   إضافةُ وسيطٍ بقيمةٍ افتراضيّةٍ تُنشئُ **حِملاً زائداً** (overload) لا بديلاً،
--   فيصيرُ النداءُ بأربعةِ وسائطَ ملتبساً بينَ التوقيعَينِ ويُخفِقُ بـ
--   `function is not unique`. فالقديمةُ تُسقَطُ صراحةً.
--
--   و`drop` **لا يحفظُ الصلاحيّاتِ** خلافاً لـ`create or replace`، فيُعادُ
--   `revoke`/`grant` أدناهُ صراحةً. (وقد سبقَ في هذا المستودعِ أنَّ
--   SECURITY DEFINER لا يكفي وحدَه: الدالةُ المُنشأةُ تُمنحُ PUBLIC افتراضاً.)
-- ----------------------------------------------------------------------------
drop function if exists finish_notification_delivery(uuid, uuid, text, boolean);

create function finish_notification_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_message_id  text,
  p_delivered   boolean,
  p_error       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     notification_outbox%rowtype;
  v_retry   integer;
  v_max     integer;
  v_delay   numeric;
  v_cap     numeric;
begin
  if p_delivery_id is null or p_claim_token is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  end if;

  -- قفلُ الصفِّ حتى نهايةِ المعاملةِ: استرجاعُ الحجزِ المتروكِ في
  -- `claim_notification_delivery` يُحدّثُ هذا الصفَّ نفسَه، فينتظرُ حتى نلتزمَ،
  -- فلا يُوسَمُ صفٌّ من عاملٍ انتهى إيجارُه بينما هو تحتَ رمزٍ آخرَ.
  select * into v_row from notification_outbox
   where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED_BY_CALLER');
  end if;

  if p_delivered then
    update notification_outbox
       set status = 'delivered', delivered_message_id = p_message_id,
           delivered_at = now(), claim_token = null, claimed_at = null,
           last_error = null, updated_at = now()
     where id = p_delivery_id;
    return jsonb_build_object('ok', true, 'outcome', 'delivered');
  end if;

  -- السقفُ بنطاقِ المدينةِ — القراءةُ ذاتُها التي في `claim_notification_delivery`.
  select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
   where city_id = v_row.city_id and key = 'notification_delivery_max_attempts';
  if v_max is null then v_max := 3; end if;

  -- موتٌ باستنفادِ المحاولاتِ. و`attempts` زِيدَت عندَ الاستحواذِ فهي عددُ
  -- المحاولاتِ المبذولةِ فعلاً بما فيها هذه.
  --
  -- والفشلُ القاطعُ (حظرٌ، مُحادثةٌ غيرُ موجودةٍ) ليسَ من شأنِ هذه الدالةِ: له
  -- مسارُه المستقلُّ `abandon_notification_delivery` الذي يقضي فوراً بلا انتظارِ
  -- استنفادٍ. فلا وسيطَ `p_permanent` هنا — وسيطٌ لا يُمرَّرُ إلا false شيفرةٌ ميتةٌ.
  if v_row.attempts >= v_max then
    update notification_outbox
       set status = 'dead', claim_token = null, claimed_at = null,
           last_error = p_error, died_at = now(), updated_at = now(),
           dead_reason = 'MAX_ATTEMPTS'
     where id = p_delivery_id;
    return jsonb_build_object(
      'ok', true, 'outcome', 'dead', 'reason', 'MAX_ATTEMPTS',
      'attempts', v_row.attempts, 'max_attempts', v_max
    );
  end if;

  -- إعادةٌ: تراجعٌ أُسّيٌّ من الأساسِ المضبوطِ، مسقوفٌ بستّةَ عشرَ ضعفَه حتى لا
  -- يُنسى صفٌّ ساعاتٍ، ومُرَجرَجٌ بربعِ الفترةِ حتى لا يعودَ ألفُ صفٍّ أخفقَ في
  -- اللحظةِ نفسِها (بانقطاعِ تيليجرام مثلاً) دفعةً واحدةً فيُخفِقَ ألفُها ثانيةً.
  select greatest(1, (s.value #>> '{}')::integer) into v_retry
    from platform_settings s
   where s.city_id = v_row.city_id and s.key = 'notification_delivery_retry_seconds';
  if v_retry is null then v_retry := 30; end if;

  v_cap   := v_retry * 16;
  v_delay := least(v_retry * power(2, greatest(0, v_row.attempts - 1)), v_cap);
  v_delay := v_delay + (random() * v_delay * 0.25);

  update notification_outbox
     set status = 'pending', claim_token = null, claimed_at = null,
         last_error = p_error, updated_at = now(),
         next_attempt_at = now() + make_interval(secs => v_delay)
   where id = p_delivery_id;

  return jsonb_build_object(
    'ok', true, 'outcome', 'retried',
    'attempts', v_row.attempts, 'max_attempts', v_max
  );
end $$;

-- ----------------------------------------------------------------------------
-- ٣) abandon_notification_delivery — سببٌ صريحٌ ولحظةٌ (القيدُ يُلزِمُ بهما)
-- ----------------------------------------------------------------------------
drop function if exists abandon_notification_delivery(uuid, uuid);

create function abandon_notification_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_reason      text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_delivery_id is null or p_claim_token is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  end if;

  update notification_outbox
     set status = 'dead', claim_token = null, claimed_at = null,
         died_at = now(), updated_at = now(),
         dead_reason = coalesce(p_reason, 'ABANDONED'),
         last_error = coalesce(last_error, p_reason)
   where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token;

  return jsonb_build_object('ok', found);
end $$;

-- ----------------------------------------------------------------------------
-- ٤) الصلاحيّاتُ — `drop` أسقطَها فتُعادُ صراحةً. السحبُ أوّلاً ثمَّ المنحُ.
-- ----------------------------------------------------------------------------
revoke execute on function
  finish_notification_delivery(uuid, uuid, text, boolean, text)
  from public, anon, authenticated;
revoke execute on function
  abandon_notification_delivery(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function
  finish_notification_delivery(uuid, uuid, text, boolean, text)
  to service_role;
grant execute on function
  abandon_notification_delivery(uuid, uuid, text)
  to service_role;
