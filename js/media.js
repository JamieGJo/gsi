// media.js — Media sentiment page

// Brighter, more distinct palette for the quarterly source-group lines
const SOURCE_COLORS = {
  'USA/NATO': '#C0392B',   // strong red
  'UN':       '#2E5984',   // navy
  'ASEAN':    '#2F6063',   // jade
  'BRICS':    '#B8651D',   // copper
  'SCO':      '#7D3C98',   // purple
  'EU':       '#16A085',   // teal
  'AU':       '#D4AC0D'    // gold
};

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
  const totalSent = quarterly.reduce((a, r) => a + (r.n_sentences || 0), 0);
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
function initQuarterlyChart(quarterly) {
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

  function draw() {
    const isSent = qMetric === 'sentiment';
    const quarters = [...new Set(quarterly.map(r => r.quarter))].sort();
    // sources: exclude the 'All articles' sentinel rows (those are drawn separately)
    const sources = [...new Set(quarterly.filter(r => r.source !== 'All articles').map(r => r.source))];

    const datasets = sources.map(src => {
      const vals = quarters.map(q => {
        const r = quarterly.find(x => x.source === src && x.quarter === q && x.publication === qPub);
        return r ? (isSent ? r.mean_sent : r.n_articles) : null;
      });
      return {
        label: src,
        data: vals,
        borderColor: SOURCE_COLORS[src] || '#888',
        backgroundColor: SOURCE_COLORS[src] || '#888',
        tension: 0.2, spanGaps: true, pointRadius: 3, fill: false, borderWidth: 2.2
      };
    });

    // "All articles" total line
    const allVals = quarters.map(q => {
      const r = quarterly.find(x => x.source === 'All articles' && x.quarter === q && x.publication === qPub);
      return r ? (isSent ? r.mean_sent : r.n_articles) : null;
    });
    datasets.push({
      label: 'All articles',
      data: allVals,
      borderColor: '#000', backgroundColor: '#000',
      borderWidth: 2.5, borderDash: [6, 4], tension: 0.2, spanGaps: true,
      pointRadius: 4, pointStyle: 'rectRot', fill: false, order: 0
    });

    const yLabel = isSent ? 'Mean sentence sentiment' : 'Number of articles';
    const noteEl = document.getElementById('quarterly-note');
    if (noteEl) noteEl.textContent = isSent
      ? 'Sentiment scores roughly in −1 (very negative) to +1 (very positive); 0 is neutral. VADER-style compound score.'
      : 'Number of distinct articles per quarter containing sentences tagged to each source group. An article may appear in multiple groups.';

    if (qChart) qChart.destroy();
    qChart = new Chart(document.getElementById('quarterly-chart'), {
      type: 'line', data: { labels: quarters, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: {
            title: { display: true, text: yLabel },
            ...(isSent ? { suggestedMin: -0.3, suggestedMax: 0.3 } : { beginAtZero: true })
          }
        },
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: 'Inter' }, usePointStyle: true } },
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
let cmapState = { layer: null, mode: 'mentions', byIso3: {}, maxMentions: 1, sentMin: -0.3, sentMax: 0.5 };

function isoOf(feature) {
  const p = feature.properties;
  return p['ISO3166-1-Alpha-3'] || p.iso_a3 || p.ISO_A3 || p.adm0_a3;
}

function sentColor(v) {
  if (v == null) return '#F4ECDE';
  // higher-contrast diverging palette
  if (v < 0) {
    const t = Math.min(1, Math.abs(v) / 0.25);
    const stops = [[244, 236, 222], [222, 145, 116], [184, 53, 30], [110, 18, 10]];
    return interp(stops, t);
  }
  const t = Math.min(1, v / 0.45);
  const stops = [[244, 236, 222], [126, 178, 162], [47, 96, 99], [16, 51, 53]];
  return interp(stops, t);
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
      const stops = [-0.25, -0.1, 0, 0.15, 0.45];
      lg.innerHTML = stops.map(v =>
        `<span class="swatch"><i style="background:${sentColor(v)}"></i> ${v.toFixed(2)}</span>`
      ).join('') + '<span style="color:#5C6470">· mean sentence sentiment, −0.25…+0.45</span>';
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
        y1: { position: 'right', title: { display: true, text: 'Mean sentiment' }, grid: { drawOnChartArea: false }, suggestedMin: -0.1, suggestedMax: 0.25 }
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
  // Cast quarter to string so Vega treats it ordinally
  const data = quarterly.map(r => ({
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
