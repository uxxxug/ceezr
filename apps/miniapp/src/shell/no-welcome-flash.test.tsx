/**
 * الغرض: منعُ ظهورِ الترحيبِ أو أيِّ سطحٍ منتجٍ قبلَ حسمِ R0/R1.
 * الحالة: اختبارُ الخَرْجِ الأوّلِ والقرارِ الحتميِّ؛ لا DOM ولا مؤثّراتُ React.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RoleRouter } from "../routing/RoleRouter.tsx";
import { routeForViewer } from "../routing/role-route.ts";
import type { IdentityPort } from "./identity-port.ts";
import { Shell } from "./Shell.tsx";

const never = () => new Promise<never>(() => {});

const identity: IdentityPort = {
  establishSession: never,
  clearSession: () => undefined,
  fetchViewer: never,
};

const forbiddenFirstPaint = [
  "wc__",
  "rh__",
  "onboarding",
  "أهلا بك في وَصْلة",
  "Welcome to Wasla",
  "إلى أين؟",
  "Where to?",
];

describe("لا وميضَ ترحيبٍ بينَ الإقلاعِ والتوجيهِ (R0 → R1)", () => {
  it("Shell يعرض Skeleton أثناء booting وحده", () => {
    const html = renderToStaticMarkup(<Shell identity={identity} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="sk"');
    for (const forbidden of forbiddenFirstPaint) expect(html).not.toContain(forbidden);
  });

  it("RoleRouter يعرض Skeleton أثناء resolving لا الترحيبَ ولا التسجيلَ", () => {
    const html = renderToStaticMarkup(<RoleRouter fetchViewer={never} />);
    expect(html).toContain('class="sk"');
    for (const forbidden of forbiddenFirstPaint) expect(html).not.toContain(forbidden);
  });

  it("الحسمُ متكرّرُ النتيجة: الراكبُ النشطُ يبقى rider ولا يُعرَضُ قبلَه سطحٌ", () => {
    const viewer = {
      kind: "viewer",
      role: "rider",
      status: "active",
      languageCode: "ar",
    } as const;
    expect(routeForViewer(viewer)).toEqual({ surface: "rider" });
    expect(routeForViewer(viewer)).toEqual(routeForViewer(viewer));

    const pending = renderToStaticMarkup(<RoleRouter fetchViewer={never} />);
    expect(pending).toContain('class="sk"');
    expect(pending).not.toContain("rider-home");
    expect(pending).not.toContain("WelcomeScreen");
  });
});
