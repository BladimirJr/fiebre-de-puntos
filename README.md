# Fiebre de Puntos

Guía interactiva para juntar los puntos de **Creality Cloud** hasta la impresora de la tienda de regalos (**Creality SPARKX i7 Combo, 40.900 puntos**) y canjearlos. Explica qué hacer cada día y tiene un simulador para probar el camino antes de empezar.

El progreso se ve como un termómetro de mercurio dorado: 0 puntos son 36 °C y la meta son 40 °C.

> Guía no oficial. Los números salen de la experiencia de quien la escribe y de estimaciones, y Creality puede cambiar sus reglas. Si algo no coincide con tu cuenta, confía en tu cuenta.

## Qué incluye

- **Guía**: las cinco fuentes de puntos (registro diario, lotería y Premium, comunidad, descargas de modelos y boosts).
- **Simulador**:
  - **Registro diario** de 7 días igual al de Creality (1, 10, boleto, 30, 40, 50, 2 boletos). La tabla no se mueve: registrar solo marca el día, y se reinicia cuando completas los siete. Si pasas un día sin registrarte, la racha se corta.
  - **Check-in Card** (10 puntos en la tienda): si faltaste 1 o 2 días seguidos, revive la racha, da 1 punto por cada día perdido y hoy vuelve a tener su recompensa. Con 3 días o más ya no sirve.
  - **Lotería** en cuadrícula de 3×3 con los premios de Creality: 1 GB de nube, 100, 200, 4.500, 67.400 y 197.067 puntos, Gracias y mes de Premium. Lo que más sale es 100, 200 y 1 GB de nube; el Premium a veces, y los premios grandes casi nunca.
  - **Premium**: los meses que te toquen se acumulan. Mientras haya Premium, la tabla del registro diario vale ×2 (los puntos y también los boletos: 1 pasa a 2, 2 pasan a 4). Los premios de la ruleta **no** se duplican.
  - **Modelos y descargas**: eliges cuántos modelos subes por día (0, 1, 2 o 5). Creality muestra los modelos nuevos igual que los viejos, así que no hay ventaja por ser reciente. Y no todos los modelos se mueven igual: cada uno sale con su propia suerte (sin movimiento, lento, normal, bueno o éxito). Muchos no llegan ni a 10 descargas y unos pocos dejan casi todos los puntos.
  - **Boosts**: de vez en cuando alguien te da boosts. Cada boost vale 100 puntos y cada persona da de 1 a 4. Llegan más cuantos más modelos y seguidores tengas.
  - Saltos de 7, 30, 90 días y 6 meses registrándote cada día.
- **Descargas**: cada bloque de 10 descargas paga 10 puntos más que el anterior, hasta 120. Incluye una tabla de lo que dejan 1, 2 o 5 modelos por día.
- **Ruta**: calculadora de cuánto tardas según tus hábitos (puntos de hoy, Premium, modelos por día y seguidores).
- **Tienda de regalos y canje de prueba**: MakeNow, check-in Card y la impresora. No canjea nada real.
- **Rutina**: lista diaria y semanal que se guarda en el navegador.

Todo funciona en el navegador, sin servidor y sin pedir datos de tu cuenta de Creality. El progreso se guarda con `localStorage`.

## Cómo se calibraron las descargas

Las descargas salen de una mezcla de tipos de modelo (`modelTypes` en `js/config.js`): la mitad casi no se mueve, un cuarto va lento, y apenas uno de cada cien despega. Se ajustó para que una cuenta como la del autor (unos 100 modelos, 100 seguidores y 264 días de racha) dé alrededor de 45.000 puntos, y no cifras enormes. Con esa mezcla, 1 modelo al día tarda cerca de 6 meses en llegar a la meta, 2 al día unos 5 y 5 al día unos 3,7. Son estimaciones: tu cuenta puede salir distinta.

## Verla en tu computador

Abre `index.html` con doble clic, o levanta un servidor local:

```bash
python3 -m http.server 8000
# luego entra a http://localhost:8000
```

## Publicarla en GitHub Pages

1. Crea el repositorio y sube el proyecto. Con la CLI de GitHub (`gh`):

   ```bash
   cd fiebre-de-puntos
   git init
   git add .
   git commit -m "Fiebre de Puntos: primera versión"
   git branch -M main
   gh repo create fiebre-de-puntos --public --source=. --push
   ```

   Sin `gh`, crea un repositorio vacío en github.com y luego:

   ```bash
   git remote add origin https://github.com/TU_USUARIO/fiebre-de-puntos.git
   git push -u origin main
   ```

2. En GitHub entra a **Settings → Pages**.
3. En **Build and deployment**, elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`. Guarda.
4. Espera un par de minutos. La página queda en `https://TU_USUARIO.github.io/fiebre-de-puntos/`.

El archivo `.nojekyll` evita que GitHub procese el sitio con Jekyll.

## Ajustar los números

Todas las reglas están en [`js/config.js`](js/config.js): recompensas del registro, la tienda y la meta (`PRINTER_PRICE`, 40.900), la check-in Card, premios y probabilidades de la lotería, tramos de descargas, tipos de modelo y boosts. Cambia un valor y el simulador, las tablas y las calculadoras se actualizan solos. Si prefieres una meta de 40.000, cambia solo `PRINTER_PRICE`.

Las probabilidades de la lotería, los tipos de modelo y los boosts son valores de ejemplo, no oficiales.

## Pruebas

La lógica del simulador está separada de la interfaz (`js/engine.js`) y tiene pruebas con Node 18 o superior:

```bash
npm test
# o
node --test tests/engine.test.js
```

## Estructura

```
index.html          Página
css/styles.css      Estilos (tema de monedas)
js/config.js        Reglas y números editables
js/engine.js        Lógica del simulador (sin DOM)
js/app.js           Interfaz
tests/              Pruebas del motor
assets/             Favicon y tipografías
```

## Tipografías

Anton y Source Sans 3, ambas con licencia SIL Open Font License (ver `assets/fonts/`). Están incluidas en el proyecto, así que la página no carga nada desde servidores externos.
