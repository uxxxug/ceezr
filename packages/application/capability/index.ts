/**
 * الغرض: تجميع حالات استخدام وحدة capability (قدرة السائق/المركبة).
 * الحالة: هيكل فقط — لا تنفيذ، وهذا قرار مالك المنتج الصريح لا نقص. المطابقة في
 *   الإطلاق التجاري الأول **بالقرب الجغرافي فقط** (ST_DWithin في match_order)، ولا
 *   تُصفّى بالقدرة. لا تُضِف منطقاً هنا قبل أمر تفعيل صريح.
 * ينتمي إلى: application/capability
 * التنفيذ الفعلي اليوم: لا يوجد ولا يُفترض وجوده — انظر §10 من أمر الإطلاق التجاري
 *   («تصفية السائقين بالقدرة: المطابقة الجغرافية كافية للإطلاق»).
 *
 * ## الأساس المستقبلي — موثَّق هنا كي لا يُعاد تصميمه من الصفر (§4.6)
 *
 * ### النطاق المقصود عند التفعيل
 * تصفية مرشّحي التوزيع بقدرة المركبة قبل البثّ، لا بعده:
 * - **نوع المركبة**: `small` (سيدان/ركوب حتى ٤)، `medium` (فان/٧ ركّاب أو طرود متوسطة)،
 *   `pickup` (شاحنة صغيرة/سطحة للأثاث والبضائع).
 * - **متطلّبات خاصة**: `air_conditioned` (تكييف)، `open_bed` (سطح مكشوف)،
 *   `refrigerated` (برادة)، `wheelchair_accessible`.
 * - **قدرة الحمولة**: `max_passengers` (عدد)، `max_load_kg` (رقم)، `cargo_volume_m3`.
 *
 * ### التوقيع المستهدف لكل دالة
 * - `declareCapability(input: { driverId, vehicleType, features, maxPassengers, maxLoadKg }, deps)`
 *   → `Promise<Result<{ capabilityId }, DeclareCapabilityError>>` — إعلانٌ أوّليّ يُوثَّق
 *   من الإدارة (كالتحقّق من اللوحة اليوم) لا يُصدّق من السائق وحده.
 * - `updateCapability(input: { driverId, patch }, deps)`
 *   → `Promise<Result<{ updated: boolean }, UpdateCapabilityError>>` — كل تعديل يُبطل
 *   التوثيق ويعيده إلى `pending` (وإلّا صار الحقل إقراراً ذاتياً بلا رقابة).
 * - `listCapableDrivers(input: { cityId, requirement, originLat, originLng, radiusMeters }, deps)`
 *   → `Promise<Result<readonly CapableDriver[], ListCapableDriversError>>` — **يُنفَّذ في
 *   SQL لا في التطبيق**: التصفية بالقدرة تُدمج في `match_order` نفسها كشرطٍ إضافي على
 *   `ST_DWithin`، وإلّا صار التوزيع رحلتين إلى القاعدة وفقد ذرّيته.
 * - `toggleAvailability(input: { driverId, available }, deps)`
 *   → `Promise<Result<{ available: boolean }, ToggleAvailabilityError>>` — التوفّر اليوم
 *   مُشتقّ من حداثة الموقع (ADR 0017)؛ لا يُخزَّن حقلٌ ثانٍ يناقضه إلّا بقرار موثَّق.
 * - `recordAttendance(input: { driverId, shiftStart, shiftEnd }, deps)`
 *   → `Promise<Result<{ recorded: true }, RecordAttendanceError>>` — للورديّات المُدارة
 *   (أسطول شركة) لا للسائق الفرد.
 *
 * ### الجدول المحتمل في القاعدة
 * ```sql
 * create table driver_capabilities (
 *   id uuid primary key default gen_random_uuid(),
 *   city_id text not null references cities(id),   -- القاعدة المطلقة: كل جدول له city_id
 *   driver_id uuid not null references drivers(id) unique,
 *   vehicle_type vehicle_type not null,            -- enum: small | medium | pickup
 *   features text[] not null default '{}',         -- air_conditioned | open_bed | ...
 *   max_passengers smallint,
 *   max_load_kg integer,
 *   verification_status verification_status not null default 'pending',
 *   updated_at timestamptz not null default now()
 * );
 * -- فهرس التوزيع: (city_id, vehicle_type, verification_status)
 * -- الصلاحيات: service_role فقط، وسحبها من public/anon/authenticated (النمط القائم).
 * ```
 *
 * ### ADR مُقترَح يُفعَّل حين يصدر قرار التنفيذ
 * `docs/adr/0028-capability-filtering-happens-in-sql-not-application.md` — يقرّر أن
 * تصفية القدرة شرطٌ داخل دالّة التوزيع الذرّية، وأن القدرة **موثَّقة إداريّاً** لا
 * مُقرَّة ذاتياً، وأن غياب إعلان قدرة يعني «صغيرة بلا متطلّبات» لا استبعاداً من التوزيع
 * (وإلّا خرج كل سائق قائم من السوق لحظة تفعيل الميزة — وهذا أخطر ما في هذا التغيير).
 */
export {};
