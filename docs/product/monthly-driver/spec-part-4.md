<!-- F15 · وثيقةُ المالكِ الأصليّةُ بحرفِها — الجزءُ 4 من 5 (السطورُ 1113–1481 من الأصلِ) -->
<!-- لا يُحرَّرُ هذا النصُّ (`ح-1`). التحسيناتُ والمواءمةُ مع المستودعِ في `docs/product/monthly-driver/addendum.md`. -->
<!-- بصمةُ الأصلِ كاملاً (sha256): d963419ca9262f3bd53bcc46434bb642f1b6b4b25c22a08b80bf39eae13e7f6b — الأجزاءُ بعدَ حذفِ هذه الترويسةِ ووصلِها بسطرٍ جديدٍ تُعيدُه. -->

# 48. عدم إرسال الطلبات للسائق غير المهتم

هذه قاعدة business-critical.

لا يكفي أن نعرض Badge للسائق.

بل يجب أن تدخل حالة القبول في:

- matching.
- notification.
- Telegram group.
- push.
- أي قناة توزيع مستقبلية.

---

# 49. البحث عن السائق

عند نشر الراكب طلبًا:

```text
Monthly Request
      ↓
Eligibility Filtering
      ↓
Matching
      ↓
Candidate Drivers
      ↓
Notification / Distribution
      ↓
Negotiation
      ↓
Agreement
```

---

# 50. الجانب التجاري

الميزة الأساسية للمنصة ليست أن المنصة "توظف" السائق.

بل أنها:

> تنظم سوقًا كان يحدث غالبًا بطريقة فردية وغير منظمة.

القيمة التي تقدمها:

- توفير وقت البحث.
- الوصول إلى سائقين معروفين/موثقين وفق نظام المنصة.
- مطابقة منظمة.
- معلومات السيارة.
- تفضيلات واضحة.
- تقييمات.
- شكاوى.
- سجل علاقات.
- إعادة فتح البحث عند انتهاء العلاقة.
- تنظيم التعارضات.
- سوق موحد لطلبات السائق الشهري.

---

# 51. لا تبالغ في تدخل المنصة

المنتج يجب ألا يتحول إلى:

- شركة توظيف.
- شركة نقل تشغل السائقين.
- مدير يومي للسائق.
- محاسب بين الطرفين.

إلا إذا صدر قرار تجاري وقانوني جديد.

النموذج الحالي:

> Platform = Marketplace / Coordinator

وليس:

> Platform = Employer.

---

# 52. أسئلة قانونية وتشغيلية يجب تركها كـ Owner Decisions

لا تفترض إجابات قانونية.

يجب وضعها في قائمة قرارات منفصلة، مثل:

- هل نموذج السائق الشهري يحتاج شروط استخدام خاصة؟
- هل يجب توضيح أن الاتفاق بين الطرفين؟
- ما المتطلبات القانونية للتحقق من السائق؟
- ما مسؤولية المنصة في حالة النزاع؟
- ما سياسة حفظ بيانات الموقع؟
- ما مدة الاحتفاظ بسجل الاتفاقات؟
- هل توجد متطلبات خاصة بنقل الأطفال أو المرضى؟
- هل توجد متطلبات تأمين/ترخيص مختلفة؟
- هل بعض أنواع العملاء تحتاج قواعد إضافية؟

هذه ليست تفاصيل يجب على الوكيل اختراعها.

---

# 53. الأمان والخصوصية

بيانات الموقع حساسة.

يجب:

- عدم كشف موقع المنزل بدقة أكثر من اللازم قبل المرحلة المناسبة.
- تحديد ما يظهر في بطاقة الطلب.
- التحكم في صلاحيات الوصول.
- تسجيل الأحداث المهمة.
- عدم تسريب رقم الهاتف أو البيانات الشخصية في group cards.
- استمرار redaction حيث تكون مطلوبة.

---

# 54. الاختبارات المطلوبة

يجب إضافة اختبارات تغطي على الأقل:

### Driver preference

```text
driver accepts monthly = true
→ eligible

driver accepts monthly = false
→ not eligible
```

### Multiple requests

```text
rider can publish request A
rider can publish request B
request B requires reason
```

### Schedule

```text
driver + rider A
driver + rider B non-overlapping
→ allowed
```

### Conflict

```text
driver + rider A
driver + rider B overlapping
→ blocked
```

### Approval

```text
rider A approves
→ rider B can proceed
```

### Rejection

```text
rider A rejects
→ rider B cannot proceed
```

### Commission

```text
subscribed = 5%
unsubscribed = 10%
```

### Historical commission

Changing subscription after agreement must not rewrite the historical commission.

### Monthly vs ride

A monthly request must not accidentally enter the ride-only lifecycle.

---

# 55. Definition of Done

لا تعتبر ميزة السائق الشهري مكتملة لمجرد:

- ظهور زر.
- تغيير لون البطاقة.
- إضافة enum.

يجب أن يعمل السيناريو الكامل:

```text
Driver registration
      ↓
Monthly acceptance preference
      ↓
Rider creates monthly request
      ↓
Request has schedule/location/value/preferences
      ↓
Matching filters eligible drivers
      ↓
Driver receives monthly request
      ↓
Driver negotiates/accepts
      ↓
Conflict detection
      ↓
Existing rider approval if needed
      ↓
Monthly Agreement
      ↓
Commission calculation
      ↓
Agreement active
      ↓
Ratings/support
      ↓
Agreement completion
      ↓
New monthly search if needed
```

---

# 56. المطلوب من الوكيل الآن

## المرحلة 1 — Audit

افحص المستودع الحالي كاملًا بما يكفي لفهم:

- Order model.
- Matching.
- Driver registration.
- Driver profile.
- Vehicle.
- Subscription.
- Telegram.
- Unsubscribed group.
- Negotiation.
- Ratings.
- Complaints.
- Notifications.
- Database.

ثم قدم جدول:

| الجزء | الموجود | قابل لإعادة الاستخدام | يحتاج تعديل | جديد |
|---|---|---:|---:|---:|
| Driver profile | | | | |
| Vehicle | | | | |
| Matching | | | | |
| Subscription | | | | |
| Telegram | | | | |
| Monthly request | | | | |
| Monthly agreement | | | | |
| Schedule | | | | |
| Conflict approval | | | | |
| Commission | | | | |
| Ratings | | | | |
| Complaints | | | | |

---

# 57. المرحلة 2 — Architecture Proposal

قبل تنفيذ الكود:

اقترح:

1. Domain model.
2. Database migrations.
3. State machines.
4. API/application commands.
5. Telegram flows.
6. Miniapp screens.
7. Matching changes.
8. Notifications.
9. Tests.

ولا تبدأ بإعادة كتابة أجزاء موجودة بدون حاجة.

---

# 58. المرحلة 3 — UI/UX

يجب أن تكون تجربة المستخدم واضحة جدًا:

### Rider

```text
[ طلب مشوار ]
[ طلب توصيل ]
[ طلب سائق شهري ]
```

### Driver

عند التسجيل:

```text
هل تقبل طلبات السائق الشهري؟
[ نعم ]
[ لا ]
```

ثم:

```text
إعدادات السائق
طلبات السائق الشهري: مفعلة
```

---

# 59. البطاقة الشهرية

البطاقة يجب أن تكون مختلفة بصريًا.

مثال تقريبي:

```text
┌──────────────────────────────┐
│  🚘 سائق شهري                │
│                              │
│  موظف                        │
│  📍 المنزل → الدوام          │
│  🗓 الأحد - الخميس           │
│  ⏰ 7:00 → 16:00             │
│                              │
│  💰 3,500 ريال / شهر         │
│  🔄 قابل للتفاوض              │
│                              │
│  🚙 سيدان                    │
│                              │
│  سبب الطلب: ...              │
│                              │
│  [ عرض الطلب ]               │
└──────────────────────────────┘
```

هذا مجرد تصور، وليس تصميمًا إلزاميًا.

---

# 60. قاعدة أخيرة مهمة

لا تخلط بين:

> **سائق شهري**

و

> **سائق محجوز 24/7 أو 10 ساعات يوميًا بلا حرية.**

السائق لديه التزامات محددة حسب الاتفاق.

ويمكنه خدمة أكثر من عميل إذا كانت الالتزامات متوافقة.

إذا حدث تعارض، يوجد نظام موافقة مع الراكب الحالي.

---

