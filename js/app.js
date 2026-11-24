/* Fiebre de Puntos: interfaz del simulador. La lógica vive en engine.js y los números en config.js. */
(function () {
  "use strict";

  const cfg = window.FP_CONFIG;
  const E = window.FPEngine;
  const KEY = "fiebre-de-puntos:v2";
  const KEY_LIST = "fiebre-de-puntos:rutina:v1";
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Un color por fuente de puntos, como un juego de monedas: oro, plata, cobre y jade.
  const METAL = { checkin: "#e0a31c", lottery: "#a9b4be", downloads: "#c8693a", boost: "#2f9e7e", demo: "#6b8f86" };
  const MPD_OPTIONS = [0, 1, 2, 5];

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fmt1 = (n) => (Math.round(n * 10) / 10).toString().replace(".", ",");
  const plural = (n, one, many) => (n === 1 ? one : many);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (sel, fallback) => {
    const v = parseFloat($(sel).value);
    return Number.isFinite(v) ? v : fallback;
  };
  const goalItem = E.goalItem(cfg);

  /* ---------- Estado y guardado ---------- */
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function load() {
    let s;
    try {
      const raw = window.localStorage.getItem(KEY);
      s = E.hydrate(raw ? JSON.parse(raw) : null);
    } catch (e) {
      s = E.newState();
    }
    if (!s.startDate) s.startDate = todayISO();
    return s;
  }
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* sin almacenamiento: no pasa nada */ }
  }

  let state = load();
  let lastResult = "";
  let spinning = false;
  let resetArmed = false;
  let resetTimer = null;
  let toastTimer = null;

  /* ---------- Utilidades de texto ---------- */
  function simDate(offset) {
    const p = state.startDate.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2] + state.day + offset);
  }
  function shortDate(d) {
    return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" }).replace(".", "");
  }
  function degrees(points) {
    return E.temperature(points, cfg.goal).toFixed(1).replace(".", ",") + " °C";
  }
  function heatStatus(points) {
    const t = E.temperature(points, cfg.goal);
    if (points >= cfg.goal) return "40 °C: meta cumplida, ya puedes canjear";
    if (t < 36.4) return "Sin fiebre todavía";
    if (t < 37.2) return "Entrando en calor";
    if (t < 38) return "Febrícula";
    if (t < 39) return "Fiebre";
    return "Fiebre alta";
  }
  function unitOf(r, n) {
    return r.type === "points" ? plural(n, "punto", "puntos") : plural(n, "boleto", "boletos");
  }
  // Días a texto: "42 días", "6,2 meses", "2,1 años".
  function durationText(days) {
    if (days === null) return { big: "10+", unit: "años" };
    if (days < 60) return { big: String(Math.max(1, days)), unit: plural(days, "día", "días") };
    const m = days / 30.44;
    if (m < 24) return { big: fmt1(m), unit: "meses" };
    return { big: fmt1(m / 12), unit: "años" };
  }
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3600);
  }

  /* ---------- Termómetro y marcadores ---------- */
  function buildThermoMarks() {
    const fr = [0.25, 0.5, 0.75, 1];
    let ticks = "", deg = '<text x="58" y="488">36°</text>', pts = "";
    fr.forEach((f) => {
      const y = 470 - 410 * f;
      const goal = f === 1;
      ticks += '<line class="' + (goal ? "goal" : "") + '" x1="' + (goal ? 76 : 82) + '" y1="' + y + '" x2="94" y2="' + y + '"/>' +
        '<line class="' + (goal ? "goal" : "") + '" x1="142" y1="' + y + '" x2="' + (goal ? 160 : 154) + '" y2="' + y + '"/>';
      deg += '<text class="' + (goal ? "goal" : "") + '" x="' + (goal ? 66 : 72) + '" y="' + (y + 6) + '">' + Math.round(36 + 4 * f) + "°</text>";
      pts += '<text class="' + (goal ? "goal" : "") + '" x="' + (goal ? 168 : 162) + '" y="' + (y + 5) + '">' + fmt(cfg.goal * f) + "</text>";
    });
    pts += '<text class="goal-sub" x="168" y="84">canje</text>';
    $("#thermo-marks").innerHTML = '<g class="t-ticks">' + ticks + '</g><g class="t-deg" text-anchor="end">' + deg + '</g><g class="t-pts" text-anchor="start">' + pts + "</g>";
  }
  function renderThermo() {
    const pct = clamp(state.points / cfg.goal, 0, 1);
    $("#inicio").style.setProperty("--p", pct);
    $("#hero-temp").textContent = degrees(state.points);
    $("#hero-points").textContent = fmt(state.points) + " de " + fmt(cfg.goal) + " puntos";
    $("#hero-status").textContent = heatStatus(state.points);
    $("#thermo-svg").setAttribute("aria-label", "Termómetro: " + fmt(state.points) + " de " + fmt(cfg.goal) + " puntos, " + degrees(state.points));
    $("#top-points").textContent = fmt(state.points);
    $("#top-temp").textContent = degrees(state.points);
  }
  function renderStats() {
    $("#st-points").textContent = fmt(state.points);
    $("#st-tickets").textContent = state.tickets;
    $("#st-cards").textContent = state.cards;
    const box = $("#st-premium-box");
    const dd = $("#st-premium");
    const on = state.premiumDays > 0;
    box.classList.toggle("on", on);
    if (on) {
      dd.className = "";
      dd.innerHTML = "×" + cfg.premiumMultiplier + '<span class="small">' + state.premiumDays + " " + plural(state.premiumDays, "día", "días") + "</span>";
    } else {
      dd.className = "text";
      dd.textContent = "Sin Premium";
    }
    $("#st-streak").textContent = state.streak + " " + plural(state.streak, "día", "días");
    $("#st-day").textContent = state.day;
  }

  /* ---------- Registro diario: la tabla de la semana no se mueve ---------- */
  function renderTray() {
    const n = cfg.checkin.length;
    let html = "";
    for (let i = 0; i < n; i++) {
      const isToday = i === state.pos;
      const done = i < state.pos || (isToday && state.claimedToday);
      const st = done ? "claimed" : isToday ? "today" : "locked";
      // Los días que ya pasaron se muestran con su valor base; hoy y los que faltan con el Premium actual.
      const r = i < state.pos
        ? { type: cfg.checkin[i].type, value: cfg.checkin[i].value, mult: 1 }
        : E.rewardAt(state, cfg, i);
      const ticket = r.type === "ticket";
      const icon = ticket ? "i-ticket" : "i-coin";
      const mult = r.mult > 1 ? '<span class="mult" title="Premium activo">×' + r.mult + "</span>" : "";
      const badge = st === "claimed"
        ? '<span class="badge ok"><svg aria-hidden="true"><use href="#i-check"/></svg></span>'
        : st === "locked" ? '<span class="badge lock"><svg aria-hidden="true"><use href="#i-lock"/></svg></span>' : "";
      const label = isToday ? "Hoy" : shortDate(simDate(i - state.pos));
      const state_ = st === "claimed" ? ", registrado" : st === "locked" ? ", bloqueado" : "";
      html += '<div class="day is-' + st + (ticket ? " is-ticket" : "") + '" role="listitem">' + mult +
        '<span class="day-date">' + label + "</span>" +
        '<span class="coin ' + (st === "locked" ? "dim" : ticket ? "silver" : "gold") + '">' +
        '<svg class="coin-ico" aria-hidden="true"><use href="#' + icon + '"/></svg><b>' + r.value + "</b>" + badge + "</span>" +
        '<span class="day-unit">' + unitOf(r, r.value) + state_ + "</span></div>";
    }
    $("#tray").innerHTML = html;
    $("#ck-date").textContent = "Hoy es " + shortDate(simDate(0)) + ", día " + state.day + " del simulador";
    const btn = $("#btn-claim");
    btn.disabled = state.claimedToday;
    btn.textContent = state.claimedToday ? "Registrado hoy" : "Registrar hoy";
    let hint = "Registrar solo marca el día. La tabla se reinicia cuando completas los siete.";
    if (state.claimedToday) {
      hint = state.pos === n - 1
        ? "Completaste la semana. Al pasar el día, la tabla vuelve a empezar desde la primera casilla."
        : "Listo por hoy. Pasa al día siguiente para seguir con la racha.";
    }
    $("#ck-hint").textContent = hint;
  }

  function renderCardBanner() {
    const el = $("#card-banner");
    const m = state.missed;
    const can = !state.claimedToday && !!state.restore && m >= 1 && m <= cfg.card.maxDays;
    const lost = !state.claimedToday && m > cfg.card.maxDays && state.totalClaims > 0;
    if (can) {
      const streakNow = state.restore.streak + m;
      const posNew = (state.restore.pos + m) % cfg.checkin.length;
      const r = E.rewardAt(state, cfg, posNew);
      const pts = m * cfg.card.pointsPerDay;
      const price = E.itemPrice(state, cfg, E.findItem(cfg, "card"));
      const action = state.cards > 0
        ? '<button class="btn btn-primary" type="button" data-action="use-card">Usar check-in Card (tienes ' + state.cards + ")</button>"
        : '<button class="btn btn-primary" type="button" data-action="buy" data-id="card"' + (state.points < price ? " disabled" : "") + ">Canjear una Card por " + price + " puntos</button>";
      el.className = "card-banner";
      el.innerHTML = '<div class="cb-text"><strong>Faltaste ' + m + " " + plural(m, "día seguido", "días seguidos") + ".</strong> Tu racha era de " +
        state.restore.streak + " " + plural(state.restore.streak, "día", "días") + ". Con una check-in Card la recuperas: sumas " + pts + " " + plural(pts, "punto", "puntos") +
        ", la racha pasa a " + streakNow + " y hoy te toca " + r.value + " " + unitOf(r, r.value) + ". Si registras hoy sin usarla, la racha se pierde.</div>" + action;
      el.hidden = false;
    } else if (lost) {
      el.className = "card-banner is-lost";
      el.innerHTML = '<div class="cb-text"><strong>Pasaron más de ' + cfg.card.maxDays + " días sin registrar.</strong> Esa racha ya no se puede recuperar con una Card. Registra hoy para empezar de nuevo desde la primera casilla.</div>";
      el.hidden = false;
    } else {
      el.hidden = true;
      el.innerHTML = "";
    }
  }

  /* ---------- Lotería (cuadrícula 3x3) ---------- */
  const RING = cfg.raffle;                    // premios en el orden horario del resaltado
  const CELL_AT = [0, 1, 2, 5, 8, 7, 6, 3];   // lugar del anillo -> casilla de la cuadrícula (0 a 8, por filas)
  let ringPos = -1;

  function prizeName(p) {
    if (p.kind === "points") return fmt(p.value) + " puntos";
    if (p.kind === "storage") return p.value + " GB de nube";
    if (p.kind === "premium") return p.value === 1 ? "1 mes de Premium" : p.value + " meses de Premium";
    return "Gracias, sin premio";
  }
  function prizeFace(p) {
    if (p.kind === "points") return { icon: "i-coin", val: fmt(p.value), lbl: "puntos", tone: "coin" };
    if (p.kind === "storage") return { icon: "i-cloud", val: p.value + " GB", lbl: "de nube", tone: "cloud" };
    if (p.kind === "premium") return { icon: "i-star", val: "Premium", lbl: p.value === 1 ? "1 mes" : p.value + " meses", tone: "gold" };
    return { icon: "i-box", val: "Gracias", lbl: "sin premio", tone: "none" };
  }
  function buildRaffle() {
    const cells = new Array(9).fill("");
    RING.forEach((p, i) => {
      const f = prizeFace(p);
      cells[CELL_AT[i]] = '<div class="cell' + (p.rare ? " rare" : "") + '" data-ring="' + i + '">' +
        '<svg class="cell-ico tone-' + f.tone + '" aria-hidden="true"><use href="#' + f.icon + '"/></svg>' +
        '<b class="cell-val">' + f.val + '</b><span class="cell-lbl">' + f.lbl + "</span></div>";
    });
    cells[4] = '<button class="start" id="btn-spin" data-action="spin" type="button"><span>Girar</span><small id="start-sub">0 boletos</small></button>';
    $("#raffle").innerHTML = cells.join("");
  }
  function light(i, cls) {
    $$("#raffle .cell").forEach((c) => c.classList.remove("hot", "won"));
    const el = $('#raffle .cell[data-ring="' + i + '"]');
    if (el) el.classList.add(cls);
  }
  function buildLegend() {
    const ch = E.chances(cfg);
    $("#legend").innerHTML = RING.map((p, i) => ({ p: p, c: ch[i] }))
      .sort((a, b) => b.c - a.c)
      .map((x) => {
        const f = prizeFace(x.p);
        const pct = x.c < 0.01 ? "menos de 1 %" : Math.round(x.c * 100) + " %";
        return '<li><svg class="lg-ico tone-' + f.tone + '" aria-hidden="true"><use href="#' + f.icon + '"/></svg><span>' + prizeName(x.p) + '</span><span class="pct">' + pct + "</span></li>";
      }).join("");
  }
  function renderLottery() {
    $("#lt-count").textContent = state.tickets;
    $("#start-sub").textContent = state.tickets + " " + plural(state.tickets, "boleto", "boletos");
    $("#btn-spin").disabled = spinning || state.tickets < 1;
    const all = $("#btn-spin-all");
    all.disabled = spinning || state.tickets < 2;
    all.textContent = state.tickets > 1 ? "Girar todos (" + state.tickets + ")" : "Girar todos";
    $("#spin-result").textContent = lastResult ||
      (state.tickets > 0
        ? "Tienes " + state.tickets + " " + plural(state.tickets, "boleto", "boletos") + ". Pulsa Girar para ver qué sale."
        : "Consigue boletos en el registro diario: aparecen en los días 3 y 7 de la tabla.");
    $("#lt-extra").textContent = state.spins > 0
      ? "Llevas " + state.spins + " " + plural(state.spins, "giro", "giros") + " y " + state.cloudGB + " GB de nube ganados."
      : "";
    renderPremiumChance();
  }

  // Probabilidad de que te toque al menos un mes de Premium en los próximos 30 días,
  // con tus boletos, tu racha y los modelos que subiste esta semana.
  function renderPremiumChance() {
    const rate = E.recentUploadRate(state);
    const full = state.premiumDays >= 30;
    const now = E.premiumChance(cfg, { tickets: state.tickets, modelsPerDay: rate, streak: state.streak, premium: full });
    const best = E.premiumChance(cfg, { tickets: state.tickets, modelsPerDay: Math.max(rate, 1), premium: full });
    let t = "Premium: " + fmt(now.chance * 100) + " % de que te toque al menos un mes en los próximos 30 días si te registras todos los días.";
    if (now.luck > 1) t += " Ya cuenta tu racha y tus modelos nuevos.";
    else if (best.luck > now.luck) t += " Con " + cfg.premiumLuck.streakDays + " días seguidos de racha y modelos nuevos cada día subiría a " + fmt(best.chance * 100) + " %.";
    $("#lt-premium").textContent = t;
  }
  function describePrize(prize) {
    if (prize.kind === "premium") {
      const months = Math.ceil(state.premiumDays / cfg.premiumMonthDays);
      return "¡Te tocó 1 mes de Premium! Ya acumulas " + months + " " + plural(months, "mes", "meses") + " y la tabla del registro diario vale ×" + cfg.premiumMultiplier + " (los premios de la ruleta no se duplican).";
    }
    if (prize.kind === "points") return (prize.rare ? "¡Premio gordo! " : "") + "Te tocaron " + fmt(prize.value) + " puntos.";
    if (prize.kind === "storage") return "Te tocó 1 GB de nube. No suma puntos.";
    return "Esta vez no hubo premio. Gracias por participar.";
  }
  function doSpin() {
    if (spinning || state.tickets < 1) return;
    const res = E.spin(state, cfg);
    save();
    spinning = true;
    renderLottery();
    const n = RING.length;
    const finish = () => {
      spinning = false;
      ringPos = res.index;
      light(res.index, "won");
      lastResult = describePrize(res.prize);
      toast(lastResult);
      renderAll();
    };
    if (reduceMotion) { finish(); return; }
    let cur = ringPos < 0 ? n - 1 : ringPos;
    const steps = n * 3 + ((res.index - cur + n) % n);
    let step = 0;
    const tick = () => {
      cur = (cur + 1) % n;
      light(cur, "hot");
      step += 1;
      if (step < steps) setTimeout(tick, 55 + Math.pow(step / steps, 3) * 300);
      else finish();
    };
    tick();
  }
  function doSpinAll() {
    if (spinning || state.tickets < 2) return;
    const r = E.spinAll(state, cfg);
    const parts = [];
    if (r.points) parts.push("+" + fmt(r.points) + " puntos");
    if (r.cloudGB) parts.push("+" + r.cloudGB + " GB de nube");
    if (r.premiumMonths) parts.push("+" + r.premiumMonths + " " + plural(r.premiumMonths, "mes", "meses") + " de Premium");
    lastResult = "Giraste " + r.spins + " boletos: " + (parts.join(", ").replace(/, ([^,]*)$/, " y $1") || "sin premios esta vez") + ".";
    toast(lastResult);
    renderAll();
  }

  /* ---------- Comunidad, modelos y boosts ---------- */
  function kindLabel(id) {
    const t = cfg.modelTypes.find((x) => x.id === id);
    return t ? t.label : "Normal";
  }
  // ¿La temporada tiene efecto? (si el multiplicador es 1, se esconden todos los selectores)
  const HAS_SEASON = E.seasonMultiplier(cfg) > 1;
  const seasonName = () => (cfg.season && cfg.season.label) || "temporada";
  function seasonOver() { return !HAS_SEASON || state.day >= cfg.season.days; }
  function renderSeasonChips() {
    $("#season-ctrl").hidden = !HAS_SEASON;
    if (!HAS_SEASON) return;
    const over = seasonOver();
    const on = !!state.settings.seasonal && !over;
    const name = seasonName();
    $("#season-chips").innerHTML =
      '<button type="button" class="chip" data-action="season" data-on="0" aria-pressed="' + !on + '">Normales</button>' +
      '<button type="button" class="chip" data-action="season" data-on="1" aria-pressed="' + on + '"' + (over ? " disabled" : "") + ">De " + name + " (×" + cfg.season.multiplier + ")</button>";
    $("#season-hint").textContent = over
      ? "La temporada de " + name + " ya pasó en el simulador: los modelos nuevos rinden a su ritmo normal."
      : "Un modelo de " + name + " junta ×" + cfg.season.multiplier + " descargas hasta el día " + cfg.season.days + " del simulador (te quedan " + (cfg.season.days - state.day) +
        " " + plural(cfg.season.days - state.day, "día", "días") + "). Después vuelve a su ritmo normal, y los modelos viejos no se apagan.";
  }
  function renderCommunity() {
    const list = state.models;
    const block = cfg.downloadRate.blockSize;
    const downloads = list.reduce((a, m) => a + m.downloads, 0);
    const stuck = list.filter((m) => m.downloads < block).length;
    $("#md-summary").textContent = list.length
      ? list.length + " " + plural(list.length, "modelo", "modelos") + ", " + fmt(downloads) + " descargas"
      : "Sin modelos";
    $("#md-stuck").textContent = list.length >= 5
      ? stuck + " de tus " + list.length + " modelos no llegan a " + block + " descargas. Es normal: unos pocos mueven casi todos los puntos."
      : "";
    $("#followers-val").textContent = state.followers;
    renderSeasonChips();
    $("#mpd-chips").innerHTML = MPD_OPTIONS.map((n) =>
      '<button type="button" class="chip" data-action="mpd" data-n="' + n + '" aria-pressed="' + (state.settings.modelsPerDay === n) + '">' + (n === 0 ? "Ninguno" : n + " por día") + "</button>"
    ).join("");

    const o = E.outlook(state, cfg);
    $("#md-outlook").textContent = list.length
      ? "Con tus modelos y tus seguidores esperas en un mes unas " + fmt(o.views) + " vistas y " + fmt(o.downloads) + " descargas. Es un promedio: cada mes sale distinto."
      : "";
    $("#boost-info").innerHTML = list.length
      ? "Boosts recibidos: <b>" + fmt(state.boosts) + "</b> (+" + fmt(state.earned.boost) + " puntos). Cada mes esperas cerca de <b>" +
        fmt(o.boosts) + "</b> " + plural(Math.round(o.boosts), "boost", "boosts") + ", unos <b>" + fmt(o.boostPoints) + "</b> puntos."
      : "Boosts recibidos: <b>" + fmt(state.boosts) + "</b>. Sin modelos no hay boosts: sube uno para empezar.";

    const table = $("#mtable");
    table.hidden = list.length === 0;
    $("#mempty").hidden = list.length > 0;
    const shown = list.slice(-8).reverse();
    let rows = shown.map((m) =>
      "<tr><td>" + m.name + '</td><td><span class="kind kind-' + m.kind + '">' + kindLabel(m.kind) + "</span>" + (m.seasonal ? '<span class="kind kind-season">' + seasonName() + "</span>" : "") + "</td><td>" + m.age + "</td><td>" + fmt(m.downloads) + "</td><td>" + fmt(E.pointsForDownloads(cfg, m.downloads)) + "</td></tr>"
    ).join("");
    if (list.length > shown.length) {
      const more = list.length - shown.length;
      rows += '<tr><td colspan="5">y ' + fmt(more) + " " + plural(more, "modelo más", "modelos más") + "</td></tr>";
    }
    $("#mbody").innerHTML = rows;
  }
  function renderLog() {
    const items = state.log.slice(0, 14);
    $("#log").innerHTML = items.map((l) => '<li><span class="d">Día ' + l.day + "</span><span>" + l.text + "</span></li>").join("");
    $("#log-empty").hidden = items.length > 0;
  }

  /* ---------- Tienda de regalos y canje ---------- */
  const STORE_ICON = { makenow: "i-bolt", card: "i-card", goal: "i-printer" };
  function storeNote(item) {
    if (item.kind === "makenow") {
      return item.firstPrice !== undefined && !(state.bought[item.id] > 0)
        ? "Precio de primer pedido"
        : "Ya lo canjeaste " + (state.bought[item.id] || 0) + " " + plural(state.bought[item.id] || 0, "vez", "veces");
    }
    if (item.kind === "card") return "Recupera tu racha si faltaste 1 o 2 días seguidos. Tienes " + state.cards + ".";
    return "Es la meta del simulador y solo es de práctica.";
  }
  function renderStore() {
    $("#store-grid").innerHTML = cfg.store.map((item) => {
      const price = E.itemPrice(state, cfg, item);
      const strike = item.firstPrice !== undefined && !(state.bought[item.id] > 0) ? "<s>" + fmt(item.price) + "</s> " : "";
      const can = state.points >= price;
      const goal = item.kind === "goal";
      return '<li class="item' + (goal ? " item-goal" : "") + '">' +
        '<span class="coin ' + (goal ? "gold" : item.kind === "card" ? "silver" : "copper") + '"><svg class="coin-ico big" aria-hidden="true"><use href="#' + STORE_ICON[item.kind] + '"/></svg></span>' +
        '<div class="item-body"><h3>' + item.name + "</h3><p>" + storeNote(item) + "</p></div>" +
        '<div class="item-buy"><span class="price">' + strike + "<b>" + fmt(price) + "</b> puntos</span>" +
        '<button class="btn btn-primary btn-sm" type="button" data-action="buy" data-id="' + item.id + '"' + (can ? "" : " disabled") + ">" + (goal ? "Canje de prueba" : "Canjear") + "</button></div></li>";
    }).join("");
    $("#store-note").textContent = "MakeNow canjeado: " + state.makeNow + " " + plural(state.makeNow, "uso", "usos") + ". Check-in Cards guardadas: " + state.cards + ".";
  }
  function renderRedeem() {
    const pct = clamp(state.points / cfg.goal, 0, 1) * 100;
    $("#rd-points").textContent = fmt(state.points);
    $("#rd-goal").textContent = fmt(cfg.goal);
    $("#rd-reward").textContent = goalItem.name;
    $("#rd-fill").style.width = pct + "%";
    $("#rd-meter").setAttribute("aria-valuenow", Math.min(state.points, cfg.goal));
    $("#rd-meter").setAttribute("aria-valuemax", cfg.goal);
    const ok = E.canRedeem(state, cfg);
    let hint = ok ? "Meta cumplida. Ya puedes hacer el canje de prueba." : "Te faltan " + fmt(cfg.goal - state.points) + " puntos.";
    if (state.redeems > 0) hint += " Canjes de práctica hechos: " + state.redeems + ".";
    $("#rd-hint").textContent = hint;
  }
  function renderAll() {
    renderThermo();
    renderStats();
    renderTray();
    renderCardBanner();
    renderLottery();
    renderCommunity();
    renderLog();
    renderStore();
    renderRedeem();
    save();
  }

  /* ---------- Descargas y ruta ---------- */
  function buildStairs() {
    const blocks = E.blocksToCap(cfg), size = cfg.downloadRate.blockSize, cap = cfg.downloadRate.cap;
    let html = "";
    for (let i = 0; i < blocks; i++) {
      const rate = E.blockRate(cfg, i);
      html += '<div class="bar" style="height:' + Math.max(7, (rate / cap) * 100).toFixed(1) + '%"><span class="v">' + rate + '</span><span class="n">' + (i + 1) * size + "</span></div>";
    }
    $("#stairs").innerHTML = html;
  }
  function renderStairs() {
    const d = parseInt($("#dl-range").value, 10) || 0;
    $("#dl-range").style.setProperty("--fill", (d / 200 * 100) + "%");
    const size = cfg.downloadRate.blockSize;
    const done = Math.floor(d / size);
    $$("#stairs .bar").forEach((bar, i) => {
      bar.classList.toggle("on", i < done);
      bar.classList.toggle("cur", i === done);
    });
    const total = E.pointsForDownloads(cfg, d);
    const next = E.blockRate(cfg, done);
    const atCap = next >= cfg.downloadRate.cap;
    $("#dl-out").innerHTML = "<b>" + d + "</b> " + plural(d, "descarga", "descargas") + " dejan <b>" + fmt(total) + "</b> puntos en total. " +
      (atCap ? "Cada bloque nuevo de " + size + " ya paga el tope de " + next + "." : "El siguiente bloque de " + size + " paga " + next + ".");
  }

  // Tabla "si subes modelos todos los días": puntos por descargas a 1, 3 y 6 meses y días a la meta.
  function renderLibrary() {
    const fol = clamp(num("#lib-followers", 0), 0, 2000);
    const share = HAS_SEASON ? parseFloat($("#lib-season").value) || 0 : 0;
    const rows = [1, 2, 5];
    const cols = [{ d: 30, l: "A 1 mes" }, { d: 90, l: "A 3 meses" }, { d: 180, l: "A 6 meses" }];
    let html = "<thead><tr><th scope=\"col\">Subes por día</th>" + cols.map((c) => '<th scope="col">' + c.l + "</th>").join("") + '<th scope="col">Llegas a la meta</th></tr></thead><tbody>';
    rows.forEach((mpd) => {
      html += '<tr><th scope="row">' + mpd + " " + plural(mpd, "modelo", "modelos") + "</th>";
      cols.forEach((c) => {
        const l = E.libraryPoints(cfg, mpd, fol, c.d, share);
        const big = l.points >= cfg.goal ? '<b class="over">Más de ' + fmt(cfg.goal) + "</b>" : "<b>" + fmt(l.points) + "</b>";
        html += "<td>" + big + "<small>" + fmt(l.models) + " modelos, " + fmt(l.downloads) + " descargas</small></td>";
      });
      const r = E.projectRoute(cfg, { current: 0, premium: "lottery", modelsPerDay: mpd, followers: fol, seasonShare: share });
      const t = durationText(r.days);
      html += "<td><b>" + t.big + " " + t.unit + "</b><small>con registro, lotería y boosts</small></td></tr>";
    });
    $("#lib-table").innerHTML = html + "</tbody>";
    const low = cfg.downloadRate.blockSize * 3;
    const stuck = Math.round(E.shareBelow(cfg, fol, 180, low) * 10);
    $("#lib-note").textContent = "Con " + fol + " " + plural(fol, "seguidor", "seguidores") + ", a los 6 meses unos " + stuck + " de cada 10 modelos siguen por debajo de " + low +
      " descargas y casi no dejan puntos: los puntos salen sobre todo de los pocos que se mueven bien. Son promedios y en tu cuenta puede variar mucho. Los seguidores se quedan fijos en el cálculo; en la vida real crecen poco a poco, así que al empezar vas más lento. Y subir 2 o 5 modelos al día es mucho trabajo: la tabla muestra lo que pasaría, no que sea fácil." +
      (share > 0 ? " La ventaja de " + seasonName() + " (×" + cfg.season.multiplier + ") dura solo los primeros " + cfg.season.days + " días; después esos modelos vuelven a su ritmo normal." : "");
  }

  function renderRoute() {
    const cur = Math.max(0, num("#r-current", 0));
    const sel = $("#r-premium").value;
    const mode = sel === "si" ? true : sel === "lottery" ? "lottery" : false;
    const mpd = num("#r-mpd", 0);
    const fol = clamp(num("#r-followers", 0), 0, 2000);
    const share = HAS_SEASON ? parseFloat($("#r-season").value) || 0 : 0;
    const owned = clamp(Math.floor(num("#r-owned", 0)), 0, 2000);
    const ownedAge = parseFloat($("#r-owned-age").value) || 120;
    $("#r-owned-age-field").hidden = owned === 0;
    const base = { current: cur, premium: mode, modelsPerDay: mpd, followers: fol, ownedModels: owned, ownedAge: ownedAge };
    const r = E.projectRoute(cfg, Object.assign({}, base, { seasonShare: share, marks: [30, 90, 180] }));
    const big = $("#ro-months"), unit = $("#ro-unit"), sub = $("#ro-sub");
    if (r.days === 0) {
      big.textContent = "0";
      unit.textContent = "días: ya llegaste";
      sub.textContent = "Ya tienes " + fmt(cur) + " puntos, que superan la meta de " + fmt(cfg.goal) + ".";
    } else if (r.days === null) {
      const t = durationText(null);
      big.textContent = t.big;
      unit.textContent = t.unit;
      sub.textContent = "Con estos datos no llegas en menos de diez años. Prueba subir modelos o sumar seguidores.";
    } else {
      const t = durationText(r.days);
      big.textContent = t.big;
      unit.textContent = t.unit;
      const when = new Date(Date.now() + r.days * 86400000).toLocaleDateString("es-CO", { month: "long", year: "numeric" });
      const prem = mode === "lottery" ? " Cuenta unos " + fmt(r.premiumShare * 100) + " % del tiempo con Premium por los meses que te toquen en la lotería." : "";
      sub.textContent = "Te faltan " + fmt(Math.max(0, cfg.goal - cur)) + " puntos y llegarías hacia " + when + "." + prem;
    }
    // la otra cara: lo mismo con modelos normales (si elegiste temporada) o con todos de temporada
    const alt = $("#ro-alt");
    alt.hidden = !HAS_SEASON || mpd === 0 || r.days === 0;
    if (!alt.hidden) {
      const other = E.projectRoute(cfg, Object.assign({}, base, { seasonShare: share > 0 ? 0 : 1 }));
      const ot = other.days === null ? "más de 10 años" : durationText(other.days).big + " " + durationText(other.days).unit;
      alt.textContent = (share > 0 ? "Con modelos normales tardarías " : "Si todos tus modelos nuevos fueran de " + seasonName() + ", llegarías en ") + ot + ".";
    }
    // probabilidad de Premium (solo si dejas que la lotería lo dé)
    const pm = $("#ro-premium");
    pm.hidden = mode !== "lottery" || r.days === 0;
    if (!pm.hidden) {
      const m1 = E.premiumChance(cfg, { modelsPerDay: mpd, days: 30 }), m3 = E.premiumChance(cfg, { modelsPerDay: mpd, days: 90 });
      let t = "Probabilidad de que te toque Premium al menos una vez: " + fmt(m1.chance * 100) + " % en el primer mes y " + fmt(m3.chance * 100) + " % en tres meses, registrándote todos los días.";
      if (m1.luck > 1) {
        const b1 = E.premiumChance(cfg, { modelsPerDay: 0, days: 30 }), b3 = E.premiumChance(cfg, { modelsPerDay: 0, days: 90 });
        t += " Sin subir modelos serían " + fmt(b1.chance * 100) + " % y " + fmt(b3.chance * 100) + " %.";
      }
      pm.textContent = t;
    }
    const names = { checkin: "Registro diario", lottery: "Lotería (sin premios gordos)", downloads: "Descargas y perfiles", boost: "Boosts" };
    const parts = ["checkin", "lottery", "downloads", "boost"].map((k) => ({ k: k, name: names[k], v: r.parts[k] }));
    const sum = parts.reduce((a, p) => a + p.v, 0) || 1;
    $("#ro-stack").innerHTML = parts.map((p) => '<i style="flex:0 0 ' + ((p.v / sum) * 100).toFixed(2) + "%;background:" + METAL[p.k] + '"></i>').join("");
    $("#ro-stack").setAttribute("aria-label", "Aporte por fuente: " + parts.map((p) => p.name + " " + fmt(p.v)).join(", "));
    $("#ro-legend").innerHTML = parts.map((p) => '<li><i style="background:' + METAL[p.k] + '"></i><span class="t">' + p.name + "</span><b>" + fmt(p.v) + " puntos</b></li>").join("");
    const at = (d) => (r.snapshots[d] === undefined ? "" : r.snapshots[d] >= cfg.goal ? "la meta" : fmt(r.snapshots[d]) + " puntos");
    $("#ro-snaps").textContent = r.days === 0 ? "" : "Con este ritmo tendrías " + at(30) + " a los 30 días, " + at(90) + " a los 90 y " + at(180) + " a los 6 meses.";
  }
  function fillSeasonSelects() {
    ["#r-season", "#lib-season"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.innerHTML = '<option value="0" selected>Normales</option>' +
        '<option value="0.5">La mitad de ' + seasonName() + "</option>" +
        '<option value="1">Todos de ' + seasonName() + "</option>";
    });
    $("#r-season-field").hidden = !HAS_SEASON;
    $("#lib-season").hidden = !HAS_SEASON;
    $("#lib-season-label").hidden = !HAS_SEASON;
  }
  function renderGuideFigures() {
    const set = (k, v) => $$('[data-fig="' + k + '"]').forEach((el) => { el.textContent = v; });
    set("checkin", fmt(E.monthlyCheckin(cfg, false).points));
    set("premium", "×" + cfg.premiumMultiplier);
    set("followers", "×" + fmt1(E.followerMult(cfg, 100)));
    set("cap", cfg.downloadRate.cap);
    set("boost", cfg.boost.points);
    if (cfg.profile && cfg.profile.perDownload > 0) set("profile-ratio", fmt1(1 / cfg.profile.perDownload));
    set("pc-tickets", fmt(E.premiumChance(cfg, { days: 30 }).spins));
    set("pc-month", fmt(E.premiumChance(cfg, { days: 30 }).chance * 100));
    set("pc-3months", fmt(E.premiumChance(cfg, { days: 90 }).chance * 100));
    set("pc-max", fmt(E.premiumChance(cfg, { days: 30, modelsPerDay: 4 }).chance * 100));
    if (cfg.season) {
      set("season-label", cfg.season.label);
      set("season-mult", cfg.season.multiplier);
      set("season-days", cfg.season.days);
    }
    const ref = cfg.reference;
    set("ref-models", fmt(ref.models));
    set("ref-views", fmt(ref.views));
    set("ref-downloads", fmt(ref.downloads));
    set("ref-prints", fmt(ref.prints));
    set("ref-boosts", fmt(ref.boosts));
    set("ref-boost-pts", fmt(ref.boosts * cfg.boost.points));
    set("ref-likes", fmt(ref.likes));
    set("ref-saves", fmt(ref.saves));
    set("ref-fans", fmt(ref.newFans));
    set("ref-dlpm", Math.round(ref.downloads / ref.models));
    set("ref-dl-rate", Math.round(ref.downloads / ref.views * 100));
    set("ref-print-rate", Math.round(ref.prints / ref.downloads * 100));
    set("ref-model-pts", fmt(ref.downloadPoints));
    set("ref-total", fmt(ref.totalPoints));
    set("ref-prev", fmt(ref.prevTotalPoints));
    $$("[data-goal]").forEach((el) => { el.textContent = fmt(cfg.goal); });
    [25, 50, 75].forEach((p) => { $("#mk-" + p).textContent = fmt(cfg.goal * p / 100); });
  }

  /* ---------- Canje, confeti y lista de rutina ---------- */
  function confetti() {
    if (reduceMotion) return;
    const cv = $("#confetti");
    const ctx = cv.getContext("2d");
    const W = (cv.width = window.innerWidth), H = (cv.height = window.innerHeight);
    cv.classList.add("run");
    const colors = ["#f7c948", "#ffe9a8", "#d9961a", "#c8693a", "#cfd6dc", "#2f9e7e"];
    const bits = Array.from({ length: 150 }, () => ({
      x: Math.random() * W, y: -Math.random() * H * 0.5, w: 8 + Math.random() * 8, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
      r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[Math.floor(Math.random() * colors.length)]
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, W, H);
      bits.forEach((b) => {
        b.x += b.vx; b.y += b.vy; b.vy += 0.04; b.r += b.vr;
        // Cada pieza es una moneda que gira: se achata al rotar.
        ctx.save(); ctx.translate(b.x, b.y); ctx.fillStyle = b.c;
        ctx.beginPath(); ctx.ellipse(0, 0, b.w / 2, Math.max(1.5, Math.abs(Math.cos(b.r)) * b.w / 2), 0.4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      });
      if (t - t0 < 3600) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, W, H); cv.classList.remove("run"); }
    })(t0);
  }
  function doRedeem() {
    const res = E.buyItem(state, cfg, goalItem.id);
    if (!res.ok) { toast("Te faltan " + fmt(res.price - state.points) + " puntos."); return; }
    const s = res.summary, e = s.earned;
    const total = e.checkin + e.lottery + e.downloads + e.boost + e.demo || 1;
    const rows = [
      { name: "Registro diario", v: e.checkin, c: METAL.checkin },
      { name: "Lotería", v: e.lottery, c: METAL.lottery },
      { name: "Descargas y perfiles", v: e.downloads, c: METAL.downloads },
      { name: "Boosts", v: e.boost, c: METAL.boost },
      { name: "Puntos de prueba", v: e.demo, c: METAL.demo }
    ].filter((r) => r.v > 0);
    const intro = e.demo > 0
      ? "Cruzaste la meta con ayuda de los puntos de prueba. "
      : "Llegaste a la meta en " + s.day + " días simulados. ";
    const journey = s.day === 0
      ? "Todavía no has jugado ningún día."
      : "Hasta ahora llevas " + s.claims + " " + plural(s.claims, "registro", "registros") + ", " + fmt(s.models) + " " + plural(s.models, "modelo", "modelos") + " con " + fmt(s.downloads) + " descargas, " +
        fmt(s.boosts) + " " + plural(s.boosts, "boost", "boosts") + " y " + s.premiumMonthsWon + " " + plural(s.premiumMonthsWon, "mes", "meses") + " de Premium ganados.";
    $("#canje-title").textContent = "Canje de prueba hecho: " + goalItem.name;
    $("#canje-sub").textContent = intro + journey;
    $("#canje-breakdown").innerHTML = rows.map((r) =>
      "<li><span>" + r.name + '</span><span class="bb"><i style="width:' + ((r.v / total) * 100).toFixed(1) + "%;background:" + r.c + '"></i></span><b>' + fmt(r.v) + "</b></li>"
    ).join("");
    $("#canje-note").textContent = "Fue una práctica: no se canjeó nada real. Se descontaron " + fmt(res.price) + " puntos del simulador.";
    const dlg = $("#canje-dialog");
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    confetti();
    renderAll();
  }

  const CHECKS = {
    daily: [
      { id: "d1", t: "Registrarme en Creality Cloud para mantener la racha" },
      { id: "d2", t: "Girar los boletos de la lotería" },
      { id: "d3", t: "Subir uno o dos modelos nuevos" },
      { id: "d4", t: "Responder comentarios y mensajes" },
      { id: "d5", t: "Visitar y seguir a 10 creadores con gustos parecidos" }
    ],
    weekly: [
      { id: "w1", t: "Tener una check-in Card guardada por si falto" },
      { id: "w2", t: "Seguir de vuelta a quienes me siguieron" },
      { id: "w3", t: "Compartir un modelo en redes o en la comunidad" },
      { id: "w4", t: "Revisar qué modelos se descargan más y subir algo parecido" },
      { id: "w5", t: "Dar gracias a quienes me dieron boosts" }
    ]
  };
  function loadChecks() {
    try { return JSON.parse(window.localStorage.getItem(KEY_LIST)) || {}; } catch (e) { return {}; }
  }
  function saveChecks(obj) {
    try { window.localStorage.setItem(KEY_LIST, JSON.stringify(obj)); } catch (e) { /* ignorar */ }
  }
  function renderChecks() {
    const saved = loadChecks();
    Object.keys(CHECKS).forEach((group) => {
      $("#checks-" + group).innerHTML = CHECKS[group].map((it) =>
        '<li><label><input type="checkbox" data-check="' + it.id + '"' + (saved[it.id] ? " checked" : "") + "><span>" + it.t + "</span></label></li>"
      ).join("");
    });
  }

  /* ---------- Acciones ---------- */
  function claim() {
    const r = E.claimToday(state, cfg);
    if (!r) return;
    const what = "+" + r.value + " " + unitOf(r, r.value);
    const prem = r.mult > 1 ? " (Premium ×" + r.mult + ")" : "";
    E.addLog(state, "Registro diario: " + what + prem + ".");
    toast("Registrado: " + what + prem + ".");
    renderAll();
  }
  function nextDay() {
    const res = E.nextDay(state, cfg);
    let msg = res.broken ? "Faltó el registro: la racha volvió al día 1." : "Pasó un día.";
    if (res.downloadPoints > 0) msg += " Tus modelos sumaron " + fmt(res.downloadPoints) + " puntos.";
    if (res.boost.boosts > 0) msg += " ¡Boost! " + res.boost.boosts + " " + plural(res.boost.boosts, "boost", "boosts") + ": +" + fmt(res.boost.points) + " puntos.";
    if (res.premiumEnded) msg += " Se acabó el Premium.";
    toast(msg);
    lastResult = "";
    renderAll();
  }
  function advance(days) {
    const r = E.advance(state, cfg, days);
    lastResult = "";
    let msg = "Pasaron " + fmt(days) + " días: +" + fmt(r.points) + " puntos";
    if (r.boosts > 0) msg += " (" + fmt(r.boosts) + " boosts)";
    msg += " y +" + r.tickets + " boletos" + (state.tickets > 0 ? ". Ve a la lotería." : ".");
    toast(msg);
    renderAll();
  }
  function useCard() {
    const r = E.useCard(state, cfg);
    if (!r) return;
    toast("Racha recuperada: +" + r.points + " " + plural(r.points, "punto", "puntos") + ". Hoy ya puedes registrar.");
    renderAll();
  }
  function buy(id) {
    const item = E.findItem(cfg, id);
    if (!item) return;
    if (item.kind === "goal") { doRedeem(); return; }
    const r = E.buyItem(state, cfg, id);
    if (!r.ok) { toast("Te faltan " + fmt(r.price - state.points) + " puntos."); return; }
    toast("Canjeaste " + item.name + " por " + fmt(r.price) + " puntos.");
    renderAll();
  }
  function reset(btn) {
    if (!resetArmed) {
      resetArmed = true;
      btn.textContent = "Pulsa otra vez para borrar todo";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { resetArmed = false; btn.textContent = "Reiniciar simulador"; }, 4000);
      return;
    }
    clearTimeout(resetTimer);
    resetArmed = false;
    btn.textContent = "Reiniciar simulador";
    state = E.newState();
    state.startDate = todayISO();
    lastResult = "";
    renderAll();
    toast("Simulador reiniciado.");
  }

  function onClick(e) {
    const t = e.target.closest("[data-action]");
    if (!t) {
      if (e.target.closest(".day.is-today") && !state.claimedToday) claim();
      return;
    }
    switch (t.getAttribute("data-action")) {
      case "claim": claim(); break;
      case "next-day": nextDay(); break;
      case "advance": advance(parseInt(t.getAttribute("data-days"), 10)); break;
      case "spin": doSpin(); break;
      case "spin-all": doSpinAll(); break;
      case "upload": E.uploadModels(state, cfg, parseInt(t.getAttribute("data-n"), 10)); renderAll(); break;
      case "mpd": state.settings.modelsPerDay = parseInt(t.getAttribute("data-n"), 10); renderAll(); break;
      case "season": state.settings.seasonal = t.getAttribute("data-on") === "1"; renderAll(); break;
      case "followers":
        state.followers = clamp(state.followers + parseInt(t.getAttribute("data-delta"), 10), 0, 2000);
        renderAll();
        break;
      case "use-card": useCard(); break;
      case "buy": buy(t.getAttribute("data-id")); break;
      case "reset": reset(t); break;
      case "demo-points": E.grantDemoPoints(state, cfg); toast("Sumaste " + fmt(cfg.goal) + " puntos de prueba."); renderAll(); break;
      case "reset-list": {
        const saved = loadChecks();
        CHECKS[t.getAttribute("data-group")].forEach((it) => { delete saved[it.id]; });
        saveChecks(saved);
        renderChecks();
        break;
      }
    }
  }

  /* ---------- Arranque ---------- */
  function init() {
    fillSeasonSelects();
    renderGuideFigures();
    buildThermoMarks();
    buildRaffle();
    buildLegend();
    buildStairs();
    renderChecks();
    renderAll();
    renderStairs();
    renderLibrary();
    renderRoute();

    document.addEventListener("click", onClick);
    $("#dl-range").addEventListener("input", renderStairs);
    $("#lib-followers").addEventListener("input", renderLibrary);
    $("#lib-season").addEventListener("input", renderLibrary);
    $$("#route-form input, #route-form select").forEach((el) => el.addEventListener("input", renderRoute));
    document.addEventListener("change", (e) => {
      const cb = e.target.closest("[data-check]");
      if (!cb) return;
      const saved = loadChecks();
      if (cb.checked) saved[cb.getAttribute("data-check")] = true; else delete saved[cb.getAttribute("data-check")];
      saveChecks(saved);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
