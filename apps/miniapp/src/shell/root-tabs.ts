/**
 * الغرض: التبويباتُ الجذريّةُ لكلِّ دورٍ — §6 من الدليلِ المعتمدِ حرفاً:
 *   الراكب: الرئيسية · رحلاتي · الدعم · حسابي
 *   السائق: العروض · مهمتي · أرباحي · حسابي
 * الحالة: منفّذ فعلياً — UI-2 / PR 2 (Shell & Navigation · ADR 0234).
 * ينتمي إلى: apps/miniapp/src/shell
 *
 * **المعرّفاتُ هنا والنصوصُ ليست هنا:** الوسومُ تأتي من المستدعي (القاموس)، فلا
 * نصَّ مُضمَّنٌ ولا لغةٌ مفترضة. وجدولُ المعرّفاتِ مغلقٌ — لا تبويبَ خامسٌ ولا
 * تبويبَ خارجَ §6 — والأنواعُ تُلزِمُ كلَّ معرّفٍ بوسمٍ.
 */

export const ROOT_TABS = {
  rider: ["home", "rides", "support", "account"],
  driver: ["offers", "job", "earnings", "account"],
} as const;

export type RootRole = keyof typeof ROOT_TABS;
export type RootTabId<R extends RootRole> = (typeof ROOT_TABS)[R][number];

/** الوسومُ الغائبةُ أو الفارغةُ — تبويبٌ بلا وسمٍ لا يُرسَمُ ولا يُخترَعُ له نص. */
export function missingTabLabels<R extends RootRole>(
  role: R,
  labels: Readonly<Partial<Record<RootTabId<R>, string>>>,
): readonly RootTabId<R>[] {
  const ids = ROOT_TABS[role] as readonly RootTabId<R>[];
  return ids.filter((id) => {
    const label = labels[id];
    return typeof label !== "string" || label.trim() === "";
  });
}

export function isRootTab<R extends RootRole>(role: R, value: string): value is RootTabId<R> {
  return (ROOT_TABS[role] as readonly string[]).includes(value);
}
