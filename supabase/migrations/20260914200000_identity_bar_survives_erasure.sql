-- migration-phase: expand
-- ═══════════════════════════════════════════════════════════════════════════
-- تصحيحُ `F2-11`: **الحظرُ والمقامُ يَعبُرانِ الحذفَ** — `ADR 0113`
--
-- العلّةُ التي يُصلِحُها هذا الملفُّ، مقولةً بلا تلطيفٍ: `F2-11` جعلَ الحذفَ
-- تجهيلاً، وقلبَ `users.telegram_id` إلى بديلٍ سالبٍ. وأثرُ ذلكَ أنَّ مَن عادَ
-- من تيليجرام بعدَ حذفِه **لا يُصادِفُ صفَّه** — فيُنشَأُ له صفٌّ جديدٌ:
-- `is_blocked = false`، و`rating_count = 0`. فصارَ «احذفْ حسابي» **بوّابةَ
-- تنصُّلٍ**: يُفلِتُ بها المحظورُ من حظرِه والمُساءُ تقييمُه من تقييمِه، ثمَّ
-- يعودُ إلى الركّابِ والسائقينَ أنفسِهم بوجهٍ نظيفٍ. وهذا ضررٌ على طرفٍ ثالثٍ
-- لم يطلبْ شيئاً، ولا يُوازِنُه حقُّ المحوِ.
--
-- والحلُّ ليسَ إبطالَ الحذفِ ولا الاحتفاظَ بالهُويّةِ. الحلُّ أن يُستبقى **أقلُّ
-- ما يمنعُ التنصُّلَ**: تجزئةٌ أحاديّةٌ مُفلفَلةٌ لا يُستخرَجُ منها المعرّفُ،
-- ومعها حكمانِ رقميّانِ — أمحظورٌ، وما مقامُه. لا اسمَ، ولا رقمَ، ولا معرّفَ
-- صريحٌ، ولا مدينةَ، ولا رحلةَ. فالإنسانُ يستحيلُ أن يُعرَفَ من هذا الصفِّ،
-- ويستحيلُ في الوقتِ نفسِه أن يُنكِرَ ما عليه إذا عادَ.
--
-- والأساسُ النظاميُّ مُعلَنٌ لا مُضمَرٌ: **منعُ الاحتيالِ وحمايةُ سلامةِ طرفٍ
-- ثالثٍ** — مصلحةٌ مشروعةٌ راجحةٌ على إتمامِ المحوِ في هذا القدرِ الضئيلِ
-- وحدَه. ويُقالُ للمستخدمِ في الإيصالِ وفي الشاشةِ **قبلَ** أن يضغطَ، فلا
-- يُخدَعُ بكلمةِ «حذف» — وذاكَ شرطُ صدقِ القياسِ لا مجاملةٌ.
--
-- الإنفاذُ في القاعدةِ لا في الشيفرةِ (المعيارُ الثالثُ): مُشغِّلانِ على
-- `users` — أحدُهما يكتبُ الأثرَ عندَ التجهيلِ، والآخرُ يُعيدُ تطبيقَه عندَ
-- الإنشاءِ. فلا يُوجَدُ مسارُ تسجيلٍ، حاضرٌ أو مستقبَلٌ، يُفلِتُ منهما.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ١) الفِلفِلُ: سرٌّ لا يُصدَّرُ ولا يُدوَّرُ ────────────────────────────
-- معرّفاتُ تيليجرام أعدادٌ صحيحةٌ دونَ ١٠^١١، ومجالُها يُستقصى بالقوّةِ الغاشمةِ
-- في وقتٍ يسيرٍ. فتجزئةٌ عاريةٌ بـ`sha256` **ليست إخفاءً** بل تشفيرُ لعبةٍ:
-- مَن ملكَ الجدولَ ملكَ المعرّفاتِ كلَّها. ولذا `hmac` بفِلفِلٍ عشوائيٍّ من
-- ٢٥٦ بتّاً، مخزونٌ في جدولٍ مُنزوعِ الصلاحيّاتِ لا تبلغُه إلّا دالّةٌ
-- `security definer`.
--
-- **قيدٌ مكتوبٌ لا مَنسيٌّ**: هذا الفِلفِلُ يُكتَبُ مرّةً ولا يُدوَّرُ أبداً.
-- تدويرُه يُبطِلُ كلَّ أثرٍ مكتوبٍ، ولا سبيلَ لإعادةِ اشتقاقِه لأنَّنا — عمداً —
-- لا نحتفظُ بالمعرّفاتِ الأصليّةِ. فالتدويرُ ههنا ليسَ تحسيناً أمنيّاً بل
-- **عفوٌ عامٌّ عن كلِّ محظورٍ**.
create table if not exists public.identity_hash_pepper (
  only_row boolean primary key default true,
  pepper    bytea   not null,
  created_at timestamptz not null default now(),
  constraint identity_hash_pepper_is_singleton check (only_row),
  constraint identity_hash_pepper_is_long_enough check (octet_length(pepper) >= 32)
);

comment on table public.identity_hash_pepper is
  'فِلفِلُ تجزئةِ الهُويّةِ: صفٌّ واحدٌ، سرٌّ من ٢٥٦ بتّاً، يُكتَبُ مرّةً ولا يُدوَّرُ — تدويرُه يمحو كلَّ أثرِ حظرٍ بلا رجعةٍ (ADR 0113).';

-- **لا يُفترَضُ مَقرُّ `pgcrypto`، بل يُسأَلُ عنه المُفهرِسُ**: على Supabase
-- تسكنُ الامتدادةُ مخطَّطَ `extensions`، وعلى قاعدةِ CI مخطَّطَ `public`،
-- وقاعدةٌ ثالثةٌ قد تُسكِنَها غيرَهما. وقُلنا `extensions.hmac` فمضَت الهجرةُ
-- على Supabase وسقطَت في CI بـ«schema \"extensions\" does not exist» —
-- **والعِلَّةُ أنَّ الدالّةَ `security definer` بـ`search_path` مُثبَّتٍ، فلا
-- يُغنيها اسمٌ غيرُ مُؤهَّلٍ**؛ فلا يُحَلُّ ذلكَ بتخفيفِ التثبيتِ (وهوَ ثغرةُ
-- اختطافٍ) ولا بإضافةِ `extensions` إلى المسارِ (وهوَ افتراضٌ ثانٍ)، بل
-- **بسؤالِ `pg_proc` عن مَقرِّ `hmac` وقتَ التطبيقِ** وبناءِ النصِّ به.
-- ويُسقَطُ التطبيقُ صريحاً إن غابَت — لا تجزئةَ بلا `hmac`.
do $bootstrap$
declare
  v_schema text;
begin
  select n.nspname
    into v_schema
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'hmac'
     and pg_get_function_identity_arguments(p.oid) = 'bytea, bytea, text'
   order by (n.nspname = 'extensions') desc, (n.nspname = 'public') desc, n.nspname
   limit 1;

  if v_schema is null then
    raise exception
      'ADR 0113: لا تُوجَدُ hmac(bytea, bytea, text) في أيِّ مخطَّطٍ — فعِّلْ pgcrypto قبلَ هذه الهجرةِ. ولا بديلَ أضعفَ: تجزئةٌ بلا سرٍّ تُكشَفُ بالقوّةِ الغاشمةِ لأنَّ مدى معرِّفاتِ تيليجرامَ محدودٌ.';
  end if;

  execute format(
    'insert into public.identity_hash_pepper (only_row, pepper)
     values (true, %I.gen_random_bytes(32))
     on conflict (only_row) do nothing',
    v_schema
  );

  -- الدالّةُ تُبنى بالمخطَّطِ المكتشَفِ مُؤهَّلاً في نصِّها، فيبقى
  -- `search_path` مُثبَّتاً على `public, pg_temp` ولا يُوسَّعُ.
  execute format(
    $body$
    create or replace function public.identity_hash(p_value text)
    returns text
    language sql
    stable
    security definer
    set search_path = public, pg_temp
    as $fn$
      select case
               when p_value is null or btrim(p_value) = '' then null
               else encode(
                      %I.hmac(
                        convert_to(btrim(p_value), 'utf8'),
                        (select pepper from public.identity_hash_pepper where only_row),
                        'sha256'
                      ),
                      'hex'
                    )
             end;
    $fn$
    $body$,
    v_schema
  );
end
$bootstrap$;

-- **إعلانُ الصنفِ المُعفى من القاعدةِ ٠.٤ بشرطَيه** (`ADR 0113`): هذا الجدولُ
-- لا صفَّ فيه لإنسانٍ ولا لمدينةٍ — صفٌّ واحدٌ أبديٌّ يحملُ سرَّ النشرِ. ولو
-- أُلزِمَ `city_id` لَوجبَ أن يُنسَبَ سرُّ المنصّةِ كلِّها إلى مدينةٍ بعينِها،
-- وذاكَ كذبٌ في المخطّطِ لا امتثالٌ لسيادةٍ. والإعفاءُ مقصورٌ على `city_id`:
-- `RLS` مفروضةٌ ههنا كغيرِها.
-- platform-secret: identity_hash_pepper
alter table public.identity_hash_pepper enable row level security;
revoke all on table public.identity_hash_pepper from public;
revoke all on table public.identity_hash_pepper from anon, authenticated;


comment on function public.identity_hash(text) is
  'تجزئةٌ أحاديّةٌ مُفلفَلةٌ لمعرّفٍ: تُطابِقُ ولا تكشفُ. الفارغُ يُرَدُّ فارغاً فلا يُكتَبُ أثرٌ لمعرّفٍ غيرِ موجودٍ (ADR 0113).';

revoke execute on function public.identity_hash(text) from public, anon, authenticated;
grant execute on function public.identity_hash(text) to service_role;

-- ── ٢) الأثرُ: أقلُّ ما يمنعُ التنصُّلَ ──────────────────────────────────
create table if not exists public.identity_marks (
  id               uuid primary key default gen_random_uuid(),

  -- **سيادةٌ محفوظةٌ ومطابقةٌ لا تُقيَّدُ بها** (القاعدةُ ٠.٤): يُحفَظُ
  -- `city_id` لأنَّ الأثرَ نشأَ في مدينةٍ بعينِها ويجبُ أن يُعرَفَ **أيُّ
  -- مدينةٍ حظرتْ**. ولا تُصفّى بهِ المطابقةُ أبداً: مَن حُظِرَ في جُدّةَ لا
  -- يُستأنَفُ حظرُه بالانتقالِ إلى مكّةَ، وإلّا لَكانَ تغييرُ المدينةِ بوّابةَ
  -- تنصُّلٍ ثانيةً مكانَ التي سُدَّت.
  city_id          uuid not null references cities(id) on delete restrict,

  telegram_hash    text not null unique,
  phone_hash       text,
  is_blocked       boolean not null default false,
  block_origin     text not null,
  rating_sum       integer not null default 0,
  rating_count     integer not null default 0,
  erasure_count    integer not null default 1,
  first_marked_at  timestamptz not null default now(),
  last_marked_at   timestamptz not null default now(),

  -- **الحاجزُ الذي يمنعُ أن يتسرَّبَ معرّفٌ صريحٌ إلى ههنا**: لا يُقبَلُ في
  -- خانتَي التجزئةِ إلّا أربعٌ وستّونَ خانةً ستّعشريّةً. فلو كتبَ مُهاجِرٌ
  -- مستقبَليٌّ `telegram_id::text` سهواً بدلَ `identity_hash(...)` لَرفضتْه
  -- القاعدةُ في وجهِه ولم يَمُرَّ صامتاً.
  constraint identity_marks_carry_no_plain_identity check (
    telegram_hash ~ '^[0-9a-f]{64}$'
    and (phone_hash is null or phone_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint identity_marks_rating_is_coherent check (
    rating_count >= 0 and rating_sum >= 0 and rating_sum <= rating_count * 5
  ),
  constraint identity_marks_erasure_count_is_positive check (erasure_count >= 1),
  constraint identity_marks_block_origin_is_known check (
    block_origin in ('not-blocked', 'blocked-before-erasure')
  )
);

comment on table public.identity_marks is
  'أثرُ هُويّةٍ مُجهَّلةٍ: تجزئةٌ أحاديّةٌ وحكمُ حظرٍ ومقامُ تقييمٍ — تَعبُرُ الحذفَ فيستحيلُ التنصُّلُ بالتسجيلِ من جديدٍ. لا اسمَ فيها ولا رقمَ ولا معرّفَ صريحٌ (ADR 0113 · SR-12).';

comment on column public.identity_marks.phone_hash is
  'تجزئةُ الرقمِ إن كانَ: تُمسِكُ مَن عادَ بحسابِ تيليجرام جديدٍ على الرقمِ نفسِه. وهيَ **ليست فريدةً**: قد يتشاركُ الرقمَ اثنانِ حقيقةً فلا يُحرَمُ بريءٌ بسببِ غيرِه.';

-- الفهارسُ في طورِ `index` منفصلٍ: `create index concurrently` لا يُنفَّذُ
-- داخلَ معاملةٍ (CAP-007) — ملفُّ `20260914200100`.

alter table public.identity_marks enable row level security;
revoke all on table public.identity_marks from public;
revoke all on table public.identity_marks from anon, authenticated;

-- ── ٣) الكتابةُ: مُشغِّلٌ قبلَ التجهيلِ، لا دالّةٌ تُنادى ────────────────
-- يُكتَبُ الأثرُ في `before update` لأنَّ المعرّفَ والرقمَ لا يزالانِ في `old`.
-- ولو كُتِبَ في الشيفرةِ أو في `erase_my_account` وحدَها لَأمكنَ لمسارٍ آخرَ —
-- يدُ مشرفٍ، هجرةٌ مستقبَليّةٌ، دالّةُ حذفِ سائقٍ في `SD-12` — أن يُجهِّلَ صفّاً
-- بلا أثرٍ. والمُشغِّلُ لا يُستأذَنُ.
create or replace function public.mark_identity_before_erasure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_telegram_hash text;
  v_phone_hash    text;
  v_sum           integer;
  v_count         integer;
begin
  -- الشرطُ: انتقالٌ من غيرِ مُجهَّلٍ إلى مُجهَّلٍ. والتحديثُ الثاني على صفٍّ
  -- مُجهَّلٍ سلفاً لا يُضاعِفُ العدَّ.
  if new.erased_at is null or old.erased_at is not null then
    return new;
  end if;

  v_telegram_hash := identity_hash(old.telegram_id::text);
  v_phone_hash    := identity_hash(old.phone);

  -- معرّفٌ سالبٌ لا يُجزَّأُ: هوَ بديلٌ اصطناعيٌّ لا إنسانَ خلفَه.
  if v_telegram_hash is null or old.telegram_id < 0 then
    return new;
  end if;

  -- المقامُ يُحسَبُ من **ما نالَه** لا ممّا أعطاه: تقييمُ غيرِه شهادةٌ عليهم
  -- لا عليه.
  select coalesce(sum(r.stars), 0), count(*)
    into v_sum, v_count
    from ratings r
   where r.ratee_user_id = old.id;

  insert into identity_marks as im (
    city_id, telegram_hash, phone_hash, is_blocked, block_origin,
    rating_sum, rating_count, erasure_count
  )
  values (
    old.city_id,
    v_telegram_hash,
    v_phone_hash,
    coalesce(old.is_blocked, false),
    case when coalesce(old.is_blocked, false) then 'blocked-before-erasure' else 'not-blocked' end,
    v_sum, v_count, 1
  )
  on conflict (telegram_hash) do update
    set
      -- **الحظرُ يُراكَمُ ولا يُرفَعُ**: حذفٌ ثانٍ من غيرِ محظورٍ لا يمسحُ
      -- حظراً كُتِبَ في الأوّلِ. رفعُ الحظرِ عملُ مشرفٍ مقصودٌ، لا أثرٌ
      -- جانبيٌّ لطلبِ حذفٍ.
      is_blocked    = im.is_blocked or excluded.is_blocked,
      block_origin  = case
                        when im.is_blocked or excluded.is_blocked then 'blocked-before-erasure'
                        else 'not-blocked'
                      end,
      -- والمقامُ يُجمَعُ لا يُستبدَلُ: تقييماتُ الدورةِ الثانيةِ تُضافُ إلى
      -- الأولى، فلا تُغسَلُ سيرةٌ بدورةِ حذفٍ وتسجيلٍ.
      rating_sum    = im.rating_sum + excluded.rating_sum,
      rating_count  = im.rating_count + excluded.rating_count,
      erasure_count = im.erasure_count + 1,
      phone_hash    = coalesce(excluded.phone_hash, im.phone_hash),
      city_id       = excluded.city_id,
      last_marked_at = now();

  return new;
end;
$fn$;

comment on function public.mark_identity_before_erasure() is
  'يكتبُ أثرَ الهُويّةِ لحظةَ التجهيلِ من `old` حيثُ المعرّفُ حاضرٌ. الحظرُ يُراكَمُ ولا يُرفَعُ، والمقامُ يُجمَعُ ولا يُستبدَلُ (ADR 0113).';

drop trigger if exists users_mark_identity_before_erasure on public.users;
create trigger users_mark_identity_before_erasure
  before update on public.users
  for each row
  execute function public.mark_identity_before_erasure();

-- **دالّةُ مُشغِّلٍ تُولَدُ مفتوحةً لـPUBLIC ما لم تُسحَبْ صراحةً**: منحةُ
-- التنفيذِ الضمنيّةُ يُصدِرُها المحرِّكُ لا الهجرةُ، و`alter default privileges`
-- لا يُلغيها (العِلَّةُ مشروحةٌ في `20260812000000_phase_1_seal_definer_surface`).
-- والمُشغِّلُ يعملُ بلا هذه المنحةِ — الإطلاقُ من المُشغِّلِ لا يُفحَصُ له `EXECUTE` —
-- فالسحبُ لا يُعطِّلُ شيئاً ويُغلقُ باباً. وهذا هوَ عينُ ما أخفقَ فيه أوّلُ
-- حكمٍ لـCI على هذا الفرعِ: الطبقةُ الثانيةُ في
-- `tests/integration/database-privilege-surface.test.ts` رأت ثلاثَ دوالَّ
-- قابلةً للتنفيذِ من `anon` — فالإصلاحُ ههنا في الجذرِ لا في التوكيدِ.
revoke execute on function public.mark_identity_before_erasure() from public, anon, authenticated;

-- ── ٤) القراءةُ: مُشغِّلٌ قبلَ الإنشاءِ يُعيدُ ما كانَ ──────────────────────
create or replace function public.apply_identity_mark_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_mark identity_marks%rowtype;
begin
  if new.telegram_id is null or new.telegram_id < 0 then
    return new;
  end if;

  select * into v_mark
    from identity_marks
   where telegram_hash = identity_hash(new.telegram_id::text)
   limit 1;

  -- الرقمُ طريقٌ ثانٍ: مَن هجرَ حسابَ تيليجرام وأبقى رقمَه يُمسَكُ بهِ.
  -- وتُؤخَذُ أقسى مطابقةٍ — المحظورةُ أوّلاً — فلا يُفلِتُ بصفٍّ نظيفٍ
  -- يتصادفُ معَه.
  if v_mark.id is null and new.phone is not null then
    select * into v_mark
      from identity_marks
     where phone_hash = identity_hash(new.phone)
     order by is_blocked desc, rating_count desc
     limit 1;
  end if;

  if v_mark.id is null then
    return new;
  end if;

  if v_mark.is_blocked then
    new.is_blocked := true;
  end if;

  return new;
end;
$fn$;

comment on function public.apply_identity_mark_on_signup() is
  'يُعيدُ تطبيقَ الحظرِ على صفٍّ جديدٍ يُطابِقُ أثرَ هُويّةٍ مُجهَّلةٍ — بمعرّفِ تيليجرام أو بالرقمِ. فالتسجيلُ من جديدٍ ليسَ صفحةً بيضاءَ (ADR 0113).';

drop trigger if exists users_apply_identity_mark_on_signup on public.users;
create trigger users_apply_identity_mark_on_signup
  before insert on public.users
  for each row
  execute function public.apply_identity_mark_on_signup();

revoke execute on function public.apply_identity_mark_on_signup() from public, anon, authenticated;

-- ── ٥) المقامُ يَلحَقُ الملفَّ لا الصفَّ الجذرَ ─────────────────────────────
-- `users` لا يحملُ تقييماً؛ يحملُه `riders` و`drivers`. فيُبذَرُ المقامُ
-- المحمولُ عندَ إنشاءِ الملفِّ، لا عندَ إنشاءِ المستخدمِ.
create or replace function public.seed_carried_standing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_telegram_id bigint;
  v_mark        identity_marks%rowtype;
begin
  select u.telegram_id into v_telegram_id from users u where u.id = new.user_id;
  if v_telegram_id is null or v_telegram_id < 0 then
    return new;
  end if;

  select * into v_mark
    from identity_marks
   where telegram_hash = identity_hash(v_telegram_id::text)
   limit 1;

  if v_mark.id is null or v_mark.rating_count = 0 then
    return new;
  end if;

  -- **يُبذَرُ ولا يُدهَسُ**: لو كانَ للملفِّ تقييمٌ سلفاً فهوَ أحدثُ من
  -- المحمولِ، ولا يُمسُّ.
  update riders
     set rating_count   = v_mark.rating_count,
         rating_average = round(v_mark.rating_sum::numeric / v_mark.rating_count, 2)
   where id = new.id
     and coalesce(rating_count, 0) = 0;

  return new;
end;
$fn$;

comment on function public.seed_carried_standing() is
  'يبذُرُ المقامَ المحمولَ في ملفِّ راكبٍ جديدٍ لصاحبِ أثرٍ سابقٍ. لا يدهسُ تقييماً قائماً (ADR 0113).';

drop trigger if exists riders_seed_carried_standing on public.riders;
create trigger riders_seed_carried_standing
  after insert on public.riders
  for each row
  execute function public.seed_carried_standing();

revoke execute on function public.seed_carried_standing() from public, anon, authenticated;

-- ── ٦) الإيصالُ والتنزيلُ: يقولانِ ما بقيَ ─────────────────────────────────
-- تُستبدَلُ الدالّتانِ لا لتغييرِ منطقِهما بل ليَصدُقَ ما تقولانِه. والأثرُ
-- **لا تكتبُه واحدةٌ منهما**: تكتبُه المُشغِّلاتُ أعلاه، وهُما تقرآنِ ما كُتِبَ.
-- فمصدرُ الحقيقةِ واحدٌ (المعيارُ الثاني).
create or replace function export_my_data(p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user       users;
  v_rider      riders;
  v_city_name  text;
begin
  if p_telegram_id is null then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_ACTOR');
  end if;

  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'USER_NOT_FOUND');
  end if;

  if v_user.erased_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'ACCOUNT_ERASED');
  end if;

  select * into v_rider from riders where user_id = v_user.id;
  select c.name_ar into v_city_name from cities c where c.id = v_user.city_id;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'subject', 'rider',
    'sections', jsonb_build_object(

      -- profile ← users. لا `id` ولا `city_id`: معرّفاتٌ داخليّةٌ لا بيانةُ
      -- إنسانٍ، واسمُ المدينةِ هوَ ما يعني صاحبَها.
      'profile', jsonb_build_object(
        'telegram_id', v_user.telegram_id,
        'telegram_username', v_user.telegram_username,
        'full_name', v_user.full_name,
        'phone', v_user.phone,
        'language_code', v_user.language_code,
        'role', v_user.role,
        'city', v_city_name,
        'is_blocked', v_user.is_blocked,
        'created_at', v_user.created_at
      ),

      'riderProfile', case when v_rider.id is null then '{}'::jsonb else jsonb_build_object(
        'rating_average', v_rider.rating_average,
        'rating_count', v_rider.rating_count,
        'created_at', v_rider.created_at
      ) end,

      'savedPlaces', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', sp.kind,
          'label', sp.label,
          'latitude', st_y(sp.point::geometry),
          'longitude', st_x(sp.point::geometry),
          'created_at', sp.created_at
        ) order by sp.created_at)
        from saved_places sp where sp.user_id = v_user.id
      ), '[]'::jsonb),

      -- orders: بلا `assigned_driver_id` ولا اسمِ سائقٍ — حقُّ الوصولِ في
      -- بيانتِه لا نافذةٌ على الطرفِ الآخرِ. ويُنزَّلُ **أنَّ سائقاً أُسنِدَ**
      -- لأنَّ ذاكَ واقعةُ رحلتِه، لا **مَن هوَ**.
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'service', o.service,
          'status', o.status,
          'pickup_label', o.pickup_label,
          'dropoff_label', o.dropoff_label,
          'pickup_latitude', st_y(o.pickup::geometry),
          'pickup_longitude', st_x(o.pickup::geometry),
          'dropoff_latitude', st_y(o.dropoff::geometry),
          'dropoff_longitude', st_x(o.dropoff::geometry),
          'notes', o.notes,
          'driver_was_assigned', (o.assigned_driver_id is not null),
          'matched_at', o.matched_at,
          'started_at', o.started_at,
          'completed_at', o.completed_at,
          'cancelled_reason', o.cancelled_reason,
          'created_at', o.created_at
        ) order by o.created_at)
        from orders o
        where v_rider.id is not null and o.rider_id = v_rider.id
      ), '[]'::jsonb),

      -- ratings: ما أعطاه وما نالَه. وفي المنالِ **لا مَن كتبَه**.
      'ratings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'direction', r.direction,
          'role', case when r.rater_user_id = v_user.id then 'given' else 'received' end,
          'stars', r.stars,
          'comment', r.comment,
          'is_flagged', r.is_flagged,
          'created_at', r.created_at
        ) order by r.created_at)
        from ratings r
        where r.rater_user_id = v_user.id or r.ratee_user_id = v_user.id
      ), '[]'::jsonb),

      'consents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', uc.kind,
          'version', uc.version,
          'accepted_at', uc.accepted_at
        ) order by uc.accepted_at)
        from user_consents uc where uc.user_id = v_user.id
      ), '[]'::jsonb),

      'notificationsReceived', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', un.kind,
          'channel', un.channel,
          'payload', un.payload,
          'created_at', un.created_at,
          'read_at', un.read_at
        ) order by un.created_at)
        from user_notifications un where un.user_id = v_user.id
      ), '[]'::jsonb),

      -- supportTickets: نصُّ شكواه والرَدُّ عليها. بلا `claimed_by_user_id`
      -- ولا `resolved_by_user_id`: هُويّةُ موظَّفِ الدعمِ ليست بيانتَه.
      'supportTickets', coalesce((
        select jsonb_agg(jsonb_build_object(
          'type', st.type,
          'message', st.message,
          'status', st.status,
          'resolution', st.resolution,
          'created_at', st.created_at,
          'resolved_at', st.resolved_at
        ) order by st.created_at)
        from support_tickets st
        where st.rider_id is not null and v_rider.id is not null and st.rider_id = v_rider.id
      ), '[]'::jsonb),

      'safetyIncidents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'reporter_role', si.reporter_role,
          'status', si.status,
          'decision', si.decision,
          'last_known_latitude', st_y(si.last_known_location::geometry),
          'last_known_longitude', st_x(si.last_known_location::geometry),
          'created_at', si.created_at,
          'decided_at', si.decided_at
        ) order by si.created_at)
        from safety_incidents si where si.reporter_user_id = v_user.id
      ), '[]'::jsonb),

      -- auditTrail: الفعلُ وختمُه. **بلا `payload`** — قد يحملُ بيانةَ غيرِه،
      -- ومصدرُ حقيقةِ بيانتِه هوَ الأقسامُ أعلاه لا حِمْلُ سجلٍّ.
      'auditTrail', coalesce((
        select jsonb_agg(jsonb_build_object(
          'action', al.action,
          'entity_type', al.entity_type,
          'created_at', al.created_at
        ) order by al.created_at)
        from audit_log al where al.actor_user_id = v_user.id
      ), '[]'::jsonb),

      -- broadcastsReceived: بلا `chat_id` ولا `claim_token` — معرّفُ محادثةٍ
      -- ورمزٌ نافذٌ. ويُنزَّلُ أنَّه بُلِّغَ ومتى.
      'broadcastsReceived', coalesce((
        select jsonb_agg(jsonb_build_object(
          'status', br.status,
          'language_code', br.language_code,
          'sent_at', br.sent_at,
          'created_at', br.created_at
        ) order by br.created_at)
        from broadcast_recipients br where br.user_id = v_user.id
      ), '[]'::jsonb),

      -- tripTrackingTokens: **وجودُ** رابطِ مشاركةٍ لا قيمتُه. رمزٌ نافذٌ في
      -- ملفٍّ يُنزَّلُ على جهازٍ هوَ مفتاحٌ عاملٌ بيدِ مَن يقرأُ الملفَّ.
      'tripTrackingTokens', coalesce((
        select jsonb_agg(jsonb_build_object(
          'created_at', tt.created_at,
          'expires_at', tt.expires_at,
          'revoked_at', tt.revoked_at,
          'token_disclosed', false
        ) order by tt.created_at)
        from trip_tracking_tokens tt where tt.created_by = p_telegram_id
      ), '[]'::jsonb),

      -- identityBar: **أثرُ حذفٍ سابقٍ إن كانَ**. ولا تُنزَّلُ التجزئةُ نفسُها:
      -- سِلسِلةُ ستّينَ خانةً لا تُفيدُ صاحبَها شيئاً، وإخراجُها يُسلِّمُ لمَن
      -- يقرأُ الملفَّ **مفتاحَ مطابقةٍ** يُثبِتُ به أنَّ فلاناً هوَ فلانٌ.
      -- والمُنزَّلُ هوَ الحكمُ الذي يمسُّه: أمحظورٌ هوَ، وكم مرّةً حُذِفَ،
      -- وهل حُمِلَ تقييمُه (ADR 0113).
      'identityBar', coalesce((
        select jsonb_build_object(
          'is_blocked', im.is_blocked,
          'erasure_count', im.erasure_count,
          'rating_count_carried', im.rating_count,
          'first_marked_at', im.first_marked_at,
          'last_marked_at', im.last_marked_at,
          'hash_disclosed', false
        )
        from identity_marks im
        where im.telegram_hash = identity_hash(p_telegram_id::text)
      ), 'null'::jsonb)
    )
  );
end;
$fn$;
comment on function export_my_data(bigint) is
  'حزمةُ بياناتِ صاحبِ الحسابِ محمولةً: أعمدةٌ مُسمّاةٌ لا *، بلا بيانةِ الطرفِ الآخرِ وبلا رمزٍ نافذٍ — وأقسامُها مُقابَلةٌ بسجلِّ الحذفِ في الحاجزِ (F2-11 · SR-12 · ADR 0112). وزِيدَ في الإيصالِ قسمُ `identityBar`: أثرٌ مُجزَّأٌ يَعبُرُ الحذفَ فيمنعُ التنصُّلَ بالتسجيلِ من جديدٍ — يكتبُه مُشغِّلٌ لا هذه الدالّةُ، وتقرؤُه هيَ بعدَ التجهيلِ فلا تقولُ إلّا ما قِيسَ (ADR 0113).';

revoke execute on function export_my_data(bigint) from public, anon, authenticated;
grant execute on function export_my_data(bigint) to service_role;


create or replace function erase_my_account(p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user            users;
  v_rider_id        uuid;
  v_active          integer;
  v_places          integer;
  v_notifications   integer;
  v_tokens          integer;
  v_orders          integer;
  v_broadcasts      integer;
  v_consents        integer;
  v_ratings         integer;
  v_bar_rows        integer;
  v_tickets         integer;
  v_incidents       integer;
  v_audit           integer;
  v_sentinel        bigint;
  v_receipt         jsonb;
begin
  if p_telegram_id is null then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_ACTOR');
  end if;

  -- القفلُ **قبلَ** كلِّ قراءةٍ تُبنى عليها كتابةٌ: طلبٌ يُنشأُ بينَ الفحصِ
  -- والتجهيلِ يجعلُ الفحصَ كذباً، والقفلُ على صفِّ المستخدمِ هوَ ما يُسلسِلُ
  -- إنشاءَ الطلبِ معَ الحذفِ (مسارُ الطلبِ يقرأُ صفَّ صاحبِه).
  select * into v_user from users where telegram_id = p_telegram_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'USER_NOT_FOUND');
  end if;

  if v_user.erased_at is not null then
    -- إعادةٌ لا خطأٌ: الطلبُ الثانيَ يجدُ الحالَ المطلوبَ قائماً.
    return jsonb_build_object(
      'ok', true, 'reason', 'ALREADY_ERASED', 'erased_at', v_user.erased_at
    );
  end if;

  -- حسابُ السائقِ بندٌ آخرُ (`SD-12`) وجداولُه مالٌ واشتراكٌ. ونصفُ حذفٍ أسوأُ
  -- من لا حذفٍ: يُرَدُّ صريحاً لا يُنفَّذُ ناقصاً.
  if v_user.role <> 'rider' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_A_RIDER', 'role', v_user.role);
  end if;

  select r.id into v_rider_id from riders r where r.user_id = v_user.id;

  if v_rider_id is not null then
    select count(*) into v_active
      from orders o
     where o.rider_id = v_rider_id
       and o.status in ('searching', 'matched', 'in_progress');
    if v_active > 0 then
      return jsonb_build_object('ok', false, 'reason', 'ACTIVE_ORDER', 'active_orders', v_active);
    end if;
  end if;

  -- ── ما يُمحى صفّاً: مِلكُه وحدَه ─────────────────────────────────────────
  with gone as (delete from saved_places where user_id = v_user.id returning 1)
    select count(*) into v_places from gone;

  with gone as (delete from user_notifications where user_id = v_user.id returning 1)
    select count(*) into v_notifications from gone;

  -- `created_by` معرّفُ تيليجرام لا `uuid` (نصُّ الهجرةِ `F7-01`): يُطابَقُ
  -- بالوسيطِ نفسِه، ويُمحى **قبلَ** تجهيلِ المعرّفِ وإلّا لم يُطابِقْ شيئاً.
  with gone as (delete from trip_tracking_tokens where created_by = p_telegram_id returning 1)
    select count(*) into v_tokens from gone;

  -- ── ما يُجهَّلُ: يبقى الصفُّ ويُمحى ما يُعرَفُ به إنسانٌ ─────────────────
  if v_rider_id is not null then
    with hushed as (
      update orders
         set notes = null, pickup_label = null, dropoff_label = null
       where rider_id = v_rider_id
         and (notes is not null or pickup_label is not null or dropoff_label is not null)
      returning 1
    ) select count(*) into v_orders from hushed;
  else
    v_orders := 0;
  end if;

  -- المعرّفُ البديلُ يُسحَبُ مرّةً واحدةً ويُستعمَلُ في الموضعَينِ: صفُّ
  -- المستخدمِ وصفوفُ التبليغِ. و`chat_id` عليه `check (chat_id <> 0)` فلا
  -- يُصفَّرُ — وتصفيرُه كانَ سيُسقِطُ الحذفَ كلَّه بقيدٍ لا بخطأِ منطقٍ.
  v_sentinel := -nextval('erased_account_telegram_seq');

  with hushed as (
    update broadcast_recipients
       set chat_id = v_sentinel, claim_token = null
     where user_id = v_user.id
    returning 1
  ) select count(*) into v_broadcasts from hushed;

  if v_rider_id is not null then
    update riders set rating_average = null, rating_count = 0 where id = v_rider_id;
  end if;

  -- ── ما بقيَ بأساسٍ: يُعَدُّ ليُقالَ في الإيصالِ، ولا يُمَسُّ ───────────────
  select count(*) into v_consents  from user_consents   where user_id = v_user.id;
  select count(*) into v_ratings   from ratings         where rater_user_id = v_user.id or ratee_user_id = v_user.id;
  select count(*) into v_tickets   from support_tickets where v_rider_id is not null and rider_id = v_rider_id;
  select count(*) into v_incidents from safety_incidents where reporter_user_id = v_user.id;
  select count(*) into v_audit     from audit_log       where actor_user_id = v_user.id;

  -- ── تجهيلُ الجذرِ: به تنقطعُ نسبةُ كلِّ ما بقيَ إلى إنسانٍ ────────────────
  update users
     set telegram_id       = v_sentinel,
         telegram_username = null,
         full_name         = null,
         phone             = null,
         is_blocked        = true,
         erased_at         = now()
   where id = v_user.id;

  -- **الأثرُ يُقرأُ بعدَ التجهيلِ لا قبلَه، ولا تكتبُه هذه الدالّةُ**: كتبَه
  -- المُشغِّلُ `users_mark_identity_before_erasure` في أثناءِ التحديثِ أعلاه.
  -- فما يُقالُ في الإيصالِ **مَقيسٌ من الصفِّ** لا مُفترَضٌ من نيّةِ الشيفرةِ،
  -- ولو سقطَ المُشغِّلُ يوماً لَقالَ الإيصالُ صفراً ولم يَكذِبْ (ADR 0113).
  select count(*) into v_bar_rows
    from identity_marks im
   where im.telegram_hash = identity_hash(p_telegram_id::text);

  v_receipt := jsonb_build_object(
    'erased', jsonb_build_object(
      'savedPlaces', v_places,
      'notificationsReceived', v_notifications,
      'tripTrackingTokens', v_tokens
    ),
    'anonymized', jsonb_build_object(
      'profile', 1,
      'riderProfile', case when v_rider_id is null then 0 else 1 end,
      'orders', v_orders,
      'broadcastsReceived', v_broadcasts
    ),
    'retained', jsonb_build_array(
      jsonb_build_object('section', 'consents',        'rows', v_consents,  'basis', 'CONSENT_IS_COMPLIANCE_EVIDENCE'),
      jsonb_build_object('section', 'ratings',         'rows', v_ratings,   'basis', 'RATING_IS_TESTIMONY_FOR_THE_OTHER_PARTY'),
      jsonb_build_object('section', 'supportTickets',  'rows', v_tickets,   'basis', 'SUPPORT_RECORD_MAY_BE_DISPUTED'),
      jsonb_build_object('section', 'safetyIncidents', 'rows', v_incidents, 'basis', 'SAFETY_REPORT_MAY_BE_DISPUTED'),
      jsonb_build_object('section', 'auditTrail',      'rows', v_audit,     'basis', 'AUDIT_TRAIL_PROVES_THIS_ERASURE'),
      jsonb_build_object('section', 'identityBar',     'rows', v_bar_rows,  'basis', 'BLOCK_AND_STANDING_SURVIVE_ERASURE')
    )
  );

  -- الإيصالُ يُقيَّدُ في `audit_log`: صنفُه هناكَ «لا مدّةَ له» وهوَ عينُ ما
  -- يلزمُ إيصالَ حذفٍ. والفاعلُ صاحبُ الحسابِ نفسُه، ومفتاحُه `restrict` فلا
  -- يذهبُ الإيصالُ معَ الصفِّ.
  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'account.erased', 'user', v_user.id, v_receipt);

  return jsonb_build_object('ok', true, 'reason', 'ERASED', 'erased_at', now(), 'receipt', v_receipt);
end;
$fn$;
comment on function erase_my_account(bigint) is
  'حذفُ حسابِ الراكبِ بطلبِه: معاملةٌ واحدةٌ تحتَ قفلِ صفِّه — يُمحى ما يملكُه وحدَه، ويُجهَّلُ ما للطرفِ الآخرِ فيه حقٌّ، ويبقى ما له أساسٌ نظاميٌّ؛ ويُرَدُّ إيصالٌ مُصنَّفٌ يقولُ ما بقيَ ولِمَ بقيَ ويُقيَّدُ في audit_log. ويُرَدُّ الطلبُ عندَ رحلةٍ جاريةٍ أو لغيرِ راكبٍ (F2-11 · SR-12 · ADR 0112). وزِيدَ في الإيصالِ قسمُ `identityBar`: أثرٌ مُجزَّأٌ يَعبُرُ الحذفَ فيمنعُ التنصُّلَ بالتسجيلِ من جديدٍ — يكتبُه مُشغِّلٌ لا هذه الدالّةُ، وتقرؤُه هيَ بعدَ التجهيلِ فلا تقولُ إلّا ما قِيسَ (ADR 0113).';

revoke execute on function erase_my_account(bigint) from public, anon, authenticated;
grant execute on function erase_my_account(bigint) to service_role;
