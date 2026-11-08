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
.ssp-bars{display:flex;align-items:flex-end;gap:10px;height:176px;margin-top:18px}
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
}
@media (prefers-reduced-motion:reduce){
  .ssp-tab,.ssp-cur,.ssp-bar,.ssp-donut-seg{transition:none}
}
/* ---- terminal (行情终端) ---- */
.ssp-term{--up:#DD3538;--down:#0B9D6E;--gold:#B4841A;--grid:#ECF0F6;--axis:#D5DCE7;min-height:100%;padding:20px 22px 16px;background:var(--ssp-bg);color:var(--ssp-text-1)}
body[data-ds-dark-theme] .ssp-term{--up:#FF4D4F;--down:#00C08B;--gold:#F2C14E;--grid:#141A25;--axis:#232C3B}
.ssp-term-page{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.ssp-term-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.ssp-term-title{font-size:22px;font-weight:650;line-height:28px;margin:0}
.ssp-term-sub{display:block;font-size:10px;letter-spacing:.18em;color:var(--ssp-text-3);margin-top:2px}
.ssp-term-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ssp-view-toggle{display:inline-flex;border:1px solid var(--ssp-border);border-radius:999px;padding:2px;background:var(--ssp-hover)}
.ssp-view-btn{border:0;background:transparent;color:var(--ssp-text-3);font-size:11px;line-height:18px;padding:2px 9px;border-radius:999px;cursor:pointer;font-family:inherit}
.ssp-view-btn.ssp-view-active{background:var(--ssp-bg);color:var(--ssp-text-1);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.ssp-index-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
.ssp-index{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--ssp-border);border-radius:12px;background:var(--ssp-bg);cursor:pointer;text-align:left;font-family:inherit}
.ssp-index-active{border-color:var(--gold);box-shadow:inset 0 0 0 1px var(--gold)}
.ssp-index-label{font-size:11px;color:var(--ssp-text-3)}
.ssp-index-row{display:flex;align-items:baseline;gap:4px}
.ssp-index-value{font-size:18px;font-weight:650;font-variant-numeric:tabular-nums}
.ssp-index-unit{font-size:10px;color:var(--ssp-text-3)}
.ssp-term-chg{font-size:11px;font-variant-numeric:tabular-nums}
.ssp-term-chg-up{color:var(--up)}
.ssp-term-chg-down{color:var(--down)}
.ssp-term-chg-flat{color:var(--ssp-text-3)}
.ssp-mini-k{width:100%;height:22px;display:block;margin-top:2px}
.ssp-mini-wick-up{stroke:var(--up);stroke-width:.8;opacity:.8}
.ssp-mini-wick-down{stroke:var(--down);stroke-width:.8;opacity:.8}
.ssp-mini-body-up{fill:var(--up)}
.ssp-mini-body-down{fill:none;stroke:var(--down);stroke-width:.8}
.ssp-instrument{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;padding:2px 2px 0}
.ssp-instrument-name{font-size:13px;color:var(--ssp-text-3)}
.ssp-instrument-price-row{display:flex;align-items:baseline;gap:8px;margin-top:2px}
.ssp-instrument-price{font-size:30px;font-weight:700;line-height:36px;font-variant-numeric:tabular-nums}
.ssp-instrument-unit{font-size:11px;color:var(--ssp-text-3)}
.ssp-instrument-stats{display:flex;gap:18px;flex-wrap:wrap}
.ssp-instrument-stat{display:flex;flex-direction:column;gap:1px}
.ssp-instrument-stat-label{font-size:10px;color:var(--ssp-text-3)}
.ssp-instrument-stat-value{font-size:13px;font-variant-numeric:tabular-nums}
.ssp-term-chart-card{padding:12px 14px 10px}
.ssp-term-chart-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.ssp-term-ohlc{font-size:11px;color:var(--ssp-text-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.ssp-term-chart{position:relative;margin-top:6px}
.ssp-term-chart svg{display:block;width:100%;height:auto}
.ssp-term-grid-line{stroke:var(--grid);stroke-width:1}
.ssp-term-axis-line{stroke:var(--axis);stroke-width:1}
.ssp-term-axis{fill:var(--ssp-text-3);font-size:10px;font-variant-numeric:tabular-nums}
.ssp-term-axis-hot{fill:var(--ssp-text-1)}
.ssp-term-cross{stroke:var(--ssp-text-3);stroke-width:.8;stroke-dasharray:3 3;opacity:.7}
.ssp-candle-wick-up{stroke:var(--up);stroke-width:1}
.ssp-candle-wick-down{stroke:var(--down);stroke-width:1}
.ssp-candle-body.ssp-candle-up{fill:var(--up)}
.ssp-candle-body.ssp-candle-down{fill:none;stroke:var(--down);stroke-width:1}
.ssp-candle-body.ssp-candle-flat{fill:var(--ssp-text-3)}
.ssp-candle-body.ssp-candle-empty{fill:var(--grid)}
.ssp-ma{stroke-width:1.2;opacity:.85;fill:none}
.ssp-ma5{stroke:var(--gold)}
.ssp-ma10{stroke:#4dabf7}
.ssp-ma20{stroke:#9775fa}
.ssp-term-legend{display:flex;gap:12px;align-items:center;font-size:11px;color:var(--ssp-text-3);margin-top:4px;flex-wrap:wrap}
.ssp-term-legend-spacer{flex:1}
.ssp-term-legend-item.ssp-ma5{color:var(--gold)}
.ssp-term-legend-item.ssp-ma10{color:#4dabf7}
.ssp-term-legend-item.ssp-ma20{color:#9775fa}
.ssp-term-tip{position:absolute;top:8px;right:8px;min-width:200px;max-width:280px;background:var(--ssp-bg);border:1px solid var(--ssp-border);border-radius:10px;padding:8px 10px;box-shadow:0 8px 20px rgba(0,0,0,.12);font-size:11px;line-height:17px;z-index:5;pointer-events:none}
.ssp-term-tip-left{right:auto;left:8px}
.ssp-term-tip-head{font-weight:600;margin-bottom:4px}
.ssp-term-tip-grid{display:flex;flex-wrap:wrap;gap:4px 12px;font-variant-numeric:tabular-nums}
.ssp-term-tip-model{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ssp-term-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:14px}
.ssp-watch-list,.ssp-tape-list{display:flex;flex-direction:column;margin-top:8px}
.ssp-watch-row{display:grid;grid-template-columns:58px minmax(0,1fr) 76px 70px 66px 70px;align-items:center;gap:8px;padding:5px 2px;border:0;border-bottom:.5px solid var(--ssp-border);background:transparent;cursor:pointer;text-align:left;font-size:12px;color:var(--ssp-text-2);font-family:inherit}
.ssp-watch-row:last-child{border-bottom:0}
.ssp-watch-active{background:var(--ssp-hover)}
.ssp-watch-code{font-size:11px;color:var(--ssp-text-3);font-variant-numeric:tabular-nums}
.ssp-watch-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssp-watch-price{text-align:right;font-variant-numeric:tabular-nums}
.ssp-watch-cost{text-align:right;color:var(--ssp-text-3);font-variant-numeric:tabular-nums}
.ssp-tape-row{display:grid;grid-template-columns:64px 12px minmax(0,1fr) 70px 70px;align-items:center;gap:6px;padding:4px 2px;font-size:11px;color:var(--ssp-text-2);font-variant-numeric:tabular-nums}
.ssp-tape-time{color:var(--ssp-text-3)}
.ssp-tape-dot{width:7px;height:7px;border-radius:50%}
.ssp-tape-dot-up{background:var(--up)}
.ssp-tape-dot-down{background:var(--down)}
.ssp-tape-dot-search{background:var(--gold)}
.ssp-tape-model{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssp-tape-tokens,.ssp-tape-cost{text-align:right;color:var(--ssp-text-3)}
.ssp-pos-table{display:flex;flex-direction:column;margin-top:10px}
.ssp-pos-row{display:grid;grid-template-columns:62px minmax(160px,1.6fr) 82px 66px minmax(90px,1fr) 90px 78px;align-items:center;gap:10px;padding:6px 2px;border-bottom:.5px solid var(--ssp-border);font-size:12px;color:var(--ssp-text-2)}
.ssp-pos-head{font-size:11px;color:var(--ssp-text-3);border-bottom:.5px solid var(--ssp-border)}
.ssp-pos-code{color:var(--ssp-text-3);font-size:11px}
.ssp-pos-name{display:flex;align-items:center;gap:6px;min-width:0}
.ssp-pos-name .ssp-mini-k{width:64px;margin-left:auto}
.ssp-pos-dot{width:8px;height:8px;border-radius:2px;flex:none}
.ssp-pos-price,.ssp-pos-tokens{text-align:right;font-variant-numeric:tabular-nums}
.ssp-pos-chg{text-align:right}
.ssp-pos-bar{display:block;height:6px;border-radius:3px;background:var(--ssp-hover);overflow:hidden}
.ssp-pos-bar-fill{display:block;height:100%}
.ssp-pos-cost{text-align:right;color:var(--ssp-text-3);font-variant-numeric:tabular-nums}
.ssp-term-status{display:flex;justify-content:space-between;gap:12px;font-size:10px;color:var(--ssp-text-3);border-top:1px solid var(--ssp-border);padding-top:8px;flex-wrap:wrap}
/* --- market tension: motion + structure (no extra copy) --- */
@keyframes ssp-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.82)}}
@keyframes ssp-flash-up{0%{background:color-mix(in srgb,var(--up) 22%,transparent)}100%{background:transparent}}
@keyframes ssp-flash-down{0%{background:color-mix(in srgb,var(--down) 22%,transparent)}100%{background:transparent}}
@keyframes ssp-marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes ssp-sweep{0%{transform:translateY(-100%);opacity:0}35%{opacity:.9}100%{transform:translateY(100%);opacity:0}}
@keyframes ssp-mode-in{0%{opacity:0;transform:translateY(6px) scale(.995)}100%{opacity:1;transform:none}}
.ssp-root{animation:ssp-mode-in .26s cubic-bezier(.22,.61,.36,1)}
.ssp-live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--up);margin-right:5px;animation:ssp-pulse 1.4s ease-in-out infinite;vertical-align:1px}
.ssp-term-ticker{position:relative;overflow:hidden;border:1px solid var(--ssp-border);border-radius:8px;background:linear-gradient(90deg,color-mix(in srgb,var(--up) 6%,transparent),transparent 30%,transparent 70%,color-mix(in srgb,var(--down) 6%,transparent));height:24px;display:flex;align-items:center}
.ssp-term-ticker::before,.ssp-term-ticker::after{content:"";position:absolute;top:0;bottom:0;width:24px;z-index:2;pointer-events:none}
.ssp-term-ticker::before{left:0;background:linear-gradient(90deg,var(--ssp-bg),transparent)}
.ssp-term-ticker::after{right:0;background:linear-gradient(270deg,var(--ssp-bg),transparent)}
.ssp-ticker-track{display:inline-flex;gap:22px;white-space:nowrap;padding-left:12px;animation:ssp-marquee 42s linear infinite;font-size:11px;font-variant-numeric:tabular-nums;color:var(--ssp-text-2)}
.ssp-ticker-item{display:inline-flex;align-items:baseline;gap:5px}
.ssp-ticker-code{color:var(--ssp-text-3);font-size:10px}
.ssp-ticker-up{color:var(--up)}
.ssp-ticker-down{color:var(--down)}
.ssp-index{position:relative;overflow:hidden;transition:border-color .16s,box-shadow .16s,transform .16s}
.ssp-index:hover{transform:translateY(-1px)}
.ssp-index-active::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,color-mix(in srgb,var(--gold) 12%,transparent),transparent 60%);pointer-events:none}
.ssp-index-icon{width:12px;height:12px;flex:none;opacity:.75}
.ssp-index-label{display:flex;align-items:center;gap:4px}
.ssp-instrument-price-flash-up{animation:ssp-flash-up 1.1s ease-out}
.ssp-instrument-price-flash-down{animation:ssp-flash-down 1.1s ease-out}
.ssp-term-last-tag{fill:var(--ssp-bg)}
.ssp-term-last-tag-text{font-size:10px;font-variant-numeric:tabular-nums;font-weight:600}
.ssp-term-chart-card{position:relative;overflow:hidden}
.ssp-term-chart-card::before{content:"";position:absolute;left:0;right:0;top:0;height:36%;background:linear-gradient(180deg,color-mix(in srgb,var(--ssp-text-1) 3%,transparent),transparent);pointer-events:none;animation:ssp-sweep 6.5s ease-in-out infinite}
.ssp-term-grid-line{stroke-dasharray:2 4;opacity:.9}
.ssp-tape-row{transition:background-color .18s}
.ssp-tape-row:hover{background:var(--ssp-hover)}
.ssp-watch-row{transition:background-color .16s,color .16s}
.ssp-pos-row{transition:background-color .16s}
.ssp-pos-row:hover{background:var(--ssp-hover)}
@media (prefers-reduced-motion:reduce){.ssp-root,.ssp-ticker-track,.ssp-live-dot,.ssp-term-chart-card::before{animation:none}.ssp-index:hover{transform:none}}
.ssp-term-chart-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:40px 0;color:var(--ssp-text-3)}
.ssp-term-chart-empty-ring{width:64px;height:64px;border-radius:50%;border:6px solid var(--ssp-border)}
.ssp-term-empty{padding:18px;color:var(--ssp-text-3);font-size:12px}
.ssp-term-error{margin:8px 0;padding:10px 12px;border:1px solid var(--ssp-border);border-radius:10px;background:var(--ssp-hover);font-size:12px;display:flex;gap:12px;align-items:center}
@media (max-width:1100px){.ssp-index-strip{grid-template-columns:repeat(3,minmax(0,1fr))}.ssp-term-grid{grid-template-columns:minmax(0,1fr)}}
@media (max-width:720px){.ssp-index-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.ssp-pos-row{grid-template-columns:52px minmax(0,1fr) 70px 56px 70px}.ssp-pos-share,.ssp-pos-cost{display:none}.ssp-watch-row{grid-template-columns:48px minmax(0,1fr) 60px 60px 56px}.ssp-watch-cost{display:none}}

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
			"panel": "会话统计",
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
			"terminal.sub": "SESSION TERMINAL",
			"chart.bars": "堆叠柱",
			"chart.candles": "蜡烛",
			"chart.title": "行情走势",
			"chart.aria": "行情图",
			"chart.volume": "成交量（调用次数）",
			"chart.stacked": "按模型堆叠",
			"view.aria": "图表形态",
			"mode.aria": "视图模式",
			"mode.stats": "统计",
			"mode.terminal": "K线",
			"priceMode.aria": "价格口径",
			"priceMode.tokens": "tokens/分",
			"priceMode.cost": "¥/分",
			"unit.tokenRate": "tokens/分",
			"unit.costRate": "¥/分",
			"index.aria": "指数",
			"index.tokens": "总消耗",
			"index.cost": "预估成本",
			"index.sessions": "会话数",
			"index.cacheHit": "缓存命中率",
			"index.search": "官方搜索",
			"stats.open": "今开",
			"stats.high": "最高",
			"stats.low": "最低",
			"stats.avg": "均价",
			"stats.amplitude": "振幅",
			"term.open": "开",
			"term.high": "高",
			"term.low": "低",
			"term.close": "收",
			"term.chg": "涨跌",
			"term.total": "总量",
			"term.cost": "花费",
			"term.calls": "调用",
			"term.sessions": "会话",
			"term.hit": "命中",
			"term.priceTable": "官方价目",
			"watch.title": "自选行情",
			"watch.sub": "按模型 · 点击切换主图",
			"watch.all": "全部模型",
			"watch.allPrice": "综合",
			"tape.title": "成交流水",
			"tape.sub": "最近 20 条",
			"tape.empty": "暂无成交",
			"positions.title": "持仓明细",
			"positions.sub": "按 tokens 降序",
			"positions.colCode": "代码",
			"positions.colName": "名称",
			"positions.colPrice": "现价",
			"positions.colChg": "涨跌",
			"positions.colShare": "占比",
			"positions.colCost": "成本",
			"status.data": "行情数据",
			"status.sessions": "个会话",
			"status.sampled": "采样",
			"state.receiving": "正在接收行情数据…",
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
		};
		const en = {
			"panel": "Session stats",
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
			"terminal.sub": "SESSION TERMINAL",
			"chart.bars": "Bars",
			"chart.candles": "Candles",
			"chart.title": "Price action",
			"chart.aria": "Market chart",
			"chart.volume": "Volume (calls)",
			"chart.stacked": "Stacked by model",
			"view.aria": "Chart form",
			"mode.aria": "View mode",
			"mode.stats": "Stats",
			"mode.terminal": "K-line",
			"priceMode.aria": "Price basis",
			"priceMode.tokens": "tokens/min",
			"priceMode.cost": "¥/min",
			"unit.tokenRate": "tokens/min",
			"unit.costRate": "¥/min",
			"index.aria": "Indices",
			"index.tokens": "Total tokens",
			"index.cost": "Est. cost",
			"index.sessions": "Sessions",
			"index.cacheHit": "Cache hit",
			"index.search": "Official search",
			"stats.open": "Open",
			"stats.high": "High",
			"stats.low": "Low",
			"stats.avg": "Avg",
			"stats.amplitude": "Range",
			"term.open": "O",
			"term.high": "H",
			"term.low": "L",
			"term.close": "C",
			"term.chg": "Chg",
			"term.total": "Total",
			"term.cost": "Cost",
			"term.calls": "Calls",
			"term.sessions": "Sessions",
			"term.hit": "Hit",
			"term.priceTable": "Price list",
			"watch.title": "Watchlist",
			"watch.sub": "By model · click to focus",
			"watch.all": "All models",
			"watch.allPrice": "Combined",
			"tape.title": "Time & sales",
			"tape.sub": "Latest 20",
			"tape.empty": "No activity yet",
			"positions.title": "Positions",
			"positions.sub": "Sorted by tokens",
			"positions.colCode": "Code",
			"positions.colName": "Name",
			"positions.colPrice": "Last",
			"positions.colChg": "Chg",
			"positions.colShare": "Share",
			"positions.colCost": "Cost",
			"status.data": "Market data",
			"status.sessions": "sessions",
			"status.sampled": "sampled",
			"state.receiving": "Receiving market data…",
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
		//#endregion

		//#region data hooks
		const OVERVIEW_URL = "/session-stats/api/overview";
		const LIVE_URL = "/session-stats/api/live";

		/** Fetch the window overview; keeps the last good payload while refreshing. */
		function useOverview(windowKey, reloadKey) {
			const [state, setState] = react.useState({ status: "loading", data: null, error: null });
			react.useEffect(() => {
				let alive = true;
				const controller = typeof AbortController === "function" ? new AbortController() : null;
				setState((previous) => ({
					status: previous.data === null ? "loading" : "refreshing",
					data: previous.data,
					error: null,
				}));
				// A null selection asks the host for its configured default window.
				const url =
					windowKey === null || windowKey === undefined
						? OVERVIEW_URL
						: `${OVERVIEW_URL}?window=${encodeURIComponent(windowKey)}`;
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
			}, [windowKey, reloadKey]);
			return state;
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
		/** Sidebar glyph: ascending bars, drawn at the size the sidebar asks for. */
		function SessionStatsIcon({ size }) {
			const edge = typeof size === "number" && size > 0 ? size : 16;
			return h(
				"svg",
				{
					width: edge,
					height: edge,
					viewBox: "0 0 16 16",
					fill: "none",
					"aria-hidden": "true",
					focusable: "false",
				},
				h("path", {
					d: "M3 13.2V9.3M6.33 13.2V5.4M9.66 13.2V7.5M13 13.2V3.4",
					stroke: "currentColor",
					strokeWidth: 1.4,
					strokeLinecap: "round",
				}),
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

		function DailyCard({ t, data, currency, symbol, placeholder, windowKey, models, otherLabel, otherColor, limit }) {
			const daily = data !== null && Array.isArray(data.daily) ? data.daily : [];
			const totals = data !== null && data.totals ? data.totals : null;
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
						h("div", { className: "ssp-card-sub" }, t("daily.sub", { range: t("window." + windowKey) })),
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
					{ className: "ssp-bars", "data-dense": dense ? "true" : "false" },
					bars.length > 0
						? bars
						: Array.from({ length: 7 }, (_, index) =>
								h("div", { className: "ssp-bar-col", key: "empty-" + index }, h("div", { className: "ssp-bar ssp-bar-empty" })),
							),
				),
				h("div", { className: "ssp-axis", "data-dense": dense ? "true" : "false" }, axis),
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

		//#region terminal
		/** Beijing wall-clock HH:mm:ss for tape / status rows. */
		/** Wall-clock HH:mm:ss; offsetMs comes from the host so non-CN viewers see their own day boundaries. */
		function formatClock(timeMs, offsetMs = 8 * 3_600_000) {
			const date = new Date(Number(timeMs) + Number(offsetMs));
			const hh = String(date.getUTCHours()).padStart(2, "0");
			const mm = String(date.getUTCMinutes()).padStart(2, "0");
			const ss = String(date.getUTCSeconds()).padStart(2, "0");
			return `${hh}:${mm}:${ss}`;
		}

		/** Beijing wall-clock MM/DD HH:mm for candle ranges. */
		function formatRange(startMs, periodMs, offsetMs = 8 * 3_600_000) {
			const start = new Date(Number(startMs) + Number(offsetMs));
			const end = new Date(Number(startMs) + Number(periodMs) + Number(offsetMs));
			const pad = (value) => String(value).padStart(2, "0");
			return `${pad(start.getUTCMonth() + 1)}/${pad(start.getUTCDate())} ${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}–${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}`;
		}

		/** Signed percentage badge (red up / green down), or -- when unknown. */
		function ChangeBadge({ t, value, className }) {
			if (value === null || value === undefined || !Number.isFinite(Number(value))) {
				return h("span", { className: "ssp-term-chg ssp-term-chg-flat" }, "--");
			}
			const number = Number(value);
			const flat = Math.abs(number) < 0.0005;
			const up = number > 0;
			const arrow = flat ? "" : up ? "▲ " : "▼ ";
			return h(
				"span",
				{ className: `ssp-term-chg ${flat ? "ssp-term-chg-flat" : up ? "ssp-term-chg-up" : "ssp-term-chg-down"}${className ? " " + className : ""}` },
				`${arrow}${formatPercent(Math.abs(number))}`,
			);
		}

		/** 12-point mini candlestick strip (pure SVG, no axes). */
		function MiniK({ values, className }) {
			const list = Array.isArray(values) && values.length > 0 ? values : [0, 0];
			const width = 72;
			const height = 22;
			const max = Math.max(...list.map((value) => Number(value) || 0), 1);
			const step = width / list.length;
			const nodes = [];
			for (let index = 0; index < list.length; index += 1) {
				const value = Number(list[index]) || 0;
				const previous = index === 0 ? value : Number(list[index - 1]) || 0;
				const up = value >= previous;
				const x = index * step + step / 2;
				const bodyTop = height - (Math.max(value, previous) / max) * (height - 4) - 2;
				const bodyBottom = height - (Math.min(value, previous) / max) * (height - 4) - 2;
				const bodyHeight = Math.max(1, bodyBottom - bodyTop);
				nodes.push(h("line", { key: `w${index}`, x1: x, x2: x, y1: 2, y2: height - 1, className: up ? "ssp-mini-wick-up" : "ssp-mini-wick-down" }));
				nodes.push(h("rect", { key: `b${index}`, x: x - Math.max(1, step * 0.3), y: bodyTop, width: Math.max(1.5, step * 0.6), height: bodyHeight, className: up ? "ssp-mini-body-up" : "ssp-mini-body-down", rx: 0.5 }));
			}
			return h("svg", { className: `ssp-mini-k${className ? " " + className : ""}`, viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" }, nodes);
		}

		/** One index strip cell: label, value, change badge, mini K. */
		/** Scrolling quote tape: the "market is alive" cue, built from data rather than copy. */
		function Ticker({ t, indices, symbols, totalTokens }) {
			const items = [];
			for (const item of indices) {
				const value = item.key === "cacheHit" ? formatPercent(item.value) : item.key === "cost" ? `¥${formatMoney(item.value)}` : formatTokens(item.value);
				items.push({ code: t(`index.${item.key}`, { defaultValue: item.label }), value, chg: item.chgPct, up: (Number(item.chgPct) || 0) >= 0 });
			}
			for (const symbol of symbols.slice(0, 8)) {
				items.push({ code: symbol.code, value: formatTokens(symbol.rate), chg: symbol.chgPct, up: (Number(symbol.chgPct) || 0) >= 0 });
			}
			items.push({ code: "VOL", value: formatTokens(totalTokens), chg: null, up: true });
			if (items.length === 0) return null;
			const row = (item, key) =>
				h(
					"span",
					{ className: "ssp-ticker-item", key },
					h("span", { className: "ssp-ticker-code" }, item.code),
					h("span", null, item.value),
					item.chg === null || item.chg === undefined ? null : h("span", { className: item.up ? "ssp-ticker-up" : "ssp-ticker-down" }, `${item.up ? "▲" : "▼"}${Math.abs(Number(item.chg) * 100).toFixed(1)}%`),
				);
			return h(
				"div",
				{ className: "ssp-term-ticker", "aria-hidden": "true" },
				h("div", { className: "ssp-ticker-track" }, [...items.map((item, index) => row(item, "a" + index)), ...items.map((item, index) => row(item, "b" + index))]),
			);
		}

		/** Tiny market glyphs: bars for volume, curve for price, dots for sessions, ring for cache, magnifier for search. */
		function IndexIcon({ kind }) {
			const stroke = { stroke: "currentColor", strokeWidth: 1.2, fill: "none", strokeLinejoin: "round", strokeLinecap: "round" };
			const glyphs = {
				tokens: h("g", null, h("path", { d: "M1 6h2v3H1zM4.5 3h2v6h-2zM8 5h2v4H8zM11.5 1.5h2v7.5h-2z", fill: "currentColor", stroke: "none" })),
				cost: h("g", null, h("path", { d: "M2 4.5 8 1.5l6 3-6 3-6-3Z", ...stroke }), h("path", { d: "M2 8l6 3 6-3M2 11l6 3 6-3", ...stroke })),
				sessions: h("g", null, h("circle", { cx: 5, cy: 5, r: 2.2, ...stroke }), h("path", { d: "M1.5 13c0-2 1.6-3.2 3.5-3.2S8.5 11 8.5 13", ...stroke }), h("path", { d: "M10 4.2a2 2 0 0 1 0 3.6M11.6 10.4c1.2.3 2 1.3 2 2.6", ...stroke })),
				cacheHit: h("g", null, h("circle", { cx: 8, cy: 8, r: 5.4, ...stroke }), h("path", { d: "M8 4.6V8l2.4 1.6", ...stroke })),
				search: h("g", null, h("circle", { cx: 7, cy: 7, r: 3.6, ...stroke }), h("path", { d: "M9.6 9.6 13.2 13.2", ...stroke })),
			};
			return h("svg", { className: "ssp-index-icon", viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" }, glyphs[kind] ?? glyphs.tokens);
		}

		function IndexCell({ t, item, selected, onSelect }) {
			const value = item.key === "cacheHit" ? formatPercent(item.value) : item.key === "cost" ? `¥${formatMoney(item.value)}` : formatTokens(item.value);
			const unit = item.key === "cacheHit" ? "" : item.unit === "tokens" ? "tokens" : item.unit === "¥" ? "" : item.unit;
			return h(
				"button",
				{
					type: "button",
					className: `ssp-index${selected ? " ssp-index-active" : ""}`,
					onClick: () => onSelect(item.key),
					"aria-pressed": selected ? "true" : "false",
				},
				h("span", { className: "ssp-index-label" }, h(IndexIcon, { kind: item.key }), t(`index.${item.key}`, { defaultValue: item.label })),
				h(
					"span",
					{ className: "ssp-index-row" },
					h("span", { className: "ssp-index-value" }, value),
					unit === "" ? null : h("span", { className: "ssp-index-unit" }, unit),
				),
				h(ChangeBadge, { t, value: item.chgPct }),
				h(MiniK, { values: item.spark }),
			);
		}

		/** Instrument header: current rate, change, and the five summary stats. */
		function InstrumentHeader({ t, title, unit, price, chgPct, stats }) {
			return h(
				"section",
				{ className: "ssp-instrument" },
				h(
					"div",
					{ className: "ssp-instrument-main" },
					h("div", { className: "ssp-instrument-name" }, title),
					h(
						"div",
						{ className: "ssp-instrument-price-row" },
						h("span", { className: "ssp-instrument-price" }, price),
						h("span", { className: "ssp-instrument-unit" }, unit),
						h(ChangeBadge, { t, value: chgPct, className: "ssp-instrument-chg" }),
					),
				),
				h(
					"div",
					{ className: "ssp-instrument-stats" },
					stats.map((stat) =>
						h(
							"div",
							{ className: "ssp-instrument-stat", key: stat.key },
							h("span", { className: "ssp-instrument-stat-label" }, t(`stats.${stat.key}`)),
							h("span", { className: "ssp-instrument-stat-value" }, stat.value),
						),
					),
				),
			);
		}

		/**
		 * Merge consecutive buckets so a bar series fits the available width.
		 *
		 * Bar mode is a magnitude comparison, so a period that was merged must add
		 * its tokens/calls up rather than discard them; candles keep the raw
		 * buckets because OHLC would lose meaning under merging.
		 * @param {object[]} bars - raw candle buckets.
		 * @param {number} target - approximate number of bars to keep.
		 * @returns {object[]} merged buckets.
		 */
		function mergeBars(bars, target) {
			const list = Array.isArray(bars) ? bars : [];
			if (list.length <= target || target < 1) return list;
			const groupSize = Math.ceil(list.length / target);
			const out = [];
			for (let index = 0; index < list.length; index += groupSize) {
				const group = list.slice(index, index + groupSize);
				const merged = { t: group[0].t, tokens: 0, costCNY: 0, calls: 0, sessions: 0, vol: 0, empty: true, byModel: [] };
				const byModel = new Map();
				let tokenSum = 0;
				let cacheWeighted = 0;
				for (const bar of group) {
					const tokens = Number(bar.tokens) || 0;
					merged.tokens += tokens;
					merged.costCNY += Number(bar.costCNY) || 0;
					merged.calls += Number(bar.calls) || 0;
					merged.sessions += Number(bar.sessions) || 0;
					merged.vol += Number(bar.vol) || 0;
					tokenSum += tokens;
					cacheWeighted += (Number(bar.cacheHit) || 0) * tokens;
					if (!bar.empty) merged.empty = false;
					for (const segment of Array.isArray(bar.byModel) ? bar.byModel : []) {
						byModel.set(segment.route, (byModel.get(segment.route) ?? 0) + (Number(segment.tokens) || 0));
					}
				}
				merged.byModel = [...byModel].map(([route, tokens]) => ({ route, tokens })).sort((a, b) => b.tokens - a.tokens);
				merged.cacheHit = tokenSum > 0 ? cacheWeighted / tokenSum : 0;
				merged.o = merged.tokens;
				merged.h = merged.tokens;
				merged.l = merged.tokens;
				merged.c = merged.tokens;
				out.push(merged);
			}
			return out;
		}

		/**
		 * Merge consecutive buckets into real OHLC candles.
		 *
		 * Merging must preserve candle semantics: open is the group's first open,
		 * close is the group's last close, high/low are the extremes. Empty buckets
		 * are dropped instead of being carried forward at the previous close, which
		 * is what turned long quiet stretches into flat plateaus.
		 * @param {object[]} bars - raw buckets (may contain empty ones).
		 * @param {number} target - approximate candle count to keep.
		 * @returns {object[]} merged candles.
		 */
		function mergeCandles(bars, target) {
			const source = Array.isArray(bars) ? bars : [];
			if (source.length === 0) return [];
			if (source.length <= target || target < 1) return source;
			// Group by wall clock, not by "how many non-empty bars are left": the
			// x axis must stay linear in time, so a quiet stretch keeps its slot.
			const groupSize = Math.max(1, Math.ceil(source.length / target));
			const out = [];
			for (let index = 0; index < source.length; index += groupSize) {
				const group = source.slice(index, index + groupSize);
				const active = group.filter((bar) => !bar.empty);
				if (active.length === 0) {
					out.push({ t: group[0].t, o: 0, h: 0, l: 0, c: 0, tokens: 0, costCNY: 0, calls: 0, sessions: 0, vol: 0, cacheHit: 0, byModel: [], empty: true });
					continue;
				}
				const live = active;
				const byModel = new Map();
				let tokens = 0;
				let costCNY = 0;
				let calls = 0;
				let sessions = 0;
				let cacheWeighted = 0;
				let high = -Infinity;
				let low = Infinity;
				for (const bar of live) {
					high = Math.max(high, Number(bar.h) || 0);
					low = Math.min(low, Number(bar.l) || 0);
					tokens += Number(bar.tokens) || 0;
					costCNY += Number(bar.costCNY) || 0;
					calls += Number(bar.calls) || 0;
					sessions += Number(bar.sessions) || 0;
					cacheWeighted += (Number(bar.cacheHit) || 0) * (Number(bar.tokens) || 0);
					for (const segment of Array.isArray(bar.byModel) ? bar.byModel : []) {
						byModel.set(segment.route, (byModel.get(segment.route) ?? 0) + (Number(segment.tokens) || 0));
					}
				}
				out.push({
					t: group[0].t,
					o: Number(live[0].o) || 0,
					h: high === -Infinity ? 0 : high,
					l: low === Infinity ? 0 : low,
					c: Number(live[live.length - 1].c) || 0,
					tokens,
					costCNY,
					calls,
					sessions,
					vol: calls,
					cacheHit: tokens > 0 ? cacheWeighted / tokens : 0,
					byModel: [...byModel].map(([route, value]) => ({ route, tokens: value })).sort((a, b) => b.tokens - a.tokens),
					empty: false,
				});
			}
			return out;
		}

		/** Main chart: candlesticks or stacked bars + MA lines + volume + crosshair. */
		function TerminalChart({ t, bars, view, priceMode, period, periodMs, models, hover, onHover, placeholder, offsetMs = 8 * 3_600_000 }) {
			const list = Array.isArray(bars) ? bars : [];
			const width = 1000;
			const height = 420;
			const left = 8;
			const right = 72;
			const priceTop = 10;
			const priceBottom = 300;
			const volumeTop = 322;
			const volumeBottom = 404;
			const plotWidth = width - left - right;
			if (list.length === 0) {
				return h(
					"div",
					{ className: "ssp-term-chart-empty" },
					h("div", { className: "ssp-term-chart-empty-ring" }),
					h("div", { className: "ssp-card-sub" }, placeholder),
				);
			}
			const colorByRoute = new Map((Array.isArray(models) ? models : []).map((model) => [model.route, model.color]));
			const isBars = view === "bars";
			const priced = list.map((bar) => {
				const factor = priceMode === "cost" && bar.tokens > 0 ? bar.costCNY / bar.tokens : 1;
				return { ...bar, o: bar.o * factor, h: bar.h * factor, l: bar.l * factor, c: bar.c * factor };
			});
			const lows = priced.map((bar) => bar.l).filter((value) => Number.isFinite(value));
			const highs = priced.map((bar) => bar.h).filter((value) => Number.isFinite(value));
			const rawMin = lows.length > 0 ? Math.min(...lows) : 0;
			const rawMax = highs.length > 0 ? Math.max(...highs) : 1;
			const pad = Math.max((rawMax - rawMin) * 0.08, rawMax === 0 ? 1 : rawMax * 0.02);
			const min = rawMin - pad;
			const max = rawMax + pad;
			const scaleY = (value) => priceBottom - ((value - min) / (max - min || 1)) * (priceBottom - priceTop);
			const barWidth = plotWidth / list.length;
			const bodyWidth = Math.max(0.8, Math.min(barWidth * 0.62, 14));
			// Bar height must be comparable across the whole chart: scale every bar
			// against the busiest one. Normalising each bar to its own total would
			// make every bar equally tall, which is what made the chart unreadable.
			// Bars are bucket totals; plot them per minute so the axis matches the
			// header's "tokens/min" unit instead of a mixed magnitude.
			const minutesPerBar = Math.max(1, Number(periodMs) / 60_000);
			const priceValueOf = (bar) =>
				priceMode === "cost" ? (Number(bar.costCNY) || 0) / minutesPerBar : (Number(bar.tokens) || 0) / minutesPerBar;
			let maxBarValue = 0;
			for (const bar of list) {
				if (bar.empty) continue;
				const value = priceValueOf(bar);
				if (value > maxBarValue) maxBarValue = value;
			}
			if (!(maxBarValue > 0)) maxBarValue = 1;
			const wickUp = [];
			const wickDown = [];
			const bodies = [];
			const volume = [];
			const maxVolume = Math.max(1, ...list.map((bar) => bar.vol || 0));
			const volumeScale = (value) => volumeBottom - (value / maxVolume) * (volumeBottom - volumeTop);
			const colors = [];
			for (let index = 0; index < list.length; index += 1) {
				const bar = priced[index];
				const raw = list[index];
				const x = left + index * barWidth + barWidth / 2;
				if (isBars) {
					if (raw.empty) {
						// A quiet period is a hairline on the baseline, not a full-height block.
						bodies.push(h("rect", { key: `b${index}-empty`, className: "ssp-term-bar-empty", x: (x - bodyWidth / 2).toFixed(2), y: (priceBottom - 2).toFixed(2), width: bodyWidth.toFixed(2), height: 2, fill: "var(--ssp-text-3)", opacity: 0.18 }));
						continue;
					}
					const segments = Array.isArray(raw.byModel) && raw.byModel.length > 0 ? raw.byModel : raw.tokens > 0 ? [{ route: "__all", tokens: raw.tokens }] : [];
					const totalTokens = segments.reduce((sum, segment) => sum + (Number(segment.tokens) || 0), 0) || 1;
					// Absolute height for this bar, then split it across models.
					const barHeight = Math.max(1, (priceValueOf(raw) / maxBarValue) * (priceBottom - priceTop));
					let cursor = priceBottom;
					for (const segment of segments) {
						const share = (Number(segment.tokens) || 0) / totalTokens;
						const height = share * barHeight;
						if (height <= 0) continue;
						cursor -= height;
						const color = segment.route === "__all" ? "var(--ssp-text-3)" : colorByRoute.get(segment.route) ?? "var(--ssp-text-3)";
						bodies.push(h("rect", { key: `b${index}-${segment.route}`, className: "ssp-term-bar", x: (x - bodyWidth / 2).toFixed(2), y: cursor.toFixed(2), width: bodyWidth.toFixed(2), height: Math.max(0.5, height).toFixed(2), fill: color, opacity: 0.85, shapeRendering: "crispEdges" }));
					}
					// Volume subchart is shared by both forms (calls per period).
					let volumeCursor = volumeBottom;
					for (const segment of segments) {
						const share = (Number(segment.tokens) || 0) / totalTokens;
						const segmentHeight = share * (volumeBottom - volumeTop) * ((Number(raw.vol) || 0) / maxVolume);
						if (segmentHeight <= 0) continue;
						volumeCursor -= segmentHeight;
						const color = segment.route === "__all" ? "var(--ssp-text-3)" : colorByRoute.get(segment.route) ?? "var(--ssp-text-3)";
						volume.push(h("rect", { key: `v${index}-${segment.route}`, x: (x - bodyWidth / 2).toFixed(2), y: volumeCursor.toFixed(2), width: bodyWidth.toFixed(2), height: Math.max(0.5, segmentHeight).toFixed(2), fill: color, opacity: 0.55 }));
					}
					continue;
				}
				const up = bar.c >= bar.o;
				const flat = !raw.empty && Math.abs(bar.c - bar.o) < 1e-9;
				const top = scaleY(Math.max(bar.o, bar.c));
				const bottom = scaleY(Math.min(bar.o, bar.c));
				const bodyHeight = Math.max(1, bottom - top);
				const className = raw.empty ? "ssp-candle-body ssp-candle-empty" : flat ? "ssp-candle-body ssp-candle-flat" : up ? "ssp-candle-body ssp-candle-up" : "ssp-candle-body ssp-candle-down";
				const wickClass = flat ? "ssp-candle-wick-flat" : up ? "ssp-candle-wick-up" : "ssp-candle-wick-down";
				if (!raw.empty) {
					const path = `M${x.toFixed(2)} ${scaleY(bar.h).toFixed(2)}L${x.toFixed(2)} ${scaleY(bar.l).toFixed(2)}`;
					(up ? wickUp : wickDown).push(path);
				}
				bodies.push(
					h("rect", {
						key: `b${index}`,
						x: (x - bodyWidth / 2).toFixed(2),
						y: top.toFixed(2),
						width: bodyWidth.toFixed(2),
						height: bodyHeight.toFixed(2),
						className,
						shapeRendering: "crispEdges",
					}),
				);
				// Volume: stacked by model when available, otherwise a single grey bar.
				let cursor = volumeBottom;
				const segments = Array.isArray(raw.byModel) && raw.byModel.length > 0 ? raw.byModel : raw.tokens > 0 ? [{ route: "__all", tokens: raw.tokens }] : [];
				const totalTokens = segments.reduce((sum, segment) => sum + (Number(segment.tokens) || 0), 0) || 1;
				for (const segment of segments) {
					const share = (Number(segment.tokens) || 0) / totalTokens;
					const segmentHeight = share * (volumeBottom - volumeTop) * ((Number(raw.vol) || 0) / maxVolume);
					if (segmentHeight <= 0) continue;
					cursor -= segmentHeight;
					const color = segment.route === "__all" ? "var(--ssp-text-3)" : colorByRoute.get(segment.route) ?? "var(--ssp-text-3)";
					volume.push(h("rect", { key: `v${index}-${segment.route}`, x: (x - bodyWidth / 2).toFixed(2), y: cursor.toFixed(2), width: bodyWidth.toFixed(2), height: Math.max(0.5, segmentHeight).toFixed(2), fill: color, opacity: 0.55 }));
				}
				colors.push(raw.empty);
			}
			// Moving averages over closes.
			// Moving average must break across quiet stretches: joining them draws a
			// line through periods that had no activity at all.
			const ma = (window) => {
				const segments = [];
				let points = [];
				for (let index = 0; index < priced.length; index += 1) {
					if (priced[index].empty) {
						if (points.length > 1) segments.push(points.join("L"));
						points = [];
						continue;
					}
					if (index < window - 1) continue;
					let sum = 0;
					let count = 0;
					for (let cursor = index - window + 1; cursor <= index; cursor += 1) {
						if (priced[cursor].empty) continue;
						sum += priced[cursor].c;
						count += 1;
					}
					if (count === 0) continue;
					points.push(`${(left + index * barWidth + barWidth / 2).toFixed(2)},${scaleY(sum / count).toFixed(2)}`);
				}
				if (points.length > 1) segments.push(points.join("L"));
				return segments.length > 0 ? segments.map((segment) => `M${segment}`).join(" ") : "";
			};
			const ma5 = isBars ? "" : ma(5);
			const ma10 = isBars ? "" : ma(10);
			const ma20 = isBars ? "" : ma(20);
			const last = priced[priced.length - 1];
			const maValue = (window) => {
				if (priced.length < window) return null;
				let sum = 0;
				for (let index = priced.length - window; index < priced.length; index += 1) sum += priced[index].c;
				return sum / window;
			};
			const hoverBar = hover >= 0 && hover < list.length ? list[hover] : null;
			const hoverPriced = hover >= 0 && hover < priced.length ? priced[hover] : null;
			// Bar mode plots absolute totals, so its axis must follow the same scale
			// as the bars (0 → busiest period) instead of the candle price range.
			const priceTicks = isBars
				? [
						{ value: 0, y: priceBottom },
						{ value: maxBarValue / 2, y: (priceBottom + priceTop) / 2 },
						{ value: maxBarValue, y: priceTop },
					]
				: [0, 0.5, 1].map((fraction) => {
						const value = min + (max - min) * fraction;
						return { value, y: scaleY(value) };
					});
			const timeTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
				const index = Math.min(list.length - 1, Math.round(fraction * (list.length - 1)));
				return { index, label: formatClock(list[index].t, offsetMs).slice(0, 5) };
			});
			const priceFormat = (value) => (priceMode === "cost" ? `¥${formatMoney(value)}` : formatTokens(value));
			const changeOf = (index) => {
				if (index <= 0) return null;
				const previous = priced[index - 1].c;
				return previous > 0 ? (priced[index].c - previous) / previous : null;
			};
			const onMove = (event) => {
				const rect = event.currentTarget.getBoundingClientRect();
				const x = event.clientX - rect.left;
				const index = Math.round(((x / rect.width) * width - left) / barWidth - 0.5);
				onHover(index >= 0 && index < list.length ? index : -1);
			};
			const tooltip = hoverBar === null ? null : h(
				"div",
				{ className: `ssp-term-tip${hover > list.length * 0.62 ? " ssp-term-tip-left" : ""}` },
				h("div", { className: "ssp-term-tip-head" }, `${formatRange(hoverBar.t, periodMs, offsetMs)} · ${period}`),
				h("div", { className: "ssp-term-tip-grid" },
					h("span", null, `${t("term.open")} ${priceFormat(hoverPriced.o)}`),
					h("span", null, `${t("term.high")} ${priceFormat(hoverPriced.h)}`),
					h("span", null, `${t("term.low")} ${priceFormat(hoverPriced.l)}`),
					h("span", null, `${t("term.close")} ${priceFormat(hoverPriced.c)}`),
				),
				h("div", { className: "ssp-term-tip-grid" },
					h("span", null, `${t("term.chg")} `, h(ChangeBadge, { t, value: changeOf(hover) })),
					h("span", null, `${t("term.total")} ${formatTokens(hoverBar.tokens)}`),
					h("span", null, `${t("term.cost")} ¥${formatMoney(hoverBar.costCNY)}`),
					h("span", null, `${t("term.calls")} ${hoverBar.calls}`),
				),
				h("div", { className: "ssp-term-tip-grid" },
					h("span", null, `${t("term.sessions")} ${hoverBar.sessions}`),
					h("span", null, `${t("term.hit")} ${formatPercent(hoverBar.cacheHit)}`),
					h("span", { className: "ssp-term-tip-model" }, `Top ${hoverBar.byModel[0] ? (models.find((model) => model.route === hoverBar.byModel[0].route)?.label ?? hoverBar.byModel[0].route) : "--"}`),
				),
			);
			return h(
				"div",
				{ className: "ssp-term-chart", onMouseMove: onMove, onMouseLeave: () => onHover(-1) },
				h(
					"svg",
					{ viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": t("chart.aria") },
					h("defs", null, h("pattern", { id: "ssp-hatch", width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, h("rect", { width: 1, height: 4, fill: "var(--ssp-text-3)", opacity: 0.18 }))),
					priceTicks.map((tick, index) => h("line", { key: `g${index}`, x1: left, x2: width - right, y1: tick.y, y2: tick.y, className: "ssp-term-grid-line" })),
					priceTicks.map((tick, index) => h("text", { key: `p${index}`, x: width - right + 8, y: tick.y + 4, className: "ssp-term-axis" }, priceFormat(tick.value))),
					h("path", { d: wickUp.join(""), className: "ssp-candle-wick-up", fill: "none" }),
					h("path", { d: wickDown.join(""), className: "ssp-candle-wick-down", fill: "none" }),
					bodies,
					ma5 === "" ? null : h("path", { d: ma5, className: "ssp-ma ssp-ma5", fill: "none" }),
					ma10 === "" ? null : h("path", { d: ma10, className: "ssp-ma ssp-ma10", fill: "none" }),
					ma20 === "" ? null : h("path", { d: ma20, className: "ssp-ma ssp-ma20", fill: "none" }),
					h("line", { x1: left, x2: width - right, y1: volumeTop, y2: volumeTop, className: "ssp-term-axis-line" }),
					volume,
					h("line", { x1: left, x2: width - right, y1: volumeBottom, y2: volumeBottom, className: "ssp-term-axis-line" }),
					timeTicks.map((tick) => h("text", { key: `t${tick.index}`, x: left + tick.index * barWidth + barWidth / 2, y: height - 6, className: "ssp-term-axis ssp-term-axis-time", textAnchor: "middle" }, tick.label)),
					hoverPriced === null ? null : h("line", { x1: left + hover * barWidth + barWidth / 2, x2: left + hover * barWidth + barWidth / 2, y1: priceTop, y2: volumeBottom, className: "ssp-term-cross" }),
					hoverPriced === null ? null : h("line", { x1: left, x2: width - right, y1: scaleY(hoverPriced.c), y2: scaleY(hoverPriced.c), className: "ssp-term-cross" }),
					hoverPriced === null
						? h("g", null,
							h("rect", { x: width - right + 4, y: scaleY(last.c) - 8, width: right - 8, height: 16, rx: 3, className: "ssp-term-last-tag" }),
							h("text", { x: width - right + 8, y: scaleY(last.c) + 4, className: "ssp-term-axis ssp-term-last-tag-text", fill: last.c >= last.o ? "var(--up)" : "var(--down)" }, priceFormat(last.c)),
						)
						: h("text", { x: width - right + 8, y: scaleY(hoverPriced.c) + 4, className: "ssp-term-axis ssp-term-axis-hot" }, priceFormat(hoverPriced.c)),
					hoverBar === null ? null : h("text", { x: left + hover * barWidth + barWidth / 2, y: height - 6, className: "ssp-term-axis ssp-term-axis-hot", textAnchor: "middle" }, formatClock(hoverBar.t, offsetMs).slice(0, 5)),
					list.map((bar, index) =>
						h("rect", { key: `hit${index}`, x: left + index * barWidth, y: priceTop, width: barWidth, height: volumeBottom - priceTop, fill: "transparent", "aria-label": `${formatRange(bar.t, periodMs, offsetMs)} O${priceFormat(bar.o)} H${priceFormat(bar.h)} L${priceFormat(bar.l)} C${priceFormat(bar.c)} vol ${bar.vol}` }),
					),
				),
				h("div", { className: "ssp-term-legend" },
					isBars
						? h("span", { className: "ssp-term-legend-item" }, t("chart.stacked"))
						: [
								h("span", { className: "ssp-term-legend-item ssp-ma5", key: "ma5" }, `MA5 ${maValue(5) === null ? "--" : priceFormat(maValue(5))}`),
								h("span", { className: "ssp-term-legend-item ssp-ma10", key: "ma10" }, `MA10 ${maValue(10) === null ? "--" : priceFormat(maValue(10))}`),
								h("span", { className: "ssp-term-legend-item ssp-ma20", key: "ma20" }, `MA20 ${maValue(20) === null ? "--" : priceFormat(maValue(20))}`),
							],
					h("span", { className: "ssp-term-legend-spacer" }),
					h("span", { className: "ssp-term-legend-item ssp-term-legend-vol" }, t("chart.volume")),
				),
				tooltip,
			);
		}

		/** Watchlist (models) with mini K, current rate, change, cost. */
		function Watchlist({ t, symbols, selected, onSelect, currency, symbolText }) {
			return h(
				"section",
				{ className: "ssp-card ssp-watch" },
				h("div", { className: "ssp-card-head" }, h("div", null, h("div", { className: "ssp-card-title" }, t("watch.title")), h("div", { className: "ssp-card-sub" }, t("watch.sub")))),
				h(
					"div",
					{ className: "ssp-watch-list" },
					h(
						"button",
						{ type: "button", className: `ssp-watch-row${selected === "ALL" ? " ssp-watch-active" : ""}`, onClick: () => onSelect("ALL") },
						h("span", { className: "ssp-watch-code" }, "ALL"),
						h("span", { className: "ssp-watch-name" }, t("watch.all")),
						h("span", { className: "ssp-watch-spark" }),
						h("span", { className: "ssp-watch-price" }, t("watch.allPrice")),
						h("span", { className: "ssp-watch-chg" }, ""),
						h("span", { className: "ssp-watch-cost" }, ""),
					),
					symbols.map((item) =>
						h(
							"button",
							{ type: "button", className: `ssp-watch-row${selected === item.route ? " ssp-watch-active" : ""}`, key: item.route, onClick: () => onSelect(item.route) },
							h("span", { className: "ssp-watch-code" }, item.code),
							h("span", { className: "ssp-watch-name", title: item.name }, item.name),
							h(MiniK, { values: item.spark }),
							h("span", { className: "ssp-watch-price" }, formatTokens(item.rate)),
							h(ChangeBadge, { t, value: item.chgPct }),
							h("span", { className: "ssp-watch-cost" }, item.unpriced ? t("models.unpriced") : `${symbolText}${formatMoney(item.costCNY)}`),
						),
					),
				),
			);
		}

		/** Recent activity tape: chat + official search rows. */
		function Tape({ t, tape, currency, symbolText, rate, offsetMs = 8 * 3_600_000 }) {
			return h(
				"section",
				{ className: "ssp-card ssp-tape" },
				h("div", { className: "ssp-card-head" }, h("div", null, h("div", { className: "ssp-card-title" }, t("tape.title")), h("div", { className: "ssp-card-sub" }, t("tape.sub")))),
				h(
					"div",
					{ className: "ssp-tape-list" },
					tape.length === 0
						? h("div", { className: "ssp-card-sub" }, t("tape.empty"))
						: tape.map((entry, index) =>
								h(
									"div",
									{ className: "ssp-tape-row", key: `${entry.t}-${index}` },
									h("span", { className: "ssp-tape-time" }, formatClock(entry.t, offsetMs)),
									h("span", { className: `ssp-tape-dot ${entry.kind === "search" ? "ssp-tape-dot-search" : entry.costCNY > 0 ? "ssp-tape-dot-up" : "ssp-tape-dot-down"}` }),
									h("span", { className: "ssp-tape-model" }, entry.kind === "search" ? `SEARCH · ${t("models.search")}` : entry.model),
									h("span", { className: "ssp-tape-tokens" }, entry.kind === "search" ? "--" : formatTokens(entry.tokens)),
									h("span", { className: "ssp-tape-cost" }, `${symbolText}${formatMoney(currency === "CNY" ? entry.costCNY : entry.costCNY / (Number(rate) > 0 ? Number(rate) : 7.1))}`),
								),
							),
				),
			);
		}

		/** Positions table: code / name + mini K / price / change / share / tokens / cost. */
		function Positions({ t, symbols, totals, currency, symbolText, models }) {
			const totalTokens = totals === null ? 0 : Number(totals.tokens) || 0;
			return h(
				"section",
				{ className: "ssp-card ssp-positions" },
				h("div", { className: "ssp-card-head" }, h("div", null, h("div", { className: "ssp-card-title" }, t("positions.title")), h("div", { className: "ssp-card-sub" }, t("positions.sub")))),
				h(
					"div",
					{ className: "ssp-pos-table" },
					h(
						"div",
						{ className: "ssp-pos-row ssp-pos-head" },
						h("span", null, t("positions.colCode")),
						h("span", null, t("positions.colName")),
						h("span", null, t("positions.colPrice")),
						h("span", null, t("positions.colChg")),
						h("span", null, t("positions.colShare")),
						h("span", null, "tokens"),
						h("span", null, t("positions.colCost")),
					),
					symbols.map((item) => {
						const share = totalTokens > 0 ? item.tokens / totalTokens : 0;
						return h(
							"div",
							{ className: "ssp-pos-row", key: item.route },
							h("span", { className: "ssp-pos-code" }, item.code),
							h(
								"span",
								{ className: "ssp-pos-name" },
								h(ColorChip, { color: item.color, className: "ssp-pos-dot" }),
								h("span", { title: item.name }, item.name),
								h(MiniK, { values: item.spark }),
							),
							h("span", { className: "ssp-pos-price" }, formatTokens(item.rate)),
							h(ChangeBadge, { t, value: item.unpriced ? null : item.chgPct }),
							h("span", { className: "ssp-pos-share" }, h("span", { className: "ssp-pos-bar" }, h("span", { className: "ssp-pos-bar-fill", style: { width: `${Math.max(1, share * 100).toFixed(1)}%`, background: item.color } }))),
							h("span", { className: "ssp-pos-tokens" }, formatTokens(item.tokens)),
							h("span", { className: "ssp-pos-cost" }, item.unpriced ? t("models.unpriced") : `${symbolText}${formatMoney(item.costCNY)}`),
						);
					}),
				),
			);
		}

		/** K-line terminal view (the playful one): quote header, index strip, chart, watchlist, tape, positions. */
		function TerminalView(props) {
			const { mode, onModeChange } = props;
			const t = typeof props.t === "function" ? props.t : (key) => key;
			const [windowKey, setWindowKey] = react.useState(null);
			const [currency, setCurrency] = react.useState("CNY");
			const [view, setView] = react.useState(() => {
				try {
					return window.localStorage.getItem("dsh-session-stats:chart") === "candles" ? "candles" : "bars";
				} catch {
					return "bars";
				}
			});
			const changeView = (next) => {
				setView(next);
				try {
					window.localStorage.setItem("dsh-session-stats:chart", next);
				} catch {
					// storage unavailable (private mode) — the toggle still works for this session
				}
			};
			const [priceMode, setPriceMode] = react.useState("tokens");
			const [selected, setSelected] = react.useState("ALL");
			const [hover, setHover] = react.useState(-1);
			const [reloadKey, setReloadKey] = react.useState(0);
			const overview = useOverview(windowKey, reloadKey);
			const live = useLive();
			const data = overview.data;
			const totals = data !== null && data.totals ? data.totals : null;
			const loading = data === null && overview.status !== "error";
			const placeholder = t("state.placeholder");
			const effectiveWindow = windowKey ?? (data !== null && data.window && data.window.key ? data.window.key : "7d");
			const currencyRate = data !== null && Number(data.currency?.usdRate) > 0 ? Number(data.currency.usdRate) : 7.1;
			const symbolText = currency === "CNY" ? "¥" : "$";
			const terminal = data !== null && data.terminal ? data.terminal : null;
			const symbols = terminal !== null && Array.isArray(terminal.symbols) ? terminal.symbols : [];
			const indices = terminal !== null && Array.isArray(terminal.indices) ? terminal.indices : [];
			const tape = terminal !== null && Array.isArray(terminal.tape) ? terminal.tape : [];
			const models = data !== null && Array.isArray(data.models) ? data.models : [];
			const candles = terminal !== null && terminal.candles ? terminal.candles : { period: "-", bars: [] };
			const bars = candles.bars;
			const periodMs = bars.length > 1 ? Math.max(1, bars[1].t - bars[0].t) : 300_000;
			const windowMinutes = data !== null && data.window ? Math.max(1, (data.window.to - data.window.from) / 60_000) : 1;
			const selectedSymbol = selected !== "ALL" && !indices.some((item) => item.key === selected) ? symbols.find((item) => item.route === selected) ?? null : null;
			const selectedIndex = indices.find((item) => item.key === selected) ?? null;
			let chartBars = bars;
			let instrumentTitle = t("watch.all");
			if (selectedSymbol !== null) {
				instrumentTitle = `${selectedSymbol.code} ${selectedSymbol.name}`;
				chartBars = bars.map((bar) => {
					const entry = (bar.byModel ?? []).find((model) => model.route === selectedSymbol.route);
					const tokens = entry ? entry.tokens : 0;
					const rate = tokens / Math.max(1, periodMs / 60_000);
					return { ...bar, o: rate, h: rate, l: rate, c: rate, tokens, vol: tokens > 0 ? 1 : 0, byModel: entry ? [{ route: entry.route, tokens }] : [] };
				});
			} else if (selectedIndex !== null) {
				instrumentTitle = t(`index.${selectedIndex.key}`, { defaultValue: selectedIndex.label });
				const values = Array.isArray(selectedIndex.spark) ? selectedIndex.spark : [];
				const scale = Math.max(1, values.length);
				const stepMs = (periodMs * bars.length) / scale;
				chartBars = values.map((value, index) => {
					const previous = index === 0 ? value : values[index - 1];
					const o = Number(previous) || 0;
					const c = Number(value) || 0;
					return { t: bars.length > 0 ? bars[0].t + index * stepMs : index * stepMs, o, h: Math.max(o, c), l: Math.min(o, c), c, tokens: c, vol: Math.abs(c) > 0 ? 1 : 0, costCNY: 0, calls: 0, sessions: 0, cacheHit: 0, byModel: [], empty: c === 0 && o === 0 };
				});
			}
			const zoneOffset = data !== null && data.window && Number.isFinite(data.window.offsetMs) ? Number(data.window.offsetMs) : 8 * 3_600_000;
			const priceFactor = priceMode === "cost";
			// Bar mode shows magnitudes, so merging neighbouring buckets keeps every
			// bar visible without losing totals. Do it here, before any number is
			// derived, so the header, the axis and the bars all describe one series.
			// Merge only when a bar would otherwise be thinner than ~5 CSS px; that
			// keeps 7d's hourly bars intact instead of collapsing them into 2h.
			const barTarget = Math.max(24, Math.floor((1000 - 8 - 72) / 5));
			const displayBars = view === "bars" ? mergeBars(chartBars, barTarget) : mergeCandles(chartBars, barTarget);
			// Both forms may merge buckets. Measure the real spacing of the drawn
			// bars instead of inferring it from counts: candles drop empty buckets
			// first, so a count ratio would overstate the period.
			const measuredPeriodMs =
				displayBars.length > 1 ? Math.max(1, displayBars[1].t - displayBars[0].t) : periodMs;
			const displayPeriodMs = measuredPeriodMs > periodMs ? measuredPeriodMs : periodMs;
			// Bar values are bucket totals; express them per minute so the header,
			// the axis and the candle view all use one unit (tokens/min).
			const perMinute = Math.max(1, displayPeriodMs / 60_000);
			chartBars = view === "bars" ? displayBars.map((bar) => {
				const rate = priceFactor ? bar.costCNY / perMinute : bar.tokens / perMinute;
				return { ...bar, o: rate, h: rate, l: rate, c: rate, tokensPerMin: bar.tokens / perMinute, costPerMin: bar.costCNY / perMinute };
			}) : displayBars;
			// Label must describe what is actually drawn, not the raw resolution.
			const displayPeriodText = displayPeriodMs !== periodMs ? `${Math.round(displayPeriodMs / 60_000)}m` : candles.period;
			const lastBar = chartBars.length > 0 ? chartBars[chartBars.length - 1] : null;
			const firstBar = chartBars.find((bar) => !bar.empty) ?? null;
			const currentRate = lastBar === null ? 0 : lastBar.c;
			const openRate = firstBar === null ? 0 : priceFactor ? firstBar.o : firstBar.o;
			// Quiet periods must not drag "low" down to zero: only buckets that
			// actually carried usage define the range.
			const activeBars = chartBars.filter((bar) => !bar.empty && bar.c > 0);
			const highRate = activeBars.length === 0 ? 0 : Math.max(...activeBars.map((bar) => bar.h));
			const lowRate = activeBars.length === 0 ? 0 : Math.min(...activeBars.map((bar) => bar.l));
			const avgRate = chartBars.length === 0 ? 0 : chartBars.reduce((sum, bar) => sum + (priceFactor ? bar.costCNY : bar.c), 0) / chartBars.length;
			const chgPct = openRate > 0 ? (currentRate - openRate) / openRate : null;
			const amplitude = openRate > 0 ? (highRate - lowRate) / openRate : null;
			const priceFormat = (value) => (priceFactor ? `¥${formatMoney(value)}` : formatTokens(value));
			const stats = [
				{ key: "open", value: priceFormat(openRate) },
				{ key: "high", value: priceFormat(highRate) },
				{ key: "low", value: priceFormat(lowRate) },
				{ key: "avg", value: priceFormat(avgRate) },
				{ key: "amplitude", value: formatPercent(amplitude ?? 0) },
			];
			const tabs = [
				{ key: "24h", label: t("window.24h") },
				{ key: "7d", label: t("window.7d") },
				{ key: "14d", label: t("window.14d") },
				{ key: "30d", label: t("window.30d") },
			];
			return h(
				"div",
				{ className: "ssp-term ssp-root", "data-testid": "session-stats-page", "data-loading": loading ? "true" : "false" },
				h(
					"div",
					{ className: "ssp-term-page" },
					h(
						"header",
						{ className: "ssp-term-head" },
						h("div", { className: "ssp-term-brand" }, h("h1", { className: "ssp-term-title" }, h("span", { className: "ssp-live-dot" }), t("panel")), h("span", { className: "ssp-term-sub" }, t("terminal.sub"))),
						h(
							"div",
							{ className: "ssp-term-controls" },
							h(
								"div",
								{ className: "ssp-tabs", role: "tablist" },
								tabs.map((tab) => h("button", { key: tab.key, type: "button", role: "tab", "aria-selected": effectiveWindow === tab.key ? "true" : "false", className: `ssp-tab${effectiveWindow === tab.key ? " ssp-tab-active" : ""}`, onClick: () => setWindowKey(tab.key) }, tab.label)),
							),
							h(
								"div",
								{ className: "ssp-currency", role: "radiogroup", "aria-label": t("currency.aria") },
								["CNY", "USD"].map((code) =>
									h(
										"button",
										{
											key: code,
											type: "button",
											role: "radio",
											className: "ssp-cur",
											"aria-checked": currency === code ? "true" : "false",
											onClick: () => setCurrency(code),
										},
										code,
									),
								),
							),
							h(
								"div",
								{ className: "ssp-view-toggle", role: "group", "aria-label": t("view.aria") },
								h("button", { type: "button", className: `ssp-view-btn${view === "bars" ? " ssp-view-active" : ""}`, onClick: () => changeView("bars"), "aria-pressed": view === "bars" ? "true" : "false" }, t("chart.bars")),
								h("button", { type: "button", className: `ssp-view-btn${view === "candles" ? " ssp-view-active" : ""}`, onClick: () => changeView("candles"), "aria-pressed": view === "candles" ? "true" : "false" }, t("chart.candles")),
							),
							h(
								"div",
								{ className: "ssp-view-toggle", role: "group", "aria-label": t("priceMode.aria") },
								h("button", { type: "button", className: `ssp-view-btn${priceMode === "tokens" ? " ssp-view-active" : ""}`, onClick: () => setPriceMode("tokens"), "aria-pressed": priceMode === "tokens" ? "true" : "false" }, t("priceMode.tokens")),
								h("button", { type: "button", className: `ssp-view-btn${priceMode === "cost" ? " ssp-view-active" : ""}`, onClick: () => setPriceMode("cost"), "aria-pressed": priceMode === "cost" ? "true" : "false" }, t("priceMode.cost")),
							),
							h(ModeToggle, { t, mode, onModeChange }),
						),
					),
					overview.status === "error" ? h("div", { className: "ssp-term-error" }, t("state.error", { message: overview.error ?? "" }), h("button", { type: "button", className: "ssp-retry", onClick: () => setReloadKey((value) => value + 1) }, t("state.retry"))) : null,
					h(Ticker, { t, indices, symbols, totalTokens: totals === null ? 0 : totals.tokens }),
					h(
						"section",
						{ className: "ssp-index-strip", "aria-label": t("index.aria") },
						indices.length === 0
							? h("div", { className: "ssp-term-empty" }, t("state.receiving"))
							: indices.map((item) => h(IndexCell, { key: item.key, t, item, selected: selected === item.key, onSelect: (key) => setSelected(selected === key ? "ALL" : key) })),
					),
					h(InstrumentHeader, {
						t,
						title: instrumentTitle,
						unit: priceFactor ? t("unit.costRate") : t("unit.tokenRate"),
						price: data === null ? placeholder : priceFormat(currentRate),
						chgPct,
						stats,
					}),
					h(
						"section",
						{ className: "ssp-card ssp-term-chart-card", "aria-label": t("chart.aria") },
						h(
							"div",
							{ className: "ssp-term-chart-head" },
							h("div", null, h("div", { className: "ssp-card-title" }, t("chart.title")), h("div", { className: "ssp-card-sub" }, `${displayPeriodText} · ${t(view === "candles" ? "chart.candles" : "chart.bars")} · ${priceFactor ? t("priceMode.cost") : t("priceMode.tokens")}`)),
							h("div", { className: "ssp-term-ohlc" }, lastBar === null ? "--" : `O ${priceFormat(lastBar.o)}  H ${priceFormat(lastBar.h)}  L ${priceFormat(lastBar.l)}  C ${priceFormat(lastBar.c)}`),
						),
						data === null
							? h("div", { className: "ssp-term-chart-empty" }, h("div", { className: "ssp-term-chart-empty-ring" }), h("div", { className: "ssp-card-sub" }, t("state.receiving")))
							: h(TerminalChart, { t, bars: chartBars, view, priceMode, period: displayPeriodText, periodMs: displayPeriodMs, models, hover, onHover: setHover, placeholder: t("state.receiving"), offsetMs: zoneOffset }),
					),
					h(
						"section",
						{ className: "ssp-term-grid" },
						h(Watchlist, { t, symbols, selected, onSelect: setSelected, currency, symbolText }),
						h(Tape, { t, tape, currency, symbolText, rate: currencyRate, offsetMs: zoneOffset }),
					),
					h(Positions, { t, symbols, totals, currency, symbolText, models }),
					h(
						"footer",
						{ className: "ssp-term-status" },
						h("span", null, `${t("status.data")} · ${data === null ? placeholder : t("window." + effectiveWindow)} · ${totals === null ? placeholder : totals.sessions} ${t("status.sessions")} · ${t("status.sampled")} ${formatClock(data === null ? Date.now() : data.generatedAt, zoneOffset)}`),
						h("span", { className: "ssp-term-status-right" }, `${t("term.priceTable")} ${data !== null && data.pricing ? data.pricing.tableVersion : "--"}`),
					),
				),
			);
		}
		//#endregion

		//#region page
		/** The original stats layout (the primary view). */
		function StatsView(props) {
			const { mode, onModeChange } = props;
			const t = typeof props.t === "function" ? props.t : (key) => key;
			// null = follow the host's configured default window (learned from the first response).
			const [windowKey, setWindowKey] = react.useState(null);
			const [currency, setCurrency] = react.useState("CNY");
			const [reloadKey, setReloadKey] = react.useState(0);
			const overview = useOverview(windowKey, reloadKey);
			const live = useLive();
			const data = overview.data;
			const totals = data !== null && data.totals ? data.totals : null;
			const effectiveWindow = windowKey ?? (data !== null && data.window && data.window.key ? data.window.key : "7d");
			const symbol = currency === "CNY" ? "¥" : "$";
			const placeholder = t("state.placeholder");
			const costOf = (target) => (currency === "CNY" ? target.costCNY : target.costUSD);
			// The cost card shows token cost plus flat official-search cost.
			const totalCostOf = (target) => {
				const cny = Number(target.costCNYTotal ?? target.costCNY) || 0;
				const rate = Number(data?.currency?.usdRate) > 0 ? Number(data.currency.usdRate) : 7.1;
				return currency === "CNY" ? cny : cny / rate;
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
			return h(
				"div",
				{ className: "ssp-root", "data-testid": "session-stats-page", "data-loading": loading ? "true" : "false" },
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
							h(ModeToggle, { t, mode, onModeChange }),
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
				),
			);
		}
		//#endregion

		/** Small `统计 | K线` switch, styled exactly like the currency toggle. */
		function ModeToggle({ t, mode, onModeChange }) {
			return h(
				"div",
				{ className: "ssp-view-toggle", role: "group", "aria-label": t("mode.aria") },
				h("button", { type: "button", className: `ssp-view-btn${mode === "terminal" ? "" : " ssp-view-active"}`, onClick: () => onModeChange("stats"), "aria-pressed": mode === "terminal" ? "false" : "true" }, t("mode.stats")),
				h("button", { type: "button", className: `ssp-view-btn${mode === "terminal" ? " ssp-view-active" : ""}`, onClick: () => onModeChange("terminal"), "aria-pressed": mode === "terminal" ? "true" : "false" }, t("mode.terminal")),
			);
		}

		/**
		 * Panel entry. The original stats layout stays the primary view; the K-line
		 * terminal is an optional skin one tap away, remembered like a theme choice.
		 */
		function SessionStatsPage(props) {
			const [mode, setMode] = react.useState(() => {
				try {
					return window.localStorage.getItem("dsh-session-stats:mode") === "terminal" ? "terminal" : "stats";
				} catch {
					return "stats";
				}
			});
			const changeMode = (next) => {
				setMode(next);
				try {
					window.localStorage.setItem("dsh-session-stats:mode", next);
				} catch {
					// storage unavailable — the switch still works for this session
				}
			};
			const View = mode === "terminal" ? TerminalView : StatsView;
			return h(View, { ...props, mode, onModeChange: changeMode });
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
