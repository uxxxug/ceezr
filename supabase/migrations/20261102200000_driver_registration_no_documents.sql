-- =============================================================================
-- تسجيلُ السائقِ بلا رفعِ وثائقَ — قرارُ المالكِ 2026-11-02 (ADR 0302)
-- =============================================================================
--
-- ## القرارُ
--
-- لا يُطلبُ منَ السائقِ رفعُ وثائقَه أو صورِه (هويةٌ أو رخصةٌ أو استمارةٌ
-- أو فحصٌ …) شرطًا للتسجيلِ أو للتفعيلِ. تجربةُ السائقِ: بياناتٌ مكتوبةٌ،
-- وإثباتُ رقمِه عبرَ بوتِ السائقِ (`PRD-105` قائمٌ لم يُمسَّ)، وموقعٌ يُشارِكُه
-- ويُحدِّثُه، ومراجعةٌ إداريّةٌ تقرَّرُ على البياناتِ المكتوبةِ.
--
-- ## الآليّةُ — سياسةٌ مقروءةٌ لا حذفُ بنيةٍ
--
-- 1. `driver_required_document_types` تعيدُ الآنَ مصفوفةً **فارغةً** إذا كانَ
--    الإعدادُ **موجودًا صريحًا** ويساوي `[]`: هذا هو معنى «لا وثيقةَ مطلوبةً».
--    وغيابُ الإعدادِ أو تلفُهُ يبقى **مغلقًا على كلِّ الأنواعِ** (fail-closed)
--    كما كانَ — فلا يُفتَحُ البابُ لخطأِ إعدادٍ صامتٍ.
-- 2. تُحدَّثُ قيمةُ الإعدادِ إلى `[]` لكلِّ مدينةٍ قائمةٍ، وتُدرَجُ لكلِّ مدينةٍ
--    بلا إعدادٍ — فتصيرُ سياسةُ «لا وثائقَ مطلوبةً» هي المعلَنةَ في كلِّ
--    المدنِ، وتُدارُ من `platform_settings` بلا هجرةٍ إن عادَت.
-- 3. بذلكَ تُفرَغُ `driver_document_block_reasons` تلقائيًّا، فيَعبُرُ حارسُ
--    `F12-21` في `admin_set_driver_verification`، ويَفتحُ التوزيعُ (`F12-14`)
--    الطريقَ للسائقِ المؤهَّلِ، وتَسكُتُ تحذيراتُ الانتهاءِ — كلُّ ذلكَ منَ
--    المصدرِ نفسِه لا استثناءاتٍ موضعيّةٍ.
--
-- ## ما لم يُمسَّ
--
-- - جدولُ `driver_documents` وسجلُّه القائمُ (6 وثائقٍ `under_review`) يبقيانِ
--   للتاريخِ والتدقيقِ؛ لا حذفَ ولا تعديلَ. ولا يُحجبُ بهما سائقٌ بعدَ اليوم.
-- - نظامُ التخزينِ (ADR 0294) ومرفقاتُ المحادثةِ (ADR 0280) لم يمسَّهما شيءٌ.
-- - مسارُ الرفعِ (`DRIVER_DOCUMENT_UPLOADS`) باقٍ لمن أرادَ الرفعَ اختياريًّا
--   أو لمن أعادَ الإعدادَ — لكن لا شرطَ ولا حجبَ بعده.
--
-- ## التراجعُ
--
-- `update platform_settings set value = '["driving_license","medical_exam","criminal_record","vehicle_registration","insurance","periodic_inspection"]'::jsonb where key = 'driver_required_document_types';`
-- يعيدُ الحجبَ كلَّهُ بلا أيِّ تغييرٍ في الشيفرةِ.
-- =============================================================================

create or replace function driver_required_document_types(p_city_id uuid)
returns driver_document_type[]
language plpgsql
stable
set search_path = public
as $$
declare
    v_value jsonb;
begin
    select value into v_value
    from platform_settings
    where city_id = p_city_id and key = 'driver_required_document_types';

    -- الإعدادُ **الحاضرُ الصريحُ** كَمصفوفةٍ فارغةٍ = لا وثيقةَ مطلوبةً (ADR 0302).
    -- الغيابُ أو التلفُ = كلُّ الأنواعِ: البوّابةُ مغلقةٌ إلا بقرارٍ معلَن.
    if v_value is not null and jsonb_typeof(v_value) = 'array' then
        return array(select value #>> '{}'
                     from jsonb_array_elements(v_value));
    end if;
    return array(select enum_range(null::driver_document_type))::driver_document_type[];
end;
$$;

comment on function driver_required_document_types(uuid) is
    'الأنواعُ الإلزاميّةُ من وثائقِ السائقِ لمدينةٍ — من platform_settings حصراً. مصفوفةٌ حاضرةٌ صريحةً = لا إلزامَ (ADR 0302، قرارُ المالكِ 2026-11-02)؛ وغيابُ الإعدادِ أو تلفُه = كلُّ الأنواعِ (fail-closed).';

-- السياسةُ المعلَنةُ: لا وثائقَ مطلوبةً — تحديثُ القائمِ وإدراجُ الناقصِ.
update platform_settings
set value = '[]'::jsonb
where key = 'driver_required_document_types';

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'driver_required_document_types', '[]'::jsonb, 'array',
       'الأنواعُ الإلزاميّةُ من وثائقِ السائقِ — مصفوفةٌ فارغةٌ = لا وثيقةَ مطلوبةً للتسجيلِ أو التفعيلِ (قرارُ المالكِ 2026-11-02، ADR 0302). أعدِ تعبئتَها بالأنواعِ لإعادةِ الإلزامِ.',
       false
from cities
on conflict (city_id, key) do nothing;
