/**
 * الغرض: الخريطة الحرارية للطلب والعرض: تُقسَّم المدينة إلى خلايا جغرافية، ويُعرض
 *   في كل خلية عدد الطلبات (طلب) مقابل عدد السائقين المتاحين (عرض). اللون يعبّر عن
 *   الفارق لا عن الحجم: منطقة فيها عشرة طلبات وعشرة سائقين ليست مشكلة، ومنطقة فيها
 *   طلبان بلا سائق واحد مشكلة.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: خريطة جغرافية حقيقية (Leaflet) تحتاج أصلاً خارجياً وخطوة بناء،
 *   وكلاهما مرفوض في ADR 0007؛ الشبكة هنا تُجيب عن نفس السؤال بلا أيّهما.
 */

import { formatNumber } from "../format.ts";
import { escapeHtml, metricCard, section } from "../layout.ts";
import type { CityOption } from "./drivers.ts";

export interface HeatCell {
  readonly row: number;
  readonly col: number;
  readonly centerLat: number;
  readonly centerLng: number;
  readonly demand: number;
  readonly supply: number;
}

export interface HeatmapPageData {
  readonly cells: readonly HeatCell[];
  readonly rows: number;
  readonly cols: number;
  readonly cities: readonly CityOption[];
  readonly cityId: string | null;
  readonly cityName: string | null;
  readonly windowHours: number;
  readonly availableWindows: readonly number[];
  readonly totalDemand: number;
  readonly totalSupply: number;
  /** حجم ضلع الخلية بالدرجات — قيمة تشغيلية من platform_settings لا رقم هنا. */
  readonly cellDegrees: number;
}

/**
 * لون الخلية: أحمر حيث الطلب يفوق العرض، أخضر حيث العرض يكفي، رمادي حيث لا نشاط.
 * الشدّة من حجم الفارق لا من حجم الطلب وحده.
 */
function cellColor(demand: number, supply: number, maxGap: number): string {
  if (demand === 0 && supply === 0) return "#1c202a";
  const gap = demand - supply;
  const intensity = maxGap === 0 ? 0 : Math.min(1, Math.abs(gap) / maxGap);
  const MIN_LIGHT = 32;
  const LIGHT_RANGE = 40;
  const light = Math.round(MIN_LIGHT + (1 - intensity) * LIGHT_RANGE);
  if (gap > 0) return `hsl(0 62% ${light}%)`;
  if (gap < 0) return `hsl(146 48% ${light}%)`;
  return "hsl(210 12% 30%)";
}

export function renderHeatmapPage(data: HeatmapPageData): string {
  const cityOptions = data.cities
    .map(
      (city) =>
        `<option value="${escapeHtml(city.id)}"${
          data.cityId === city.id ? " selected" : ""
        }>${escapeHtml(city.nameAr)}</option>`,
    )
    .join("");

  const windowOptions = data.availableWindows
    .map(
      (hours) =>
        `<option value="${hours}"${data.windowHours === hours ? " selected" : ""}>${escapeHtml(
          formatNumber(hours),
        )} ساعة</option>`,
    )
    .join("");

  const filters = `<form class="filters" method="get" action="/admin/heatmap">
  <label>المدينة
    <select name="city">
      <option value="">اختر مدينة</option>${cityOptions}
    </select>
  </label>
  <label>نافذة الطلب
    <select name="hours">${windowOptions}</select>
  </label>
  <button type="submit">تطبيق</button>
</form>`;

  if (data.cityId === null) {
    return `<h1>خريطة الطلب والعرض</h1>
${filters}
<p class="empty">اختر مدينة لعرض خريطتها. الخريطة لكل مدينة على حدة: دمج مدن متباعدة في شبكة واحدة يُنتج شبكة فارغة أغلبها.</p>`;
  }

  if (data.cells.length === 0) {
    return `<h1>خريطة الطلب والعرض — ${escapeHtml(data.cityName ?? "")}</h1>
${filters}
<p class="empty">لا طلب ولا سائق بموقع مسجَّل في هذه النافذة، فلا خريطة تُرسم.</p>`;
  }

  const maxGap = data.cells.reduce(
    (max, cell) => Math.max(max, Math.abs(cell.demand - cell.supply)),
    0,
  );

  const byPosition = new Map<string, HeatCell>();
  for (const cell of data.cells) byPosition.set(`${cell.row}:${cell.col}`, cell);

  const squares: string[] = [];
  for (let row = 0; row < data.rows; row += 1) {
    for (let col = 0; col < data.cols; col += 1) {
      const cell = byPosition.get(`${row}:${col}`);
      const demand = cell?.demand ?? 0;
      const supply = cell?.supply ?? 0;
      const title =
        cell === undefined
          ? "لا نشاط"
          : `طلب ${demand} · عرض ${supply} · ${cell.centerLat.toFixed(3)}, ${cell.centerLng.toFixed(3)}`;
      const text = demand === 0 && supply === 0 ? "" : `${demand}/${supply}`;
      squares.push(
        `<div class="cell" style="background:${cellColor(demand, supply, maxGap)}" title="${escapeHtml(
          title,
        )}">${escapeHtml(text)}</div>`,
      );
    }
  }

  const shortage = data.cells.filter((cell) => cell.demand > cell.supply).length;

  const cards = [
    metricCard("طلبات في النافذة", formatNumber(data.totalDemand)),
    metricCard("سائقون متاحون بموقع", formatNumber(data.totalSupply)),
    metricCard("خلايا الطلب يفوق فيها العرض", formatNumber(shortage)),
    metricCard("ضلع الخلية", `${formatNumber(data.cellDegrees)}°`, "من إعدادات المدينة"),
  ].join("");

  const grid = `<div class="grid-map" style="grid-template-columns:repeat(${data.cols},minmax(28px,1fr))">${squares.join(
    "",
  )}</div>
<div class="legend">
  <span><span class="swatch" style="background:hsl(0 62% 40%)"></span>الطلب يفوق العرض</span>
  <span><span class="swatch" style="background:hsl(146 48% 40%)"></span>العرض يكفي أو يزيد</span>
  <span><span class="swatch" style="background:#1c202a"></span>لا نشاط</span>
  <span>الرقم في الخلية: طلب/عرض. الشمال أعلى، والشرق يمين الشبكة.</span>
</div>`;

  return `<h1>خريطة الطلب والعرض — ${escapeHtml(data.cityName ?? "")}</h1>
${filters}
<div class="cards" style="margin-bottom:16px">${cards}</div>
${section(
  `الشبكة — آخر ${formatNumber(data.windowHours)} ساعة`,
  grid,
  "الطلب: مواقع انطلاق الطلبات في النافذة. العرض: السائقون المتاحون الآن بآخر موقع مسجَّل لهم.",
)}`;
}
