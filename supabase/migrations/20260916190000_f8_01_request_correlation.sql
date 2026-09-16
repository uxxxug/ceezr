-- migration-phase: expand
-- `F8-01` — **معرِّفُ وحدةِ العملِ يصلُ الصفَّ لا الجلسةَ وحدَها** (`OPS-002`).
--
-- العطبُ: الحافةُ تولِّدُ `X-Request-Id` وتُعيدُه في كلِّ ردٍّ (`F1-08` · ADR 0043)،
-- ثمَّ **يُفقَدُ**: لا سطرَ سجلٍّ يحملُه، ولا صفَّ تدقيقٍ، ولا صفَّ صندوقٍ صادرٍ.
-- فمَن أعطى المشغِّلَ معرِّفاً من ردٍّ لم يجدْ به شيئاً. وهذه الهجرةُ تُنزِلُ
-- المعرِّفَ إلى المحرِّكِ **أثراً في صفٍّ** لا غازاً يزولُ بانتهاءِ المعاملةِ.
--
-- ثلاثةُ قراراتٍ مكتوبةٍ ههنا على وجهِها:
--
--   ١) **مُشغِّلُ `before insert` لا `default current_request_id()`.**
--      الافتراضيُّ أبلغُ شكلاً، لكنَّ إضافةَ عمودٍ بافتراضيٍّ **غيرِ ثابتٍ** تُعيدُ
--      كتابةَ الجدولِ كلِّه تحتَ قفلٍ حصريٍّ — و`audit_log` أكبرُ جداولِ الكتابةِ
--      عندنا، فذاكَ نقضُ `CAP-007`/`F7-07` (هجراتٌ آمنةٌ على الإنتاجِ). والعمودُ
--      يُضافُ بلا افتراضيٍّ (تعديلُ كاتالوجٍ لحظيٌّ) ويملأُه مُشغِّلٌ واحدٌ.
--
--   ٢) **المُشغِّلُ لا يُصحِّحُ قيمةً مُمرَّرةً صراحةً** بل يملأُ الغائبَ وحدَه
--      (`new.request_id is null`). فمَن أدرجَ معرِّفاً صراحةً — وهو ما لا يفعلُه
--      أحدٌ اليومَ ويحرسُه حاجزٌ — لا يُطمَسُ عملُه صامتاً. والشكلُ يحكمُه قيدُ
--      `check` على الجدولِ نفسِه، فما لا يطابقُ الصيغةَ **يُرَدُّ في المحرِّكِ**.
--
--   ٣) **الغائبُ يبقى `null` ولا يُلفَّقُ.** لا سطرَ ههنا يولِّدُ معرِّفاً عندَ
--      الكتابةِ: صفٌّ كتبتْه مهمّةٌ دوريّةٌ لم تُوصَلْ بعدُ، أو هجرةٌ، يحملُ `null`
--      — «لم يُقَسْ» أصدقُ من معرِّفٍ يُوهِمُ ربطاً بطلبٍ لا وجودَ له.
--
-- والصيغةُ نسخةٌ محكومةٌ من `CORRELATION_ID_SHAPE` في
-- `packages/infrastructure/observability/correlation.ts` — يحرسُ تطابقَهما
-- `scripts/check-request-correlation.ts`، فلا تفترقانِ صامتتَينِ.
--
-- وقيودُ `check` تُضافُ `not valid` (القاعدة ٢ في `supabase/migrations/README.md`)
-- وتُصادَقُ في هجرةِ طورِ `validate` تاليةٍ.
--
-- وما ليسَ ههنا، مُعلَناً: **لا OpenTelemetry ولا `traceparent`** — تلكَ مَورِدٌ
-- مُستضافٌ لا شِفرةٌ، محجوبةٌ بالقرارِ المفتوحِ `DEC-17`.

-- ----------------------------------------------------------------------------
-- 1) قارئُ المعرِّفِ من المعاملةِ الجاريةِ
--    `current_setting(…, true)` أي: لا ترمِ إن لم يُعرَّفِ المتغيرُ — وغيابُه
--    هوَ الحالُ الطبيعيُّ لكلِّ كاتبٍ غيرِ موصولٍ بعدُ.
--    و`nullif(…, '')` لأنَّ `set_config` بنصٍّ فارغٍ تُرجِعُ `''` لا `null`،
--    ونصٌّ فارغٌ في عمودِ معرِّفٍ أسوأُ من `null`: يمرُّ الفحوصَ ولا يدلُّ.
--    و`stable` لا `immutable`: القيمةُ ثابتةٌ داخلَ الجملةِ لا في الزمنِ.
-- ----------------------------------------------------------------------------
create or replace function public.current_request_id()
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  select nullif(current_setting('app.request_id', true), '');
$function$;

comment on function public.current_request_id() is
  'F8-01: معرِّفُ وحدةِ العملِ للمعاملةِ الجاريةِ، أو null إن لم تُوصَلْ. لا يولِّدُ.';

-- ----------------------------------------------------------------------------
-- 2) مالئُ العمودِ — مُشغِّلٌ واحدٌ لكلِّ الجداولِ الموصولةِ
--    الشكلُ يُفحَصُ ههنا **أيضاً** قبلَ الكتابةِ: قيمةٌ فاسدةٌ في غازِ الجلسةِ
--    (وهوَ ما لا يقعُ من طريقِ `withRequestContext` لأنّهُ يتحقَّقُ قبلَه) تُترَكُ
--    `null` فلا تُسقِطُ إدراجاً مشروعاً بسببِ مراقبةٍ. أمّا ما مُرِّرَ صراحةً
--    فيحكمُه قيدُ `check` ويُرَدُّ.
-- ----------------------------------------------------------------------------
create or replace function public.set_request_id()
returns trigger
language plpgsql
as $function$
declare
  v_request_id text;
begin
  if new.request_id is not null then
    return new;
  end if;

  v_request_id := public.current_request_id();

  if v_request_id is not null and v_request_id ~ '^[A-Za-z0-9-]{8,64}$' then
    new.request_id := v_request_id;
  end if;

  return new;
end;
$function$;

comment on function public.set_request_id() is
  'F8-01: يملأُ request_id الغائبَ من معاملةِ الطلبِ. لا يُصحِّحُ مُمرَّراً ولا يولِّدُ.';

-- ----------------------------------------------------------------------------
-- 3) الجداولُ الموصولةُ الثلاثةُ — وسببُ اختيارِ كلٍّ منها مكتوبٌ
--
--    `audit_log`         — سجلُّ «مَن فعلَ ماذا»، وهوَ الجدولُ الذي يُسألُ أوّلاً
--                          عندَ شكوى مستخدمٍ يحملُ معرِّفَ ردٍّ.
--    `notification_outbox` — عبورُ الطابورِ: الصفُّ يُكتَبُ في طلبٍ ويُسلَّمُ في
--                          عاملٍ، فهوَ **حاملُ السلسلةِ** من الحافةِ إلى العاملِ.
--    `ledger_entries`    — أثرُ المالِ. «أيُّ طلبٍ ولَّدَ هذا القيدَ» سؤالٌ
--                          تدقيقيٌّ لا يُجابُ اليومَ ألبتّةَ.
--
--    **وما ليسَ فيها دَينٌ مُعلَنٌ لا مُخضَّرٌ**: بقيّةُ الجداولِ الـ٤٧ غيرُ موصولةٍ
--    في هذه الزيادةِ، ويُسمّى ذلك في دليلِ البندِ بحرفِه.
--
--    وتصحيحٌ بالإضافةِ (`ح-8`): الحجزُ كتبَ `move_event_outbox` ثالثاً — **ولا
--    وجودَ لهذا الجدولِ في المستودعِ** (قُرِئَ جردُ الجداولِ الـ٥٠ فلم يُوجَدْ).
--    فأُبدِلَ بـ`ledger_entries` الحقيقيِّ، ولا يُمحى من الحجزِ حرفٌ.
-- ----------------------------------------------------------------------------
alter table audit_log            add column if not exists request_id text;
alter table notification_outbox  add column if not exists request_id text;
alter table ledger_entries       add column if not exists request_id text;

comment on column audit_log.request_id is
  'F8-01: معرِّفُ وحدةِ العملِ الكاتبةِ. null = كُتِبَ خارجَ وحدةِ عملٍ موصولةٍ.';
comment on column notification_outbox.request_id is
  'F8-01: معرِّفُ الطلبِ الذي أنشأَ الصفَّ — يستعيدُه العاملُ عندَ الحجزِ.';
comment on column ledger_entries.request_id is
  'F8-01: معرِّفُ وحدةِ العملِ التي ولَّدَت القيدَ الماليَّ. null = غيرُ موصولةٍ.';

-- قيودُ الشكلِ: `not valid` فلا تمسحُ الصفوفَ القائمةَ عندَ الإضافةِ
-- (كلُّها `null` اليومَ، والقيدُ يسمحُ بالـ`null` صراحةً).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'audit_log_request_id_shape'
  ) then
    alter table audit_log
      add constraint audit_log_request_id_shape
      check (request_id is null or request_id ~ '^[A-Za-z0-9-]{8,64}$') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'notification_outbox_request_id_shape'
  ) then
    alter table notification_outbox
      add constraint notification_outbox_request_id_shape
      check (request_id is null or request_id ~ '^[A-Za-z0-9-]{8,64}$') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ledger_entries_request_id_shape'
  ) then
    alter table ledger_entries
      add constraint ledger_entries_request_id_shape
      check (request_id is null or request_id ~ '^[A-Za-z0-9-]{8,64}$') not valid;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) المُشغِّلاتُ — `before insert` وحدَه: المعرِّفُ أثرُ الميلادِ لا حالةٌ تُحدَّثُ.
--    ولا يُلمَسُ حرفٌ من التسعينَ موضعَ `insert into audit_log` في الهجراتِ
--    السابقةِ: **موضعُ الكتابةِ واحدٌ ولا موضعَ نداءٍ يُنسى**.
-- ----------------------------------------------------------------------------
drop trigger if exists audit_log_set_request_id on audit_log;
create trigger audit_log_set_request_id
  before insert on audit_log
  for each row execute function public.set_request_id();

drop trigger if exists notification_outbox_set_request_id on notification_outbox;
create trigger notification_outbox_set_request_id
  before insert on notification_outbox
  for each row execute function public.set_request_id();

drop trigger if exists ledger_entries_set_request_id on ledger_entries;
create trigger ledger_entries_set_request_id
  before insert on ledger_entries
  for each row execute function public.set_request_id();

-- ----------------------------------------------------------------------------
-- 5) سطحُ PostgREST — `current_request_id()` دالّةٌ `security invoker` لا تقرأُ
--    بياناً، لكنَّ القاعدةَ الخامسةَ في `README` تفرضُ ألّا يُوسَّعَ السطحُ العلنيُّ
--    بلا قرارٍ. فتُسحَبُ الصلاحيةُ من الدورَينِ العلنيَّينِ صراحةً.
-- ----------------------------------------------------------------------------
--    **وتصحيحٌ بعدَ حكمِ CI (يُضافُ ولا يُمحى)**: أوّلُ نسخةٍ نزعَت الصلاحيةَ من
--    `anon` و`authenticated` **وحدَهما**، فأخفقَ اختبارُ سطحِ الصلاحياتِ على
--    PostgreSQL حقيقيّةٍ. والسببُ الجذريُّ: PostgreSQL يمنحُ `execute` للدورِ
--    `PUBLIC` **تلقائيّاً** عندَ إنشاءِ أيِّ دالّةٍ، و`anon` يورِّثُ منه — فنزعُ
--    الصلاحيةِ من دورٍ **لا يُبطِلُ منحةَ `PUBLIC`**. فيُنزَعُ `public` صراحةً
--    كما تفعلُ كلُّ هجراتِ الدوالِّ في المستودعِ. **ولم يُخفَّفْ الاختبارُ ولم
--    يُصنَّفْ تجاوزٌ**: العطبُ كانَ في الهجرةِ لا في الحاجزِ.
revoke all on function public.current_request_id() from public, anon, authenticated;
revoke all on function public.set_request_id() from public, anon, authenticated;
