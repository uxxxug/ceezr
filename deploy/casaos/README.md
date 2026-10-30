# نسختانِ من البوابةِ على خادمِ CasaOS (ADR 0292)

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
