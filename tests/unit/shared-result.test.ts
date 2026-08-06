/**
 * الغرض: اختبار حقيقي لنمط Result — الجزء الوحيد المنفّذ فعلياً في الأمر الأول.
 * الحالة: اختبار فعلي (لا هيكل) لأن packages/shared منفّذ فعلاً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: كل حالة استخدام تُفعَّل لاحقاً يجب أن يرافقها اختبار حقيقي واحد على الأقل (القاعدة 0.6).
 */
import { describe, expect, it } from "bun:test";
import {
  andThen,
  err,
  isErr,
  isOk,
  map,
  ok,
  unwrapOr,
} from "../../packages/shared/result/index.ts";

describe("Result", () => {
  it("ok يحمل القيمة", () => {
    const r = ok(5);
    expect(isOk(r)).toBe(true);
    expect(unwrapOr(r, 0)).toBe(5);
  });

  it("err لا يحمل قيمة ويعيد البديل", () => {
    const r = err<string>("boom");
    expect(isErr(r)).toBe(true);
    expect(unwrapOr(r, 42)).toBe(42);
  });

  it("map و andThen يتسلسلان بلا throw", () => {
    const r = andThen(
      map(ok(2), (n) => n * 3),
      (n) => (n > 5 ? ok(n) : err("small")),
    );
    expect(unwrapOr(r, -1)).toBe(6);
  });
});
