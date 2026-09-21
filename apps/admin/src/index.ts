/**
 * الغرض: نقطةُ دخولِ **خدمةِ لوحةِ الإدارةِ المستقلّةِ** — تبني حاويتَها الضيّقةَ،
 *   تُركِّبُ سطحَ اللوحةِ بترتيبِهِ الواحدِ من `admin/mount.ts`، تُقلعُ خادمَ
 *   `Bun.serve`، وتُغلقُ بنظافةٍ عندَ `SIGTERM`.
 * الحالة: منفّذ فعلياً — `F5-08` / `ARCH-011` · ADR 0064.
 * ينتمي إلى: apps/admin
 * يستخدمه: docker/Dockerfile.admin كأمرِ تشغيلِ خدمةِ `waslah-admin`
 *
 * ## ما هذا الفصلُ، وما ليسَ هو
 *
 * **هو**: إخراجُ سطحٍ إداريٍّ ثقيلِ الاستعلامِ من العمليةِ التي يجبُ أن تُجيبَ
 * ويبهوكَ تلغرام في ثوانٍ. تقريرُ حرارةٍ على ستِّ ساعاتٍ، أو خريطةُ عمليّاتٍ حيّةٍ
 * تُعيدُ لقطتَها كلَّ عشرينَ ثانيةً، كانا يسحبانِ من **بِركةِ الاتّصالاتِ نفسِها**
 * التي تسحبُ منها معالجةُ تحديثِ راكبٍ. و`ARCH-013` يقولُ إنّ الأولويّاتَ جزءٌ من
 * المعمارية: السلامةُ والدفعُ والرحلةُ النشطةُ تُحمى على حسابِ كلِّ ما سواها —
 * وبِركةٌ واحدةٌ لا تعرفُ أولويّةً. فالحدُّ الذي يُنفِذُ هذا هو حدُّ العمليةِ.
 *
 * **وليسَ هو**: تفكيكاً إلى خدماتٍ مُصغَّرةٍ (`ARCH-009` يمنعُهُ بلا قياسٍ). لا عقدَ
 * شبكةٍ جديدٌ بين الخدمتَين، ولا استدعاءَ بينهما أصلاً: كلٌّ يقرأُ القاعدةَ نفسَها،
 * والقناةُ الوحيدةُ بينهما مجرى Redis الذي كان قائماً قبلَ هذه المرحلةِ.
 *
 * ## ولمَ `/health` ههنا مختصرٌ ولا `/ready` فيه
 *
 * `/ready` في البوّابةِ عقدٌ مُركَّبٌ: يفحصُ القاعدةَ وRedis والمخطَّطَ ونبضاتِ
 * المهامِّ الحرجةِ (§4.3). ونسخُهُ ههنا كان سيعني أنّ **لوحةَ إدارةٍ** تُصرَّحُ
 * «غيرَ جاهزةٍ» لأنّ مهمّةً دوريّةً لم تنبض — فيسحبُها المُوجِّهُ ويُحرَمُ المشغّلُ
 * من الشاشةِ التي يُشخِّصُ بها العطلَ، في اللحظةِ التي يحتاجُها فيها بالضبط.
 * فالمُعلَنُ ههنا **حياةٌ لا جاهزيّةٌ**: هل العمليةُ قائمةٌ. والقاعدةُ لا تُفحَصُ
 * في المسارِ لأنّ صفحةَ اللوحةِ نفسَها تُخفِقُ ظاهراً إن سقطت القاعدةُ.
 */

import { Hono } from "hono";
import { createStructuredLogger } from "../../../packages/infrastructure/observability/index.ts";
import { tryLoadConfig } from "../../../packages/shared/config/index.ts";
import { mountAdminSurface } from "../../gateway/src/admin/mount.ts";
import { buildAdminContainer } from "./container.ts";

/**
 * سجلُّ اللوحةِ — من المُصدِرِ الوحيدِ (`F8-03` · ADR 0078)، فلا شكلَ رابعاً
 * لسطرِ سجلٍّ في المستودعِ.
 */
const log = createStructuredLogger({ service: "admin" });

async function main(): Promise<void> {
  const config = tryLoadConfig(process.env);
  if (!config.ok) {
    // إقلاعٌ بإعدادٍ ناقصٍ أخطرُ من عدمِ الإقلاعِ — نفسُ حكمِ العاملِ حرفاً.
    log.error("admin.config_invalid", { detail: String(config.error) });
    process.exit(1);
  }

  /**
   * الحالُ المتناقضةُ تُسجَّلُ ولا تُسقِطُ: خدمةُ لوحةٍ تُقلعُ بـ
   * `RUN_ADMIN_IN_GATEWAY=true` تعني أنّ اللوحةَ تعملُ في موضعَينِ — وهو الخرقُ
   * الذي يمنعُهُ `scripts/check-instance-invariant.ts` في المخطوطةِ. وههنا يُسجَّلُ
   * لا يُسقَطُ: الحاجزُ يرى الملفَّ، وهذا السطرُ يرى **البيئةَ الفعليّةَ** التي قد
   * تُضبَطَ بيدٍ في لوحةِ المنصّةِ — فطبقتانِ للحكمِ الواحدِ، ولا واحدةَ تُغني.
   * وإسقاطُ العمليةِ كان سيعني لوحةً لا تُقلعُ لأجلِ متغيّرٍ يقولُ «وهي في
   * البوّابةِ أيضاً» — عقوبةٌ في غيرِ محلِّها.
   */
  if (config.value.runAdminInGateway) {
    log("admin.placement_contradiction", {
      hint:
        "هذه خدمةُ waslah-admin وRUN_ADMIN_IN_GATEWAY=true — أي لوحةٌ في موضعَين. " +
        "اضبطها false على البوّابةِ وإلّا فالعزلُ الذي أُنشئت هذه الخدمةُ لأجلِهِ غيرُ قائم (ADR 0064)",
    });
  }

  const container = buildAdminContainer(config.value, {}, log);

  const app = new Hono();

  // `/health` قبلَ سطحِ اللوحةِ: `/admin` لا يتشابهُ معه في بادئةٍ، والترتيبُ ههنا
  // ليس حرجاً — لكنّ فحصَ الحياةِ يبقى فوقَ كلِّ حارسٍ بحكمٍ عامٍّ لا باتّفاقٍ.
  app.get("/health", (c) => c.json({ status: "ok", service: "waslah-admin" }));

  mountAdminSurface(app, {
    sql: container.sql,
    auth: container.auth,
    bus: container.bus,
    codeSender: container.codeSender,
    mapOrigins: container.mapOrigins,
    ...(container.mapStyle === null ? {} : { mapStyle: container.mapStyle }),
    maplibreSri: container.maplibreSri,
    ...(container.sessionRevocation === null ? {} : { revocation: container.sessionRevocation }),
    log,
  });

  const server = Bun.serve({ port: config.value.port, fetch: app.fetch });

  log("admin.started", {
    port: config.value.port,
    env: config.value.env,
    // يُصرَّحُ لأنّ الفرقَ **لا يظهرُ في الواجهةِ**: مجرى بناقلٍ محلّيٍّ في هذه
    // العمليةِ يفتحُ ويُنبِضُ ويُعيدُ اللقطةَ ولا تصلُهُ دلتا واحدةٌ أبداً.
    liveDeltaAcrossProcesses: container.busCrossesProcesses,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("admin.shutdown", { signal });
    // إيقافُ القبولِ أوّلاً ثمّ إغلاقُ القاعدةِ: مجرى SSE مفتوحٌ يُقطَعُ فيُعيدُ
    // المتصفّحُ الاتّصالَ وحدَه، وطلبٌ جارٍ بلا اتّصالِ قاعدةٍ يفشلُ بلا داعٍ.
    server.stop(true);
    await container.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// يُشغَّلُ عندَ التنفيذِ المباشرِ وحدَه، فتستوردُهُ الاختباراتُ بلا أن تُقلعَ خادماً.
if (import.meta.main) {
  await main();
}

export { main };
