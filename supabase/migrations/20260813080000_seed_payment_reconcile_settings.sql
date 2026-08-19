-- =============================================================================
-- الغرض: بذر إعدادات مراجعة الدفعات لكل مدينة، فتصير قابلةً للضبط لا مخفيّة.
-- الحالة: منفّذ فعلياً.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: apps/workers (مهمّة reconcile-pending-payments)
--
-- المهمّة تعمل بقيمٍ احتياطية مسمّاة في الكود حين يغيب المفتاح، فلا تتعطّل.
-- لكنّ إعداداً لا وجود له في `platform_settings` إعدادٌ لا يعرفه المشغّل ولا
-- يستطيع ضبطه: يبقى الرقم حبيس الكود، وتغييره يحتاج نشراً. فيُبذر صريحاً.
--
-- `is_provisional = true` لأنّ هذه أرقامٌ اخترناها بلا بياناتٍ من الإنتاج بعد:
-- كم يتأخّر ويبهوك Tap فعلاً، وكم دفعة تعلَق في اليوم. تُراجع بعد أوّل أسبوع.
-- =============================================================================

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'payment_reconcile_after_seconds', '600'::jsonb, 'number',
       'أدنى عمرٍ للدفعة المعلّقة قبل سؤال المزوّد عنها — أقصر منه يعني أنّ السائق قد يكون في صفحة الدفع الآن',
       true
from cities
on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'payment_reconcile_max_age_seconds', '172800'::jsonb, 'number',
       'سقف عمر الدفعة التي تُراجَع — بعده تكون فاتورة المزوّد قد انتهت فلا يُسأل عنها إلى الأبد',
       true
from cities
on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'payment_reconcile_batch_limit', '50'::jsonb, 'number',
       'أقصى عدد دفعات تُراجَع في شوطٍ واحد لمدينة واحدة',
       true
from cities
on conflict (city_id, key) do nothing;
