# WR-27 — نطاقٌ ثابتٌ لـCasaOS وبابُ لوحةِ الإدارة (2026-11-01)

**[خ] قياسٌ على خادمِ الإنتاجِ الحيّ (CasaOS) ومن الإنترنت.** ADR 0295 · حزمة `wr-27-casaos-fixed-domain-20261101`. لا أسرارَ في هذا الملفّ.

## ١) السببُ الجذريُّ لـ502 على `api`
- `ss -ltn`: HAProxy كانَ على `127.0.0.1:8443` فقط؛ والنفقُ المسمّى على شبكةِ المضيفِ يتّصلُ بـ`192.168.0.135:8443` ⇒ رفضُ اتّصال.
- سجلُّ `cloudflared`: `tls: first record does not look like a TLS handshake` لأنّ المسارَ كانَ `https://`. صحّحَه المالكُ إلى `http://`.

## ٢) ما تغيّرَ على الخادم (نسخةٌ سابقةٌ في `/opt/wasla/backups/pre-domain-<ts>/` مع تفريغِ القاعدة)
- `compose.yml`: منافذُ `lb` ← `127.0.0.1:8080` و`0.0.0.0:8443` و`0.0.0.0:8444`.
- `haproxy.cfg`: `acl from_host` في `public_front`، و`frontend admin_front` جديد. إعادةُ تحميلٍ بلا انقطاع.
- `/etc/wasla/ingress.env`: `PUBLIC_BASE_URL=https://api.waslareev.dpdns.org` (يُنقَلُ إلى `app` حينَ يصحُّ مسارُه)، ثمّ `wasla-tunnel-sync`: أُعيدت `gateway-1` ثمّ `gateway-2`، وضُبطَ الـwebhook وزرُّ القائمة.

## ٣) القياس
| الطلب | الرمز |
|---|---|
| `https://api…/` · `/ready` · مصافحةُ socket.io | 200 · 200 · 200 |
| `https://api…/admin` · `/metrics` · `/internal/…` | 403 · 403 · 403 |
| `POST https://api…/webhook/telegram/driver` بلا سرّ | 401 |
| المضيف: `192.168.0.135:8444/` · `/admin/login` · `/ready` · `/metrics` (بـ`Cf-Connecting-Ip`) | 302 · 200 · 404 · 404 |
| المضيف: `192.168.0.135:8444/admin/login` بلا الرأس | 403 |
| `getWebhookInfo` للبوتَين | `https://api.waslareev.dpdns.org/webhook/telegram/{driver,rider}`، pending 0، بلا خطأ |

## ٤) ما لم يكتمل (من جهةِ المالك) — قراءةُ إعدادِ النفقِ من سجلِّ `cloudflared` (الإصدار 4)
- `app.waslareev.dpdns.org` ← `http://192.168.0.135:80` (واجهةُ CasaOS نفسُها، لا Mini App) — **يجبُ أن يصيرَ `:8443`**.
- `admin.waslareev.dpdns.org` ← `http://192.168.0.135:8443` — **يجبُ أن يصيرَ `:8444`** (الآن `admin…/admin/login` = 403 لأنّه يصلُ إلى الواجهةِ العامّة).
- **لم يُقَس:** فتحُ Mini App من تيليجرامَ على جهازٍ حقيقيّ عبرَ `app`، وCloudflare Access على `admin`.
