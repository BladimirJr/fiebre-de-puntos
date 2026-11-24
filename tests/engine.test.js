// Pruebas del motor. Ejecutar con:  node --test tests/engine.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

global.window = {};
require("../js/config.js");
const cfg = global.window.FP_CONFIG;
const E = require("../js/engine.js");

function fresh() { return E.newState(); }

// Aleatorio que nunca trae gente con boosts (poisson da 0 personas).
const NB = () => 0;

// Aleatorio que repite una lista de valores (y se queda en el último).
function seq(list) {
  let i = 0;
  return () => list[Math.min(i++, list.length - 1)];
}

// Aleatorio con semilla, para pruebas estadísticas repetibles.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Devuelve un "aleatorio" que hace caer el giro justo en el premio indicado.
function rngFor(id) {
  const total = cfg.raffle.reduce((a, p) => a + p.weight, 0);
  let acc = 0;
  for (const p of cfg.raffle) {
    if (p.id === id) {
      const v = (acc + p.weight / 2) / total;
      return () => v;
    }
    acc += p.weight;
  }
  throw new Error("premio inexistente: " + id);
}

// Deja la racha en "claims" registros seguidos y el día de hoy sin registrar.
function streakOf(claims) {
  const s = fresh();
  for (let i = 0; i < claims; i++) { E.claimToday(s, cfg); E.nextDay(s, cfg, NB); }
  return s;
}

/* ---------- registro diario ---------- */

test("el registro diario empieza como en Creality: 1, 10, boleto x1, 30, 40, 50, boleto x2", () => {
  const s = fresh();
  const seen = [];
  for (let i = 0; i < 7; i++) seen.push(E.rewardAt(s, cfg, i));
  assert.deepEqual(seen.map(r => [r.type, r.value]), [
    ["points", 1], ["points", 10], ["ticket", 1], ["points", 30],
    ["points", 40], ["points", 50], ["ticket", 2]
  ]);
});

test("registrar hoy suma una vez y no se puede repetir", () => {
  const s = fresh();
  const r = E.claimToday(s, cfg);
  assert.equal(r.value, 1);
  assert.equal(s.points, 1);
  assert.equal(s.streak, 1);
  assert.equal(E.claimToday(s, cfg), null);
  assert.equal(s.points, 1);
});

test("registrar solo marca el día: la casilla de hoy no cambia hasta que pasa el día", () => {
  const s = fresh();
  E.claimToday(s, cfg); E.nextDay(s, cfg, NB);
  E.claimToday(s, cfg);
  assert.equal(s.pos, 1);
  assert.equal(s.claimedToday, true);
});

test("la tabla se reinicia al completar la semana de 7 días", () => {
  const s = fresh();
  for (let i = 0; i < 7; i++) { E.claimToday(s, cfg); E.nextDay(s, cfg, NB); }
  assert.equal(s.pos, 0);
  assert.equal(s.streak, 7);
  assert.equal(E.claimToday(s, cfg).value, 1);
  assert.equal(s.streak, 8);
});

test("faltar un día rompe la racha y el ciclo vuelve al día 1", () => {
  const s = streakOf(2);
  assert.equal(s.pos, 2);
  const res = E.nextDay(s, cfg, NB);                // día 3 sin registrar
  assert.equal(res.broken, true);
  assert.equal(s.streak, 0);
  assert.equal(s.pos, 0);
  assert.equal(s.missed, 1);
  assert.deepEqual(s.restore, { pos: 2, streak: 2 });
});

test("30 días seguidos dan 535 puntos y 12 boletos, igual que la calculadora", () => {
  const s = fresh();
  E.advance(s, cfg, 30, NB);
  assert.equal(s.points, 535);
  assert.equal(s.tickets, 12);
  const m = E.monthlyCheckin(cfg, false);
  assert.equal(m.points, 535);
  assert.equal(m.tickets, 12);
});

/* ---------- Premium ---------- */

test("Premium duplica el registro diario: puntos y boletos (1 pasa a 2, 2 pasan a 4)", () => {
  const s = fresh();
  s.premiumDays = 10;
  assert.equal(E.rewardAt(s, cfg, 0).value, 2);   // 1 punto x2
  assert.equal(E.rewardAt(s, cfg, 2).value, 2);   // boleto x1 -> 2
  assert.equal(E.rewardAt(s, cfg, 6).value, 4);   // boleto x2 -> 4
  assert.equal(E.monthlyCheckin(cfg, true).points, 1070);
  assert.equal(E.monthlyCheckin(cfg, true).tickets, 24);
});

test("Premium NO duplica los premios de la ruleta", () => {
  const s = fresh();
  s.premiumDays = 30;
  s.tickets = 2;
  E.spin(s, cfg, rngFor("p100"));
  assert.equal(s.points, 100);
  E.spin(s, cfg, rngFor("p200"));
  assert.equal(s.points, 300);
  assert.equal(s.earned.lottery, 300);
});

test("los meses de Premium ganados en la lotería se acumulan", () => {
  const s = fresh();
  s.tickets = 2;
  const a = E.spin(s, cfg, rngFor("prem"));
  const b = E.spin(s, cfg, rngFor("prem"));
  assert.equal(a.prize.kind, "premium");
  assert.equal(b.prize.kind, "premium");
  assert.equal(s.premiumDays, 60);
  assert.equal(s.premiumMonthsWon, 2);
  assert.equal(s.tickets, 0);
  assert.equal(E.spin(s, cfg), null);
});

test("el Premium se va gastando un día a la vez y avisa cuando termina", () => {
  const s = fresh();
  s.premiumDays = 2;
  E.claimToday(s, cfg);
  assert.equal(E.nextDay(s, cfg, NB).premiumEnded, false);
  E.claimToday(s, cfg);
  assert.equal(E.nextDay(s, cfg, NB).premiumEnded, true);
  assert.equal(E.multiplier(s, cfg), 1);
});

/* ---------- check-in Card ---------- */

test("sin Card no se puede recuperar la racha", () => {
  const s = streakOf(3);
  E.nextDay(s, cfg, NB);                            // falta 1 día
  assert.equal(E.canUseCard(s, cfg), false);
  assert.equal(E.useCard(s, cfg), null);
});

test("la Card salva 1 día: +1 punto, la racha sigue y hoy vuelve a tener su recompensa", () => {
  const s = streakOf(3);                            // racha 3, hoy tocaba la casilla 4 (índice 3)
  const before = s.points;
  E.nextDay(s, cfg, NB);                            // falta ese día
  s.cards = 1;
  assert.equal(E.canUseCard(s, cfg), true);
  const r = E.useCard(s, cfg);
  assert.deepEqual(r, { days: 1, points: 1 });
  assert.equal(s.points, before + 1);
  assert.equal(s.streak, 4);
  assert.equal(s.pos, 4);                           // hoy toca la casilla de 40 puntos
  assert.equal(s.cards, 0);
  assert.equal(s.missed, 0);
  assert.equal(E.claimToday(s, cfg).value, 40);
  assert.equal(s.streak, 5);
});

test("la Card salva 2 días seguidos: +2 puntos", () => {
  const s = streakOf(3);
  E.nextDay(s, cfg, NB); E.nextDay(s, cfg, NB);     // faltan 2 días
  s.cards = 1;
  assert.equal(s.missed, 2);
  const r = E.useCard(s, cfg);
  assert.deepEqual(r, { days: 2, points: 2 });
  assert.equal(s.streak, 5);
  assert.equal(s.pos, 5);
  assert.equal(E.claimToday(s, cfg).value, 50);
});

test("la Card no se multiplica con Premium (1 punto por día perdido)", () => {
  const s = streakOf(3);
  s.premiumDays = 20;
  const before = s.points;
  E.nextDay(s, cfg, NB);
  s.cards = 1;
  E.useCard(s, cfg);
  assert.equal(s.points, before + 1);
});

test("con 3 días o más sin registrar ya no hay Card que valga", () => {
  const s = streakOf(3);
  E.nextDay(s, cfg, NB); E.nextDay(s, cfg, NB); E.nextDay(s, cfg, NB);
  s.cards = 1;
  assert.equal(s.missed, 3);
  assert.equal(s.restore, null);
  assert.equal(E.canUseCard(s, cfg), false);
  assert.equal(s.cards, 1);
});

test("registrar sin usar la Card confirma que la racha se perdió", () => {
  const s = streakOf(3);
  E.nextDay(s, cfg, NB);
  s.cards = 1;
  E.claimToday(s, cfg);
  assert.equal(s.streak, 1);
  assert.equal(s.missed, 0);
  assert.equal(s.restore, null);
  assert.equal(E.canUseCard(s, cfg), false);
});

test("la Card no se puede usar después de registrar hoy", () => {
  const s = streakOf(3);
  E.nextDay(s, cfg, NB);
  s.cards = 1;
  s.claimedToday = true;
  assert.equal(E.canUseCard(s, cfg), false);
});

test("sin racha previa no hay nada que recuperar", () => {
  const s = fresh();
  E.nextDay(s, cfg, NB);
  s.cards = 1;
  assert.equal(E.canUseCard(s, cfg), false);
});

/* ---------- tienda de regalos ---------- */

test("la tienda tiene los productos de Creality con sus precios", () => {
  const ids = cfg.store.map(i => [i.id, i.price]);
  assert.deepEqual(ids, [["makenow2", 100], ["makenow5", 150], ["card", 10], ["printer", 40900]]);
  assert.equal(cfg.goal, 40900);
});

test("canjear una Card cuesta 10 puntos y suma una Card", () => {
  const s = fresh();
  assert.equal(E.buyItem(s, cfg, "card").ok, false);
  s.points = 25;
  const r = E.buyItem(s, cfg, "card");
  assert.equal(r.ok, true);
  assert.equal(s.points, 15);
  assert.equal(s.cards, 1);
  assert.equal(s.bought.card, 1);
});

test("MakeNow (2 veces) cuesta 50 la primera vez y 100 después", () => {
  const s = fresh();
  s.points = 500;
  const item = E.findItem(cfg, "makenow2");
  assert.equal(E.itemPrice(s, cfg, item), 50);
  E.buyItem(s, cfg, "makenow2");
  assert.equal(s.points, 450);
  assert.equal(s.makeNow, 2);
  assert.equal(E.itemPrice(s, cfg, item), 100);
  E.buyItem(s, cfg, "makenow2");
  assert.equal(s.points, 350);
  assert.equal(s.makeNow, 4);
  E.buyItem(s, cfg, "makenow5");
  assert.equal(s.points, 200);
  assert.equal(s.makeNow, 9);
});

test("sin puntos suficientes el canje falla y no cambia nada", () => {
  const s = fresh();
  s.points = 9;
  const r = E.buyItem(s, cfg, "card");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "points");
  assert.equal(s.points, 9);
  assert.equal(s.cards, 0);
  assert.equal(E.buyItem(s, cfg, "no-existe").ok, false);
});

test("canje de prueba de la impresora: pide la meta, la descuenta y resume el camino", () => {
  const s = fresh();
  assert.equal(E.canRedeem(s, cfg), false);
  assert.equal(E.buyItem(s, cfg, "printer").ok, false);
  E.grantDemoPoints(s, cfg);
  assert.equal(E.canRedeem(s, cfg), true);
  const r = E.buyItem(s, cfg, "printer");
  assert.equal(r.ok, true);
  assert.equal(s.points, 0);
  assert.equal(s.redeems, 1);
  assert.equal(r.summary.earned.demo, cfg.goal);
});

/* ---------- lotería ---------- */

test("la cuadrícula tiene los 8 premios de Creality en su orden", () => {
  assert.deepEqual(cfg.raffle.map(p => p.id), ["cloud", "p197067", "p200", "p67400", "prem", "thanks", "p100", "p4500"]);
  const sum = E.chances(cfg).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("lo que más sale es 100, 200 y 1 GB de nube; los premios gordos casi nunca", () => {
  const ch = E.chances(cfg);
  const by = Object.fromEntries(cfg.raffle.map((p, i) => [p.id, ch[i]]));
  const top3 = Object.keys(by).sort((a, b) => by[b] - by[a]).slice(0, 3).sort();
  assert.deepEqual(top3, ["cloud", "p100", "p200"]);
  assert.ok(by.prem < by.thanks && by.prem > by.p4500);
  ["p197067", "p67400", "p4500"].forEach(id => assert.ok(by[id] <= 0.011, id));
});

test("la lotería de puntos suma a los puntos", () => {
  const s = fresh();
  s.tickets = 1;
  const r = E.spin(s, cfg, rngFor("p100"));
  assert.equal(r.prize.value, 100);
  assert.equal(r.index, cfg.raffle.findIndex(p => p.id === "p100"));
  assert.equal(s.points, 100);
  assert.equal(s.earned.lottery, 100);
});

test("el premio de 1 GB suma nube y no suma puntos", () => {
  const s = fresh();
  s.tickets = 2;
  E.spin(s, cfg, rngFor("cloud"));
  E.spin(s, cfg, rngFor("cloud"));
  assert.equal(s.cloudGB, 2);
  assert.equal(s.points, 0);
});

test("Gracias gasta el boleto y no da nada", () => {
  const s = fresh();
  s.tickets = 1;
  const r = E.spin(s, cfg, rngFor("thanks"));
  assert.equal(r.prize.kind, "none");
  assert.equal(s.tickets, 0);
  assert.equal(s.points, 0);
  assert.equal(s.premiumDays, 0);
});

test("un premio gordo también se acredita", () => {
  const s = fresh();
  s.tickets = 1;
  E.spin(s, cfg, rngFor("p67400"));
  assert.equal(s.points, 67400);
});

test("girar todos reparte puntos, nube y Premium", () => {
  const s = fresh();
  s.tickets = 4;
  const order = ["p100", "p200", "cloud", "prem"];
  let k = 0;
  const rng = () => rngFor(order[k++])();
  const r = E.spinAll(s, cfg, rng);
  assert.deepEqual(r, { spins: 4, points: 300, premiumMonths: 1, cloudGB: 1 });
  assert.equal(s.tickets, 0);
  assert.equal(s.premiumDays, 30);
});

/* ---------- descargas ---------- */

test("descargas: cada bloque de 10 paga 10 puntos más, con tope de 120", () => {
  assert.equal(E.blockRate(cfg, 0), 10);
  assert.equal(E.blockRate(cfg, 1), 20);
  assert.equal(E.blockRate(cfg, 11), 120);
  assert.equal(E.blockRate(cfg, 12), 120);
  assert.equal(E.blockRate(cfg, 40), 120);
  assert.equal(E.blocksToCap(cfg), 12);
  assert.equal(E.pointsForDownloads(cfg, 9), 0);
  assert.equal(E.pointsForDownloads(cfg, 10), 10);
  assert.equal(E.pointsForDownloads(cfg, 20), 30);
  assert.equal(E.pointsForDownloads(cfg, 120), 780);
  assert.equal(E.pointsForDownloads(cfg, 200), 780 + 8 * 120);
});

// Configuración con un solo tipo de modelo, para pruebas exactas.
function oneType(perDay, followerFactor) {
  return Object.assign({}, cfg, { modelTypes: [{ id: "t", label: "Único", share: 1, perDay: perDay }], followerFactor: followerFactor || 0 });
}

test("un modelo nuevo gana puntos al completar descargas", () => {
  const fast = oneType(3);
  const s = fresh();
  E.uploadModels(s, fast, 1);
  for (let i = 0; i < 3; i++) E.nextDay(s, fast, NB);
  assert.equal(s.models[0].downloads, 9);
  assert.equal(s.points, 0);
  E.nextDay(s, fast, NB);
  assert.equal(s.models[0].downloads, 12);
  assert.equal(s.points, 10);
  assert.equal(s.earned.downloads, 10);
});

test("no todos los modelos se mueven igual: la mayoría casi no se descarga", () => {
  const total = cfg.modelTypes.reduce((a, t) => a + t.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  const share = id => cfg.modelTypes.find(t => t.id === id).share;
  assert.ok(share("dud") + share("low") >= 0.7);
  assert.ok(share("hit") <= 0.02);
  // un modelo sin movimiento sigue bajo 10 descargas aun a los 5 meses sin seguidores
  const dud = cfg.modelTypes.find(t => t.id === "dud");
  assert.ok(dud.perDay * 150 < 10);
});

test("cada modelo nuevo sale con su tipo según el azar", () => {
  const s = fresh();
  E.uploadModels(s, cfg, 1, () => 0);        // el primer tipo: sin movimiento
  E.uploadModels(s, cfg, 1, () => 0.6);      // lento
  E.uploadModels(s, cfg, 1, () => 0.95);     // bueno
  E.uploadModels(s, cfg, 1, () => 0.995);    // éxito
  assert.deepEqual(s.models.map(m => m.kind), ["dud", "low", "good", "hit"]);
  assert.ok(s.models[3].perDay > s.models[0].perDay * 30);
});

test("un modelo sin movimiento no deja puntos y un éxito sí", () => {
  const s = fresh();
  E.uploadModels(s, cfg, 1, () => 0);        // sin movimiento
  E.uploadModels(s, cfg, 1, () => 0.995);    // éxito
  for (let i = 0; i < 100; i++) E.nextDay(s, cfg, NB);
  assert.ok(s.models[0].downloads < 10);
  assert.equal(E.pointsForDownloads(cfg, s.models[0].downloads), 0);
  assert.ok(s.models[1].downloads > 150);
  assert.ok(s.earned.downloads > 1000);
});

test("Creality no favorece a los modelos nuevos: todos descargan al mismo ritmo", () => {
  assert.equal(E.freshness, undefined);
  assert.equal(cfg.freshness, undefined);
  const one = oneType(0.25);
  const s = fresh();
  E.uploadModels(s, one, 1);
  for (let i = 0; i < 40; i++) E.nextDay(s, one, NB);
  E.uploadModels(s, one, 1);                        // llega un modelo nuevo; el viejo ya tiene 40 días
  const old0 = s.models[0].downloads;
  for (let i = 0; i < 40; i++) E.nextDay(s, one, NB);
  assert.equal(s.models[0].downloads - old0, s.models[1].downloads);
});

test("más seguidores mutuos significan más descargas", () => {
  const a = fresh(), b = fresh();
  b.followers = 100;
  E.uploadModels(a, cfg, 1, () => 0.6); E.uploadModels(b, cfg, 1, () => 0.6);
  for (let i = 0; i < 60; i++) { E.nextDay(a, cfg, NB); E.nextDay(b, cfg, NB); }
  assert.ok(b.models[0].downloads > a.models[0].downloads);
  assert.ok(E.downloadsPerDay(cfg, 100) > E.downloadsPerDay(cfg, 0));
  assert.ok(Math.abs(E.followerMult(cfg, 100) - 1.8) < 1e-9);
});

test("subir modelos automáticamente según los modelos por día", () => {
  const s = fresh();
  s.settings.modelsPerDay = 2;
  for (let i = 0; i < 5; i++) E.nextDay(s, cfg, NB);
  assert.equal(s.models.length, 10);
  assert.equal(s.log.length, 0);
  const t = fresh();
  t.settings.modelsPerDay = 0.5;
  for (let i = 0; i < 4; i++) E.nextDay(t, cfg, NB);
  assert.equal(t.models.length, 2);
});

test("100 modelos y 100 seguidores no garantizan una cifra enorme", () => {
  // 100 modelos repartidos en 6 meses dejan unos miles de puntos, no cientos de miles
  const l = E.libraryPoints(cfg, 100 / 180, 100, 180);
  assert.equal(l.models, 100);
  assert.ok(l.points > 5000 && l.points < 25000, "puntos " + l.points);
  // aun con 100 modelos de 150 días y 100 seguidores
  const all = 100 * E.expectedModelPoints(cfg, 100, 150);
  assert.ok(all < 40000, "puntos " + all);
});

test("sin seguidores, la mitad de los modelos sigue bajo 10 descargas a los 4 meses", () => {
  assert.ok(E.shareBelow(cfg, 0, 120, 10) >= 0.5);
  assert.ok(E.shareBelow(cfg, 0, 120, 10) <= E.shareBelow(cfg, 0, 30, 10) + 1e-9);
});

test("con 100 seguidores un modelo sin movimiento a duras penas llega a 10 descargas en 4 meses", () => {
  const dud = cfg.modelTypes.find(t => t.id === "dud");
  const d = dud.perDay * E.followerMult(cfg, 100) * 120;
  assert.ok(d > 5 && d < 15, "descargas " + d);
});

// Simula una cuenta con "plan" = lista de [días, modelos por día] y devuelve lo que pasó en los últimos 30 días.
function lastMonth(plan, followers, seed) {
  const rng = mulberry32(seed);
  const s = fresh();
  s.followers = followers;
  const total = plan.reduce((a, p) => a + p[0], 0);
  const dl = st => st.models.reduce((a, m) => a + m.downloads, 0);
  let day = 0, snap = null;
  for (const [n, rate] of plan) {
    s.settings.modelsPerDay = rate;
    for (let i = 0; i < n; i++) {
      if (day === total - 30) snap = { dl: dl(s), pd: s.earned.downloads, b: s.boosts, p: s.points };
      E.advance(s, cfg, 1, rng);
      E.spinAll(s, cfg, rng);
      day++;
    }
  }
  return { models: s.models.length, downloads: dl(s) - snap.dl, downloadPoints: s.earned.downloads - snap.pd, boosts: s.boosts - snap.b, points: s.points - snap.p };
}

function median(list) {
  const a = list.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

test("calibrado con el mes real: 98 modelos y unos 300 seguidores dan descargas, boosts y puntos parecidos", () => {
  const ref = cfg.reference;
  assert.equal(ref.models, 98);
  // dos historias posibles para llegar a 98 modelos en 264 días: ritmo parejo, o una subida reciente
  const plans = [[[264, ref.models / 264]], [[200, 55 / 200], [64, 43 / 64]]];
  const runs = [];
  for (const plan of plans) for (let k = 0; k < 40; k++) runs.push(lastMonth(plan, ref.followers, 100 + k));
  const med = key => median(runs.map(r => r[key]));
  const within = (v, target, tol, label) => assert.ok(Math.abs(v - target) / target <= tol, label + ": " + Math.round(v) + " vs real " + target);
  assert.equal(median(runs.map(r => r.models)), 98);
  within(med("downloads"), ref.downloads, 0.2, "descargas");
  within(med("downloadPoints"), ref.downloadPoints, 0.25, "puntos por descargas");
  within(med("boosts"), ref.boosts, 0.25, "boosts");
  within(med("points"), ref.totalPoints, 0.25, "puntos totales del mes");
});

test("las vistas acompañan a las descargas como en el mes real", () => {
  const ref = cfg.reference;
  assert.ok(Math.abs(cfg.viewsPerDownload - ref.views / ref.downloads) < 0.1);
});

test("outlook: lo que esperas en un mes sale de tus modelos, tus seguidores y la proporción de vistas", () => {
  const s = fresh();
  s.followers = 100;
  const empty = E.outlook(s, cfg);
  assert.equal(empty.downloads, 0);
  assert.equal(empty.views, 0);
  assert.equal(empty.boostPeople, 0);
  E.uploadModels(s, cfg, 10, () => 0.2);       // 10 modelos "sin movimiento"
  const o = E.outlook(s, cfg);
  const perDay = cfg.modelTypes[0].perDay;
  assert.ok(Math.abs(o.downloads - 10 * perDay * E.followerMult(cfg, 100) * 30) < 1e-9);
  assert.ok(Math.abs(o.views - o.downloads * cfg.viewsPerDownload) < 1e-9);
  assert.ok(o.boostPoints > 0);
});

/* ---------- temporada (Navidad) ---------- */

test("pointsForDownloads con fórmula da lo mismo que sumar bloque por bloque", () => {
  const brute = d => {
    let total = 0;
    for (let b = 0; b < Math.floor(d / cfg.downloadRate.blockSize); b++) total += E.blockRate(cfg, b);
    return total;
  };
  for (const d of [0, 5, 10, 19, 20, 99, 100, 119, 120, 121, 130, 250, 1000, 5000]) {
    assert.equal(E.pointsForDownloads(cfg, d), brute(d), "descargas " + d);
  }
});

test("la temporada está configurada: Navidad, ×4 y unos 35 días", () => {
  assert.equal(cfg.season.label, "Navidad");
  assert.equal(cfg.season.multiplier, 4);
  assert.ok(cfg.season.days >= 20 && cfg.season.days <= 60);
});

// Sube un modelo "éxito" (1,9 descargas al día) normal o de temporada y lo deja vivir "days" días.
function liveModel(seasonal, days, startDay) {
  const s = fresh();
  s.day = startDay || 0;
  s.settings.seasonal = seasonal;
  E.uploadModels(s, cfg, 1, () => 0.995);
  for (let i = 0; i < days; i++) E.nextDay(s, cfg, NB);
  return s.models[0];
}

test("un modelo de temporada junta ×4 descargas mientras dura la temporada", () => {
  const normal = liveModel(false, cfg.season.days);
  const seasonal = liveModel(true, cfg.season.days);
  assert.equal(seasonal.seasonal, true);
  assert.equal(normal.seasonal, false);
  assert.ok(Math.abs(seasonal.downloads - normal.downloads * cfg.season.multiplier) <= cfg.season.multiplier + 1, normal.downloads + " vs " + seasonal.downloads);
});

test("pasada la temporada el modelo vuelve a su ritmo normal (y no se apaga)", () => {
  const S = cfg.season.days;
  const normal = liveModel(false, S + 40);
  const seasonal = liveModel(true, S + 40);
  const normalAt = liveModel(false, S);
  const seasonalAt = liveModel(true, S);
  const gainNormal = normal.downloads - normalAt.downloads;
  const gainSeasonal = seasonal.downloads - seasonalAt.downloads;
  assert.ok(gainNormal > 60, "el normal sigue ganando: " + gainNormal);
  assert.ok(Math.abs(gainSeasonal - gainNormal) <= 2, "fuera de temporada ganan igual: " + gainNormal + " vs " + gainSeasonal);
});

test("un modelo de temporada que se sube cuando la temporada ya pasó no gana de más", () => {
  const normal = liveModel(false, 30, cfg.season.days + 5);
  const seasonal = liveModel(true, 30, cfg.season.days + 5);
  assert.equal(seasonal.downloads, normal.downloads);
});

test("sin temporada en la configuración (×1) el modelo no se marca como de temporada", () => {
  const off = Object.assign({}, cfg, { season: { label: "x", multiplier: 1, days: 35 } });
  const s = fresh();
  s.settings.seasonal = true;
  E.uploadModels(s, off, 1, () => 0.5);
  assert.equal(s.models[0].seasonal, false);
});

test("outlook cuenta los días de temporada que le quedan al mes", () => {
  const s = fresh();
  s.followers = 0;
  s.settings.seasonal = true;
  E.uploadModels(s, cfg, 1, () => 0.995);
  const perDay = cfg.modelTypes.find(t => t.id === "hit").perDay;
  const M = cfg.season.multiplier, S = cfg.season.days;
  // al empezar quedan más de 30 días: todo el mes es de temporada
  assert.ok(Math.abs(E.outlook(s, cfg).downloads - perDay * 30 * M) < 1e-9);
  // faltando 10 días: 10 de temporada y 20 normales
  s.day = S - 10;
  assert.ok(Math.abs(E.outlook(s, cfg).downloads - perDay * (30 + 10 * (M - 1))) < 1e-9);
  // ya pasó: ritmo normal
  s.day = S + 3;
  assert.ok(Math.abs(E.outlook(s, cfg).downloads - perDay * 30) < 1e-9);
});

test("los modelos de temporada también atraen más boosts mientras dura", () => {
  const a = fresh(), b = fresh();
  b.settings.seasonal = true;
  [a, b].forEach(s => { s.followers = 60; E.uploadModels(s, cfg, 20, () => 0.995); });
  assert.ok(E.boostRate(b, cfg, 1) > E.boostRate(a, cfg, 1));
  assert.equal(E.boostRate(b, cfg, cfg.season.days + 1), E.boostRate(a, cfg, cfg.season.days + 1));
});

test("la biblioteca con modelos de temporada deja más descargas y más puntos", () => {
  const none = E.libraryPoints(cfg, 1, 60, 60, 0);
  const half = E.libraryPoints(cfg, 1, 60, 60, 0.5);
  const all = E.libraryPoints(cfg, 1, 60, 60, 1);
  assert.ok(half.points > none.points && all.points > half.points);
  assert.ok(all.downloads > none.downloads);
  assert.equal(E.libraryPoints(cfg, 1, 60, 60).points, none.points);
  // la ventaja se diluye cuando pasa mucho tiempo, pero no desaparece
  const long0 = E.libraryPoints(cfg, 1, 60, 360, 0), long1 = E.libraryPoints(cfg, 1, 60, 360, 1);
  assert.ok(long1.points > long0.points);
  assert.ok(long1.points / long0.points < all.points / none.points);
});

test("las descargas esperadas de la biblioteca coinciden con simular muchas veces", () => {
  for (const share of [0, 1]) {
    const days = 80, runs = 30;
    let total = 0;
    for (let k = 0; k < runs; k++) {
      const rng = mulberry32(900 + k);
      const s = fresh();
      s.followers = 60; s.settings.modelsPerDay = 1; s.settings.seasonal = share === 1;
      for (let i = 0; i < days; i++) E.nextDay(s, cfg, rng);
      total += s.models.reduce((a, m) => a + m.downloads, 0);
    }
    const expected = E.libraryPoints(cfg, 1, 60, days, share).downloads;
    assert.ok(Math.abs(total / runs - expected) / expected < 0.12, "temporada " + share + ": esperado " + expected + " simulado " + total / runs);
  }
});

test("la ruta con modelos de temporada es más corta y coincide con simular con azar", () => {
  const base = E.projectRoute(cfg, { current: 0, premium: "lottery", modelsPerDay: 1, followers: 60 });
  const ev = E.projectRoute(cfg, { current: 0, premium: "lottery", modelsPerDay: 1, followers: 60, seasonShare: 1 });
  assert.ok(ev.days < base.days, ev.days + " vs " + base.days);
  const days = [];
  for (let k = 0; k < 20; k++) {
    const rng = mulberry32(7000 + k);
    const s = fresh();
    s.followers = 60; s.settings.modelsPerDay = 1; s.settings.seasonal = true;
    let d = 0;
    while (s.points < cfg.goal && d < 1000) { E.advance(s, cfg, 1, rng); E.spinAll(s, cfg, rng); d++; }
    days.push(d);
  }
  days.sort((a, b) => a - b);
  assert.ok(Math.abs(days[10] - ev.days) / ev.days < 0.2, "esperado " + ev.days + " simulado " + days[10]);
});

test("el efecto de la temporada llega a las partes de la ruta", () => {
  const a = E.projectRoute(cfg, { current: 0, premium: false, modelsPerDay: 2, followers: 60, marks: [30] });
  const b = E.projectRoute(cfg, { current: 0, premium: false, modelsPerDay: 2, followers: 60, marks: [30], seasonShare: 1 });
  assert.ok(b.snapshots[30] > a.snapshots[30] * 1.5, b.snapshots[30] + " vs " + a.snapshots[30]);
  assert.equal(E.projectRoute(cfg, { current: 0, premium: false, modelsPerDay: 2, followers: 60, marks: [30], seasonShare: 0 }).snapshots[30], a.snapshots[30]);
});

/* ---------- boosts ---------- */

test("un boost vale 100 puntos y cada persona da de 1 a 4", () => {
  assert.equal(cfg.boost.points, 100);
  assert.deepEqual(cfg.boost.amounts.map(a => a.n), [1, 2, 3, 4]);
  assert.ok(Math.abs(E.expectedBoostsPerPerson(cfg) - 2.15) < 1e-9);
});

test("una persona que da 4 boosts suma 400 puntos y queda en el registro", () => {
  const s = fresh();
  E.uploadModels(s, cfg, 1, () => 0);        // sin modelos nadie da boosts
  E.nextDay(s, cfg, seq([0.99, 0.5, 0.95]));       // 1 persona, 4 boosts
  assert.equal(s.boosts, 4);
  assert.equal(s.points, 400);
  assert.equal(s.earned.boost, 400);
  assert.match(s.log[0].text, /Boost/);
});

test("una persona que da 1 boost suma 100 puntos", () => {
  const s = fresh();
  E.uploadModels(s, cfg, 1, () => 0);
  E.nextDay(s, cfg, seq([0.99, 0.5, 0.1]));
  assert.equal(s.boosts, 1);
  assert.equal(s.points, 100);
});

// Sube "n" modelos con la mezcla de tipos de la configuración (la mitad sin movimiento, etc.).
function uploadMix(s, n) {
  let i = 0;
  E.uploadModels(s, cfg, n, () => (i++ + 0.5) / n);
}

test("98 modelos y unos 300 seguidores esperan cerca de los 36 boosts del mes real", () => {
  const s = fresh();
  s.followers = cfg.reference.followers;
  uploadMix(s, cfg.reference.models);
  const o = E.outlook(s, cfg);
  assert.ok(o.boosts > 28 && o.boosts < 46, "boosts " + o.boosts);
  assert.ok(Math.abs(o.boostPoints - o.boosts * cfg.boost.points) < 1e-9);
  // y unas 1.700 descargas al mes
  assert.ok(Math.abs(o.downloads - cfg.reference.downloads) / cfg.reference.downloads < 0.2, "descargas " + o.downloads);
});

test("los boosts siguen a las descargas: una cuenta pequeña recibe pocos", () => {
  const small = fresh();
  small.followers = 30;
  uploadMix(small, 10);
  const big = fresh();
  big.followers = 300;
  uploadMix(big, 98);
  const a = E.outlook(small, cfg), b = E.outlook(big, cfg);
  assert.ok(a.boosts < 4, "boosts de la cuenta pequeña " + a.boosts);
  assert.ok(b.boosts > a.boosts * 8);
  // por cada 100 descargas salen unos 2 boosts, como en el mes real
  const real = cfg.reference.boosts / cfg.reference.downloads;
  assert.ok(Math.abs(b.boosts / b.downloads - real) / real < 0.25);
});

test("más modelos y más seguidores atraen más boosts", () => {
  const base = fresh();
  const many = fresh();
  many.followers = 100;
  E.uploadModels(many, cfg, 200);
  assert.ok(E.boostRate(many, cfg) > E.boostRate(base, cfg));
});

test("sin modelos nadie te da boosts", () => {
  const s = fresh();
  s.followers = 300;
  assert.equal(E.boostRate(s, cfg), 0);
  assert.equal(E.outlook(s, cfg).boosts, 0);
});

test("el promedio diario de boosts coincide con lo esperado", () => {
  const s = fresh();
  E.uploadModels(s, cfg, 20, () => 0.2);
  const rng = mulberry32(7);
  const days = 20000;
  const expected = E.boostRate(s, cfg) * E.expectedBoostsPerPerson(cfg) * cfg.boost.points;
  for (let i = 0; i < days; i++) E.nextDay(s, cfg, rng);
  const got = s.earned.boost / days;
  assert.ok(Math.abs(got - expected) / expected < 0.1, "esperado " + expected + " real " + got);
});

/* ---------- estimaciones ---------- */

test("ruta a la meta: más modelos por día acercan la meta", () => {
  const r0 = E.projectRoute(cfg, { current: 0, premium: false, modelsPerDay: 0, followers: 60 });
  const r1 = E.projectRoute(cfg, { current: 0, premium: false, modelsPerDay: 1, followers: 60 });
  const r2 = E.projectRoute(cfg, { current: 0, premium: false, modelsPerDay: 2, followers: 60 });
  const r5 = E.projectRoute(cfg, { current: 0, premium: false, modelsPerDay: 5, followers: 60 });
  assert.ok(r0.days > r1.days && r1.days > r2.days && r2.days > r5.days);
  assert.ok(r5.days > 60 && r1.days < 365);
});

test("ruta a la meta: Premium y puntos actuales la acortan", () => {
  const base = E.projectRoute(cfg, { current: 0, premium: false, modelsPerDay: 1, followers: 60 });
  const prem = E.projectRoute(cfg, { current: 0, premium: true, modelsPerDay: 1, followers: 60 });
  const head = E.projectRoute(cfg, { current: 10000, premium: false, modelsPerDay: 1, followers: 60 });
  assert.ok(prem.days < base.days);
  assert.ok(head.days < base.days);
});

test("el Premium esperado de la lotería queda entre sin Premium y Premium siempre", () => {
  assert.equal(E.premiumShare(cfg, false), 0);
  assert.equal(E.premiumShare(cfg, "no"), 0);
  assert.equal(E.premiumShare(cfg, true), 1);
  const q = E.premiumShare(cfg, "lottery");
  assert.ok(q > 0.1 && q < 0.9, "q " + q);
  const base = { current: 0, modelsPerDay: 1, followers: 60 };
  const no = E.projectRoute(cfg, Object.assign({ premium: false }, base)).days;
  const lot = E.projectRoute(cfg, Object.assign({ premium: "lottery" }, base)).days;
  const all = E.projectRoute(cfg, Object.assign({ premium: true }, base)).days;
  assert.ok(no > lot && lot > all);
});

test("la ruta esperada coincide con simular muchas veces con azar", () => {
  const ev = E.projectRoute(cfg, { current: 0, premium: "lottery", modelsPerDay: 2, followers: 60 }).days;
  const days = [];
  for (let k = 0; k < 20; k++) {
    const rng = mulberry32(4000 + k);
    const s = fresh();
    s.followers = 60; s.settings.modelsPerDay = 2;
    let d = 0;
    while (s.points < cfg.goal && d < 1000) { E.advance(s, cfg, 1, rng); E.spinAll(s, cfg, rng); d++; }
    days.push(d);
  }
  days.sort((a, b) => a - b);
  const median = days[10];
  assert.ok(Math.abs(median - ev) / ev < 0.2, "esperado " + ev + " simulado " + median);
});

test("ruta a la meta: las partes suman cerca de la meta y el registro sale de la tabla", () => {
  const r = E.projectRoute(cfg, { current: 0, premium: false, modelsPerDay: 1, followers: 60 });
  const p = r.parts;
  const total = p.checkin + p.lottery + p.downloads + p.boost;
  assert.ok(total >= cfg.goal && total < cfg.goal * 1.05);
  const m = E.monthlyCheckin(cfg, false, r.days);
  assert.equal(Math.round(p.checkin), m.points);
});

test("ruta a la meta: si ya tienes la meta, faltan 0 días", () => {
  const r = E.projectRoute(cfg, { current: 50000, premium: false, modelsPerDay: 0, followers: 0 });
  assert.equal(r.days, 0);
});

test("la biblioteca crece más rápido con más modelos por día", () => {
  const a = E.libraryPoints(cfg, 1, 60, 180);
  const b = E.libraryPoints(cfg, 5, 60, 180);
  assert.equal(a.models, 180);
  assert.equal(b.models, 900);
  assert.ok(b.points > a.points * 4);
});

test("termómetro: 0 puntos = 36°, meta = 40°", () => {
  assert.equal(E.temperature(0, 40000), 36);
  assert.equal(E.temperature(20000, 40000), 38);
  assert.equal(E.temperature(40000, 40000), 40);
  assert.equal(E.temperature(99999, 40000), 40);
});

/* ---------- estado guardado y registro ---------- */

test("hydrate completa campos que faltan en el estado guardado", () => {
  const s = E.hydrate({ points: 123, settings: {} });
  assert.equal(s.points, 123);
  assert.equal(s.settings.modelsPerDay, 0);
  assert.equal(s.cards, 0);
  assert.equal(s.missed, 0);
  assert.equal(s.restore, null);
  assert.deepEqual(s.models, []);
  assert.equal(E.hydrate(null).points, 0);
});

test("el registro de actividad guarda como máximo 40 entradas", () => {
  const s = fresh();
  for (let i = 0; i < 100; i++) E.addLog(s, "x" + i);
  assert.equal(s.log.length, 40);
  assert.equal(s.log[0].text, "x99");
});

/* ---------- probabilidad de Premium ---------- */

test("la suerte del Premium está en la configuración y empieza en 1", () => {
  assert.ok(cfg.premiumLuck.perModelPerDay > 0 && cfg.premiumLuck.max > 0 && cfg.premiumLuck.streakDays >= 1);
  assert.equal(E.premiumLuck(cfg, 0), 1);
});

test("subir modelos y mantener la racha sube la suerte hasta un tope; sin racha no hay ventaja", () => {
  const l1 = E.premiumLuck(cfg, 1), l2 = E.premiumLuck(cfg, 2), l50 = E.premiumLuck(cfg, 50);
  assert.ok(l1 > 1 && l2 > l1);
  assert.ok(Math.abs(l50 - (1 + cfg.premiumLuck.max)) < 1e-9);
  assert.equal(E.premiumLuck(cfg, 5, cfg.premiumLuck.streakDays - 1), 1);
  assert.ok(E.premiumLuck(cfg, 5, cfg.premiumLuck.streakDays) > 1);
  const off = Object.assign({}, cfg, { premiumLuck: { perModelPerDay: 0, max: 0.6, streakDays: 7 } });
  assert.equal(E.premiumLuck(off, 5), 1);
});

test("con suerte las probabilidades siguen sumando 1 y solo gana el Premium", () => {
  const base = E.chances(cfg), lucky = E.chances(cfg, 1.6);
  assert.ok(Math.abs(lucky.reduce((a, x) => a + x, 0) - 1) < 1e-9);
  cfg.raffle.forEach((p, i) => {
    if (p.kind === "premium") assert.ok(lucky[i] > base[i]);
    else assert.ok(lucky[i] < base[i]);
  });
});

test("probabilidad de Premium en un mes: 12 boletos y 1 - (1 - p)^12", () => {
  const c = E.premiumChance(cfg, {});
  assert.equal(c.spins, 12);
  const p = 2 / cfg.raffle.reduce((a, x) => a + x.weight, 0);
  assert.ok(Math.abs(c.perSpin - p) < 1e-12);
  assert.ok(Math.abs(c.chance - (1 - Math.pow(1 - p, 12))) < 1e-12);
  assert.ok(c.chance > 0.15 && c.chance < 0.35, "chance " + c.chance);
});

test("más modelos, más días, boletos guardados o Premium puesto suben la probabilidad", () => {
  const base = E.premiumChance(cfg, {}).chance;
  assert.ok(E.premiumChance(cfg, { modelsPerDay: 1 }).chance > base);
  assert.ok(E.premiumChance(cfg, { modelsPerDay: 4 }).chance > E.premiumChance(cfg, { modelsPerDay: 1 }).chance);
  assert.ok(E.premiumChance(cfg, { days: 90 }).chance > base);
  assert.ok(E.premiumChance(cfg, { tickets: 5 }).chance > base);
  assert.equal(E.premiumChance(cfg, { premium: true }).spins, 24);
  assert.ok(E.premiumChance(cfg, { premium: true }).chance > base);
  assert.equal(E.premiumChance(cfg, { modelsPerDay: 4, streak: 2 }).chance, base); // sin racha, sin ventaja
});

// Un mes de registro todos los días y giros; devuelve en cuántos de "n" intentos tocó Premium al menos una vez.
function premiumFrequency(n, seed, modelsPerDay) {
  let hits = 0;
  for (let k = 0; k < n; k++) {
    const rng = mulberry32(seed + k);
    const s = fresh();
    s.settings.modelsPerDay = modelsPerDay;
    for (let d = 0; d < 30; d++) { E.advance(s, cfg, 1, rng); E.spinAll(s, cfg, rng); }
    if (s.premiumMonthsWon > 0) hits++;
  }
  return hits / n;
}

test("la probabilidad de Premium coincide con simular un mes con racha completa", () => {
  const sim = premiumFrequency(3000, 21000, 0);
  const ev = E.premiumChance(cfg, {}).chance;
  assert.ok(Math.abs(sim - ev) < 0.035, "esperado " + ev + " simulado " + sim);
});

test("con 4 modelos al día y racha el Premium toca más seguido, como dice la probabilidad", () => {
  const sim = premiumFrequency(3000, 31000, 4);
  const ev = E.premiumChance(cfg, { modelsPerDay: 4 }).chance;
  assert.ok(sim > E.premiumChance(cfg, {}).chance, "simulado " + sim);
  assert.ok(Math.abs(sim - ev) < 0.05, "esperado " + ev + " simulado " + sim);
});

test("el giro usa la suerte: con racha y modelos nuevos sale más Premium que sin ellos", () => {
  function premiumRate(withLuck) {
    const rng = mulberry32(55);
    const s = fresh();
    if (withLuck) {
      s.streak = cfg.premiumLuck.streakDays;
      E.uploadModels(s, cfg, 7, rng); // 7 modelos de menos de 7 días = 1 por día
    }
    let n = 0, prem = 0;
    for (let i = 0; i < 40000; i++) {
      s.tickets = 1;
      const r = E.spin(s, cfg, rng);
      n++; if (r.prize.kind === "premium") prem++;
    }
    return prem / n;
  }
  const plain = premiumRate(false), lucky = premiumRate(true);
  assert.ok(Math.abs(plain - E.premiumPerSpin(cfg, 1)) < 0.003, "sin suerte " + plain);
  assert.ok(Math.abs(lucky - E.premiumPerSpin(cfg, E.premiumLuck(cfg, 1))) < 0.003, "con suerte " + lucky);
  assert.ok(lucky > plain);
});

test("los modelos nuevos de la semana se cuentan como modelos por día", () => {
  const s = fresh();
  assert.equal(E.recentUploadRate(s), 0);
  E.uploadModels(s, cfg, 14);
  assert.equal(E.recentUploadRate(s), 2);
  for (let i = 0; i < 7; i++) E.nextDay(s, cfg, NB);
  assert.equal(E.recentUploadRate(s), 0); // ya pasaron 7 días
});

test("el Premium esperado de la ruta sube con los modelos por día", () => {
  assert.equal(E.premiumShare(cfg, "lottery", 0), E.premiumShare(cfg, "lottery"));
  assert.ok(E.premiumShare(cfg, "lottery", 5) > E.premiumShare(cfg, "lottery", 0));
  assert.equal(E.premiumShare(cfg, true, 5), 1);
  assert.equal(E.premiumShare(cfg, false, 5), 0);
});

/* ---------- modelos que ya tienes subidos ---------- */

test("ruta con modelos ya subidos: suma sus descargas y sus boosts sin subir nada", () => {
  const o = { current: 0, premium: false, modelsPerDay: 0, followers: 150, marks: [30] };
  const none = E.projectRoute(cfg, o);
  const own = E.projectRoute(cfg, Object.assign({ ownedModels: 98, ownedAge: 120 }, o));
  const dl = 98 * (E.expectedModelPoints(cfg, 150, 150) - E.expectedModelPoints(cfg, 150, 120));
  const lambda = Math.min(20, cfg.boost.baseRate + cfg.boost.perDownload * 98 * E.downloadsPerDay(cfg, 150));
  const boosts = 30 * lambda * E.expectedBoostsPerPerson(cfg) * cfg.boost.points;
  assert.ok(Math.abs((own.snapshots[30] - none.snapshots[30]) - (dl + boosts)) < 0.01);
  assert.ok(own.days < none.days);
});

test("ownedModels en 0 no cambia la ruta", () => {
  const o = { current: 0, premium: "lottery", modelsPerDay: 2, followers: 60 };
  assert.equal(E.projectRoute(cfg, Object.assign({ ownedModels: 0 }, o)).days, E.projectRoute(cfg, o).days);
});

test("modelos más viejos ya van por bloques más caros y dejan más puntos", () => {
  const o = { current: 0, premium: false, modelsPerDay: 0, followers: 150, ownedModels: 98, marks: [30] };
  const young = E.projectRoute(cfg, Object.assign({ ownedAge: 15 }, o)).snapshots[30];
  const old = E.projectRoute(cfg, Object.assign({ ownedAge: 240 }, o)).snapshots[30];
  assert.ok(old > young);
});

test("98 modelos ya subidos y unos 150 seguidores juntan entre 10.000 y 18.000 en un mes sin subir nada", () => {
  const r = E.projectRoute(cfg, { current: 0, premium: "lottery", modelsPerDay: 0, followers: 150, ownedModels: 98, ownedAge: 120, marks: [30] });
  assert.ok(r.snapshots[30] > 10000 && r.snapshots[30] < 18000, "mes " + r.snapshots[30]);
});

test("modelos ya subidos acortan la ruta aunque sigas subiendo", () => {
  const o = { current: 0, premium: "lottery", modelsPerDay: 1, followers: 60 };
  const a = E.projectRoute(cfg, o).days;
  const b = E.projectRoute(cfg, Object.assign({ ownedModels: 98, ownedAge: 120 }, o)).days;
  assert.ok(b < a * 0.7, a + " vs " + b);
});

/* ---------- perfiles de impresión ---------- */

test("los perfiles de impresión están en la configuración: 10 puntos por cada 10 descargas del perfil", () => {
  assert.equal(cfg.profile.blockSize, 10);
  assert.equal(cfg.profile.points, 10);
  assert.ok(cfg.profile.perDownload > 0 && cfg.profile.perDownload <= 1);
});

test("el perfil NO es incremental: cada bloque de 10 descargas del perfil paga siempre 10", () => {
  const per = cfg.profile.perDownload;
  const d1 = Math.ceil(10 / per);       // descargas del modelo para llegar al primer bloque del perfil
  assert.equal(E.profileBlocks(cfg, d1 - 1), 0);
  assert.equal(E.profileBlocks(cfg, d1), 1);
  assert.equal(E.profilePoints(cfg, d1), 10);
  // 10 bloques de perfil = 100 puntos (si fuera incremental serían 550)
  const d10 = Math.ceil(100 / per);
  assert.equal(E.profileBlocks(cfg, d10), 10);
  assert.equal(E.profilePoints(cfg, d10), 100);
  // las descargas del modelo sí suben de bloque: ahí 10 bloques son 550
  assert.equal(E.pointsForDownloads(cfg, 100), 550);
});

test("un modelo que se descarga mucho cobra descargas del modelo y perfil por separado", () => {
  const s = fresh();
  s.models.push({ id: 1, name: "Éxito", age: 0, downloads: 0, frac: 0, blocksPaid: 0, profBlocks: 0, kind: "hit", perDay: 1, seasonal: false });
  for (let i = 0; i < 400; i++) E.nextDay(s, cfg, NB);
  assert.equal(s.models[0].downloads, 400);
  assert.equal(s.earned.downloads, E.pointsForDownloads(cfg, 400) + E.profilePoints(cfg, 400));
  assert.ok(E.profilePoints(cfg, 400) > 0);
});

test("un modelo guardado antes de esta regla no cobra de golpe los perfiles viejos", () => {
  const s = fresh();
  s.models.push({ id: 1, name: "Viejo", age: 300, downloads: 400, frac: 0, blocksPaid: 40, kind: "hit", perDay: 1, seasonal: false });
  E.nextDay(s, cfg, NB);
  assert.ok(s.earned.downloads <= cfg.downloadRate.cap + cfg.profile.points, "ganó " + s.earned.downloads);
});

test("con perDownload en 0 los perfiles no dan nada", () => {
  const off = Object.assign({}, cfg, { profile: { blockSize: 10, points: 10, perDownload: 0 } });
  assert.equal(E.profilePoints(off, 5000), 0);
  assert.ok(E.expectedModelPoints(cfg, 100, 200) > E.expectedModelPoints(off, 100, 200));
});

test("los perfiles suman unos puntos a un mes real, sin cambiar mucho la cifra", () => {
  const off = Object.assign({}, cfg, { profile: { blockSize: 10, points: 10, perDownload: 0 } });
  const a = E.libraryPoints(off, 1, 300, 90, 0).points, b = E.libraryPoints(cfg, 1, 300, 90, 0).points;
  assert.ok(b > a && b < a * 1.2, a + " vs " + b);
});
