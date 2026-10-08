/**
 * الغرض: عقدُ جهةِ اتّصالِ الطوارئ ([B] · R13) كما يُخدَمُ اليوم — `GET/PUT /v1/me/emergency-contact`
 *   (`apps/gateway/src/routes/me-emergency-contact.ts` · DEC-41) — ونموذجُ عرضٍ نقيّ.
 * الحالة: منفّذ فعلياً — UI-3 / PR 5 (ADR 0238).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/settings
 *
 * ## ما لا يدّعيه
 *
 *   ــ **لا حذف:** العقدُ قراءةٌ وكتابةٌ فقط، فالجهةُ تُستبدَلُ ولا تُزال (فجوةُ عقدٍ مسجّلة · ADR 0238).
 *   ــ **لا إبلاغَ تلقائيّ:** لا شيءَ في الخادمِ يقرأُ هذه الجهةَ عندَ الاستغاثة، فالشاشةُ تقولُ ذلك ولا تَعِدُ به.
 *   ــ التحقّقُ ههنا مرآةٌ لقواعدِ الخادم (`packages/application/safety/emergency-contact.ts`) لا بديلٌ عنها.
 */

import { apiFetch } from "../../../api/client.ts";

export const EMERGENCY_CONTACT_PATH = "/v1/me/emergency-contact";
export const EMERGENCY_CONTACT_NAME_MAX = 120;
const PHONE_PATTERN = /^[0-9]{4,20}$/;

export interface EmergencyContactResponse {
  readonly ok: true;
  readonly name: string | null;
  readonly phone: string | null;
}

export interface EmergencyContactSaveResponse {
  readonly ok: true;
  readonly status: "saved";
}

export function readEmergencyContact(): Promise<EmergencyContactResponse> {
  return apiFetch<EmergencyContactResponse>(EMERGENCY_CONTACT_PATH);
}

export function saveEmergencyContact(input: {
  readonly name: string;
  readonly phone: string;
}): Promise<EmergencyContactSaveResponse> {
  return apiFetch<EmergencyContactSaveResponse>(EMERGENCY_CONTACT_PATH, {
    method: "PUT",
    body: { name: input.name, phone: input.phone },
  });
}

/** جهةٌ مسجّلةٌ = الاسمُ والرقمُ معاً؛ وما سواهما «لا جهة» لا جهةٌ ناقصةٌ تُعرَض. */
export function hasEmergencyContact(response: EmergencyContactResponse): boolean {
  return response.name !== null && response.phone !== null;
}

export type ContactFieldProblem = "nameRequired" | "nameTooLong" | "phoneInvalid";

export function contactProblems(input: {
  readonly name: string;
  readonly phone: string;
}): readonly ContactFieldProblem[] {
  const problems: ContactFieldProblem[] = [];
  const name = input.name.trim();
  if (name.length === 0) problems.push("nameRequired");
  else if (name.length > EMERGENCY_CONTACT_NAME_MAX) problems.push("nameTooLong");
  if (!PHONE_PATTERN.test(input.phone.trim())) problems.push("phoneInvalid");
  return problems;
}

/** رمزُ رفضِ الحفظِ ⇒ مفتاحُ نصّ؛ والمجهولُ لا يُصمَتُ عنه. */
export function contactSaveErrorKey(code: string): string {
  if (code === "MALFORMED") return "rider.account.emergency.error.invalid";
  if (code === "ACCOUNT_NOT_FOUND") return "rider.account.emergency.error.account";
  return "rider.account.emergency.error.generic";
}
