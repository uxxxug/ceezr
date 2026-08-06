/**
 * الغرض: نمط Result<T,E> الموحّد المستخدم في كل حالات الاستخدام بلا throw لأخطاء العمل المتوقعة.
 * الحالة: أساس تقني منفّذ فعلياً (مسموح صراحة في القسم 2.5 من الأمر).
 * ينتمي إلى: shared/result
 * يُتوقع أن يستخدمه لاحقاً: كل ملفات packages/application و packages/domain
 * ملاحظات مستقبلية: لا تُضِف اعتماديات خارجية هنا؛ يجب أن يبقى بلا تبعيات.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

export function map<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

export function mapErr<T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(fn(r.error));
}

export function andThen<T, U, E>(
  r: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return r.ok ? fn(r.value) : r;
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

export async function fromPromise<T, E>(
  promise: Promise<T>,
  onError: (cause: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await promise);
  } catch (cause) {
    return err(onError(cause));
  }
}
