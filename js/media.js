// media.js — Media sentiment page

// Brighter, more distinct palette for the quarterly series
const SOURCE_COLORS = {
  'All articles': '#1B2733',  // near-black corpus line
  'USA/NATO': '#C0392B',   // strong red
  'UN':       '#2E5984',   // navy
  'ASEAN':    '#2F6063',   // jade
  'BRICS':    '#B8651D',   // copper
  'SCO':      '#7D3C98',   // purple
  'EU':       '#16A085',   // teal
  'AU':       '#D4AC0D',   // gold
  // regime / alliance lines (country-tagged; drawn dotted)
  'Authoritarian': '#922B21', 'Democratic': '#1A5276',
  'US ally':       '#0E6655', 'Non-ally':   '#7E5109',
  // GSI doctrinal phrases (drawn dashed)
  'Indivisible security':         '#E91E63',
  'Legitimate security concerns': '#455A64'
};

// Audience source groups (the atomic tagging units).
const REGIONAL_SOURCES = ['USA/NATO', 'UN', 'ASEAN', 'BRICS', 'SCO', 'EU', 'AU'];
// Regime / alliance categories (country-tagged, V-Dem + RAND).
const REGIME_SERIES = ['Authoritarian', 'Democratic', 'US ally', 'Non-ally'];
// Doctrinal-phrase lines.
const PHRASE_SOURCES = ['Indivisible security', 'Legitimate security concerns'];

// The three selectable rows of series. Row 1 (actors) is the default cover.
const ACTOR_SERIES = ['All articles', ...REGIONAL_SOURCES];
const SERIES_ROWS = [
  { label: 'Actors', items: ACTOR_SERIES },
  { label: 'Regime &amp; alliance', items: REGIME_SERIES },
  { label: 'GSI doctrine', items: PHRASE_SOURCES }
];
const CHIP_LABEL = { 'All articles': 'All' };   // short chip text

function seriesStyle(label) {
  const color = SOURCE_COLORS[label] || '#888';
  if (label === 'All articles')        return { color, dash: [6, 4], width: 2.6, point: 'rectRot', r: 4, order: 0 };
  if (REGIME_SERIES.includes(label))   return { color, dash: [2, 2], width: 2.4, point: 'rect',    r: 3, order: 1 };
  if (PHRASE_SOURCES.includes(label))  return { color, dash: [5, 3], width: 2.6, point: 'triangle', r: 4, order: 1 };
  return { color, dash: [], width: 2.2, point: 'circle', r: 3, order: 2 };   // regional actors
}

(async function init() {
  const [quarterly, bySource, byCountry, articles, world] = await Promise.all([
    fetch('data/media_quarterly.json').then(r => r.json()),
    fetch('data/media_by_source.json').then(r => r.json()),
    fetch('data/media_by_country.json').then(r => r.json()),
    fetch('data/media_articles.json').then(r => r.json()),
    GSI.loadWorldGeo()
  ]);

  initStats(quarterly, bySource, articles);
  initQuarterlyChart(quarterly);
  initCountryMap(world, byCountry);
  initBySourceChart(bySource);
  initArticlesSearch(articles);
  initBuilder(quarterly);
})();

function initStats(quarterly, bySource, articles) {
  document.getElementById('s-articles').textContent = articles.length.toLocaleString();
  // Sum only the atomic rows (regional groups × MFA/Xinhua); the 'both',
  // 'All articles' and phrase rows are derived overlaps and would inflate it.
  const totalSent = quarterly
    .filter(r => REGIONAL_SOURCES.includes(r.source) && r.publication !== 'both')
    .reduce((a, r) => a + (r.n_sentences || 0), 0);
  document.getElementById('s-sentences').textContent = totalSent.toLocaleString();
  const byGroup = {};
  bySource.forEach(r => {
    if (!byGroup[r.source]) byGroup[r.source] = { tot: 0, w: 0 };
    byGroup[r.source].tot += r.mean_sent * r.n_sentences;
    byGroup[r.source].w += r.n_sentences;
  });
  const sorted = Object.entries(byGroup).map(([s, v]) => ({ s, mean: v.tot / v.w })).sort((a, b) => a.mean - b.mean);
  document.getElementById('s-negsrc').textContent = sorted[0].s;
  document.getElementById('s-possrc').textContent = sorted[sorted.length - 1].s;
}

// ---- QUARTERLY ----
let qChart = null, qPub = 'MFA', qMetric = 'sentiment';
// the chart starts on its "cover" — only the first row (actors) is shown;
// readers click chips in the other rows to ADD those series.
let qVisible = new Set(ACTOR_SERIES);

function initQuarterlyChart(quarterly) {
  buildChips(quarterly);
  draw();
  document.querySelectorAll('#pub-toggle button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#pub-toggle button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); qPub = b.dataset.pub; draw();
    });
  });
  document.querySelectorAll('#metric-toggle button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#metric-toggle button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); qMetric = b.dataset.metric; draw();
    });
  });

  // Build the three rows of selectable series chips.
  function buildChips(quarterly) {
    const present = new Set(quarterly.map(r => r.source));
    const mount = document.getElementById('series-chips');
    if (!mount) return;
    mount.innerHTML = SERIES_ROWS.map(row => {
      const chips = row.items.filter(it => present.has(it)).map(it => {
        const st = seriesStyle(it);
        const on = qVisible.has(it) ? ' on' : '';
        return `<button class="series-chip${on}" data-series="${it}" style="--c:${st.color}">${CHIP_LABEL[it] || it}</button>`;
      }).join('');
      return `<div class="series-row"><span class="series-row-label">${row.label}</span>` +
             `<div class="series-row-chips">${chips}</div></div>`;
    }).join('');
    mount.querySelectorAll('.series-chip').forEach(b => {
      b.addEventListener('click', () => {
        const s = b.dataset.series;
        if (qVisible.has(s)) qVisible.delete(s); else qVisible.add(s);
        b.classList.toggle('on');
        draw();
      });
    });
  }

  function draw() {
    const isSent = qMetric === 'sentiment';
    const quarters = [...new Set(quarterly.map(r => r.quarter))].sort();
    const order = [...ACTOR_SERIES, ...REGIME_SERIES, ...PHRASE_SOURCES].filter(l => qVisible.has(l));
    const datasets = order.map(label => {
      const vals = quarters.map(q => {
        const r = quarterly.find(x => x.source === label && x.quarter === q && x.publication === qPub);
        return r ? (isSent ? r.mean_sent : r.n_articles) : null;
      });
      const st = seriesStyle(label);
      return {
        label, data: vals,
        borderColor: st.color, backgroundColor: st.color,
        borderDash: st.dash, borderWidth: st.width,
        pointStyle: st.point, pointRadius: st.r, order: st.order,
        tension: 0.2, spanGaps: true, fill: false
      };
    });

    const yLabel = isSent ? 'Mean sentence sentiment' : 'Number of articles';
    const noteEl = document.getElementById('quarterly-note');
    if (noteEl) noteEl.textContent = isSent
      ? 'Sentiment = (positive − negative opinion-lexicon words) ÷ sentence length (Bing/Liu lexicon). Range roughly −1 to +1; 0 is neutral.'
      : 'Number of distinct articles per quarter in each series. An article can appear in more than one series.';

    if (qChart) qChart.destroy();
    qChart = new Chart(document.getElementById('quarterly-chart'), {
      type: 'line', data: { labels: quarters, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: {
            title: { display: true, text: yLabel },
            // auto-fit to the visible series (Bing-ratio sentiment lives in a
            // narrow band ~−0.05..+0.10); a fixed wide range would look flat
            ...(isSent ? { grace: '12%' } : { beginAtZero: true })
          }
        },
        plugins: {
          legend: { display: false },   // the chip rows are the legend
          tooltip: {
            callbacks: {
              label: c => `${c.dataset.label}: ${c.parsed.y == null ? '—' : isSent ? c.parsed.y.toFixed(3) : c.parsed.y}`
            }
          }
        }
      }
    });
  }
}

// ---- COUNTRY MAP ----
let cmapState = { layer: null, mode: 'mentions', byIso3: {}, maxMentions: 1, sentMid: 0.05, sentHalf: 0.025 };

function isoOf(feature) {
  const p = feature.properties;
  return p['ISO3166-1-Alpha-3'] || p.iso_a3 || p.ISO_A3 || p.adm0_a3;
}

// Sentiment shading is RELATIVE to the corpus median (all groups are net-positive
// on the Bing lexicon ratio, so a zero-centred scale would render everything the
// same pale green). Amber = cooler than China's typical tone, teal = warmer.
const SENT_WARM = [[244, 236, 222], [233, 201, 140], [201, 152, 66], [150, 103, 33]];
const SENT_COOL = [[244, 236, 222], [126, 178, 162], [47, 96, 99], [16, 51, 53]];
function sentColor(v) {
  if (v == null) return '#F4ECDE';
  const mid = cmapState.sentMid, half = cmapState.sentHalf || 0.02;
  if (v < mid) return interp(SENT_WARM, Math.min(1, (mid - v) / half));
  return interp(SENT_COOL, Math.min(1, (v - mid) / half));
}
function mentionColor(v, max) {
  if (!v) return '#F4ECDE';
  // sharper log curve, deeper deep end
  const t = Math.min(1, Math.log10(1 + v) / Math.log10(1 + max));
  const stops = [[244, 236, 222], [218, 180, 130], [184, 101, 29], [134, 64, 14], [70, 30, 6]];
  return interp(stops, t);
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

function initCountryMap(world, byCountry) {
  const m = {}; byCountry.forEach(r => { m[r.iso3] = r; });
  cmapState.byIso3 = m;
  cmapState.maxMentions = Math.max(...byCountry.map(r => r.mentions || 0), 1);
  // data-driven sentiment domain: centre on the median, half-window = p10..p90
  const sv = byCountry.map(r => r.mean_sentiment).filter(v => v != null).sort((a, b) => a - b);
  if (sv.length) {
    const q = p => sv[Math.min(sv.length - 1, Math.max(0, Math.round(p * (sv.length - 1))))];
    cmapState.sentMid = q(0.5);
    cmapState.sentHalf = Math.max(q(0.9) - cmapState.sentMid, cmapState.sentMid - q(0.1), 0.012);
  }

  const map = L.map('cmap-canvas', { scrollWheelZoom: false }).setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://carto.com/attributions">CARTO</a> · OSM',
    subdomains: 'abcd', maxZoom: 7, minZoom: 1
  }).addTo(map);

  function style(feature) {
    const iso3 = isoOf(feature);
    const r = cmapState.byIso3[iso3];
    let fill = '#EFEAE0';
    if (r) {
      fill = cmapState.mode === 'mentions'
        ? mentionColor(r.mentions, cmapState.maxMentions)
        : sentColor(r.mean_sentiment);
    }
    return { fillColor: fill, weight: 0.4, opacity: 1, color: '#fff', fillOpacity: 0.92 };
  }
  function onEach(feature, layer) {
    const iso3 = isoOf(feature);
    const r = cmapState.byIso3[iso3];
    const name = feature.properties.name || feature.properties.NAME || iso3;
    layer.on({
      mouseover: e => e.target.setStyle({ weight: 1.5, color: '#1B2733' }),
      mouseout: e => cmapState.layer.resetStyle(e.target),
      click: () => { if (r) window.location.href = `index.html#country=${iso3}`; }
    });
    if (r) {
      layer.bindTooltip(`
        <div style="font-family:Inter,sans-serif;font-size:.84rem">
          <b style="font-size:1rem">${name}</b><br>
          Mentions: <b>${(r.mentions || 0).toLocaleString()}</b><br>
          Mean sentiment: <b>${r.mean_sentiment == null ? '—' : r.mean_sentiment.toFixed(3)}</b>
        </div>`, { sticky: true });
    } else {
      layer.bindTooltip(`<b>${name}</b><br><span style="color:#5C6470">&lt;25 mentions</span>`, { sticky: true });
    }
  }
  cmapState.layer = L.geoJSON(world, { style, onEachFeature: onEach }).addTo(map);
  renderLegend();

  document.querySelectorAll('#cmap-mode button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#cmap-mode button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); cmapState.mode = b.dataset.mode;
      cmapState.layer.setStyle(style); renderLegend();
    });
  });

  function renderLegend() {
    const lg = document.getElementById('cmap-legend');
    if (cmapState.mode === 'mentions') {
      const m = cmapState.maxMentions;
      const stops = [0, m * 0.05, m * 0.2, m * 0.5, m];
      lg.innerHTML = stops.map(v =>
        `<span class="swatch"><i style="background:${mentionColor(v, m)}"></i> ${v === 0 ? '<25' : Math.round(v).toLocaleString()}</span>`
      ).join('') + '<span style="color:#5C6470">· log scale, mentions in GSI corpus</span>';
    } else {
      const mid = cmapState.sentMid, half = cmapState.sentHalf;
      const stops = [mid - half, mid - half / 2, mid, mid + half / 2, mid + half];
      lg.innerHTML = stops.map(v =>
        `<span class="swatch"><i style="background:${sentColor(v)}"></i> ${v.toFixed(3)}</span>`
      ).join('') + `<span style="color:#5C6470">· mean sentiment, shaded vs corpus median ${mid.toFixed(2)} (all groups net-positive)</span>`;
    }
  }
}

// ---- BY-SOURCE BAR / DOT ----
function initBySourceChart(bySource) {
  const sources = [...new Set(bySource.map(r => r.source))];
  const sumPerSrc = {};
  bySource.forEach(r => {
    if (!sumPerSrc[r.source]) sumPerSrc[r.source] = { mfa_n: 0, xin_n: 0, mfa_m: 0, xin_m: 0, mfa_w: 0, xin_w: 0 };
    const k = r.publication === 'MFA' ? 'mfa' : 'xin';
    sumPerSrc[r.source][`${k}_n`] += r.n_sentences;
    sumPerSrc[r.source][`${k}_m`] += r.mean_sent * r.n_sentences;
    sumPerSrc[r.source][`${k}_w`] += r.n_sentences;
  });
  sources.sort((a, b) => (sumPerSrc[b].mfa_n + sumPerSrc[b].xin_n) - (sumPerSrc[a].mfa_n + sumPerSrc[a].xin_n));
  const mfaVol = sources.map(s => sumPerSrc[s].mfa_n);
  const xinVol = sources.map(s => sumPerSrc[s].xin_n);
  const mfaSent = sources.map(s => sumPerSrc[s].mfa_w ? sumPerSrc[s].mfa_m / sumPerSrc[s].mfa_w : null);
  const xinSent = sources.map(s => sumPerSrc[s].xin_w ? sumPerSrc[s].xin_m / sumPerSrc[s].xin_w : null);

  new Chart(document.getElementById('bysource-chart'), {
    data: {
      labels: sources,
      datasets: [
        { type: 'bar', label: 'MFA volume', data: mfaVol, backgroundColor: '#1B2733', yAxisID: 'y' },
        { type: 'bar', label: 'Xinhua volume', data: xinVol, backgroundColor: '#B8651D', yAxisID: 'y' },
        { type: 'line', label: 'MFA mean sentiment', data: mfaSent, yAxisID: 'y1', borderColor: '#5C6470', backgroundColor: '#5C6470', pointRadius: 5, pointStyle: 'circle', showLine: false },
        { type: 'line', label: 'Xinhua mean sentiment', data: xinSent, yAxisID: 'y1', borderColor: '#B8651D', backgroundColor: '#B8651D', pointRadius: 5, pointStyle: 'triangle', showLine: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { position: 'left', title: { display: true, text: 'Sentence volume' } },
        y1: { position: 'right', title: { display: true, text: 'Mean sentiment' }, grid: { drawOnChartArea: false }, suggestedMin: -0.04, suggestedMax: 0.12 }
      },
      plugins: { legend: { position: 'bottom', labels: { font: { family: 'Inter' } } } }
    }
  });
}

// ---- ARTICLES SEARCH ----
let artState = { search: '', pub: 'all', sort: 'recent', shown: 25, open: {} };

function escapeHtml(s) {
  return ('' + (s || '')).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
function highlightGSI(html) {
  // Highlight GSI / Global Security Initiative / 全球安全倡议 (case insensitive)
  return html.replace(
    /(Global Security Initiative|全球安全倡议|\bGSI\b)/g,
    '<mark style="background:#FFE9A8;padding:0 .15em;border-radius:2px">$1</mark>'
  );
}

function initArticlesSearch(articles) {
  function render() {
    let list = [...articles].filter(a => a.sent_score != null);
    if (artState.pub !== 'all') list = list.filter(a => a.publication === artState.pub);
    if (artState.search) {
      const q = artState.search.toLowerCase();
      list = list.filter(a =>
        ('' + a.Headline).toLowerCase().includes(q) ||
        ('' + a.snippet).toLowerCase().includes(q) ||
        ('' + (a.body || '')).toLowerCase().includes(q)
      );
    }
    if (artState.sort === 'neg') list.sort((a, b) => a.sent_score - b.sent_score);
    else if (artState.sort === 'pos') list.sort((a, b) => b.sent_score - a.sent_score);
    else list.sort((a, b) => ('' + b.Date).localeCompare('' + a.Date));

    document.getElementById('art-count').textContent = `${list.length} articles`;
    const top = list.slice(0, artState.shown);
    document.getElementById('articles-list').innerHTML = top.map((a, idx) => {
      const score = a.sent_score == null ? '' : a.sent_score.toFixed(2);
      const scoreColor = a.sent_score < -0.1 ? '#8B1A1A' : a.sent_score > 0.1 ? '#2F6063' : '#5C6470';
      const pubChip = a.publication === 'MFA' ? 'slate' : 'copper';
      const key = a.ID + '-' + idx;
      const isOpen = !!artState.open[key];
      const headlineH = highlightGSI(escapeHtml(a.Headline || '(no headline)'));
      const bodyOrSnippet = isOpen && a.body
        ? '<div class="article-body">' +
          highlightGSI(escapeHtml(a.body)).replace(/\n+/g, '<br><br>') +
          '</div>'
        : `<p style="font-size:.88rem;color:#3a4654">${highlightGSI(escapeHtml(a.snippet || ''))}…</p>`;
      const toggleLabel = isOpen ? 'Collapse ▲' : 'Read full article ▼';
      return `
        <div data-key="${key}" class="article-row" style="padding:.7rem 0;border-bottom:1px solid var(--line)">
          <div style="display:flex;gap:.5rem;font-family:Inter,sans-serif;font-size:.78rem;color:var(--muted);margin-bottom:.25rem;flex-wrap:wrap">
            <span class="chip ${pubChip}">${a.publication}</span>
            <span>${a.Date || ''}</span>
            <span style="margin-left:auto;color:${scoreColor};font-weight:600">Sentiment ${score}</span>
          </div>
          <h4 style="font-size:1rem;margin-bottom:.25rem;cursor:pointer" class="article-toggle">${headlineH}</h4>
          ${bodyOrSnippet}
          ${a.body ? `<button class="article-toggle" style="background:none;border:none;color:var(--accent);font-family:Inter,sans-serif;font-size:.8rem;cursor:pointer;padding:.3rem 0">${toggleLabel}</button>` : ''}
        </div>`;
    }).join('');

    // Wire up clicks
    document.querySelectorAll('#articles-list .article-row').forEach(row => {
      const key = row.dataset.key;
      row.querySelectorAll('.article-toggle').forEach(el => {
        el.addEventListener('click', () => {
          artState.open[key] = !artState.open[key];
          render();
        });
      });
    });

    const moreBtn = document.getElementById('art-more');
    if (list.length > artState.shown) {
      moreBtn.style.display = 'inline-block';
      moreBtn.textContent = `Show 25 more (${list.length - artState.shown} remaining)`;
    } else moreBtn.style.display = 'none';
  }
  render();
  document.getElementById('art-search').addEventListener('input', e => { artState.search = e.target.value; artState.shown = 25; render(); });
  document.getElementById('art-pub').addEventListener('change', e => { artState.pub = e.target.value; artState.shown = 25; render(); });
  document.getElementById('art-sort').addEventListener('change', e => { artState.sort = e.target.value; render(); });
  document.getElementById('art-more').addEventListener('click', () => { artState.shown += 25; render(); });
}

// ---- BUILDER ----
function initBuilder(quarterly) {
  // Only the atomic rows: regional source groups × MFA/Xinhua. Exclude the
  // derived overlapping rows (publication 'both', 'All articles' totals, and
  // the doctrinal-phrase lines) so aggregations don't double-count.
  const data = quarterly
    .filter(r => REGIONAL_SOURCES.includes(r.source) && r.publication !== 'both')
    .map(r => ({
      source: r.source,
      publication: r.publication,
      quarter: '' + r.quarter,
      n_sentences: r.n_sentences || 0,
      mean_sent: r.mean_sent
    }));
  GSI.initChartBuilder({
    mount: 'media-builder',
    data,
    section: 'Media sentiment',
    dimensions: {
      categorical: ['source', 'publication', 'quarter'],
      quantitative: ['mean_sent', 'n_sentences']
    },
    labels: {
      source: 'Source group',
      publication: 'Publication (MFA / Xinhua)',
      quarter: 'Quarter',
      mean_sent: 'Mean sentence sentiment',
      n_sentences: 'Number of sentences'
    },
    presets: [
      {
        name: 'Mean sentiment by source group',
        spec: {
          mark: 'bar',
          encoding: {
            y: { field: 'source', type: 'nominal', sort: '-x' },
            yOffset: { field: 'publication', type: 'nominal' },
            x: { aggregate: 'mean', field: 'mean_sent', type: 'quantitative', title: 'Mean sentiment', stack: null },
            color: { field: 'publication', type: 'nominal' }
          }
        }
      },
      {
        name: 'Sentence volume by quarter',
        spec: {
          mark: 'bar',
          encoding: {
            x: { field: 'quarter', type: 'ordinal' },
            y: { aggregate: 'sum', field: 'n_sentences', type: 'quantitative', title: 'Sentences' },
            color: { field: 'source', type: 'nominal' }
          }
        }
      },
      {
        name: 'Sentiment over time, by source',
        spec: {
          mark: { type: 'line', point: true },
          encoding: {
            x: { field: 'quarter', type: 'ordinal' },
            y: { aggregate: 'mean', field: 'mean_sent', type: 'quantitative', title: 'Mean sentiment' },
            color: { field: 'source', type: 'nominal' }
          }
        }
      },
      {
        name: 'Volume vs sentiment (per source × quarter)',
        spec: {
          mark: { type: 'point', size: 80, opacity: 0.75, filled: true },
          encoding: {
            x: { field: 'n_sentences', type: 'quantitative', title: 'Sentence volume' },
            y: { field: 'mean_sent', type: 'quantitative', title: 'Mean sentiment' },
            color: { field: 'source', type: 'nominal' },
            shape: { field: 'publication', type: 'nominal' }
          }
        }
      }
    ]
  });
}
