/**
 * Sector Heatmap Widget
 * Treemap visualization of TASE stocks grouped by sector → sub-sector → symbol.
 * Rectangles sized by marketCap, colored by change %. Click to drill down.
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SymbolHeatmapItem {
  symbol: string;
  companyName: string | null;
  marketCap: number | null;
  change: number | null;
  sector: string;
  subSector: string | null;
}

interface SectorHeatmapResponse {
  tradeDate: string;
  marketType: string;
  count: number;
  items: SymbolHeatmapItem[];
}

type DrillLevel =
  | { level: "sectors" }
  | { level: "subsectors"; sector: string }
  | { level: "symbols"; sector: string; subSector: string };

// ── Squarified Treemap ─────────────────────────────────────────────────────────

interface Rect { x: number; y: number; w: number; h: number; }
type TreemapRect = Rect & { id: string };

function squarify(items: { id: string; value: number }[], bounds: Rect): TreemapRect[] {
  const filtered = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (!filtered.length || bounds.w <= 0 || bounds.h <= 0) return [];

  const totalValue = filtered.reduce((s, i) => s + i.value, 0);
  const totalArea = bounds.w * bounds.h;
  const normalized = filtered.map((i) => ({ id: i.id, area: (i.value / totalValue) * totalArea }));

  const result: TreemapRect[] = [];

  function worstAspect(row: typeof normalized, w: number): number {
    const rowArea = row.reduce((s, i) => s + i.area, 0);
    if (rowArea <= 0 || w <= 0) return Infinity;
    const rowLen = rowArea / w;
    if (rowLen <= 0) return Infinity;
    let worst = 0;
    for (const item of row) {
      if (item.area <= 0) continue;
      const itemLen = item.area / rowLen;
      const ar = Math.max(rowLen / itemLen, itemLen / rowLen);
      if (ar > worst) worst = ar;
    }
    return worst;
  }

  function layout(items: typeof normalized, rect: Rect) {
    if (!items.length || rect.w <= 1 || rect.h <= 1) return;
    if (items.length === 1) {
      result.push({ id: items[0]!.id, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      return;
    }

    const shorter = Math.min(rect.w, rect.h);
    let row = [items[0]!];
    let worst = worstAspect(row, shorter);

    for (let i = 1; i < items.length; i++) {
      const candidate = [...row, items[i]!];
      const newWorst = worstAspect(candidate, shorter);
      if (newWorst > worst) break;
      row = candidate;
      worst = newWorst;
    }

    const rowArea = row.reduce((s, i) => s + i.area, 0);
    const isHoriz = rect.w >= rect.h;
    const rowThick = isHoriz ? rowArea / rect.w : rowArea / rect.h;

    let offset = isHoriz ? rect.x : rect.y;
    for (const item of row) {
      const frac = item.area / rowArea;
      if (isHoriz) {
        const iw = rect.w * frac;
        result.push({ id: item.id, x: offset, y: rect.y, w: iw, h: rowThick });
        offset += iw;
      } else {
        const ih = rect.h * frac;
        result.push({ id: item.id, x: rect.x, y: offset, w: rowThick, h: ih });
        offset += ih;
      }
    }

    const remaining = items.slice(row.length);
    if (remaining.length > 0) {
      const newRect: Rect = isHoriz
        ? { x: rect.x, y: rect.y + rowThick, w: rect.w, h: rect.h - rowThick }
        : { x: rect.x + rowThick, y: rect.y, w: rect.w - rowThick, h: rect.h };
      layout(remaining, newRect);
    }
  }

  layout(normalized, bounds);
  return result;
}

// ── Color Scale ────────────────────────────────────────────────────────────────

function changeToColor(change: number | null): string {
  if (change == null) return "#4a4a4a";
  if (Math.abs(change) < 0.01) return "#444";
  if (change > 0) {
    const t = Math.min(change / 5, 1);
    const r = Math.round(0x55 + (0x00 - 0x55) * t);
    const g = Math.round(0x55 + (0xaa - 0x55) * t);
    const b = Math.round(0x55 + (0x44 - 0x55) * t);
    return `rgb(${r},${g},${b})`;
  }
  const t = Math.min(-change / 5, 1);
  const r = Math.round(0x55 + (0xcc - 0x55) * t);
  const g = Math.round(0x55 + (0x22 - 0x55) * t);
  const b = Math.round(0x55 + (0x22 - 0x55) * t);
  return `rgb(${r},${g},${b})`;
}

function fmtChange(c: number | null): string {
  if (c == null) return "—";
  return `${c >= 0 ? "+" : ""}${c.toFixed(2)}%`;
}

function fmtMarketCap(mc: number | null): string {
  if (mc == null) return "—";
  if (mc >= 1e9) return `₪${(mc / 1e9).toFixed(2)}B`;
  if (mc >= 1e6) return `₪${(mc / 1e6).toFixed(1)}M`;
  return `₪${mc.toLocaleString()}`;
}

// ── Data Extraction ────────────────────────────────────────────────────────────

function extractHeatmapData(result: CallToolResult | null | undefined): SectorHeatmapResponse | null {
  try {
    if (!result) return null;
    const tc = result.content?.find((c) => c.type === "text");
    if (!tc || tc.type !== "text") return null;
    // ChatGPT double-wrap unwrap
    let parsed = JSON.parse(tc.text);
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }
    if (parsed?.items && Array.isArray(parsed.items)) return parsed as SectorHeatmapResponse;
    return null;
  } catch {
    return null;
  }
}

// ── Node Computation ───────────────────────────────────────────────────────────

interface DisplayNode {
  id: string;
  label: string;
  value: number;
  color: string;
  change: number | null;
  count: number;
  marketCap: number | null;
  companyName?: string | null;
}

function computeNodes(items: SymbolHeatmapItem[], drill: DrillLevel): DisplayNode[] {
  function aggregate(grp: SymbolHeatmapItem[], id: string, label: string): DisplayNode {
    const totalMC = grp.reduce((s, i) => s + (i.marketCap ?? 0), 0);
    const value = totalMC > 0 ? totalMC : grp.length;
    let wSum = 0, wTotal = 0;
    for (const i of grp) {
      if (i.change != null && (i.marketCap ?? 0) > 0) {
        wSum += i.change * i.marketCap!;
        wTotal += i.marketCap!;
      }
    }
    const avgChange = wTotal > 0 ? wSum / wTotal : null;
    return {
      id, label, value,
      color: changeToColor(avgChange),
      change: avgChange,
      count: grp.length,
      marketCap: totalMC > 0 ? totalMC : null,
    };
  }

  if (drill.level === "sectors") {
    const groups = new Map<string, SymbolHeatmapItem[]>();
    for (const item of items) {
      const g = groups.get(item.sector) ?? [];
      g.push(item);
      groups.set(item.sector, g);
    }
    return Array.from(groups.entries()).map(([s, g]) => aggregate(g, s, s));
  }

  if (drill.level === "subsectors") {
    const filtered = items.filter((i) => i.sector === drill.sector);
    const groups = new Map<string, SymbolHeatmapItem[]>();
    for (const item of filtered) {
      const key = item.subSector ?? "Other";
      const g = groups.get(key) ?? [];
      g.push(item);
      groups.set(key, g);
    }
    return Array.from(groups.entries()).map(([s, g]) => aggregate(g, s, s));
  }

  // symbols level
  const filtered = items.filter(
    (i) => i.sector === drill.sector && (i.subSector ?? "Other") === drill.subSector,
  );
  return filtered.map((i) => ({
    id: i.symbol,
    label: i.symbol,
    value: i.marketCap ?? 1,
    color: changeToColor(i.change),
    change: i.change,
    count: 1,
    marketCap: i.marketCap,
    companyName: i.companyName,
  }));
}

// ── Constants ──────────────────────────────────────────────────────────────────

const HEADER_H = 44;
const SVG_H = 500;
const PAD = 2;

// ── Tooltip type ───────────────────────────────────────────────────────────────

interface TooltipData {
  node: DisplayNode;
  x: number;
  y: number;
}

// ── Main App ───────────────────────────────────────────────────────────────────

function HeatmapApp() {
  const [data, setData] = useState<SectorHeatmapResponse | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [toolInput, setToolInput] = useState<Record<string, unknown>>({});

  const { app, error } = useApp({
    appInfo: { name: "Sector Heatmap", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});

      app.ontoolinput = async (input) => {
        if (input?.arguments) setToolInput(input.arguments as Record<string, unknown>);
      };

      app.ontoolresult = async (result) => {
        const d = extractHeatmapData(result);
        if (d) setData(d);
        else setNeedsAutoFetch(true);
      };

      app.ontoolcancelled = () => {};
      app.onerror = console.error;
      app.onhostcontextchanged = () => {};
    },
  });

  useEffect(() => {
    if (!needsAutoFetch || !app) return;
    setNeedsAutoFetch(false);
    if (typeof app.callServerTool !== "function") return;
    app.callServerTool({ name: "get-sector-heatmap-data", arguments: toolInput })
      .then((result) => {
        const d = extractHeatmapData(result);
        if (d) setData(d);
      })
      .catch(console.error);
  }, [needsAutoFetch, app, toolInput]);

  useHostStyles(app ?? null);

  if (error) {
    return (
      <div style={{ color: "#ef4444", padding: 16, fontFamily: "monospace" }}>
        <strong>ERROR:</strong> {error.message}
      </div>
    );
  }
  if (!app) {
    return <div style={{ color: "#94a3b8", padding: 16 }}>Connecting...</div>;
  }
  return <HeatmapInner app={app} data={data} setData={setData} />;
}

// ── Inner Component ────────────────────────────────────────────────────────────

interface HeatmapInnerProps {
  app: App;
  data: SectorHeatmapResponse | null;
  setData: React.Dispatch<React.SetStateAction<SectorHeatmapResponse | null>>;
}

function HeatmapInner({ app, data, setData }: HeatmapInnerProps) {
  const [drill, setDrill] = useState<DrillLevel>({ level: "sectors" });
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgWidth, setSvgWidth] = useState(800);

  // Read container width once on mount (safe — no ongoing loop/observer)
  useEffect(() => {
    if (containerRef.current) {
      const w = containerRef.current.getBoundingClientRect().width;
      if (w > 10) setSvgWidth(Math.floor(w));
    }
  }, []);

  // Sync date picker from data on first load
  useEffect(() => {
    if (data?.tradeDate && !selectedDate) {
      setSelectedDate(data.tradeDate);
    }
  }, [data?.tradeDate, selectedDate]);

  // Reset drill level when data changes
  useEffect(() => {
    setDrill({ level: "sectors" });
  }, [data]);

  const nodes = useMemo(() => {
    if (!data) return [];
    return computeNodes(data.items, drill);
  }, [data, drill]);

  const rects = useMemo(
    () => squarify(nodes.map((n) => ({ id: n.id, value: n.value })), { x: 0, y: 0, w: svgWidth, h: SVG_H }),
    [nodes, svgWidth],
  );

  const nodeMap = useMemo(() => {
    const m = new Map<string, DisplayNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const breadcrumb = useMemo(() => {
    if (drill.level === "sectors") return "All Sectors";
    if (drill.level === "subsectors") return drill.sector;
    return `${drill.sector} › ${drill.subSector}`;
  }, [drill]);

  const canGoBack = drill.level !== "sectors";

  const handleBack = useCallback(() => {
    setDrill((prev) => {
      if (prev.level === "symbols") return { level: "subsectors", sector: prev.sector };
      return { level: "sectors" };
    });
    setTooltip(null);
  }, []);

  const handleRectClick = useCallback((id: string) => {
    setDrill((prev) => {
      if (prev.level === "sectors") return { level: "subsectors", sector: id };
      if (prev.level === "subsectors") return { level: "symbols", sector: prev.sector, subSector: id };
      return prev;
    });
    setTooltip(null);
  }, []);

  const handleRefresh = useCallback(async (tradeDate?: string) => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const args: Record<string, string> = {};
      if (tradeDate) args.tradeDate = tradeDate;
      const result = await app.callServerTool({ name: "get-sector-heatmap-data", arguments: args });
      const d = extractHeatmapData(result);
      if (d) setData(d);
      else setRefreshError("No data found for this date");
    } catch (e) {
      console.error("Refresh failed:", e);
      setRefreshError("Failed to fetch data");
    } finally {
      setIsRefreshing(false);
    }
  }, [app, setData]);

  const isClickable = drill.level !== "symbols";

  return (
    <div
      style={{
        background: "#0f172a",
        color: "#e2e8f0",
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 13,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: HEADER_H + SVG_H,
        userSelect: "none",
      }}
    >
      {/* Header */}
      <div
        style={{
          height: HEADER_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          borderBottom: "1px solid #1e293b",
          flexShrink: 0,
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {canGoBack && (
            <button
              onClick={handleBack}
              style={{
                background: "#1e293b",
                color: "#94a3b8",
                border: "none",
                borderRadius: 4,
                padding: "4px 10px",
                cursor: "pointer",
                fontSize: 12,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ← Back
            </button>
          )}
          <span style={{ color: "#94a3b8", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {breadcrumb}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {data && (
            <span style={{ color: "#475569", fontSize: 10 }}>
              {data.marketType} · {data.count} stocks
            </span>
          )}
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{
              background: "#1e293b",
              color: "#94a3b8",
              border: "1px solid #334155",
              borderRadius: 4,
              padding: "3px 6px",
              fontSize: 11,
              outline: "none",
              cursor: "pointer",
            }}
          />
          <button
            onClick={() => handleRefresh(selectedDate || undefined)}
            disabled={isRefreshing}
            style={{
              background: "#1e293b",
              color: "#94a3b8",
              border: "none",
              borderRadius: 4,
              padding: "4px 10px",
              cursor: isRefreshing ? "default" : "pointer",
              fontSize: 12,
              opacity: isRefreshing ? 0.5 : 1,
              lineHeight: 1,
            }}
          >
            {isRefreshing ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Treemap area */}
      <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {refreshError && (
          <div
            style={{
              position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)",
              background: "#7f1d1d", color: "#fca5a5", borderRadius: 4,
              padding: "4px 12px", fontSize: 12, zIndex: 20, whiteSpace: "nowrap",
            }}
          >
            {refreshError}
          </div>
        )}
        {!data ? (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#475569", fontSize: 14,
            }}
          >
            Waiting for data…
          </div>
        ) : nodes.length === 0 ? (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#475569", fontSize: 14,
            }}
          >
            No data for this view
          </div>
        ) : (
          <svg
            width={svgWidth}
            height={SVG_H}
            style={{ display: "block" }}
            onMouseLeave={() => setTooltip(null)}
          >
            {rects.map((rect) => {
              const node = nodeMap.get(rect.id);
              if (!node) return null;

              const innerW = rect.w - PAD * 2;
              const innerH = rect.h - PAD * 2;
              const cx = rect.x + rect.w / 2;
              const cy = rect.y + rect.h / 2;

              const showLabel = innerW > 30 && innerH > 14;
              const showChange = innerW > 45 && innerH > 30;

              const rawLabel = node.label;
              const maxChars = Math.max(4, Math.floor(innerW / 7));
              const labelText = rawLabel.length > maxChars ? rawLabel.slice(0, maxChars - 1) + "…" : rawLabel;
              const fontSize = Math.min(12, Math.max(7, Math.floor(innerW / (labelText.length * 0.65 + 1))));

              return (
                <g
                  key={rect.id}
                  onClick={() => isClickable && handleRectClick(rect.id)}
                  onMouseEnter={() => setTooltip({ node, x: rect.x + rect.w / 2, y: rect.y + rect.h })}
                  style={{ cursor: isClickable ? "pointer" : "default" }}
                >
                  <rect
                    x={rect.x + PAD}
                    y={rect.y + PAD}
                    width={Math.max(0, innerW)}
                    height={Math.max(0, innerH)}
                    fill={node.color}
                    rx={2}
                  />
                  {showLabel && (
                    <text
                      x={cx}
                      y={cy - (showChange ? 7 : 0)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="rgba(255,255,255,0.92)"
                      fontSize={fontSize}
                      fontWeight={600}
                      fontFamily="'Inter', system-ui, sans-serif"
                      style={{ pointerEvents: "none" }}
                    >
                      {labelText}
                    </text>
                  )}
                  {showChange && node.change !== null && (
                    <text
                      x={cx}
                      y={cy + 9}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="rgba(255,255,255,0.72)"
                      fontSize={9}
                      fontFamily="'Inter', system-ui, sans-serif"
                      style={{ pointerEvents: "none" }}
                    >
                      {fmtChange(node.change)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Floating tooltip */}
        {tooltip && (
          <div
            style={{
              position: "absolute",
              left: Math.min(tooltip.x + 8, svgWidth - 190),
              top: Math.min(tooltip.y + 4, SVG_H - 110),
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              padding: "8px 12px",
              pointerEvents: "none",
              zIndex: 10,
              minWidth: 160,
              maxWidth: 200,
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontWeight: 700, color: "#f1f5f9", marginBottom: 4, fontSize: 13, wordBreak: "break-word" }}>
              {tooltip.node.companyName ?? tooltip.node.label}
            </div>
            {tooltip.node.companyName && tooltip.node.companyName !== tooltip.node.label && (
              <div style={{ color: "#64748b", fontSize: 11, marginBottom: 2 }}>{tooltip.node.label}</div>
            )}
            <div style={{ color: "#94a3b8", fontSize: 11 }}>
              Change:{" "}
              <span style={{ color: (tooltip.node.change ?? 0) >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                {fmtChange(tooltip.node.change)}
              </span>
            </div>
            {tooltip.node.marketCap != null && (
              <div style={{ color: "#94a3b8", fontSize: 11 }}>
                Mkt Cap: {fmtMarketCap(tooltip.node.marketCap)}
              </div>
            )}
            {tooltip.node.count > 1 && (
              <div style={{ color: "#94a3b8", fontSize: 11 }}>Stocks: {tooltip.node.count}</div>
            )}
            {isClickable && (
              <div style={{ color: "#475569", fontSize: 10, marginTop: 4 }}>Click to drill down</div>
            )}
          </div>
        )}
      </div>

      {/* Color legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: "6px 12px",
          borderTop: "1px solid #1e293b",
          fontSize: 10,
          color: "#475569",
          flexShrink: 0,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#cc2222", display: "inline-block" }} />
          −5%+
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#444", display: "inline-block" }} />
          0%
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#00aa44", display: "inline-block" }} />
          +5%+
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#4a4a4a", display: "inline-block" }} />
          N/A
        </span>
      </div>
    </div>
  );
}

// ── Entry ──────────────────────────────────────────────────────────────────────

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HeatmapApp />
  </StrictMode>,
);
