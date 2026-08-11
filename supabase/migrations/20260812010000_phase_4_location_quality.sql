-- المرحلة ٤ — جودة الموقع القانوني
--
-- ADR-0015 يقرّ `drivers.last_location` مصدراً وحيداً للحقيقة لموقع السائق.
-- ومقيّم المرحلة ٣ يُنتج ثلاثة أحكام لا حكمين: مقبول، ومقبول متدهوّر (WARNING)،
-- ومقبول مريب (ALERT). فإن خُزّن الموضع وحده ضاع الحكم، وعادت القاعدة تعرض
-- إحداثيةً بلا ما يُميّز الدقيقة من الخشنة — وهو ما يجعل المطابقة تثق بما لا
-- يستحقّ الثقة. فالحقلان أدناه يجعلان الجودة جزءاً من السجل لا أثراً في سجلّ.

alter table drivers
  add column if not exists last_location_accuracy_m double precision,
  add column if not exists last_location_quality text;

-- الحكم قيمة مُعرَّفة لا نصّ حرّ: القيد يمنع تسرّب تهجئة ثالثة تكسر كل قارئ.
alter table drivers
  drop constraint if exists drivers_last_location_quality_valid;
alter table drivers
  add constraint drivers_last_location_quality_valid
  check (last_location_quality is null
         or last_location_quality in ('ACCEPT', 'WARNING', 'ALERT'));

-- الدقّة السالبة لا معنى لها فيزيائياً، والقاعدة آخر حاجز يمنع دخولها.
alter table drivers
  drop constraint if exists drivers_last_location_accuracy_nonneg;
alter table drivers
  add constraint drivers_last_location_accuracy_nonneg
  check (last_location_accuracy_m is null or last_location_accuracy_m >= 0);

comment on column drivers.last_location_accuracy_m is
  'نصف قطر الخطأ بالمتر كما بلّغ عنه الجهاز — null يعني أن المصدر لم يُبلّغ دقّة.';
comment on column drivers.last_location_quality is
  'حكم assessGpsFix على الإصلاحة المخزَّنة: ACCEPT | WARNING | ALERT. المرفوضة لا تُخزَّن.';
