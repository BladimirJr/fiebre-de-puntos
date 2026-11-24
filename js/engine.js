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
      models: [],           // { id, name, age, downloads, frac, blocksPaid, kind, perDay, seasonal }
      makeNow: 0,           // usos de MakeNow canjeados
      bought: {},           // veces que se canjeó cada producto de la tienda
      settings: { modelsPerDay: 0, seasonal: false },
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
  // Es la suma de los bloques completos, hecha con fórmula para que sea rápida:
  // los bloques antes del tope suben de a "step" y los demás pagan el tope.
  function pointsForDownloads(cfg, downloads) {
    var r = cfg.downloadRate;
    var n = Math.floor(Math.max(0, downloads) / r.blockSize);
    var k = Math.min(n, blocksToCap(cfg) - 1);
    return k * r.start + r.step * k * (k - 1) / 2 + (n - k) * r.cap;
  }

  // Bloques de perfil de impresión pagados por un modelo con "modelDownloads" descargas.
  // Cada descarga del modelo trae "perDownload" descargas de perfil y cada 10 de perfil pagan 10 puntos fijos.
  function profileBlocks(cfg, modelDownloads) {
    var p = cfg.profile;
    if (!p || !(p.perDownload > 0)) return 0;
    return Math.floor(Math.floor(Math.max(0, modelDownloads) * p.perDownload) / p.blockSize);
  }

  // Puntos que deja el perfil de impresión de UN modelo que llega a "modelDownloads" descargas.
  function profilePoints(cfg, modelDownloads) {
    return cfg.profile ? profileBlocks(cfg, modelDownloads) * cfg.profile.points : 0;
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

  // ¿Está activa la temporada el día "day" de la simulación? (días 1 a cfg.season.days)
  function seasonOn(cfg, day) {
    return !!(cfg.season && cfg.season.multiplier > 1 && day <= cfg.season.days);
  }

  // Cuántas veces más descargas junta un modelo de temporada mientras dura (1 si no hay temporada).
  function seasonMultiplier(cfg) {
    return cfg.season && cfg.season.multiplier > 1 ? cfg.season.multiplier : 1;
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
      s.models.push({ id: s.modelCounter, name: "Modelo " + s.modelCounter, age: 0, downloads: 0, frac: 0, blocksPaid: 0, profBlocks: 0, kind: t.id, perDay: t.perDay, seasonal: !!(s.settings.seasonal && seasonMultiplier(cfg) > 1) });
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
    var inSeason = seasonOn(cfg, s.day) ? seasonMultiplier(cfg) : 1;
    for (var i = 0; i < s.models.length; i++) {
      var m = s.models[i];
      m.age += 1;
      m.frac += (m.perDay === undefined ? downloadsPerDay(cfg, 0) : m.perDay) * mult * (m.seasonal ? inSeason : 1);
      var whole = Math.floor(m.frac);
      m.frac -= whole;
      m.downloads += whole;
      while (m.downloads >= (m.blocksPaid + 1) * cfg.downloadRate.blockSize) {
        gained += blockRate(cfg, m.blocksPaid);
        m.blocksPaid += 1;
      }
      // perfil de impresión: 10 puntos fijos por cada 10 descargas del perfil
      var pb = profileBlocks(cfg, m.downloads);
      if (m.profBlocks === undefined) m.profBlocks = pb; // modelo guardado antes de esta regla: no se paga de golpe
      if (pb > m.profBlocks) {
        gained += (pb - m.profBlocks) * cfg.profile.points;
        m.profBlocks = pb;
      }
    }
    s.points += gained;
    s.earned.downloads += gained;
    return gained;
  }

  // Puntos que deja en promedio un modelo cuando lleva "age" días publicado (promedio sobre todos los tipos).
  // "extra" son días de descargas de más (por ejemplo los de una temporada), ya multiplicados.
  function expectedModelPoints(cfg, followers, age, extra) {
    var mult = followerMult(cfg, followers), sum = 0, days = age + (extra || 0);
    cfg.modelTypes.forEach(function (t) { var d = t.perDay * mult * days; sum += t.share * (pointsForDownloads(cfg, d) + profilePoints(cfg, d)); });
    return sum / totalShare(cfg);
  }

  // Qué parte de tus modelos sigue por debajo de "limit" descargas a los "age" días (de 0 a 1).
  function shareBelow(cfg, followers, age, limit) {
    var mult = followerMult(cfg, followers), n = 0;
    cfg.modelTypes.forEach(function (t) { if (t.perDay * mult * age < limit) n += t.share; });
    return n / totalShare(cfg);
  }

  /* ----- boosts ----- */

  // Descargas que esperas en un día con los modelos y seguidores que tienes (promedio, sin azar).
  // "day" es el día de la simulación (por defecto, el próximo que se va a vivir).
  function expectedDailyDownloads(s, cfg, day) {
    var mult = followerMult(cfg, s.followers);
    var inSeason = seasonOn(cfg, day === undefined ? s.day + 1 : day) ? seasonMultiplier(cfg) : 1;
    var perDay = 0;
    for (var i = 0; i < s.models.length; i++) {
      var m = s.models[i];
      perDay += (m.perDay === undefined ? downloadsPerDay(cfg, 0) : m.perDay) * mult * (m.seasonal ? inSeason : 1);
    }
    return perDay;
  }

  // Personas que te dan boosts en un día, en promedio: una tasa pequeña fija más una parte de tus descargas.
  function boostRate(s, cfg, day) {
    if (!s.models.length) return 0; // sin modelos no hay a quién darle boosts
    var b = cfg.boost;
    return Math.min(20, b.baseRate + b.perDownload * expectedDailyDownloads(s, cfg, day));
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
    var people = poisson(boostRate(s, cfg, s.day), rng), boosts = 0;
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
    var downloads = 0, people = 0, k, m, i;
    var mult = followerMult(cfg, s.followers);
    // días de temporada que le quedan al mes que viene (los modelos de temporada ganan de más)
    var left = seasonMultiplier(cfg) > 1 ? Math.max(0, Math.min(30, cfg.season.days - s.day)) : 0;
    var extra = left * (seasonMultiplier(cfg) - 1);
    for (i = 0; i < s.models.length; i++) {
      m = s.models[i];
      downloads += (m.perDay === undefined ? downloadsPerDay(cfg, 0) : m.perDay) * mult * (30 + (m.seasonal ? extra : 0));
    }
    for (k = 1; k <= 30; k++) people += boostRate(s, cfg, s.day + k);
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

  // Cuánto se multiplica el peso del Premium en la lotería (1 = sin ventaja).
  // Según la experiencia del autor, subir modelos y mantener la racha ayuda: ver cfg.premiumLuck.
  // "modelsPerDay" son los modelos que subes por día y "streak" los días seguidos de racha
  // (si no se da, se cuenta como una racha completa).
  function premiumLuck(cfg, modelsPerDay, streak) {
    var l = cfg.premiumLuck;
    if (!l || !(l.perModelPerDay > 0)) return 1;
    if (streak !== undefined && streak < l.streakDays) return 1;
    return 1 + Math.min(l.max, l.perModelPerDay * Math.max(0, modelsPerDay || 0));
  }

  // Modelos que subes por día en la última semana (cuenta los modelos de menos de 7 días).
  function recentUploadRate(s) {
    var n = 0;
    for (var i = 0; i < s.models.length; i++) if (s.models[i].age < 7) n += 1;
    return n / 7;
  }

  // Peso de cada premio con la suerte del Premium aplicada.
  function raffleWeights(cfg, luck) {
    return cfg.raffle.map(function (p) { return p.kind === "premium" ? p.weight * (luck || 1) : p.weight; });
  }

  // Probabilidad (de 0 a 1) de cada premio de la cuadrícula, según su peso.
  // "luck" (opcional) es la suerte del Premium (ver premiumLuck).
  function chances(cfg, luck) {
    var w = raffleWeights(cfg, luck);
    var total = w.reduce(function (a, x) { return a + x; }, 0);
    return w.map(function (x) { return total ? x / total : 0; });
  }

  // Probabilidad de que un solo giro dé un mes de Premium.
  function premiumPerSpin(cfg, luck) {
    var w = raffleWeights(cfg, luck), total = 0, prem = 0;
    cfg.raffle.forEach(function (p, i) {
      total += w[i];
      if (p.kind === "premium") prem += w[i];
    });
    return total ? Math.min(1, prem / total) : 0;
  }

  // Probabilidad de que te toque al menos 1 mes de Premium en "days" días (30 por defecto).
  // Cuenta los boletos que ya tienes ("tickets") más los del registro diario si no faltas ningún día.
  // Opciones: modelsPerDay, streak (días de racha; sin dato = racha completa), premium (true si ya
  // tienes Premium todo ese tiempo y los boletos valen doble), tickets, days.
  function premiumChance(cfg, o) {
    o = o || {};
    var days = o.days || 30;
    var luck = premiumLuck(cfg, o.modelsPerDay, o.streak);
    var spins = Math.max(0, o.tickets || 0) + monthlyCheckin(cfg, !!o.premium, days).tickets;
    var perSpin = premiumPerSpin(cfg, luck);
    return { days: days, spins: spins, perSpin: perSpin, luck: luck, chance: 1 - Math.pow(1 - perSpin, spins) };
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
    var w = raffleWeights(cfg, premiumLuck(cfg, recentUploadRate(s), s.streak));
    var total = w.reduce(function (a, x) { return a + x; }, 0);
    var r = rng() * total, index = cfg.raffle.length - 1;
    for (var i = 0; i < w.length; i++) {
      r -= w[i];
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
  // "seasonShare" (0 a 1) es qué parte de esos modelos sigue la temporada: juntan más descargas
  // mientras dura. Un modelo que lleva "a" días de vida a los "days" días vivió max(0, a - (days - S))
  // días de temporada (S es la duración de la temporada).
  function libraryPoints(cfg, mpd, followers, days, seasonShare) {
    var M = seasonMultiplier(cfg);
    var f = M > 1 ? clamp(seasonShare || 0, 0, 1) : 0;
    var late = M > 1 ? Math.max(0, days - cfg.season.days) : 0;
    var mean = downloadsPerDay(cfg, followers), sum = 0, dl = 0;
    for (var a = 1; a <= days; a++) {
      var e = Math.max(0, a - late);
      sum += f ? (1 - f) * expectedModelPoints(cfg, followers, a) + f * expectedModelPoints(cfg, followers, a, (M - 1) * e) : expectedModelPoints(cfg, followers, a);
      dl += mean * (a + f * (M - 1) * e);
    }
    return {
      models: Math.floor(mpd * days),
      downloads: Math.round(mpd * dl),
      points: Math.round(mpd * sum)
    };
  }

  // Qué parte del tiempo tienes Premium, de 0 a 1.
  //   false o "no": nunca. true o "always": siempre.
  //   "lottery": solo con los meses que te toquen en la lotería (promedio de muchos giros).
  function premiumShare(cfg, mode, modelsPerDay) {
    if (mode === true || mode === "always") return 1;
    if (mode !== "lottery") return 0;
    var tickets = 0;
    cfg.checkin.forEach(function (c) { if (c.type === "ticket") tickets += c.value; });
    var ticketsPerDay = tickets / cfg.checkin.length;
    var months = 0, total = 0, w = raffleWeights(cfg, premiumLuck(cfg, modelsPerDay));
    cfg.raffle.forEach(function (p, i) {
      total += w[i];
      if (p.kind === "premium") months += w[i] * p.value;
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
  // Supone que no faltas ningún día y que empiezas sin modelos, salvo los que indiques en ownedModels.
  function projectRoute(cfg, o) {
    var mpd = Math.max(0, o.modelsPerDay || 0), fol = Math.max(0, o.followers || 0);
    var q = premiumShare(cfg, o.premium, mpd);
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
    var M = seasonMultiplier(cfg);
    var f = M > 1 ? clamp(o.seasonShare || 0, 0, 1) : 0;
    var SD = M > 1 ? cfg.season.days : 0;
    // Modelos que ya tenías subidos al empezar ("owned"), con una edad promedio en días ("ownedAge").
    // No suben más descargas por ser viejos: siguen con su ritmo, pero ya van por un bloque más caro.
    var owned = Math.max(0, Math.floor(o.ownedModels || 0));
    var ownedAge = Math.max(0, Math.round(o.ownedAge === undefined ? 120 : o.ownedAge));
    var ownedBase = owned ? expectedModelPoints(cfg, fol, ownedAge) : 0;
    var emp = [0], prefix = [0];   // emp[a]: puntos esperados de un modelo de a días; prefix: sus sumas
    var marks = o.marks || [30, 90, 180, 365];
    var checkin = 0, lottery = 0, boost = 0;
    var hit = null, parts = null, snaps = {};
    for (var t = 1; t <= maxDays; t++) {
      var slot = cfg.checkin[(t - 1) % cfg.checkin.length];
      if (slot.type === "points") checkin += slot.value * mult;
      else lottery += slot.value * tmult * spinEV;
      var inSeason = f && t <= SD ? 1 + f * (M - 1) : 1;
      var lambda = mpd > 0 || owned > 0 ? Math.min(20, cfg.boost.baseRate + cfg.boost.perDownload * (owned + mpd * t * inSeason) * perModelDay) : 0;
      boost += lambda * boostEV;
      emp[t] = expectedModelPoints(cfg, fol, t);
      prefix[t] = prefix[t - 1] + emp[t];
      var S = prefix[t];
      if (f) {
        // los modelos de los últimos SD días todavía vivieron temporada: ahí cambia la cuenta
        var tail = Math.min(SD, t), skip = t - tail;
        S = prefix[skip];
        for (var a = skip + 1; a <= t; a++) {
          S += (1 - f) * emp[a] + f * expectedModelPoints(cfg, fol, a, (M - 1) * (a - skip));
        }
      }
      var downloads = mpd * S + (owned ? owned * (expectedModelPoints(cfg, fol, ownedAge + t) - ownedBase) : 0);
      var total = cur + checkin + lottery + boost + downloads;
      if (marks.indexOf(t) >= 0) snaps[t] = total;
      if (hit === null && total >= cfg.goal) {
        hit = t;
        parts = { checkin: checkin, lottery: lottery, downloads: downloads, boost: boost };
      }
      if (hit !== null && t >= 365) break;
    }
    if (hit === null) parts = { checkin: checkin, lottery: lottery, downloads: downloads, boost: boost };
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
    profileBlocks: profileBlocks,
    profilePoints: profilePoints,
    downloadsPerDay: downloadsPerDay,
    followerMult: followerMult,
    expectedModelPoints: expectedModelPoints,
    shareBelow: shareBelow,
    boostRate: boostRate,
    outlook: outlook,
    seasonMultiplier: seasonMultiplier,
    seasonOn: seasonOn,
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
    premiumLuck: premiumLuck,
    premiumChance: premiumChance,
    premiumPerSpin: premiumPerSpin,
    recentUploadRate: recentUploadRate,
    monthlyCheckin: monthlyCheckin,
    premiumShare: premiumShare,
    projectRoute: projectRoute,
    temperature: temperature,
    addLog: addLog
  };
});
