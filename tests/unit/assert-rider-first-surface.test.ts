/**
 * الغرض: إثباتُ أنَّ حاجزَ سطحِ الراكبِ الأوّلِ (`F1-09` · `D-30`) يتتبّعُ الاستيرادَ الثابتَ بالتعدّي من حزمةِ
 *   `RiderRoot`، فيرفضُ وحدةً من حزمِ القسمِ 9.4 المؤجَّلةِ فيه، ويقبلُها في حزمةٍ لا تُبلَغُ إلّا ديناميكيّاً،
 *   ويرفضُ غيابَ `RiderRoot` بدلَ أن يعمى صامتاً.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import type { ChunkGraphNode } from "../../apps/miniapp/vite/assert-initial-dictionaries.ts";
import {
  isDeferredRiderModule,
  riderFirstSurfaceViolations,
} from "../../apps/miniapp/vite/assert-rider-first-surface.ts";

const SRC = "/repo/apps/miniapp/src";

function graph(riderHome: string[], riderHomeImports: string[] = []): ChunkGraphNode[] {
  return [
    { fileName: "shell.js", isEntry: false, imports: [], moduleIds: [`${SRC}/shell/App.tsx`] },
    {
      fileName: "rider-home.js",
      isEntry: false,
      imports: ["shell.js", ...riderHomeImports],
      moduleIds: [`${SRC}/surfaces/rider/RiderRoot.tsx`, ...riderHome],
    },
    {
      fileName: "rider-ride.js",
      isEntry: false,
      imports: ["shell.js"],
      moduleIds: [
        `${SRC}/surfaces/rider/active/ActiveRideScreen.tsx`,
        "/repo/node_modules/socket.io-client/build/esm/index.js",
      ],
    },
  ];
}

describe("riderFirstSurfaceViolations (F1-09 · D-30)", () => {
  it("يقبلُ حزمةً مؤجَّلةً لا تُبلَغُ إلّا ديناميكيّاً", () => {
    expect(
      riderFirstSurfaceViolations(graph([`${SRC}/surfaces/rider/welcome/WelcomeScreen.tsx`])),
    ).toEqual([]);
  });

  it("يرفضُ `rider-ride` مستورَدةً ثابتاً من `rider-home`", () => {
    const violations = riderFirstSurfaceViolations(graph([], ["rider-ride.js"]));
    expect(violations.length).toBe(2);
    expect(violations.join("\n")).toContain("ActiveRideScreen.tsx");
  });

  it("يرفضُ وحدةً مؤجَّلةً سُحِبَت إلى `rider-home` نفسِها", () => {
    expect(
      riderFirstSurfaceViolations(graph([`${SRC}/surfaces/rider/support/SupportScreen.tsx`])),
    ).toHaveLength(1);
  });

  it("يرفضُ غيابَ `RiderRoot` لا يمرُّ صامتاً", () => {
    expect(riderFirstSurfaceViolations([])).toHaveLength(1);
  });

  it("مساعداتُ العرضِ النقيّةُ ليست مؤجَّلةً (يستوردُها السطحُ الأوّلُ والسائقُ)", () => {
    expect(isDeferredRiderModule(`${SRC}/surfaces/rider/search/search-view.ts`)).toBe(false);
    expect(isDeferredRiderModule(`${SRC}/surfaces/rider/summary/ride-summary-view.ts`)).toBe(false);
    expect(isDeferredRiderModule(`${SRC}/surfaces/rider/search/SearchScreen.tsx`)).toBe(true);
    expect(isDeferredRiderModule(`${SRC}/surfaces/account/AccountRights.tsx`)).toBe(true);
    // `D-32`: السجلُّ وتفاصيلُه والإشعاراتُ مؤجَّلةٌ، والرئيسيةُ والتسعيرُ لا.
    expect(isDeferredRiderModule(`${SRC}/surfaces/rider/history/ride-history-view.ts`)).toBe(true);
    expect(
      isDeferredRiderModule(`${SRC}/surfaces/rider/notifications/NotificationsScreen.tsx`),
    ).toBe(true);
    expect(isDeferredRiderModule(`${SRC}/surfaces/rider/rider-history-screens.ts`)).toBe(true);
    expect(isDeferredRiderModule(`${SRC}/surfaces/rider/home/HomeScreen.tsx`)).toBe(false);
    expect(isDeferredRiderModule(`${SRC}/surfaces/rider/quote/QuoteScreen.tsx`)).toBe(false);
  });
});
