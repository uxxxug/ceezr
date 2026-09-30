/**
 * الغرض: قياسُ مسارِ `POST /v1/driver/safety/sos` (`F12-22`) — قناةُ استغاثةٍ
 *   ثانيةً للسائقِ بلا تيليجرام. **حاكمٌ واحدٌ**: نفسُ `requestMiniAppSos`
 *   بدورِ `"driver"`، ولا يُقرأُ الدورُ من الطلبِ.
 * ينتمي إلى: tests/unit
 * الحاكم: docs/adr/0217-driver-sos-second-channel.md
 */

import { describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import {
  createSafetyRoutes,
  type SafetyRouteDependencies,
} from "../../apps/gateway/src/routes/safety.ts";
import type { TriggerSosPort } from "../../packages/application/safety/ports.ts";
import type { RequestMiniAppSosDeps } from "../../packages/application/safety/sos-surface.ts";

/** محاكاةُ المنفذِ — تُثبِتُ الحادثَ وترجعُ معرّفاً. */
function fakeIncidents(): TriggerSosPort {
  return {
    trigger: async () => ({ ok: true, value: { incidentId: "incident-1", created: true } }),
  };
}

/** محاكاةُ جلسةٍ — تُمرِّرُ الرمزَ وتُعيدُ معرّفَ تيليجرام. */
function fakeSessionDeps(telegramUserId: string): Pick<RequestMiniAppSosDeps, "sessions" | "now"> {
  return {
    sessions: {
      read: async () => ({
        ok: true,
        value: {
          telegramUserId,
          bot: "driver",
          sessionId: "session-1",
          issuedAtSeconds: 0,
          expiresAtSeconds: 9999999999,
        },
      }),
      readSync: () => ({
        ok: true,
        value: {
          telegramUserId,
          bot: "driver",
          sessionId: "session-1",
          issuedAtSeconds: 0,
          expiresAtSeconds: 9999999999,
        },
      }),
    },
    now: () => new Date(),
  };
}

function makeApp(deps: SafetyRouteDependencies): Hono {
  return createSafetyRoutes(deps);
}

describe("F12-22 — POST /v1/driver/safety/sos", () => {
  it("يُنشئ حادثاً للسائقِ عبرَ HTTP", async () => {
    const incidents = fakeIncidents();
    const deps: SafetyRouteDependencies = {
      driverTrigger: {
        ...fakeSessionDeps("999"),
        incidents,
        role: "driver",
      },
    };
    const app = makeApp(deps);
    const res = await app.request("/v1/driver/safety/sos", {
      method: "POST",
      headers: { authorization: "Bearer token" },
    });
    const body = (await res.json()) as { ok: boolean; accepted: boolean; incidentId: string };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(true);
    expect(body.incidentId).toBe("incident-1");
  });

  it("يُرجع 503 حينَ المنفذُ غيرُ مُركَّبٍ", async () => {
    const deps: SafetyRouteDependencies = {};
    const app = makeApp(deps);
    const res = await app.request("/v1/driver/safety/sos", {
      method: "POST",
      headers: { authorization: "Bearer token" },
    });
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
  });

  it("يُرجع رفضاً مُصنَّفاً حينَ لا رحلةَ قائمةً", async () => {
    const incidents: TriggerSosPort = {
      trigger: async () => ({ ok: true, value: { incidentId: null, error: "NO_ACTIVE_ORDER" } }),
    };
    const deps: SafetyRouteDependencies = {
      driverTrigger: {
        ...fakeSessionDeps("999"),
        incidents,
        role: "driver",
      },
    };
    const app = makeApp(deps);
    const res = await app.request("/v1/driver/safety/sos", {
      method: "POST",
      headers: { authorization: "Bearer token" },
    });
    const body = (await res.json()) as { ok: boolean; accepted: boolean; refusal: string };
    expect(res.status).toBe(200);
    expect(body.accepted).toBe(false);
    expect(body.refusal).toBe("NO_ACTIVE_ORDER");
  });

  it("لا يُؤثِّرُ في مسارِ الراكبِ — حاكمانِ مستقلّانِ", async () => {
    const driverIncidents: TriggerSosPort = {
      trigger: async () => ({ ok: true, value: { incidentId: "driver-incident", created: true } }),
    };
    const riderIncidents: TriggerSosPort = {
      trigger: async () => ({ ok: true, value: { incidentId: "rider-incident", created: true } }),
    };
    const deps: SafetyRouteDependencies = {
      driverTrigger: {
        ...fakeSessionDeps("999"),
        incidents: driverIncidents,
        role: "driver",
      },
      trigger: {
        ...fakeSessionDeps("888"),
        incidents: riderIncidents,
        role: "rider",
      },
    };
    const app = makeApp(deps);
    const driverRes = await app.request("/v1/driver/safety/sos", {
      method: "POST",
      headers: { authorization: "Bearer token" },
    });
    const riderRes = await app.request("/v1/safety/sos", {
      method: "POST",
      headers: { authorization: "Bearer token" },
    });
    const driverBody = (await driverRes.json()) as { incidentId: string };
    const riderBody = (await riderRes.json()) as { incidentId: string };
    expect(driverBody.incidentId).toBe("driver-incident");
    expect(riderBody.incidentId).toBe("rider-incident");
  });
});
