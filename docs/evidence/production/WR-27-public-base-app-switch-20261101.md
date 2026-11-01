# WR-27 — نقلُ القاعدةِ العامّةِ إلى نطاقِ app (ADR 0295) — 2026-11-01

المستوى: **منشورٌ على CasaOS + متحقَّقٌ أونلاين** (لم يُختبر بعدُ على جهازٍ حقيقيّ).

## ما تغيّر
- `/etc/wasla/ingress.env`: `PUBLIC_BASE_URL` من `https://api.waslareev.dpdns.org` إلى `https://app.waslareev.dpdns.org`.
- نسخٌ احتياطيّةٌ قبل التغيير: `/etc/wasla/ingress.env.bak-pre-app-20261101T150731Z` و`/etc/wasla/public.env.bak-pre-app-20261101T150731Z`.
- طبّقه `wasla-tunnel-sync.timer` آليّاً (سجلّ `journalctl -t wasla-tunnel-sync`):
  - 15:07:41 `url_changed from=https://api… to=https://app…`
  - 15:07:46 `recreated_ready svc=gateway-1`
  - 15:07:50 `recreated_ready svc=gateway-2`
  - 15:07:51/52 `set_webhook bot=rider ok=true` / `bot=driver ok=true`

## التحقّق
- مراقبةُ `https://app…/ready` كلَّ ثانيتين طوالَ التبديل: **75/75 ناجحة، 0 فاشلة** (لا انقطاع).
- `public.env`: `MINIAPP_URL` و`OBJECT_STORAGE_PUBLIC_URL` = `https://app.waslareev.dpdns.org`.
- getWebhookInfo: الراكب `https://app…/webhook/telegram/rider` والسائق `…/driver`، pending=0، لا خطأ.
- getChatMenuButton للبوتين: `web_app` → `https://app.waslareev.dpdns.org/`.
- `api…/ready` = 200 (يبقى عاملاً للتوافق)، `app…/ready` = 200، `app…/` = 200.
- الحاويتان gateway-1/2 healthy.

## التراجع
استعادةُ ملفَّي ‎.bak أعلاه إلى `/etc/wasla/`؛ المؤقّتُ يعيدُ المزامنةَ (إعادةُ إنشاءِ البوّابتين وضبطُ الويبهوك) خلال دقيقة.
