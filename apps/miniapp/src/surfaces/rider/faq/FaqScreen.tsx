/**
 * الغرض: شاشةُ الأسئلة الشائعةِ (DEC-36) — تعرضُ خمسةَ أسئلةٍ وأجوبةً مكتوبةً
 *   في قواميسِ i18n بلا خادمٍ. المحتوىُ حقيقيٌّ لا صفحةٌ فارغةٌ.
 * الحالة: مُنفَّذٌ — تنشيطُ دَينٍ مُعلَنٍ `rider.support.debt.faq`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/faq
 * يُستخدم من: `RiderRoot.tsx`.
 *
 * ## ولماذا محتوى ثابتٌ لا من خادمٍ
 *
 * لأنَّ الأسئلةَ الشائعةَ تُكتبُ مرّةً وتُترجَمُ ثلاثاً، ولا تتغيّرُ بجلسةِ
 * مستخدمٍ ولا بمدينةٍ. ولو جاءَت من خادمٍ لكانَت صفحةً فارغةً تنتظرُ ردّاً،
 * وذلك عينُ ما نفاها الدَّينُ: «لن نضعَ صفحةً فارغةً باسمِ المساعدةِ».
 */

import {
  directionFor,
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
// `D-33` · `ADR 0188`: مفاتيحُ `rider.support.faq.*` في جزءِ `support` لا في `core`.
import "../../../../../../packages/shared/i18n/miniapp/ar-parts/support.ts";

export interface FaqScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
}

const FAQ_ITEMS: readonly (readonly [string, string])[] = [
  ["rider.support.faq.q1", "rider.support.faq.a1"],
  ["rider.support.faq.q2", "rider.support.faq.a2"],
  ["rider.support.faq.q3", "rider.support.faq.a3"],
  ["rider.support.faq.q4", "rider.support.faq.a4"],
  ["rider.support.faq.q5", "rider.support.faq.a5"],
];

export function FaqScreen({ language = MINIAPP_DEFAULT_LANGUAGE, onBack }: FaqScreenProps) {
  const t = miniAppTranslator(language);

  return (
    <section className="rf" dir={directionFor(language)} aria-labelledby="rf-title">
      <h1 id="rf-title" className="rf__title">
        {t("rider.support.faq.title")}
      </h1>
      {onBack !== undefined && (
        <button type="button" className="rf__back" onClick={() => onBack()}>
          {t("rider.support.faq.back")}
        </button>
      )}
      <ul className="rf__list">
        {FAQ_ITEMS.map(([qKey, aKey]) => (
          <li className="rf__item" key={qKey}>
            <p className="rf__question">{t(qKey)}</p>
            <p className="rf__answer">{t(aKey)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
