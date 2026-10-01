# 0225 — تقدُّمُ رفعِ الوثائقِ بالنسبةِ المئويّةِ (DEC-28)

| الحقلُ | القيمةُ |
|---|---|
| الحالةُ | مقبولٌ |
| التاريخُ | 2026-10-01 |
| السياقُ | `DEC-28` — تنشيطُ دَينٍ مُعلَنٍ |
| المرتبطُ | `documents-contract.ts` · `documents-api.ts` |

## القرارُ

استبدالُ الرفعِ بـ `fetch` (الذي لا يُعطي تقدُّماً) بـ `XMLHttpRequest` مع `upload.onprogress`
في دالّةٍ جديدةٍ `uploadFileToSlotWithProgress`. الدالّةُ الأصليّةُ `uploadFileToSlot` تبقى كما هي
للمنادينَ القائمينَ — لا مساسَ بالعقدِ (زيادةٌ لا محوٌ · `ح-8`).

## الدافعُ

`documents-contract.ts` كانَ يُعلِنُ: «لا تقدُّمَ رفعٍ بالنسبةِ المئويّةِ: `XMLHttpRequest`
وحدَه يُعطي التقدُّمَ — وهذا دَينٌ مُعلَنٌ». والسائقُ يرفعُ وثيقةً قد تُقاسُ بالميجابايتِ بلا أن
يعرفَ كم بقيَ.

## التصميمُ

- `UploadProgress = number | null` — النسبةُ المئويّةُ من ٠ إلى ١٠٠، أو `null` حينَ
  `lengthComputable = false`.
- `onProgress?: (progress: UploadProgress) => void` — اختياريٌّ، غيابُهُ يُبقي السلوكَ بلا تغييرٍ.
- `createXhr?: () => XMLHttpRequest` — مُحقَنٌ للاختبارِ.
- الرفعُ لا يزالُ مباشرةً إلى المخزنِ بالإذنِ الموقَّعِ — لا رمزَ جلسةٍ ولا مفتاحَ خدمةٍ.
- فشلُ الشبكةِ (`onerror`) وإلغاءٌ (`onabort`) يُنتجانِ `UploadFailedError(0)`.

## القياسُ

٨ اختباراتِ وحدةٍ: إرسالُ PUT الصحيح، تقدُّمٌ بالنسبةِ، `null` حينَ `lengthComputable=false`،
نجاحٌ ٢xx، فشلُ غيرِ ٢xx، خطأُ شبكةٍ، إلغاءٌ، عملٌ بلا `onProgress`.

## العواقبُ

- منادو `uploadFileToSlot` القائمونَ لا يتأثّرونَ.
- `uploadFileToSlotWithProgress` جاهزةٌ للاستخدامِ في `DocumentsScreen` حينَ يُضافُ شريطُ تقدُّمٍ.
