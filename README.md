# EcoKar Sim

Gemelo digital web en 3D de **EcoKar**, un carro robot recolector de basura. El simulador reproduce el
firmware real del carro (Arduino Mega 2560), su brazo robótico EEZYbotARM MK3 y el protocolo Bluetooth
de la app de MIT App Inventor, de modo que se puede probar la operación completa sin el hardware.

## Qué es EcoKar

- Tracción 4WD: 4 motorreductores TT con un puente H L298N y un módulo Bluetooth HC-05, alimentados por una LiPo 2S.
- Brazo EEZYbotARM MK3: 3 motores paso a paso 28BYJ-48 con ULN2003 (base, brazo principal y antebrazo) y un gripper con servo SG90.
- Control: la app de MIT App Inventor envía **un carácter por botón** por Bluetooth y lo repite cada 100 ms mientras el botón está presionado.
- Misión: recoger 8 residuos (botellas, latas y bolas de papel) de una calle a escala real y depositarlos en un cajón.

## Requisitos

- [uv](https://docs.astral.sh/uv/) (gestiona Python y las dependencias; el proyecto requiere Python 3.11 o superior).
- GNU Make (opcional: todos los objetivos son envoltorios de comandos `uv`).

## Inicio rápido

```bash
make install   # instala dependencias (uv sync)
make run       # inicia el servidor y abre http://127.0.0.1:8000/ en el navegador
```

Sin `make`: `uv sync` y luego `uv run ecokar-sim --open`.

Opciones de la línea de comandos:

```bash
uv run ecokar-sim --host 127.0.0.1 --port 8000 --open
```

## Objetivos de `make`

| Objetivo       | Descripción |
|----------------|-------------|
| `make help`    | Lista los objetivos (es el objetivo por defecto) |
| `make install` | Instala las dependencias con `uv sync` |
| `make assets`  | Extrae los recursos gráficos de la app desde `info/Ekocar_Final.aia` |
| `make run`     | Inicia el simulador y abre el navegador |
| `make serve`   | Inicia el simulador sin abrir el navegador |
| `make dev`     | Servidor con recarga automática en el puerto 8000 |
| `make web`     | Genera el sitio estático (Python en el navegador con Pyodide) en `dist/` |
| `make web-serve` | Sirve `dist/` en http://127.0.0.1:8080/ para probar el sitio estático |
| `make test`    | Ejecuta las pruebas (`pytest`) |
| `make lint`    | Revisa el código con `ruff check` |
| `make format`  | Da formato al código con `ruff format` |
| `make check`   | `lint` + comprobación de formato + pruebas |
| `make clean`   | Borra `.pytest_cache`, `.ruff_cache` y los `__pycache__` |

## Controles

El panel web reproduce los botones de la app. Cada botón envía su carácter al mantenerse presionado
(repetido cada 100 ms) y `S` al soltarse. Primero hay que **conectar el Bluetooth** en la interfaz:
mientras está desconectado, los caracteres se ignoran.

| Char | Botón           | Efecto |
|------|-----------------|--------|
| `A`  | Avanzar         | Avanza |
| `B`  | Retroceder      | Retrocede |
| `C`  | Girar izquierda | Gira sobre su eje a la izquierda |
| `D`  | Girar derecha   | Gira sobre su eje a la derecha |
| `E`  | Subir           | Antebrazo sube |
| `F`  | Bajar           | Antebrazo baja |
| `G`  | Girar base +    | Base gira a la izquierda |
| `H`  | Girar base −    | Base gira a la derecha |
| `I`  | Adelante        | Brazo principal se extiende hacia adelante |
| `J`  | Atrás           | Brazo principal retrocede |
| `K`  | Abrir gripper   | Abre el gripper (suelta la basura) |
| `L`  | Cerrar gripper  | Cierra el gripper (sujeta la basura) |
| `S` / `0` | (soltar)   | Detiene todo |

El sketch `arduino/carrito_bt_mega/carrito_bt_mega.ino` implementa todas las letras, incluido el brazo
(conexiones en `docs/protocol.md`).
Si no llega ningún comando válido durante 400 ms, el carro se detiene (`[SEG] Timeout de comando: parada`).

**Teclado.** También se puede controlar con el teclado (mismo comportamiento que presionar y soltar el botón):

| Tecla | Letra | Botón de la app |
|-------|-------|-----------------|
| `W` o `↑` | `A` | Avanzar |
| `S` o `↓` | `B` | Retroceder |
| `A` o `←` | `C` | Girar a la izquierda |
| `D` o `→` | `D` | Girar a la derecha |
| `R` / `F` | `E` / `F` | SUBIR / BAJAR |
| `Q` / `E` | `G` / `H` | GIRAR BASE + / GIRAR BASE - |
| `T` / `G` | `I` / `J` | ADELANTE / ATRÁS |
| `Z` / `X` | `K` / `L` | ABRIR GRIPPER / CERRAR GRIPPER |
| `1` `2` `3` | | Cámara orbital, de seguimiento y de pinza |
| `N` o `Retroceso` | | Reiniciar la misión (pide confirmación si ya empezó) |
| `H` | | Mostrar u ocultar la telemetría |

Las teclas de control no envían nada mientras el Bluetooth esté desconectado. Todas las teclas se
ignoran con un diálogo abierto o en combinación con `Ctrl`, `Alt` o `Cmd`.

**Cómo recoger basura:** acércate hasta quedar a unos 30 cm de un residuo (el chasis empuja la basura que
toca), baja el antebrazo con `F` (hasta unos −60°) y extiende el brazo con `I` hasta que el gripper abierto
quede sobre la basura (a unos 2 cm del suelo). Ciérralo con `L` (queda sujeta), levántala con `E`, llévala
sobre el cajón con el carro y `G`/`H`, y suelta con `K`. El orden `F` antes de `I` importa: el acople
mecánico impide extender el brazo principal si el antebrazo sigue horizontal.

La referencia completa del protocolo y del contrato WebSocket está en [`docs/protocol.md`](docs/protocol.md).

## Arquitectura

Arquitectura limpia y "screaming": el núcleo no conoce el framework web; el adaptador FastAPI es el único
módulo que lo importa.

```
src/ecokar_sim/
  config.py                  constantes físicas (con unidades) y del firmware
  bluetooth/protocol.py      caracteres -> comandos, botones de la app
  firmware/controller.py     port fiel del sketch: rampa, hombre muerto, pines L298N, monitor serie
  locomotion/drivetrain.py   cinemática skid-steer a partir del PWM de cada lado
  robotic_arm/               steppers 28BYJ-48, servo SG90, cinemática, brazo, agarre
  world/                     calle (layout), colisiones, basura con gravedad
  mission/                   puntuación de la misión y batería LiPo 2S
  simulation.py              Simulation: dueña de todo; step(dt), snapshot(), handle_client_message()
  serialization.py           mensajes JSON hello / state y su codificación
  realtime.py                ritmo de tiempo real compartido (física a 10 ms, estado a ~30 Hz)
  server/session.py          sesión asyncio por conexión WebSocket (usa realtime.py)
  server/app.py              adaptador FastAPI: /, /static, /api/health, /ws
  browser/bridge.py          adaptador del navegador: BrowserSession para Pyodide (usa realtime.py)
  static/                    frontend (HTML, CSS, JS, recursos y bibliotecas)
    js/net/pyodide-worker.js Web Worker que ejecuta el núcleo Python con Pyodide
scripts/build_web.py         genera el sitio estático en dist/ (sólo biblioteca estándar)
vercel.json                  configuración de Vercel (build estático)
tests/                       pruebas con pytest
docs/protocol.md             protocolo Bluetooth y contrato de mensajes
arduino/                     firmware real (fuente de verdad de la locomoción)
```

Flujo de datos:

```
 navegador --{tx "A"}--> /ws --> Simulation.transmit --> FirmwareController --> PWM izq/der
                                                                              |-> DriveTrain (pose)
                                                                              |-> RoboticArm (jog)
 navegador <--{state, serial, event}-- /ws <-- Simulation.snapshot / drain_outbox
```

Cada conexión WebSocket crea su propio `Simulation`, así que varias pestañas controlan robots independientes.
La simulación avanza en pasos fijos de 10 ms, igual que la rampa del firmware, y es determinista: la
disposición de la calle es fija (se puede pasar una semilla a `Simulation(seed)` para variar la basura).

## Despliegue en Vercel

Vercel sólo sirve archivos estáticos y no mantiene WebSockets, así que el mismo núcleo en Python
también se ejecuta **dentro del navegador**. El frontend elige el motor solo:

| Motor | Cuándo se usa | Cómo funciona |
|-------|---------------|---------------|
| **Servidor local** (`server`) | `make run`, `make serve`, `make dev` | FastAPI ejecuta un `Simulation` por conexión y envía tramas JSON por WebSocket (`/ws`). |
| **Python en el navegador** (`pyodide`) | Sitio estático (Vercel, `make web-serve`) | Un Web Worker carga [Pyodide](https://pyodide.org/) 0.27.2 desde la CDN de jsDelivr, descomprime `static/py/ecokar_sim.zip` (el paquete sin `server/` ni FastAPI) y ejecuta `BrowserSession`; las mismas tramas JSON viajan por `postMessage`. |

Cómo se elige: `?engine=server` o `?engine=pyodide` en la URL fuerza uno; si no, el navegador lee
`/static/build.json` (sólo existe en el build estático y dice `"engine": "pyodide"`); en cualquier otro
caso usa el WebSocket. Con Pyodide la primera carga tarda unos segundos (el botón **Comenzar** muestra el
progreso y se habilita al terminar) y necesita conexión a internet para descargar el motor.

Probar el sitio estático en local:

```bash
make web         # genera dist/ (index.html, static/, static/py/ecokar_sim.zip, static/build.json)
make web-serve   # sirve dist/ en http://127.0.0.1:8080/
```

Sin `make`: `uv run python scripts/build_web.py` y `uv run python -m http.server 8080 --directory dist`.
El script usa sólo la biblioteca estándar, por lo que también corre con `python3` en Vercel. `dist/` es
una salida generada: no se versiona.

Publicar en Vercel:

1. Sube el repositorio a GitHub.
2. En Vercel: **Add New… → Project**, importa el repositorio de GitHub.
3. Deja el **Framework Preset** en **Other**. No hace falta cambiar nada más: el comando de build
   (`python3 scripts/build_web.py`), el directorio de salida (`dist`) y las cabeceras de caché vienen de
   [`vercel.json`](vercel.json); `.vercelignore` deja fuera `.venv`, `tests` y las fotos pesadas de `info/`.
4. Pulsa **Deploy**. Cada `git push` a la rama de producción vuelve a publicar el sitio.

El núcleo debe seguir siendo compatible con Python 3.12 (la versión que trae Pyodide 0.27) y no puede
importar FastAPI ni uvicorn fuera de `server/` y `__main__.py`; `build_web.py` falla si lo detecta.

## Modelo físico

- Calle a escala real (12 × 6 m): el robot (26 cm) es pequeño a propósito.
- Velocidad máxima por lado 0,55 m/s; giro sobre el eje con factor de deslizamiento 1,9.
- Brazo: base ±120°, brazo principal 0–125°, antebrazo −75…35° (ángulo absoluto), con restricción de acople
  `25° ≤ hombro − codo ≤ 165°` y bloqueo contra el suelo. El rango inferior del hombro es 0° (el nominal de
  40° no permite llegar al suelo desde la altura del hombro).
- Los pasos de los steppers se calculan como `round(ángulo_desde_home · 2048/360 · reducción)`.
  Las reducciones son aproximaciones (base 2,5; hombro y codo 1).

## Adaptar el protocolo

Los cambios de letras, botones o velocidades se hacen en un solo lugar:

1. `src/ecokar_sim/bluetooth/protocol.py`: letras, grupos, etiquetas y asignación letra -> articulación.
2. `src/ecokar_sim/config.py`: velocidades, rampa, timeout y dimensiones.
3. `src/ecokar_sim/firmware/controller.py`: sólo si cambia el comportamiento del firmware.

Después, ejecutar `make check` y actualizar [`docs/protocol.md`](docs/protocol.md).

## Desarrollo

```bash
make dev      # recarga automática
make check    # lint + formato + pruebas antes de cada commit
```

El código, los identificadores y los comentarios están en inglés; la documentación y las líneas del
monitor serie están en español, como la app y el firmware.
