# نسختانِ من البوابةِ على خادمِ CasaOS وبابُها العامّ (ADR 0292 · ADR 0293)

مقطعُ compose وإعدادُ HAProxy لنشرِ نسختَين من البوابةِ خلفَ موزِّعٍ على المنفذِ الذي كانت تنشرُه النسخةُ الواحدةُ (`127.0.0.1:8080`). لا منفذَ جديدٌ ولا مساسَ بحاوياتِ المالك.

## الملفّات

| الملفّ | مكانُه على الخادم |
|---|---|
| `compose.gateways.yml` | يحلُّ محلَّ الخدمةِ `gateway` في `/opt/wasla/compose.yml` |
| `haproxy.cfg` | `/opt/wasla/haproxy.cfg` |
| — | `/etc/wasla/signal.env` (600): `INTERNAL_SIGNAL_SECRET` عشوائيٌّ يُولَّدُ على الخادمِ ولا يُطبَع |

## الشروط (يرفضُ الإقلاعُ بدونها)

- `PROCESS_TOPOLOGY=multi-process` و`SESSION_STORE=redis`.
- `GATEWAY_INTERNAL_URL` بعنوانَي النسختَين، و`INTERNAL_SIGNAL_SECRET` بطولِ 16 حرفاً فأكثر (`MULTI_PROCESS_WITHOUT_PEER_SIGNAL`).
- `RUN_WORKER_IN_GATEWAY=true` في `gateway-1` وحدَها.

## النشر

1. نسخةٌ احتياطيّة: `compose.yml` و`gateway.env` و`pg_dump -Fc` في `/opt/wasla/backups/pre-multi-<ts>/`، والتحقّقُ منها بـ`pg_restore -l`.
2. بناءُ الصورةِ من `/opt/wasla/src` عندَ الالتزامِ المدموج: `wasla/gateway:<sha>`.
3. كتابةُ `signal.env` و`haproxy.cfg`، واستبدالُ مقطعِ `gateway` في `compose.yml`.
4. `docker compose up -d --remove-orphans gateway-1 gateway-2 lb`، ثمّ التحقّقُ من:
   - `/ready` عبرَ الموزِّع = 200، والنسختانِ صحّيّتان.
   - نبضُ العاملِ في `job_heartbeats` من `gateway-1` وحدَها.
   - غيابُ `SINGLE_INSTANCE_INVARIANT` من السجلّ.

## العودة

```sh
sudo cp /opt/wasla/backups/pre-multi-<ts>/compose.yml /opt/wasla/compose.yml
sudo docker compose -f /opt/wasla/compose.yml up -d --remove-orphans
```

`--remove-orphans` يُزيلُ `gateway-1` و`gateway-2` و`lb`، ويُعيدُ `gateway` الواحدةَ على `127.0.0.1:8080`.

## البابُ العامّ (ADR 0293)

- نفقٌ سريعٌ (`tunnel/wasla-public-tunnel.service`) إلى `127.0.0.1:8443`، وهي الواجهةُ العامّةُ `public_front` في `haproxy.cfg`. لا منفذَ خارجيٌّ ولا DNS.
- الواجهةُ العامّةُ ترفضُ ما لا يحملُ `Cf-Connecting-Ip`، وتحجبُ `/internal` و`/metrics` و`/admin`، وتُمرِّرُ إلى البوّابةِ القائمةَ البيضاءَ فقط. وما عداها يذهبُ إلى `miniapp` (`miniapp-nginx.conf`).
- Mini App تُبنى بـ`VITE_WASLAH_API_BASE=` (الأصلُ نفسُه) في `/opt/wasla/miniapp/releases/<sha>`، والرابطُ `current` يشيرُ إلى الإصدارِ المنشور.
- `wasla-tunnel-sync.timer` (60ث) ينسخُ رابطَ النفقِ إلى `/etc/wasla/public.env` (`MINIAPP_URL`)، ويُعيدُ `gateway-1` ثمّ `gateway-2`، ويضبطُ webhook البوتين.
- تثبيت: انسخ ملفّاتِ `tunnel/*.service` و`*.timer` إلى `/etc/systemd/system/`، والسكربتَ إلى `/usr/local/sbin/`، ثمّ نفّذ `systemctl enable --now wasla-public-tunnel wasla-tunnel-sync.timer`.

## تفعيلُ مدينةٍ أثناءَ التشغيل

العاملُ يعيدُ حسابَ مهامِّ المدنِ كلَّ 60 ثانية (`embedded_worker.jobs_reconciled` في السجلّ). لكن بينَ التفعيلِ وأوّلِ شوطٍ لمهامِّ المدينة، قد يبقى `/ready` فاشلًا في النسختَين حتّى دقيقةٍ أو أكثرَ قليلًا («لا نبضةَ لها»)، ويُخرجُهما HAProxy خلالَها. **فعِّلِ المدنَ قبلَ فتحِ التجربةِ أو في وقتٍ هادئ.** وإيقافُ مدينةٍ لا يُزيلُ مهامَّها إلّا بإعادةِ `gateway-1`:

```sh
sudo docker compose -f /opt/wasla/compose.yml restart gateway-1
```

## العاملُ نقطةُ فشلٍ مفردة

إيقافُ `gateway-1` لا يُسقِطُ الخدمة: `gateway-2` تخدمُ بحالةِ `degraded`. لكنّ انتهاءَ العروضِ وإعادةَ التوزيعِ والجدولةَ تتوقّفُ حتى تعود. فلا تُوقِفْها أثناءَ التجربةِ إلّا للنشر.

## عودةُ البابِ العامّ

```sh
sudo systemctl disable --now wasla-tunnel-sync.timer wasla-public-tunnel
sudo cp /opt/wasla/compose.yml.bak-pre-ingress /opt/wasla/compose.yml
sudo cp /opt/wasla/haproxy.cfg.bak-pre-ingress /opt/wasla/haproxy.cfg
sudo docker compose -f /opt/wasla/compose.yml up -d --remove-orphans
```
