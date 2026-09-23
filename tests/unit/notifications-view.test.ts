/**
 * الغرض: اختبارُ وحداتِ نموذجِ عرضِ مركزِ الإشعاراتِ — المفاتيحُ والتصنيفاتُ
 *   والفشلُ المسلَّمُ (`SS-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `SS-07`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test`.
 */

import { describe, expect, it } from "bun:test";
import {
  channelKey,
  instantLabel,
  kindKey,
  notificationsErrorKey,
} from "../../apps/miniapp/src/surfaces/rider/notifications/notifications-view.ts";
import { NOTIFICATION_KINDS } from "../../packages/shared/config/notification-kinds.ts";

describe("kindKey", () => {
  it("يرجعُ مفتاحاً لكلِّ نوعٍ في القائمةِ المغلقةِ", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const key = kindKey(kind);
      expect(key).toBe(`rider.notifications.kind.${kind}`);
    }
  });

  it("يرجعُ مفتاحَ الخامِّ لنوعٍ مجهولٍ لا مفتاحاً فارغاً", () => {
    expect(kindKey("unknown_kind")).toBe("rider.notifications.kind.unknown");
  });
});

describe("channelKey", () => {
  it("يرجعُ المفاتيحَ المعلَنةَ للقناتَين", () => {
    expect(channelKey("critical")).toBe("rider.notifications.channel.critical");
    expect(channelKey("in_app")).toBe("rider.notifications.channel.in_app");
  });

  it("يرجعُ مفتاحَ الخامِّ لقناةٍ مجهولةٍ", () => {
    expect(channelKey("carrier_pigeon")).toBe("rider.notifications.channel.unknown");
  });
});

describe("notificationsErrorKey", () => {
  it("يرجعُ المفاتيحَ المعلَنةَ للأخطاءِ", () => {
    expect(notificationsErrorKey("SESSION_NOT_AVAILABLE")).toBe(
      "rider.notifications.error.session",
    );
    expect(notificationsErrorKey("RECIPIENT_NOT_FOUND")).toBe(
      "rider.notifications.error.notRegistered",
    );
    expect(notificationsErrorKey("NOTIFICATION_NOT_FOUND")).toBe(
      "rider.notifications.error.notFound",
    );
  });

  it("يسقُطُ إلى المفتاحِ العامِّ لكلِّ ما لا يُعرَفُ", () => {
    expect(notificationsErrorKey("UNEXPECTED")).toBe("rider.notifications.error.unavailable");
  });
});

describe("instantLabel", () => {
  it("يرجعُ أجزاءً معروفةً للقيمةِ الصالحةِ", () => {
    const label = instantLabel("2026-09-23T08:30:00.000Z", "Asia/Riyadh");
    expect(label.known).toBe(true);
  });

  it("يرجعُ خامّاً للقيمةِ المعطوبةِ", () => {
    const label = instantLabel("not-a-date", "Asia/Riyadh");
    expect(label.known).toBe(false);
    expect(label.key).toBe("rider.notifications.when.raw");
  });
});
