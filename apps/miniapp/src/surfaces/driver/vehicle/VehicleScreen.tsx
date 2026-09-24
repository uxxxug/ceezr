/**
 * الغرض: شاشةُ مركبةِ السائقِ — بياناتُ المركبةِ الأساسيّةُ ووثائقُها الثلاثُ
 *   والشعارُ والباركودُ (`F3-07` · `SD-11` · `F12-06`).
 * الحالة: مبنيٌّ — البندُ `F3-07` · `F12-06`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/vehicle
 * يُستخدم من: `DriverRoot.tsx`
 * الحاكم: docs/adr/0094-project-independence.md · docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — وحدودُها مُعلَنةٌ (`ح-5`)
 *
 *   ــ **لا ترفعُ بايتاً**: رفعُ الشعارِ والباركودِ يمرُّ عبرَ `F3-01`.
 *   ــ **لا تُولِّدُ باركوداً**: توليدُهُ من الشعارِ عملُ عرضٍ.
 *   ــ **لا تُفعِّلُ تيليجرامَ**: `showScanQrPopup` يُستدعى من الشاشةِ.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { EmptyState } from "../../../system/EmptyState.tsx";
import {
  type ApiDriverVehicleAssetsReadResponse,
  type ApiDriverVehicleResponse,
  readDriverVehicle,
  readDriverVehicleAssets,
  updateDriverVehicle,
} from "./vehicle-api.ts";
import {
  isRetryableVehicleError,
  toVehicleDashboard,
  type VehicleDashboardModel,
  vehicleErrorKey,
} from "./vehicle-view.ts";

export interface VehicleScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  readonly readVehicle?: () => Promise<ApiDriverVehicleResponse>;
  readonly readAssets?: () => Promise<ApiDriverVehicleAssetsReadResponse>;
}

type VehicleState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly vehicle: VehicleDashboardModel }
  | { readonly kind: "failed"; readonly code: string };

type SaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  | { readonly kind: "failed"; readonly code: string };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

export function VehicleScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  readVehicle = readDriverVehicle,
  readAssets = readDriverVehicleAssets,
}: VehicleScreenProps) {
  const t = miniAppTranslator(language);
  const formId = useId();
  const [state, setState] = useState<VehicleState>({ kind: "loading" });
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [assetUrls, setAssetUrls] = useState<{
    logo: string | null;
    barcode: string | null;
  }>({ logo: null, barcode: null });

  // نموذج التحرير
  const [vehicleType, setVehicleType] = useState<string>("");
  const [plateNumber, setPlateNumber] = useState<string>("");
  const [vehicleYear, setVehicleYear] = useState<string>("");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await readVehicle();
      setState({ kind: "ready", vehicle: toVehicleDashboard(response) });
      setVehicleType(response.vehicle_type ?? "");
      setPlateNumber(response.plate_number ?? "");
      setVehicleYear(response.vehicle_year !== null ? String(response.vehicle_year) : "");
      // تحميل روابط القراءة الموقعة للشعار والباركود بعد قراءة المركبة.
      // لا يُعطَّل قراءة المركبة بغياب المُوقِّع — روابطُ القراءةِ تكميليّةٌ.
      if (response.logo_object_path !== null || response.barcode_object_path !== null) {
        try {
          const assets = await readAssets();
          setAssetUrls({
            logo: assets.logoReadUrl,
            barcode: assets.barcodeReadUrl,
          });
        } catch {
          // غيابُ روابطِ القراءةِ لا يُسقِطُ الشاشةَ — الحالةُ تُعرَضُ نصّاً.
          setAssetUrls({ logo: null, barcode: null });
        }
      } else {
        setAssetUrls({ logo: null, barcode: null });
      }
    } catch (error) {
      setState({ kind: "failed", code: codeOf(error) });
    }
  }, [readVehicle, readAssets]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    setSaveState({ kind: "saving" });
    try {
      const year = vehicleYear.trim() === "" ? null : Number(vehicleYear);
      await updateDriverVehicle(vehicleType.trim() || null, plateNumber.trim() || null, year);
      setSaveState({ kind: "saved" });
      await load();
    } catch (error) {
      setSaveState({ kind: "failed", code: codeOf(error) });
    }
  }, [vehicleType, plateNumber, vehicleYear, load]);

  return (
    <section aria-labelledby="vehicle-screen-title" className="dveh__screen">
      <header className="dveh__header">
        <h1 id="vehicle-screen-title">{t("driver.vehicle.title")}</h1>
        {onBack !== undefined && (
          <button type="button" className="dveh__back" onClick={onBack}>
            {t("driver.vehicle.back")}
          </button>
        )}
      </header>

      {state.kind === "loading" && (
        <div className="dveh__loading" role="status">
          {t("driver.vehicle.loading")}
        </div>
      )}

      {state.kind === "failed" && (
        <div className="dveh__error" role="alert">
          <p>{t(vehicleErrorKey(state.code))}</p>
          {isRetryableVehicleError(state.code) && (
            <button type="button" className="dveh__retry" onClick={() => void load()}>
              {t("driver.vehicle.retry")}
            </button>
          )}
        </div>
      )}

      {state.kind === "ready" && (
        <>
          <div className="dveh__card dveh__card--info">
            <h2 className="dveh__card-title">{t("driver.vehicle.section.info")}</h2>
            <dl className="dveh__info-list">
              <div className="dveh__info-row">
                <dt>{t("driver.vehicle.label.plate_number")}</dt>
                <dd>{state.vehicle.plateNumber ?? t("driver.vehicle.value.not_set")}</dd>
              </div>
              <div className="dveh__info-row">
                <dt>{t("driver.vehicle.label.vehicle_type")}</dt>
                <dd>
                  {state.vehicle.vehicleTypeLabelKey !== null
                    ? t(state.vehicle.vehicleTypeLabelKey)
                    : t("driver.vehicle.value.not_set")}
                </dd>
              </div>
              <div className="dveh__info-row">
                <dt>{t("driver.vehicle.label.vehicle_year")}</dt>
                <dd>
                  {state.vehicle.vehicleYear !== null
                    ? String(state.vehicle.vehicleYear)
                    : t("driver.vehicle.value.not_set")}
                </dd>
              </div>
            </dl>
          </div>

          <div className="dveh__card dveh__card--docs">
            <h2 className="dveh__card-title">{t("driver.vehicle.section.documents")}</h2>
            <ul className="dveh__doc-list">
              {state.vehicle.registration !== null && (
                <li className="dveh__doc-item">
                  <span className="dveh__doc-name">
                    {t("driver.vehicle.document.registration")}
                  </span>
                  <span className="dveh__doc-status">
                    {state.vehicle.registration.statusLabelKey !== null
                      ? t(state.vehicle.registration.statusLabelKey)
                      : t("driver.vehicle.value.not_set")}
                  </span>
                  {state.vehicle.registration.expiresAt !== null && (
                    <span className="dveh__doc-expiry">
                      {t("driver.vehicle.document.expires_at")}:{" "}
                      {state.vehicle.registration.expiresAt}
                    </span>
                  )}
                </li>
              )}
              {state.vehicle.insurance !== null && (
                <li className="dveh__doc-item">
                  <span className="dveh__doc-name">{t("driver.vehicle.document.insurance")}</span>
                  <span className="dveh__doc-status">
                    {state.vehicle.insurance.statusLabelKey !== null
                      ? t(state.vehicle.insurance.statusLabelKey)
                      : t("driver.vehicle.value.not_set")}
                  </span>
                  {state.vehicle.insurance.expiresAt !== null && (
                    <span className="dveh__doc-expiry">
                      {t("driver.vehicle.document.expires_at")}: {state.vehicle.insurance.expiresAt}
                    </span>
                  )}
                </li>
              )}
              {state.vehicle.inspection !== null && (
                <li className="dveh__doc-item">
                  <span className="dveh__doc-name">{t("driver.vehicle.document.inspection")}</span>
                  <span className="dveh__doc-status">
                    {state.vehicle.inspection.statusLabelKey !== null
                      ? t(state.vehicle.inspection.statusLabelKey)
                      : t("driver.vehicle.value.not_set")}
                  </span>
                  {state.vehicle.inspection.expiresAt !== null && (
                    <span className="dveh__doc-expiry">
                      {t("driver.vehicle.document.expires_at")}:{" "}
                      {state.vehicle.inspection.expiresAt}
                    </span>
                  )}
                </li>
              )}
              {state.vehicle.registration === null &&
                state.vehicle.insurance === null &&
                state.vehicle.inspection === null && (
                  <li className="dveh__doc-empty">{t("driver.vehicle.document.empty")}</li>
                )}
            </ul>
          </div>

          <div className="dveh__card dveh__card--logo">
            <h2 className="dveh__card-title">{t("driver.vehicle.section.logo_barcode")}</h2>
            <p className="dveh__logo-hint">{t("driver.vehicle.logo.hint")}</p>
            {assetUrls.logo !== null ? (
              <img
                className="dveh__logo-image"
                src={assetUrls.logo}
                alt={t("driver.vehicle.logo.set")}
              />
            ) : state.vehicle.logoObjectPath !== null ? (
              <p className="dveh__logo-status dveh__logo-status--set">
                {t("driver.vehicle.logo.set")}
              </p>
            ) : (
              <p className="dveh__logo-status dveh__logo-status--unset">
                {t("driver.vehicle.logo.unset")}
              </p>
            )}
            {assetUrls.barcode !== null ? (
              <img
                className="dveh__barcode-image"
                src={assetUrls.barcode}
                alt={t("driver.vehicle.barcode.set")}
              />
            ) : state.vehicle.barcodeObjectPath !== null ? (
              <p className="dveh__logo-status dveh__logo-status--set">
                {t("driver.vehicle.barcode.set")}
              </p>
            ) : (
              <p className="dveh__logo-status dveh__logo-status--unset">
                {t("driver.vehicle.barcode.unset")}
              </p>
            )}
          </div>

          <form
            className="dveh__edit-form"
            id={formId}
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            <h2 className="dveh__card-title">{t("driver.vehicle.section.edit")}</h2>
            <label className="dveh__field">
              <span className="dveh__field-label">{t("driver.vehicle.label.vehicle_type")}</span>
              <select
                className="dveh__select"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
              >
                <option value="">{t("driver.vehicle.value.not_set")}</option>
                <option value="sedan">{t("driver.vehicle.type.sedan")}</option>
                <option value="suv">{t("driver.vehicle.type.suv")}</option>
                <option value="van">{t("driver.vehicle.type.van")}</option>
                <option value="pickup">{t("driver.vehicle.type.pickup")}</option>
                <option value="motorcycle">{t("driver.vehicle.type.motorcycle")}</option>
              </select>
            </label>
            <label className="dveh__field">
              <span className="dveh__field-label">{t("driver.vehicle.label.plate_number")}</span>
              <input
                className="dveh__input"
                type="text"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                placeholder={t("driver.vehicle.placeholder.plate_number")}
              />
            </label>
            <label className="dveh__field">
              <span className="dveh__field-label">{t("driver.vehicle.label.vehicle_year")}</span>
              <input
                className="dveh__input"
                type="number"
                min="1900"
                max="2100"
                value={vehicleYear}
                onChange={(e) => setVehicleYear(e.target.value)}
                placeholder={t("driver.vehicle.placeholder.vehicle_year")}
              />
            </label>
            <button type="submit" className="dveh__save" disabled={saveState.kind === "saving"}>
              {saveState.kind === "saving"
                ? t("driver.vehicle.save.saving")
                : t("driver.vehicle.save.submit")}
            </button>
            {saveState.kind === "saved" && (
              <p className="dveh__save-ok" role="status">
                {t("driver.vehicle.save.success")}
              </p>
            )}
            {saveState.kind === "failed" && (
              <p className="dveh__save-error" role="alert">
                {t(vehicleErrorKey(saveState.code))}
              </p>
            )}
          </form>
        </>
      )}

      {state.kind === "ready" &&
        state.vehicle.plateNumber === null &&
        state.vehicle.vehicleType === null &&
        state.vehicle.vehicleYear === null && (
          <EmptyState
            title={t("driver.vehicle.empty.title")}
            body={t("driver.vehicle.empty.body")}
          />
        )}
    </section>
  );
}
