/**
 * BMS Battery Card v5
 * 3D volumetric cells · comet-trail power flow · gradient icons · glassmorphism
 * New in v5:
 *  - 15-second (configurable) MQTT stale detection → monochrome gauge + Lost Connection
 *  - CHARGING overlay badge (top-right, blue glow)
 *  - Auto-reset energy counters (daily/weekly/monthly) with highlighted AUTO button
 *  - Flow animation stuck fix (generation counter + visibility handler)
 *  - Responsive container queries for 12/24/48-column grids
 * Install: copy to /config/www/bms-battery-card-v5.js
 * Resource: /local/bms-battery-card-v5.js  (JavaScript module)
 */
class BmsBatteryCardV5 extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._initialized    = false;
    this._flowChgActive  = false;
    this._flowDisActive  = false;
    this._flowRaf        = null;
    this._flowStart      = null;
    this._flowGen        = 0;
    this._lastSnapshotStr = null;
    this._lastChangeTime  = null;
    this._autoResetActive = false;
    this._autoResetMode   = 'none';
    this._autoResetTimer  = null;
    this._visibilityHandler = null;
    this._hasSynced = false;
  }

  disconnectedCallback() {
    if (this._flowRaf) cancelAnimationFrame(this._flowRaf);
    if (this._visibilityHandler) document.removeEventListener('visibilitychange', this._visibilityHandler);
    if (this._autoResetTimer) { clearTimeout(this._autoResetTimer); this._autoResetTimer = null; }
  }

  static getStubConfig() {
    return { title: 'Battery BMS', cellCount: 4, minCellVoltage: 3.0, maxCellVoltage: 3.55, staleTimeout: 15, entities: {} };
  }

  setConfig(cfg) {
    if (!cfg) throw new Error('Missing card configuration');
    this._config = { entities: {}, ...cfg };
    this._initialized = false;
    this._render();
  }

  set hass(h) {
    this._hass = h;
    if (!this._initialized) this._render();
    else this._update();
    // Sync auto-reset state from HA server once per render cycle (cross-device)
    if (this._initialized && !this._hasSynced) {
      this._hasSynced = true;
      this._syncAutoStateFromHA();
    }
  }

  getCardSize()    { return 14; }
  getLayoutOptions() { return { grid_columns: 4, grid_rows: 'auto' }; }

  _q(id)         { return this.shadowRoot.getElementById(id); }
  _set(id, html) { const e = this._q(id); if (e) e.innerHTML   = html; }
  _txt(id, txt)  { const e = this._q(id); if (e) e.textContent = txt;  }
  _cls(id, cls)  { const e = this._q(id); if (e) e.setAttribute('class', cls); }
  _sty(id, p, v) { const e = this._q(id); if (e) e.style[p]    = v;   }

  _state(eid) {
    if (!this._hass || !eid) return null;
    const s = this._hass.states[eid];
    return s ? s.state : null;
  }
  _num(eid) { const v = parseFloat(this._state(eid)); return isNaN(v) ? null : v; }
  _has(key) { return !!(this._config.entities || {})[key]; }

  // ── Colour helpers ────────────────────────────────────────────────────────
  _socColor(s) {
    if (s === null) return '#546e7a';
    if (s > 70) return '#00e676';
    if (s > 40) return '#ffd740';
    if (s > 20) return '#ffab40';
    return '#ff5252';
  }
  _fmtHours(raw) {
    if (raw === null || raw === undefined || raw === 'unavailable') return null;
    const num = parseFloat(raw);
    if (isNaN(num)) return String(raw);
    const totalMin = Math.round(num * 60);
    const days  = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins  = totalMin % 60;
    if (days > 0)  return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${String(mins).padStart(2,'0')}m`;
    return `${mins}m`;
  }
  _fmtDays(raw) {
    if (raw === null || raw === undefined || raw === 'unavailable') return null;
    const num = parseFloat(raw);
    if (isNaN(num)) return String(raw);
    const days  = Math.floor(num);
    const hours = Math.round((num % 1) * 24);
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    return `${hours}h`;
  }
  _cellColor(v) {
    if (!v) return '#37474f';
    const mx   = parseFloat(this._config.maxCellVoltage)      || 3.55;
    const lowV = parseFloat(this._config.lowVoltageThreshold) || 3.1;
    if (v >= mx - 0.015) return '#ffab40';
    if (v >= lowV)       return '#40c4ff';
    return '#c62828';
  }
  _cellGC(v) {
    const lowV = parseFloat(this._config.lowVoltageThreshold) || 3.1;
    if (!v) return { d:'#020d1c', l:'#29b6f6', m:'#0277bd', w:'rgba(64,196,255,' };
    const mx = parseFloat(this._config.maxCellVoltage) || 3.55;
    if (v >= mx - 0.015) return { d:'#bf360c', l:'#ff8a65', m:'#e64a19', w:'rgba(255,138,101,' };
    if (v >= lowV)       return { d:'#032040', l:'#29b6f6', m:'#0277bd', w:'rgba(41,182,246,'  };
    return                      { d:'#1a0305', l:'#c62828', m:'#7f0000', w:'rgba(180,20,20,'   };
  }
  _tempColorBat(t) {
    if (t === null) return '#37474f';
    if (t > 40 || t < 6) return '#ff5252';
    return '#43a047';
  }
  _tempFillBat(t) {
    if (t === null || t <= 0) return 'rgba(67,160,71,0.25)';
    if (t > 40 || t < 6) return 'linear-gradient(0deg,#b71c1c 0%,#ff5252 100%)';
    return 'linear-gradient(0deg,#1b5e20 0%,#66bb6a 100%)';
  }
  _tempColorMos(t) {
    if (t === null) return '#37474f';
    if (t > 60) return '#ff5252';
    return '#00897b';
  }
  _tempFillMos(t) {
    if (t === null || t <= 0) return 'rgba(0,137,123,0.25)';
    if (t > 60) return 'linear-gradient(0deg,#b71c1c 0%,#ff5252 100%)';
    return 'linear-gradient(0deg,#004d40 0%,#26a69a 100%)';
  }

  // ── 3-D Gradient icons ────────────────────────────────────────────────────
  _svgBolt() {
    return `<svg viewBox="0 0 40 40" width="38" height="38" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ibg" x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stop-color="#FFF176"/>
          <stop offset="55%" stop-color="#FFB300"/>
          <stop offset="100%" stop-color="#E65100"/>
        </linearGradient>
        <filter id="ibf" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#FF8F00" flood-opacity="0.6"/>
        </filter>
      </defs>
      <polygon points="24,4 9,22 20,22 16,36 31,18 20,18"
        fill="#BF360C" opacity="0.35" transform="translate(1.5,2.5)"/>
      <polygon points="24,4 9,22 20,22 16,36 31,18 20,18"
        fill="url(#ibg)" filter="url(#ibf)"/>
      <polygon points="24,4 16,16 20,16" fill="rgba(255,255,255,0.45)"/>
    </svg>`;
  }
  _svgSun() {
    return `<svg viewBox="0 0 40 40" width="38" height="38" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="isg" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#FFF9C4"/>
          <stop offset="45%" stop-color="#FFD600"/>
          <stop offset="100%" stop-color="#FF6D00"/>
        </radialGradient>
        <filter id="isf" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle cx="20" cy="20" r="14" fill="#FFD600" opacity="0.15" filter="url(#isf)"/>
      <g stroke="#FF8F00" stroke-width="2.5" stroke-linecap="round">
        <line x1="20" y1="3"  x2="20" y2="8"/>   <line x1="20" y1="32" x2="20" y2="37"/>
        <line x1="3"  y1="20" x2="8"  y2="20"/>  <line x1="32" y1="20" x2="37" y2="20"/>
        <line x1="7.2"  y1="7.2"  x2="10.8" y2="10.8"/>
        <line x1="29.2" y1="29.2" x2="32.8" y2="32.8"/>
        <line x1="32.8" y1="7.2"  x2="29.2" y2="10.8"/>
        <line x1="10.8" y1="29.2" x2="7.2"  y2="32.8"/>
      </g>
      <circle cx="20" cy="20" r="9" fill="url(#isg)"/>
      <ellipse cx="17" cy="16" rx="4.5" ry="2.5"
        fill="rgba(255,255,255,0.45)" transform="rotate(-15 17 16)"/>
    </svg>`;
  }
  _svgBat() {
    return `<svg viewBox="0 0 40 40" width="38" height="38" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ibag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1DE9B6"/>
          <stop offset="100%" stop-color="#00695C"/>
        </linearGradient>
        <linearGradient id="ibaf" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#69FF85"/>
          <stop offset="100%" stop-color="#00BFA5"/>
        </linearGradient>
        <filter id="ibaf2" x="-20%" y="-40%" width="140%" height="180%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#00BFA5" flood-opacity="0.55"/>
        </filter>
      </defs>
      <rect x="3"  y="12" width="28" height="16" rx="3.5"
        fill="url(#ibag)" filter="url(#ibaf2)"/>
      <rect x="4"  y="13" width="26" height="14" rx="3" fill="#071510"/>
      <rect x="5"  y="14.5" width="18" height="11" rx="2" fill="url(#ibaf)"/>
      <rect x="5"  y="14.5" width="18" height="4"  rx="2" fill="rgba(255,255,255,0.28)"/>
      <rect x="31" y="16.5" width="6"  height="7"  rx="2.5" fill="url(#ibag)"/>
      <rect x="3"  y="12" width="28" height="5"  rx="3.5" fill="rgba(255,255,255,0.1)"/>
    </svg>`;
  }
  _svgHome() {
    return `<svg viewBox="0 0 40 40" width="38" height="38" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ihrg" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stop-color="#CE93D8"/>
          <stop offset="100%" stop-color="#6A1B9A"/>
        </linearGradient>
        <linearGradient id="ihwg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#82B1FF"/>
          <stop offset="100%" stop-color="#3D5AFE"/>
        </linearGradient>
        <filter id="ihf" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#3D5AFE" flood-opacity="0.45"/>
        </filter>
      </defs>
      <ellipse cx="20" cy="37.5" rx="13" ry="2.5" fill="rgba(50,50,140,0.3)"/>
      <rect x="8" y="20" width="24" height="17" rx="2"
        fill="url(#ihwg)" filter="url(#ihf)"/>
      <polygon points="20,4 4,21 36,21" fill="url(#ihrg)"/>
      <polygon points="20,4 11.5,15.5 20,15.5" fill="rgba(255,255,255,0.25)"/>
      <rect x="15.5" y="26.5" width="9"  height="10.5" rx="1.5" fill="rgba(0,0,30,0.55)"/>
      <rect x="15.5" y="26.5" width="9"  height="4"    rx="1"   fill="rgba(130,177,255,0.25)"/>
      <rect x="10"   y="22"   width="7"  height="6"    rx="1.5" fill="rgba(255,255,255,0.22)"/>
      <rect x="23"   y="22"   width="7"  height="6"    rx="1.5" fill="rgba(255,255,255,0.22)"/>
      <rect x="8"    y="20"   width="24" height="4"    rx="2"   fill="rgba(255,255,255,0.15)"/>
    </svg>`;
  }

  // ── 3-D Battery cell SVG (unchanged from v4) ─────────────────────────────
  _cellSVG(i) {
    const u = `c${i + 1}`;
    const bodyPath = 'M 6,6 L 38,6 Q 43,6 43,11 L 43,77 Q 43,82 38,82 L 6,82 Q 1,82 1,77 L 1,11 Q 1,6 6,6 Z';
    return `<svg class="bat3d-svg" viewBox="0 0 44 88" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${u}bd" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stop-color="#010306"/>
          <stop offset="14%"  stop-color="#0c1824"/>
          <stop offset="50%"  stop-color="#16232e"/>
          <stop offset="86%"  stop-color="#0c1824"/>
          <stop offset="100%" stop-color="#010306"/>
        </linearGradient>
        <linearGradient id="${u}gl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="rgba(255,255,255,0.20)"/>
          <stop offset="40%"  stop-color="rgba(255,255,255,0.05)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
        </linearGradient>
        <linearGradient id="${u}fl" x1="0" y1="0%" x2="0" y2="100%">
          <stop id="${u}f2" offset="0%"   stop-color="#29b6f6"/>
          <stop id="${u}fm" offset="50%"  stop-color="#0277bd"/>
          <stop id="${u}f1" offset="100%" stop-color="#021628"/>
        </linearGradient>
        <clipPath id="${u}cp">
          <path d="${bodyPath}"/>
        </clipPath>
        <linearGradient id="${u}sh" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stop-color="rgba(255,255,255,0.30)"/>
          <stop offset="60%"  stop-color="rgba(255,255,255,0.05)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
        </linearGradient>
        <linearGradient id="${u}rs" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stop-color="rgba(0,0,0,0)"/>
          <stop offset="40%"  stop-color="rgba(0,0,0,0.08)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.35)"/>
        </linearGradient>
      </defs>
      <rect x="13" y="1" width="18" height="7" rx="2.5"
        fill="#0b1520" stroke="rgba(255,255,255,0.20)" stroke-width="0.6"/>
      <path d="${bodyPath}" fill="url(#${u}bd)" stroke="rgba(255,255,255,0.08)" stroke-width="0.7"/>
      <g clip-path="url(#${u}cp)">
      <g id="${u}liq" transform="translate(0,82)">
        <rect id="${u}base" x="1" y="0" width="42" height="76" fill="#020c18"/>
        <path id="${u}wb"
          d="M-88,7 C-66,-1 -22,15 0,7 C22,-1 66,15 88,7 C110,-1 154,15 176,7 L176,76 L-88,76 Z"
          fill="rgba(15,100,180,0.90)"/>
        <g id="${u}wfg">
          <path id="${u}wf"
            d="M-88,0 C-66,-8 -22,8 0,0 C22,-8 66,8 88,0 C110,-8 154,8 176,0 L176,76 L-88,76 Z"
            fill="url(#${u}fl)"/>
        </g>
        <rect x="1" y="0" width="7"  height="76" fill="url(#${u}sh)"/>
        <rect x="1" y="0" width="42" height="76" fill="url(#${u}rs)"/>
      </g>
      </g>
      <path d="${bodyPath}" fill="url(#${u}gl)" pointer-events="none"/>
      <ellipse cx="13" cy="13" rx="8"   ry="4"   fill="rgba(255,255,255,0.09)"/>
      <ellipse cx="8"  cy="9"  rx="3"   ry="1.8" fill="rgba(255,255,255,0.07)"/>
      <path id="${u}brd" d="${bodyPath}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="0.7"/>
    </svg>`;
  }

  // ── Quadratic Bézier helper ───────────────────────────────────────────────
  _bez(t, x0, y0, x1, y1, x2, y2) {
    const m = 1 - t;
    return { x: m*m*x0 + 2*m*t*x1 + t*t*x2,
             y: m*m*y0 + 2*m*t*y1 + t*t*y2 };
  }

  // ── RAF comet-trail flow animation (v5: generation counter + visibility fix) ─
  _startFlow() {
    if (this._flowRaf) cancelAnimationFrame(this._flowRaf);
    this._flowStart = null;
    const gen = ++this._flowGen;
    const tick = ts => {
      if (gen !== this._flowGen) return; // stale — a newer loop replaced us
      this._flowTick(ts);
      this._flowRaf = requestAnimationFrame(tick);
    };
    this._flowRaf = requestAnimationFrame(tick);
  }

  _flowTick(ts) {
    if (document.hidden) {
      // Tab not visible — keep _flowStart null so we restart cleanly when shown
      this._flowStart = null;
      return;
    }
    if (!this._flowStart) this._flowStart = ts;
    const elapsed = ts - this._flowStart;
    const pwr = this._flowPower || 0;
    const maxFlowPwr = parseFloat(this._config && this._config.maxFlowPower) || 800;
    const MIN_DUR = 650;
    const MAX_DUR = 2800;
    const frac = Math.min(1, pwr / maxFlowPwr);
    const DUR = Math.round(MAX_DUR - (MAX_DUR - MIN_DUR) * frac);
    const t1   = (elapsed           % DUR) / DUR;
    const t2   = ((elapsed + DUR/2) % DUR) / DUR;
    const wrap = this._q('flow-wrap');
    const W    = wrap ? wrap.offsetWidth : 300;
    const H    = 92;
    const TRAIL_OFFSETS = [0, 0.07, 0.13, 0.18];

    const run = (ids, active, t, bx0, by0, bx1, by1, bx2, by2) => {
      for (let j = 0; j < ids.length; j++) {
        const el = this._q(ids[j]);
        if (!el) continue;
        if (!active || t < TRAIL_OFFSETS[j]) { el.style.opacity = '0'; continue; }
        const ot  = t - TRAIL_OFFSETS[j];
        const pos = this._bez(ot, bx0, by0, bx1, by1, bx2, by2);
        const fade  = t < 0.1 ? t / 0.1 : t > 0.9 ? (1 - t) / 0.1 : 1;
        const alpha = j === 0 ? 1 : Math.pow(0.55, j);
        el.style.left    = `${(pos.x / 100) * W}px`;
        el.style.top     = `${(pos.y / 100) * H}px`;
        el.style.opacity = String(fade * alpha);
      }
    };

    run(['orb-c0','orb-c1','orb-c2','orb-c3'],
        this._flowChgActive, t1, 18,42, 34,8,  44,42);
    run(['orb-d0','orb-d1','orb-d2','orb-d3'],
        this._flowDisActive, t2, 56,42, 66,8, 82,42);

    const cellN    = this._config ? (parseInt(this._config.cellCount) || 4) : 4;
    const baseSpd  = parseFloat(this._config && this._config.waveSpeed)            || 0.009;
    const varFrac  = parseFloat(this._config && this._config.waveSpeedVariation);
    const revRatio = Math.max(0, Math.min(1,
      parseFloat(this._config && this._config.waveReverseRatio) || 0));
    const variation = isNaN(varFrac)
      ? Math.min(0.8, 0.3 + (cellN - 1) * 0.07)
      : Math.max(0, Math.min(1, varFrac));
    if (!this._waveParams) {
      const reverseCount = Math.round(cellN * revRatio);
      const rnds = Array.from({ length: cellN }, (_, i) => {
        const seed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
        return { i, rnd: seed - Math.floor(seed) };
      });
      const reversedSet = new Set(
        [...rnds].sort((a, b) => a.rnd - b.rnd)
                 .slice(0, reverseCount)
                 .map(x => x.i)
      );
      this._waveParams = Array.from({ length: 16 }, (_, i) => {
        const seed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
        const rnd  = seed - Math.floor(seed);
        const spdF = baseSpd * (1 - variation + rnd * variation * 2);
        const spdB = spdF * (0.75 + rnd * 0.15);
        const dir  = (i < cellN && reversedSet.has(i)) ? 1 : -1;
        return { spdF, spdB, phs: rnd * 88, dir };
      });
    }
    for (let i = 0; i < cellN; i++) {
      const p  = this._waveParams[i];
      const xf = p.dir * ((ts * p.spdF + p.phs) % 88);
      const xb = p.dir * ((ts * p.spdB + p.phs + 44) % 88);
      const wfg = this._q(`c${i + 1}wfg`);
      const wb  = this._q(`c${i + 1}wb`);
      if (wfg) wfg.setAttribute('transform', `translate(${xf.toFixed(2)},0)`);
      if (wb)  wb.setAttribute('transform',  `translate(${xb.toFixed(2)},0)`);
    }
  }

  _setArc(id, active) {
    if (id === 'arc-chg') this._flowChgActive = active;
    if (id === 'arc-dis') this._flowDisActive = active;
  }

  // ── Auto-reset helpers ────────────────────────────────────────────────────
  _storageKey() {
    return `bms-v5-autoreset-${(this._config.title || 'default').replace(/\W+/g, '_')}`;
  }
  _uiStateKey() {
    return `bms-v5-ui-${(this._config.title || 'default').replace(/\W+/g, '_')}`;
  }
  _saveAutoState() {
    const payload = { active: this._autoResetActive, mode: this._autoResetMode };
    // localStorage — instant access on this device
    try { localStorage.setItem(this._uiStateKey(), JSON.stringify(payload)); } catch {}
    // HA server — cross-device sync (fire and forget, graceful on older HA)
    if (this._hass && this._hass.connection) {
      this._hass.connection.sendMessagePromise({
        type: 'frontend/set_user_data',
        key:  this._uiStateKey(),
        value: payload
      }).catch(() => {});
    }
  }

  async _syncAutoStateFromHA() {
    if (!this._hass || !this._hass.connection) return;
    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: 'frontend/get_user_data',
        key:  this._uiStateKey()
      });
      if (result && result.value != null) {
        const d = result.value;
        this._autoResetActive = !!d.active;
        this._autoResetMode   = d.mode || 'none';
        this._updateAutoResetUI();
        this._scheduleAutoReset();
        // Refresh localStorage cache so next paint is instant
        try { localStorage.setItem(this._uiStateKey(), JSON.stringify({ active: this._autoResetActive, mode: this._autoResetMode })); } catch {}
      }
    } catch {
      // frontend/get_user_data not available on this HA version — localStorage + YAML fallback applies
    }
  }

  _loadAutoState() {
    // localStorage first — device-specific user overrides
    try {
      const s = localStorage.getItem(this._uiStateKey());
      if (s) { const d = JSON.parse(s); this._autoResetActive = !!d.active; this._autoResetMode = d.mode || 'none'; return; }
    } catch {}
    // Fall back to YAML config — the only cross-device option without a HA helper.
    // Set  autoResetEnabled: true  and  autoResetPeriod: daily|weekly|monthly  in YAML
    // and every browser/device will start with AUTO active from that config.
    if (this._config.autoResetEnabled !== undefined) {
      this._autoResetActive = !!this._config.autoResetEnabled;
      this._autoResetMode   = this._config.autoResetPeriod || 'none';
    }
  }

  _nextResetTime() {
    // Returns the next future threshold Date for the current reset mode, or null.
    const now = new Date();
    if (this._autoResetMode === 'daily') {
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return t;
    } else if (this._autoResetMode === 'weekly') {
      const t = new Date(now); t.setHours(0,0,0,0);
      // Next Monday
      t.setDate(t.getDate() + (7 - ((t.getDay() + 6) % 7)));
      return t;
    } else if (this._autoResetMode === 'monthly') {
      return new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }
    return null;
  }

  _scheduleAutoReset() {
    // Cancel any existing timer so re-scheduling is idempotent.
    if (this._autoResetTimer) { clearTimeout(this._autoResetTimer); this._autoResetTimer = null; }
    if (!this._autoResetActive || this._autoResetMode === 'none') return;

    const next = this._nextResetTime();
    if (!next) return;
    const msUntilNext = next.getTime() - Date.now();
    // Clamp to at least 1 s to avoid degenerate zero-delay loops.
    this._autoResetTimer = setTimeout(() => {
      this._autoResetTimer = null;
      this._performReset();
      try { localStorage.setItem(this._storageKey(), new Date().toISOString()); } catch {}
      // Reschedule for the NEXT period.
      this._scheduleAutoReset();
    }, Math.max(1000, msUntilNext));
  }

  _performReset() {
    const eid = (this._config.entities || {}).energy_clear_btn;
    if (eid && this._hass) {
      this._hass.callService('button', 'press', { entity_id: eid });
    }
  }

  _setupManualResetBtn() {
    const btn = this._q('btn-manual-reset');
    if (!btn) return;
    let timer = null;

    const start = (e) => {
      e.preventDefault();
      if (timer) return;
      btn.classList.add('pressing');
      timer = setTimeout(() => {
        timer = null;
        btn.classList.remove('pressing');
        this._performReset();
        // Brief green success flash
        btn.classList.add('success');
        setTimeout(() => btn.classList.remove('success'), 1400);
      }, 2000);
    };

    const cancel = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      btn.classList.remove('pressing');
    };

    btn.addEventListener('mousedown',   start);
    btn.addEventListener('touchstart',  start, { passive: false });
    btn.addEventListener('mouseup',     cancel);
    btn.addEventListener('mouseleave',  cancel);
    btn.addEventListener('touchend',    cancel);
    btn.addEventListener('touchcancel', cancel);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // _render
  // ═════════════════════════════════════════════════════════════════════════
  _render() {
    if (this._flowRaf) cancelAnimationFrame(this._flowRaf);
    this._waveParams      = null;
    this._lastSnapshotStr = null;
    this._lastChangeTime  = null;
    this._hasSynced       = false; // allow HA sync after re-render

    const n = this._config.cellCount || 4;
    this.shadowRoot.innerHTML = `<style>${this._css()}</style><ha-card>${this._html(n)}</ha-card>`;

    // Visibility fix: reset flowStart when tab becomes visible again
    if (this._visibilityHandler) document.removeEventListener('visibilitychange', this._visibilityHandler);
    this._visibilityHandler = () => { if (!document.hidden) this._flowStart = null; };
    document.addEventListener('visibilitychange', this._visibilityHandler);

    // Unified click delegation
    this.shadowRoot.addEventListener('click', ev => {
      // Switch chips (charge / discharge toggles)
      const chip = ev.target.closest('.sw-chip[data-entity]');
      if (chip && this._hass) {
        const eid = chip.dataset.entity;
        if (eid) {
          this._hass.callService(eid.split('.')[0], 'toggle', { entity_id: eid });
          chip.style.transform = 'scale(0.93)';
          setTimeout(() => { chip.style.transform = ''; }, 150);
        }
        return;
      }

      // Manual reset — handled by long-press listener, not click

      // Auto reset toggle button
      if (ev.target.closest('#btn-auto-reset')) {
        const sel = this._q('reset-period-sel');
        const mode = sel ? sel.value : 'none';
        if (!this._autoResetActive && mode === 'none') {
          // Flash select to indicate period must be chosen
          if (sel) { sel.style.borderColor = 'rgba(255,82,82,.7)'; setTimeout(() => { sel.style.borderColor = ''; }, 800); }
          return;
        }
        this._autoResetActive = !this._autoResetActive;
        if (this._autoResetActive) {
          this._autoResetMode = mode;
          // Seed last-reset to NOW so the first fire happens at the NEXT threshold,
          // not immediately because today's/this-week's midnight is already in the past.
          try { localStorage.setItem(this._storageKey(), new Date().toISOString()); } catch {}
        }
        this._updateAutoResetUI();
        this._scheduleAutoReset();
        this._saveAutoState();
        return;
      }

      // Period select change (also deactivates auto if was active)
      // handled via 'change' listener below
    });

    this.shadowRoot.addEventListener('change', ev => {
      if (ev.target && ev.target.id === 'reset-period-sel') {
        if (this._autoResetActive) {
          this._autoResetMode = ev.target.value;
          if (ev.target.value === 'none') { this._autoResetActive = false; }
          this._updateAutoResetUI();
          this._scheduleAutoReset();
          this._saveAutoState();
        }
      }
    });

    this._initialized = true;
    this._loadAutoState();
    this._scheduleAutoReset();
    this._updateAutoResetUI();
    this._setupManualResetBtn();
    this._startFlow();
    if (this._hass) this._update();
  }

  _updateAutoResetUI() {
    const btn = this._q('btn-auto-reset');
    const sel = this._q('reset-period-sel');
    if (btn) {
      btn.setAttribute('class', this._autoResetActive ? 'reset-btn-auto active' : 'reset-btn-auto');
      btn.textContent = this._autoResetActive ? '⚡ AUTO ON' : 'AUTO';
    }
    if (sel && this._autoResetActive) sel.value = this._autoResetMode;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // CSS
  // ═════════════════════════════════════════════════════════════════════════
  _css() { return `
    :host {
      --bg:#0a0e17; --surf:rgba(22,29,46,0.72); --surf2:rgba(28,40,60,0.85); --surf3:#242f47;
      --brd:rgba(255,255,255,0.07); --brd2:rgba(255,255,255,0.13);
      --green:#00e676; --blue:#40c4ff; --orange:#ffab40; --red:#ff5252;
      --yellow:#ffd740; --purple:#c084fc; --teal:#1de9b6;
      --txt:#f0f4ff; --txt2:#94a3b8; --txt3:#64748b;
      font-family:'Inter','Roboto',system-ui,sans-serif;
      -webkit-font-smoothing:antialiased;
      container-type:inline-size;
      container-name:bms-card;
      display:block;
    }
    ha-card {
      position:relative;
      background:rgba(10,14,23,0.90);
      backdrop-filter:blur(32px) saturate(170%);
      -webkit-backdrop-filter:blur(32px) saturate(170%);
      border-radius:24px; overflow:hidden;
      border:1px solid rgba(255,255,255,0.07);
      box-shadow:
        0 0 0 1px rgba(255,255,255,.014),
        0 32px 80px rgba(0,0,0,.85),
        inset 0 1px 0 rgba(255,255,255,.06);
    }

    /* ── CHARGING corner badge ── */
    .charging-badge {
      display:none;
      padding:6px 16px; border-radius:20px;
      background:rgba(0,180,255,0.13); border:1px solid rgba(64,196,255,0.55);
      color:#40c4ff; font-size:12px; font-weight:700;
      letter-spacing:.6px; text-transform:uppercase;
      white-space:nowrap;
      animation:chargingBadgePulse 2.2s ease-in-out infinite;
    }
    .charging-badge.visible { display:flex; align-items:center; }

    /* Accent bar */
    .accent {
      height:3px;
      background:linear-gradient(90deg,var(--green),var(--blue),var(--purple),var(--green));
      background-size:300% 100%; animation:gradFlow 6s linear infinite;
    }
    .accent.chg { background:linear-gradient(90deg,var(--green),var(--teal),var(--green)); background-size:300% 100%; animation:gradFlow 2s linear infinite; }
    .accent.dis { background:linear-gradient(90deg,var(--blue),var(--purple),var(--blue));  background-size:300% 100%; animation:gradFlow 2s linear infinite; }
    .accent.stale { background:#37474f; animation:none; }

    .inner { padding:16px 16px 18px; }

    /* Header */
    .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
    .title-row { display:flex; align-items:center; gap:10px; }
    .bat-icon {
      width:38px; height:38px; border-radius:10px;
      display:flex; align-items:center; justify-content:center;
      font-size:19px; border:1px solid var(--brd2);
      background:var(--surf); backdrop-filter:blur(8px);
      transition:border-color .5s, background .5s;
    }
    .bat-icon.chg { border-color:rgba(239,83,80,.35); background:rgba(239,83,80,.08); }
    .bat-icon.dis { border-color:rgba(255,143,0,.35);  background:rgba(255,143,0,.08); }
    .t-h2  { margin:0; font-size:15px; font-weight:700; color:var(--txt); letter-spacing:.3px; }
    .t-sub { font-size:10px; color:var(--txt3); text-transform:uppercase; letter-spacing:1.2px; margin-top:1px; }
    .pill { padding:6px 16px; border-radius:20px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; white-space:nowrap; border:1px solid; transition:all .4s; }
    .pill-idle { color:var(--txt2); background:rgba(51,65,85,.5);  border-color:rgba(100,116,139,.3); }
    .pill-dis  { color:#ffa726;    background:rgba(255,143,0,.12); border-color:rgba(255,143,0,.4); animation:pillGlowDis 2s ease-in-out infinite; }
    .pill-stale { color:#546e7a; background:rgba(84,110,122,.1); border-color:rgba(84,110,122,.3); }

    /* Hero */
    .hero { display:grid; grid-template-columns:240px 1fr; gap:14px; margin-bottom:14px; align-items:start; }
    .gauge-wrap  { position:relative; width:240px; height:240px; transition:filter 1.2s; }
    .gauge-wrap.stale { filter:grayscale(1) brightness(0.55); }
    .gauge-svg   { width:100%; height:100%; overflow:visible; }
    .gauge-svg.chg { animation:svgGlowWarm 2.5s ease-in-out infinite; }
    .gauge-svg.dis { animation:svgGlowAmber 2.5s ease-in-out infinite; }
    .g-bg    { fill:none; stroke:rgba(255,255,255,.02); stroke-width:18; }
    .g-track { fill:none; stroke:var(--surf2); stroke-width:10; stroke-linecap:round; }
    .g-fill  { fill:none; stroke-width:10; stroke-linecap:round; stroke-dasharray:0 263.9; transition:stroke-dasharray 1.4s cubic-bezier(.4,0,.2,1), stroke .7s; }
    .g-glow  { fill:none; stroke-width:16; stroke-linecap:round; opacity:0; stroke-dasharray:0 263.9; transition:stroke-dasharray 1.4s cubic-bezier(.4,0,.2,1), stroke .7s, opacity .6s; filter:blur(6px); }
    .gauge-center {
      position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
      text-align:center; pointer-events:none;
      display:flex; flex-direction:column; align-items:center;
    }
    .soc-num { font-size:60px; font-weight:600; line-height:1; letter-spacing:-1px; transition:color .6s; }
    .soc-pct-sym { font-size:17px; font-weight:300; opacity:.65; }
    .soc-sub  { font-size:11px; color:var(--txt2); margin-top:5px; }
    .soc-time { font-size:11px; color:var(--txt3); margin-top:2px; font-weight:500; }

    /* Stats */
    .right { display:flex; flex-direction:column; gap:8px; }
    .stats-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .stat {
      background:var(--surf); border:1px solid var(--brd); border-radius:12px;
      padding:10px 12px; backdrop-filter:blur(8px);
      transition:border-color .3s, transform .2s;
      text-align:center;
    }
    .stat:hover { border-color:var(--brd2); transform:translateY(-1px); }
    .stat-icon { font-size:16px; margin-bottom:4px; }
    .stat-lbl  { font-size:10px; color:var(--txt3); text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; }
    .stat-val  { font-size:22px; font-weight:700; color:var(--txt); line-height:1; }
    .u { font-size:12px; color:var(--txt2); font-weight:400; margin-left:1px; }

    /* ── MOSFET state chips — aligned with stat tiles ── */
    .mos-row {
      display:grid; grid-template-columns:1fr 1fr; gap:8px;
    }
    .mos-chip {
      display:flex; align-items:center; gap:6px;
      padding:9px 10px; border-radius:12px;
      background:var(--surf); border:1px solid var(--brd);
      transition:background .4s, border-color .4s;
      min-width:0;
    }
    .mos-led {
      width:8px; height:8px; border-radius:50%; flex-shrink:0;
      background:rgba(255,255,255,.14); box-shadow:none;
      transition:background .35s, box-shadow .35s;
    }
    .mos-chip-inner { display:flex; flex-direction:column; gap:1px; min-width:0; flex:1; }
    .mos-chip-lbl { font-size:8px; font-weight:700; color:var(--txt3); text-transform:uppercase; letter-spacing:.5px; white-space:nowrap; line-height:1; transition:color .4s; }
    .mos-chip-val { font-size:13px; font-weight:800; color:var(--txt3); letter-spacing:.3px; white-space:nowrap; line-height:1.2; transition:color .4s; }
    .mos-chip.mos-chg-on { background:rgba(255,171,64,.06); border-color:rgba(255,171,64,.25); }
    .mos-chip.mos-chg-on .mos-led { background:#ffab40; box-shadow:0 0 0 2px rgba(255,171,64,.18), 0 0 7px rgba(255,171,64,.55); }
    .mos-chip.mos-chg-on .mos-chip-lbl { color:rgba(255,171,64,.7); }
    .mos-chip.mos-chg-on .mos-chip-val { color:#ffab40; }
    .mos-chip.mos-dis-on { background:rgba(192,132,252,.06); border-color:rgba(192,132,252,.25); }
    .mos-chip.mos-dis-on .mos-led { background:#c084fc; box-shadow:0 0 0 2px rgba(192,132,252,.18), 0 0 7px rgba(192,132,252,.55); }
    .mos-chip.mos-dis-on .mos-chip-lbl { color:rgba(192,132,252,.7); }
    .mos-chip.mos-dis-on .mos-chip-val { color:#c084fc; }
    .mos-chip.mos-tripped { background:rgba(239,83,80,.04); border-color:rgba(239,83,80,.2); }
    .mos-chip.mos-tripped .mos-led { background:#ef5350; box-shadow:0 0 0 2px rgba(239,83,80,.15), 0 0 5px rgba(239,83,80,.4); }
    .mos-chip.mos-tripped .mos-chip-lbl { color:rgba(239,83,80,.55); }
    .mos-chip.mos-tripped .mos-chip-val { color:rgba(239,83,80,.7); }

    /* ── Power Flow ── */
    .flow-section {
      background:var(--surf); border:1px solid var(--brd); border-radius:16px;
      padding:12px 14px; margin-bottom:14px; backdrop-filter:blur(12px);
      transition:opacity .8s;
    }
    .flow-section.stale { opacity:0.4; }
    .sec-lbl { font-size:9px; font-weight:600; color:var(--txt3); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:10px; }
    .flow-wrap { position:relative; height:92px; }

    .flow-arcs { position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; overflow:visible; }
    .arc-track { fill:none; stroke-width:1.5; stroke-linecap:round; opacity:0.7; }

    .flow-orb { position:absolute; border-radius:50%; pointer-events:none; opacity:0; transform:translate(-50%,-50%); will-change:left,top,opacity; }
    .orb-c0 { width:8px; height:8px;
      background:radial-gradient(circle,#fff 0%,#00e676 45%,transparent 72%);
      box-shadow:0 0 6px 3px rgba(0,230,118,.85), 0 0 14px 6px rgba(0,230,118,.4); }
    .orb-c1 { width:6px; height:6px;
      background:radial-gradient(circle,#a7ffdb 0%,#00c853 60%,transparent 80%);
      box-shadow:0 0 4px 2px rgba(0,230,118,.55); }
    .orb-c2 { width:4px; height:4px; background:#00c853;
      box-shadow:0 0 3px 2px rgba(0,200,83,.45); }
    .orb-c3 { width:3px; height:3px; background:#00c853; }
    .orb-d0 { width:8px; height:8px;
      background:radial-gradient(circle,#fff 0%,#40c4ff 45%,transparent 72%);
      box-shadow:0 0 6px 3px rgba(64,196,255,.85), 0 0 14px 6px rgba(64,196,255,.4); }
    .orb-d1 { width:6px; height:6px;
      background:radial-gradient(circle,#b3e8ff 0%,#29b6f6 60%,transparent 80%);
      box-shadow:0 0 4px 2px rgba(64,196,255,.55); }
    .orb-d2 { width:4px; height:4px; background:#29b6f6;
      box-shadow:0 0 3px 2px rgba(41,182,246,.45); }
    .orb-d3 { width:3px; height:3px; background:#29b6f6; }

    .fnode { position:absolute; bottom:0; width:76px; transform:translateX(-50%); text-align:center; z-index:1; }
    .fnode-src  { left:10%; }
    .fnode-bat  { left:50%; }
    .fnode-load { left:90%; }
    .fn-ico {
      width:44px; height:44px; display:flex; align-items:center; justify-content:center;
      margin:0 auto 4px;
      filter:drop-shadow(0 3px 7px rgba(0,0,0,.55));
      transition:filter .3s, transform .3s;
    }
    .fn-ico svg { display:block; }
    .fn-ico.active-chg {
      filter:drop-shadow(0 0 10px rgba(0,230,118,.8)) drop-shadow(0 3px 7px rgba(0,0,0,.55));
      transform:scale(1.08);
    }
    .fn-ico.active-dis {
      filter:drop-shadow(0 0 10px rgba(64,196,255,.8)) drop-shadow(0 3px 7px rgba(0,0,0,.55));
      transform:scale(1.08);
    }
    .fn-val { font-size:15px; font-weight:800; line-height:1; margin-bottom:2px; }
    .fn-lbl { font-size:8px; color:var(--txt3); text-transform:uppercase; letter-spacing:.4px; }

    /* ── 3-D Battery cells (styles untouched) ── */
    .cells-section { margin-bottom:14px; }
    .row-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:9px; }
    .delta-badge {
      font-size:11px; font-weight:600; padding:2px 9px; border-radius:8px;
      background:rgba(255,215,64,.1); color:var(--yellow);
      border:1px solid rgba(255,215,64,.2);
      transition:color .3s, background .3s, border-color .3s, font-size .3s, padding .3s;
    }
    .cells-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
    .bat3d-item { display:flex; flex-direction:column; align-items:center; gap:4px; transition:transform .25s; }
    .bat3d-item:hover { transform:translateY(-3px); }
    .bat3d-lbl {
      font-size:9px; font-weight:600; color:var(--txt3);
      text-transform:uppercase; letter-spacing:.8px;
      display:flex; align-items:center; gap:2px;
    }
    .bat3d-marker { font-size:9px; font-weight:700; }
    .bat3d-svg {
      width:100%; height:auto;
      filter:drop-shadow(0 6px 14px rgba(0,0,0,.65));
      transition:filter .4s;
    }
    .bat3d-item.is-min .bat3d-svg {
      filter:drop-shadow(0 0 11px rgba(255,82,82,.7)) drop-shadow(0 6px 14px rgba(0,0,0,.65));
    }
    .bat3d-item.is-max .bat3d-svg {
      filter:drop-shadow(0 0 11px rgba(0,230,118,.7)) drop-shadow(0 6px 14px rgba(0,0,0,.65));
    }
    .bat3d-volt { font-size:13px; font-weight:700; transition:color .4s; }
    .bat3d-diff { font-size:10px; color:var(--txt3); letter-spacing:.2px; }
    .cell-placeholder { visibility:hidden; pointer-events:none; }

    /* ── Temperature ── */
    .temp-section { margin-bottom:14px; }
    .temp-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(68px,1fr)); gap:8px; }
    .temp-item {
      background:var(--surf); border:1px solid var(--brd); border-radius:12px;
      padding:11px 8px; text-align:center;
      display:flex; flex-direction:column; align-items:center; gap:5px;
      backdrop-filter:blur(8px); transition:border-color .4s;
    }
    .therm-wrap { display:flex; flex-direction:column; align-items:center; }
    .therm-tube {
      width:10px; height:52px; background:rgba(0,0,0,.35);
      border:1px solid rgba(255,255,255,.13); border-bottom:none;
      border-radius:5px 5px 0 0; position:relative; overflow:hidden;
    }
    .therm-tube::before {
      content:''; position:absolute; right:0; top:0; bottom:0; width:3px;
      background:repeating-linear-gradient(to bottom,transparent 0,transparent 5px,rgba(255,255,255,.07) 5px,rgba(255,255,255,.07) 6px);
    }
    .therm-fill { position:absolute; bottom:0; left:1px; right:1px; border-radius:3px 3px 0 0; min-height:2px; transition:height .9s, background .5s; }
    .therm-bulb { width:18px; height:18px; border-radius:50%; border:1px solid rgba(255,255,255,.15); margin-top:-1px; transition:background .5s, box-shadow .5s; }
    .temp-val  { font-size:21px; font-weight:700; line-height:1; transition:color .4s; }
    .temp-unit { font-size:11px; color:var(--txt2); font-weight:300; }
    .temp-lbl  { font-size:10px; color:var(--txt3); text-transform:uppercase; letter-spacing:.5px; }

    /* ── Toggle chips ── */
    .chips { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:14px; }
    .sw-chip {
      display:flex; align-items:center; justify-content:space-between; gap:6px;
      padding:11px 14px; border-radius:12px; font-size:13px; font-weight:600;
      border:1px solid var(--brd); background:var(--surf); backdrop-filter:blur(8px);
      cursor:pointer; user-select:none; transition:border-color .3s, background .3s;
    }
    .sw-chip:hover  { filter:brightness(1.15); }
    .sw-chip:active { transform:scale(0.96); }
    .sw-label { display:flex; align-items:center; gap:6px; color:var(--txt3); transition:color .3s; }
    .sw-icon  { font-size:17px; }
    .sw-toggle { width:30px; height:17px; border-radius:9px; flex-shrink:0; background:var(--surf2); border:1px solid var(--brd2); position:relative; transition:all .3s; }
    .sw-thumb  { position:absolute; top:3px; left:2px; width:11px; height:11px; border-radius:50%; background:var(--txt3); transition:all .3s; }
    .sw-chip.chip-chg-on { border-color:rgba(239,83,80,.4); animation:chipShimmerChg 2s ease-in-out infinite; }
    .sw-chip.chip-chg-on .sw-label { color:#ef5350; }
    .sw-chip.chip-chg-on .sw-toggle { background:rgba(239,83,80,.18); border-color:rgba(239,83,80,.5); animation:glowChgOn 2s ease-in-out infinite; }
    .sw-chip.chip-chg-on .sw-thumb  { left:17px; background:#ef5350; box-shadow:0 0 7px rgba(239,83,80,.75); }
    .sw-chip.chip-dis-on { border-color:rgba(255,143,0,.4); animation:chipShimmerDis 2s ease-in-out infinite; }
    .sw-chip.chip-dis-on .sw-label { color:#ffa726; }
    .sw-chip.chip-dis-on .sw-toggle { background:rgba(255,143,0,.15); border-color:rgba(255,143,0,.5); animation:glowDisOn 2s ease-in-out infinite; }
    .sw-chip.chip-dis-on .sw-thumb  { left:17px; background:#ffa726; box-shadow:0 0 7px rgba(255,143,0,.75); }
    .bal-indicator { display:flex; align-items:center; justify-content:center; gap:7px; padding:11px 4px; border-radius:12px; font-size:13px; font-weight:600; color:var(--txt3); border:1px solid var(--brd); background:var(--surf); backdrop-filter:blur(8px); transition:all .3s; }
    .bal-indicator.on { color:var(--purple); border-color:rgba(192,132,252,.35); background:rgba(192,132,252,.08); }
    .bal-dot { width:8px; height:8px; border-radius:50%; background:var(--txt3); transition:background .3s, box-shadow .3s; flex-shrink:0; }
    .bal-indicator.on .bal-dot { background:var(--purple); animation:pulseBalDot 1.4s ease-in-out infinite; }

    /* Footer */
    .divider { height:1px; background:var(--brd); margin-bottom:12px; }
    .footer-stats  { display:grid; grid-template-columns:repeat(auto-fit,minmax(72px,1fr)); gap:8px; margin-bottom:8px; }
    .footer-energy { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px; }
    .foot-item { background:var(--surf); border:1px solid var(--brd); border-radius:10px; padding:9px 6px; text-align:center; backdrop-filter:blur(8px); }
    .foot-icon { font-size:16px; margin-bottom:3px; }
    .foot-val { font-size:15px; font-weight:700; color:var(--txt); line-height:1; }
    .foot-lbl { font-size:10px; color:var(--txt3); text-transform:uppercase; letter-spacing:.7px; margin-top:4px; }

    /* ── Auto/Manual Reset section ── */
    .reset-section {
      background:var(--surf); border:1px solid var(--brd); border-radius:12px;
      padding:10px 12px; margin-bottom:8px; backdrop-filter:blur(8px);
    }
    .reset-lbl { font-size:9px; font-weight:600; color:var(--txt3); text-transform:uppercase; letter-spacing:1.4px; margin-bottom:8px; }
    .reset-controls { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .reset-select {
      flex:1; min-width:130px;
      background:rgba(15,22,38,0.85); border:1px solid var(--brd2);
      color:var(--txt2); border-radius:9px;
      padding:7px 10px; font-size:12px; font-family:inherit;
      cursor:pointer; outline:none; appearance:none;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E");
      background-repeat:no-repeat; background-position:right 10px center;
      padding-right:28px;
      transition:border-color .3s;
    }
    .reset-select:hover  { border-color:rgba(64,196,255,.45); }
    .reset-select:focus  { border-color:rgba(64,196,255,.65); }
    .reset-select option { background:#0d1424; color:var(--txt); }
    .reset-btn-auto {
      padding:7px 16px; border-radius:9px; border:1px solid var(--brd2);
      font-size:11px; font-weight:800; letter-spacing:1px;
      cursor:pointer; font-family:inherit; white-space:nowrap;
      color:var(--txt3); background:rgba(15,22,38,0.7);
      transition:all .3s;
    }
    .reset-btn-auto:hover { border-color:rgba(64,196,255,.45); color:#40c4ff; }
    .reset-btn-auto.active {
      color:#40c4ff;
      background:rgba(64,196,255,.15);
      border-color:rgba(64,196,255,.6);
      box-shadow:0 0 10px rgba(64,196,255,.25), inset 0 0 6px rgba(64,196,255,.06);
    }
    .reset-btn-manual {
      padding:7px 14px; border-radius:9px; border:1px solid var(--brd2);
      font-size:11px; font-weight:700; letter-spacing:.5px;
      cursor:pointer; font-family:inherit; white-space:nowrap;
      color:var(--txt3); background:rgba(15,22,38,0.7);
      transition:color .3s, border-color .3s, background .3s;
      position:relative; overflow:hidden;
      user-select:none; -webkit-user-select:none; touch-action:none;
    }
    /* Fill bar — slides in from left during long-press */
    .rbm-fill {
      position:absolute; inset:0; z-index:0; pointer-events:none;
      background:linear-gradient(90deg,rgba(255,82,82,.55) 0%,rgba(220,55,35,.22) 100%);
      transform:scaleX(0); transform-origin:left center;
      transition:none; border-radius:inherit;
    }
    .rbm-txt { position:relative; z-index:1; }
    .reset-btn-manual:hover { color:var(--red); border-color:rgba(255,82,82,.4); }
    /* Pressing state — fill animates over 2 s */
    .reset-btn-manual.pressing { color:var(--red); border-color:rgba(255,82,82,.65); }
    .reset-btn-manual.pressing .rbm-fill { transform:scaleX(1); transition:transform 2s linear; }
    /* Success flash — green fill for 1.4 s */
    .reset-btn-manual.success { color:var(--green); border-color:rgba(0,230,118,.5); }
    .reset-btn-manual.success .rbm-fill {
      background:rgba(0,230,118,.22); transform:scaleX(1); transition:none;
    }

    .status-bar { margin-top:10px; padding:6px 10px; border-radius:8px; text-align:center; font-size:10px; color:var(--txt3); letter-spacing:.4px; transition:all .3s; }
    .status-bar.alert { color:var(--red); background:rgba(255,82,82,.07); border:1px solid rgba(255,82,82,.2); animation:glowRed 2s ease-in-out infinite; }
    .status-bar.stale { color:#546e7a; background:rgba(84,110,122,.07); border:1px solid rgba(84,110,122,.25); }

    /* ── Connection status dot ── */
    .conn-dot { font-size:10px; transition:color .5s; }
    .conn-dot.live { color:var(--green); animation:connDotLive 2.5s ease-in-out infinite; }
    .conn-dot.lost { color:var(--red);   animation:connDotLost 1.2s ease-in-out infinite; }

    /* ══ Keyframes ══ */
    @keyframes gradFlow        { 0%{background-position:0 50%} 100%{background-position:300% 50%} }
    @keyframes glowChgOn       { 0%,100%{box-shadow:0 0 4px rgba(239,83,80,.15)} 50%{box-shadow:0 0 16px rgba(239,83,80,.6)} }
    @keyframes glowDisOn       { 0%,100%{box-shadow:0 0 4px rgba(255,143,0,.15)} 50%{box-shadow:0 0 16px rgba(255,143,0,.6)} }
    @keyframes glowRed         { 0%,100%{box-shadow:0 0 4px rgba(255,82,82,.12)} 50%{box-shadow:0 0 18px rgba(255,82,82,.5)} }
    @keyframes pulseBalDot     { 0%,100%{box-shadow:0 0 4px rgba(192,132,252,.4)} 50%{box-shadow:0 0 12px rgba(192,132,252,.85)} }
    @keyframes svgGlowWarm     { 0%,100%{filter:drop-shadow(0 0 5px rgba(239,83,80,.3))} 50%{filter:drop-shadow(0 0 18px rgba(239,83,80,.8))} }
    @keyframes svgGlowAmber    { 0%,100%{filter:drop-shadow(0 0 5px rgba(255,143,0,.3))} 50%{filter:drop-shadow(0 0 18px rgba(255,143,0,.8))} }
    @keyframes pillGlowDis     { 0%,100%{box-shadow:0 0 4px rgba(255,143,0,.25)} 50%{box-shadow:0 0 16px rgba(255,143,0,.75)} }
    @keyframes chipShimmerChg  { 0%,100%{box-shadow:0 0 4px rgba(239,83,80,.12)} 50%{box-shadow:0 0 20px rgba(239,83,80,.65),inset 0 0 8px rgba(239,83,80,.08)} }
    @keyframes chipShimmerDis  { 0%,100%{box-shadow:0 0 4px rgba(255,143,0,.12)} 50%{box-shadow:0 0 20px rgba(255,143,0,.65),inset 0 0 8px rgba(255,143,0,.08)} }
    @keyframes connDotLive     { 0%,100%{opacity:.7}  50%{opacity:1} }
    @keyframes connDotLost     { 0%,100%{opacity:1}   50%{opacity:.25} }
    @keyframes chargingBadgePulse { 0%,100%{box-shadow:0 0 8px rgba(64,196,255,.25)} 50%{box-shadow:0 0 22px rgba(64,196,255,.75), inset 0 0 10px rgba(64,196,255,.08)} }
    @keyframes autoResetPulse  { 0%,100%{box-shadow:0 0 6px rgba(64,196,255,.2)} 50%{box-shadow:0 0 18px rgba(64,196,255,.65)} }

    /* ══ Responsive — 5 tiers via CSS container queries ══════════════════════
       Tier 1  < 340px   ultra-narrow  (12 cols on a small phone / tiny widget)
       Tier 2  340–479px narrow        (phone portrait, 12 cols on a standard phone)
       Tier 3  480–639px medium        (phone landscape / 24-col narrow card)
       Tier 4  640–899px wide          (tablet, 24-col full / 48-col half-width)
       Tier 5  ≥ 900px   desktop       (full-width desktop, 48-col wide)
    ══════════════════════════════════════════════════════════════════════════ */

    /* ── Tier 1: < 340px ─────────────────────────────────────────────────── */
    @container bms-card (max-width: 339px) {
      .inner { padding:10px 10px 12px; }

      /* Header */
      .t-h2 { font-size:13px; }
      .pill, .charging-badge { padding:4px 8px; font-size:9px; letter-spacing:.3px; }

      /* Hero — stacked, compact gauge */
      .hero { grid-template-columns:1fr; gap:10px; }
      .gauge-wrap { width:160px; height:160px; margin:0 auto; }
      .soc-num { font-size:44px; }
      .soc-sub { font-size:10px; }

      /* Stats */
      .stat { padding:8px 8px; }
      .stat-icon { font-size:13px; }
      .stat-val { font-size:17px; }
      .stat-lbl { font-size:9px; }
      .mos-chip { padding:7px 8px; }
      .mos-chip-val { font-size:11px; }

      /* Flow section — compact */
      .flow-section { padding:9px 10px; }
      .fn-ico { width:36px; height:36px; }
      .fn-val { font-size:13px; }

      /* Cells */
      .cells-grid { gap:6px; }
      .bat3d-volt { font-size:11px; }
      .bat3d-diff { font-size:9px; }

      /* Chips — single column, stacked */
      .chips { grid-template-columns:1fr; gap:6px; }
      .sw-chip { padding:9px 12px; font-size:12px; }
      .bal-indicator { padding:9px 12px; font-size:12px; }

      /* Footer */
      .foot-val { font-size:13px; }
      .foot-lbl { font-size:9px; }

      /* Reset */
      .reset-controls { flex-direction:column; align-items:stretch; }
      .reset-select { min-width:0; }
      .reset-btn-auto, .reset-btn-manual { text-align:center; width:100%; box-sizing:border-box; }
    }

    /* ── Tier 2: 340–479px ───────────────────────────────────────────────── */
    @container bms-card (min-width: 340px) and (max-width: 479px) {
      .inner { padding:12px 12px 14px; }

      /* Header */
      .pill, .charging-badge { padding:5px 11px; font-size:10px; }

      /* Hero — stacked, medium gauge */
      .hero { grid-template-columns:1fr; gap:12px; }
      .gauge-wrap { width:185px; height:185px; margin:0 auto; }
      .soc-num { font-size:52px; }

      /* Stats — full width 2-col grid looks clean */
      .stat-val { font-size:19px; }

      /* Chips — Charge | Discharge on row 1, Balance spans full row 2 */
      .chips { grid-template-columns:1fr 1fr; gap:7px; }
      .bal-indicator { grid-column:1 / -1; }
      .sw-chip { padding:10px 10px; font-size:12px; }

      /* Reset — stacked */
      .reset-controls { flex-direction:column; align-items:stretch; gap:6px; }
      .reset-select { min-width:0; }
      .reset-btn-auto, .reset-btn-manual { text-align:center; }

      /* Cells */
      .cells-grid { gap:7px; }
    }

    /* ── Tier 3: 480–639px ───────────────────────────────────────────────── */
    @container bms-card (min-width: 480px) and (max-width: 639px) {
      /* Hero — side-by-side, medium gauge */
      .hero { grid-template-columns:195px 1fr; gap:12px; }
      .gauge-wrap { width:195px; height:195px; }
      .soc-num { font-size:52px; }

      /* Chips — 3 col but tighter padding */
      .chips { grid-template-columns:1fr 1fr 1fr; gap:7px; }
      .sw-chip { padding:10px 9px; font-size:12px; }
      .bal-indicator { padding:10px 4px; font-size:12px; }

      /* Reset — wraps naturally */
      .reset-controls { flex-wrap:wrap; }
      .reset-select { flex:1 1 120px; min-width:0; }
    }

    /* ── Tier 4: 640–899px ───────────────────────────────────────────────── */
    @container bms-card (min-width: 640px) and (max-width: 899px) {
      /* Hero */
      .hero { grid-template-columns:220px 1fr; gap:14px; }
      .gauge-wrap { width:220px; height:220px; }
      .soc-num { font-size:56px; }

      /* Flow */
      .fn-ico { width:50px; height:50px; }
      .fn-val { font-size:16px; }
      .sec-lbl { font-size:11px; letter-spacing:1.6px; }

      /* Chips — all 3 columns */
      .chips { grid-template-columns:1fr 1fr 1fr; gap:8px; }
    }

    /* ── Tier 5: ≥ 900px (desktop / wide) ───────────────────────────────── */
    @container bms-card (min-width: 900px) {
      .hero { grid-template-columns:250px 1fr; gap:16px; }
      .gauge-wrap { width:250px; height:250px; }
      .soc-num { font-size:62px; }

      .fn-ico { width:60px; height:60px; }
      .fn-val { font-size:18px; }
      .sec-lbl { font-size:12px; letter-spacing:1.8px; }

      .stat { padding:12px 14px; }
      .stat-val { font-size:24px; }

      .chips { gap:10px; }
      .sw-chip { padding:12px 16px; font-size:14px; }
      .bal-indicator { padding:12px 6px; font-size:14px; }
    }
  `; }

  // ═════════════════════════════════════════════════════════════════════════
  // HTML
  // ═════════════════════════════════════════════════════════════════════════
  _html(n) {
    const e = this._config.entities || {};

    const COLS   = 4;
    const padded = Math.ceil(n / COLS) * COLS;
    const cells  = Array.from({ length: padded }, (_, i) => {
      if (i >= n) return `<div class="bat3d-item cell-placeholder"></div>`;
      return `
      <div class="bat3d-item" id="cell-${i+1}">
        <div class="bat3d-lbl" id="cell-num-${i+1}">C${i+1}</div>
        ${this._cellSVG(i)}
        <div class="bat3d-volt" id="cv-${i+1}">--</div>
        <div class="bat3d-diff" id="cd-${i+1}"></div>
      </div>`;
    }).join('');

    const tempDefs = [
      ['1','Bat 1', e.temperature_sensor_1],
      ['2','Bat 2', e.temperature_sensor_2],
      ['3','Bat 3', e.temperature_sensor_3],
      ['4','Bat 4', e.temperature_sensor_4],
      ['mos','MOS', e.power_tube_temperature],
    ].filter(([,, eid]) => eid);

    const tempSection = tempDefs.length > 0 ? `
    <div class="temp-section">
      <div class="sec-lbl">🌡️ Temperature</div>
      <div class="temp-grid">
        ${tempDefs.map(([k, lbl]) => `
        <div class="temp-item" id="temp-item-${k}">
          <div class="therm-wrap">
            <div class="therm-tube"><div class="therm-fill" id="tf-${k}"></div></div>
            <div class="therm-bulb" id="tbulb-${k}"></div>
          </div>
          <div class="temp-val" id="tv-${k}">--<span class="temp-unit">°C</span></div>
          <div class="temp-lbl">${lbl}</div>
        </div>`).join('')}
      </div>
    </div>` : '';

    const hasRuntime = !!e.total_runtime_formatted;
    const hasCyccap  = !!e.total_charging_cycle_capacity;
    const hasEnergy  = !!(e.energy_in || e.energy_out);
    const hasEclear  = !!e.energy_clear_btn;

    const footerStats = `
    <div class="footer-stats">
      <div class="foot-item"><div class="foot-icon">🔄</div><div class="foot-val" id="ft-cycles">--</div><div class="foot-lbl">Cycles</div></div>
      ${hasRuntime ? `<div class="foot-item"><div class="foot-icon">⏱</div><div class="foot-val" id="ft-runtime" style="font-size:11px">--</div><div class="foot-lbl">Runtime</div></div>` : ''}
      <div class="foot-item"><div class="foot-icon">⚡</div><div class="foot-val" id="ft-avgv">--</div><div class="foot-lbl">Avg Cell V</div></div>
      ${hasCyccap ? `<div class="foot-item"><div class="foot-icon">🔋</div><div class="foot-val" id="ft-cyccap">--</div><div class="foot-lbl">Cycle Ah</div></div>` : ''}
    </div>`;

    const footerEnergy = hasEnergy ? `
    <div class="footer-energy">
      <div class="foot-item"><div class="foot-val" id="ft-ein" style="color:var(--green)">--</div><div class="foot-lbl">⬇ Energy In</div></div>
      <div class="foot-item"><div class="foot-val" id="ft-eout" style="color:var(--blue)">--</div><div class="foot-lbl">⬆ Energy Out</div></div>
    </div>` : '';

    const resetSection = hasEclear ? `
    <div class="reset-section">
      <div class="reset-lbl">⚡ Energy Counter Reset</div>
      <div class="reset-controls">
        <select class="reset-select" id="reset-period-sel">
          <option value="none">Auto reset period…</option>
          <option value="daily">Daily (every 00:00)</option>
          <option value="weekly">Weekly (Mon 00:00)</option>
          <option value="monthly">Monthly (1st 00:00)</option>
        </select>
        <button class="reset-btn-auto" id="btn-auto-reset">AUTO</button>
        <button class="reset-btn-manual" id="btn-manual-reset" title="Hold 2 sec to reset"><span class="rbm-fill"></span><span class="rbm-txt">⟳ Manual Reset</span></button>
      </div>
    </div>` : '';

    return `
      <div class="accent" id="accent"></div>
      <div class="inner">

        <div class="header">
          <div class="title-row">
            <div class="bat-icon" id="bat-icon">🔋</div>
            <div>
              <h2 class="t-h2">${this._config.title || 'Battery BMS'}</h2>
              <div class="t-sub" id="conn-label">JK BMS <span id="conn-dot" class="conn-dot live">●</span><span id="conn-txt"> Live</span></div>
            </div>
          </div>
          <div class="charging-badge" id="charging-badge">⚡ CHARGING</div>
          <div class="pill pill-idle" id="status-pill">⏸ Idle</div>
        </div>

        <div class="hero">
          <div class="gauge-wrap" id="gauge-wrap">
            <svg class="gauge-svg" id="gauge-svg" viewBox="0 0 100 100">
              <circle class="g-bg"    cx="50" cy="50" r="42" stroke-dasharray="197.9 65.99" transform="rotate(135 50 50)"/>
              <circle class="g-track" cx="50" cy="50" r="42" stroke-dasharray="197.9 65.99" transform="rotate(135 50 50)"/>
              <circle class="g-glow"  id="g-glow" cx="50" cy="50" r="42" transform="rotate(135 50 50)" stroke="var(--green)"/>
              <circle class="g-fill"  id="g-fill"  cx="50" cy="50" r="42" transform="rotate(135 50 50)" stroke="var(--green)"/>
            </svg>
            <div class="gauge-center">
              <div class="soc-num" id="soc-num" style="color:var(--green)">--<span class="soc-pct-sym">%</span></div>
              <div class="soc-sub"  id="soc-cap">-- Ah</div>
              <div class="soc-time" id="soc-time"></div>
            </div>
          </div>

          <div class="right">
            <div class="stats-grid">
              <div class="stat"><div class="stat-icon">🔌</div><div class="stat-lbl">Voltage</div><div class="stat-val" id="sv-v">--<span class="u">V</span></div></div>
              <div class="stat"><div class="stat-icon">⚡</div><div class="stat-lbl">Current</div><div class="stat-val" id="sv-i">--<span class="u">A</span></div></div>
              <div class="stat"><div class="stat-icon">🔋</div><div class="stat-lbl">Remaining</div><div class="stat-val" id="sv-rem">--<span class="u">Ah</span></div></div>
              <div class="stat"><div class="stat-icon">⏱</div><div class="stat-lbl">Time Left</div><div class="stat-val" id="sv-time" style="font-size:15px">--</div></div>
            </div>
            ${(e.charging_mosfet_state || e.discharging_mosfet_state) ? `
            <div class="mos-row">
              ${e.charging_mosfet_state    ? `<div class="mos-chip" id="mos-arc-chg"><span class="mos-led"></span><div class="mos-chip-inner"><span class="mos-chip-lbl">Chg FET</span><span class="mos-chip-val">--</span></div></div>` : `<div></div>`}
              ${e.discharging_mosfet_state ? `<div class="mos-chip" id="mos-arc-dis"><span class="mos-led"></span><div class="mos-chip-inner"><span class="mos-chip-lbl">Dis FET</span><span class="mos-chip-val">--</span></div></div>` : `<div></div>`}
            </div>` : ''}
          </div>
        </div>

        <div class="flow-section" id="flow-section">
          <div class="sec-lbl">⚡ Power Flow</div>
          <div class="flow-wrap" id="flow-wrap">
            <svg class="flow-arcs" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="ag1" gradientUnits="userSpaceOnUse" x1="18" y1="42" x2="44" y2="42">
                  <stop offset="0%"   stop-color="rgba(255,193,7,0.55)"/>
                  <stop offset="100%" stop-color="rgba(0,230,118,0.55)"/>
                </linearGradient>
                <linearGradient id="ag2" gradientUnits="userSpaceOnUse" x1="56" y1="42" x2="82" y2="42">
                  <stop offset="0%"   stop-color="rgba(0,230,118,0.55)"/>
                  <stop offset="100%" stop-color="rgba(130,50,255,0.55)"/>
                </linearGradient>
              </defs>
              <path class="arc-track" d="M 18,42 Q 34,8 44,42" stroke="url(#ag1)"/>
              <path class="arc-track" d="M 56,42 Q 66,8 82,42" stroke="url(#ag2)"/>
            </svg>
            <div class="flow-orb orb-c0" id="orb-c0"></div>
            <div class="flow-orb orb-c1" id="orb-c1"></div>
            <div class="flow-orb orb-c2" id="orb-c2"></div>
            <div class="flow-orb orb-c3" id="orb-c3"></div>
            <div class="flow-orb orb-d0" id="orb-d0"></div>
            <div class="flow-orb orb-d1" id="orb-d1"></div>
            <div class="flow-orb orb-d2" id="orb-d2"></div>
            <div class="flow-orb orb-d3" id="orb-d3"></div>
            <div class="fnode fnode-src">
              <div class="fn-ico" id="fcirc-src">${this._svgBolt()}</div>
              <div class="fn-val" id="fn-chg" style="color:var(--green)">--</div>
              <div class="fn-lbl">W In</div>
            </div>
            <div class="fnode fnode-bat">
              <div class="fn-ico" id="fcirc-bat">${this._svgBat()}</div>
              <div class="fn-val" id="fn-soc-mini" style="color:var(--txt2)">--%</div>
              <div class="fn-lbl">SOC</div>
            </div>
            <div class="fnode fnode-load">
              <div class="fn-ico" id="fcirc-load">${this._svgHome()}</div>
              <div class="fn-val" id="fn-dis" style="color:var(--blue)">--</div>
              <div class="fn-lbl">W Out</div>
            </div>
          </div>
        </div>

        <div class="cells-section">
          <div class="row-head">
            <div class="sec-lbl" style="margin:0">🔬 Cell Voltages</div>
            <div class="delta-badge" id="delta-badge">ΔV --</div>
          </div>
          <div class="cells-grid">${cells}</div>
        </div>

        ${tempSection}

        <div class="chips">
          <div class="sw-chip chip-off" id="chip-chg" data-entity="${e.charging || ''}">
            <div class="sw-label"><span class="sw-icon">⚡</span>Charge</div>
            <div class="sw-toggle"><div class="sw-thumb"></div></div>
          </div>
          <div class="sw-chip chip-off" id="chip-dis" data-entity="${e.discharging || ''}">
            <div class="sw-label"><span class="sw-icon">🔌</span>Discharge</div>
            <div class="sw-toggle"><div class="sw-thumb"></div></div>
          </div>
          <div class="bal-indicator" id="chip-bal">
            <div class="bal-dot"></div><span>Balance</span>
          </div>
        </div>

        <div class="divider"></div>
        ${footerStats}
        ${footerEnergy}
        ${resetSection}
        <div class="status-bar" id="status-bar"><span id="status-text">● All systems OK</span></div>

      </div>`;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // _update
  // ═════════════════════════════════════════════════════════════════════════
  _update() {
    if (!this._hass || !this._config) return;
    const e    = this._config.entities || {};
    const minV = parseFloat(this._config.minCellVoltage) || 3.0;
    const maxV = parseFloat(this._config.maxCellVoltage) || 3.55;
    const n    = this._config.cellCount || 4;

    // ── Stale data detection — configurable seconds (default 15s) ─────────
    const _now   = Date.now();
    const _snap  = {};
    const _ents  = e ? Object.values(e).filter(Boolean) : [];
    for (const eid of _ents) { const s = this._hass.states[eid]; if (s) _snap[eid] = s.state; }
    const _snapStr = JSON.stringify(_snap);
    if (_snapStr !== this._lastSnapshotStr) { this._lastSnapshotStr = _snapStr; this._lastChangeTime = _now; }
    if (this._lastChangeTime === null) this._lastChangeTime = _now;
    const staleMs = (parseFloat(this._config.staleTimeout) || 15) * 1000;
    const isStale = (_now - this._lastChangeTime) > staleMs;

    // ── SOC ──────────────────────────────────────────────────────────────
    const soc    = this._num(e.state_of_charge);
    const remain = this._num(e.capacity_remaining);
    const capSet = this._num(e.total_battery_capacity_setting);
    const socClr  = this._socColor(soc);
    const gaugeClr = isStale ? '#546e7a' : socClr;

    const C       = 263.9, arcMax = 197.9;
    const arcFill = soc !== null ? (soc / 100) * arcMax : 0;
    const arcDash = `${arcFill.toFixed(2)} ${(C - arcFill).toFixed(2)}`;

    const gf    = this._q('g-fill');
    const gglow = this._q('g-glow');
    if (gf)    { gf.style.strokeDasharray    = arcDash; gf.style.stroke    = gaugeClr; }
    if (gglow) { gglow.style.strokeDasharray = arcDash; gglow.style.stroke = gaugeClr; }

    // Stale — grey out gauge and dim flow
    const gaugeWrap = this._q('gauge-wrap');
    if (gaugeWrap) gaugeWrap.setAttribute('class', isStale ? 'gauge-wrap stale' : 'gauge-wrap');
    const flowSec = this._q('flow-section');
    if (flowSec) flowSec.setAttribute('class', isStale ? 'flow-section stale' : 'flow-section');

    this._set('soc-num', `${soc !== null ? Math.round(soc) : '--'}<span class="soc-pct-sym">%</span>`);
    this._sty('soc-num', 'color', gaugeClr);
    this._txt('soc-cap',
      remain !== null && capSet !== null ? `${remain.toFixed(1)} / ${capSet.toFixed(0)} Ah`
      : remain !== null ? `${remain.toFixed(1)} Ah` : '');

    const timeLeft = this._state(e.time_left);
    const tlFmt = this._fmtHours(timeLeft && timeLeft !== 'unavailable' ? timeLeft : null);
    this._txt('soc-time', tlFmt ? `⏱ ${tlFmt}` : '');
    this._txt('sv-time',  tlFmt || '--');

    // ── Core stats ────────────────────────────────────────────────────────
    const volt = this._num(e.total_voltage);
    const curr = this._num(e.current);
    const avgV = this._num(e.average_cell_voltage);

    if (volt !== null)
      this._set('sv-v', `${volt.toFixed(2)}<span class="u">V</span>`);
    if (curr !== null) {
      const sign = curr > 0.3 ? '+' : '';
      const clr  = curr > 0.3 ? 'var(--green)' : curr < -0.3 ? 'var(--blue)' : 'var(--txt)';
      this._set('sv-i', `<span style="color:${clr}">${sign}${curr.toFixed(1)}</span><span class="u">A</span>`);
    }
    if (remain !== null)
      this._set('sv-rem', `${remain.toFixed(1)}<span class="u">Ah</span>`);

    // ── Power ─────────────────────────────────────────────────────────────
    const rawPwr     = this._num(e.power);
    const explicitCh = this._num(e.charging_power);
    const explicitDi = this._num(e.discharging_power);
    let chgPwr, disPwr;
    if (explicitCh !== null || explicitDi !== null) {
      chgPwr = explicitCh; disPwr = explicitDi;
    } else if (rawPwr !== null && curr !== null) {
      chgPwr = curr >= 0 ? Math.abs(rawPwr) : 0;
      disPwr = curr <  0 ? Math.abs(rawPwr) : 0;
    } else { chgPwr = null; disPwr = null; }

    this._txt('fn-chg',      chgPwr !== null ? Math.round(chgPwr) : '--');
    this._txt('fn-dis',      disPwr !== null ? Math.round(disPwr) : '--');
    this._txt('fn-soc-mini', soc    !== null ? `${Math.round(soc)}%` : '--%');

    const chgActive = !isStale && chgPwr !== null && chgPwr > 15;
    const disActive = !isStale && disPwr !== null && disPwr > 15;
    this._setArc('arc-chg', chgActive);
    this._setArc('arc-dis', disActive);
    this._flowPower = rawPwr !== null ? Math.abs(rawPwr) : Math.max(chgPwr || 0, disPwr || 0);

    // ── Status ────────────────────────────────────────────────────────────
    const charging    = !isStale && (curr !== null ? curr >  0.5 : chgActive);
    const discharging = !isStale && (curr !== null ? curr < -0.5 : disActive);

    // CHARGING corner badge
    const badge = this._q('charging-badge');
    if (badge) badge.setAttribute('class', charging ? 'charging-badge visible' : 'charging-badge');

    const pill = this._q('status-pill');
    if (pill) {
      if (charging) {
        pill.style.display = 'none';
      } else {
        pill.style.display = '';
        if (isStale)          { pill.textContent = '⚪ Inactive';    pill.setAttribute('class','pill pill-stale'); }
        else if (discharging) { pill.textContent = '🔌 Discharging'; pill.setAttribute('class','pill pill-dis'); }
        else                  { pill.textContent = '⏸ Idle';        pill.setAttribute('class','pill pill-idle'); }
      }
    }
    const accent = this._q('accent');
    if (accent) accent.setAttribute('class', 'accent'+(isStale?' stale':charging?' chg':discharging?' dis':''));
    const batIcon = this._q('bat-icon');
    if (batIcon) batIcon.setAttribute('class', 'bat-icon'+(charging?' chg':discharging?' dis':''));
    const gsvg = this._q('gauge-svg');
    if (gsvg) gsvg.setAttribute('class', 'gauge-svg'+(!isStale && charging?' chg':!isStale && discharging?' dis':''));
    if (gglow) gglow.style.opacity = (!isStale && (charging || discharging)) ? '0.35' : '0';

    // ── Connection status ────────────────────────────────────────────────
    const connDotEl = this._q('conn-dot');
    const connTxtEl = this._q('conn-txt');
    if (connDotEl) connDotEl.setAttribute('class', `conn-dot ${isStale ? 'lost' : 'live'}`);
    if (connTxtEl) connTxtEl.textContent = isStale ? ' Connection Lost' : ' Live';

    // Flow icons
    this._set('fcirc-src', this._svgBolt());
    const fsrc  = this._q('fcirc-src');
    const fbat  = this._q('fcirc-bat');
    const fload = this._q('fcirc-load');
    if (fsrc)  fsrc.setAttribute('class',  'fn-ico'+(chgActive ? ' active-chg' : ''));
    if (fbat)  fbat.setAttribute('class',  'fn-ico'+(chgActive||disActive ? (chgActive?' active-chg':' active-dis') : ''));
    if (fload) fload.setAttribute('class', 'fn-ico'+(disActive ? ' active-dis' : ''));

    // ── 3-D Battery cells ─────────────────────────────────────────────────
    const range = maxV - minV;
    let minCV = Infinity, maxCV = -Infinity;
    const cvs = [];
    for (let i = 1; i <= n; i++) {
      const v = this._num(e[`cell_voltage_${i}`]);
      cvs.push(v);
      if (v !== null) { if (v < minCV) minCV = v; if (v > maxCV) maxCV = v; }
    }
    for (let i = 0; i < n; i++) {
      const v     = cvs[i];
      const clr   = this._cellColor(v);
      const pct   = v !== null && range > 0
        ? Math.max(0.02, Math.min(1, (v - minV) / range)) : 0;
      const isMin = v !== null && v === minCV && minCV !== maxCV;
      const isMax = v !== null && v === maxCV && minCV !== maxCV;
      const gc    = this._cellGC(v);
      const u     = `c${i + 1}`;

      const cel = this._q(`cell-${i+1}`);
      if (cel) cel.setAttribute('class', 'bat3d-item'+(isMin?' is-min':isMax?' is-max':''));

      this._set(`cell-num-${i+1}`, `C${i+1}`
        + (isMin ? `<span class="bat3d-marker" style="color:var(--red)">▼</span>` : '')
        + (isMax ? `<span class="bat3d-marker" style="color:var(--green)">▲</span>` : ''));

      const f1 = this._q(`${u}f1`);
      const fm = this._q(`${u}fm`);
      const f2 = this._q(`${u}f2`);
      if (f1) f1.setAttribute('stop-color', gc.d);
      if (fm) fm.setAttribute('stop-color', gc.m);
      if (f2) f2.setAttribute('stop-color', gc.l);

      const fillY = (82 - 76 * pct).toFixed(2);
      const liq   = this._q(`${u}liq`);
      if (liq) liq.setAttribute('transform', `translate(0,${fillY})`);

      const lowVoltage = parseFloat(this._config.lowVoltageThreshold) || 3.1;
      const isLowVolt = v !== null && v < lowVoltage;

      const base = this._q(`${u}base`);
      if (base) base.setAttribute('fill', isLowVolt ? '#180306' : '#020c18');

      const wb = this._q(`${u}wb`);
      if (wb) wb.setAttribute('fill', isLowVolt ? 'rgba(120,10,10,0.90)' : 'rgba(15,100,180,0.90)');

      const brd = this._q(`${u}brd`);
      if (brd) {
        brd.setAttribute('stroke',       isMin ? 'rgba(255,82,82,0.8)'  : isMax ? 'rgba(0,230,118,0.8)'  : 'rgba(255,255,255,0.09)');
        brd.setAttribute('stroke-width', isMin || isMax ? '1.8' : '0.8');
      }

      this._txt(`cv-${i+1}`, v !== null ? `${v.toFixed(3)}V` : '--');
      this._sty(`cv-${i+1}`, 'color', clr);
      if (v !== null && avgV !== null) {
        const diff = (v - avgV) * 1000;
        const sign = diff >= 0 ? '+' : '';
        this._txt(`cd-${i+1}`, `${sign}${diff.toFixed(1)}mV`);
        this._sty(`cd-${i+1}`, 'color', Math.abs(diff) > 15 ? 'var(--orange)' : 'var(--txt3)');
      }
    }

    // ── Delta V ───────────────────────────────────────────────────────────
    const balOnEarly = this._state(e.balancer) === 'on';
    const dv = this._num(e.delta_cell_voltage);
    const db = this._q('delta-badge');
    if (db && dv !== null) {
      const dc = balOnEarly ? 'var(--red)' : (dv > 0.05 ? 'var(--red)' : dv > 0.02 ? 'var(--orange)' : 'var(--green)');
      db.textContent = `ΔV ${(dv * 1000).toFixed(1)} mV`;
      db.style.color        = dc;
      db.style.borderColor  = balOnEarly ? 'rgba(255,82,82,.6)' : dc;
      db.style.background   = balOnEarly ? 'rgba(255,82,82,.12)' : '';
      db.style.fontSize     = balOnEarly ? '13px' : '';
      db.style.padding      = balOnEarly ? '3px 12px' : '';
    }

    // ── Temperatures ──────────────────────────────────────────────────────
    [
      [e.temperature_sensor_1, '1'],
      [e.temperature_sensor_2, '2'],
      [e.temperature_sensor_3, '3'],
      [e.temperature_sensor_4, '4'],
    ].forEach(([eid, k]) => {
      if (!eid) return;
      const t   = this._num(eid);
      const clr = this._tempColorBat(t);
      const pct = t !== null ? Math.max(5, Math.min(95, (t / 80) * 100)) : 5;
      const tf    = this._q(`tf-${k}`);
      const tbulb = this._q(`tbulb-${k}`);
      if (tf)    { tf.style.height = `${pct}%`; tf.style.background = this._tempFillBat(t); }
      if (tbulb) { tbulb.style.background = clr; tbulb.style.boxShadow = `0 0 8px ${clr}99`; }
      const item = this._q(`temp-item-${k}`);
      if (item) item.style.borderColor = t !== null && (t > 40 || t < 6) ? 'rgba(255,82,82,.35)' : '';
      this._set(`tv-${k}`, t !== null
        ? `<span style="color:${clr}">${t.toFixed(0)}</span><span class="temp-unit">°C</span>`
        : `--<span class="temp-unit">°C</span>`);
    });

    if (e.power_tube_temperature) {
      const t   = this._num(e.power_tube_temperature);
      const clr = this._tempColorMos(t);
      const pct = t !== null ? Math.max(5, Math.min(95, (t / 80) * 100)) : 5;
      const tf    = this._q('tf-mos');
      const tbulb = this._q('tbulb-mos');
      if (tf)    { tf.style.height = `${pct}%`; tf.style.background = this._tempFillMos(t); }
      if (tbulb) { tbulb.style.background = clr; tbulb.style.boxShadow = `0 0 8px ${clr}99`; }
      const item = this._q('temp-item-mos');
      if (item) item.style.borderColor = t !== null && t > 60 ? 'rgba(255,82,82,.35)' : '';
      this._set('tv-mos', t !== null
        ? `<span style="color:${clr}">${t.toFixed(0)}</span><span class="temp-unit">°C</span>`
        : `--<span class="temp-unit">°C</span>`);
    }

    // ── Switch chips ──────────────────────────────────────────────────────
    const chgState = this._state(e.charging_state);
    const disState = this._state(e.discharge_state);
    const chgOn = chgState !== null
      ? ['on','true','1'].includes((chgState + '').toLowerCase())
      : this._state(e.charging) === 'on';
    const disOn = disState !== null
      ? ['on','true','1'].includes((disState + '').toLowerCase())
      : this._state(e.discharging) === 'on';
    const balOn = this._state(e.balancer) === 'on';

    this._cls('chip-chg', `sw-chip ${chgOn ? 'chip-chg-on' : 'chip-off'}`);
    this._cls('chip-dis', `sw-chip ${disOn ? 'chip-dis-on' : 'chip-off'}`);
    this._cls('chip-bal', `bal-indicator${balOn ? ' on' : ''}`);

    // ── MOSFET state indicators ──────────────────────────────────────────
    if (e.charging_mosfet_state) {
      const ms = this._state(e.charging_mosfet_state);
      const el = this._q('mos-arc-chg');
      if (el) {
        el.setAttribute('class', 'mos-chip' + (ms === 'on' ? ' mos-chg-on' : ms === 'off' ? ' mos-tripped' : ''));
        const v = el.querySelector('.mos-chip-val');
        if (v) v.textContent = ms === 'on' ? 'ON' : ms === 'off' ? 'OFF' : '--';
      }
    }
    if (e.discharging_mosfet_state) {
      const ms = this._state(e.discharging_mosfet_state);
      const el = this._q('mos-arc-dis');
      if (el) {
        el.setAttribute('class', 'mos-chip' + (ms === 'on' ? ' mos-dis-on' : ms === 'off' ? ' mos-tripped' : ''));
        const v = el.querySelector('.mos-chip-val');
        if (v) v.textContent = ms === 'on' ? 'ON' : ms === 'off' ? 'OFF' : '--';
      }
    }

    // ── Footer ────────────────────────────────────────────────────────────
    const cycles  = this._state(e.charging_cycles);
    const runtime = this._state(e.total_runtime_formatted);
    const cyccap  = this._num(e.total_charging_cycle_capacity);
    const eIn     = this._num(e.energy_in);
    const eOut    = this._num(e.energy_out);

    this._txt('ft-cycles', cycles && cycles !== 'unavailable' ? cycles : '--');
    if (this._has('total_runtime_formatted')) {
      const rtFmt = this._fmtDays(runtime && runtime !== 'unavailable' ? runtime : null);
      this._txt('ft-runtime', rtFmt || '--');
    }
    if (this._has('total_charging_cycle_capacity'))
      this._txt('ft-cyccap', cyccap !== null ? `${cyccap.toFixed(0)} Ah` : '--');
    if (avgV !== null)
      this._set('ft-avgv', `${avgV.toFixed(3)}<span style="font-size:9px;color:var(--txt2)">V</span>`);
    if (this._has('energy_in'))
      this._set('ft-ein',  eIn  !== null ? `${eIn.toFixed(3)}<span style="font-size:9px;color:var(--txt2)"> kWh</span>` : '--');
    if (this._has('energy_out'))
      this._set('ft-eout', eOut !== null ? `${eOut.toFixed(3)}<span style="font-size:9px;color:var(--txt2)"> kWh</span>` : '--');

    // ── Status bar ────────────────────────────────────────────────────────
    const warnStr = this._state(e.errors);
    const warnOk  = !warnStr || ['unavailable','no alarm','normal','none','ok','','0']
                                .includes((warnStr + '').toLowerCase());
    const sb = this._q('status-bar');
    if (isStale) {
      if (sb) sb.setAttribute('class', 'status-bar stale');
      this._txt('status-text', '○ No data — connection lost');
    } else {
      if (sb) sb.setAttribute('class', `status-bar${warnOk ? '' : ' alert'}`);
      this._txt('status-text', warnOk ? '● All systems OK' : `⚠ ${warnStr}`);
    }
  }
}

customElements.define('bms-battery-card-v5', BmsBatteryCardV5);

window.customCards = window.customCards || [];
window.customCards.push({
  type:        'bms-battery-card-v5',
  name:        'BMS Battery Card v5',
  description: '3D cells · comet-trail flow · charging badge · auto-reset · responsive grid',
  preview:     true,
});
