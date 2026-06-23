// country-profile.js — the combined view at #country=ISO3 on index.html

// Wire the in-page inline country picker (mirrors the nav picker)
(async function initInlinePicker() {
  const sel = document.getElementById('country-picker-inline');
  if (!sel) return;
  const cm = await GSI.loadCountryMaster();
  const opts = [...cm].sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = '<option value="">— Select a country —</option>' +
    opts.map(c => `<option value="${c.iso3}">${c.name}</option>`).join('');
  // reflect current hash selection
  const m = (window.location.hash || '').match(/#country=([A-Z]{3})/i);
  if (m) sel.value = m[1].toUpperCase();
  sel.addEventListener('change', () => {
    if (sel.value) { window.location.hash = `country=${sel.value}`; window.location.reload(); }
  });

  // If no country selected, show a soft placeholder
  if (!m) {
    const mount = document.getElementById('country-profile-mount');
    if (mount && !mount.innerHTML.trim()) {
      mount.innerHTML = `
        <div style="background:#fff;border:1px dashed var(--line);border-radius:12px;padding:1.5rem;text-align:center;color:var(--muted);font-family:Inter,sans-serif">
          Select a country above to load its profile — signing status, media exposure, and security/surveillance expenditure received.
        </div>`;
    }
  }
})();

(async function() {
  const hash = window.location.hash;
  if (!hash.startsWith('#country=')) return;
  const iso3 = hash.replace('#country=', '').toUpperCase().trim();
  if (!iso3) return;

  const mount = document.getElementById('country-profile-mount');
  if (!mount) return;
  const cm = await GSI.loadCountryMaster();
  const country = cm.find(c => c.iso3 === iso3);
  if (!country) {
    mount.innerHTML = `<div style="background:#fff;border:1px dashed var(--line);border-radius:12px;padding:1.2rem;font-family:Inter,sans-serif">
      <b>Country not found:</b> <code>${iso3}</code>. Pick one from the dropdown above.</div>`;
    return;
  }
  document.title = `${country.name} — GSI Datasets`;
  document.body.setAttribute('data-section', 'combined');

  // Set the picker to the current selection
  const picker = document.getElementById('country-picker');
  if (picker) picker.value = iso3;

  // Load all datasets in parallel
  const [signings, mediaQuarterly, mediaByCountryAll, expDeals, expCountry] = await Promise.all([
    fetch('data/signings.json').then(r => r.json()),
    fetch('data/media_quarterly.json').then(r => r.json()),
    fetch('data/media_by_country_all.json').then(r => r.json()),
    fetch('data/expenditure_deals.json').then(r => r.json()),
    fetch('data/expenditure_country.json').then(r => r.json())
  ]);

  mount.innerHTML = `
    <div style="margin-bottom:1.2rem">
      <h2 style="font-size:2rem">${country.name} <span style="font-family:Inter,sans-serif;font-size:.7em;color:#5C6470;font-weight:400">(${iso3})</span></h2>
    </div>
    <div id="cc-signings" class="country-card signings"></div>
    <div id="cc-media" class="country-card media"></div>
    <div id="cc-expenditure" class="country-card expenditure"></div>`;

  // ---- Signing card ----
  const sg = signings.find(s => s.iso3 === iso3);
  document.getElementById('cc-signings').innerHTML = renderSigningCard(country, sg);

  // ---- Media card ----
  const mbc = mediaByCountryAll.find(m => m.iso3 === iso3);
  document.getElementById('cc-media').innerHTML = renderMediaCard(country, mediaQuarterly, mbc);
  drawMediaChart(country, mediaQuarterly);

  // ---- Expenditure card ----
  const deals = expDeals.filter(d => d.iso3 === iso3);
  const ec = expCountry.filter(e => e.iso3 === iso3);
  document.getElementById('cc-expenditure').innerHTML = renderExpCard(country, ec, deals);
  drawExpChart(country, ec);

  // Scroll the country profile section into view (otherwise the hash-only
  // navigation lands the user at the top of the overview page)
  const profileSection = document.getElementById('country-profile');
  if (profileSection) {
    requestAnimationFrame(() => {
      profileSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
})();

function renderSigningCard(country, sg) {
  let status = 'No support', statusChip = 'muted';
  if (sg && sg.LevelOfSupport === 'Bilateral support') {
    status = 'Bilateral support'; statusChip = 'jade';
  } else if (sg && sg.LevelOfSupport === 'Multilateral support') {
    status = 'Multilateral support only'; statusChip = 'copper';
  } else if (sg && sg.LevelOfSupport === 'Noncommittal') {
    status = 'Noncommittal'; statusChip = 'muted';
  }
  const year = (sg && sg.year) || '—';
  const forum = (sg && sg.Forum) || '—';
  const language = sg && sg.LanguageUsed ? sg.LanguageUsed : null;
  const implement = sg && sg.Implement ? sg.Implement : null;
  const implementText = implement
    ? (implement.toLowerCase() === 'join'
        ? '<span class="chip jade">Yes — agreed to implement</span>'
        : '<span class="chip muted">No — not yet committed to implement</span>')
    : '';
  const partnership = country.China_ally_label || (sg && sg.China_ally_label) || '—';
  const allyText = country.rand_ally === 1
    ? 'US ally (RAND 2017)'
    : country.rand_ally === 0 ? 'Non-ally' : '—';

  return `
    <div class="pre-h">GSI signing</div>
    <h3>Public support for the GSI</h3>
    <p style="margin-bottom:.5rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
      <span class="chip ${statusChip}" style="font-size:.78rem">${status}</span>
      ${sg && sg.Ranking != null ? `<span style="font-family:Inter,sans-serif;font-size:.84rem;color:#5C6470">Rank ${sg.Ranking}/5</span>` : ''}
      ${language ? `<span style="font-family:Inter,sans-serif;font-size:.85rem;color:#3a4654;font-style:italic">"${language}"</span>` : ''}
    </p>
    ${implementText ? `<p style="margin-bottom:.7rem">${implementText}</p>` : ''}
    <div class="cc-stats">
      <div class="cc-stat"><div class="num">${year}</div><div class="lbl">Signing year</div></div>
      <div class="cc-stat"><div class="num" style="font-size:.95rem;line-height:1.2">${forum}</div><div class="lbl">Forum</div></div>
      <div class="cc-stat"><div class="num" style="font-size:.95rem;line-height:1.2">${country.vdem_regime_label || '—'}</div><div class="lbl">V-Dem regime</div></div>
      <div class="cc-stat"><div class="num" style="font-size:.95rem;line-height:1.2">${allyText}</div><div class="lbl">U.S. alliance status</div></div>
      <div class="cc-stat"><div class="num" style="font-size:.95rem;line-height:1.2">${partnership}</div><div class="lbl">China partnership status</div></div>
    </div>
  `;
}

function renderMediaCard(country, mqAll, mbc) {
  // Prefer country-level mentions if the country has any, otherwise show
  // the regional source-group series.
  const region = country.media_region || 'UN';
  const hasCountry = mbc && mbc.mentions && mbc.mentions > 0;
  const ctryMean = hasCountry && mbc.mean_sentiment != null ? mbc.mean_sentiment.toFixed(3) : null;
  const ctryMentions = hasCountry ? mbc.mentions : 0;

  return `
    <div class="pre-h">Media mentions &amp; sentiment</div>
    <h3>How MFA + Xinhua have framed ${country.name}</h3>
    ${hasCountry
      ? `<p style="margin-bottom:.6rem;font-size:.92rem;color:#3a4654">
           Counting every MFA / Xinhua sentence on the GSI that mentions ${country.name} by name.
         </p>`
      : `<p style="margin-bottom:.6rem;font-size:.92rem;color:#3a4654">
           ${country.name} is rarely mentioned by name in the GSI corpus; below is the sentiment series for
           the regional class it belongs to (<b>${region}</b>).
         </p>`}
    <div class="cc-stats">
      <div class="cc-stat"><div class="num">${hasCountry ? ctryMean : '—'}</div><div class="lbl">Mean sentence sentiment (−1 to +1)</div></div>
      <div class="cc-stat"><div class="num">${hasCountry ? ctryMentions.toLocaleString() : '—'}</div><div class="lbl">Mentions in the corpus</div></div>
      <div class="cc-stat"><div class="num" style="font-size:.95rem;line-height:1.2">${region}</div><div class="lbl">Regional source group</div></div>
    </div>
    <div class="toggle" id="cc-media-pub" style="margin-top:.4rem">
      <button data-pub="both" class="on">Both</button>
      <button data-pub="MFA">MFA</button>
      <button data-pub="Xinhua">Xinhua</button>
    </div>
    <div style="position:relative;height:220px;margin-top:.6rem">
      <canvas id="media-chart"></canvas>
    </div>
    <p style="font-family:Inter,sans-serif;font-size:.74rem;color:var(--muted);margin-top:.4rem">Quarterly mean sentiment of sentences tagged for the <b>${region}</b> source group. Toggle to filter by publication.</p>
  `;
}

let _ccMediaChart = null;
function drawMediaChart(country, mqAll) {
  const region = country.media_region || 'UN';
  const regional = mqAll.filter(r => r.source === region);
  if (!regional.length) return;
  const quarters = [...new Set(regional.map(r => r.quarter))].sort();

  function seriesFor(pub) {
    const byQ = {};
    regional.forEach(r => {
      if (pub !== 'both' && r.publication !== pub) return;
      if (!byQ[r.quarter]) byQ[r.quarter] = { tot: 0, w: 0 };
      byQ[r.quarter].tot += r.mean_sent * r.n_sentences;
      byQ[r.quarter].w += r.n_sentences;
    });
    return quarters.map(q => byQ[q] && byQ[q].w ? byQ[q].tot / byQ[q].w : null);
  }

  function draw(pub) {
    if (_ccMediaChart) _ccMediaChart.destroy();
    _ccMediaChart = new Chart(document.getElementById('media-chart'), {
      type: 'line',
      data: {
        labels: quarters,
        datasets: [{
          label: pub === 'both' ? 'MFA + Xinhua' : pub,
          data: seriesFor(pub),
          borderColor: '#B8651D',
          backgroundColor: 'rgba(184,101,29,.15)',
          tension: .25, fill: true, spanGaps: true, pointRadius: 3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { suggestedMin: -0.5, suggestedMax: 0.5, title: { display: true, text: 'Mean sentence sentiment' } },
          x: { title: { display: false } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }
  draw('both');
  document.querySelectorAll('#cc-media-pub button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#cc-media-pub button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      draw(b.dataset.pub);
    });
  });
}

function renderExpCard(country, ec, deals) {
  const total = ec.reduce((a, r) => a + (r.amt_2023 || 0), 0);
  const dealCount = deals.length;
  const topDeals = [...deals].sort((a, b) => b.amt_2023 - a.amt_2023).slice(0, 3);
  return `
    <div class="pre-h">Security &amp; surveillance</div>
    <h3>Chinese security funding received</h3>
    <div class="cc-stats">
      <div class="cc-stat"><div class="num">${GSI.fmt(total, { money: true })}</div><div class="lbl">Total committed, 2000–2023</div></div>
      <div class="cc-stat"><div class="num">${dealCount}</div><div class="lbl">Deals (post-audit, surveillance-stripped)</div></div>
      <div class="cc-stat"><div class="num">${ec.length ? Math.max(...ec.map(r => r.year)) : '—'}</div><div class="lbl">Most recent commitment year</div></div>
    </div>
    <div style="position:relative;height:220px;margin-top:.6rem">
      <canvas id="exp-chart"></canvas>
    </div>
    ${topDeals.length ? `
      <h4 style="font-family:Inter,sans-serif;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--crimson);margin-top:1rem;margin-bottom:.5rem">Largest deals</h4>
      <ul style="list-style:none;padding:0;font-size:.88rem">
        ${topDeals.map(d => `<li style="padding:.45rem 0;border-bottom:1px solid #F0EBE0"><b>${GSI.fmt(d.amt_2023, { money: true })}</b> · ${d.year} · ${d.title || '—'}</li>`).join('')}
      </ul>` : ''}
  `;
}

function drawExpChart(country, ec) {
  if (!ec.length) {
    document.getElementById('exp-chart').parentElement.innerHTML =
      '<p style="font-style:italic;color:#5C6470;font-size:.9rem;text-align:center;padding:1rem">No security commitments recorded.</p>';
    return;
  }
  // Year-by-year cumulative + per-year bars
  ec.sort((a, b) => a.year - b.year);
  const labels = ec.map(r => r.year);
  new Chart(document.getElementById('exp-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Annual commitment',
        data: ec.map(r => r.amt_2023),
        backgroundColor: '#8B1A1A',
        borderRadius: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: {
          title: { display: true, text: 'USD (constant 2023)' },
          ticks: { callback: v => GSI.fmt(v, { money: true }) }
        }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// Listen for picker change → reload page on new country
window.addEventListener('hashchange', () => { window.location.reload(); });
