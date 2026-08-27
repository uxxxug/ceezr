import { useEffect, useState } from "react";
import { applyThemeFromTelegram, getRawInitData, isInsideTelegram } from "../tg/index.ts";
import { hasValidSession } from "../identity/session.ts";

type BootState =
  | { kind: "booting" }
  | { kind: "awaiting_session"; hasInitData: boolean; insideTelegram: boolean }
  | { kind: "ready" };

/**
 * App shell (ROADMAP §9.4 package `shell`).
 * Presentation only — no domain writes (ADR 0035).
 */
export function Shell() {
  const [boot, setBoot] = useState<BootState>({ kind: "booting" });

  useEffect(() => {
    applyThemeFromTelegram();
    const inside = isInsideTelegram();
    const initData = getRawInitData();
    if (hasValidSession()) {
      setBoot({ kind: "ready" });
      return;
    }
    setBoot({
      kind: "awaiting_session",
      hasInitData: initData !== null,
      insideTelegram: inside,
    });
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
      <h1 style={styles.title}>وَصْلة</h1>
      <p style={styles.muted}>الجلسة جاهزة.</p>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100%",
    padding: "calc(1.5rem + var(--safe-top)) 1.25rem calc(1.5rem + var(--safe-bottom))",
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
