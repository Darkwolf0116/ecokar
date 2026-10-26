# Protocolo de EcoKar Sim

Este documento describe tres cosas que deben mantenerse sincronizadas con el robot real:

1. El **protocolo Bluetooth** (un carácter por botón) que usa la app de MIT App Inventor.
2. La **semántica de hombre muerto** y las constantes del firmware.
3. El **contrato WebSocket** entre el servidor del gemelo digital y el navegador.

La fuente de verdad del firmware (locomoción y brazo) es `arduino/carrito_bt_mega/carrito_bt_mega.ino`.
Su emulación está en `src/ecokar_sim/firmware/controller.py` y la tabla de caracteres en
`src/ecokar_sim/bluetooth/protocol.py`.

---

## 1. Caracteres Bluetooth

La app envía **un solo carácter ASCII** por pulsación. Orden visual de los botones de la app:

| Char | Botón de la app     | Grupo        | Efecto                                                          |
|------|---------------------|--------------|-----------------------------------------------------------------|
| `A`  | Avanzar             | locomoción   | Ambos lados hacia adelante (PWM 200)                            |
| `B`  | Retroceder          | locomoción   | Ambos lados hacia atrás (PWM 200)                               |
| `C`  | Girar izquierda     | locomoción   | Giro sobre el eje: izquierda atrás, derecha adelante (PWM 170)  |
| `D`  | Girar derecha       | locomoción   | Giro sobre el eje: izquierda adelante, derecha atrás (PWM 170)  |
| `E`  | Subir               | brazo        | Antebrazo sube (`elbow_deg` aumenta)                            |
| `F`  | Bajar               | brazo        | Antebrazo baja (`elbow_deg` disminuye)                          |
| `G`  | Girar base +        | brazo        | Base gira en sentido antihorario / izquierda (`base_deg` +)     |
| `H`  | Girar base −        | brazo        | Base gira en sentido horario / derecha (`base_deg` −)           |
| `I`  | Adelante            | brazo        | Brazo principal se extiende hacia adelante (`shoulder_deg` −)   |
| `J`  | Atrás               | brazo        | Brazo principal retrocede (`shoulder_deg` +)                    |
| `K`  | Abrir gripper       | brazo        | Gripper se abre (`gripper_deg` +)                               |
| `L`  | Cerrar gripper      | brazo        | Gripper se cierra (`gripper_deg` −)                             |
| `S` o `0` | (soltar botón) | parada       | Detiene **todo**: tracción (con rampa) y todos los movimientos del brazo |

Reglas de interpretación (idénticas al sketch, función `procesarComando`):

- No distingue mayúsculas de minúsculas: `a` equivale a `A`.
- Cualquier otro carácter (`\r`, `\n`, espacios, basura) se **ignora** sin cambiar el estado y sin
  refrescar el temporizador de seguridad.
- El sketch implementa todas las letras: `A`–`D` y `S`/`0` para la locomoción, y `E`–`L` para el
  brazo (3 motores 28BYJ-48 con ULN2003 y un servo SG90), con las mismas constantes que el simulador.

### Conexiones del brazo en el Arduino Mega

| Componente                  | Pines                      | Letras   |
|-----------------------------|----------------------------|----------|
| Base (28BYJ-48 + ULN2003)   | IN1–IN4 = D30, D31, D32, D33 | `G`, `H` |
| Hombro, brazo principal     | IN1–IN4 = D34, D35, D36, D37 | `I`, `J` |
| Codo, antebrazo             | IN1–IN4 = D38, D39, D40, D41 | `E`, `F` |
| Gripper (servo SG90)        | señal = D9                 | `K`, `L` |

- Los motores van en paso completo de dos fases (2048 pasos por vuelta) y se temporizan con `micros()`,
  sin `delay()`, para que el Bluetooth nunca deje de leerse.
- El brazo debe encenderse en la **posición de reposo** (base al frente, brazo principal vertical,
  antebrazo horizontal, gripper abierto), porque no hay finales de carrera.
- Alimenta los ULN2003 y el servo con un regulador de 5 V / 3 A desde la LiPo, no con el pin 5 V del Mega.
- Si una articulación gira al revés, cambia su bandera `INVERTIR_BASE`, `INVERTIR_HOMBRO` o `INVERTIR_CODO`.

### Semántica de las letras del brazo

Una letra del brazo fija la **dirección de avance continuo** (*jog*) de su articulación y no toca la
tracción. La articulación se mueve a su velocidad mientras la letra siga llegando:

| Articulación | Velocidad de jog | Rango (grados)                       | Letras           |
|--------------|------------------|--------------------------------------|------------------|
| `base`       | 30 °/s           | −120 … +120 (0 = frente del chasis)  | `G` (+), `H` (−) |
| `shoulder`   | 25 °/s           | 0 … 125 (90 = vertical)              | `J` (+), `I` (−) |
| `elbow`      | 25 °/s           | −75 … +35 (ángulo absoluto)          | `E` (+), `F` (−) |
| `gripper`    | 120 °/s          | 10 (cerrado) … 80 (abierto)          | `K` (+), `L` (−) |

Restricciones mecánicas que bloquean el movimiento (el jog sigue "pedido", pero la articulación no avanza):

- **Rango** de cada articulación.
- **Acople** del paralelogramo: `25 ≤ shoulder_deg − elbow_deg ≤ 165`.
- **Suelo**: el punto de agarre no puede bajar de y = 0,012 m ni las puntas de los dedos de 0,004 m.

> **Desviación documentada:** el rango nominal del hombro era `[40, 125]`, pero con esa cota el punto de
> agarre nunca llega al suelo (el hombro está a 0,147 m de altura). El simulador usa `[0, 125]`. El
> frontend debe leer los límites de `hello.robot.limits`, no fijarlos a mano.

El mismo bloqueo se informa **una sola vez por golpe** con la línea `[BRAZO] Límite <articulación>` y un
evento `limit`. Al soltar el botón (`S`) y volver a pulsar, un nuevo golpe se informa de nuevo.

---

## 2. Hombre muerto y temporizadores

```
App                          Firmware
 |  botón presionado          |
 |--- "A" -------------------->  objetivo = +200
 |--- "A" (100 ms) ----------->  refresca ultimoComandoMs
 |--- "A" (100 ms) ----------->  ...
 |  botón soltado             |
 |--- "S" -------------------->  objetivo = 0 (con rampa)
```

- La app **repite la letra cada 100 ms** mientras el botón sigue presionado (`repeat_ms` en `hello`).
- Al soltar el botón envía `S`.
- Si no llega ningún comando válido durante más de **400 ms** (`TIMEOUT_COMANDO_MS`, `timeout_ms` en
  `hello`) todo se detiene (tracción con rampa y movimientos del brazo) y se imprime
  `[SEG] Timeout de comando: parada`. Cubre una `S` perdida, un corte Bluetooth o la app cerrada.
- Las letras del brazo también refrescan el temporizador. Un comando ignorado no lo refresca.
- El emulador usa un reloj de 10 ms, por lo que el timeout actúa entre 400 y 410 ms después de la última letra.
- Perder el enlace Bluetooth **no detiene el carro por sí mismo**: el sketch tiene `USAR_PIN_STATE 0`.
  Quien detiene el carro es el timeout de 400 ms.

### Constantes del firmware

| Constante (sketch)    | Valor | Significado                                                        |
|-----------------------|-------|--------------------------------------------------------------------|
| `PWM_MAX`             | 255   | Límite absoluto de PWM                                             |
| `VEL_AVANCE`          | 200   | PWM al avanzar o retroceder                                        |
| `VEL_GIRO`            | 170   | PWM en giros sobre el eje                                          |
| `TRIM_IZQ`/`TRIM_DER` | 0 / 0 | Compensación por lado (unidades PWM)                               |
| `INVERTIR_IZQ`/`_DER` | false | Inversión de polaridad por software (cambia los pines IN, no el movimiento lógico) |
| `RAMPA_PASO`          | 15    | PWM que se acerca al objetivo cada intervalo                       |
| `RAMPA_INTERVALO_MS`  | 10    | Intervalo de la rampa                                              |
| `TIMEOUT_COMANDO_MS`  | 400   | Parada por ausencia de comandos                                    |

Consecuencias de la rampa: de 0 a 200 PWM tarda **14 pasos = 140 ms**; toda inversión de sentido pasa por
PWM = 0 durante un ciclo (A → B tarda 280 ms); en 0 el puente H queda en rueda libre (`IN1 = IN2 = 0`).

### Mapeo del L298N

| Lado      | Enable | Dirección      | Adelante        | Atrás           | Parado (coast)  |
|-----------|--------|----------------|-----------------|-----------------|-----------------|
| Izquierdo | `ENA`  | `IN1`, `IN2`   | `IN1=1, IN2=0`  | `IN1=0, IN2=1`  | `IN1=0, IN2=0`  |
| Derecho   | `ENB`  | `IN3`, `IN4`   | `IN3=1, IN4=0`  | `IN3=0, IN4=1`  | `IN3=0, IN4=0`  |

`ENA`/`ENB` valen el módulo del PWM aplicado (0–255).

### Líneas del monitor serie

| Línea                                   | Cuándo                                                              |
|-----------------------------------------|---------------------------------------------------------------------|
| `Carrito BT listo. Comandos: A B C D S` | Al conectar el Bluetooth (línea de `setup()` del sketch)            |
| `[BT] Conectado` / `[BT] Desconectado`  | Al conectar / desconectar el enlace                                 |
| `[CMD] <c>`                             | Sólo cuando cambia el comando de locomoción (`A`–`D`, `S`)          |
| `[BRAZO] <c>`                           | Cuando una articulación cambia de dirección de jog (`E`–`L`)        |
| `[BRAZO] Límite <base\|hombro\|codo\|pinza\|suelo>` | Una vez por golpe de límite                            |
| `[SEG] Timeout de comando: parada`      | Cuando salta el hombre muerto                                       |

---

## 3. Contrato WebSocket

- URL: `ws://<host>:<puerto>/ws`. Mensajes: **tramas de texto JSON**, un objeto por trama.
- **Cada conexión tiene su propio `Simulation`**: cada pestaña controla un robot independiente.
- La física avanza con paso fijo de **10 ms** (acumulador sobre `time.perf_counter`, recupera como máximo
  10 pasos por tick). El servidor envía `state` a unos **30 Hz** y vacía las líneas serie y los eventos
  en cada tick.
- Los flotantes del servidor se redondean a **4 decimales**.
- Convención de ejes (Three.js): Y arriba, el suelo es el plano XZ. Un robot con `yaw` mira hacia
  `(cos yaw, 0, −sin yaw)`, igual que `rotation.y = yaw` aplicado a un modelo cuyo frente es +X local.
  `yaw` positivo es giro a la izquierda (antihorario visto desde arriba). `yaw` es continuo, no se normaliza.
- Unidades: metros, segundos y radianes. Los grados sólo aparecen en campos terminados en `_deg`.
- `index.html` se sirve en `/`, por lo que sus recursos deben usar rutas absolutas `/static/...`.
- **El contrato es el mismo para los dos transportes.** Con el servidor local (FastAPI) las tramas viajan
  por WebSocket; en el sitio estático (Vercel) el núcleo corre en el navegador con Pyodide dentro de un Web
  Worker (`static/js/net/pyodide-worker.js`, `src/ecokar_sim/browser/bridge.py`) y las mismas cadenas JSON
  viajan por `postMessage` (cliente → worker: una cadena por mensaje; worker → cliente: una cadena por
  trama, además de objetos de control `{"kind": "progress" | "ready" | "error"}` que no forman parte del
  contrato). El ritmo (paso de 10 ms, tope de recuperación, `state` a ~30 Hz) y la codificación son el mismo
  código (`realtime.py`, `serialization.py`), así que el JSON es idéntico byte a byte. `GET /static/build.json`
  indica qué motor usar: `{"engine": "server"}` en el servidor local y `"pyodide"` en el build estático.

### 3.1 Servidor → cliente

#### `hello` (primera trama, al aceptar la conexión)

```json
{
  "type": "hello",
  "version": 1,
  "world": {
    "road": {"x_min": -6.0, "x_max": 6.0, "z_min": -3.0, "z_max": 3.0},
    "sidewalk_width": 2.5,
    "curb_height": 0.15,
    "obstacles": [
      {"id": "car-1", "kind": "car", "x": 0.5, "z": 2.0, "yaw": 0.0, "w": 4.2, "d": 1.8, "h": 1.45},
      {"id": "cone-1", "kind": "cone", "x": -3.0, "z": 0.9, "yaw": 0.0, "w": 0.3, "d": 0.3, "h": 0.5}
    ],
    "crate": {"x": 4.5, "z": -2.2, "yaw": 0.0, "w": 0.32, "d": 0.32, "h": 0.1, "wall": 0.01},
    "decor": [{"id": "manhole-1", "kind": "manhole", "x": -1.5, "z": -0.2, "radius": 0.3}],
    "trash": [{"id": "t1", "kind": "bottle", "x": -3.4, "y": 0.02, "z": 1.9, "yaw": 0.6, "state": "ground"}]
  },
  "robot": {
    "plate_length": 0.26, "plate_width": 0.15, "plate_y": 0.062,
    "wheel_radius": 0.0325, "wheel_width": 0.026, "track": 0.17, "wheelbase": 0.15,
    "collision_radius": 0.15, "v_max": 0.55,
    "arm_mount": [0.06, 0.062, 0.0], "shoulder_height": 0.085,
    "l1": 0.135, "l2": 0.147, "grasp_offset": [0.055, -0.02], "gripper_max_opening": 0.058,
    "home": {"base_deg": 0.0, "shoulder_deg": 90.0, "elbow_deg": 0.0, "gripper_deg": 80.0},
    "limits": {
      "base_deg": [-120.0, 120.0], "shoulder_deg": [0.0, 125.0], "elbow_deg": [-75.0, 35.0],
      "gripper_deg": [10.0, 80.0], "coupling_deg": [25.0, 165.0]
    }
  },
  "protocol": {
    "commands": [{"char": "A", "label": "Avanzar", "group": "locomotion"}],
    "stop": ["S", "0"],
    "repeat_ms": 100,
    "timeout_ms": 400
  }
}
```

(`commands` contiene los 12 botones `A`–`L` en el orden visual de la app.)

Notas de `world`:

- La carretera conducible es `x ∈ [x_min, x_max]`, `z ∈ [z_min, z_max]`. Los bordillos son paredes; las
  aceras (`|z| > 3`, hasta `3 + sidewalk_width`) son sólo visuales.
- Un obstáculo es un rectángulo rotado: `w` es el tamaño a lo largo de su eje X local, `d` a lo largo de Z
  local y `h` la altura de render. `kind`: `car`, `cone`.
- `crate`: `w` y `d` son la huella **exterior**; las paredes miden `wall` y el suelo interior está a
  `y = 0.01`. La basura soltada dentro de la huella interior cuenta como depositada.
- `decor` es puramente visual (no es obstáculo). `kind`: `manhole`.
- `trash[].kind`: `bottle`, `can`, `paper`.

Notas de `robot`:

- Ruedas en `(± wheelbase/2, ± track/2)` respecto al centro del chasis. Frente = +X local, derecha = +Z local.
- `arm_mount` es el pivote de la base en coordenadas locales del chasis `[x adelante, y arriba, z derecha]`.
  El pivote del hombro está `shoulder_height` por encima de la placa (`plate_y`).
- Cinemática en el plano del brazo (`r` adelante, `h` arriba, desde el hombro): codo = `(l1·cos θ1, l1·sin θ1)`,
  muñeca = codo + `(l2·cos θ2, l2·sin θ2)`, punto de agarre = muñeca + `grasp_offset`, con
  `θ1 = shoulder_deg` y `θ2 = elbow_deg` (ángulo **absoluto**; el gripper permanece nivelado).
  Luego se rota por `base_deg` y por el `yaw` del robot.

#### `state` (~30 Hz)

```json
{
  "type": "state", "t": 0.5, "connected": true,
  "robot": {"x": -4.3287, "z": 0.0, "yaw": 0.0, "v": 0.4314, "omega": 0.0},
  "drive": {
    "command": "A", "left_pwm": 200, "right_pwm": 200, "left_target": 200, "right_target": 200,
    "pins": {"ENA": 200, "IN1": 1, "IN2": 0, "ENB": 200, "IN3": 1, "IN4": 0}
  },
  "arm": {
    "base_deg": 0.0, "shoulder_deg": 90.0, "elbow_deg": 0.0, "gripper_deg": 80.0, "opening_m": 0.058,
    "steps": {"base": 0, "shoulder": 0, "elbow": 0},
    "jog": {"base": 0, "shoulder": 0, "elbow": 0, "gripper": 0},
    "grasp_point": [-4.0667, 0.262, 0.0],
    "held": null
  },
  "trash": [{"id": "t1", "kind": "bottle", "x": -3.4, "y": 0.02, "z": 1.9, "yaw": 0.6, "state": "ground"}],
  "mission": {"total": 8, "collected": 0, "deposited": 0, "elapsed_s": 0.5, "distance_m": 0.1713, "complete": false},
  "battery": {"voltage": 8.3999, "percent": 99.9955}
}
```

| Campo | Significado |
|-------|-------------|
| `t` | Tiempo simulado en segundos |
| `connected` | Estado del enlace Bluetooth simulado |
| `robot.v`, `robot.omega` | Velocidad lineal (m/s) y angular (rad/s, + = izquierda) |
| `drive.command` | `comandoActual` del sketch (`A`–`D` o `S`) |
| `drive.left_pwm`, `right_pwm` | PWM **aplicado** con signo (tras la rampa) |
| `drive.left_target`, `right_target` | PWM objetivo con signo |
| `drive.pins` | Niveles en el L298N: `ENA`/`ENB` 0–255, `IN1..IN4` 0/1 |
| `arm.*_deg` | Ángulos actuales de las articulaciones (grados) |
| `arm.opening_m` | Distancia entre los dedos: `0.058 · (gripper_deg − 10) / 70` |
| `arm.steps` | Pasos acumulados desde el home: `round(ángulo_desde_home · 2048/360 · reducción)` |
| `arm.jog` | Dirección pedida por articulación: −1, 0 o +1 |
| `arm.grasp_point` | Punto entre los dedos en coordenadas de mundo `[x, y, z]` |
| `arm.held` | `id` de la basura sujeta, o `null` |
| `trash[].state` | `ground`, `held`, `falling` o `deposited` |
| `mission.collected` | Basuras distintas que se han sujetado alguna vez |
| `mission.deposited` | Basuras dentro del cajón |
| `mission.elapsed_s` | Arranca con el primer comando válido tras conectar y se detiene al completar |
| `mission.complete` | `true` cuando `deposited == total` |
| `battery` | LiPo 2S 2200 mAh: `voltage` (6,6–8,4 V) y `percent` |

Reducciones de engranaje (aproximadas): base 2,5; hombro 1; codo 1.

#### `serial`

```json
{"type": "serial", "t": 0.01, "line": "[CMD] A"}
```

Una trama por cada línea que el firmware imprimiría por el puerto serie USB.

#### `event`

```json
{"type": "event", "t": 3.21, "name": "grasp", "data": {"id": "t6", "kind": "paper"}}
```

| `name` | `data` |
|--------|--------|
| `grasp` | `{id, kind}`: la basura quedó sujeta |
| `release` | `{id, kind}`: se soltó (empieza a caer) |
| `deposit` | `{id, kind, deposited, total}`: aterrizó dentro del cajón |
| `collision` | `{with, x, z}`: choque del chasis (`with` = `road`, `crate` o el `id` del obstáculo); máximo 1 cada 0,5 s |
| `mission_complete` | `{elapsed_s, distance_m, collected, deposited}`: una sola vez |
| `limit` | `{joint, reason}`: `joint` ∈ `base`, `shoulder`, `elbow`, `gripper`; `reason` ∈ `range`, `coupling`, `ground` |

### 3.2 Cliente → servidor

| Mensaje | Efecto |
|---------|--------|
| `{"type": "bt_connect"}` | Conecta el Bluetooth simulado (imprime el banner y `[BT] Conectado`) |
| `{"type": "bt_disconnect"}` | Lo desconecta (imprime `[BT] Desconectado`; el carro **no** se detiene por ello) |
| `{"type": "tx", "data": "A"}` | Caracteres crudos; pueden ser varios y se procesan en orden. Se ignora si no hay conexión |
| `{"type": "reset"}` | Mundo y misión nuevos; se conserva el estado de conexión. No se reenvía `hello`: reconstruir la escena con `state.trash` |

JSON inválido, mensajes que no son objetos, tipos desconocidos o campos con tipo incorrecto se **ignoran**
sin cerrar la conexión. Las tramas binarias también se ignoran.

### 3.3 Agarre, transporte y depósito

- **Cerrar (`L`)**: si una basura en estado `ground` (o `falling`) tiene su centro a menos de 0,03 m del
  punto de agarre y cabe entre los dedos (`width ≤ opening_m`), el servo se detiene (stall) cuando
  `opening_m` alcanza `width`; la basura pasa a `held` y emite `grasp`.
- **Transporte**: la basura sujeta sigue al punto de agarre y su `yaw` sigue el rumbo del brazo.
- **Soltar (`K`)**: si `opening_m > width + 0,004` la basura pasa a `falling` (gravedad 9,81 m/s²) y emite
  `release`. Aterriza en el suelo (`y = rest_height`) o, si cae sobre la huella interior del cajón, sobre
  su suelo; entonces pasa a `deposited` y emite `deposit`. Una basura depositada no se puede volver a sujetar.
- El chasis **empuja** la basura suelta con la que se solapa.

| `kind` | `width` (m) | `length` (m) | `rest_height` (m) |
|--------|-------------|--------------|-------------------|
| `bottle` | 0,040 | 0,110 | 0,020 |
| `can`    | 0,034 | 0,070 | 0,017 |
| `paper`  | 0,036 | 0,036 | 0,018 |

### 3.4 Modelo físico (resumen)

- Cada lado: `v_lado = (pwm / 255) · 0,55 m/s`. `v = (vL + vR) / 2`, `ω = (vR − vL) / (0,17 · 1,9)`.
- Colisión del chasis: círculo de 0,15 m contra bordillos, obstáculos y cajón. Un avance bloqueado se
  descarta (el giro sobre el eje siempre es posible).
- Batería: `I = 0,15 A + 0,9 A · (|pwmL| + |pwmR|) / 510 + 0,24 A por stepper en movimiento + 0,15 A servo en movimiento`.

---

## 4. Cómo adaptar el protocolo

- **Cambiar o añadir una letra**: editar `Command`, los conjuntos `LOCOMOTION`/`ARM`/`STOP`,
  `ARM_JOG_BINDINGS` y `BUTTONS` en `src/ecokar_sim/bluetooth/protocol.py`. Si la letra mueve la
  locomoción, añadir su caso en `FirmwareController._set_locomotion`.
- **Cambiar velocidades, rampa o timeout**: constantes de `src/ecokar_sim/config.py` (con el nombre original
  del sketch en el comentario). Actualizar también el sketch si el cambio debe llegar al robot real.
- **Cuando el firmware real incorpore el brazo**: comparar las líneas `[BRAZO]` de `controller.py` y la
  tabla de la sección 1 con el nuevo sketch y ajustar las diferencias.
- Cualquier cambio en el contrato WebSocket debe reflejarse en `src/ecokar_sim/serialization.py`,
  en las pruebas `tests/test_simulation.py` y en este documento.
