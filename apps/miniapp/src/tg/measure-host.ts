/**
 * Browser injection script builder for TTI measurement (F1-09 Row 5 · D-26).
 *
 * TEST-ONLY: not re-exported from `index.ts` for production. Re-exported under
 * a dedicated test-only symbol `buildBrowserHostScript` for `scripts/measure-tti.ts`.
 *
 * This file lives inside `tg/` because it must construct `window.Telegram.WebApp`
 * — the wrapper layer is the only place allowed to touch the host (ADR 0031 §3).
 * The measurement script calls this function; it never touches Telegram itself.
 *
 * **حدودُ القياسِ مُعلَنةٌ** (`ح-5`): القياسُ بوهمٍ لا بتيليجرامَ حقيقيٍّ.
 */

/**
 * Builds a `<script>` string that installs a fake Telegram WebApp host on
 * `window.Telegram.WebApp` before the miniapp loads. The `initData` is real
 * (signed by `scripts/lib/telegram-test-init-data.ts`) so the gateway's
 * `SEC-17` verification passes; everything else is a static mock.
 */
export function buildBrowserHostScript(initData: string, userJson: string): string {
  const authDate = Math.floor(Date.now() / 1000);
  return `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, initDataUnsafe: { user: ${userJson}, auth_date: ${authDate} }, version: "8.0", platform: "web", colorScheme: "light", themeParams: {}, isExpanded: true, viewportHeight: 823, viewportStableHeight: 823, ready: () => {}, expand: () => {}, close: () => {} } };`;
}
