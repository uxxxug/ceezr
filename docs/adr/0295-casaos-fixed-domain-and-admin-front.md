# ADR 0295: نطاقٌ ثابتٌ لـCasaOS عبرَ نفقِ Cloudflare المسمّى، وبابٌ مستقلٌّ للوحةِ الإدارة

**الحالة:** مقبول — قرارُ المالكِ 2026-11-01 (حجزُ `waslareev.dpdns.org` وربطُه بنفقِ Cloudflare المسمّى `casaOS-Server`، وتوجيهُ `app` و`api` و`admin`).
**التاريخ:** 2026-11-01
**يبني على:** [ADR 0293](0293-casaos-public-ingress-via-tunnel-with-whitelist.md) (الواجهةُ العامّةُ بقائمةٍ بيضاء) · [ADR 0292](0292-multi-instance-gateway-distribution-is-decided.md).
**لا يمسّ:** `render.yaml` ونشرَ Render: باقيانِ في المستودعِ مسارًا تاريخيًّا/بديلًا، ولا يُستعمَلان.
**الدليل:** [`WR-27-casaos-fixed-domain-20261101.md`](../evidence/production/WR-27-casaos-fixed-domain-20261101.md)
**Work Packet:** `docs/work-packets/wr-27-casaos-fixed-domain-20261101.json`

## ١) السياق

- النفقُ السريعُ (ADR 0293) يتغيّرُ رابطُه، فيتغيّرُ زرُّ Mini App والـwebhook معه، ولا يصلحُ لتجربةٍ ميدانيّة.
- المالكُ ربطَ نطاقًا ثابتًا بنفقٍ مسمّى يديرُه تطبيقُ CasaOS `cloudflared` (`wisdomsky/cloudflared-web`) **على شبكةِ المضيف**، ويوجّهُ إلى `http://192.168.0.135:<منفذ>`.
- قيسَ 502 من الإنترنت لسببَين: (أ) HAProxy كانَ ينشرُ `8443` على `127.0.0.1` فقط، فيرفضُ الاتصالَ بعنوانِ الشبكةِ المحلّيّة؛ (ب) المسارُ كانَ `https://` والمنفذُ يتكلّمُ HTTP (`tls: first record does not look like a TLS handshake` في سجلِّ cloudflared). صحّحَ المالكُ (ب) إلى `http://`.
- لوحةُ الإدارةِ (`/admin`) محجوبةٌ من الواجهةِ العامّةِ (403) بقرارِ ADR 0293، ولا بابَ لها إلّا `127.0.0.1:8080`، والمالكُ يحتاجُ موقعًا لمراقبةِ السائقينَ وتوثيقِهم وحظرِهم.

## ٢) القرار

1. **`8443` منشورٌ على `0.0.0.0`، وHAProxy يقبلُ من المضيفِ وحدَه:** `acl from_host src 127.0.0.0/8 172.16.0.0/12 192.168.0.135` ثمّ `deny 403 unless from_host` **قبلَ** فحصِ `Cf-Connecting-Ip`؛ فجهازٌ آخرُ في الشبكةِ المحلّيّةِ لا يستطيعُ انتحالَ رأسِ Cloudflare.
2. **`admin_front` على `:8444`** بالشرطَينِ نفسَيهما، ولا يمرّرُ إلّا `/admin` وما تحته (و`/` ← `/admin`)، وكلُّ ما سواهُ 404؛ فلا Mini App ولا webhook ولا Socket.IO ولا `/metrics` من هذا الباب. والدخولُ رمزٌ لمرّةٍ واحدةٍ إلى حسابِ المسؤولِ في تيليجرام (`apps/gateway/src/admin/auth.ts`)، ويوصى بـCloudflare Access فوقَه.
3. **`PUBLIC_BASE_URL` في `/etc/wasla/ingress.env`** يقدَّمُ في `wasla-tunnel-sync.sh` على رابطِ النفقِ السريع؛ فيضبطُ `MINIAPP_URL` و`OBJECT_STORAGE_PUBLIC_URL` والـwebhook على النطاقِ الثابت، ويبقى النفقُ السريعُ احتياطًا يُقرأُ حينَ يغيبُ الملفّ.

| النطاق | الوجهة | ما يُخدَم |
|---|---|---|
| `app.waslareev.dpdns.org` | `http://192.168.0.135:8443` | Mini App (الراكب والسائق) + واجهةُ API نفسُها |
| `api.waslareev.dpdns.org` | `http://192.168.0.135:8443` | الـwebhook وAPI |
| `admin.waslareev.dpdns.org` | `http://192.168.0.135:8444` | `/admin` وحدَه |

## ٣) العواقب

- **إيجابيّ:** رابطٌ ثابتٌ لزرِّ Mini App والـwebhook؛ لوحةُ إدارةٍ من الإنترنت ببابٍ لا يكشفُ غيرَها.
- **سلبيّ/مخاطر:** `192.168.0.135` مكتوبٌ في الإعداد؛ إن تغيّرَ عنوانُ الخادمِ (DHCP) انقطعَ النفقُ المسمّى ورُفضَ مصدرُه حتّى يُحدَّثَ الإعدادُ والمسارُ معًا. ويُوصى بحجزِ العنوانِ في الموجّه.
- **التراجع:** إعادةُ `127.0.0.1:8443` وحذفُ `:8444` من `compose.yml`، وحذفُ `/etc/wasla/ingress.env` ثمّ `systemctl start wasla-tunnel-sync` فيعودُ رابطُ النفقِ السريع. النسخةُ السابقةُ من الملفّاتِ في `/opt/wasla/backups/pre-domain-<ts>/`.
