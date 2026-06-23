// shared.js — nav, country picker, methods drawer, citation helper
// Loaded on every page. Exposes window.GSI = { country_master, openMethods, ... }

window.GSI = window.GSI || {};

// ---- Country picker -------------------------------------------------------
GSI.loadCountryMaster = async function() {
  if (GSI.country_master) return GSI.country_master;
  const res = await fetch('data/country_master.json');
  GSI.country_master = await res.json();
  return GSI.country_master;
};

GSI.initCountryPicker = async function() {
  const sel = document.getElementById('country-picker');
  if (!sel) return;
  const cm = await GSI.loadCountryMaster();
  const opts = [...cm].sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = '<option value="">— Country profile —</option>' +
    opts.map(c => `<option value="${c.iso3}">${c.name}</option>`).join('');
  sel.addEventListener('change', () => {
    if (sel.value) {
      window.location.href = `index.html#country=${sel.value}`;
    }
  });
};

// ---- Methods drawer -------------------------------------------------------
GSI.initMethodsDrawer = function(htmlContent, deepLinkHref) {
  // inject DOM
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <button class="methods-btn" id="methods-btn">Methods &amp; sources</button>
    <div class="methods-backdrop" id="methods-backdrop"></div>
    <aside class="methods-drawer" id="methods-drawer" aria-hidden="true">
      <div class="head">
        <h3>Methods &amp; sources</h3>
        <button class="close" id="methods-close" aria-label="Close">×</button>
      </div>
      <div class="body">${htmlContent}${
        deepLinkHref
          ? `<a class="deeplink" href="${deepLinkHref}">Read full methods →</a>`
          : ''
      }</div>
    </aside>`;
  document.body.appendChild(wrap);
  const btn = document.getElementById('methods-btn');
  const drawer = document.getElementById('methods-drawer');
  const bd = document.getElementById('methods-backdrop');
  const close = document.getElementById('methods-close');
  function open() { drawer.classList.add('open'); bd.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); }
  function shut() { drawer.classList.remove('open'); bd.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); }
  btn.addEventListener('click', open);
  close.addEventListener('click', shut);
  bd.addEventListener('click', shut);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') shut(); });
};

// ---- Citation helper ------------------------------------------------------
GSI.suggestedCitation = function(sectionName) {
  const url = window.location.href.split('#')[0] + (window.location.hash || '');
  const today = new Date().toISOString().slice(0, 10);
  return `Gruffydd-Jones, J. (2026). GSI Datasets — ${sectionName}. Retrieved ${today} from ${url}`;
};

GSI.copyCite = function(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied ✓';
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('done'); }, 1800);
  });
};

GSI.renderCitationBlock = function(mountId, sectionName, downloads) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  const cite = GSI.suggestedCitation(sectionName);
  const dlHtml = (downloads || []).map(d =>
    `<a href="${d.href}" download>↓ ${d.label} <span style="color:#5C6470;font-size:.78em">(${d.size})</span></a>`
  ).join('');
  mount.innerHTML = `
    <div class="download-block">
      <h3>Download &amp; cite</h3>
      <p style="font-size:.92rem;color:#3a4654">Raw data is released as CSV with a citation header line. Each file includes a suggested citation and a link back to this page.</p>
      <div class="row-dl">${dlHtml}</div>
      <div class="cite-box">
        <button class="copy" id="copy-cite-btn">Copy</button>
        ${cite}
      </div>
    </div>`;
  document.getElementById('copy-cite-btn').addEventListener('click', e => {
    GSI.copyCite(e.target, cite);
  });
};

// ---- Mark active nav link -------------------------------------------------
GSI.markActiveNav = function() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav .links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path || (path === 'index.html' && href === 'index.html')) {
      a.classList.add('current');
    }
  });
};

// ---- Cached world geojson (loaded once for any map) -----------------------
GSI.loadWorldGeo = async function() {
  if (window.__worldGeo) return window.__worldGeo;
  const res = await fetch('data/world.geojson');
  window.__worldGeo = await res.json();
  return window.__worldGeo;
};

// ---- Auto-init on DOMContentLoaded ---------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  GSI.initCountryPicker();
  GSI.markActiveNav();
});

// ---- Small util: nice number format --------------------------------------
GSI.fmt = (v, opts = {}) => {
  if (v == null || isNaN(v)) return '—';
  if (opts.money) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + v.toFixed(0);
  }
  if (opts.pct) return v.toFixed(1) + '%';
  return v.toLocaleString();
};

// ---- Small util: build a shared nav HTML block (injected per page) -------
GSI.navHTML = (currentPage) => `
  <div class="brand">
    <span class="zh">全球安全倡议</span><span class="dot">·</span>
    <span class="full-en">GSI Datasets</span>
  </div>
  <div class="links">
    <a href="index.html">Overview</a>
    <a href="signings.html">Signings</a>
    <a href="media.html">Media sentiment</a>
    <a href="expenditure.html">Expenditure</a>
    <a href="methods.html">Methods</a>
    <select id="country-picker" class="country-picker" aria-label="Jump to country profile"></select>
  </div>
`;
