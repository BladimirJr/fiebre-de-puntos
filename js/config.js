/*
 * Fiebre de Puntos: reglas de la simulación.
 *
 * Todos los números de esta página son APROXIMADOS y salen de la experiencia
 * de quien escribe la guía. Creality puede cambiar sus reglas cuando quiera.
 * Si algo ya no coincide con tu cuenta, edita los valores de este archivo:
 * el simulador, las tablas y las calculadoras se actualizan solos.
 */
(function () {
  // Precio de la impresora en la tienda de regalos. Es también la meta del simulador.
  var PRINTER_PRICE = 40900;

  window.FP_CONFIG = {
    // Meta para canjear la impresora.
    goal: PRINTER_PRICE,

    // Tienda de regalos (precios en puntos). "firstPrice" es el precio de primer pedido.
    // kind: "makenow" suma usos de MakeNow, "card" suma una check-in Card, "goal" es la meta.
    store: [
      { id: "makenow2", kind: "makenow", name: "MakeNow (2 veces)", value: 2, price: 100, firstPrice: 50 },
      { id: "makenow5", kind: "makenow", name: "MakeNow (5 veces)", value: 5, price: 150 },
      { id: "card",     kind: "card",    name: "Check-in Card",     price: 10 },
      { id: "printer",  kind: "goal",    name: "Creality SPARKX i7 Combo", price: PRINTER_PRICE }
    ],

    // Check-in Card: recupera la racha si faltaste 1 o 2 días seguidos.
    // Cada día recuperado da 1 punto (sin multiplicador) y hoy vuelve a tener su recompensa.
    card: { maxDays: 2, pointsPerDay: 1 },

    // Premium: mientras queden días, la tabla del REGISTRO DIARIO se multiplica
    // (los puntos y también los boletos: 1 boleto pasa a 2 y 2 pasan a 4).
    // NO duplica los premios de la ruleta: ahí 100 sigue siendo 100.
    // Cada mes de Premium que gana la lotería se SUMA a los días que ya tienes.
    premiumMultiplier: 2,
    premiumMonthDays: 30,
    premiumDoublesTickets: true,

    // Registro diario de 7 días (tomado de la pantalla "Registro Creality Cloud").
    // "points" suma puntos y "ticket" suma boletos para la lotería.
    checkin: [
      { type: "points", value: 1 },
      { type: "points", value: 10 },
      { type: "ticket", value: 1 },
      { type: "points", value: 30 },
      { type: "points", value: 40 },
      { type: "points", value: 50 },
      { type: "ticket", value: 2 }
    ],

    // Lotería de check-in: cuadrícula de 3x3 con el botón Start al centro.
    // Los 8 premios van en el orden en que los recorre el resaltado, en sentido
    // horario desde la casilla de arriba a la izquierda:
    //   1 GB nube | 197.067 | 200
    //   4.500     |  Start  | 67.400
    //   100       | Gracias | Premium
    // "weight" es la probabilidad relativa de cada premio y "rare" marca los
    // premios gordos, que las estimaciones no cuentan. Las probabilidades son de
    // ejemplo, no oficiales: lo que más sale es 100, 200 y 1 GB de nube, el
    // Premium sale a veces y los premios grandes casi nunca.
    raffle: [
      { id: "cloud",   kind: "storage", value: 1,      weight: 22 },
      { id: "p197067", kind: "points",  value: 197067, weight: 0.01, rare: true },
      { id: "p200",    kind: "points",  value: 200,    weight: 25 },
      { id: "p67400",  kind: "points",  value: 67400,  weight: 0.05, rare: true },
      { id: "prem",    kind: "premium", value: 1,      weight: 2 },
      { id: "thanks",  kind: "none",    value: 0,      weight: 12 },
      { id: "p100",    kind: "points",  value: 100,    weight: 30 },
      { id: "p4500",   kind: "points",  value: 4500,   weight: 0.4,  rare: true }
    ],

    // Puntos por descargas de un modelo. Cada bloque de 10 descargas paga
    // 10 puntos más que el anterior, hasta llegar al tope de 120:
    // 10, 20, 30 ... 120, 120, 120 ...
    downloadRate: {
      blockSize: 10,  // descargas por bloque
      start: 10,      // puntos del primer bloque
      step: 10,       // cuánto sube cada bloque
      cap: 120        // tope por bloque
    },

    // Descargas de cada modelo. Creality muestra los modelos nuevos igual que los demás,
    // así que no hay ventaja por ser reciente. Pero tampoco todos los modelos se mueven igual:
    // muchos casi no se descargan y unos pocos son los que de verdad dejan puntos.
    // Cada modelo que subes sale con uno de estos tipos al azar. "share" es qué parte de
    // tus modelos es de ese tipo y "perDay" cuántas descargas junta al día (sin seguidores).
    modelTypes: [
      { id: "dud",  label: "Sin movimiento", share: 0.50, perDay: 0.03 },
      { id: "low",  label: "Lento",          share: 0.27, perDay: 0.10 },
      { id: "mid",  label: "Normal",         share: 0.15, perDay: 0.30 },
      { id: "good", label: "Bueno",          share: 0.07, perDay: 0.80 },
      { id: "hit",  label: "Éxito",          share: 0.01, perDay: 2.50 }
    ],
    // Cada seguidor mutuo multiplica las descargas de todos tus modelos un poco más
    // (con 100 seguidores, las descargas se multiplican por 1,8).
    followerFactor: 0.008,

    // Boost: cuando a alguien le gustan tus modelos puede darte boosts.
    // Cada boost vale 100 puntos. Cada persona da de 1 a 4 según cuántas impresoras
    // tiene y cuánto imprime. "baseRate", "perModel" y "perFollower" son las
    // personas que te dan boosts por día (sumando todo): más modelos y más
    // seguidores significan más personas viendo tu perfil. Los modelos suman con la
    // raíz cuadrada: los primeros pesan más que los últimos.
    boost: {
      points: 100,
      baseRate: 0.03,
      perModel: 0.01,
      perFollower: 0.0004,
      amounts: [
        { n: 1, weight: 35 },
        { n: 2, weight: 30 },
        { n: 3, weight: 20 },
        { n: 4, weight: 15 }
      ]
    }
  };
})();
