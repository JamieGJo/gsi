// chart-builder.js — Vega-Lite "Build your own" tab, shared across sections
// Defensive version: waits for vegaEmbed, logs errors visibly.

GSI.initChartBuilder = function(opts) {
  const { mount, data, section, dimensions, presets } = opts;
  const quantDims = dimensions.quantitative || dimensions.numeric || [];
  const catDims   = dimensions.categorical || [];
  // Only these quantitatives are summable (money / counts); summing a mean,
  // ratio, ordinal rank or index is meaningless, so "Sum of …" is hidden otherwise.
  const additive  = dimensions.additive || [];
  const labels    = opts.labels || {};
  const labelOf   = (f) => labels[f] || f;
  // Colour dropdown only offers categoricals with few enough distinct values to
  // make a readable legend (drops e.g. 121 recipients / 73 funders).
  const maxColorCard = opts.maxColorCardinality || 20;
  const distinctCount = (f) => new Set(data.map(r => r[f])).size;
  const colorDims = catDims.filter(d => distinctCount(d) <= maxColorCard);
  // X axis offers the grouping dimensions. By default that's categoricals plus
  // quantitatives, but a section can pass xCategoricalOnly to drop the measures
  // (amount / count) from X — they belong on Y as an aggregate, and listing them
  // on X lets you pick the same field for both axes, which is meaningless.
  const xDims = opts.xCategoricalOnly
    ? [...new Set(catDims)]
    : [...new Set([...catDims, ...quantDims])];

  const root = document.getElementById(mount);
  if (!root) { console.warn('[builder] mount missing:', mount); return; }

  // ---- DOM ----
  root.innerHTML = `
    <div class="presets">
      ${presets.map((p, i) =>
        `<button data-i="${i}" class="${i === 0 ? 'on' : ''}">${p.name}</button>`
      ).join('')}
      <button data-i="custom">Build from scratch</button>
    </div>
    <div class="controls">
      <div class="ctrl-group">
        <div class="ctrl-label">Mark</div>
        <select class="ctrl" id="${mount}-mark">
          <option value="bar">Bar</option>
          <option value="line">Line</option>
          <option value="point">Point</option>
          <option value="area">Area</option>
        </select>
      </div>
      <div class="ctrl-group">
        <div class="ctrl-label">X axis</div>
        <select class="ctrl" id="${mount}-x">
          ${xDims.map(d => `<option value="${d}">${labelOf(d)}</option>`).join('')}
        </select>
      </div>
      <div class="ctrl-group">
        <div class="ctrl-label">Y axis</div>
        <select class="ctrl" id="${mount}-y">
          <option value="__count__">Count of records</option>
          ${quantDims.map(d => `<option value="__mean__${d}">Mean of ${labelOf(d)}</option>`).join('')}
          ${quantDims.filter(d => additive.includes(d)).map(d => `<option value="__sum__${d}">Sum of ${labelOf(d)}</option>`).join('')}
        </select>
      </div>
      <div class="ctrl-group">
        <div class="ctrl-label">Colour by</div>
        <select class="ctrl" id="${mount}-color">
          <option value="">(none)</option>
          ${colorDims.map(d => `<option value="${d}">${labelOf(d)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="vl-mount" id="${mount}-vl" style="min-height:420px">
      <div style="padding:1rem;color:var(--muted);font-family:Inter,sans-serif;font-size:.86rem">
        Loading chart…
      </div>
    </div>
    <div style="display:flex;gap:.6rem;margin-top:.6rem;font-family:Inter,sans-serif;font-size:.82rem;flex-wrap:wrap;align-items:center">
      <button id="${mount}-copy" style="background:#fff;border:1px solid var(--line);border-radius:6px;padding:.4rem .8rem;cursor:pointer;color:var(--accent);font-family:inherit">Copy citation</button>
      <button id="${mount}-perma" style="background:#fff;border:1px solid var(--line);border-radius:6px;padding:.4rem .8rem;cursor:pointer;color:var(--muted);font-family:inherit">Copy chart URL</button>
    </div>
  `;

  // ---- Helpers ----
  function el(id) { return document.getElementById(`${mount}-${id}`); }
  function setActive(idx) {
    root.querySelectorAll('.presets button').forEach(b => b.classList.remove('on'));
    const target = root.querySelector(`.presets button[data-i="${idx}"]`);
    if (target) target.classList.add('on');
  }

  function buildFromControls() {
    const mark = el('mark').value;
    const x = el('x').value;
    const y = el('y').value;
    const color = el('color').value;
    const xIsCat = catDims.includes(x);
    const enc = { x: { field: x, type: xIsCat ? 'nominal' : 'quantitative', title: labelOf(x) } };
    let agg = null;
    if (y === '__count__') {
      enc.y = { aggregate: 'count', type: 'quantitative', title: 'Count' };
      agg = 'count';
    } else if (y.startsWith('__sum__')) {
      const f = y.slice(7);
      enc.y = { aggregate: 'sum', field: f, type: 'quantitative', title: 'Sum of ' + labelOf(f) };
      agg = 'sum';
    } else if (y.startsWith('__mean__')) {
      const f = y.slice(8);
      enc.y = { aggregate: 'mean', field: f, type: 'quantitative', title: 'Mean of ' + labelOf(f) };
      agg = 'mean';
    }
    if (color) enc.color = { field: color, type: 'nominal', title: labelOf(color) };
    // For mean (non-summative) with colour, switch off stacking and group bars instead.
    // Handle whichever axis carries the aggregate (here it's always Y from controls).
    if (agg === 'mean' && color && (mark === 'bar' || mark === 'area')) {
      enc.y.stack = null;
      enc.xOffset = { field: color, type: 'nominal' };
    }
    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: mark === 'point' ? { type: 'point', size: 70, opacity: 0.75, filled: true } : mark,
      encoding: enc,
    };
  }

  function ensureLoaded(callback, tries) {
    tries = tries || 0;
    if (typeof vegaEmbed === 'function') return callback();
    if (tries > 40) {
      el('vl').innerHTML = '<div style="padding:1rem;color:#8B1A1A">Vega-Lite library failed to load. Check your connection.</div>';
      return;
    }
    setTimeout(() => ensureLoaded(callback, tries + 1), 50);
  }

  function applySpec(spec) {
    ensureLoaded(() => {
      const final = JSON.parse(JSON.stringify(spec));
      final.data = { values: data };
      // Compute an explicit pixel width from the mount's parent — `width: 'container'`
      // can resolve to 0 when the layout hasn't finished, producing an invisible canvas.
      const vlMount = document.getElementById(`${mount}-vl`);
      const measured = vlMount ? (vlMount.clientWidth - 32) : 0;
      // Cap width so charts never overflow on wide screens
      const cap = 760;
      let w = measured > 100 ? Math.min(measured, cap) : 640;
      if (!final.width) final.width = w;
      if (!final.height) final.height = 340;
      // Make sure axis labels and legends are counted *inside* the width budget
      if (!final.autosize) final.autosize = { type: 'fit', contains: 'padding' };
      if (!final.$schema) final.$schema = 'https://vega.github.io/schema/vega-lite/v5.json';
      if (!final.config) final.config = {};
      final.config.font = 'Inter, sans-serif';
      final.config.axis = Object.assign({
        labelColor: '#5C6470',
        titleColor: '#1F2933',
        labelFontSize: 13,
        titleFontSize: 14,
        labelLimit: 220
      }, final.config.axis || {});
      final.config.legend = Object.assign({
        labelFontSize: 13,
        titleFontSize: 13,
        labelColor: '#3a4654',
        titleColor: '#1F2933'
      }, final.config.legend || {});
      // Constrain bar thickness so wide containers don't produce huge bars
      final.config.bar = Object.assign({
        discreteBandSize: { band: 0.65 },
        continuousBandSize: 18
      }, final.config.bar || {});
      final.config.view = Object.assign({ stroke: null }, final.config.view || {});

      vegaEmbed(`#${mount}-vl`, final, {
        actions: { export: true, source: false, editor: false, compiled: false },
        renderer: 'canvas'
      }).then(() => {
        // Write the spec back to the URL hash (without bulky data)
        try {
          const small = JSON.parse(JSON.stringify(spec));
          delete small.data;
          const enc = btoa(unescape(encodeURIComponent(JSON.stringify(small))));
          if (enc.length < 1800) {
            history.replaceState(null, '', `#builder?spec=${enc}`);
          }
        } catch (e) { /* ignore */ }
      }).catch(err => {
        console.error('[builder] vegaEmbed failed', err, final);
        el('vl').innerHTML = `
          <div style="padding:1rem;color:#8B1A1A;font-family:Inter,sans-serif;font-size:.84rem">
            Chart couldn't be drawn — try a different combination.<br>
            <span style="color:#999;font-size:.78em">${(err && err.message) || err}</span>
          </div>`;
      });
    });
  }

  // ---- Wire presets ----
  root.querySelectorAll('.presets button').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.i;
      setActive(idx);
      if (idx === 'custom') {
        applySpec(buildFromControls());
      } else {
        const preset = presets[parseInt(idx)];
        // mirror preset's mark/x/color into the controls for clarity
        try {
          const enc = preset.spec.encoding || {};
          const mark = typeof preset.spec.mark === 'string' ? preset.spec.mark : preset.spec.mark.type;
          if (mark) el('mark').value = mark;
          if (enc.x && enc.x.field) el('x').value = enc.x.field;
          else if (enc.y && enc.y.field) el('x').value = enc.y.field;
          if (enc.color && enc.color.field) el('color').value = enc.color.field;
          else el('color').value = '';
        } catch (e) { /* ignore */ }
        applySpec(preset.spec);
      }
    });
  });

  // ---- Wire dropdowns ----
  ['mark', 'x', 'y', 'color'].forEach(id => {
    el(id).addEventListener('change', () => {
      setActive('custom');
      applySpec(buildFromControls());
    });
  });

  // ---- Citation ----
  el('copy').addEventListener('click', e => {
    GSI.copyCite(e.target, GSI.suggestedCitation(`${section} — custom chart`));
  });
  el('perma').addEventListener('click', e => {
    GSI.copyCite(e.target, window.location.href);
  });

  // ---- Initial render ----
  function loadFromHash() {
    const m = (window.location.hash || '').match(/spec=([^&]+)/);
    if (!m) return false;
    try {
      const spec = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      applySpec(spec);
      return true;
    } catch (e) { return false; }
  }

  if (!loadFromHash()) applySpec(presets[0].spec);
};
