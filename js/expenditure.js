// expenditure.js — Expenditure page

const VDEM_COLOR = {
  'Liberal democracy':   '#2C5F8F',
  'Electoral democracy': '#7FAACD',
  'Electoral autocracy': '#D5A04E',
  'Closed autocracy':    '#9B2A2A'
};

(async function init() {
  const [deals, world, cm, clgTotals] = await Promise.all([
    fetch('data/expenditure_deals.json').then(r => r.json()),
    GSI.loadWorldGeo(),
    GSI.loadCountryMaster(),
    fetch('data/aiddata_total_by_iso3.json').then(r => r.json())
  ]);
  const clgByIso3 = Object.fromEntries(clgTotals.map(r => [r.iso3, r.total_clg_usd_2023]));

  initStats(deals, cm);
  initMap(world, deals, cm, clgByIso3);
  initRecipientsTable(deals, cm);
  initProjectsSearch(deals, cm);
  initBuilder(deals);
})();

// ---- STATS ----
function initStats(deals, cm) {
  const total = deals.reduce((a, d) => a + (d.amt_2023 || 0), 0);
  document.getElementById('s-total').textContent = GSI.fmt(total, { money: true });
  document.getElementById('s-deals').textContent = deals.length.toLocaleString();
  const byCountry = {};
  deals.forEach(d => { byCountry[d.iso3] = (byCountry[d.iso3] || 0) + (d.amt_2023 || 0); });
  document.getElementById('s-recipients').textContent = Object.keys(byCountry).length;
  const ranked = Object.entries(byCountry).sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    const topIso = ranked[0][0];
    const topName = (cm.find(x => x.iso3 === topIso) || {}).name || topIso;
    document.getElementById('s-top').textContent = topName;
  }
}

// ---- MAP ----
let mapState = {
  layer: null, colorBy: 'amount', subset: 'both',
  yearFrom: 2000, yearTo: 2023, filter: null,
  byIso3: {}, dealsByIso3: {}, shareByIso3: {}, clgByIso3: {},
  max: 1, maxDeals: 1,
  amtBreaks: [], dealBreaks: [], shareBreaks: []
};

function isoOf(feature) {
  const p = feature.properties;
  return p['ISO3166-1-Alpha-3'] || p.iso_a3 || p.ISO_A3 || p.adm0_a3;
}

// 6-stop crimson ramp; bin lookup based on quantile breaks for high contrast
const AMOUNT_RAMP = ['#F2E8DA','#E5B8A0','#D17C5C','#B0382C','#7E1414','#3A0606'];
const DEAL_RAMP   = ['#F2E8DA','#D9B098','#B86C50','#8A2520','#4E0A0A'];
// Purple ramp for the security-share view, to distinguish from the amount ramp
const SHARE_RAMP  = ['#F2E8DA','#D9C2D6','#B387B3','#7E4690','#4A1C5E','#2A0E3E'];

function colorFromBin(value, breaks, ramp) {
  if (!value || value <= 0) return ramp[0];
  for (let i = 0; i < breaks.length; i++) {
    if (value <= breaks[i]) return ramp[i + 1] || ramp[ramp.length - 1];
  }
  return ramp[ramp.length - 1];
}
function quantileBreaks(values, n) {
  const sorted = [...values].filter(v => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const breaks = [];
  for (let i = 1; i <= n; i++) {
    const idx = Math.floor((i / n) * sorted.length) - 1;
    breaks.push(sorted[Math.max(0, idx)]);
  }
  return breaks;
}
function amountColor(v) {
  return colorFromBin(v, mapState.amtBreaks, AMOUNT_RAMP);
}
function dealCountColor(n) {
  return colorFromBin(n, mapState.dealBreaks, DEAL_RAMP);
}
function shareColor(p) {
  return colorFromBin(p, mapState.shareBreaks, SHARE_RAMP);
}
function interp(stops, t) {
  const seg = 1 / (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t / seg));
  const lt = (t - i * seg) / seg;
  const a = stops[i], b = stops[i + 1];
  const r = Math.round(a[0] + lt * (b[0] - a[0]));
  const g = Math.round(a[1] + lt * (b[1] - a[1]));
  const bl = Math.round(a[2] + lt * (b[2] - a[2]));
  return `rgb(${r},${g},${bl})`;
}

function rebuildByIso3(deals) {
  const amt = {}, count = {};
  deals.forEach(d => {
    if (mapState.subset !== 'both' && d.dataset !== mapState.subset) return;
    if (d.year == null || d.year < mapState.yearFrom || d.year > mapState.yearTo) return;
    const a = d.amt_2023 || 0;
    amt[d.iso3] = (amt[d.iso3] || 0) + a;
    count[d.iso3] = (count[d.iso3] || 0) + 1;
  });
  mapState.byIso3 = amt;
  mapState.dealsByIso3 = count;
  mapState.max = Math.max(...Object.values(amt), 1);
  mapState.maxDeals = Math.max(...Object.values(count), 1);
  // Share of all Chinese CLG funding (percentage points). Only meaningful if
  // there's a positive CLG denominator for that country.
  const share = {};
  Object.entries(amt).forEach(([iso, v]) => {
    const denom = mapState.clgByIso3[iso];
    if (denom && denom > 0 && v > 0) share[iso] = (v / denom) * 100;
  });
  mapState.shareByIso3 = share;
  // Quantile breaks for high-contrast binned colouring
  mapState.amtBreaks   = quantileBreaks(Object.values(amt),   AMOUNT_RAMP.length - 1);
  mapState.dealBreaks  = quantileBreaks(Object.values(count), DEAL_RAMP.length - 1);
  mapState.shareBreaks = quantileBreaks(Object.values(share), SHARE_RAMP.length - 1);
}

function matchesFilter(c) {
  if (!mapState.filter) return true;
  if (!c) return false;
  const [field, value] = mapState.filter;
  return ('' + (c[field] ?? '')).toLowerCase() === ('' + value).toLowerCase();
}

function initMap(world, deals, cm, clgByIso3) {
  const cmByIso3 = Object.fromEntries(cm.map(c => [
    c.iso3,
    Object.assign({}, c, {
      China_partnership: (c.China_ally_label && ('' + c.China_ally_label).trim()) ? 'Yes' : 'No'
    })
  ]));
  mapState.clgByIso3 = clgByIso3;
  rebuildByIso3(deals);

  const map = L.map('map-canvas', { scrollWheelZoom: false }).setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://carto.com/attributions">CARTO</a> · OSM',
    subdomains: 'abcd', maxZoom: 7, minZoom: 1
  }).addTo(map);

  function style(feature) {
    const iso3 = isoOf(feature);
    const c = cmByIso3[iso3];
    let fill;
    if (mapState.colorBy === 'amount') {
      fill = amountColor(mapState.byIso3[iso3] || 0);
    } else if (mapState.colorBy === 'share') {
      fill = shareColor(mapState.shareByIso3[iso3] || 0);
    } else {
      fill = dealCountColor(mapState.dealsByIso3[iso3] || 0);
    }
    const dim = mapState.filter && !matchesFilter(c);
    return {
      fillColor: fill,
      weight: 0.4,
      opacity: 1,
      color: '#fff',
      fillOpacity: dim ? 0.15 : 0.92
    };
  }

  function onEach(feature, layer) {
    const iso3 = isoOf(feature);
    const c = cmByIso3[iso3];
    const name = (c && c.name) || feature.properties.name || iso3;
    const v = mapState.byIso3[iso3] || 0;
    const n = mapState.dealsByIso3[iso3] || 0;
    layer.on({
      mouseover: e => e.target.setStyle({ weight: 1.5, color: '#1B2733' }),
      mouseout: e => mapState.layer.resetStyle(e.target),
      click: () => { if (c) window.location.href = `index.html#country=${iso3}`; }
    });
    const denom = mapState.clgByIso3[iso3];
    const share = mapState.shareByIso3[iso3];
    layer.bindTooltip(`
      <div style="font-family:Inter,sans-serif;font-size:.84rem">
        <b style="font-size:1rem">${name}</b><br>
        ${v ? `${GSI.fmt(v, { money: true })} in ${n} deal${n !== 1 ? 's' : ''}` : 'No commitments in window'}<br>
        ${denom && v ? `<span style="color:#3a4654">${share != null ? share.toFixed(2) + '%' : '—'} of total Chinese CLG (${GSI.fmt(denom, { money: true })})</span><br>` : ''}
        ${c ? `<span style="color:#5C6470">${c.vdem_regime_label || ''} · ${c.rand_ally === 1 ? 'US ally' : 'Non-ally'}</span>` : ''}
      </div>`, { sticky: true });
  }

  mapState.layer = L.geoJSON(world, { style, onEachFeature: onEach }).addTo(map);
  renderLegend(); renderChips();

  function refresh() { rebuildByIso3(deals); mapState.layer.setStyle(style); renderLegend(); }

  // Range slider
  const yFrom = document.getElementById('year-from');
  const yTo   = document.getElementById('year-to');
  const dF = document.getElementById('year-from-d');
  const dT = document.getElementById('year-to-d');
  function syncYears() {
    let a = parseInt(yFrom.value), b = parseInt(yTo.value);
    if (a > b) { if (this === yFrom) { b = a; yTo.value = a; } else { a = b; yFrom.value = b; } }
    mapState.yearFrom = a; mapState.yearTo = b;
    dF.textContent = a; dT.textContent = b;
    refresh();
  }
  yFrom.addEventListener('input', syncYears); yTo.addEventListener('input', syncYears);

  // Subset toggle
  document.querySelectorAll('#map-subset button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#map-subset button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); mapState.subset = b.dataset.sub; refresh();
    });
  });

  // Color-by
  document.getElementById('map-colorby').addEventListener('change', e => {
    mapState.colorBy = e.target.value;
    mapState.layer.setStyle(style);
    renderLegend();
  });

  function renderLegend() {
    const lg = document.getElementById('map-legend');
    let main = '';
    if (mapState.colorBy === 'amount') {
      const breaks = mapState.amtBreaks;
      const labels = ['$0', ...breaks.map(v => '≤ ' + GSI.fmt(v, { money: true }))];
      main = AMOUNT_RAMP.map((c, i) =>
        `<span class="swatch"><i style="background:${c}"></i> ${labels[i] || ''}</span>`
      ).join('') + `<span style="color:#5C6470">· ${mapState.yearFrom}–${mapState.yearTo}</span>`;
    } else if (mapState.colorBy === 'share') {
      const breaks = mapState.shareBreaks;
      const labels = ['0%', ...breaks.map(v => '≤ ' + v.toFixed(2) + '%')];
      main = SHARE_RAMP.map((c, i) =>
        `<span class="swatch"><i style="background:${c}"></i> ${labels[i] || ''}</span>`
      ).join('') + `<span style="color:#5C6470">· Security &amp; surveillance ÷ all Chinese CLG, ${mapState.yearFrom}–${mapState.yearTo}</span>`;
    } else {
      const breaks = mapState.dealBreaks;
      const labels = ['0', ...breaks.map(v => '≤ ' + v)];
      main = DEAL_RAMP.map((c, i) =>
        `<span class="swatch"><i style="background:${c}"></i> ${labels[i] || ''} deals</span>`
      ).join('');
    }
    lg.innerHTML = main;
  }

  function renderChips() {
    const wrap = document.getElementById('map-filter-chips');
    const chips = [
      { field: 'rand_ally', value: 1, label: 'US ally (RAND 2017)' },
      { field: 'China_partnership', value: 'Yes', label: 'China partner' },
      { field: 'vdem_regime_label', value: 'Liberal Democracy',   label: 'Liberal democracy' },
      { field: 'vdem_regime_label', value: 'Electoral Democracy', label: 'Electoral democracy' },
      { field: 'vdem_regime_label', value: 'Electoral Autocracy', label: 'Electoral autocracy' },
      { field: 'vdem_regime_label', value: 'Closed Autocracy',    label: 'Closed autocracy' },
      { field: 'OECD',           value: 'Yes', label: 'OECD' },
      { field: 'China_neighbor', value: 'Yes', label: "China's neighbour" },
      { field: 'BRICS_member',   value: 'Yes', label: 'BRICS member' }
    ];
    wrap.innerHTML = chips.map((c, i) => {
      const on = mapState.filter && mapState.filter[0] === c.field && '' + mapState.filter[1] === '' + c.value;
      return `<button data-i="${i}" class="${on ? 'on' : ''}">${c.label}</button>`;
    }).join('') + `<button data-clear="1" style="background:transparent;border:none;color:var(--muted);font-size:.78rem;text-decoration:underline;cursor:pointer">clear</button>`;
    wrap.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.clear) mapState.filter = null;
        else {
          const c = chips[parseInt(btn.dataset.i)];
          const on = mapState.filter && mapState.filter[0] === c.field && '' + mapState.filter[1] === '' + c.value;
          mapState.filter = on ? null : [c.field, c.value];
        }
        mapState.layer.setStyle(style);
        renderChips();
      });
    });
  }
}

// ---- RECIPIENTS TABLE (20 per page) ----
let recState = { sortCol: 'total', sortDir: -1, search: '', shown: 20 };

function initRecipientsTable(deals, cm) {
  const cmByIso3 = Object.fromEntries(cm.map(c => [c.iso3, c]));
  const agg = {};
  deals.forEach(d => {
    if (!agg[d.iso3]) agg[d.iso3] = { iso3: d.iso3, total: 0, deals: 0, firstYear: 9999, lastYear: 0 };
    agg[d.iso3].total += d.amt_2023 || 0;
    agg[d.iso3].deals += 1;
    if (d.year != null) {
      agg[d.iso3].firstYear = Math.min(agg[d.iso3].firstYear, d.year);
      agg[d.iso3].lastYear  = Math.max(agg[d.iso3].lastYear, d.year);
    }
  });
  const rows = Object.values(agg)
    .map(r => ({ ...r, country: (cmByIso3[r.iso3] || {}).name || r.iso3 }));

  function render() {
    let filtered = rows;
    if (recState.search) {
      const q = recState.search.toLowerCase();
      filtered = filtered.filter(r => r.country.toLowerCase().includes(q));
    }
    filtered.sort((a, b) => {
      const av = a[recState.sortCol]; const bv = b[recState.sortCol];
      if (typeof av === 'number') return (av - bv) * recState.sortDir;
      return ('' + av).localeCompare('' + bv) * recState.sortDir;
    });

    const top = filtered.slice(0, recState.shown);
    const tbody = document.querySelector('#rec-table tbody');
    tbody.innerHTML = top.map(r => `
      <tr style="cursor:pointer" onclick="window.location.href='index.html#country=${r.iso3}'">
        <td><b>${r.country}</b> <span style="color:#5C6470;font-size:.78em">(${r.iso3})</span></td>
        <td style="text-align:right"><b>${GSI.fmt(r.total, { money: true })}</b></td>
        <td style="text-align:right">${r.deals}</td>
        <td style="text-align:right">${r.firstYear === 9999 ? '—' : r.firstYear}</td>
        <td style="text-align:right">${r.lastYear || '—'}</td>
      </tr>
    `).join('');
    document.getElementById('rec-count').textContent =
      `${filtered.length} of ${rows.length} recipients · showing ${top.length}`;
    const moreBtn = document.getElementById('rec-more');
    if (filtered.length > recState.shown) {
      moreBtn.style.display = 'inline-block';
      moreBtn.textContent = `Show 20 more (${filtered.length - recState.shown} remaining)`;
    } else moreBtn.style.display = 'none';
  }
  render();
  document.querySelectorAll('#rec-table thead th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (recState.sortCol === col) recState.sortDir *= -1;
      else { recState.sortCol = col; recState.sortDir = col === 'country' ? 1 : -1; }
      document.querySelectorAll('#rec-table thead th').forEach(x => x.classList.remove('sort-asc','sort-desc'));
      th.classList.add(recState.sortDir === 1 ? 'sort-asc' : 'sort-desc');
      render();
    });
  });
  document.getElementById('rec-search').addEventListener('input', e => {
    recState.search = e.target.value; recState.shown = 20; render();
  });
  document.getElementById('rec-more').addEventListener('click', () => {
    recState.shown += 20; render();
  });
}

// ---- PROJECTS SEARCH ----
let projState = { search: '', sub: 'all', sort: 'amount', shown: 25, expanded: {} };
function initProjectsSearch(deals, cm) {
  const cmByIso3 = Object.fromEntries(cm.map(c => [c.iso3, c]));

  function render() {
    let list = [...deals];
    if (projState.sub !== 'all') list = list.filter(d => d.dataset === projState.sub);
    if (projState.search) {
      const q = projState.search.toLowerCase();
      list = list.filter(d =>
        ('' + d.title).toLowerCase().includes(q) ||
        ('' + d.sector).toLowerCase().includes(q) ||
        ('' + d.recipient).toLowerCase().includes(q) ||
        ('' + (d.funder || '')).toLowerCase().includes(q) ||
        ('' + (d.description || '')).toLowerCase().includes(q)
      );
    }
    if (projState.sort === 'amount') list.sort((a, b) => (b.amt_2023 || 0) - (a.amt_2023 || 0));
    else if (projState.sort === 'year') list.sort((a, b) => (b.year || 0) - (a.year || 0));
    else list.sort((a, b) => ('' + a.recipient).localeCompare('' + b.recipient));

    document.getElementById('proj-count').textContent = `${list.length} projects`;
    const top = list.slice(0, projState.shown);
    document.getElementById('projects-list').innerHTML = top.map(d => {
      const datasetChip = d.dataset === 'Surveillance'
        ? '<span class="chip" style="background:#5B2E2E">Surveillance</span>'
        : '<span class="chip crimson">Security</span>';
      const isOpen = projState.expanded[d.record_id];
      return `
        <div data-id="${d.record_id}" style="padding:.75rem 0;border-bottom:1px solid var(--line)" class="proj-row">
          <div style="display:flex;gap:.6rem;font-family:Inter,sans-serif;font-size:.78rem;color:var(--muted);margin-bottom:.25rem;flex-wrap:wrap;align-items:center">
            ${datasetChip}
            <span>${d.year || '—'}</span>
            <span><b style="color:var(--ink)">${d.recipient}</b></span>
            ${d.amt_2023 ? `<span style="margin-left:auto;font-weight:600;color:var(--crimson)">${GSI.fmt(d.amt_2023, { money: true })}</span>` : '<span style="margin-left:auto;color:#999">no monetary value</span>'}
          </div>
          <h4 style="font-size:.98rem;margin-bottom:.25rem">${d.title || '(no title)'}</h4>
          <div style="font-size:.78rem;color:#5C6470;font-family:Inter,sans-serif">
            ${d.sector ? `${d.sector} · ` : ''}${d.funder ? `Funded by ${d.funder}` : ''}
            ${d.receiving_agency ? ` → ${d.receiving_agency}` : ''}
          </div>
          ${d.description ? `<details style="margin-top:.4rem"${isOpen ? ' open' : ''}>
            <summary style="cursor:pointer;font-family:Inter,sans-serif;font-size:.82rem;color:var(--accent)">Full description</summary>
            <p style="font-size:.88rem;color:#3a4654;padding:.3rem 0">${d.description}</p>
          </details>` : ''}
        </div>`;
    }).join('');

    const moreBtn = document.getElementById('proj-more');
    if (list.length > projState.shown) {
      moreBtn.style.display = 'inline-block';
      moreBtn.textContent = `Show 25 more (${list.length - projState.shown} remaining)`;
    } else moreBtn.style.display = 'none';
  }
  render();
  document.getElementById('proj-search').addEventListener('input', e => { projState.search = e.target.value; projState.shown = 25; render(); });
  document.getElementById('proj-sub').addEventListener('change', e => { projState.sub = e.target.value; projState.shown = 25; render(); });
  document.getElementById('proj-sort').addEventListener('change', e => { projState.sort = e.target.value; render(); });
  document.getElementById('proj-more').addEventListener('click', () => { projState.shown += 25; render(); });
}

// ---- BUILDER ----
function initBuilder(deals) {
  const data = deals.map(d => ({
    iso3: d.iso3,
    recipient: d.recipient,
    year: d.year,
    sector: d.sector || 'Unknown',
    funder: (d.funder || 'Unknown').slice(0, 60),
    dataset: d.dataset,
    amt_2023: d.amt_2023 || 0
  }));
  GSI.initChartBuilder({
    mount: 'exp-builder',
    data,
    section: 'Expenditure',
    dimensions: {
      categorical: ['year', 'recipient', 'sector', 'dataset', 'funder'],
      quantitative: ['amt_2023'],
      additive: ['amt_2023']   // money sums meaningfully; high-card recipient/funder auto-dropped from Colour
    },
    labels: {
      year: 'Commitment year',
      recipient: 'Recipient country',
      sector: 'Sector',
      dataset: 'Subset (Security / Surveillance)',
      funder: 'Funder',
      amt_2023: 'Amount, constant 2023 USD'
    },
    presets: [
      {
        name: 'Total commitment by year',
        spec: {
          mark: 'bar',
          encoding: {
            x: { field: 'year', type: 'ordinal' },
            y: { aggregate: 'sum', field: 'amt_2023', type: 'quantitative', title: 'USD' },
            color: { field: 'dataset', type: 'nominal',
                     scale: { domain: ['Security','Surveillance'], range: ['#8B1A1A','#5B2E2E'] } }
          }
        }
      },
      {
        name: 'Top recipients by total',
        spec: {
          mark: 'bar',
          encoding: {
            y: { field: 'recipient', type: 'nominal', sort: '-x' },
            x: { aggregate: 'sum', field: 'amt_2023', type: 'quantitative', title: 'USD' },
            color: { field: 'dataset', type: 'nominal',
                     scale: { domain: ['Security','Surveillance'], range: ['#8B1A1A','#5B2E2E'] } }
          }
        }
      },
      {
        name: 'Sector mix over time',
        spec: {
          mark: 'bar',
          encoding: {
            x: { field: 'year', type: 'ordinal' },
            y: { aggregate: 'sum', field: 'amt_2023', type: 'quantitative', title: 'USD' },
            color: { field: 'sector', type: 'nominal' }
          }
        }
      },
      {
        name: 'Deals by sector',
        spec: {
          mark: 'bar',
          encoding: {
            y: { field: 'sector', type: 'nominal', sort: '-x' },
            x: { aggregate: 'count', type: 'quantitative', title: 'Deals' },
            color: { field: 'dataset', type: 'nominal',
                     scale: { domain: ['Security','Surveillance'], range: ['#8B1A1A','#5B2E2E'] } }
          }
        }
      }
    ]
  });
}
