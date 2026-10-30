# WR-27 — البابُ العامُّ لـCasaOS عبرَ نفقٍ مؤقّت (2026-10-30)

القرار: [ADR 0293](../../adr/0293-casaos-public-ingress-via-tunnel-with-whitelist.md). المضيف: خادمُ CasaOS (4 أنوية، 13 GiB). الصورة: `wasla/gateway:f8e9aa4f` في نسختَين خلفَ HAProxy.
لا أسرارَ في هذا الملفّ. الرموزُ وسرُّ الـwebhook وسرُّ الإشاراتِ تبقى في `/etc/wasla/*.env` (600) ولم تُطبَع.

مستوياتُ الدليلِ أدناه منفصلة: **[خ]** قياسٌ على الخادمِ الحيِّ أو من الإنترنتِ نحوَه. **[ت]** تيليجرامُ الحقيقيُّ (Bot API). **[ج]** جهازٌ حقيقيٌّ بمستخدمٍ حقيقيّ: **لا شيءَ منه بعد**. **[م]** اختبارٌ آليٌّ في متصفّح: **لا شيءَ منه بعد**.

## 1) النسخةُ الاحتياطيّةُ قبلَ التغيير [خ]

- `/opt/wasla/backups/pre-trial-20261030T122812Z/`: فيه `pg_dump -Fc` (2621 مُدخَلًا في `pg_restore -l`، وأوّلُ sha256 هو `411c86426952dfdf`)، والإعداداتُ، وقائمةُ الحاويات، وأرشيفُ المجلّدات `wasla_pgdata` و`wasla_redisdata` و`wasla-bun-cache`.
- **الاستعادة جُرِّبَت فعلًا** في حاويةٍ معزولةٍ بـ`createdb -T template0`، فخرجَت بـrc=0. النتيجة: 87 جدولًا في `public` (مطابقٌ للحيّ)، و1167 دالّة، و5 مدن.
- احتياطُ الإعداداتِ قبلَ التعديل: `compose.yml.bak-pre-ingress` و`haproxy.cfg.bak-pre-ingress` و`gateway.env.bak-pretrial-*`.
- **فجوةٌ قائمة:** `backup.sh` الليليُّ لا يشملُ `signal.env` ولا `public.env`. ولا تخزينَ للوثائقِ بعد، ولذلك يبقى الرفعُ موقوفًا (`DRIVER_DOCUMENT_UPLOADS=paused`).

## 2) الفحصُ من الإنترنت إلى الرابطِ العامّ [خ]

| المسار | الرمز | المتوقَّع |
|---|---|---|
| `/` (Mini App) | 200 | 200 |
| `/ready` · `/health` | 200 · 200 | 200 |
| `/internal/realtime/offers-signal` | 403 | محجوب |
| `/metrics` · `/admin` | 403 · 403 | محجوب |
| `POST /webhook/telegram/rider` بلا سرّ | 401 | مرفوض من البوّابة |
| `/socket.io/?EIO=4&transport=polling` | مصافحة `sid` و`upgrades:["websocket"]` | تعمل |
| `/v1/` · `/track/x` · ملفٌّ ساكنٌ غيرُ موجود | 404 · 404 · 404 | لا تسريب |

ترويساتُ الصفحة: `content-security-policy: frame-ancestors https://telegram.org https://*.telegram.org`، و`strict-transport-security`، و`x-content-type-options: nosniff`.
والطلبُ إلى `:8443` بلا `Cf-Connecting-Ip` يُرَدُّ بـ403، أي أنّ الواجهةَ العامّةَ لا تُخدَمُ إلّا عبرَ النفق.

## 3) تيليجرام [ت]

`getWebhookInfo` للبوتَين بعدَ المزامنة:

| البوت | `url` | `pending_update_count` | `last_error_message` | `max_connections` |
|---|---|---|---|---|
| الراكب | `<الرابط>/webhook/telegram/rider` | 0 | لا يوجد | 40 |
| السائق | `<الرابط>/webhook/telegram/driver` | 0 | لا يوجد | 40 |

`allowed_updates`: `message` و`edited_message` و`callback_query` و`my_chat_member` و`chat_member` و`chat_join_request`.
وزرُّ القائمةِ «وصلة» يشيرُ إلى الرابطِ العامّ، وضبطَته البوّابةُ عندَ الإقلاعِ من `MINIAPP_URL`.

سجلُّ المزامنة (`journalctl -t wasla-tunnel-sync`):

```
12:38:30 url_changed from=https://miniapp.invalid to=https://<quick-tunnel>.trycloudflare.com
12:38:35 recreated_ready svc=gateway-1
12:38:39 recreated_ready svc=gateway-2
12:38:40 set_webhook bot=rider ok=true
12:38:41 set_webhook bot=driver ok=true
```

ولم تُسجَّل أيُّ دورةٍ بعدَها، لأنّ الرابطَ لم يتغيّر. المؤقّت `wasla-tunnel-sync.timer` مُفعَّل (60 ثانية).

## 4) التعافي: إيقافُ نسخةٍ في كلِّ مرّة [خ]

القاعدةُ بلا مستخدمين، فالاختبارُ آمن. الطريقة: طلبُ `GET /ready` عبرَ الواجهةِ العامّةِ كلَّ نصفِ ثانية، و`docker stop -t 30`.

| المرحلة | ناجح | فاشل | ملاحظة |
|---|---|---|---|
| خطُّ الأساس (10ث) | 19 | 0 | |
| إيقافُ `gateway-2` (40ث) | 70 | 1 (`000`) | طلبٌ كان قيدَ التنفيذ. HAProxy: `gateway-2 is DOWN … 1 active` |
| بعدَ إعادتِها (60ث) | 114 | 0 | |
| إيقافُ `gateway-1`، العامل (0–60ث) | 108 | 1 (`000`) | طلبٌ كان قيدَ التنفيذ |
| `gateway-1` موقوفة (60–180ث) | 229 | 0 | `gateway-2` تعيدُ `degraded` بسبب `critical_jobs_freshness` («نبضتُها بائتة: expire-offers… redispatch-searching… release-scheduled…») |
| بعدَ إعادةِ `gateway-1` (90ث) | 171 | 0 | النسختانِ `ready` |

**القراءة:**
- إيقافُ أيِّ نسخةٍ يُسقِطُ الطلبَ الجاريَ فقط.
- **إيقافُ العاملِ لا يُسقِطُ الخدمة، لكنّه يوقفُ المهامَّ الحرجة** (انتهاءُ العروض، وإعادةُ التوزيع، والجدولة) حتى يعود. هذه نقطةُ فشلٍ مفردة، وهي دَينٌ مُعلَن.
- لا تصريفَ (drain) قبلَ الإيقاف: HAProxy يكتشفُ السقوطَ بفحصِ TCP بعدَ نحوِ ثانيتَين.

## 5) عطبٌ مكتشَف: تفعيلُ مدينةٍ أثناءَ التشغيل [خ]

بعدَ تفعيلِ المدنِ الخمسِ في القاعدة، أعادت النسختانِ `/ready` بقيمة `not_ready`، مع `critical_jobs` و«العاملُ لا ينبض — لا نبضةَ لها: expire-offers:<مدينة>…». السبب:
- مهامُّ المدنِ تُحسَبُ مرّةً واحدةً عندَ إقلاعِ العامل: `container.jobs()` في `apps/gateway/src/embedded-worker.ts:55`.
- الفحصُ يقرأُ نبضاتِ الأسطولِ من القاعدة، فيفشلُ في النسختَين معًا.
- HAProxy يفحصُ `/ready`، فيُخرجُ النسختَين: **انقطاعٌ كامل.**

**الإجراءُ المعتمَدُ اليوم:** إعادةُ تشغيلِ `gateway-1` فورَ تفعيلِ أيِّ مدينة (`deploy/casaos/README.md`). بعدَها كتبَ العاملُ 91 مهمّة، وعادت النسختانِ `ready`.
**الإصلاحُ البرمجيُّ** (مصالحةٌ دوريّةٌ للمدنِ المفعَّلة) لم يُنفَّذ بعد.

## 6) ما لم يُختبَر

- تجربةٌ على جهازٍ حقيقيٍّ بحسابَي راكبٍ وسائق ([ج]): لم تُنفَّذ.
- سعةُ 2,000 مستخدمٍ على هذا المسار، وسعةُ النفقِ السريع: لم تُقاسا.
- إشاراتُ النسخِ عبرَ مستخدمَين حقيقيَّين على نسختَين مختلفتَين: لم تُقَس هنا. هي مقيسةٌ آليًّا في CI (`F5-06`).
