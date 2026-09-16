/**
 * الغرض: شاشةُ حسابِ السائقِ (`SD-12` · البند `F3-08`) — **مُهايئٌ رقيقٌ** فوقَ
 *   لوحِ الحقوقِ المشتركِ، فيصيرُ حقُّ التنزيلِ وحقُّ الحذفِ **عامِلَينِ للسائقِ
 *   كما هما للراكبِ** (القسم 9.12).
 * الحالة: منفَّذٌ فعليّاً — البند `SD-12`. حكمُ CI يُقرأُ بعدَ الدفعِ.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/account
 * يُستخدم من: `DriverRoot.tsx`.
 * الحاكم: docs/adr/0126-one-account-core-two-roles.md · docs/adr/0125-a-drivers-erasure-stops-at-money-not-at-role.md
 *
 * ## العائقُ الذي يُغلِقُه هذا المِلفُّ
 *
 * الخادمُ مبنيٌّ ومقيسٌ منذُ `SD-12` الأوّلِ: `erase_my_account` تحكمُ للسائقِ،
 * والمالُ يمنعُ لا الدورُ، والإيصالُ يصفُ ما جرى، وحزمةُ التنزيلِ إحدى وثلاثونَ
 * قسماً. **وكانَ السطحُ غائباً** — و`DriverRoot.tsx` يقولُ ذلكَ نصّاً في رأسِ
 * مِلفِّه. فحقٌّ مبنيٌّ في القاعدةِ ولا بابَ له في الشاشةِ **حقٌّ غيرُ ممنوحٍ
 * عملاً**، وهذا المِلفُّ بابُه.
 *
 * ## ولماذا لا شيءَ ههنا غيرُ الوصفِ
 *
 * `ح-8` و`ADR 0126`: كلُّ السلوكِ في اللبِّ، وسطحُ الدورِ **بادئةٌ ودَينٌ**.
 * فسائقٌ يُمنَعُ من المحوِ برصيدٍ في محفظتِه يرى **الرقمَ** لا «لا يمكنُ الآنَ»،
 * لأنَّ اللبَّ يُنسِّقُ `walletBalanceMinor` الذي كانت البوّابةُ تنشرُه ولا
 * يُعلِنُه عقدُ العميلِ.
 */

import type { MiniAppLanguage } from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { AccountRights } from "../../account/AccountRights.tsx";
import type { AccountRightsProps } from "../../account/AccountRights.tsx";
import { driverAccountView } from "./account-view.ts";

export interface DriverAccountScreenProps extends Omit<AccountRightsProps, "view"> {
  readonly language?: MiniAppLanguage;
}

export function AccountScreen(props: DriverAccountScreenProps) {
  return <AccountRights {...props} view={driverAccountView} />;
}
