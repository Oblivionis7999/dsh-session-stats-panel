window.__ModuleLoader__.load({
	id: "dsh-session-stats-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");
		var h = react.createElement;

		//#region styles
		const STYLE_ID = "dsh-session-stats-panel/panel.css";
		const css = `
.ssp-root{
  --ssp-bg:var(--dsw-alias-bg-base,#ffffff);
  --ssp-card:var(--dsw-alias-bg-layer-2,#ffffff);
  --ssp-border:var(--dsw-alias-border-l2,#e8eaed);
  --ssp-border-strong:var(--dsw-alias-border-l3,#e1e5ee);
  --ssp-text:var(--dsw-alias-label-primary,#1f2329);
  --ssp-text-2:var(--dsw-alias-label-secondary,#61666b);
  --ssp-text-3:var(--dsw-alias-label-tertiary,#8a919e);
  --ssp-hover:var(--dsw-alias-interactive-bg-hover,#2631480f);
  --ssp-accent:#12b886;
  --ssp-accent-strong:#0ca678;
  --ssp-accent-soft:rgba(18,184,134,.12);
  --ssp-accent-faint:rgba(18,184,134,.08);
  --ssp-output:#63e6be;
  --ssp-cache-write:#99e9cc;
  --ssp-ok-soft:var(--dsw-alias-state-success-tertiary,#e6faed);
  --ssp-ok-text:#0ca678;
  --ssp-danger:var(--dsw-alias-state-error-primary,#e03131);
  --ssp-danger-soft:var(--dsw-alias-interactive-bg-hover-danger,#ec13130d);
  --ssp-radius:16px;
  box-sizing:border-box;
  height:100%;
  min-height:0;
  width:100%;
  overflow:auto;
  background:var(--ssp-bg);
  color:var(--ssp-text);
  font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Helvetica,Arial,sans-serif);
  font-size:14px;
  line-height:1.55;
  scrollbar-gutter:stable;
}
body[data-ds-dark-theme] .ssp-root{
  --ssp-accent:#20c997;
  --ssp-accent-strong:#0ca678;
  --ssp-accent-soft:rgba(32,201,151,.16);
  --ssp-accent-faint:rgba(32,201,151,.10);
  --ssp-output:#38d9a9;
  --ssp-cache-write:#20c997;
  --ssp-ok-soft:rgba(34,197,94,.14);
  --ssp-ok-text:#4ed17e;
}
.ssp-root *,.ssp-root *::before,.ssp-root *::after{box-sizing:border-box}
.ssp-page{max-width:1120px;margin:0 auto;padding:28px clamp(20px,3.4vw,44px) 56px}
[data-platform=darwin] .ssp-page{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.ssp-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:22px}
.ssp-title{margin:0;font-size:22px;font-weight:600;line-height:30px;letter-spacing:-.01em}
.ssp-controls{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.ssp-tabs{display:inline-flex;align-items:center;gap:2px}
.ssp-tab{height:28px;padding:0 10px;border:0;border-radius:14px;background:transparent;color:var(--ssp-text-3);font:inherit;font-size:13px;line-height:20px;cursor:pointer;white-space:nowrap;transition:background-color .12s,color .12s}
.ssp-tab:hover{color:var(--ssp-text);background:var(--ssp-hover)}
.ssp-tab[aria-selected=true]{background:var(--ssp-hover);color:var(--ssp-text);font-weight:500}
.ssp-tab:focus-visible,.ssp-cur:focus-visible,.ssp-retry:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--ssp-accent));outline-offset:1px}
.ssp-currency{display:inline-flex;align-items:center;gap:2px}
.ssp-cur{height:28px;padding:0 8px;border:0;border-radius:14px;background:transparent;color:var(--ssp-text-3);font:inherit;font-size:13px;line-height:20px;cursor:pointer;transition:background-color .12s,color .12s}
.ssp-cur:hover{color:var(--ssp-text);background:var(--ssp-hover)}
.ssp-cur[aria-checked=true]{color:var(--ssp-text);font-weight:500}
.ssp-cur-sep{display:inline-block;width:1px;height:12px;background:var(--ssp-border-strong);flex:none}
.ssp-error{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:9px 12px;border:1px solid var(--ssp-border);border-radius:12px;background:var(--ssp-danger-soft);color:var(--ssp-danger);font-size:12px;line-height:18px}
.ssp-error-text{flex:1;min-width:0;overflow-wrap:anywhere}
.ssp-retry{flex:none;height:24px;padding:0 10px;border:1px solid currentColor;border-radius:12px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.ssp-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.ssp-card{background:var(--ssp-card);border:1px solid var(--ssp-border);border-radius:var(--ssp-radius);padding:18px 20px 16px;min-width:0}
.ssp-stat{display:flex;flex-direction:column}
.ssp-stat-head{display:flex;align-items:center;gap:8px;min-width:0}
.ssp-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:26px;height:26px;border-radius:8px;background:var(--ssp-accent-soft);color:var(--ssp-accent-strong)}
.ssp-stat-title{font-size:13px;font-weight:500;color:var(--ssp-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssp-value{display:flex;align-items:baseline;gap:5px;min-width:0;margin-top:12px}
.ssp-value-num{font-size:30px;font-weight:600;line-height:34px;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}
.ssp-value-unit{font-size:13px;color:var(--ssp-text-3);white-space:nowrap}
.ssp-sub{margin-top:6px;font-size:12px;line-height:18px;color:var(--ssp-text-3);white-space:normal;overflow-wrap:anywhere}
.ssp-live{margin-top:14px;padding:18px 22px 16px}
.ssp-live-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ssp-live-title{display:flex;align-items:center;gap:10px;min-width:0}
.ssp-live-name{font-size:15px;font-weight:600;line-height:22px;white-space:nowrap}
.ssp-pill{display:inline-flex;align-items:center;gap:6px;height:20px;padding:0 8px;border-radius:999px;background:var(--ssp-ok-soft);color:var(--ssp-ok-text);font-size:11px;font-weight:500;line-height:1;white-space:nowrap}
.ssp-pill-dot{width:5px;height:5px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px var(--ssp-accent-faint)}
.ssp-live-meta{font-size:12px;line-height:18px;color:var(--ssp-text-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.ssp-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;margin:18px 0 16px}
.ssp-metric{min-width:0}
.ssp-metric-label{font-size:12px;line-height:18px;color:var(--ssp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssp-metric-value{display:flex;align-items:baseline;gap:4px;margin-top:4px;font-size:24px;font-weight:600;line-height:30px;letter-spacing:-.01em;font-variant-numeric:tabular-nums;white-space:nowrap}
.ssp-metric-unit{font-size:12px;font-weight:400;color:var(--ssp-text-3)}
.ssp-metric-sub{margin-top:4px;font-size:12px;line-height:18px;color:var(--ssp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssp-chart-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px;font-size:12px;line-height:18px;color:var(--ssp-text-3)}
.ssp-spark{display:block;width:100%;height:56px}
.ssp-spark-line{fill:none;stroke:var(--ssp-accent);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.ssp-spark-area{stroke:none;fill:url(#ssp-spark-fill)}
.ssp-spark-stop-start{stop-color:var(--ssp-accent);stop-opacity:.22}
.ssp-spark-stop-end{stop-color:var(--ssp-accent);stop-opacity:0}
.ssp-spark-empty{stroke:var(--ssp-border-strong);stroke-width:1;stroke-dasharray:3 4}
.ssp-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);gap:14px;margin-top:14px}
@media (max-width:1100px){.ssp-row{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.ssp-row>.ssp-cost-donut{grid-column:1/-1}}
@media (max-width:720px){.ssp-row{grid-template-columns:minmax(0,1fr)}}
.ssp-cost-legend-vendor{color:var(--ssp-text-3);font-size:11px}
.ssp-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.ssp-card-title{font-size:15px;font-weight:600;line-height:22px}
.ssp-card-sub{margin-top:2px;font-size:12px;line-height:18px;color:var(--ssp-text-3)}
.ssp-card-aside{flex:none;text-align:right}
.ssp-aside-main{font-size:15px;font-weight:600;line-height:22px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ssp-aside-sub{margin-top:2px;font-size:12px;line-height:18px;color:var(--ssp-text-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.ssp-bars{display:flex;align-items:flex-end;gap:10px;height:176px}
.ssp-bar-col{display:flex;align-items:flex-end;justify-content:center;flex:1;min-width:0;height:100%}
.ssp-bar{display:flex;flex-direction:column-reverse;width:100%;max-width:38px;border-radius:6px 6px 2px 2px;overflow:hidden;min-height:2px;transition:opacity .12s}
.ssp-bar:hover{opacity:.85}
.ssp-bar-empty{background:var(--ssp-border);height:2px;min-height:2px}
.ssp-bar-seg{width:100%;flex:none}
.ssp-bars[data-dense=true]{gap:4px}
.ssp-axis{display:flex;gap:10px;margin-top:8px}
.ssp-axis[data-dense=true]{gap:4px}
.ssp-axis-label{flex:1;min-width:0;text-align:center;font-size:11px;line-height:16px;color:var(--ssp-text-3);white-space:nowrap;overflow:hidden}
.ssp-bar-legend{margin-top:10px;justify-content:flex-start;gap:4px 12px}
.ssp-donut-wrap{display:flex;flex-direction:column;align-items:center;gap:12px;padding:14px 0 4px}
.ssp-donut{position:relative;width:168px;height:168px;flex:none}
.ssp-donut svg{display:block;width:100%;height:100%}
.ssp-donut-track{fill:none;stroke:var(--ssp-border);stroke-width:18}
.ssp-donut-seg{fill:none;stroke-width:18;transition:opacity .12s}
.ssp-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none}
.ssp-donut-value{font-size:21px;font-weight:600;line-height:26px;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.ssp-donut-unit{font-size:11px;line-height:14px;color:var(--ssp-text-3)}
.ssp-donut-cost{margin-top:2px;font-size:11px;line-height:14px;color:var(--ssp-text-3);font-variant-numeric:tabular-nums}
.ssp-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 16px;font-size:12px;line-height:18px;color:var(--ssp-text-2)}
.ssp-legend-item{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.ssp-legend-dot{width:7px;height:7px;border-radius:2px;flex:none}
.ssp-legend-value{color:var(--ssp-text-3);font-variant-numeric:tabular-nums}
.ssp-model-legend{display:flex;flex-direction:column;gap:5px;width:100%;margin-top:2px;font-size:12px;line-height:18px;color:var(--ssp-text-2)}
.ssp-model-legend-row{display:flex;align-items:center;gap:7px;min-width:0}
.ssp-model-legend-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssp-model-legend-share{flex:none;min-width:40px;text-align:right;color:var(--ssp-text-3);font-variant-numeric:tabular-nums}
.ssp-model-legend-tokens{flex:none;min-width:52px;text-align:right;color:var(--ssp-text-3);font-variant-numeric:tabular-nums}
.ssp-model-legend-cost{flex:none;min-width:52px;text-align:right;color:var(--ssp-text-3);font-size:11px;font-variant-numeric:tabular-nums}
.ssp-models{margin-top:14px}
.ssp-model-table{display:flex;flex-direction:column;gap:2px;margin-top:14px}
.ssp-model-row{display:grid;grid-template-columns:minmax(140px,1.5fr) minmax(90px,2.2fr) 86px 52px 82px;align-items:center;gap:12px;padding:7px 2px;border-bottom:.5px solid var(--ssp-border);font-size:12px;line-height:18px;color:var(--ssp-text-2)}
.ssp-model-row:last-child{border-bottom:0}
.ssp-model-head{border-bottom:.5px solid var(--ssp-border);color:var(--ssp-text-3);font-size:11px;line-height:16px;padding-top:0;padding-bottom:5px}
.ssp-model-identity{display:flex;align-items:center;gap:8px;min-width:0}
.ssp-model-dot{width:8px;height:8px;border-radius:2px;flex:none}
.ssp-model-name{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ssp-text)}
.ssp-model-provider{flex:none;font-size:11px;color:var(--ssp-text-3)}
.ssp-model-tag{flex:none;padding:0 5px;border-radius:6px;background:var(--ssp-hover);color:var(--ssp-text-3);font-size:10px;line-height:16px;white-space:nowrap}
.ssp-model-bar{height:6px;border-radius:3px;background:var(--ssp-border);overflow:hidden;min-width:0}
.ssp-model-bar-fill{height:100%;border-radius:3px;min-width:2px}
.ssp-model-tokens{text-align:right;color:var(--ssp-text);font-variant-numeric:tabular-nums}
.ssp-model-share{text-align:right;color:var(--ssp-text-3);font-variant-numeric:tabular-nums}
.ssp-model-cost{text-align:right;color:var(--ssp-text);font-variant-numeric:tabular-nums}
.ssp-sub-note{margin-top:2px;font-size:11px;line-height:16px;color:var(--ssp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssp-model-foot{margin-top:10px;font-size:11px;line-height:16px;color:var(--ssp-text-3)}
body[data-ds-dark-theme] .ssp-bar-seg,
body[data-ds-dark-theme] .ssp-donut-seg,
body[data-ds-dark-theme] .ssp-legend-dot,
body[data-ds-dark-theme] .ssp-model-dot,
body[data-ds-dark-theme] .ssp-model-bar-fill{filter:brightness(1.12) saturate(1.04)}
.ssp-root[data-loading=true] .ssp-cards,.ssp-root[data-loading=true] .ssp-row{opacity:.72;transition:opacity .15s}
/* ---- today stripe (calendar-day comparison) ---- */
.ssp-today{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:14px;padding:14px 20px}
.ssp-today-cell{min-width:0}
.ssp-today-label{font-size:11px;line-height:16px;color:var(--ssp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssp-today-value{display:flex;align-items:baseline;gap:8px;margin-top:3px;font-size:16px;font-weight:600;line-height:22px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ssp-today-delta{font-size:11px;font-weight:500;line-height:16px;font-variant-numeric:tabular-nums}
.ssp-today-up{color:var(--ssp-danger)}
.ssp-today-down{color:var(--ssp-ok-text)}
.ssp-today-flat{color:var(--ssp-text-3)}
.ssp-today-empty{font-size:12px;line-height:18px;color:var(--ssp-text-3);grid-column:1/-1}
.ssp-hint{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:7px 12px;border:1px solid var(--ssp-border);border-radius:10px;background:var(--ssp-hover);color:var(--ssp-text-3);font-size:11px;line-height:16px}
.ssp-hint::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:#f2c14e}
/* ---- forecast tail beside the daily bars ---- */
.ssp-chart-wrap{display:flex;align-items:flex-start;gap:12px;margin-top:18px}
.ssp-bars-wrap{flex:1;min-width:0}
.ssp-forecast{flex:0 0 88px;display:flex;flex-direction:column;height:176px;padding-left:12px;border-left:1px dashed var(--ssp-border-strong)}
.ssp-forecast svg{display:block;width:100%;flex:1;min-height:0;overflow:visible}
.ssp-forecast-line{fill:none;stroke:var(--ssp-text-3);stroke-width:1.2;stroke-dasharray:4 4;vector-effect:non-scaling-stroke}
.ssp-forecast-text{margin-top:8px;font-size:10px;line-height:14px;color:var(--ssp-text-3);font-variant-numeric:tabular-nums;white-space:normal}
/* ---- chunked loading: still-alive cues ---- */.ssp-progress{position:sticky;top:0;height:2px;background:var(--ssp-border);overflow:hidden;z-index:20}
.ssp-progress-fill{height:100%;width:38%;background:linear-gradient(90deg,transparent,var(--ssp-accent),var(--ssp-accent-strong),transparent);animation:ssp-progress-slide 1.1s ease-in-out infinite}
@keyframes ssp-progress-slide{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}
.ssp-analyzing{display:inline-flex;align-items:center;gap:4px;font-size:12px;line-height:18px;color:var(--ssp-text-3)}
.ssp-dot{width:4px;height:4px;border-radius:50%;background:currentColor;animation:ssp-dot-blink 1.1s ease-in-out infinite}
.ssp-dot:nth-of-type(2){animation-delay:.15s}
.ssp-dot:nth-of-type(3){animation-delay:.3s}
@keyframes ssp-dot-blink{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-1px)}}
.ssp-quiet{display:flex;align-items:center;justify-content:center;min-height:96px;font-size:12px;line-height:18px;color:var(--ssp-text-3);text-align:center}
/* ---- segmented control (heatmap mode, session sort) ---- */
.ssp-seg{display:inline-flex;align-items:center;gap:1px;padding:2px;border:1px solid var(--ssp-border);border-radius:999px;background:var(--ssp-hover);flex:none}
.ssp-seg-btn{border:0;background:transparent;color:var(--ssp-text-3);font:inherit;font-size:11px;line-height:16px;padding:2px 9px;border-radius:999px;cursor:pointer;white-space:nowrap}
.ssp-seg-btn.ssp-seg-active{background:var(--ssp-card);color:var(--ssp-text);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.ssp-seg-btn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--ssp-accent));outline-offset:1px}
/* ---- heatmap calendar (8 columns x 7 rows) ---- */
.ssp-heat{margin-top:14px}
.ssp-heat-grid{display:flex;gap:3px;margin-top:16px;overflow-x:auto;padding-bottom:2px}
.ssp-heat-col{display:flex;flex-direction:column;gap:3px;flex:none}
.ssp-heat-cell{display:block;width:16px;height:16px;border-radius:3px;background:var(--ssp-accent);opacity:.06}
.ssp-heat-l1{opacity:.22}
.ssp-heat-l2{opacity:.44}
.ssp-heat-l3{opacity:.7}
.ssp-heat-l4{opacity:1}
.ssp-heat-cell:hover{outline:1px solid var(--ssp-accent-strong);outline-offset:1px}
.ssp-heat-legend{display:flex;align-items:center;gap:4px;margin-top:10px;font-size:11px;line-height:16px;color:var(--ssp-text-3)}
.ssp-heat-swatch{width:10px;height:10px}
/* ---- leaderboards ---- */
.ssp-rank-list{display:flex;flex-direction:column;gap:7px;margin-top:16px}
.ssp-rank-row{display:grid;grid-template-columns:minmax(64px,108px) minmax(0,1fr) 46px;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--ssp-text-2)}
.ssp-rank-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ssp-text)}
.ssp-rank-bar{display:block;height:8px;border-radius:4px;background:var(--ssp-hover);overflow:hidden}
.ssp-rank-fill{display:block;height:100%;min-width:2px;border-radius:4px;background:var(--ssp-accent)}
.ssp-rank-count{text-align:right;color:var(--ssp-text-3);font-variant-numeric:tabular-nums}
/* ---- tool leaderboard: success-rate badge + average duration ---- */
.ssp-rank-row-rich{grid-template-columns:minmax(96px,140px) minmax(0,1fr) 52px 56px 48px}
.ssp-rank-ms{text-align:right;color:var(--ssp-text-3);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ssp-rate{display:inline-flex;align-items:center;justify-content:center;justify-self:end;height:16px;padding:0 5px;border-radius:5px;font-size:10px;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap}
.ssp-rate-ok{background:var(--ssp-ok-soft);color:var(--ssp-ok-text)}
.ssp-rate-warn{background:rgba(242,193,78,.18);color:#b8860b}
.ssp-rate-bad{background:var(--ssp-danger-soft);color:var(--ssp-danger)}
.ssp-rate-unknown{background:transparent;color:var(--ssp-text-3)}
body[data-ds-dark-theme] .ssp-rate-warn{background:rgba(242,193,78,.2);color:#f2c14e}
/* ---- session list ---- */
.ssp-sessions{margin-top:14px}
.ssp-list-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}
.ssp-search{flex:1 1 160px;min-width:140px;height:28px;padding:0 11px;border:1px solid var(--ssp-border);border-radius:14px;background:var(--ssp-bg);color:var(--ssp-text);font:inherit;font-size:12px;line-height:20px;outline:none}
.ssp-search::placeholder{color:var(--ssp-text-3)}
.ssp-search:focus{border-color:var(--ssp-accent)}
.ssp-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--ssp-text-2);cursor:pointer;white-space:nowrap}
.ssp-check input{accent-color:var(--ssp-accent);margin:0}
.ssp-sess-list{display:flex;flex-direction:column;margin-top:12px;max-height:420px;overflow-y:auto}
.ssp-sess-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;padding:9px 2px;border-bottom:.5px solid var(--ssp-border)}
.ssp-sess-row:last-child{border-bottom:0}
.ssp-sess-row[data-archived=true]{opacity:.55}
.ssp-sess-head{display:flex;align-items:baseline;gap:8px;min-width:0}
.ssp-sess-title{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;line-height:18px;font-weight:500;color:var(--ssp-text)}
.ssp-sess-tag{flex:none;padding:0 5px;border-radius:6px;background:var(--ssp-hover);color:var(--ssp-text-3);font-size:10px;line-height:16px;white-space:nowrap}
.ssp-sess-prompt{margin-top:3px;font-size:11px;line-height:16px;color:var(--ssp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssp-sess-side{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.ssp-sess-cost{font-size:12px;line-height:18px;color:var(--ssp-text)}
.ssp-sess-time{font-size:10px;line-height:16px;color:var(--ssp-text-3)}
.ssp-sess-foot{grid-column:1/-1;display:flex;gap:10px;flex-wrap:wrap;font-size:10px;line-height:16px;color:var(--ssp-text-3);font-variant-numeric:tabular-nums}
@media (max-width:900px){
  .ssp-cards{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ssp-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:720px){
  .ssp-model-row{grid-template-columns:minmax(0,1fr) 78px 52px;gap:8px}
  .ssp-model-bar,.ssp-model-cost{display:none}
}
@media (max-width:560px){
  .ssp-cards{grid-template-columns:minmax(0,1fr)}
  .ssp-today{padding:12px 14px}
  .ssp-sess-row{grid-template-columns:minmax(0,1fr)}
  .ssp-sess-side{text-align:left;margin-top:4px}
  .ssp-rate{padding:0 4px}
  .ssp-heat-cell{width:14px;height:14px}
}
@media (max-width:1100px){
  .ssp-today{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ssp-rank-row{grid-template-columns:minmax(56px,86px) minmax(0,1fr) 42px}
  .ssp-rank-row-rich{grid-template-columns:minmax(72px,112px) minmax(0,1fr) 52px 56px 44px}
  .ssp-forecast{flex-basis:72px}
}
@media (max-width:720px){
  .ssp-today{grid-template-columns:minmax(0,1fr);padding:12px 16px}
  .ssp-chart-wrap{flex-direction:column;gap:10px}
  .ssp-forecast{flex:1 1 auto;width:100%;height:72px;border-left:0;border-top:1px dashed var(--ssp-border-strong);padding-left:0;padding-top:8px}
  .ssp-list-tools{flex-direction:column;align-items:stretch}
  .ssp-rank-row{grid-template-columns:minmax(0,1fr) 40px}
  .ssp-rank-row-rich{grid-template-columns:minmax(0,1fr) 52px 40px}
  .ssp-rank-ms{display:none}
  .ssp-rank-bar{display:none}
}
@media (prefers-reduced-motion:reduce){
  .ssp-tab,.ssp-cur,.ssp-bar,.ssp-donut-seg{transition:none}
  .ssp-root,.ssp-progress-fill,.ssp-dot{animation:none}
}
/* ---- entrance motion ---- */
@keyframes ssp-mode-in{0%{opacity:0;transform:translateY(6px) scale(.995)}100%{opacity:1;transform:none}}
.ssp-root{animation:ssp-mode-in .26s cubic-bezier(.22,.61,.36,1)}

`;
		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_ID) + "]") === null
		) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-session-stats-panel";
			tag.dataset.pluginCss = STYLE_ID;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region locale
		// Locale namespace for this plugin's own dictionary.
		const NS = "session-stats";
		// Slot key/id handed to the host. Must not collide with an official or
		// third-party panel id, so it mirrors the loader id instead of the
		// shorter HTTP namespace above.
		const PANEL_ID = "session-stats-panel";
		const WINDOW_KEYS = ["24h", "7d", "14d", "30d"];
		const zh = {
			"panel": "肥鱼用量分析",
			"window.aria": "统计时间范围",
			"window.24h": "近 24 小时",
			"window.7d": "近 7 天",
			"window.14d": "近 14 天",
			"window.30d": "近 30 天",
			"currency.aria": "显示币种",
			"currency.cny": "CNY",
			"currency.usd": "USD",
			"cards.aria": "核心指标",
			"card.tokens": "总 Token 消耗",
			"card.tokens.sub": "输入 {input} · 输出 {output}",
			"card.cost": "预估成本",
			"card.cost.sub": "各厂商官方价目 · DeepSeek 峰谷分时",
			"card.cost.search": "含官方搜索 {count} 次 {cost}",
			"card.cost.note": "未列价模型按 Flash 档估算（{count} 个）",
			"card.cost.noteTitle": "未匹配到原厂官方价目的模型按 DeepSeek 官方 Flash 档估算，仅本地参考",
			"vendor.deepseek": "DeepSeek",
			"vendor.zhipu": "智谱",
			"vendor.moonshot": "月之暗面",
			"vendor.alibaba": "阿里云",
			"vendor.minimax": "MiniMax",
			"vendor.tencent": "腾讯混元",
			"vendor.stepfun": "阶跃星辰",
			"vendor.xiaomi": "小米",
			"vendor.meituan": "美团",
			"vendor.xai": "xAI",
			"vendor.openai": "OpenAI",
			"vendor.anthropic": "Anthropic",
			"vendor.google": "Google",
			"vendor.meta": "Meta",
			"vendor.reflection": "Reflection",
			"vendor.iceman": "Iceman",
			"vendor.unknown": "未知厂商",
			"priceLevel.official": "{vendor}官方价目",
			"priceLevel.unpriced": "无官方定价",
			"price.currency.CNY": "元/百万 token",
			"price.currency.USD": "美元/百万 token",
			"price.sourceTitle": "价格来源：{level} · {currency}",
			"price.unpricedTitle": "无官方定价，未计入金额",
			"models.tag.unpriced": "未计价",
			"models.unpriced": "未计价",
			"models.unpricedNote": "{count} 个模型无官方定价，未计入金额（tokens {tokens}）",
			"models.search": "官方搜索",
			"models.searchTokens": "—",
			"models.searchShare": "按次",
			"models.searchTitle": "¥5 / 1000 次成功请求；搜索调用自身 token 未计入（日志无 usage）",
			"card.sessions": "会话数",
			"card.sessions.sub": "平均每会话 {avg} tokens",
			"card.cache": "缓存命中率",
			"card.cache.sub": "缓存读取 {cacheRead}",
			"unit.tokens": "tokens",
			"unit.core": "单核",
			"unit.coresEq": "核",
			"live.cpu.hint": "进程累计 CPU 时间 ÷ 墙钟时间；多线程时可超过 100%，即占用超过 1 个 CPU 核",
			"unit.mb": "MB",
			"unit.ms": "ms",
			"live.title": "DSH 运行状态",
			"live.badge": "实时 · 5 秒采样",
			"live.meta": "{cores} 核",
			"live.meta.hint": "宿主进程的可用逻辑核数",
			"live.cpu": "CPU（进程）",
			"live.cpu.sub": "整机 {machine}% · {cores} 核",
			"live.mem": "内存（RSS）",
			"live.mem.sub": "堆已用 {heap} MB",
			"live.loop": "事件循环 p99",
			"live.loop.sub": "平均 {mean} ms",
			"live.uptime": "运行时长",
			"live.uptime.sub": "PID {pid} · Node {node}",
			"live.chart": "最近 5 分钟 CPU",
			"live.chart.peak": "峰值 {peak}%",
			"daily.title": "每日消耗",
			"daily.sub": "按 token 堆叠 · {range}",
			"donut.title": "Token 构成",
			"costDonut.title": "成本构成",
			"costDonut.sub": "按模型 · 含官方搜索",
			"donut.sub": "按模型",
			"chart.other": "其他",
			"models.title": "分模型明细",
			"models.sub": "按 token 降序",
			"models.colModel": "模型",
			"models.colTokens": "tokens",
			"models.colShare": "占比",
			"models.colCost": "成本",
			"models.share": "占比",
			"composition.cacheRead": "缓存读取",
			"composition.input": "未缓存输入",
			"composition.output": "输出",
			"composition.cacheWrite": "缓存写入",
			"state.error": "统计数据加载失败：{message}",
			"state.retry": "重试",
			"state.placeholder": "—",
			"state.analyzing": "分析中",
			"state.loading": "加载中",
			"state.emptyChunk": "数据暂不可用",
			"state.heavyStale": "慢数据刷新失败：{message} · 卡片显示的是上一次结果",
			"today.title": "今日概览",
			"today.sub": "按自然日 · 对比昨日",
			"today.delta": "{arrow} {value}",
			"forecast.caption": "虚线为成本走势预测",
			"forecast.end": "月末 {cost}/天 ±{sigma}",
			"forecast.title": "成本预测",
			"heatmap.title": "热力日历",
			"heatmap.sub": "最近 8 周 · 每天的活动强度",
			"heatmap.aria": "热力日历指标",
			"heatmap.mode.tokens": "Tokens",
			"heatmap.mode.sessions": "会话",
			"heatmap.less": "少",
			"heatmap.more": "多",
			"heatmap.cell": "{date} · {tokens} tokens · {sessions} 个会话 · {turns} turns",
			"heatmap.empty": "暂无活动数据",
			"rank.tools": "工具排行",
			"rank.sub.tools": "按调用次数 · Top 10",
			"rank.commands": "命令排行",
			"rank.sub.commands": "Shell 程序口径 · Top 10",
			"rank.skills": "技能排行",
			"rank.sub.skills": "技能调用 · Top 10",
			"rank.empty": "暂无数据",
			"rank.ratePart": "成功率 {value}",
			"rank.avgPart": "平均 {value}",
			"rank.errorPart": "失败 {count} 次",
			"sessions.title": "会话列表",
			"sessions.sub": "最近活动 · 显示 {shown} / {total}",
			"sessions.search": "搜索标题或最后一条 prompt",
			"sessions.sortAria": "排序方式",
			"sessions.sort.recent": "最近活动",
			"sessions.sort.tokens": "Tokens",
			"sessions.sort.cost": "成本",
			"sessions.withSubagents": "包含子会话",
			"sessions.empty": "没有匹配的会话",
			"sessions.untitled": "未命名会话",
			"sessions.subagentTag": "子会话",
			"sessions.archivedTag": "已归档",
			"sessions.turns": "{count} turns",
			"sessions.steps": "{count} steps",
			"time.justNow": "刚刚",
			"time.minutes": "{count} 分钟前",
			"time.hours": "{count} 小时前",
			"time.days": "{count} 天前",
		};
		const en = {
			"panel": "Fat Fish Usage",
			"window.aria": "Statistics time range",
			"window.24h": "Last 24 hours",
			"window.7d": "Last 7 days",
			"window.14d": "Last 14 days",
			"window.30d": "Last 30 days",
			"currency.aria": "Display currency",
			"currency.cny": "CNY",
			"currency.usd": "USD",
			"cards.aria": "Key metrics",
			"card.tokens": "Total tokens",
			"card.tokens.sub": "Input {input} · Output {output}",
			"card.cost": "Estimated cost",
			"card.cost.sub": "Vendor official lists · DeepSeek peak / off-peak",
			"card.cost.search": "incl. {count} official search(es) {cost}",
			"card.cost.note": "{count} unlisted model(s) priced as Flash",
			"card.cost.noteTitle": "Models with no verified vendor list price are estimated at the DeepSeek official Flash tier; local estimate only",
			"vendor.deepseek": "DeepSeek",
			"vendor.zhipu": "Zhipu",
			"vendor.moonshot": "Moonshot",
			"vendor.alibaba": "Alibaba Cloud",
			"vendor.minimax": "MiniMax",
			"vendor.tencent": "Tencent Hunyuan",
			"vendor.stepfun": "StepFun",
			"vendor.xiaomi": "Xiaomi",
			"vendor.meituan": "Meituan",
			"vendor.xai": "xAI",
			"vendor.openai": "OpenAI",
			"vendor.anthropic": "Anthropic",
			"vendor.google": "Google",
			"vendor.meta": "Meta",
			"vendor.reflection": "Reflection",
			"vendor.iceman": "Iceman",
			"vendor.unknown": "Unknown vendor",
			"priceLevel.official": "{vendor} official list",
			"priceLevel.unpriced": "No official price",
			"price.currency.CNY": "CNY / 1M tokens",
			"price.currency.USD": "USD / 1M tokens",
			"price.sourceTitle": "Price source: {level} · {currency}",
			"price.unpricedTitle": "No official price; excluded from the amount",
			"models.tag.unpriced": "Unpriced",
			"models.unpriced": "Unpriced",
			"models.unpricedNote": "{count} model(s) have no official price and are excluded from the amount (tokens {tokens})",
			"models.search": "Official search",
			"models.searchTokens": "—",
			"models.searchShare": "per request",
			"models.searchTitle": "¥5 per 1,000 successful requests; the search call's own tokens are not counted (no usage in the log)",
			"card.sessions": "Sessions",
			"card.sessions.sub": "{avg} tokens per session on average",
			"card.cache": "Cache hit rate",
			"card.cache.sub": "Cache read {cacheRead}",
			"unit.tokens": "tokens",
			"unit.core": "per core",
			"unit.coresEq": "cores",
			"live.cpu.hint": "Process CPU time ÷ wall time; may exceed 100% when several threads are busy (i.e. more than one core)",
			"unit.mb": "MB",
			"unit.ms": "ms",
			"live.title": "DSH runtime",
			"live.badge": "Live · 5s sampling",
			"live.meta": "{cores} cores",
			"live.meta.hint": "Logical cores available to the host process",
			"live.cpu": "CPU (process)",
			"live.cpu.sub": "Machine {machine}% · {cores} cores",
			"live.mem": "Memory (RSS)",
			"live.mem.sub": "Heap used {heap} MB",
			"live.loop": "Event loop p99",
			"live.loop.sub": "Mean {mean} ms",
			"live.uptime": "Uptime",
			"live.uptime.sub": "PID {pid} · Node {node}",
			"live.chart": "CPU, last 5 minutes",
			"live.chart.peak": "Peak {peak}%",
			"daily.title": "Daily consumption",
			"daily.sub": "Stacked by token kind · {range}",
			"donut.title": "Token composition",
			"costDonut.title": "Cost breakdown",
			"costDonut.sub": "By model · incl. official search",
			"donut.sub": "By model",
			"chart.other": "Other",
			"models.title": "Models",
			"models.sub": "Sorted by tokens",
			"models.colModel": "Model",
			"models.colTokens": "Tokens",
			"models.colShare": "Share",
			"models.colCost": "Cost",
			"models.share": "Share",
			"composition.cacheRead": "Cache read",
			"composition.input": "Uncached input",
			"composition.output": "Output",
			"composition.cacheWrite": "Cache write",
			"state.error": "Failed to load statistics: {message}",
			"state.retry": "Retry",
			"state.placeholder": "—",
			"state.analyzing": "Analyzing",
			"state.loading": "Loading",
			"state.emptyChunk": "Data unavailable",
			"state.heavyStale": "Slow data refresh failed: {message} · cards still show the previous result",
			"today.title": "Today",
			"today.sub": "Calendar day · vs yesterday",
			"today.delta": "{arrow} {value}",
			"forecast.caption": "Dashed line: cost trend forecast",
			"forecast.end": "Month end {cost}/day ±{sigma}",
			"forecast.title": "Cost forecast",
			"heatmap.title": "Activity calendar",
			"heatmap.sub": "Last 8 weeks · daily activity",
			"heatmap.aria": "Calendar metric",
			"heatmap.mode.tokens": "Tokens",
			"heatmap.mode.sessions": "Sessions",
			"heatmap.less": "Less",
			"heatmap.more": "More",
			"heatmap.cell": "{date} · {tokens} tokens · {sessions} sessions · {turns} turns",
			"heatmap.empty": "No activity yet",
			"rank.tools": "Tool leaderboard",
			"rank.sub.tools": "By calls · Top 10",
			"rank.commands": "Command leaderboard",
			"rank.sub.commands": "Shell programs · Top 10",
			"rank.skills": "Skill leaderboard",
			"rank.sub.skills": "Skill calls · Top 10",
			"rank.empty": "No data yet",
			"rank.ratePart": "Success {value}",
			"rank.avgPart": "Avg {value}",
			"rank.errorPart": "{count} errors",
			"sessions.title": "Sessions",
			"sessions.sub": "Most recent · {shown} of {total}",
			"sessions.search": "Search title or last prompt",
			"sessions.sortAria": "Sort by",
			"sessions.sort.recent": "Recent",
			"sessions.sort.tokens": "Tokens",
			"sessions.sort.cost": "Cost",
			"sessions.withSubagents": "Include subagent sessions",
			"sessions.empty": "No matching sessions",
			"sessions.untitled": "Untitled session",
			"sessions.subagentTag": "Sub",
			"sessions.archivedTag": "Archived",
			"sessions.turns": "{count} turns",
			"sessions.steps": "{count} steps",
			"time.justNow": "just now",
			"time.minutes": "{count}m ago",
			"time.hours": "{count}h ago",
			"time.days": "{count}d ago",
		};
		//#endregion

		//#region formatting
		/** Trim a fixed-point number to its shortest form. */
		function trimFixed(value, digits) {
			return String(Number(Number(value).toFixed(digits)));
		}
		/** Compact token count: 764.9M, 3.38M, 22. */
		function formatTokens(value) {
			const number = Number(value);
			if (!Number.isFinite(number) || number <= 0) return "0";
			if (number >= 1e9) return trimFixed(number / 1e9, number / 1e9 >= 10 ? 1 : 2) + "B";
			if (number >= 1e6) return trimFixed(number / 1e6, number / 1e6 >= 10 ? 1 : 2) + "M";
			if (number >= 1e3) return trimFixed(number / 1e3, number / 1e3 >= 100 ? 0 : 1) + "K";
			return String(Math.round(number));
		}
		/** Money with a currency symbol: ¥47.48. */
		function formatMoney(value) {
			const number = Number(value);
			if (!Number.isFinite(number)) return "0.00";
			if (number >= 10000) return trimFixed(number, 0);
			if (number >= 100) return trimFixed(number, 1);
			return Number(number).toFixed(2);
		}
		/** Percentage from a 0..1 ratio: 99.6%. */
		function formatPercent(ratio) {
			const number = Number(ratio);
			if (!Number.isFinite(number) || number <= 0) return "0.0%";
			return `${(number * 100).toFixed(1)}%`;
		}
		/** One-decimal number, trailing zero kept: 0.0, 121.2. */
		function formatOneDecimal(value) {
			const number = Number(value);
			return Number.isFinite(number) ? number.toFixed(1) : "0.0";
		}
		/** Two-decimal number: 0.00, 0.12. */
		function formatTwoDecimals(value) {
			const number = Number(value);
			return Number.isFinite(number) ? number.toFixed(2) : "0.00";
		}
		/** Rounded megabytes. */
		function formatMegabytes(value) {
			const number = Number(value);
			return Number.isFinite(number) ? String(Math.round(number)) : "0";
		}
		/**
		 * Relative time for the session list: 刚刚 / 5 分钟前 / 3 小时前 / 2 天前 / 10/28.
		 * A future or unknown timestamp degrades to the placeholder instead of a
		 * negative duration.
		 * @param {Function} t - translator.
		 * @param {number} nowMs - reference instant (the heavy payload's generatedAt).
		 * @param {number} thenMs - target instant.
		 * @returns {string} localized relative label.
		 */
		function formatRelative(t, nowMs, thenMs) {
			const then = Number(thenMs);
			if (!Number.isFinite(then) || then <= 0) return "--";
			const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
			const delta = now - then;
			if (delta < 60_000) return t("time.justNow");
			const minutes = Math.floor(delta / 60_000);
			if (minutes < 60) return t("time.minutes", { count: minutes });
			const hours = Math.floor(minutes / 60);
			if (hours < 24) return t("time.hours", { count: hours });
			const days = Math.floor(hours / 24);
			if (days < 30) return t("time.days", { count: days });
			const date = new Date(then);
			return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
		}
		//#endregion

		//#region data hooks
		const OVERVIEW_URL = "/session-stats/api/overview";
		const HEAVY_URL = "/session-stats/api/heavy";
		const LIVE_URL = "/session-stats/api/live";

		/** Read an array field off a payload that may be absent or malformed. */
		function arrayOf(payload, key) {
			return payload !== null && payload !== undefined && Array.isArray(payload[key]) ? payload[key] : [];
		}

		/** Append the selected window to an API path; a null selection asks for the host default. */
		function withWindow(path, windowKey) {
			return windowKey === null || windowKey === undefined ? path : `${path}?window=${encodeURIComponent(windowKey)}`;
		}

		/**
		 * Fetch one JSON chunk with cancel and stale protection.
		 *
		 * `data` survives a refetch, so a window switch keeps the previous charts
		 * on screen instead of blinking to placeholders. `status` is `loading` on
		 * the first load, `refreshing` while an old payload is still shown, and
		 * `ready` / `error` once the request settles. The in-flight request is
		 * aborted when the URL changes or the view unmounts, so a slow response for
		 * the previous window can never overwrite the newer one.
		 * @param {string} url - endpoint path including any query string.
		 * @param {number} reloadKey - bump to force a refetch of the same URL.
		 * @returns {{status: string, data: object|null, error: string|null}} chunk state.
		 */
		function useFetch(url, reloadKey) {
			const [state, setState] = react.useState({ status: "loading", data: null, error: null });
			react.useEffect(() => {
				let alive = true;
				const controller = typeof AbortController === "function" ? new AbortController() : null;
				setState((previous) => ({
					status: previous.data === null ? "loading" : "refreshing",
					data: previous.data,
					error: null,
				}));
				fetch(url, {
					cache: "no-store",
					headers: { accept: "application/json" },
					signal: controller === null ? undefined : controller.signal,
				})
					.then((response) => {
						if (!response.ok) throw new Error(`HTTP ${response.status}`);
						return response.json();
					})
					.then((payload) => {
						if (!alive) return;
						if (payload === null || typeof payload !== "object" || payload.ok === false) {
							throw new Error(payload && payload.message ? String(payload.message) : "invalid payload");
						}
						setState({ status: "ready", data: payload, error: null });
					})
					.catch((error) => {
						if (!alive || (error && error.name === "AbortError")) return;
						setState((previous) => ({
							status: previous.data === null ? "error" : "ready",
							data: previous.data,
							error: error && error.message ? String(error.message) : String(error),
						}));
					});
				return () => {
					alive = false;
					if (controller !== null) controller.abort();
				};
			}, [url, reloadKey]);
			return state;
		}

		/** Fast chunk: metric cards, daily bars, compositions, model detail. */
		function useOverview(windowKey, reloadKey) {
			return useFetch(withWindow(OVERVIEW_URL, windowKey), reloadKey);
		}

		/** Slow chunk: heatmap, leaderboards and the session list. */
		function useHeavy(windowKey, reloadKey) {
			return useFetch(withWindow(HEAVY_URL, windowKey), reloadKey);
		}

		/** Poll the live process snapshot every 5 seconds while mounted. */
		function useLive() {
			const [snapshot, setSnapshot] = react.useState(null);
			react.useEffect(() => {
				let alive = true;
				let timer = null;
				const controller = typeof AbortController === "function" ? new AbortController() : null;
				const load = () => {
					fetch(LIVE_URL, {
						cache: "no-store",
						headers: { accept: "application/json" },
						signal: controller === null ? undefined : controller.signal,
					})
						.then((response) => {
							if (!response.ok) throw new Error(`HTTP ${response.status}`);
							return response.json();
						})
						.then((payload) => {
							if (alive && payload !== null && typeof payload === "object" && payload.ok !== false) {
								setSnapshot(payload);
							}
						})
						.catch(() => {
							/* keep the previous snapshot on transient failures */
						})
						.finally(() => {
							if (alive) timer = setTimeout(load, 5000);
						});
				};
				load();
				return () => {
					alive = false;
					if (timer !== null) clearTimeout(timer);
					if (controller !== null) controller.abort();
				};
			}, []);
			return snapshot;
		}
		//#endregion

		//#region icons
		function IconBase({ size = 14, children }) {
			return h(
				"svg",
				{
					width: size,
					height: size,
					viewBox: "0 0 16 16",
					fill: "none",
					"aria-hidden": "true",
					focusable: "false",
					style: { display: "block" },
				},
				children,
			);
		}
		function TokensIcon({ size }) {
			return h(
				IconBase,
				{ size },
				h("path", {
					d: "M2.4 5.1 8 2.4l5.6 2.7L8 7.8 2.4 5.1Z",
					stroke: "currentColor",
					strokeWidth: 1.2,
					strokeLinejoin: "round",
				}),
				h("path", {
					d: "M2.4 8.1 8 10.8l5.6-2.7M2.4 11.1 8 13.8l5.6-2.7",
					stroke: "currentColor",
					strokeWidth: 1.2,
					strokeLinecap: "round",
					strokeLinejoin: "round",
				}),
			);
		}
		function CostIcon({ size }) {
			return h(
				IconBase,
				{ size },
				h("path", {
					d: "M4.1 3.1 8 7.3l3.9-4.2M8 7.3v6M5.3 9.2h5.4M5.3 11.4h5.4",
					stroke: "currentColor",
					strokeWidth: 1.2,
					strokeLinecap: "round",
					strokeLinejoin: "round",
				}),
			);
		}
		function SessionsIcon({ size }) {
			return h(
				IconBase,
				{ size },
				h("path", {
					d: "M13.6 8.2c0 2.2-2.5 4-5.6 4-.6 0-1.2-.07-1.75-.2L3.1 13.6l.95-2.55C2.8 10.2 2 9.25 2 8.2c0-2.2 2.5-4 5.6-4s6 1.8 6 4Z",
					stroke: "currentColor",
					strokeWidth: 1.2,
					strokeLinejoin: "round",
				}),
			);
		}
		function CacheIcon({ size }) {
			return h(
				IconBase,
				{ size },
				h("path", {
					d: "M8.9 2.3 4.3 8.8h3.1L6.8 13.7 11.7 6.9H8.6l.3-4.6Z",
					stroke: "currentColor",
					strokeWidth: 1.2,
					strokeLinejoin: "round",
				}),
			);
		}
		/**
		 * The pixel blue whale (B2: connected tail fin, mouth line, side fin and a
		 * three-pixel spout), one rect per pixel — see `_notes/design/whale-b2.svg`.
		 * `pixels` lists each sprite cell as `x,y`; the authoring grid is 16x16.
		 */
		const WHALE_SPRITE = [
			{ fill: "#74c0fc", pixels: "4,3 6,3 5,4 4,11 5,11 5,12" },
			{
				fill: "#1c7ed6",
				pixels:
					"4,5 5,5 6,5 7,5 2,6 3,6 4,6 5,6 6,6 7,6 8,6 9,6 1,7 2,7 3,7 4,7 5,7 6,7 7,7 8,7 9,7 10,7 0,8 1,8 4,8 5,8 6,8 7,8 8,8 9,8 10,8 0,9 1,9 4,9 5,9 6,9 7,9 8,9 9,9 10,9 0,10 4,10 5,10 6,10 7,10 8,10 9,10 10,10",
			},
			{ fill: "#1971c2", pixels: "12,7 13,7 11,8 12,8 11,9 1,10 2,10 3,10 11,10 11,11 12,11 12,12 13,12" },
			{ fill: "#0b2447", pixels: "2,8" },
			{ fill: "#ffffff", pixels: "3,8 2,9 3,9" },
			{ fill: "#a5d8ff", pixels: "1,11 2,11 3,11 6,11 7,11 8,11 9,11 10,11 2,12 3,12 4,12 6,12 7,12 8,12 9,12 4,13 5,13 6,13 7,13" },
		];

		/**
		 * Sidebar glyph: the pixel blue whale.
		 *
		 * The sprite lives on a 16-unit grid, so only whole multiples of 16 give
		 * every cell an integer number of CSS pixels. The sidebar asks for ~18px,
		 * where cells would alternate between 1px and 2px and the sprite turns
		 * uneven; snapping down to 16 keeps it square. Larger slots round down to
		 * the nearest multiple instead of overflowing.
		 */
		function SessionStatsIcon({ size }) {
			const requested = typeof size === "number" && Number.isFinite(size) ? size : 16;
			const edge = requested >= 32 ? Math.floor(requested / 16) * 16 : 16;
			const pixels = [];
			for (const group of WHALE_SPRITE) {
				for (const cell of group.pixels.split(" ")) {
					const [x, y] = cell.split(",");
					pixels.push(h("rect", { key: `${group.fill}/${cell}`, x: Number(x), y: Number(y), width: 1, height: 1, fill: group.fill }));
				}
			}
			return h(
				"svg",
				{
					width: edge,
					height: edge,
					viewBox: "0 0 16 16",
					shapeRendering: "crispEdges",
					"aria-hidden": "true",
					focusable: "false",
					style: { display: "block" },
				},
				pixels,
			);
		}
		//#endregion

		//#region cards
		function StatCard({ icon, title, value, unit, sub, note, noteTitle }) {
			return h(
				"article",
				{ className: "ssp-card ssp-stat" },
				h(
					"div",
					{ className: "ssp-stat-head" },
					h("span", { className: "ssp-icon" }, icon),
					h("span", { className: "ssp-stat-title" }, title),
				),
				h(
					"div",
					{ className: "ssp-value" },
					h("span", { className: "ssp-value-num" }, value),
					unit === null || unit === undefined ? null : h("span", { className: "ssp-value-unit" }, unit),
				),
				h("div", { className: "ssp-sub" }, sub),
				note === null || note === undefined
					? null
					: h("div", { className: "ssp-sub-note", title: noteTitle ?? undefined }, note),
			);
		}

		/** Signed delta chip: ▲ red on growth, ▼ green on decline, -- without a baseline. */
		function DeltaChip({ t, current, previous }) {
			const now = Number(current);
			const before = Number(previous);
			if (!Number.isFinite(now) || !Number.isFinite(before) || before <= 0) {
				return h("span", { className: "ssp-today-delta ssp-today-flat" }, "--");
			}
			const ratio = (now - before) / before;
			if (!Number.isFinite(ratio)) return h("span", { className: "ssp-today-delta ssp-today-flat" }, "--");
			if (Math.abs(ratio) < 0.0005) return h("span", { className: "ssp-today-delta ssp-today-flat" }, formatPercent(0));
			const up = ratio > 0;
			return h(
				"span",
				{ className: `ssp-today-delta ${up ? "ssp-today-up" : "ssp-today-down"}` },
				t("today.delta", { arrow: up ? "▲" : "▼", value: formatPercent(Math.abs(ratio)) }),
			);
		}

		/**
		 * Calendar-day stripe: today's four headline numbers next to their change
		 * against yesterday.
		 *
		 * `today === undefined` means the host does not ship the field yet, so the
		 * stripe is omitted entirely; `today === null` means the host has the field
		 * but no activity today, which is a normal state and renders as a hint, not
		 * as an error.
		 */
		function TodayBar({ t, data, currency, symbol, usdRate, placeholder }) {
			const snapshot = data !== null && data !== undefined ? data.today : undefined;
			if (snapshot === undefined) return null;
			// A day without activity keeps the four-cell layout and shows a dash for
			// every value and every comparison, so nothing on screen jumps.
			if (snapshot === null) {
				return h(
					"section",
					{ className: "ssp-card ssp-today", "aria-label": t("today.title") },
					["card.tokens", "card.cost", "card.sessions", "card.cache"].map((key) =>
						h(
							"div",
							{ className: "ssp-today-cell", key },
							h("div", { className: "ssp-today-label" }, t(key)),
							h("div", { className: "ssp-today-value" }, placeholder, h("span", { className: "ssp-today-delta ssp-today-flat" }, "--")),
						),
					),
				);
			}
			const previous = data.yesterday === undefined ? null : data.yesterday;
			const costOf = (entry) => (entry === null || entry === undefined ? null : displayMoney(entry.costCNY, currency, usdRate));
			const cells = [
				{ key: "tokens", label: t("card.tokens"), text: formatTokens(snapshot.tokens), current: snapshot.tokens, before: previous === null ? null : previous.tokens },
				{ key: "cost", label: t("card.cost"), text: `${symbol}${formatMoney(costOf(snapshot))}`, current: costOf(snapshot), before: costOf(previous) },
				{ key: "sessions", label: t("card.sessions"), text: String(Number(snapshot.sessions) || 0), current: snapshot.sessions, before: previous === null ? null : previous.sessions },
				{ key: "cache", label: t("card.cache"), text: formatPercent(snapshot.cacheHitRate), current: snapshot.cacheHitRate, before: previous === null ? null : previous.cacheHitRate },
			];
			return h(
				"section",
				{ className: "ssp-card ssp-today", "aria-label": t("today.title") },
				cells.map((cell) =>
					h(
						"div",
						{ className: "ssp-today-cell", key: cell.key },
						h("div", { className: "ssp-today-label" }, cell.label),
						h("div", { className: "ssp-today-value" }, cell.text, h(DeltaChip, { t, current: cell.current, previous: cell.before })),
					),
				),
			);
		}

		function LiveCard({ t, live, placeholder }) {
			const hasLive = live !== null && live !== undefined;
			const cpu = hasLive ? live.cpu : null;
			const memory = hasLive ? live.memory : null;
			const loop = hasLive ? live.eventLoop : null;
			const history = hasLive && live.history && Array.isArray(live.history.values) ? live.history.values : [];
			const values = hasLive && Array.isArray(history) ? history : [];
			return h(
				"section",
				{ className: "ssp-card ssp-live", "aria-label": t("live.title") },
				h(
					"div",
					{ className: "ssp-live-head" },
					h(
						"div",
						{ className: "ssp-live-title" },
						h("span", { className: "ssp-live-name" }, t("live.title")),
						h(
							"span",
							{ className: "ssp-pill" },
							h("span", { className: "ssp-pill-dot", "aria-hidden": "true" }),
							t("live.badge"),
						),
					),
					h(
						"span",
						{ className: "ssp-live-meta", title: hasLive ? t("live.meta.hint") : undefined },
						hasLive ? t("live.meta", { cores: cpu.cores }) : placeholder,
					),
				),
				h(
					"div",
					{ className: "ssp-metrics" },
					h(
						"div",
						{ className: "ssp-metric" },
						h("div", { className: "ssp-metric-label" }, t("live.cpu")),
						h(
							"div",
							{ className: "ssp-metric-value" },
							hasLive ? `${formatOneDecimal(cpu.single)}%` : placeholder,
							h(
								"span",
								{
									className: "ssp-metric-unit",
									title: t("live.cpu.hint"),
								},
								hasLive ? ` · ${formatTwoDecimals(cpu.single / 100)} ${t("unit.coresEq")}` : t("unit.core"),
							),
						),
						h(
							"div",
							{ className: "ssp-metric-sub" },
							hasLive
								? t("live.cpu.sub", { machine: formatOneDecimal(cpu.machine), cores: cpu.cores })
								: placeholder,
						),
					),
					h(
						"div",
						{ className: "ssp-metric" },
						h("div", { className: "ssp-metric-label" }, t("live.mem")),
						h(
							"div",
							{ className: "ssp-metric-value" },
							hasLive ? formatMegabytes(memory.rssMB) : placeholder,
							h("span", { className: "ssp-metric-unit" }, t("unit.mb")),
						),
						h(
							"div",
							{ className: "ssp-metric-sub" },
							hasLive ? t("live.mem.sub", { heap: formatMegabytes(memory.heapUsedMB) }) : placeholder,
						),
					),
					h(
						"div",
						{ className: "ssp-metric" },
						h("div", { className: "ssp-metric-label" }, t("live.loop")),
						h(
							"div",
							{ className: "ssp-metric-value" },
							hasLive ? formatOneDecimal(loop.p99ms) : placeholder,
							h("span", { className: "ssp-metric-unit" }, t("unit.ms")),
						),
						h(
							"div",
							{ className: "ssp-metric-sub" },
							hasLive ? t("live.loop.sub", { mean: formatOneDecimal(loop.meanMs) }) : placeholder,
						),
					),
					h(
						"div",
						{ className: "ssp-metric" },
						h("div", { className: "ssp-metric-label" }, t("live.uptime")),
						h(
							"div",
							{ className: "ssp-metric-value" },
							hasLive ? live.uptimeText : placeholder,
						),
						h(
							"div",
							{ className: "ssp-metric-sub" },
							hasLive ? t("live.uptime.sub", { pid: live.pid, node: live.node }) : placeholder,
						),
					),
				),
				h(
					"div",
					{ className: "ssp-chart-head" },
					h("span", null, t("live.chart")),
					h(
						"span",
						null,
						t("live.chart.peak", {
							peak: formatOneDecimal(hasLive && live.history ? live.history.peak : 0),
						}),
					),
				),
				h(Sparkline, { values }),
			);
		}

		/** Area sparkline over the 5-minute CPU ring buffer. */
		function Sparkline({ values }) {
			const width = 600;
			const height = 56;
			const padTop = 4;
			const padBottom = 2;
			const usable = height - padTop - padBottom;
			const points = Array.isArray(values) ? values : [];
			const hasLine = points.length >= 2;
			let peak = 0;
			for (const value of points) {
				const number = Number(value);
				if (Number.isFinite(number) && number > peak) peak = number;
			}
			const denominator = peak > 0 ? peak : 1;
			const step = points.length > 1 ? width / (points.length - 1) : width;
			const coords = points.map((value, index) => {
				const number = Number.isFinite(Number(value)) ? Number(value) : 0;
				const x = index * step;
				const y = height - padBottom - (number / denominator) * usable;
				return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
			});
			const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ");
			const area = hasLine ? `${line} L${width} ${height} L0 ${height} Z` : "";
			return h(
				"svg",
				{
					className: "ssp-spark",
					viewBox: `0 0 ${width} ${height}`,
					preserveAspectRatio: "none",
					role: "img",
					"aria-hidden": "true",
				},
				hasLine
					? [
							h(
								"defs",
								{ key: "defs" },
								h(
									"linearGradient",
									{ id: "ssp-spark-fill", x1: "0", y1: "0", x2: "0", y2: "1" },
									h("stop", { key: "a", offset: "0", className: "ssp-spark-stop-start" }),
									h("stop", { key: "b", offset: "1", className: "ssp-spark-stop-end" }),
								),
							),
							h("path", { key: "area", className: "ssp-spark-area", d: area }),
							h("path", { key: "line", className: "ssp-spark-line", d: line }),
						]
					: h("line", {
							className: "ssp-spark-empty",
							x1: 0,
							y1: height - padBottom,
							x2: width,
							y2: height - padBottom,
						}),
			);
		}

		/** Series key of the aggregated "other" slice (models beyond the palette). */
		const OTHER_SERIES_KEY = "__other";

		/**
		 * Order per-model series for the charts: the top `limit` models by tokens
		 * plus one aggregated "other" slice. Colors and labels come from the host
		 * response, so the response palette stays the single source of truth.
		 * @param {readonly object[]} models - response `models` (tokens desc).
		 * @param {{limit: number, otherLabel: string, otherColor: string, total: number}} options - series options.
		 * @returns {object[]} chart series with share, color, and source routes.
		 */
		function buildModelSeries(models, options) {
			const limit = Math.max(0, Number(options?.limit) || 0);
			const otherLabel = options?.otherLabel ?? "Other";
			const otherColor = options?.otherColor ?? "#868e96";
			const total = Number(options?.total) || 0;
			const list = Array.isArray(models) ? models : [];
			const head = list.slice(0, limit);
			const rest = list.slice(limit);
			const toSeries = (model) => ({
				key: String(model.route ?? model.model ?? ""),
				label: model.label || model.model || model.route || "",
				provider: model.provider ?? "",
				vendor: model.vendor ?? null,
				priceLevel: model.priceLevel ?? null,
				sourceUrl: model.sourceUrl ?? null,
				currency: model.currency ?? null,
				color: model.color || otherColor,
				tokens: Number(model.tokens) || 0,
				costsOnly: model.costsOnly === true,
				searches: Number(model.searches) || 0,
				costCNY: Number(model.costCNY) || 0,
				costUSD: Number(model.costUSD) || 0,
				routes: [String(model.route ?? model.model ?? "")],
			});
			const series = head.map(toSeries);
			if (rest.length > 0) {
				series.push({
					key: OTHER_SERIES_KEY,
					label: otherLabel,
					provider: "",
					vendor: null,
					priceLevel: null,
					sourceUrl: null,
					currency: null,
					color: otherColor,
					tokens: rest.reduce((sum, model) => sum + (Number(model.tokens) || 0), 0),
					costCNY: rest.reduce((sum, model) => sum + (Number(model.costCNY) || 0), 0),
					costUSD: rest.reduce((sum, model) => sum + (Number(model.costUSD) || 0), 0),
					routes: rest.map((model) => String(model.route ?? model.model ?? "")),
				});
			}
			for (const entry of series) entry.share = total > 0 ? entry.tokens / total : 0;
			return series;
		}

		/**
		 * Map every route onto the series bucket it belongs to (named or "other").
		 * @param {readonly object[]} series - series from {@link buildModelSeries}.
		 * @returns {Map<string, string>} route → series key.
		 */
		function seriesKeyByRoute(series) {
			const map = new Map();
			for (const entry of series) {
				for (const route of entry.routes) map.set(route, entry.key);
			}
			return map;
		}

		/** Localized vendor label of one model series entry. */
		function vendorLabelOf(t, entry) {
			const id = entry?.vendor ?? null;
			if (id === null || id === "") return entry?.provider || t("vendor.unknown");
			const key = "vendor." + id;
			const label = t(key);
			return label === key ? String(id) : label;
		}

		/** One-line price-source description used in tooltips. */
		function priceSourceTitleOf(t, entry) {
			const level = entry?.priceLevel ?? "unpriced";
			if (level === "unpriced") return t("price.unpricedTitle");
			const levelLabel = t("priceLevel." + level, { vendor: vendorLabelOf(t, entry) });
			const currency = t("price.currency." + (entry?.currency === "USD" ? "USD" : "CNY"));
			return t("price.sourceTitle", { level: levelLabel, currency });
		}

		/** Small non-official price-level tag, or null for official rows. */
		function priceLevelTagOf(t, entry) {
			if ((entry?.priceLevel ?? "unpriced") !== "unpriced") return null;
			return t("models.tag.unpriced");
		}

		/** Small square color chip shared by legends and rows. */
		function ColorChip({ color, className }) {
			return h("span", { className, style: { background: color }, "aria-hidden": "true" });
		}

		/** Convert a CNY amount into the display currency (CNY is the authoritative figure). */
		function displayMoney(valueCNY, currency, usdRate) {
			const amount = Number(valueCNY) || 0;
			if (currency !== "USD") return amount;
			const rate = Number(usdRate) > 0 ? Number(usdRate) : 7.1;
			return amount / rate;
		}

		function DailyCard({ t, data, currency, symbol, placeholder, windowKey, models, otherLabel, otherColor, limit, granularity, usdRate }) {
			const daily = data !== null && Array.isArray(data.daily) ? data.daily : [];
			const totals = data !== null && data.totals ? data.totals : null;
			// The caption must describe the bucket the bars come from, not the tab the
			// user just clicked: during a window switch `data` is still the old window.
			const rangeKey = data !== null && data.window && data.window.key ? data.window.key : windowKey;
			const total = totals === null ? 0 : Number(totals.tokens) || 0;
			const series = buildModelSeries(models, { limit, otherLabel, otherColor, total });
			const routeToSeries = seriesKeyByRoute(series);
			const chartHeight = 168;
			let peak = 0;
			for (const point of daily) {
				const tokens = Number(point.tokens);
				if (Number.isFinite(tokens) && tokens > peak) peak = tokens;
			}
			const denominator = peak > 0 ? peak : 1;
			const bars = daily.map((point) => {
				const tokensByKey = new Map();
				for (const model of Array.isArray(point.models) ? point.models : []) {
					const route = String(model.route ?? model.model ?? "");
					const key = routeToSeries.get(route) ?? OTHER_SERIES_KEY;
					tokensByKey.set(key, (tokensByKey.get(key) ?? 0) + (Number(model.tokens) || 0));
				}
				const ordered = series.filter((entry) => (tokensByKey.get(entry.key) ?? 0) > 0);
				const segments = ordered.map((entry) => {
					const value = tokensByKey.get(entry.key) ?? 0;
					return h("div", {
						key: entry.key,
						className: "ssp-bar-seg",
						style: {
							height: `${((value / denominator) * chartHeight).toFixed(2)}px`,
							background: entry.color,
						},
						title: `${entry.label} · ${formatTokens(value)} tokens`,
					});
				});
				if (segments.length === 0 && Number(point.tokens) > 0) {
					// Compatibility fallback for payloads without per-day models: one flat bar.
					segments.push(
						h("div", {
							key: "fallback",
							className: "ssp-bar-seg",
							style: {
								height: `${((Number(point.tokens) / denominator) * chartHeight).toFixed(2)}px`,
								background: "var(--ssp-accent)",
							},
						}),
					);
				}
				const tooltip = `${point.label} · ${formatTokens(point.tokens)} tokens · ${symbol}${formatMoney(
					currency === "CNY" ? point.costCNY : point.costUSD,
				)}`;
				return h(
					"div",
					{ className: "ssp-bar-col", key: point.key, title: tooltip },
					segments.length > 0
						? h("div", { className: "ssp-bar" }, segments)
						: h("div", { className: "ssp-bar ssp-bar-empty", "aria-hidden": "true" }),
				);
			});
			const dense = daily.length > 14;
			const labelStep = dense ? Math.ceil(daily.length / 7) : 1;
			const axis = daily.map((point, index) =>
				h(
					"div",
					{ className: "ssp-axis-label", key: point.key },
					index % labelStep === 0 ? point.label : "",
				),
			);
			const legend = series
				.filter((entry) => entry.tokens > 0)
				.map((entry) =>
					h(
						"span",
						{ className: "ssp-legend-item", key: entry.key },
						h(ColorChip, { color: entry.color, className: "ssp-legend-dot" }),
						entry.label,
						h("span", { className: "ssp-legend-value" }, formatPercent(entry.share)),
					),
				);
			// The forecast (IDEA-01) is a daily-cost trend, so an hourly window has
			// no meaningful day axis to hang it on; it renders for day granularity
			// only and hides itself when the host has too little history to fit.
			const showForecast =
				granularity === "day" &&
				data !== null &&
				data.forecast !== null &&
				data.forecast !== undefined &&
				Number.isFinite(Number(data.forecast.monthEndEstimate)) &&
				daily.length > 0;
			const rate = Number(usdRate) > 0 ? Number(usdRate) : 7.1;
			let forecastToday = 0;
			let forecastEnd = 0;
			let forecastSigma = 0;
			let forecastScale = 1;
			if (showForecast) {
				// The fit regresses the last 30 days with x = 29 for today, so today's
				// fitted daily cost is intercept + slope * 29.
				forecastToday = displayMoney(Number(data.forecast.intercept) + Number(data.forecast.slope) * 29, currency, rate);
				forecastEnd = displayMoney(data.forecast.monthEndEstimate, currency, rate);
				forecastSigma = displayMoney(data.forecast.sigma, currency, rate);
				let costPeak = 0;
				for (const point of daily) costPeak = Math.max(costPeak, displayMoney(point.costCNY, currency, rate));
				forecastScale = Math.max(costPeak, forecastToday, forecastEnd, 0.0001);
			}
			// y grows downwards inside the 0..100 viewBox. The tail is a compressed
			// projection strip, so it only has to convey the direction of travel.
			const forecastY = (value) => (100 - Math.min(100, Math.max(0, (value / forecastScale) * 100))).toFixed(2);
			return h(
				"section",
				{ className: "ssp-card", "aria-label": t("daily.title") },
				h(
					"div",
					{ className: "ssp-card-head" },
					h(
						"div",
						null,
						h("div", { className: "ssp-card-title" }, t("daily.title")),
						h("div", { className: "ssp-card-sub" }, t("daily.sub", { range: t("window." + rangeKey) })),
					),
					h(
						"div",
						{ className: "ssp-card-aside" },
						h(
							"div",
							{ className: "ssp-aside-main" },
							totals === null ? placeholder : `${formatTokens(totals.tokens)} tokens`,
						),
						h(
							"div",
							{ className: "ssp-aside-sub" },
							totals === null ? placeholder : `${symbol}${formatMoney(currency === "CNY" ? totals.costCNY : totals.costUSD)}`,
						),
					),
				),
				h(
					"div",
					{ className: "ssp-chart-wrap" },
					h(
						"div",
						{ className: "ssp-bars-wrap" },
						h(
							"div",
							{ className: "ssp-bars", "data-dense": dense ? "true" : "false" },
							bars.length > 0
								? bars
								: Array.from({ length: 7 }, (_, index) =>
										h("div", { className: "ssp-bar-col", key: "empty-" + index }, h("div", { className: "ssp-bar ssp-bar-empty" })),
									),
						),
						h("div", { className: "ssp-axis", "data-dense": dense ? "true" : "false" }, axis),
					),
					showForecast
						? h(
								"div",
								{ className: "ssp-forecast", "data-testid": "ssp-forecast", "aria-label": t("forecast.title") },
								h(
									"svg",
									{ viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" },
									h("line", { className: "ssp-forecast-line", x1: 0, y1: forecastY(forecastToday), x2: 100, y2: forecastY(forecastEnd) }),
								),
								h(
									"span",
									{ className: "ssp-forecast-text" },
									t("forecast.end", {
										cost: `${symbol}${formatMoney(forecastEnd)}`,
										sigma: `${symbol}${formatMoney(forecastSigma)}`,
									}),
								),
							)
						: null,
				),
				showForecast ? h("div", { className: "ssp-card-sub ssp-forecast-caption" }, t("forecast.caption")) : null,
				legend.length > 0 ? h("div", { className: "ssp-legend ssp-bar-legend" }, legend) : null,
			);
		}

		function DonutCard({ t, data, currency, symbol, placeholder, models, otherLabel, otherColor, limit }) {
			const totals = data !== null && data.totals ? data.totals : null;
			const total = totals === null ? 0 : Number(totals.tokens) || 0;
			const series = buildModelSeries(models, { limit, otherLabel, otherColor, total });
			const active = series.filter((entry) => entry.tokens > 0);
			const size = 168;
			const stroke = 18;
			const radius = (size - stroke) / 2;
			const circumference = 2 * Math.PI * radius;
			let offset = 0;
			const segments = active.map((entry) => {
				const share = total > 0 ? entry.tokens / total : 0;
				const rawLength = share * circumference;
				const gap = share > 0.02 ? 2 : 0;
				const length = Math.max(0, rawLength - gap);
				const segment = h("circle", {
					key: entry.key,
					className: "ssp-donut-seg",
					"data-series": entry.key,
					cx: size / 2,
					cy: size / 2,
					r: radius,
					transform: `rotate(-90 ${size / 2} ${size / 2})`,
					strokeDasharray: `${length.toFixed(2)} ${(circumference - length).toFixed(2)}`,
					strokeDashoffset: (-offset).toFixed(2),
					style: { stroke: entry.color },
				});
				offset += rawLength;
				return segment;
			});
			const legend = active.map((entry) =>
				h(
					"div",
					{ className: "ssp-model-legend-row", key: entry.key, title: priceSourceTitleOf(t, entry) },
					h(ColorChip, { color: entry.color, className: "ssp-legend-dot" }),
					h("span", { className: "ssp-model-legend-name", title: entry.label }, entry.label),
					h("span", { className: "ssp-model-legend-share" }, formatPercent(entry.share)),
					h("span", { className: "ssp-model-legend-tokens" }, formatTokens(entry.tokens)),
					h(
						"span",
						{ className: "ssp-model-legend-cost" },
						(entry.priceLevel ?? "unpriced") === "unpriced"
							? t("models.unpriced")
							: `${symbol}${formatMoney(currency === "CNY" ? entry.costCNY : entry.costUSD)}`,
					),
				),
			);
			return h(
				"section",
				{ className: "ssp-card", "aria-label": t("donut.title") },
				h(
					"div",
					{ className: "ssp-card-head" },
					h(
						"div",
						null,
						h("div", { className: "ssp-card-title" }, t("donut.title")),
						h("div", { className: "ssp-card-sub" }, t("donut.sub")),
					),
				),
				h(
					"div",
					{ className: "ssp-donut-wrap" },
					h(
						"div",
						{ className: "ssp-donut" },
						h(
							"svg",
							{ viewBox: `0 0 ${size} ${size}`, role: "img", "aria-hidden": "true" },
							h("circle", {
								className: "ssp-donut-track",
								cx: size / 2,
								cy: size / 2,
								r: radius,
							}),
							segments,
						),
						h(
							"div",
							{ className: "ssp-donut-center" },
							h("div", { className: "ssp-donut-value" }, totals === null ? placeholder : formatTokens(total)),
							h("div", { className: "ssp-donut-unit" }, t("unit.tokens")),
							h(
								"div",
								{ className: "ssp-donut-cost" },
								totals === null
									? placeholder
									: `${symbol}${formatMoney(currency === "CNY" ? totals.costCNY : totals.costUSD)}`,
							),
						),
					),
					legend.length > 0 ? h("div", { className: "ssp-model-legend" }, legend) : null,
				),
			);
		}

		function CostDonutCard({ t, data, currency, symbol, placeholder }) {
			const totals = data !== null && data.totals ? data.totals : null;
			const slices = data !== null && Array.isArray(data.costComposition) ? data.costComposition : [];
			const totalCost = totals === null ? 0 : Number(totals.costCNYTotal ?? totals.costCNY) || 0;
			const tokens = totals === null ? 0 : Number(totals.tokens) || 0;
			const rate = data !== null && Number(data.currency?.usdRate) > 0 ? Number(data.currency.usdRate) : 7.1;
			const toDisplay = (cny) => (currency === "CNY" ? cny : cny / rate);
			const size = 168;
			const stroke = 18;
			const radius = (size - stroke) / 2;
			const circumference = 2 * Math.PI * radius;
			const active = totalCost > 0 ? slices.filter((slice) => (Number(slice.costCNY) || 0) > 0) : [];
			let offset = 0;
			const segments = active.map((slice) => {
				const share = totalCost > 0 ? (Number(slice.costCNY) || 0) / totalCost : 0;
				const rawLength = share * circumference;
				const gap = share > 0.02 ? 2 : 0;
				const length = Math.max(0, rawLength - gap);
				const segment = h("circle", {
					key: slice.key,
					className: "ssp-donut-seg",
					"data-series": slice.key,
					cx: size / 2,
					cy: size / 2,
					r: radius,
					transform: `rotate(-90 ${size / 2} ${size / 2})`,
					strokeDasharray: `${length.toFixed(2)} ${(circumference - length).toFixed(2)}`,
					strokeDashoffset: (-offset).toFixed(2),
					style: { stroke: slice.color },
				});
				offset += rawLength;
				return segment;
			});
			const legend = active.map((slice) => {
				const share = totalCost > 0 ? (Number(slice.costCNY) || 0) / totalCost : 0;
				return h(
					"div",
					{ className: "ssp-model-legend-row ssp-cost-legend-row", key: slice.key },
					h(ColorChip, { color: slice.color, className: "ssp-legend-dot" }),
					h(
						"span",
						{ className: "ssp-model-legend-name", title: slice.label },
						slice.label,
						slice.vendor === null || slice.vendor === undefined
							? null
							: h("span", { className: "ssp-cost-legend-vendor" }, " · " + vendorLabelOf(t, slice)),
					),
					h(
						"span",
						{ className: "ssp-model-legend-share" },
						share > 0 && share < 0.001 ? "<0.1%" : formatPercent(share),
					),
					h("span", { className: "ssp-model-legend-cost" }, `${symbol}${formatMoney(toDisplay(slice.costCNY))}`),
				);
			});
			return h(
				"section",
				{ className: "ssp-card ssp-cost-donut", "aria-label": t("costDonut.title") },
				h(
					"div",
					{ className: "ssp-card-head" },
					h(
						"div",
						null,
						h("div", { className: "ssp-card-title" }, t("costDonut.title")),
						h("div", { className: "ssp-card-sub" }, t("costDonut.sub")),
					),
				),
				h(
					"div",
					{ className: "ssp-donut-wrap" },
					h(
						"div",
						{ className: "ssp-donut" },
						h(
							"svg",
							{ viewBox: `0 0 ${size} ${size}`, role: "img", "aria-hidden": "true" },
							h("circle", {
								className: "ssp-donut-track",
								cx: size / 2,
								cy: size / 2,
								r: radius,
							}),
							segments,
						),
						h(
							"div",
							{ className: "ssp-donut-center" },
							h(
								"div",
								{ className: "ssp-donut-value" },
								active.length === 0
									? t("state.placeholder")
									: `${symbol}${formatMoney(toDisplay(totalCost))}`,
							),
							h(
								"div",
								{ className: "ssp-donut-unit" },
								active.length === 0 ? placeholder : `${formatTokens(tokens)} tokens`,
							),
						),
					),
					legend.length > 0 ? h("div", { className: "ssp-model-legend" }, legend) : null,
				),
			);
		}

		function ModelDetailCard({ t, models, currency, symbol, placeholder, otherLabel, otherColor, limit, unpricedCount, unpricedTokenTotal }) {
			const total = (Array.isArray(models) ? models : []).reduce(
				(sum, model) => sum + (Number(model.tokens) || 0),
				0,
			);
			const series = buildModelSeries(models, { limit, otherLabel, otherColor, total });
			const rows = series
				.filter((entry) => entry.tokens > 0)
				.map((entry) =>
					h(
						"div",
						{ className: "ssp-model-row", key: entry.key },
						h(
							"div",
							{ className: "ssp-model-identity" },
							h(ColorChip, { color: entry.color, className: "ssp-model-dot" }),
							h("span", { className: "ssp-model-name", title: entry.label }, entry.label),
							h(
								"span",
								{ className: "ssp-model-provider" },
								"· " + vendorLabelOf(t, entry),
							),
							priceLevelTagOf(t, entry) === null
								? null
								: h(
										"span",
										{ className: "ssp-model-tag", title: priceSourceTitleOf(t, entry) },
										priceLevelTagOf(t, entry),
									),
						),
						h(
							"div",
							{ className: "ssp-model-bar" },
							h("div", {
								className: "ssp-model-bar-fill",
								style: {
									width: `${Math.max(0.6, Math.min(100, entry.share * 100)).toFixed(2)}%`,
									background: entry.color,
								},
							}),
						),
						h("div", { className: "ssp-model-tokens" }, formatTokens(entry.tokens)),
						h("div", { className: "ssp-model-share" }, formatPercent(entry.share)),
						h(
							"div",
							{ className: "ssp-model-cost", title: priceSourceTitleOf(t, entry) },
							(entry.priceLevel ?? "unpriced") === "unpriced"
								? t("models.unpriced")
								: `${symbol}${formatMoney(currency === "CNY" ? entry.costCNY : entry.costUSD)}`,
						),
					),
				);
			// Search is billed per request and carries no tokens: it is listed in
			// this table only, never in the token donut / stacked bars.
			const searchRows = (Array.isArray(models) ? models : [])
				.filter((model) => model.costsOnly === true)
				.map((model) =>
					h(
						"div",
						{ className: "ssp-model-row ssp-model-row-search", key: model.route },
						h(
							"div",
							{ className: "ssp-model-identity" },
							h(ColorChip, { color: model.color || otherColor, className: "ssp-model-dot" }),
							h("span", { className: "ssp-model-name", title: t("models.searchTitle") }, t("models.search")),
							h(
								"span",
								{ className: "ssp-model-provider" },
								"· " + vendorLabelOf(t, { vendor: model.vendor, provider: model.provider }),
							),
						),
						h("div", { className: "ssp-model-bar" }),
						h("div", { className: "ssp-model-tokens" }, t("models.searchTokens")),
						h("div", { className: "ssp-model-share" }, t("models.searchShare")),
						h(
							"div",
							{ className: "ssp-model-cost", title: t("models.searchTitle") },
							`${symbol}${formatMoney(currency === "CNY" ? model.costCNY : model.costUSD)}`,
						),
					),
				);
			const bodyRows = [...rows, ...searchRows];
			return h(
				"section",
				{ className: "ssp-card ssp-models", "aria-label": t("models.title") },
				h(
					"div",
					{ className: "ssp-card-head" },
					h(
						"div",
						null,
						h("div", { className: "ssp-card-title" }, t("models.title")),
						h("div", { className: "ssp-card-sub" }, t("models.sub")),
					),
				),
				h(
					"div",
					{ className: "ssp-model-table" },
					bodyRows.length > 0
						? [
								h(
									"div",
									{ className: "ssp-model-row ssp-model-head", key: "head" },
									h("div", { className: "ssp-model-identity" }, t("models.colModel")),
									h("div", null),
									h("div", { className: "ssp-model-tokens" }, t("models.colTokens")),
									h("div", { className: "ssp-model-share" }, t("models.colShare")),
									h("div", { className: "ssp-model-cost" }, t("models.colCost")),
								),
								...bodyRows,
							]
						: h("div", { className: "ssp-card-sub" }, placeholder),
				),
				unpricedCount > 0
					? h(
							"div",
							{ className: "ssp-model-foot" },
							t("models.unpricedNote", {
								count: unpricedCount,
								tokens: formatTokens(unpricedTokenTotal),
							}),
						)
					: null,
			);
		}

		//#endregion

		//#region heavy cards
		/** 2px indeterminate bar pinned to the panel top while a chunk reloads. */
		function ProgressBar({ t, active }) {
			if (!active) return null;
			return h(
				"div",
				{ className: "ssp-progress", role: "progressbar", "data-testid": "ssp-progress", "aria-label": t("state.loading") },
				h("div", { className: "ssp-progress-fill" }),
			);
		}

		/** "分析中" plus three pulsing dots for cards whose chunk has not landed yet. */
		function AnalyzingDots({ t }) {
			return h(
				"span",
				{ className: "ssp-analyzing" },
				h("span", null, t("state.analyzing")),
				h("span", { className: "ssp-dot" }),
				h("span", { className: "ssp-dot" }),
				h("span", { className: "ssp-dot" }),
			);
		}

		/** Placeholder body shared by the heavy cards while their chunk is on the wire. */
		function PendingBody({ t, text }) {
			return h("div", { className: "ssp-quiet" }, text === null ? h(AnalyzingDots, { t }) : text);
		}

		/**
		 * Body text for a card whose chunk is missing.
		 *
		 * Three states read differently: a request still in flight gets the
		 * animated "analyzing" hint (null), a successful but empty payload gets the
		 * card's own empty copy, and a failed request (404 on an old host, say) gets
		 * a neutral "data unavailable" instead of pretending there is no activity.
		 * @returns {string|null} null means "show the analyzing dots".
		 */
		function chunkFallback(t, state, emptyText) {
			if (state === "error") return t("state.emptyChunk");
			if (state === "ready") return emptyText;
			return null;
		}

		/** Pill segmented control shared by the heatmap mode and the session sort. */
		function Segmented({ label, options, value, onChange }) {
			return h(
				"div",
				{ className: "ssp-seg", role: "group", "aria-label": label },
				options.map((option) =>
					h(
						"button",
						{
							key: option.key,
							type: "button",
							className: `ssp-seg-btn${option.key === value ? " ssp-seg-active" : ""}`,
							"aria-pressed": option.key === value ? "true" : "false",
							onClick: () => onChange(option.key),
						},
						option.label,
					),
				),
			);
		}

		/**
		 * GitHub-style activity calendar: 8 week columns × 7 day rows.
		 *
		 * The host sends 56 consecutive days oldest-first, so slicing them into
		 * chunks of seven puts the newest day in the bottom-right cell without
		 * needing to know the weekday offset. Empty days keep the faintest shade
		 * instead of disappearing, which is what makes gaps readable.
		 */
		function HeatmapCard({ t, heatmap, state }) {
			const [mode, setMode] = react.useState("tokens");
			const list = Array.isArray(heatmap) ? heatmap.slice(-56) : [];
			const valueOf = (cell) => (mode === "sessions" ? Number(cell.sessions) || 0 : Number(cell.tokens) || 0);
			let max = 0;
			for (const cell of list) max = Math.max(max, valueOf(cell));
			const levelOf = (value) => {
				if (!(value > 0)) return 0;
				if (!(max > 0)) return 1;
				return Math.min(4, 1 + Math.floor((value / max) * 3.999));
			};
			const columns = [];
			for (let index = 0; index < list.length; index += 7) columns.push(list.slice(index, index + 7));
			return h(
				"section",
				{ className: "ssp-card ssp-heat", "aria-label": t("heatmap.title") },
				h(
					"div",
					{ className: "ssp-card-head" },
					h(
						"div",
						null,
						h("div", { className: "ssp-card-title" }, t("heatmap.title")),
						h("div", { className: "ssp-card-sub" }, t("heatmap.sub")),
					),
					h(Segmented, {
						label: t("heatmap.aria"),
						value: mode,
						onChange: setMode,
						options: [
							{ key: "tokens", label: t("heatmap.mode.tokens") },
							{ key: "sessions", label: t("heatmap.mode.sessions") },
						],
					}),
				),
				list.length === 0
					? h(PendingBody, { t, text: chunkFallback(t, state, t("heatmap.empty")) })
					: h(
							"div",
							{ className: "ssp-heat-grid" },
							columns.map((column, columnIndex) =>
								h(
									"div",
									{ className: "ssp-heat-col", key: `col${columnIndex}` },
									column.map((cell) =>
										h("div", {
											key: String(cell.date),
											className: `ssp-heat-cell ssp-heat-l${levelOf(valueOf(cell))}`,
											"data-date": String(cell.date),
											"data-value": String(valueOf(cell)),
											title: t("heatmap.cell", {
												date: String(cell.date),
												tokens: formatTokens(cell.tokens),
												sessions: Number(cell.sessions) || 0,
												turns: Number(cell.turns) || 0,
											}),
										}),
									),
								),
							),
						),
				list.length === 0
					? null
					: h(
							"div",
							{ className: "ssp-heat-legend" },
							h("span", null, t("heatmap.less")),
							[0, 1, 2, 3, 4].map((level) => h("span", { key: `lg${level}`, className: `ssp-heat-cell ssp-heat-swatch ssp-heat-l${level}` })),
							h("span", null, t("heatmap.more")),
						),
			);
		}

		/**
		 * Success-rate tier for the tool leaderboard badge.
		 *
		 * Green at 95% and above, amber from 80% up to 95%, red below that, and
		 * `unknown` when the host had no paired tool results to compute a rate.
		 * @param {number|null} value - 0..1 success rate.
		 * @returns {"ok"|"warn"|"bad"|"unknown"} tier key.
		 */
		function successTier(value) {
			const rate = Number(value);
			if (value === null || value === undefined || !Number.isFinite(rate)) return "unknown";
			if (rate >= 0.95) return "ok";
			if (rate >= 0.8) return "warn";
			return "bad";
		}

		/** Duration label for the tool leaderboard: 236ms below a second, 1.2s above. */
		function formatDuration(value) {
			const ms = Number(value);
			if (value === null || value === undefined || !Number.isFinite(ms) || ms < 0) return null;
			if (ms < 1000) return `${Math.round(ms)}ms`;
			const seconds = ms / 1000;
			return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
		}

		/**
		 * Top-N horizontal bars shared by the tool / command / skill leaderboards.
		 *
		 * Each bar is scaled against the busiest entry of its own list, so the ten
		 * rows stay comparable even when the absolute counts differ by orders of
		 * magnitude. The host sends Top 20; only ten are drawn. `rich` adds the
		 * success-rate badge and the average duration, which only the tool
		 * leaderboard carries.
		 */
		function LeaderboardCard({ t, title, sub, entries, nameKey, state, rich }) {
			const list = Array.isArray(entries) ? entries.slice(0, 10) : [];
			let max = 0;
			for (const entry of list) max = Math.max(max, Number(entry.count) || 0);
			const scale = max > 0 ? max : 1;
			const rowOf = (entry, index) => {
				const name = String(entry[nameKey] ?? "");
				const count = Number(entry.count) || 0;
				const tier = rich ? successTier(entry.successRate) : "unknown";
				const duration = rich ? formatDuration(entry.avgMs) : null;
				const rateText = rich && tier !== "unknown" ? formatPercent(Number(entry.successRate)) : null;
				// Hover text lists only the parts the host could actually compute.
				const parts = [];
				if (rateText !== null) parts.push(t("rank.ratePart", { value: rateText }));
				if (duration !== null) parts.push(t("rank.avgPart", { value: duration }));
				const errors = Number(entry.errorCount);
				if (Number.isFinite(errors) && errors > 0) parts.push(t("rank.errorPart", { count: errors }));
				const detailTitle = parts.length > 0 ? parts.join(" · ") : t("state.placeholder");
				return h(
					"div",
					{ className: `ssp-rank-row${rich ? " ssp-rank-row-rich" : ""}`, key: `${name}-${index}` },
					h("span", { className: "ssp-rank-name", title: name }, name === "" ? "--" : name),
					h(
						"span",
						{ className: "ssp-rank-bar" },
						h("span", { className: "ssp-rank-fill", style: { width: `${(count / scale) * 100}%` } }),
					),
					rich
						? h(
								"span",
								{ className: `ssp-rate ssp-rate-${tier}`, title: detailTitle, "data-tier": tier },
								rateText === null ? t("state.placeholder") : rateText,
							)
						: null,
					rich ? h("span", { className: "ssp-rank-ms", title: detailTitle }, duration === null ? t("state.placeholder") : duration) : null,
					h("span", { className: "ssp-rank-count" }, formatTokens(count)),
				);
			};
			return h(
				"section",
				{ className: "ssp-card ssp-rank", "aria-label": title },
				h(
					"div",
					{ className: "ssp-card-head" },
					h("div", null, h("div", { className: "ssp-card-title" }, title), h("div", { className: "ssp-card-sub" }, sub)),
				),
				list.length === 0
					? h(PendingBody, { t, text: chunkFallback(t, state, t("rank.empty")) })
					: h("div", { className: "ssp-rank-list" }, list.map(rowOf)),
			);
		}

		/**
		 * Session list over the heavy payload.
		 *
		 * Subagent sessions are hidden by default because they outnumber the real
		 * conversations (105 vs 63 on the reference machine) and would bury them.
		 * Search matches the title and the last user prompt; the visible rows are
		 * capped at 50 with an internal scroll so the panel never grows unbounded.
		 */
		function SessionListCard({ t, sessions, state, generatedAt, currency, symbol, rate }) {
			const [query, setQuery] = react.useState("");
			const [sort, setSort] = react.useState("recent");
			const [withSubagents, setWithSubagents] = react.useState(false);
			const all = Array.isArray(sessions) ? sessions : [];
			const needle = query.trim().toLowerCase();
			const usdRate = Number(rate) > 0 ? Number(rate) : 7.1;
			const nowMs = Number(generatedAt) > 0 ? Number(generatedAt) : Date.now();
			const visible = all.filter((session) => {
				if (!withSubagents && session.isSubagent === true) return false;
				if (needle === "") return true;
				return `${session.title ?? ""}\n${session.lastPrompt ?? ""}`.toLowerCase().includes(needle);
			});
			const sorted = [...visible].sort((left, right) => {
				if (sort === "tokens") return (Number(right.tokens) || 0) - (Number(left.tokens) || 0);
				if (sort === "cost") return (Number(right.costCNY) || 0) - (Number(left.costCNY) || 0);
				return (Number(right.lastActiveAt) || 0) - (Number(left.lastActiveAt) || 0);
			});
			const rows = sorted.slice(0, 50);
			return h(
				"section",
				{ className: "ssp-card ssp-sessions", "aria-label": t("sessions.title") },
				h(
					"div",
					{ className: "ssp-card-head" },
					h(
						"div",
						null,
						h("div", { className: "ssp-card-title" }, t("sessions.title")),
						h("div", { className: "ssp-card-sub" }, t("sessions.sub", { shown: rows.length, total: visible.length })),
					),
				),
				h(
					"div",
					{ className: "ssp-list-tools" },
					h("input", {
						className: "ssp-search",
						type: "search",
						value: query,
						placeholder: t("sessions.search"),
						"aria-label": t("sessions.search"),
						onChange: (event) => setQuery(event !== null && event !== undefined && event.target ? String(event.target.value) : ""),
					}),
					h(Segmented, {
						label: t("sessions.sortAria"),
						value: sort,
						onChange: setSort,
						options: [
							{ key: "recent", label: t("sessions.sort.recent") },
							{ key: "tokens", label: t("sessions.sort.tokens") },
							{ key: "cost", label: t("sessions.sort.cost") },
						],
					}),
					h(
						"label",
						{ className: "ssp-check" },
						h("input", {
							type: "checkbox",
							checked: withSubagents,
							onChange: (event) => setWithSubagents(Boolean(event !== null && event !== undefined && event.target && event.target.checked)),
						}),
						h("span", null, t("sessions.withSubagents")),
					),
				),
				rows.length === 0
					? h(PendingBody, {
							t,
							text: all.length === 0 ? chunkFallback(t, state, t("sessions.empty")) : t("sessions.empty"),
						})
					: h(
							"div",
							{ className: "ssp-sess-list" },
							rows.map((session) => {
								const tokens = Number(session.tokens) || 0;
								const costCNY = Number(session.costCNY) || 0;
								const cost = currency === "CNY" ? costCNY : costCNY / usdRate;
								const rawTitle = String(session.title ?? "").trim();
								const title = rawTitle === "" ? t("sessions.untitled") : rawTitle;
								return h(
									"article",
									{
										className: "ssp-sess-row",
										key: String(session.id ?? title),
										"data-archived": session.isArchived === true ? "true" : "false",
										"data-subagent": session.isSubagent === true ? "true" : "false",
									},
									h(
										"div",
										null,
										h(
											"div",
											{ className: "ssp-sess-head" },
											h("span", { className: "ssp-sess-title", title }, title),
											session.isSubagent === true ? h("span", { className: "ssp-sess-tag" }, t("sessions.subagentTag")) : null,
											session.isArchived === true ? h("span", { className: "ssp-sess-tag" }, t("sessions.archivedTag")) : null,
										),
										h("div", { className: "ssp-sess-prompt" }, String(session.lastPrompt ?? "").trim() === "" ? t("state.placeholder") : String(session.lastPrompt)),
									),
									h(
										"div",
										{ className: "ssp-sess-side" },
										h("div", { className: "ssp-sess-cost" }, `${symbol}${formatMoney(cost)}`),
										h("div", { className: "ssp-sess-time" }, formatRelative(t, nowMs, session.lastActiveAt)),
									),
									h(
										"div",
										{ className: "ssp-sess-foot" },
										h("span", null, `${formatTokens(tokens)} tokens`),
										h("span", null, t("sessions.turns", { count: Number(session.turns) || 0 })),
										h("span", null, t("sessions.steps", { count: Number(session.steps) || 0 })),
									),
								);
							}),
						),
			);
		}
		//#endregion

		//#region page
		/** The stats layout: the panel's only view. */
		function StatsView(props) {
			const t = typeof props.t === "function" ? props.t : (key) => key;
			// null = follow the host's configured default window (learned from the first response).
			const [windowKey, setWindowKey] = react.useState(null);
			const [currency, setCurrency] = react.useState("CNY");
			const [reloadKey, setReloadKey] = react.useState(0);
			const overview = useOverview(windowKey, reloadKey);
			// The heavy chunk fires together with the overview one: waiting for the
			// fast response first would serialise the two and cost the whole lead time.
			const heavy = useHeavy(windowKey, reloadKey);
			const live = useLive();
			const data = overview.data;
			const totals = data !== null && data.totals ? data.totals : null;
			const effectiveWindow = windowKey ?? (data !== null && data.window && data.window.key ? data.window.key : "7d");
			const symbol = currency === "CNY" ? "¥" : "$";
			const placeholder = t("state.placeholder");
			const usdRate = data !== null && Number(data.currency?.usdRate) > 0 ? Number(data.currency.usdRate) : 7.1;
			// The cost card shows token cost plus flat official-search cost.
			const totalCostOf = (target) => {
				const cny = Number(target.costCNYTotal ?? target.costCNY) || 0;
				return currency === "CNY" ? cny : cny / usdRate;
			};
			const models = data !== null && Array.isArray(data.models) ? data.models : [];
			const otherColor = data !== null && typeof data.otherModelColor === "string" ? data.otherModelColor : "#868e96";
			const otherLabel = t("chart.other");
			const searches = totals === null ? 0 : Number(totals.searches) || 0;
			const searchCost = totals === null ? 0 : Number(totals.searchCostCNY) || 0;
			const unpricedModels = models.filter((model) => model.priceLevel === "unpriced").length;
			const unpricedTokens = models
				.filter((model) => model.priceLevel === "unpriced")
				.reduce((sum, model) => sum + (Number(model.tokens) || 0), 0);
			const loading = data === null && overview.status !== "error";
			// A refetch keeps the previous payload on screen; the progress bar stays
			// up until both chunks have answered for the new window.
			const busy = overview.status === "refreshing" || heavy.status === "refreshing";
			const heavyData = heavy.data;
			const heavyState = heavy.status === "error" ? "error" : heavyData === null || heavyData === undefined ? "loading" : "ready";
			const heatmap = arrayOf(heavyData, "heatmap");
			const toolBoard = arrayOf(heavyData, "toolLeaderboard");
			const commandBoard = arrayOf(heavyData, "commandLeaderboard");
			const skillBoard = arrayOf(heavyData, "skillLeaderboard");
			const sessions = arrayOf(heavyData, "sessions");
			return h(
				"div",
				{ className: "ssp-root", "data-testid": "session-stats-page", "data-loading": loading ? "true" : "false", "data-busy": busy ? "true" : "false" },
				h(ProgressBar, { t, active: busy }),
				h(
					"div",
					{ className: "ssp-page" },
					h(
						"header",
						{ className: "ssp-head" },
						h("h1", { className: "ssp-title" }, t("panel")),
						h(
							"div",
							{ className: "ssp-controls" },
							h(
								"div",
								{ className: "ssp-tabs", role: "tablist", "aria-label": t("window.aria") },
								WINDOW_KEYS.map((key) =>
									h(
										"button",
										{
											key,
											type: "button",
											role: "tab",
											className: "ssp-tab",
											"aria-selected": effectiveWindow === key,
											onClick: () => setWindowKey(key),
										},
										t(`window.${key}`),
									),
								),
							),
							h(
								"div",
								{ className: "ssp-currency", role: "radiogroup", "aria-label": t("currency.aria") },
								h(
									"button",
									{
										type: "button",
										role: "radio",
										className: "ssp-cur",
										"aria-checked": currency === "CNY",
										onClick: () => setCurrency("CNY"),
									},
									t("currency.cny"),
								),
								h("span", { className: "ssp-cur-sep", "aria-hidden": "true" }),
								h(
									"button",
									{
										type: "button",
										role: "radio",
										className: "ssp-cur",
										"aria-checked": currency === "USD",
										onClick: () => setCurrency("USD"),
									},
									t("currency.usd"),
								),
							),
						),
					),
					overview.error === null
						? null
						: h(
								"div",
								{ className: "ssp-error", role: "alert" },
								h("span", { className: "ssp-error-text" }, t("state.error", { message: overview.error })),
								h(
									"button",
									{
										type: "button",
										className: "ssp-retry",
										onClick: () => setReloadKey((value) => value + 1),
									},
									t("state.retry"),
								),
							),
					heavy.error !== null
						? h("div", { className: "ssp-hint", role: "status" }, t("state.heavyStale", { message: heavy.error }))
						: null,
					h(
						"section",
						{ className: "ssp-cards", "aria-label": t("cards.aria") },
						h(StatCard, {
							icon: h(TokensIcon, { size: 14 }),
							title: t("card.tokens"),
							value: totals === null ? placeholder : formatTokens(totals.tokens),
							unit: t("unit.tokens"),
							sub:
								totals === null
									? placeholder
									: t("card.tokens.sub", {
											input: formatTokens(totals.input),
											output: formatTokens(totals.output),
										}),
						}),
						h(StatCard, {
							icon: h(CostIcon, { size: 14 }),
							title: t("card.cost"),
							value: totals === null ? placeholder : `${symbol}${formatMoney(totalCostOf(totals))}`,
							unit: null,
							sub:
								totals === null
									? placeholder
									: searches > 0
										? t("card.cost.sub") +
											" · " +
											t("card.cost.search", {
												count: searches,
												cost: `${symbol}${formatMoney(searchCost)}`,
											})
										: t("card.cost.sub"),
						}),
						h(StatCard, {
							icon: h(SessionsIcon, { size: 14 }),
							title: t("card.sessions"),
							value: totals === null ? placeholder : String(totals.sessions),
							unit: null,
							sub:
								totals === null
									? placeholder
									: t("card.sessions.sub", { avg: formatTokens(totals.avgTokensPerSession) }),
						}),
						h(StatCard, {
							icon: h(CacheIcon, { size: 14 }),
							title: t("card.cache"),
							value: totals === null ? placeholder : formatPercent(totals.cacheHitRate),
							unit: null,
							sub:
								totals === null
									? placeholder
									: t("card.cache.sub", { cacheRead: formatTokens(totals.cacheRead) }),
						}),
					),
					h(TodayBar, { t, data, currency, symbol, usdRate, placeholder }),
					h(LiveCard, { t, live, placeholder }),
					h(
						"section",
						{ className: "ssp-row" },
						h(DailyCard, {
							t,
							data,
							currency,
							symbol,
							placeholder,
							windowKey: effectiveWindow,
							models,
							otherLabel,
							otherColor,
							limit: 6,
							granularity: data !== null && data.window ? data.window.granularity : null,
							usdRate,
						}),
						h(DonutCard, {
							t,
							data,
							currency,
							symbol,
							placeholder,
							models,
							otherLabel,
							otherColor,
							limit: 10,
						}),
						h(CostDonutCard, { t, data, currency, symbol, placeholder }),
					),
					h(ModelDetailCard, {
						t,
						models,
						currency,
						symbol,
						placeholder,
						otherLabel,
						otherColor,
						limit: 10,
						unpricedCount: unpricedModels,
						unpricedTokenTotal: unpricedTokens,
					}),
					h(HeatmapCard, { t, heatmap, state: heavyState }),
					h(
						"section",
						{ className: "ssp-row" },
						h(LeaderboardCard, { t, title: t("rank.tools"), sub: t("rank.sub.tools"), entries: toolBoard, nameKey: "name", state: heavyState, rich: true }),
						h(LeaderboardCard, { t, title: t("rank.commands"), sub: t("rank.sub.commands"), entries: commandBoard, nameKey: "program", state: heavyState }),
						h(LeaderboardCard, { t, title: t("rank.skills"), sub: t("rank.sub.skills"), entries: skillBoard, nameKey: "name", state: heavyState }),
					),
					h(SessionListCard, {
						t,
						sessions,
						state: heavyState,
						generatedAt: heavyData !== null ? heavyData.generatedAt : 0,
						currency,
						symbol,
						rate: usdRate,
					}),
				),
			);
		}
		//#endregion

		/** Panel entry: the stats layout is the panel's only view. */
		function SessionStatsPage(props) {
			return h(StatsView, props);
		}

		//#region plugin
		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-stats: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("main", () =>
				ctx.slots.register(
					{
						name: "main",
						key: PANEL_ID,
						locale: NS,
					},
					SessionStatsPage,
				),
			);
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{
						name: "sidebar.panellist",
						id: PANEL_ID,
						order: -10,
						locale: NS,
						label: () => t("panel"),
					},
					SessionStatsIcon,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
