// signings.js — Signings page (map + table + builder)

// ---- Palettes (higher contrast) ----
const SUPPORT_COLOR = {
  'Bilateral support':    '#0E3437',  // very dark jade
  'Multilateral support': '#3A7274',  // mid jade
  'Noncommittal':         '#8FB3B6',  // pale jade
  'No support':           '#E1DACA'   // pale cream
};
// Rank scale 0..4 only (no rank 5 in this corpus)
const RANK_COLOR = ['#E1DACA','#B5C9CB','#7BA2A5','#3A7274','#0E3437'];
const RANK_FULL_LABEL = {
  0: 'No mention',
  1: 'Non-committal acknowledgement',
  2: 'Positive language but no explicit support',
  3: 'Simple support',
  4: 'High support (strongly / resolutely)'
};
const IMPL_COLOR = { 'Join': '#0B1419', 'Not join': '#8FB3B6' };

// VDem keys must match the JSON exactly (Title Case here)
const VDEM_COLOR = {
  'Liberal Democracy':   '#2C5F8F',
  'Electoral Democracy': '#7FAACD',
  'Electoral Autocracy': '#D5A04E',
  'Closed Autocracy':    '#9B2A2A'
};

// Non-GSI binary / categorical filter chips (always available regardless of color mode)
const NONGSI_FILTERS = [
  { field: 'US_ally_RAND',  value: 1, label: 'US ally' },
  { field: 'US_ally_RAND',  value: 0, label: 'Non-ally' },
  { field: 'vdem_regime_label', value: 'Liberal Democracy',   label: 'Liberal democracy' },
  { field: 'vdem_regime_label', value: 'Electoral Democracy', label: 'Electoral democracy' },
  { field: 'vdem_regime_label', value: 'Electoral Autocracy', label: 'Electoral autocracy' },
  { field: 'vdem_regime_label', value: 'Closed Autocracy',    label: 'Closed autocracy' },
  { field: 'OECD',           value: 'Yes', label: 'OECD member' },
  { field: 'China_neighbor', value: 'Yes', label: "China's neighbour" },
  { field: 'BRICS_member',   value: 'Yes', label: 'BRICS member' },
  { field: 'China_partnership', value: 'Yes', label: 'Has China partnership' },
  { field: 'China_partnership', value: 'No',  label: 'No China partnership' }
];

(async function init() {
  const [signings, world] = await Promise.all([
    fetch('data/signings.json').then(r => r.json()),
    GSI.loadWorldGeo()
  ]);
  // Derive a `China_partnership` Yes/No flag from China_ally_label
  signings.forEach(s => {
    s.China_partnership = (s.China_ally_label && s.China_ally_label.trim()) ? 'Yes' : 'No';
  });
  const byIso3 = {};
  signings.forEach(s => { if (s.iso3) byIso3[s.iso3] = s; });

  initStats(signings);
  initMap(world, byIso3);
  initTable(signings);
  initBuilder(signings);
})();

function statusOf(s) {
  if (!s) return 'No support';
  return s.LevelOfSupport || 'No support';
}

function initStats(signings) {
  const bilat = signings.filter(s => s.LevelOfSupport === 'Bilateral support').length;
  const multi = signings.filter(s => s.LevelOfSupport === 'Multilateral support').length;
  const impl  = signings.filter(s => (s.Implement || '').toLowerCase() === 'join').length;
  document.getElementById('s-bilat').textContent = bilat;
  document.getElementById('s-multi').textContent = multi;
  document.getElementById('s-implement').textContent = impl;
  const bilatAuto = signings.filter(s =>
    s.LevelOfSupport === 'Bilateral support' &&
    /autocracy/i.test(s.vdem_regime_label || '')).length;
  document.getElementById('s-share-auto').textContent =
    bilat ? Math.round(bilatAuto / bilat * 100) + '%' : '—';
}

// ---------------------------------------------------------------- MAP
let mapState = { layer: null, colorBy: 'support', filter: null };

function isoOf(feature) {
  const p = feature.properties;
  return p['ISO3166-1-Alpha-3'] || p.iso_a3 || p.ISO_A3 || p.adm0_a3;
}

function colorFor(s) {
  if (!s) return '#EFEAE0';
  switch (mapState.colorBy) {
    case 'support':
      return SUPPORT_COLOR[s.LevelOfSupport || 'No support'];
    case 'ranking': {
      const r = s.Ranking;
      if (r == null) return '#EFEAE0';
      return RANK_COLOR[Math.max(0, Math.min(4, r))];
    }
    case 'implement':
      return IMPL_COLOR[(s.Implement || '').trim()] || '#EFEAE0';
  }
  return '#EFEAE0';
}

function matchesFilter(s) {
  if (!mapState.filter) return true;
  const [field, value] = mapState.filter;
  if (!s) return false;
  return ('' + (s[field] ?? '')).toLowerCase() === ('' + value).toLowerCase();
}

function initMap(world, byIso3) {
  const map = L.map('map-canvas', { scrollWheelZoom: false }).setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://carto.com/attributions">CARTO</a> · OSM',
    subdomains: 'abcd', maxZoom: 7, minZoom: 1
  }).addTo(map);

  function style(feature) {
    const iso3 = isoOf(feature);
    const s = byIso3[iso3];
    const fill = colorFor(s);
    const dim = mapState.filter && !matchesFilter(s);
    return {
      fillColor: fill, weight: 0.4, opacity: 1, color: '#fff',
      fillOpacity: dim ? 0.15 : 0.95
    };
  }
  function onEach(feature, layer) {
    const iso3 = isoOf(feature);
    const s = byIso3[iso3];
    const name = feature.properties.name || feature.properties.NAME || iso3;
    layer.on({
      mouseover: e => e.target.setStyle({ weight: 1.5, color: '#1B2733' }),
      mouseout: e => mapState.layer.resetStyle(e.target),
      click: () => { if (s) window.location.href = `index.html#country=${iso3}`; }
    });
    if (s) {
      layer.bindTooltip(`
        <div style="font-family:Inter,sans-serif;font-size:.84rem">
          <b style="font-size:1rem">${name}</b><br>
          <b>${s.LevelOfSupport || 'No public support'}</b>
          ${s.Ranking != null ? ` (Rank ${s.Ranking})` : ''}<br>
          ${s.year ? `<span style="color:#5C6470">${s.year}, ${s.Forum || '—'}</span><br>` : ''}
          ${s.LanguageUsed ? `<i>${s.LanguageUsed}</i><br>` : ''}
          ${s.Implement ? `Implement: <b>${s.Implement === 'Join' ? 'Yes' : 'No'}</b><br>` : ''}
          ${s.China_ally_label ? `<span style="color:#5C6470">${s.China_ally_label}</span>` : ''}
        </div>`, { sticky: true });
    } else {
      layer.bindTooltip(`<b>${name}</b><br><span style="color:#5C6470">No data</span>`, { sticky: true });
    }
  }

  mapState.layer = L.geoJSON(world, { style, onEachFeature: onEach }).addTo(map);
  renderLegend();
  renderFilterChips();

  document.getElementById('map-colorby').addEventListener('change', e => {
    mapState.colorBy = e.target.value;
    mapState.layer.setStyle(style);
    renderLegend();
  });

  function renderLegend() {
    const lg = document.getElementById('map-legend');
    let html = '';
    switch (mapState.colorBy) {
      case 'support':
        html = Object.entries(SUPPORT_COLOR).map(([k, v]) =>
          `<span class="swatch"><i style="background:${v}"></i> ${k}</span>`).join('');
        break;
      case 'ranking':
        html = [0,1,2,3,4].map(r =>
          `<span class="swatch"><i style="background:${RANK_COLOR[r]}"></i><span style="margin-left:.25rem"><b>${r}</b> — ${RANK_FULL_LABEL[r]}</span></span>`
        ).join('');
        break;
      case 'implement':
        html = `<span class="swatch"><i style="background:${IMPL_COLOR['Join']}"></i> Agreed to implement</span>
                <span class="swatch"><i style="background:${IMPL_COLOR['Not join']}"></i> Not yet</span>`;
        break;
    }
    lg.innerHTML = html;
  }

  function renderFilterChips() {
    const wrap = document.getElementById('map-filter-chips');
    wrap.innerHTML = NONGSI_FILTERS.map((c, i) => {
      const on = mapState.filter && mapState.filter[0] === c.field && '' + mapState.filter[1] === '' + c.value;
      return `<button data-i="${i}" class="${on ? 'on' : ''}">${c.label}</button>`;
    }).join('') + `<button data-clear="1" style="background:transparent;border:none;color:var(--muted);font-size:.78rem;text-decoration:underline;cursor:pointer">clear</button>`;
    wrap.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.clear) mapState.filter = null;
        else {
          const c = NONGSI_FILTERS[parseInt(btn.dataset.i)];
          const on = mapState.filter && mapState.filter[0] === c.field && '' + mapState.filter[1] === '' + c.value;
          mapState.filter = on ? null : [c.field, c.value];
        }
        mapState.layer.setStyle(style);
        renderFilterChips();
      });
    });
  }
}

// ---------------------------------------------------------------- TABLE (20/page)
let tableState = { sortCol: 'country', sortDir: 1, filter: 'all', search: '', shown: 20 };

function initTable(signings) {
  const rows = signings.map(s => ({
    country: s.country || s.iso3, iso3: s.iso3, year: s.year,
    LevelOfSupport: s.LevelOfSupport || 'No support',
    Ranking: s.Ranking,
    Implement: s.Implement || '—',
    Forum: s.Forum || '—',
    LanguageUsed: s.LanguageUsed || '',
    vdem_regime_label: s.vdem_regime_label || '—'
  }));

  function render() {
    let filtered = rows;
    if (tableState.filter === 'implement') {
      filtered = filtered.filter(r => (r.Implement || '').toLowerCase() === 'join');
    } else if (tableState.filter === 'none') {
      filtered = filtered.filter(r => r.LevelOfSupport === 'No support');
    } else if (tableState.filter !== 'all') {
      filtered = filtered.filter(r => r.LevelOfSupport === tableState.filter);
    }
    if (tableState.search) {
      const q = tableState.search.toLowerCase();
      filtered = filtered.filter(r =>
        (r.country || '').toLowerCase().includes(q) ||
        (r.Forum || '').toLowerCase().includes(q) ||
        (r.vdem_regime_label || '').toLowerCase().includes(q) ||
        (r.LanguageUsed || '').toLowerCase().includes(q)
      );
    }
    filtered.sort((a, b) => {
      const av = a[tableState.sortCol]; const bv = b[tableState.sortCol];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * tableState.sortDir;
      return ('' + av).localeCompare('' + bv) * tableState.sortDir;
    });

    const top = filtered.slice(0, tableState.shown);
    const tbody = document.querySelector('#signings-table tbody');
    tbody.innerHTML = top.map(r => {
      const chip = chipFor(r.LevelOfSupport);
      const implBadge = (r.Implement || '').toLowerCase() === 'join'
        ? '<span class="chip jade">Yes</span>'
        : '<span class="chip muted">No</span>';
      return `<tr style="cursor:pointer" onclick="window.location.href='index.html#country=${r.iso3}'">
        <td><b>${r.country}</b></td>
        <td>${r.year || '—'}</td>
        <td>${chip}</td>
        <td style="text-align:center" title="${r.Ranking != null ? (RANK_FULL_LABEL[r.Ranking] || '') : ''}">${r.Ranking != null ? r.Ranking : '—'}</td>
        <td style="text-align:center">${implBadge}</td>
        <td>${r.Forum}</td>
        <td>${r.vdem_regime_label}</td>
      </tr>`;
    }).join('');
    document.getElementById('signings-count').textContent =
      `${filtered.length} of ${rows.length} countries · showing ${top.length}`;
    const moreBtn = document.getElementById('signings-more');
    if (filtered.length > tableState.shown) {
      moreBtn.style.display = 'inline-block';
      moreBtn.textContent = `Show 20 more (${filtered.length - tableState.shown} remaining)`;
    } else moreBtn.style.display = 'none';
  }

  function chipFor(s) {
    if (s === 'Bilateral support')    return '<span class="chip jade">Bilateral</span>';
    if (s === 'Multilateral support') return '<span class="chip copper">Multilateral</span>';
    if (s === 'Noncommittal')         return '<span class="chip muted">Noncommittal</span>';
    return '<span class="chip muted">No support</span>';
  }

  render();
  document.querySelectorAll('#signings-table thead th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (tableState.sortCol === col) tableState.sortDir *= -1;
      else { tableState.sortCol = col; tableState.sortDir = 1; }
      document.querySelectorAll('#signings-table thead th').forEach(x => x.classList.remove('sort-asc','sort-desc'));
      th.classList.add(tableState.sortDir === 1 ? 'sort-asc' : 'sort-desc');
      render();
    });
  });
  document.getElementById('signings-search').addEventListener('input', e => {
    tableState.search = e.target.value; tableState.shown = 20; render();
  });
  document.getElementById('signings-filter').addEventListener('change', e => {
    tableState.filter = e.target.value; tableState.shown = 20; render();
  });
  document.getElementById('signings-more').addEventListener('click', () => {
    tableState.shown += 20; render();
  });
}

// ---------------------------------------------------------------- BUILDER
function initBuilder(signings) {
  const data = signings.map(s => ({
    country: s.country,
    iso3: s.iso3,
    year: s.year != null ? s.year : null,
    Ranking: s.Ranking != null ? s.Ranking : null,
    Forum: s.Forum || 'None',
    LevelOfSupport: s.LevelOfSupport || 'No support',
    Implement: s.Implement || 'Not join',
    vdem: s.vdem_regime_label || 'Unknown',
    China_level: s.China_level != null ? s.China_level : null,
    China_ally_label: s.China_ally_label || 'None',
    rand_ally: s.US_ally_RAND === 1 ? 'US ally' : 'Non-ally',
    OECD: s.OECD || 'No',
    China_neighbor: s.China_neighbor || 'No',
    BRICS_member: s.BRICS_member || 'No',
    EDI: s.EDI != null ? s.EDI : null
  })).filter(r => true);

  GSI.initChartBuilder({
    mount: 'signings-builder',
    data,
    section: 'Signings',
    dimensions: {
      categorical: ['LevelOfSupport','vdem','Implement','rand_ally','OECD','China_neighbor','BRICS_member','Forum','year'],
      quantitative: ['Ranking','China_level','EDI']
    },
    labels: {
      LevelOfSupport: 'Level of public support',
      vdem: 'V-Dem regime',
      Implement: 'Agreed to implement?',
      rand_ally: 'U.S. ally (RAND 2017)',
      OECD: 'OECD member',
      China_neighbor: "China's neighbour",
      BRICS_member: 'BRICS member',
      Forum: 'Forum of signing',
      year: 'Signing year',
      Ranking: 'Rank of support (0–4)',
      China_level: 'China partnership level (0–7)',
      EDI: 'Economist Democracy Index'
    },
    presets: [
      {
        name: 'Support by V-Dem regime',
        spec: {
          mark: 'bar',
          encoding: {
            y: { field: 'vdem', type: 'nominal',
                 sort: ['Liberal Democracy','Electoral Democracy','Electoral Autocracy','Closed Autocracy'] },
            x: { aggregate: 'count', type: 'quantitative', title: 'Countries' },
            color: { field: 'LevelOfSupport', type: 'nominal',
                     scale: { domain: ['Bilateral support','Multilateral support','Noncommittal','No support'],
                              range: ['#0E3437','#3A7274','#8FB3B6','#E1DACA'] } }
          }
        }
      },
      {
        name: 'Rank vs China partnership level',
        spec: {
          mark: { type: 'point', size: 90, opacity: 0.75, filled: true },
          encoding: {
            x: { field: 'China_level', type: 'quantitative', title: 'China partnership level (0–7)' },
            y: { field: 'Ranking', type: 'quantitative', title: 'Rank (0–4)' },
            color: { field: 'vdem', type: 'nominal' },
            tooltip: [{ field: 'country' }, { field: 'Ranking' }, { field: 'China_level' }, { field: 'China_ally_label' }]
          }
        }
      },
      {
        name: 'Support by US ally (RAND)',
        spec: {
          mark: 'bar',
          encoding: {
            y: { field: 'rand_ally', type: 'nominal' },
            x: { aggregate: 'count', type: 'quantitative' },
            color: { field: 'LevelOfSupport', type: 'nominal',
                     scale: { domain: ['Bilateral support','Multilateral support','Noncommittal','No support'],
                              range: ['#0E3437','#3A7274','#8FB3B6','#E1DACA'] } }
          }
        }
      },
      {
        name: 'Forums used',
        spec: {
          mark: 'bar',
          transform: [{ filter: 'datum.LevelOfSupport != "No support"' }],
          encoding: {
            y: { field: 'Forum', type: 'nominal', sort: '-x' },
            x: { aggregate: 'count', type: 'quantitative' },
            color: { field: 'LevelOfSupport', type: 'nominal',
                     scale: { domain: ['Bilateral support','Multilateral support','Noncommittal','No support'],
                              range: ['#0E3437','#3A7274','#8FB3B6','#E1DACA'] } }
          }
        }
      }
    ]
  });
}
