/**
 * الغرض: LOST-AT · ADR 0253 — حقلُ الوقتِ التقريبيِّ يظهرُ لبلاغِ المفقوداتِ وحدَه، ونصوصُه في اللغاتِ الثلاث.
 * الحالة: منفّذ فعلياً.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MINIAPP_LANGUAGES,
  miniAppDictionary,
  translateMiniApp,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { SupportScreen } from "./SupportScreen.tsx";

const pending = () => new Promise<never>(() => {});
const ORDER = "88888888-0000-0000-0000-0000000002a1";

describe("LOST-AT — نموذجُ الدعمِ للراكب", () => {
  it("صنفُ المفقودات ⇒ حقلُ `datetime-local` اختياريٌّ بعنوانِه وتنبيهِه", () => {
    const markup = renderToStaticMarkup(
      <SupportScreen orderId={ORDER} initialCategory="lost_item" readTickets={pending} />,
    );
    expect(markup).toContain('type="datetime-local"');
    expect(markup).not.toContain("required");
    expect(markup).toContain(translateMiniApp("ar", "rider.support.form.lostAt"));
    expect(markup).toContain(translateMiniApp("ar", "rider.support.form.lostAtHint"));
  });

  it("صنفٌ آخر ⇒ لا حقلَ وقت", () => {
    const markup = renderToStaticMarkup(<SupportScreen orderId={ORDER} readTickets={pending} />);
    expect(markup).not.toContain("datetime-local");
  });

  it("النصوصُ ورموزُ الرفضِ في اللغاتِ الثلاثِ وللدورَين", () => {
    for (const language of MINIAPP_LANGUAGES) {
      const dictionary = miniAppDictionary(language);
      for (const key of ["form.lostAt", "form.lostAtHint", "list.lostAt"]) {
        expect(dictionary[`rider.support.${key}`]).toBeString();
      }
      for (const code of [
        "LOST_AT_INVALID",
        "LOST_AT_NOT_ALLOWED",
        "LOST_AT_IN_FUTURE",
        "LOST_AT_BEFORE_RIDE",
      ]) {
        expect(dictionary[`rider.support.error.${code}`]).toBeString();
        expect(dictionary[`driver.support.error.${code}`]).toBeString();
      }
    }
  });
});
