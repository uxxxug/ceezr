/**
 * الغرض: برهانُ سقوطِ حاجزِ عقدِ اشتراكِ السائقِ — **حالةٌ سلبيّةٌ مصنوعةٌ لكلِّ
 *   قاعدةٍ من الخمسِ**، وحالةٌ موجبةٌ واحدةٌ على المستودعِ الحقيقيِّ (`ح-7`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-06`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test`.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ قاعدةٍ تُزادُ في الحاجزِ تُزادُ لها حالةٌ ههنا،
 *   وإلّا فهيَ **غيرُ مُنفَذةٍ** ولو كانَ الحاجزُ أخضرَ.
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ولِمَ المستودعُ الحقيقيُّ أساساً: مدخلٌ مصنوعٌ من الصفرِ يُثبِتُ مُطابَقةَ نمطٍ
 * لا انطباقَ قاعدةٍ على ما كُتِبَ فعلاً. فكلُّ حالةٍ ههنا **تفسدُ نسخةً من
 * الحقيقةِ بفسادٍ واحدٍ**، وتقيسُ أنَّ الحاجزَ يراهُ وأنَّ الأصلَ نظيفٌ.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يتحقّقُ من صحّةِ رقمٍ**: أنَّ السعرَ يُقاسُ في تكاملٍ على قاعدةٍ حقيقيّةٍ
 *   لا بنصٍّ ساكنٍ.
 * - **لا يدَّعي استيعابَ كلِّ إفسادٍ**: يُثبِتُ أنَّ لكلِّ قاعدةٍ سنّاً.
 */

import { describe, expect, test } from "bun:test";
import { readRepository } from "../../scripts/check-driver-subscription-contract.ts";
import {
  type DriverSubscriptionContractInput,
  driverSubscriptionContractProblems,
  FORBIDDEN_HARDCODED_NUMBERS,
  failClosedProblems,
  hardcodedPriceProblems,
  historyDisplayProblems,
  KEY_PREFIX,
  PUBLIC_ERROR_CODES,
  renewalPresenceProblems,
  SCREEN_FILE,
  textCoverageProblems,
  VIEW_FILE,
} from "../../scripts/lib/driver-subscription-contract.ts";

const REAL: DriverSubscriptionContractInput = readRepository();

function spoil(patch: Partial<DriverSubscriptionContractInput>): DriverSubscriptionContractInput {
  return { ...REAL, ...patch };
}

function withRoute(mutate: (source: string) => string): DriverSubscriptionContractInput {
  return spoil({ route: mutate(REAL.route) });
}

function withApp(mutate: (source: string) => string): DriverSubscriptionContractInput {
  return spoil({ application: mutate(REAL.application) });
}

function withSurface(
  path: string,
  mutate: (source: string) => string,
): DriverSubscriptionContractInput {
  const source = REAL.surface[path];
  if (source === undefined) throw new Error(`${path}: غيرُ مقروءٍ في المستودعِ.`);
  return spoil({ surface: { ...REAL.surface, [path]: mutate(source) } });
}

function withArabic(key: string, value: string): DriverSubscriptionContractInput {
  return spoil({
    translations: {
      ...REAL.translations,
      ar: { ...(REAL.translations.ar ?? {}), [key]: value },
    },
  });
}

describe("حاجزُ عقدِ اشتراكِ السائقِ — الحالةُ الموجبةُ", () => {
  test("المستودعُ الحقيقيُّ بلا مأخذٍ", () => {
    expect(driverSubscriptionContractProblems(REAL)).toEqual([]);
  });
});

describe("1) no hardcoded price", () => {
  test("forbidden number in application fails", () => {
    const forbidden = FORBIDDEN_HARDCODED_NUMBERS[0] as string;
    const spoiled = withApp((source) => `${source}\nconst price = ${forbidden};\n`);
    expect(hardcodedPriceProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("forbidden number in route fails", () => {
    const forbidden = FORBIDDEN_HARDCODED_NUMBERS[0] as string;
    const spoiled = withRoute((source) => `${source}\nconst price = ${forbidden};\n`);
    expect(hardcodedPriceProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("real repo is clean", () => {
    expect(hardcodedPriceProblems(REAL)).toEqual([]);
  });
});

describe("2) renewal present and fail-closed", () => {
  test("renew route removed fails", () => {
    const spoiled = withRoute((source) =>
      source.replaceAll("/v1/driver/subscription/renew", "/v1/driver/subscription/rn"),
    );
    expect(renewalPresenceProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("renew use case removed from app fails", () => {
    const spoiled = withApp((source) =>
      source.replaceAll("renewDriverSubscription", "rnDriverSub"),
    );
    expect(renewalPresenceProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("subscribePlan call removed from app fails", () => {
    const spoiled = withApp((source) => source.replaceAll("subscribePlan", "subPlan"));
    expect(renewalPresenceProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("renew button removed from screen fails", () => {
    const spoiled = withSurface(SCREEN_FILE, (source) => source.replaceAll(/renew/gi, "rn"));
    expect(renewalPresenceProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("3) renewal fails closed", () => {
  test("provider error removed from app fails", () => {
    const spoiled = withApp((source) =>
      source.replaceAll("PAYMENT_PROVIDER_NOT_AVAILABLE", "PROVIDER_MISSING"),
    );
    expect(failClosedProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("503 status removed from route fails", () => {
    const spoiled = withRoute((source) => source.replaceAll("503", "500"));
    expect(failClosedProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("undefined guard removed from route fails", () => {
    const spoiled = withRoute((source) =>
      source.replaceAll("renewal === undefined", "renewal == null"),
    );
    expect(failClosedProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("4) payment history displayed", () => {
  test("history removed from both screen and view fails", () => {
    const withoutScreen = (REAL.surface[SCREEN_FILE] ?? "").replaceAll(/history/gi, "hist");
    const withoutView = (REAL.surface[VIEW_FILE] ?? "").replaceAll(/history/gi, "hist");
    const spoiled = spoil({
      surface: { ...REAL.surface, [SCREEN_FILE]: withoutScreen, [VIEW_FILE]: withoutView },
    });
    expect(historyDisplayProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("5) every error code has text in three languages", () => {
  test("blank error text fails", () => {
    const first = PUBLIC_ERROR_CODES[0] as string;
    const key = `${KEY_PREFIX}error.${first}`;
    const spoiled = withArabic(key, "   ");
    expect(textCoverageProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("deleted error key fails", () => {
    const first = PUBLIC_ERROR_CODES[0] as string;
    const key = `${KEY_PREFIX}error.${first}`;
    const ar = REAL.translations.ar ?? {};
    const { [key]: _removed, ...rest } = ar;
    const spoiled = spoil({ translations: { ...REAL.translations, ar: rest } });
    expect(textCoverageProblems(spoiled).length).toBeGreaterThan(0);
  });
});
