-- migration-phase: switch
-- ────────────────────────────────────────────────────────────────────────────
-- UI-10 · تصحيحُ `read_emergency_contact`: «لا جهةَ» ليسَ «لا حساب» (ADR 0245)
--
-- الغرض: في PL/pgSQL يكونُ `record is null` صادقاً متى كانت **كلُّ** حقولِه فارغةً.
--   والدالّةُ (`20261001230000_dec_41_emergency_contact.sql`) تقرأُ عمودَي الجهةِ وحدَهما
--   ثمَّ تسألُ `if v_row is null` — فكلُّ مستخدمٍ موجودٍ لم يحفظْ جهةً بعدُ (الحالُ
--   الطبيعيّةُ الأولى) أُعيدَ له `USER_NOT_FOUND` ⇒ `GET /v1/me/emergency-contact` = 404
--   `ACCOUNT_NOT_FOUND`، ولوحةُ جهةِ الطوارئِ تعرضُ خطأَ قراءةٍ بدلَ نموذجٍ فارغ.
--
-- الدليل: متصفّحٌ حيٌّ على قاعدةٍ محلّيّةٍ بكلِّ الهجرات (UI-10)، وقراءةٌ فقط على الإنتاج
--   2026-10-07: الدالّةُ المنشورةُ تحملُ النمطَ نفسَه، و5/5 مستخدمين بلا جهة.
--
-- التصحيح: الوجودُ يُسألُ عنه بـ`found` (صفٌّ طابقَ أم لا)، لا بفراغِ القيم. لا تغييرَ
--   في التوقيعِ ولا في الصلاحيات: `create or replace` يحفظُ المالكَ والمنحَ كما هي
--   (`service_role` وحدَه — هجرةُ DEC-41)، فلا تُكرَّرُ ههنا ولا تضييقَ جديداً يُسجَّلُ
--   في `scripts/lib/rollback-registry.ts`. ومسارُ العودةِ = إعادةُ تعريفِ DEC-41 حرفاً.
--
-- الحالة: منفَّذ ومُختبَر محلّيّاً؛ تطبيقُه على الإنتاجِ فعلُ مالك.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function read_emergency_contact(
  p_telegram_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_phone text;
begin
  if p_telegram_id !~ '^[0-9]{1,19}$' then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select u.emergency_contact_name, u.emergency_contact_phone
    into v_name, v_phone
    from users u
    where u.telegram_id = p_telegram_id::bigint;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'found',
    'name', v_name,
    'phone', v_phone
  );
end;
$$;
