/*
 * Motor del simulador de Fiebre de Puntos.
 * Lógica pura, sin DOM: recibe la configuración (js/config.js) y un estado,
 * y devuelve resultados. Así se puede probar con Node (tests/engine.test.js).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FPEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LOG_LIMIT = 40;

  function newState() {
    return {
      startDate: null,      // fecha real en que empezó la simulación (AAAA-MM-DD)
      day: 0,               // días simulados que han pasado
      points: 0,
      tickets: 0,
      premiumDays: 0,
      pos: 0,               // casilla de la tabla semanal que corresponde a "hoy" (0 a 6)
      streak: 0,
      bestStreak: 0,
      claimedToday: false,
      totalClaims: 0,
      missed: 0,            // días seguidos sin registrar antes de hoy
      restore: null,        // { pos, streak } a los que volvería la racha con una check-in Card
      cards: 0,             // check-in Cards disponibles
      spins: 0,
      cloudGB: 0,           // GB de nube ganados en la lotería
      premiumMonthsWon: 0,
      followers: 0,
      boosts: 0,            // boosts recibidos
      modelCounter: 0,
      uploadFrac: 0,
      models: [],           // { id, name, age, downloads, frac, blocksPaid }
      makeNow: 0,           // usos de MakeNow canjeados
      bought: {},           // veces que se canjeó cada producto de la tienda
      settings: { modelsPerDay: 0 },
      earned: { checkin: 0, lottery: 0, downloads: 0, boost: 0, demo: 0 },
      redeems: 0,
      log: []
    };
  }

  // Mezcla un estado guardado con los valores por defecto (por si se agregan campos).
  function hydrate(saved) {
    var base = newState();
    if (!saved || typeof saved !== "object") return base;
    Object.keys(base).forEach(function (k) {
      if (saved[k] === undefined) return;
      if (k === "settings" || k === "earned" || k === "bought") base[k] = Object.assign({}, base[k], saved[k]);
      else base[k] = saved[k];
    });
    if (!Array.isArray(base.models)) base.models = [];
    if (!Array.isArray(base.log)) base.log = [];
    return base;
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function addLog(s, text) {
    s.log.unshift({ day: s.day, text: text });
    if (s.log.length > LOG_LIMIT) s.log.length = LOG_LIMIT;
  }

  function multiplier(s, cfg) {
    return s.premiumDays > 0 ? cfg.premiumMultiplier : 1;
  }

  // Recompensa de la casilla "index" de la tabla semanal, con el Premium aplicado.
  function rewardAt(s, cfg, index) {
    var base = cfg.checkin[index % cfg.checkin.length];
    var mult = multiplier(s, cfg);
    if (base.type === "ticket" && !cfg.premiumDoublesTickets) mult = 1;
    return { type: base.type, base: base.value, mult: mult, value: base.value * mult };
  }

  // Registrar la visita de hoy. Devuelve la recompensa o null si ya estaba registrado.
  // Si venías de faltar días y no usaste una check-in Card, la racha ya estaba cortada.
  function claimToday(s, cfg) {
    if (s.claimedToday) return null;
    s.missed = 0;
    s.restore = null;
    var r = rewardAt(s, cfg, s.pos);
    if (r.type === "points") {
      s.points += r.value;
      s.earned.checkin += r.value;
    } else {
      s.tickets += r.value;
    }
    s.streak += 1;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    s.totalClaims += 1;
    s.claimedToday = true;
    return r;
  }

  /* ----- check-in Card ----- */

  function canUseCard(s, cfg) {
    return s.cards > 0 && !s.claimedToday && !!s.restore && s.missed >= 1 && s.missed <= cfg.card.maxDays;
  }

  // Recupera la racha: 1 punto por cada día perdido y hoy vuelve a tener su recompensa.
  function useCard(s, cfg) {
    if (!canUseCard(s, cfg)) return null;
    var m = s.missed;
    var pts = m * cfg.card.pointsPerDay;
    s.cards -= 1;
    s.points += pts;
    s.earned.checkin += pts;
    s.streak = s.restore.streak + m;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    s.pos = (s.restore.pos + m) % cfg.checkin.length;
    s.totalClaims += m;
    s.missed = 0;
    s.restore = null;
    addLog(s, "Check-in Card: recuperaste " + m + (m === 1 ? " día" : " días") + " de racha (+" + pts + (pts === 1 ? " punto" : " puntos") + ").");
    return { days: m, points: pts };
  }

  /* ----- tienda de regalos ----- */

  function findItem(cfg, id) {
    for (var i = 0; i < cfg.store.length; i++) if (cfg.store[i].id === id) return cfg.store[i];
    return null;
  }

  function itemPrice(s, cfg, item) {
    if (item.firstPrice !== undefined && !(s.bought[item.id] > 0)) return item.firstPrice;
    return item.price;
  }

  function goalItem(cfg) {
    for (var i = 0; i < cfg.store.length; i++) if (cfg.store[i].kind === "goal") return cfg.store[i];
    return null;
  }

  function canRedeem(s, cfg) {
    var g = goalItem(cfg);
    return !!g && s.points >= g.price;
  }

  // Canjea un producto de la tienda. Devuelve { ok, item, price, summary } o { ok:false, reason }.
  function buyItem(s, cfg, id) {
    var item = findItem(cfg, id);
    if (!item) return { ok: false, reason: "unknown" };
    var price = itemPrice(s, cfg, item);
    if (s.points < price) return { ok: false, reason: "points", item: item, price: price };
    var summary = null;
    if (item.kind === "goal") {
      summary = {
        day: s.day,
        claims: s.totalClaims,
        bestStreak: s.bestStreak,
        premiumMonthsWon: s.premiumMonthsWon,
        models: s.models.length,
        downloads: s.models.reduce(function (a, m) { return a + m.downloads; }, 0),
        boosts: s.boosts,
        earned: Object.assign({}, s.earned)
      };
    }
    s.points -= price;
    s.bought[id] = (s.bought[id] || 0) + 1;
    if (item.kind === "card") {
      s.cards += 1;
      addLog(s, "Tienda: canjeaste una check-in Card (-" + price + " puntos).");
    } else if (item.kind === "makenow") {
      s.makeNow += item.value;
      addLog(s, "Tienda: canjeaste MakeNow, " + item.value + " veces (-" + price + " puntos).");
    } else {
      s.redeems += 1;
      addLog(s, "Tienda: canje de prueba de " + item.name + " (-" + price + " puntos).");
    }
    return { ok: true, item: item, price: price, summary: summary };
  }

  function grantDemoPoints(s, cfg) {
    s.points += cfg.goal;
    s.earned.demo += cfg.goal;
    addLog(s, "Modo demo: +" + cfg.goal + " puntos de prueba.");
  }

  /* ----- descargas ----- */

  // Puntos que paga el bloque de descargas número "b" (0 = primer bloque de 10).
  function blockRate(cfg, b) {
    var r = cfg.downloadRate;
    return Math.min(r.cap, r.start + r.step * Math.max(0, b));
  }

  // Cuántos bloques hacen falta para llegar al tope (por ejemplo 12 bloques = 120 descargas).
  function blocksToCap(cfg) {
    var r = cfg.downloadRate;
    return Math.ceil((r.cap - r.start) / r.step) + 1;
  }

  // Puntos que paga el siguiente bloque de 10 cuando el modelo ya lleva "downloads".
  function tierRate(cfg, downloads) {
    return blockRate(cfg, Math.floor(Math.max(0, downloads) / cfg.downloadRate.blockSize));
  }

  // Puntos totales que deja UN modelo que llega a "downloads" descargas.
  function pointsForDownloads(cfg, downloads) {
    var blocks = Math.floor(Math.max(0, downloads) / cfg.downloadRate.blockSize), total = 0;
    for (var b = 0; b < blocks; b++) total += blockRate(cfg, b);
    return total;
  }

  // Cuánto se multiplican las descargas de todos tus modelos según tus seguidores mutuos.
  function followerMult(cfg, followers) {
    return 1 + Math.max(0, followers) * cfg.followerFactor;
  }

  function totalShare(cfg) {
    var t = 0;
    cfg.modelTypes.forEach(function (m) { t += m.share; });
    return t;
  }

  // Descargas por día de un modelo "promedio". Solo da una idea: cada modelo es distinto
  // y la mayoría descarga mucho menos que el promedio.
  function downloadsPerDay(cfg, followers) {
    var mean = 0;
    cfg.modelTypes.forEach(function (m) { mean += m.share * m.perDay; });
    return (mean / totalShare(cfg)) * followerMult(cfg, followers);
  }

  // Elige al azar qué tan bien se va a mover un modelo nuevo (sin movimiento, lento, normal, bueno o éxito).
  function pickModelType(cfg, rng) {
    var r = rng() * totalShare(cfg);
    for (var i = 0; i < cfg.modelTypes.length; i++) {
      r -= cfg.modelTypes[i].share;
      if (r < 0) return cfg.modelTypes[i];
    }
    return cfg.modelTypes[cfg.modelTypes.length - 1];
  }

  function pushModels(s, cfg, n, rng) {
    for (var i = 0; i < n; i++) {
      var t = pickModelType(cfg, rng || Math.random);
      s.modelCounter += 1;
      s.models.push({ id: s.modelCounter, name: "Modelo " + s.modelCounter, age: 0, downloads: 0, frac: 0, blocksPaid: 0, kind: t.id, perDay: t.perDay });
    }
  }

  // Subida manual: queda en el registro de actividad.
  function uploadModels(s, cfg, n, rng) {
    pushModels(s, cfg, n, rng);
    if (n > 0) addLog(s, n === 1 ? "Subiste un modelo nuevo." : "Subiste " + n + " modelos nuevos.");
    return n;
  }

  // Un día de descargas para todos los modelos. Devuelve los puntos ganados.
  function tickModels(s, cfg) {
    var gained = 0, mult = followerMult(cfg, s.followers);
    for (var i = 0; i < s.models.length; i++) {
      var m = s.models[i];
      m.age += 1;
      m.frac += (m.perDay === undefined ? downloadsPerDay(cfg, 0) : m.perDay) * mult;
      var whole = Math.floor(m.frac);
      m.frac -= whole;
      m.downloads += whole;
      while (m.downloads >= (m.blocksPaid + 1) * cfg.downloadRate.blockSize) {
        gained += blockRate(cfg, m.blocksPaid);
        m.blocksPaid += 1;
      }
    }
    s.points += gained;
    s.earned.downloads += gained;
    return gained;
  }

  // Puntos que deja en promedio un modelo cuando lleva "age" días publicado (promedio sobre todos los tipos).
  function expectedModelPoints(cfg, followers, age) {
    var mult = followerMult(cfg, followers), sum = 0;
    cfg.modelTypes.forEach(function (t) { sum += t.share * pointsForDownloads(cfg, t.perDay * mult * age); });
    return sum / totalShare(cfg);
  }

  // Qué parte de tus modelos sigue por debajo de "limit" descargas a los "age" días (de 0 a 1).
  function shareBelow(cfg, followers, age, limit) {
    var mult = followerMult(cfg, followers), n = 0;
    cfg.modelTypes.forEach(function (t) { if (t.perDay * mult * age < limit) n += t.share; });
    return n / totalShare(cfg);
  }

  /* ----- boosts ----- */

  // Descargas que esperas por día con los modelos y seguidores que tienes ahora (promedio, sin azar).
  function expectedDailyDownloads(s, cfg) {
    var mult = followerMult(cfg, s.followers), perDay = 0;
    for (var i = 0; i < s.models.length; i++) {
      var m = s.models[i];
      perDay += (m.perDay === undefined ? downloadsPerDay(cfg, 0) : m.perDay) * mult;
    }
    return perDay;
  }

  // Personas que te dan boosts por día, en promedio: una tasa pequeña fija más una parte de tus descargas.
  function boostRate(s, cfg) {
    if (!s.models.length) return 0; // sin modelos no hay a quién darle boosts
    var b = cfg.boost;
    return Math.min(20, b.baseRate + b.perDownload * expectedDailyDownloads(s, cfg));
  }

  function expectedBoostsPerPerson(cfg) {
    var total = 0, sum = 0;
    cfg.boost.amounts.forEach(function (a) { total += a.weight; sum += a.n * a.weight; });
    return total ? sum / total : 0;
  }

  function poisson(lambda, rng) {
    var L = Math.exp(-lambda), k = 0, p = 1;
    do { k += 1; p *= rng(); } while (p > L);
    return k - 1;
  }

  function pickBoosts(cfg, rng) {
    var total = 0;
    cfg.boost.amounts.forEach(function (a) { total += a.weight; });
    var r = rng() * total;
    for (var i = 0; i < cfg.boost.amounts.length; i++) {
      r -= cfg.boost.amounts[i].weight;
      if (r < 0) return cfg.boost.amounts[i].n;
    }
    return cfg.boost.amounts[cfg.boost.amounts.length - 1].n;
  }

  // Tira los dados de un día: cuántas personas te dieron boosts y cuántos boosts en total.
  function rollBoosts(s, cfg, rng) {
    var people = poisson(boostRate(s, cfg), rng), boosts = 0;
    for (var i = 0; i < people; i++) boosts += pickBoosts(cfg, rng);
    var pts = boosts * cfg.boost.points;
    s.points += pts;
    s.earned.boost += pts;
    s.boosts += boosts;
    return { people: people, boosts: boosts, points: pts };
  }

  // Lo que esperas en un mes (30 días) con los modelos y seguidores que tienes ahora.
  // Son promedios, sin azar: la vida real sube y baja mucho de un mes a otro.
  function outlook(s, cfg) {
    var downloads = expectedDailyDownloads(s, cfg) * 30;
    var people = boostRate(s, cfg) * 30;
    var boosts = people * expectedBoostsPerPerson(cfg);
    return {
      downloads: downloads,
      views: downloads * (cfg.viewsPerDownload || 0),
      boostPeople: people,
      boosts: boosts,
      boostPoints: boosts * cfg.boost.points
    };
  }

  /* ----- paso del tiempo ----- */

  // Cierra el día. Si hoy no te registraste, la racha se corta y la tabla vuelve a la primera casilla,
  // pero se guarda a dónde volvería con una check-in Card (solo si faltaste hasta 2 días seguidos).
  function endDay(s, cfg, rng, quiet) {
    var broken = false;
    if (s.claimedToday) {
      s.pos = (s.pos + 1) % cfg.checkin.length;
      s.missed = 0;
      s.restore = null;
    } else {
      if (s.missed === 0) {
        s.restore = s.streak > 0 ? { pos: s.pos, streak: s.streak } : null;
        broken = s.streak > 0;
      }
      s.missed += 1;
      s.pos = 0;
      s.streak = 0;
      if (s.missed > cfg.card.maxDays) s.restore = null;
    }
    s.claimedToday = false;
    s.day += 1;
    var premiumEnded = false;
    if (s.premiumDays > 0) {
      s.premiumDays -= 1;
      premiumEnded = s.premiumDays === 0;
    }
    s.uploadFrac += Number(s.settings.modelsPerDay) || 0;
    var up = Math.floor(s.uploadFrac);
    if (up > 0) {
      s.uploadFrac -= up;
      pushModels(s, cfg, up, rng); // la subida automática no ensucia el registro
    }
    var fromDownloads = tickModels(s, cfg);
    var boost = rollBoosts(s, cfg, rng || Math.random);
    if (!quiet) {
      if (broken) addLog(s, "Faltó un registro: la racha volvió al día 1.");
      if (premiumEnded) addLog(s, "Se acabó el Premium: las recompensas vuelven a ×1.");
      if (boost.boosts > 0) {
        addLog(s, "Boost: " + (boost.people === 1 ? "1 persona te dio " : boost.people + " personas te dieron ") + boost.boosts + (boost.boosts === 1 ? " boost" : " boosts") + " (+" + boost.points + " puntos).");
      }
    }
    return { broken: broken, premiumEnded: premiumEnded, downloadPoints: fromDownloads, boost: boost };
  }

  function nextDay(s, cfg, rng) {
    return endDay(s, cfg, rng, false);
  }

  // Avanza n días registrándote cada uno (modo constante).
  function advance(s, cfg, n, rng) {
    var p0 = s.points, t0 = s.tickets, dl0 = s.earned.downloads, bo0 = s.earned.boost, b0 = s.boosts;
    for (var i = 0; i < n; i++) {
      claimToday(s, cfg);
      endDay(s, cfg, rng, true);
    }
    var res = {
      days: n,
      points: s.points - p0,
      tickets: s.tickets - t0,
      downloadPoints: s.earned.downloads - dl0,
      boostPoints: s.earned.boost - bo0,
      boosts: s.boosts - b0
    };
    addLog(s, "Pasaron " + n + (n === 1 ? " día" : " días") + " con registro diario: +" + res.points + " puntos y +" + res.tickets + " boletos.");
    return res;
  }

  /* ----- lotería ----- */

  // Probabilidad (de 0 a 1) de cada premio de la cuadrícula, según su peso.
  function chances(cfg) {
    var total = cfg.raffle.reduce(function (a, p) { return a + p.weight; }, 0);
    return cfg.raffle.map(function (p) { return total ? p.weight / total : 0; });
  }

  // Puntos esperados por giro sin contar los premios gordos (los marcados "rare").
  function expectedPointsPerSpin(cfg) {
    var total = 0, pts = 0;
    cfg.raffle.forEach(function (p) {
      total += p.weight;
      if (p.kind === "points" && !p.rare) pts += p.weight * p.value;
    });
    return total ? pts / total : 0;
  }

  // Gasta un boleto. Devuelve { index, prize } (index = lugar del premio en cfg.raffle) o null si no hay boletos.
  function spin(s, cfg, rng) {
    rng = rng || Math.random;
    if (s.tickets < 1) return null;
    var total = cfg.raffle.reduce(function (a, p) { return a + p.weight; }, 0);
    var r = rng() * total, index = cfg.raffle.length - 1;
    for (var i = 0; i < cfg.raffle.length; i++) {
      r -= cfg.raffle[i].weight;
      if (r < 0) { index = i; break; }
    }
    var prize = cfg.raffle[index];
    s.tickets -= 1;
    s.spins += 1;
    if (prize.kind === "points") {
      s.points += prize.value;
      s.earned.lottery += prize.value;
      addLog(s, "Lotería: +" + prize.value + " puntos.");
    } else if (prize.kind === "premium") {
      s.premiumDays += cfg.premiumMonthDays * prize.value;
      s.premiumMonthsWon += prize.value;
      addLog(s, "Lotería: +1 mes de Premium. Ya acumulas " + Math.ceil(s.premiumDays / cfg.premiumMonthDays) + " (recompensas ×" + cfg.premiumMultiplier + ").");
    } else if (prize.kind === "storage") {
      s.cloudGB += prize.value;
      addLog(s, "Lotería: +" + prize.value + " GB de nube.");
    } else {
      addLog(s, "Lotería: sin premio esta vez.");
    }
    return { index: index, prize: prize };
  }

  // Gira todos los boletos de una vez.
  function spinAll(s, cfg, rng) {
    var out = { spins: 0, points: 0, premiumMonths: 0, cloudGB: 0 };
    while (s.tickets >= 1) {
      var r = spin(s, cfg, rng);
      out.spins += 1;
      if (r.prize.kind === "points") out.points += r.prize.value;
      else if (r.prize.kind === "premium") out.premiumMonths += r.prize.value;
      else if (r.prize.kind === "storage") out.cloudGB += r.prize.value;
    }
    return out;
  }

  /* ----- estimaciones ----- */

  // Puntos por descargas que deja una biblioteca que crece "mpd" modelos por día, pasados "days" días.
  // Usa el promedio de todos los tipos de modelo: unos pocos éxitos y muchos que casi no se mueven.
  function libraryPoints(cfg, mpd, followers, days) {
    var sum = 0;
    for (var a = 1; a <= days; a++) sum += expectedModelPoints(cfg, followers, a);
    var mean = downloadsPerDay(cfg, followers);
    return {
      models: Math.floor(mpd * days),
      downloads: Math.round(mpd * mean * days * (days + 1) / 2),
      points: Math.round(mpd * sum)
    };
  }

  // Qué parte del tiempo tienes Premium, de 0 a 1.
  //   false o "no": nunca. true o "always": siempre.
  //   "lottery": solo con los meses que te toquen en la lotería (promedio de muchos giros).
  function premiumShare(cfg, mode) {
    if (mode === true || mode === "always") return 1;
    if (mode !== "lottery") return 0;
    var tickets = 0, total = 0, months = 0;
    cfg.checkin.forEach(function (c) { if (c.type === "ticket") tickets += c.value; });
    var ticketsPerDay = tickets / cfg.checkin.length;
    cfg.raffle.forEach(function (p) {
      total += p.weight;
      if (p.kind === "premium") months += p.weight * p.value;
    });
    var perSpin = total ? months / total : 0;
    var boost = cfg.premiumDoublesTickets ? cfg.premiumMultiplier - 1 : 0;
    var q = 0;
    for (var i = 0; i < 80; i++) q = Math.min(1, ticketsPerDay * (1 + q * boost) * perSpin * cfg.premiumMonthDays);
    return q;
  }

  // Lo que deja el registro diario en "days" días seguidos (por defecto un mes de 30 días).
  function monthlyCheckin(cfg, premium, days) {
    var n = days || 30, pts = 0, tickets = 0;
    var mult = premium ? cfg.premiumMultiplier : 1;
    var tmult = premium && cfg.premiumDoublesTickets ? cfg.premiumMultiplier : 1;
    for (var i = 0; i < n; i++) {
      var slot = cfg.checkin[i % cfg.checkin.length];
      if (slot.type === "points") pts += slot.value * mult;
      else tickets += slot.value * tmult;
    }
    return { points: pts, tickets: tickets };
  }

  // Ruta estimada a la meta, día por día y con valores esperados (sin azar).
  // Supone que no faltas ningún día y que empiezas sin modelos.
  function projectRoute(cfg, o) {
    var mpd = Math.max(0, o.modelsPerDay || 0), fol = Math.max(0, o.followers || 0);
    var q = premiumShare(cfg, o.premium);
    var mult = 1 + q * (cfg.premiumMultiplier - 1);
    var tmult = cfg.premiumDoublesTickets ? mult : 1;
    var cur = Math.max(0, o.current || 0);
    if (cur >= cfg.goal) {
      return { days: 0, months: 0, parts: { checkin: 0, lottery: 0, downloads: 0, boost: 0 }, snapshots: {}, current: cur };
    }
    var spinEV = expectedPointsPerSpin(cfg);
    var boostEV = expectedBoostsPerPerson(cfg) * cfg.boost.points;
    var maxDays = o.maxDays || 3650;
    var perModelDay = downloadsPerDay(cfg, fol);
    var marks = o.marks || [30, 90, 180, 365];
    var checkin = 0, lottery = 0, boost = 0, S = 0;
    var hit = null, parts = null, snaps = {};
    for (var t = 1; t <= maxDays; t++) {
      var slot = cfg.checkin[(t - 1) % cfg.checkin.length];
      if (slot.type === "points") checkin += slot.value * mult;
      else lottery += slot.value * tmult * spinEV;
      var lambda = mpd > 0 ? Math.min(20, cfg.boost.baseRate + cfg.boost.perDownload * mpd * t * perModelDay) : 0;
      boost += lambda * boostEV;
      S += expectedModelPoints(cfg, fol, t);
      var downloads = mpd * S;
      var total = cur + checkin + lottery + boost + downloads;
      if (marks.indexOf(t) >= 0) snaps[t] = total;
      if (hit === null && total >= cfg.goal) {
        hit = t;
        parts = { checkin: checkin, lottery: lottery, downloads: downloads, boost: boost };
      }
      if (hit !== null && t >= 365) break;
    }
    if (hit === null) parts = { checkin: checkin, lottery: lottery, downloads: mpd * S, boost: boost };
    return { days: hit, months: hit === null ? null : hit / 30.44, parts: parts, snapshots: snaps, current: cur, premiumShare: q };
  }

  function temperature(points, goal) {
    return 36 + 4 * clamp(points / goal, 0, 1);
  }

  return {
    newState: newState,
    hydrate: hydrate,
    multiplier: multiplier,
    rewardAt: rewardAt,
    claimToday: claimToday,
    canUseCard: canUseCard,
    useCard: useCard,
    nextDay: nextDay,
    advance: advance,
    uploadModels: uploadModels,
    blockRate: blockRate,
    blocksToCap: blocksToCap,
    tierRate: tierRate,
    pointsForDownloads: pointsForDownloads,
    downloadsPerDay: downloadsPerDay,
    followerMult: followerMult,
    expectedModelPoints: expectedModelPoints,
    shareBelow: shareBelow,
    boostRate: boostRate,
    outlook: outlook,
    expectedBoostsPerPerson: expectedBoostsPerPerson,
    chances: chances,
    expectedPointsPerSpin: expectedPointsPerSpin,
    spin: spin,
    spinAll: spinAll,
    findItem: findItem,
    itemPrice: itemPrice,
    goalItem: goalItem,
    canRedeem: canRedeem,
    buyItem: buyItem,
    grantDemoPoints: grantDemoPoints,
    libraryPoints: libraryPoints,
    monthlyCheckin: monthlyCheckin,
    premiumShare: premiumShare,
    projectRoute: projectRoute,
    temperature: temperature,
    addLog: addLog
  };
});
