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

import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { Glyph, type GlyphName, IconChevron } from "../../../system/ui/icons.tsx";
import type { AccountRightsProps } from "../../account/AccountRights.tsx";
import { AccountRights } from "../../account/AccountRights.tsx";
import { driverAccountView } from "./account-view.ts";

export interface DriverAccountScreenProps extends Omit<AccountRightsProps, "view" | "header"> {
  readonly language?: MiniAppLanguage;
  /**
   * `UI-4` · D12: مداخلُ ملفِّ العملِ من «حسابي» — الوثائقُ والمركبةُ والاشتراك. كانَت
   * أزراراً بنصٍّ مُضمَّنٍ في شاشةٍ فارغةٍ داخلَ `DriverRoot`؛ صارَت ههنا بمفاتيحِ القاموس.
   * كلُّ مدخلٍ يُرسَمُ إن كانَ له مستقبِلٌ فحسب.
   */
  readonly onOpenDocuments?: () => void;
  readonly onOpenVehicle?: () => void;
  readonly onOpenSubscription?: () => void;
}

export function AccountScreen({
  onOpenDocuments,
  onOpenVehicle,
  onOpenSubscription,
  ...props
}: DriverAccountScreenProps) {
  const t = miniAppTranslator(props.language ?? MINIAPP_DEFAULT_LANGUAGE);
  const links = [
    {
      key: "documents",
      glyph: "file",
      label: t("driver.account.work.documents"),
      onOpen: onOpenDocuments,
    },
    {
      key: "vehicle",
      glyph: "car",
      label: t("driver.account.work.vehicle"),
      onOpen: onOpenVehicle,
    },
    {
      key: "subscription",
      glyph: "card",
      label: t("driver.account.work.subscription"),
      onOpen: onOpenSubscription,
    },
  ].filter((link): link is typeof link & { onOpen: () => void } => link.onOpen !== undefined);
  const header =
    links.length === 0 ? undefined : (
      <nav className="ac__links" aria-label={t("driver.account.work.label")}>
        {links.map((link) => (
          <button key={link.key} type="button" className="ac__link" onClick={link.onOpen}>
            <span className="ac__link-icon">
              <Glyph name={link.glyph as GlyphName} />
            </span>
            <span className="ac__link-label">{link.label}</span>
            <IconChevron className="ac__link-chevron" />
          </button>
        ))}
      </nav>
    );
  return <AccountRights {...props} view={driverAccountView} header={header} />;
}
