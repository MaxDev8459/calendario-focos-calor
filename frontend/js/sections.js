// Method, Data, About and footer (M5, M6, M7, M16). Real factors come from factores.json (contract A3).
import { T, MONTHS_SHORT, MONTHS } from "./i18n/en.js";
import { TEAM_NAME, RAMP } from "./config.js";
import { renderBeforeAfter, annualize } from "./country/chart.js";
import { fmtInt, fmtNum, fmtMonthKey, fmtDateTime } from "./util/format.js";
import { icons } from "./ui/icons.js";
import { on } from "./state.js";

const prettyCountry = (k) => k.replace(/_/g, " ");

export function renderMethod(el) {
  const m = T.method;
  el.innerHTML = `
    <div class="page-wrap">
      <header class="page-head">
        <h2 id="method-title" class="page-title serif">${m.title} <em>· ${m.lead}</em></h2>
        <p class="page-lead">${m.body}</p>
      </header>
      <div class="method-grid">
        <figure class="panel panel-chart">
          <figcaption class="panel-head"><span class="label">${m.chartTitle}</span><span class="sample-chip mono" data-series-sample hidden>${T.sampleData}</span></figcaption>
          <div data-method-chart class="method-chart"></div>
          <p class="chart-summary" data-method-summary></p>
        </figure>
        <ol class="steps">
          ${m.steps.map(([h, b], i) => `<li><span class="step-n mono" aria-hidden="true">${i + 1}</span><div><h3 class="serif">${h}</h3><p>${b}</p></div></li>`).join("")}
        </ol>
        <section class="panel panel-factors" aria-labelledby="factors-title">
          <div class="panel-head">
            <h3 id="factors-title" class="label">${m.factorsTitle}</h3>
            <label class="mini-select"><span class="sr-only">${m.countryPick}</span><select data-factor-country></select>${icons.chevron}</label>
          </div>
          <div class="factor-bars" data-factor-bars></div>
          <p class="chart-summary" data-factor-summary></p>
          <p class="muted small">${m.factorsSource}</p>
        </section>
        <section class="panel panel-metrics" aria-labelledby="metrics-title">
          <h3 id="metrics-title" class="label">${m.metricsTitle}</h3>
          <dl class="metrics" data-metrics></dl>
          <p class="muted small" data-metrics-note></p>
        </section>
      </div>
    </div>`;
}

export function fillMethod(el, { series, factors }) {
  const m = T.method;
  if (series?.serie?.length) {
    renderBeforeAfter(el.querySelector("[data-method-chart]"), series.serie, { mode: "both", height: 260, axis: true });
    el.querySelector("[data-series-sample]").hidden = !series.sample;
    const yrs = annualize(series.serie);
    const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    const pre = series.serie.filter((s) => +s.fecha.slice(0, 4) < 2012);
    const post = series.serie.filter((s) => +s.fecha.slice(0, 4) >= 2012 && +s.fecha.slice(0, 4) <= 2021);
    el.querySelector("[data-method-summary]").textContent = m.chartSummary(fmtInt(mean(pre.map((s) => s.modis ?? 0))), fmtInt(mean(post.map((s) => s.viirs ?? 0))), fmtInt(mean(pre.map((s) => s.armonizado ?? 0))));
    void yrs;
  }
  if (!factors?.paises) { el.querySelector(".panel-factors").hidden = true; el.querySelector(".panel-metrics").hidden = true; return; }
  const sel = el.querySelector("[data-factor-country]");
  const names = Object.keys(factors.paises).sort();
  sel.innerHTML = `<option value="__america">${m.america}</option>` + names.map((n) => `<option value="${n}">${prettyCountry(n)}</option>`).join("");
  sel.value = factors.paises.Mexico ? "Mexico" : "__america";
  const paint = () => {
    const key = sel.value;
    const entry = key === "__america" ? factors.factor_america : factors.paises[key];
    const f = Array.from({ length: 12 }, (_, i) => Number(entry.factores[String(i + 1)]));
    const max = Math.max(...f) * 1.08, min = Math.min(...f);
    const lowest = f.indexOf(min);
    el.querySelector("[data-factor-bars]").innerHTML = `<ul class="fbars">${f
      .map((v, i) => `<li${i === lowest ? ' class="is-low"' : ""}><span class="fb-val num">${v.toFixed(2)}</span><span class="fb-bar" style="--h:${(v / max) * 100}%"></span><span class="fb-m mono">${MONTHS_SHORT[i]}</span></li>`)
      .join("")}</ul>`;
    el.querySelector("[data-factor-summary]").textContent = m.factorsSummary(min.toFixed(2), Math.max(...f).toFixed(2), MONTHS[lowest]);
    const v = entry.validacion;
    const dl = el.querySelector("[data-metrics]");
    if (v) {
      dl.innerHTML = `
        <div><dt class="label">${m.loyo}</dt><dd class="num huge accent">${fmtNum(v.error_medio_pct)}%</dd></div>
        <div><dt class="label">${m.single}</dt><dd class="num huge">${v.error_medio_pct_factor_unico != null ? fmtNum(v.error_medio_pct_factor_unico) + "%" : "—"}</dd></div>
        <div><dt class="label">${m.bias}</dt><dd class="num huge">${v.sesgo_pct > 0 ? "+" : ""}${fmtNum(v.sesgo_pct)}%</dd></div>
        <div><dt class="label">${m.r}</dt><dd class="num huge">${v.r != null ? v.r.toFixed(3) : "—"}</dd></div>`;
      el.querySelector("[data-metrics-note]").textContent = m.metricsNote(prettyCountry(key), (factors.periodo_calibracion ?? []).map(fmtMonthKey).join(" – "), v.meses_validados ?? "—");
    } else {
      dl.innerHTML = `<div><dt class="label">${m.calib}</dt><dd class="num">${(factors.periodo_calibracion ?? []).map(fmtMonthKey).join(" – ")}</dd></div><div><dt class="label">${m.countries}</dt><dd class="num huge">${entry.paises_incluidos ?? names.length}</dd></div>`;
      el.querySelector("[data-metrics-note]").textContent = m.americaNote;
    }
  };
  sel.addEventListener("change", paint);
  paint();
}

export function renderData(el) {
  const d = T.data;
  el.innerHTML = `
    <div class="page-wrap">
      <header class="page-head">
        <h2 id="data-title" class="page-title serif">${d.title}</h2>
        <p class="page-lead credit-line">${d.credit(TEAM_NAME)}</p>
        <p class="mono small muted" data-through></p>
      </header>
      <div class="data-grid">
        <section class="panel" aria-labelledby="src-title">
          <h3 id="src-title" class="label">${d.sourcesTitle}</h3>
          <ul class="src-list">${d.sources.map(([n, b, href]) => `<li><a href="${href}" rel="noopener" target="_blank">${n}</a><p>${b}</p></li>`).join("")}</ul>
          <h3 class="label">${d.filtersTitle}</h3>
          <ul class="bullets">${d.filters.map((f) => `<li>${f}</li>`).join("")}</ul>
        </section>
        <section class="panel" aria-labelledby="csv-title">
          <h3 id="csv-title" class="label">${d.csvTitle}</h3>
          <p class="muted small">${d.csvLead}</p>
          <dl class="csv-cols">${d.csvColumns.map(([k, v]) => `<div><dt class="mono" translate="no">${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
        </section>
        <section class="panel" aria-labelledby="lic-title">
          <h3 id="lic-title" class="label">${d.licensesTitle}</h3>
          <p class="muted">${d.licenses}</p>
        </section>
      </div>
    </div>`;
}

export function fillDataThrough(el, meta) {
  const p = el.querySelector("[data-through]");
  if (!p || !meta?.ultimo_mes_completo) return;
  const paint = () => (p.textContent = T.data.through(fmtMonthKey(meta.ultimo_mes_completo), fmtDateTime(meta.generado)));
  paint();
  on("tz", paint);
}

export function renderAbout(el) {
  const a = T.about;
  el.innerHTML = `
    <div class="page-wrap about-wrap">
      <h2 id="about-title" class="page-title serif">${a.title}</h2>
      <p class="about-body">${a.body}</p>
      <div class="about-side">
        <h3 class="label">${a.audienceTitle}</h3>
        <ul class="audience">${a.audience.map((x) => `<li>${x}</li>`).join("")}</ul>
        <p class="muted">${a.team}</p>
      </div>
    </div>`;
}

export function renderFooter(el) {
  const f = T.footer;
  el.innerHTML = `
    <div class="footer-inner">
      <p class="footer-credit">${f.credit} ${f.harmonized(TEAM_NAME)}</p>
      <nav class="footer-links" aria-label="${f.nav}">
        <a href="#method">${T.nav.method}</a><a href="#data">${T.nav.data}</a><a href="#about">${T.nav.about}</a>
        <a href="${f.repo}" rel="noopener" target="_blank">${f.code}</a>
        <a href="#hero">${f.top}</a>
      </nav>
    </div>`;
}
