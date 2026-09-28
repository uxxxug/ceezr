<!-- F15 · وثيقةُ المالكِ الأصليّةُ بحرفِها — الجزءُ 3 من 5 (السطورُ 734–1112 من الأصلِ) -->
<!-- لا يُحرَّرُ هذا النصُّ (`ح-1`). التحسيناتُ والمواءمةُ مع المستودعِ في `docs/product/monthly-driver/addendum.md`. -->
<!-- بصمةُ الأصلِ كاملاً (sha256): d963419ca9262f3bd53bcc46434bb642f1b6b4b25c22a08b80bf39eae13e7f6b — الأجزاءُ بعدَ حذفِ هذه الترويسةِ ووصلِها بسطرٍ جديدٍ تُعيدُه. -->

# 33. قواعد مهمة يجب ألا يكسرها التطوير

## قاعدة 1
السائق الذي لا يقبل الخدمة الشهرية لا يستلم طلبات شهرية.

## قاعدة 2
السائق يمكن أن يكون لديه أكثر من اتفاق شهري.

## قاعدة 3
تعارض الاتفاقات لا يسمح به تلقائيًا.

## قاعدة 4
الموافقة على التعارض تأتي من الراكب الحالي.

## قاعدة 5
المنصة لا تعدل الاتفاق الأصلي بعد موافقة الراكب.

## قاعدة 6
السعر الشهري اتفاق بين الطرفين.

## قاعدة 7
الراكب لا يدفع عمولة للمنصة.

## قاعدة 8
السائق يدفع 5% إذا كان مشتركًا و10% إذا لم يكن مشتركًا.

## قاعدة 9
العطلة لا تخفض قيمة الاتفاق تلقائيًا.

## قاعدة 10
خارج ساعات الاتفاق، المنصة لا تتدخل.

## قاعدة 11
نهاية العلاقة لا تعني أن المنصة تختار بديلًا تلقائيًا.

## قاعدة 12
طلب السائق الشهري يجب أن يكون مختلفًا بصريًا عن طلب المشوار.

---

# 34. ما يجب إعادة استخدامه من ceezr

من مراجعة البنية الحالية للمشروع، توجد أجزاء قابلة لإعادة الاستخدام بدل إعادة بناء كل شيء.

منها:

- تسجيل الراكب والسائق.
- ملفات السائق.
- بيانات المركبة.
- التحقق.
- الاشتراكات.
- نظام Telegram.
- منطق المجموعات للسائقين غير المشتركين.
- matching الموجود.
- negotiation/relay.
- التقييمات.
- الشكاوى والدعم.
- حالات المستخدمين.

لكن يجب عدم افتراض أن هذه الأنظمة تمثل النموذج الشهري بالكامل.

---

# 35. الفجوة الرئيسية في ceezr

النموذج الحالي مبني بدرجة كبيرة حول:

> Ride / Order / Trip

بينما المنتج الجديد يحتاج كيانًا أساسيًا مختلفًا:

> Monthly Driver Request / Monthly Agreement / Commitment Schedule

أي أن التغيير ليس مجرد إضافة `isMonthly=true`.

ينبغي تصميم domain model حقيقي.

---

# 36. كيانات مقترحة

الأسماء مجرد اقتراح، ويجب مواءمتها مع architecture الحالية.

```text
MonthlyDriverRequest
MonthlyDriverAgreement
MonthlyAvailability
MonthlyCommitment
ScheduleConflict
ConflictApproval
MonthlyRequestPreference
```

يمكن دمج بعض هذه الكيانات إذا كانت بنية المشروع الحالية تسمح بذلك.

لكن يجب ألا يوضع كل شيء داخل `Order` إذا أدى ذلك إلى domain model مشوش.

---

# 37. بيانات MonthlyDriverRequest

اقتراح:

```text
id
riderId
requestType = MONTHLY_DRIVER
customerType
homeLocation
workLocation
daysOfWeek
startTime
endTime
monthlyAmount
priceMode = FIXED | NEGOTIABLE
vehicleType
driverGenderPreference
notes
reason
status
createdAt
updatedAt
```

يمكن إضافة:

```text
requiredStartDate
requiredEndDate
```

إذا كانت دورة المنتج تحتاج ذلك.

---

# 38. بيانات MonthlyDriverAgreement

اقتراح:

```text
id
riderId
driverId
requestId
startDate
endDate
daysOfWeek
startTime
endTime
monthlyAmount
vehicleId
status
commissionRate
commissionAmount
createdAt
endedAt
```

ويجب الاحتفاظ بسجل تاريخي.

---

# 39. الاشتراك

لا تربط الاتفاق الشهري مباشرة بمعلومة الاشتراك الحالية فقط.

عند إنشاء الالتزام المالي يجب تسجيل:

```text
commissionRate
commissionAmount
```

حتى يبقى التاريخ صحيحًا إذا تغير اشتراك السائق لاحقًا.

مثال:

```text
agreement commission = 5%
```

ثم ألغى السائق الاشتراك لاحقًا.

لا يجب أن يتغير سجل العمولة التاريخي تلقائيًا.

---

# 40. المطابقة

يجب أن يكون هناك فصل بين:

### Eligibility

هل السائق أصلًا مؤهل لرؤية الطلب؟

و:

### Ranking

من هو الأنسب من المؤهلين؟

مثال:

```text
eligible =
  acceptsMonthlyRequests
  && verified
  && customerTypeAllowed
  && genderPreferenceMatches
  && vehicleMatches
  && scheduleCompatible
```

ثم ranking يمكن أن يستخدم:

- المسافة.
- التقييم.
- الخبرة.
- الاشتراك.
- عوامل المنتج المعتمدة.

لا تغير ranking الحالي بلا سبب.

---

# 41. تنبيه مهم حول الاشتراك

الاشتراك يجب ألا يكون مجرد:

> خصم من 10% إلى 5%.

يجب فحص المزايا الموجودة حاليًا في ceezr.

إذا كانت هناك مزايا اشتراك حقيقية، حافظ عليها.

أما إذا لم توجد مزايا واضحة، فلا تخترع مزايا تجارية جديدة دون قرار من صاحب المشروع.

---

# 42. طلبات السائق غير المشترك

المسار الحالي في ceezr يحتوي على:

- Telegram group.
- نشر بطاقة الطلب.
- claim.
- negotiation cycle.
- relay بين الطرفين.
- حماية من الاتصال العشوائي بين بقية السائقين والراكب.

يجب دراسة إمكانية إعادة استخدام هذه البنية لطلبات الشهر.

لكن:

> لا تفترض أن دورة claim الحالية للمشوار مناسبة تلقائيًا للاتفاق الشهري.

لأن الاتفاق الشهري أعلى التزامًا ويحتاج lifecycle مختلفًا.

---

# 43. ما يجب فحصه في Git قبل التنفيذ

يجب على الوكيل فحص:

```text
packages/application/
apps/miniapp/
packages/
scripts/
database migrations
Telegram bot flows
matching
subscription
driver profile
vehicle
ratings
complaints
unsubscribed group
negotiation relay
```

ويحدد لكل جزء:

```text
REUSE
MODIFY
NEW
DEPRECATE
```

---

# 44. عدم كسر المنتج الحالي

هذه الإضافة يجب ألا تكسر:

- طلبات المشاوير.
- طلبات التوصيل.
- السائقين الحاليين.
- اشتراكاتهم.
- Telegram flows.
- matching الحالي.
- التقييمات.
- الدعم.
- الاختبارات الحالية.

يجب أن يظل:

```text
RIDE_ORDER
```

مسارًا مستقلًا عن:

```text
MONTHLY_DRIVER
```

قدر الإمكان.

---

# 45. التمييز في البيانات

لا تعتمد فقط على اسم البطاقة في الواجهة.

يجب أن يكون نوع الطلب explicit في domain:

```text
orderType:
  RIDE
  DELIVERY
  MONTHLY_DRIVER
```

أو enum مكافئ مناسب للـ architecture الحالية.

---

# 46. التمييز في Telegram

إذا كانت الطلبات الشهرية تظهر في Telegram:

يجب أن يظهر بوضوح:

```text
🟦 طلب سائق شهري
```

أو هوية بصرية/نصية مكافئة.

ولا تجعل السائق يكتشف من التفاصيل الداخلية فقط أن الطلب شهري.

---

# 47. التسجيل — تجربة المستخدم

في onboarding للسائق:

```text
هل ترغب في استقبال طلبات السائق الشهري؟

[ نعم، أقبل ]
[ لا، لا أقبل ]
```

ثم في الإعدادات:

```text
طلبات السائق الشهري
[ مفعّل / متوقف ]
```

مع توضيح:

> يمكنك تغيير هذا الخيار لاحقًا.

---

