#!/usr/bin/env bash
# الدفعة 28: تجاربُ انقطاعِ PG إضافيّةٌ (W5) متناوبةً main/cand على القاعدةِ نفسِها — الأمرُ نفسُه في w5ab.
export PATH=$HOME/bunx/bun-linux-x64:$PATH
for i in $(seq "$1" "$2"); do for side in main cand; do d=/home/user/workspace/ceezr; [ $side = main ] && d=/home/user/workspace/wt-main
 (cd $d && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/waslah B28_WITNESS_OUT=/home/user/workspace/b28/${W5DIR:-w5c}/$side-$i.json timeout 200 bun test tests/integration/telegram-drainer-pool-acquisitions.test.ts > /home/user/workspace/b28/${W5DIR:-w5c}/$side-$i.log 2>&1); echo "$side-$i rc=$?"
done; done
