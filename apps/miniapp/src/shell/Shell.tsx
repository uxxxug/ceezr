import { useEffect, useState } from "react";
import { hasValidSession } from "../identity/session.ts";
import { RoleRouter } from "../routing/RoleRouter.tsx";
import { applyDocumentDirection } from "../styles/direction.ts";
import {
  bindTelegramTheme,
  expandApp,
  getRawInitData,
  isInsideTelegram,
  notifyReady,
} from "../tg/index.ts";

type BootState =
  | { kind: "booting" }
  | { kind: "awaiting_session"; hasInitData: boolean; insideTelegram: boolean }
  | { kind: "ready" };

/**
 * App shell (ROADMAP §9.4 package `shell`).
 * Presentation only — no domain writes (ADR 0035).
 *
 * `F1-05`: عندَ وجودِ جلسةٍ صالحةٍ تُسلَّم الشاشةُ إلى الموجّهِ المبنيِّ على الدور،
 * والدورُ يُقرأ من الخادمِ ههنا لا من حاملِ الجلسةِ ولا من تيليجرام. وبلا جلسةٍ
 * **لا يُطلَب دورٌ إطلاقاً** (ADR 0035 §2: لا وصولَ إلى API قبلَ الجلسة).
 *
 * `F1-06`: الإقلاعُ يضبط الاتجاهَ ثم يربط السمةَ **قبلَ** إعلامِ تيليجرامَ
 * بالجهوزية، فلا تُعرَض الشاشةُ بلونٍ ثم تُصحَّح. والربطُ يُفَكُّ عندَ التفكيكِ
 * فلا يبقى مستمعُ حدثٍ معلَّقاً. ودورةُ الحياةِ (`ready`/`expand`) استدعاءٌ صريحٌ
 * ههنا لا أثرٌ جانبيٌّ لتطبيقِ السمة.
 */
export function Shell() {
  const [boot, setBoot] = useState<BootState>({ kind: "booting" });

  useEffect(() => {
    applyDocumentDirection();
    const detachTheme = bindTelegramTheme();
    notifyReady();
    expandApp();
    const inside = isInsideTelegram();
    const initData = getRawInitData();
    if (hasValidSession()) {
      setBoot({ kind: "ready" });
    } else {
      setBoot({
        kind: "awaiting_session",
        hasInitData: initData !== null,
        insideTelegram: inside,
      });
    }
    return detachTheme;
  }, []);

  if (boot.kind === "booting") {
    return (
      <main style={styles.main} aria-busy="true">
        <p style={styles.muted}>جارٍ التحميل…</p>
      </main>
    );
  }

  if (boot.kind === "awaiting_session") {
    return (
      <main style={styles.main}>
        <h1 style={styles.title}>وَصْلة</h1>
        <p style={styles.muted}>
          {boot.insideTelegram
            ? boot.hasInitData
              ? "بانتظار التحقق من الهوية على الخادم (F1-03)."
              : "تعذّر قراءة بيانات تيليجرام. أعد فتح التطبيق من البوت."
            : "افتح وَصْلة من داخل تيليجرام. تشغيل المتصفح بمصادقة بديلة يأتي لاحقاً (ARCH-014)."}
        </p>
        <p style={{ ...styles.muted, fontSize: "0.85rem" }}>
          F1-01 · هيكل Mini App · لا حالة عمل محلية
        </p>
      </main>
    );
  }

  return (
    <main style={styles.main}>
      <RoleRouter />
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100%",
    /** `F1-06`: الحواشي الأربعُ — الجانبيةُ تلزم في العرضيِّ وفي شاشةٍ ذاتِ نتوء. */
    paddingBlock: "calc(1.5rem + var(--safe-top)) calc(1.5rem + var(--safe-bottom))",
    paddingLeft: "calc(1.25rem + var(--safe-left))",
    paddingRight: "calc(1.25rem + var(--safe-right))",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    justifyContent: "center",
  },
  title: {
    margin: 0,
    fontSize: "1.75rem",
    fontWeight: 700,
  },
  muted: {
    margin: 0,
    color: "var(--tg-hint-color)",
  },
};
