-- migration-phase: expand
-- الغرض: بحثٌ عربيٌّ مُطبَّعٌ ضبابيٌّ في سجلِّ الرحلاتِ — البند `F2-08` (دَينٌ في `ADR 0108`)
--
-- ## ماذا يُضيف
--
-- - `pg_trgm`: امتدادُ المطابقةِ الضبابيّةِ بالمثلثاتِ الحرفيّةِ (`trigram`).
-- - تعديلُ `rider_ride_history` ليُطَبِّعَ نصَّ البحثِ والوسومَ بدالّةِ
--   `normalize_search_text` القائمةِ من `F2-03` (لا دالّةٌ جديدةٌ — القاعدة 0.6)،
--   ويُضيفَ المطابقةَ الضبابيّةَ بالمثلثاتِ (`%`) إلى جانبِ `ilike` القائمِ.
--
-- ## ولماذا `normalize_search_text` من `F2-03` لا `unaccent`
--
-- `unaccent` يُطَبِّعُ اللاتينيَّةَ لا العربيّةَ، و`normalize_search_text` القائمةُ
-- تطوي صورَ الحرفِ العربيِّ كلَّها (أإآ → ا، ة → ه، ى → ي) وتحذفُ التشكيلَ والتطويلَ.
-- فلا دالّةٌ جديدةٌ ولا امتدادٌ لا يخدمُ العربيّةَ.
--
-- ## الثباتُ والفهرسُ
--
-- `normalize_search_text` `immutable` — شرطُ العمودِ المُولَّدِ والفهرسِ. والفهرسُ
-- المُعبِّرُ عنه `gin_trgm_ops` على `normalize_search_text(pickup_label)` يُبنى
-- في هجرةِ `index` تاليةٍ.
--
-- ## ما لا يُدَّعى
--
-- - لا بحثَ عن المعالمِ ولا عن الأماكنِ — هذا البحثُ على وسومِ الطلبِ
--   (`pickup_label` · `dropoff_label`) في سجلِّ الراكبِ وحدَه.
-- - لا `unaccent` — `normalize_search_text` تكفي.
-- - لا عمودٌ مُولَّدٌ جديدٌ — الفهرسُ تعبيريٌّ على الدالّةِ القائمةِ.

create extension if not exists pg_trgm;

-- تعديلُ `rider_ride_history` — البحثُ المُطبَّعُ الضبابيُّ
create or replace function public.rider_ride_history(
  p_telegram_id        bigint,
  p_query              text        default null,
  p_before_created_at  timestamptz default null,
  p_before_id          uuid        default null,
  p_limit              integer     default 20
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_user_id   uuid;
  v_rider_id  uuid;
  v_city_id   uuid;
  v_tz_raw    text;
  v_tz        text;
  v_tz_source text;
  v_query     text;
  v_query_norm text;
  v_rows      jsonb;
  v_has_more  boolean;
  v_next      jsonb;
begin
  -- الحدُّ يُرَدُّ ولا يُقصَرُ صامتاً: عميلٌ طلبَ ألفَ صفٍّ يجبُ أن يعرفَ أنَّه
  -- لم يُعطَ ألفاً، لا أن يظنَّ سجلَّه انتهى عندَ الخمسينَ.
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LIMIT');
  end if;

  -- المؤشِّرُ جزآنِ لا يُفترقانِ: نصفُ مفتاحٍ يُنتِجُ حدَّ صفحةٍ غيرَ حاسمٍ.
  if (p_before_created_at is null) <> (p_before_id is null) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CURSOR');
  end if;

  select u.id, u.city_id into v_user_id, v_city_id from users u where u.telegram_id = p_telegram_id;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select r.id, r.city_id into v_rider_id, v_city_id from riders r where r.user_id = v_user_id;
  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_REGISTERED');
  end if;

  -- المنطقةُ الزمنيّةُ: إعدادُ المدينةِ، ويُتحقَّقُ أنَّها اسمٌ **تعرفُه القاعدةُ**
  -- قبلَ استعمالِها — و`at time zone 'مدينةٌ لا وجودَ لها'` يرفعُ استثناءً
  -- يُسقِطُ القراءةَ كلَّها، وسجلُّ رحلاتٍ لا يُقرأُ بسببِ حرفٍ في إعدادٍ أسوأُ
  -- من عنوانِ شهرٍ بـUTC مُعلَنٍ.
  v_tz_raw := nullif(trim(coalesce(get_setting(v_city_id, 'ride_history_month_timezone') #>> '{}', '')), '');

  if v_tz_raw is null then
    v_tz := 'UTC';
    v_tz_source := 'FALLBACK_UTC_SETTING_ABSENT';
  elsif not exists (select 1 from pg_timezone_names z where z.name = v_tz_raw) then
    v_tz := 'UTC';
    v_tz_source := 'FALLBACK_UTC_SETTING_UNKNOWN';
  else
    v_tz := v_tz_raw;
    v_tz_source := 'CITY_SETTING';
  end if;

  -- البحثُ: نصٌّ يُطابَقُ على لافتتَي الطرفَينِ **داخلَ صفوفِ هذا الراكبِ وحدَه**.
  -- والنصُّ الفارغُ **ليسَ بحثاً**: يُعامَلُ معدوماً فلا يُمسَحُ الجدولُ بشرطٍ
  -- يُطابِقُ كلَّ شيءٍ.
  --
  -- والآنَ: **تطبيعٌ ومطابقةٌ ضبابيّةٌ**. `normalize_search_text` من `F2-03`
  -- تطوي صورَ الحرفِ العربيِّ كلَّها وتحذفُ التشكيلَ، و`pg_trgm` يُطابِقُ
  -- بالمثلثاتِ الحرفيّةِ (`%`) فيتحمَّلُ الخطأَ في الحرفِ أو الحرفَينِ.
  -- ف«الرياض» تُطابِقُ «الرياظ» و«الرياض» و« ال رياض».
  --
  -- والمطابقةُ على **النصِّ المُطبَّعِ** لا الخامِّ — فالفهرسُ المُعبِّرُ
  -- عنهُ (في هجرةِ `index`) على `normalize_search_text(pickup_label)`
  -- يُستعمَلُ للوصلةِ الضبابيّةِ ولـ`ilike` معاً.
  v_query := nullif(trim(coalesce(p_query, '')), '');
  v_query_norm := normalize_search_text(v_query);

  -- `p_limit + 1` صفّاً: الصفُّ الزائدُ **يُقاسُ ولا يُنشَرُ** — هوَ الجوابُ عن
  -- «أثمَّةَ مزيدٌ؟» بلا عدٍّ ثانٍ للجدولِ كلِّه. ولا جدولَ مؤقَّتاً: الاتّصالُ
  -- يمرُّ بمُجمِّعِ معاملاتٍ، وجدولٌ مؤقَّتٌ فيه يعيشُ أطولَ من الطلبِ الذي
  -- أنشأَه فيُقرأُ في طلبِ راكبٍ آخرَ.
  with page as (
    select o.id,
           o.status::text        as status,
           o.service::text       as service,
           o.pickup_label,
           o.dropoff_label,
           o.created_at,
           o.completed_at,
           to_char(o.created_at at time zone v_tz, 'YYYY-MM') as month_key
      from orders o
     where o.rider_id = v_rider_id
       and (p_before_created_at is null
            or (o.created_at, o.id) < (p_before_created_at, p_before_id))
       and (v_query_norm is null
            or normalize_search_text(o.pickup_label) ilike '%' || v_query_norm || '%'
            or normalize_search_text(o.dropoff_label) ilike '%' || v_query_norm || '%'
            or normalize_search_text(o.pickup_label) % v_query_norm
            or normalize_search_text(o.dropoff_label) % v_query_norm)
     order by o.created_at desc, o.id desc
     limit p_limit + 1
  ), kept as (
    select * from page order by created_at desc, id desc limit p_limit
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'order_id',      k.id,
               'status',        k.status,
               'service',       k.service,
               'pickup_label',  k.pickup_label,
               'dropoff_label', k.dropoff_label,
               'created_at',    k.created_at,
               'completed_at',  k.completed_at,
               'month_key',     k.month_key
             ) order by k.created_at desc, k.id desc
           ), '[]'::jsonb),
         (select count(*) from page) > p_limit,
         -- المؤشِّرُ التالي هوَ **آخرُ صفٍّ مُنشَرٍ** لا الصفُّ الزائدُ: الصفحةُ
         -- التاليةُ تبدأُ ممّا بعدَ ما قرأَه العميلُ فعلاً.
         (select jsonb_build_object('created_at', k2.created_at, 'id', k2.id)
            from kept k2 order by k2.created_at asc, k2.id asc limit 1)
    into v_rows, v_has_more, v_next
    from kept k;

  return jsonb_build_object(
    'ok', true,
    'month_timezone', v_tz,
    'month_timezone_source', v_tz_source,
    'query', v_query,
    'limit', p_limit,
    'rides', v_rows,
    'has_more', v_has_more,
    -- ولا يُنشَرُ مؤشِّرٌ حينَ لا مزيدَ: مؤشِّرٌ يُعيدُ صفحةً فارغةً يجعلُ العميلَ
    -- يسألُ سؤالاً يعرفُ الخادمُ جوابَه سلفاً.
    'next_cursor', case when coalesce(v_has_more, false) then v_next else null end
  );
end;
$function$;

comment on function public.rider_ride_history(bigint, text, timestamptz, uuid, integer) is
  'F2-08 / SR-09: صفحةُ سجلِّ رحلاتِ الراكبِ بمفتاحٍ (created_at, id) مُصنَّفةً بالشهرِ بمنطقةٍ مُعلَنةٍ. قراءةٌ محضةٌ بلا أيِّ حقلٍ ماليٍّ (ADR 0039 §4). البحثُ مُطبَّعٌ ضبابيٌّ: `normalize_search_text` + `pg_trgm` (ADR 0108).';

revoke execute on function rider_ride_history(bigint, text, timestamptz, uuid, integer) from public, anon, authenticated;
