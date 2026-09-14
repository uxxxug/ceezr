/**
 * الغرض: قياسُ حالتَي استخدامِ سطحِ الاستغاثةِ — قراءةُ الحكمِ قبلَ العرضِ،
 *   وتقييدُ البلاغِ عندَ الضغطِ (البند `F2-10` · `SR-14` · `ADR 0077`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * وأثقلُ ما يُقاسُ ههنا ثلاثٌ:
 *   ١. **الضغطةُ لا تسألُ الحَكَمَ**: `sos_surface_state` لا يُنادى في مسارِ
 *      الضغطِ أبداً — ولو نودي لَصارَ انتظاراً ثانياً يُسقِطُ الاستغاثةَ إن
 *      أخفقَ (`ADR 0077` · الحاجزُ `check-sos-intake-isolation`).
 *   ٢. **الدورُ يُركَّبُ ولا يُقرأُ من الطلبِ**: راكبٌ يُرسِلُ «driver» لا يصيرُ
 *      سائقاً.
 *   ٣. **رمزٌ مجهولٌ من القاعدةِ لا يُطوى رفضاً مطمئنّاً** بل يُعلَنُ عطباً.
 */

import { describe, expect, it } from "bun:test";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import type { TriggerSosPort } from "../../packages/application/safety/ports.ts";
import {
  readSosSurface,
  requestMiniAppSos,
  type SosSurfacePublicErrorCode,
  type TriggerSosRefusal,
} from "../../packages/application/safety/sos-surface.ts";
import type {
  SosStoreFailure,
  SosSurfaceReader,
  SosSurfaceVerdict,
} from "../../packages/application/safety/sos-surface-ports.ts";
import type { SosSurfaceState } from "../../packages/domain/safety/sos-surface.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";

const TOKEN = "tok_live_sos";
const TELEGRAM_ID = "7412589630";
const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";
const NOW = () => new Date("2027-03-01T09:00:00.000Z");

const ELIGIBLE: SosSurfaceState = {
  eligible: true,
  orderId: ORDER_ID,
  origin: "ACTIVE_ORDER",
  postRideWindowMinutes: 30,
  postRideWindowSource: "SETTING",
  incident: null,
  disclosure: ["SOS_SHARES_ROLE", "SOS_NO_PHONE_CALL"],
};

/** جلسةٌ سليمةٌ ما لم يُطلَبْ رفضٌ بسببٍ مُسمّى. */
function sessions(reason?: string): MiniAppSessionReader {
  return {
    read: (accessToken: string) => {
      if (reason !== undefined) return err({ reason }) as never;
      expect(accessToken).toBe(TOKEN);
      return ok({ telegramUserId: TELEGRAM_ID }) as never;
    },
  } as unknown as MiniAppSessionReader;
}

function surfaceReturning(result: Result<SosSurfaceVerdict, SosStoreFailure>): {
  reader: SosSurfaceReader;
  seen: { role: string | null };
} {
  const seen: { role: string | null } = { role: null };
  const reader: SosSurfaceReader = {
    read: async (input) => {
      seen.role = input.role;
      expect(input.telegramUserId).toBe(TELEGRAM_ID);
      return result;
    },
  };
  return { reader, seen };
}

describe("قراءةُ سطحِ الاستغاثةِ — الجلسةُ", () => {
  it("بلا رمزٍ ⇒ «SESSION_REQUIRED» ولا نداءَ للقاعدةِ", async () => {
    const { reader, seen } = surfaceReturning(ok({ found: true, state: ELIGIBLE }));
    const result = await readSosSurface(
      { sessions: sessions(), now: NOW, surface: reader, role: "rider" },
      { accessToken: undefined },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SESSION_REQUIRED");
    expect(seen.role).toBeNull();
  });

  it("رمزٌ فارغٌ ⇒ «SESSION_REQUIRED»", async () => {
    const { reader } = surfaceReturning(ok({ found: true, state: ELIGIBLE }));
    const result = await readSosSurface(
      { sessions: sessions(), now: NOW, surface: reader, role: "rider" },
      { accessToken: "" },
    );
    if (!result.ok) expect(result.error).toBe("SESSION_REQUIRED");
  });

  const rejections: readonly (readonly [string, SosSurfacePublicErrorCode])[] = [
    ["EXPIRED", "SESSION_EXPIRED"],
    ["NOT_CONFIGURED", "SESSION_NOT_AVAILABLE"],
    ["SIGNATURE_MISMATCH", "SESSION_INVALID"],
  ];

  for (const [reason, code] of rejections) {
    it(`رفضُ جلسةٍ «${reason}» ⇒ «${code}»`, async () => {
      const { reader } = surfaceReturning(ok({ found: true, state: ELIGIBLE }));
      const result = await readSosSurface(
        { sessions: sessions(reason), now: NOW, surface: reader, role: "rider" },
        { accessToken: TOKEN },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(code);
    });
  }
});

describe("قراءةُ سطحِ الاستغاثةِ — الحكمُ", () => {
  it("حالٌ جائزٌ يُنشَرُ كما هوَ", async () => {
    const { reader, seen } = surfaceReturning(ok({ found: true, state: ELIGIBLE }));
    const result = await readSosSurface(
      { sessions: sessions(), now: NOW, surface: reader, role: "rider" },
      { accessToken: TOKEN },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ found: true, state: ELIGIBLE });
    expect(seen.role).toBe("rider");
  });

  it("رفضٌ مُصنَّفٌ يُنشَرُ حكماً لا عطباً", async () => {
    const { reader } = surfaceReturning(ok({ found: false, refusal: "ACCOUNT_BLOCKED" }));
    const result = await readSosSurface(
      { sessions: sessions(), now: NOW, surface: reader, role: "rider" },
      { accessToken: TOKEN },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ found: false, refusal: "ACCOUNT_BLOCKED" });
  });

  it("«USER_NOT_FOUND» من المخزنِ ⇒ «ACCOUNT_NOT_FOUND»", async () => {
    const { reader } = surfaceReturning(err({ reason: "USER_NOT_FOUND" }));
    const result = await readSosSurface(
      { sessions: sessions(), now: NOW, surface: reader, role: "rider" },
      { accessToken: TOKEN },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ACCOUNT_NOT_FOUND");
  });

  it("عطبُ مخزنٍ ⇒ «SAFETY_STORE_NOT_AVAILABLE»", async () => {
    const { reader } = surfaceReturning(err({ reason: "STORE_ERROR" }));
    const result = await readSosSurface(
      { sessions: sessions(), now: NOW, surface: reader, role: "rider" },
      { accessToken: TOKEN },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SAFETY_STORE_NOT_AVAILABLE");
  });

  /** الدورُ **مُركَّبٌ** في الحاويةِ: سطحُ الراكبِ يسألُ راكباً دائماً. */
  it("الدورُ يُمرَّرُ من التركيبِ لا من الطلبِ", async () => {
    const { reader, seen } = surfaceReturning(ok({ found: true, state: ELIGIBLE }));
    await readSosSurface(
      { sessions: sessions(), now: NOW, surface: reader, role: "driver" },
      { accessToken: TOKEN },
    );
    expect(seen.role).toBe("driver");
  });
});

interface TriggerCall {
  readonly orderId: string | null;
  readonly actorTelegramId: string;
  readonly reporterRole: string;
}

function incidents(
  outcome:
    | { readonly incidentId: string; readonly created: boolean }
    | { readonly error: string }
    | { readonly portFailure: true },
): { port: TriggerSosPort; calls: TriggerCall[] } {
  const calls: TriggerCall[] = [];
  const port = {
    trigger: async (input: TriggerCall) => {
      calls.push(input);
      if ("portFailure" in outcome) return err({ code: "PORT_FAILURE" }) as never;
      if ("error" in outcome) {
        return ok({ incidentId: null, created: false, error: outcome.error }) as never;
      }
      return ok({ incidentId: outcome.incidentId, created: outcome.created, error: null }) as never;
    },
  };
  return { port: port as unknown as TriggerSosPort, calls };
}

describe("ضغطةُ الاستغاثةِ — الحِملُ المُقيَّدُ (`ADR 0077`)", () => {
  it("البلاغُ يُرسَلُ بـ«orderId: null» وبالدورِ المُركَّبِ", async () => {
    const { port, calls } = incidents({ incidentId: "inc-9", created: true });
    const result = await requestMiniAppSos(
      { sessions: sessions(), now: NOW, incidents: port, role: "rider" },
      { accessToken: TOKEN },
    );
    expect(calls).toEqual([{ orderId: null, actorTelegramId: TELEGRAM_ID, reporterRole: "rider" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ accepted: true, incidentId: "inc-9", created: true });
    }
  });

  it("بلاغٌ مكرَّرٌ يُعادُ بـ«created: false» ولا يُقرأُ إخفاقاً", async () => {
    const { port } = incidents({ incidentId: "inc-9", created: false });
    const result = await requestMiniAppSos(
      { sessions: sessions(), now: NOW, incidents: port, role: "rider" },
      { accessToken: TOKEN },
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toEqual({
        accepted: true,
        incidentId: "inc-9",
        created: false,
      });
  });

  it("بلا جلسةٍ لا يُنادى المنفذُ أصلاً", async () => {
    const { port, calls } = incidents({ incidentId: "inc-9", created: true });
    const result = await requestMiniAppSos(
      { sessions: sessions(), now: NOW, incidents: port, role: "rider" },
      { accessToken: undefined },
    );
    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SESSION_REQUIRED");
  });
});

describe("ضغطةُ الاستغاثةِ — الرفضُ المُصنَّفُ يُنشَرُ حكماً", () => {
  const refusals: readonly (readonly [string, TriggerSosRefusal])[] = [
    ["NO_ACTIVE_ORDER", "NO_ACTIVE_ORDER"],
    ["ESCALATION_GROUP_MISSING", "ESCALATION_GROUP_MISSING"],
    ["SOS_DEDUP_SETTING_MISSING", "SOS_DEDUP_SETTING_MISSING"],
    ["ACTOR_BLOCKED", "NOT_ALLOWED"],
    ["ORDER_NOT_OWNED", "NOT_ALLOWED"],
    ["ORDER_NOT_ASSIGNED", "NOT_ALLOWED"],
    ["ORDER_NOT_FOUND", "NOT_ALLOWED"],
  ];

  for (const [detail, refusal] of refusals) {
    it(`«${detail}» ⇒ رفضٌ «${refusal}» بحالةِ نجاحٍ`, async () => {
      const { port } = incidents({ error: detail });
      const result = await requestMiniAppSos(
        { sessions: sessions(), now: NOW, incidents: port, role: "rider" },
        { accessToken: TOKEN },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({ accepted: false, refusal });
    });
  }

  it("«ACTOR_NOT_FOUND» ⇒ «ACCOUNT_NOT_FOUND» لا رفضَ حالةٍ", async () => {
    const { port } = incidents({ error: "ACTOR_NOT_FOUND" });
    const result = await requestMiniAppSos(
      { sessions: sessions(), now: NOW, incidents: port, role: "rider" },
      { accessToken: TOKEN },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ACCOUNT_NOT_FOUND");
  });

  /**
   * رمزٌ لا يُعرَفُ **لا يُطوى** في رفضٍ مطمئنٍّ: رفضٌ مخترَعٌ يُقرأُ سياسةً
   * مُقرَّرةً وهوَ عطبٌ لا يراهُ أحدٌ. فيُعلَنُ ويُرى.
   */
  it("رمزٌ مجهولٌ من القاعدةِ يُعلَنُ عطباً ولا يُطوى رفضاً", async () => {
    const { port } = incidents({ error: "SOMETHING_NEW" });
    const result = await requestMiniAppSos(
      { sessions: sessions(), now: NOW, incidents: port, role: "rider" },
      { accessToken: TOKEN },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SAFETY_STORE_NOT_AVAILABLE");
  });

  it("إخفاقُ منفذٍ يُعلَنُ عطباً", async () => {
    const { port } = incidents({ portFailure: true });
    const result = await requestMiniAppSos(
      { sessions: sessions(), now: NOW, incidents: port, role: "rider" },
      { accessToken: TOKEN },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SAFETY_STORE_NOT_AVAILABLE");
  });
});
