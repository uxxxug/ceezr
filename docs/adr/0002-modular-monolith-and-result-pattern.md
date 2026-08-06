# ADR 0002 — Modular Monolith ونمط Result

**الحالة:** مقبول
**التاريخ:** الأمر الأول

## القرار
- `packages/domain/*` **لا يستورد** من `packages/infrastructure/*` إطلاقاً — فقط عبر منافذ (`ports`) يعرّفها الدومين وتُنفّذها البنية التحتية.
- كل حالة استخدام بصيغة:
  `export async function verbNoun(input: XInput, deps: XDeps): Promise<Result<T, XError>>`
- **بلا `throw`** لأخطاء العمل المتوقعة؛ الاستثناءات محصورة في أعطال تقنية غير متوقعة.

## النتائج
`packages/shared/result` هو الاعتماد الوحيد المسموح لكل الطبقات.
