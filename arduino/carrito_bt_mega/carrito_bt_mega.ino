/*
 * ============================================================================
 *  EcoKar: carrito robótico Bluetooth con brazo EEZYbotARM MK3
 *  Hardware : Arduino Mega 2560 + L298N + HC-05 + 4 motorreductores TT (2 + 2)
 *             + 3 motores paso a paso 28BYJ-48 con driver ULN2003
 *             + 1 servo SG90 (gripper)
 *  Control  : App de MIT App Inventor -> un carácter por Bluetooth
 *
 *  Comandos (orden visual de los botones de la app):
 *    Locomoción
 *      'A' -> Avanzar              'B' -> Retroceder
 *      'C' -> Girar a la izquierda 'D' -> Girar a la derecha (sobre su eje)
 *    Brazo robótico
 *      'E' -> SUBIR (antebrazo)          'F' -> BAJAR (antebrazo)
 *      'G' -> GIRAR BASE + (izquierda)   'H' -> GIRAR BASE - (derecha)
 *      'I' -> ADELANTE (brazo principal) 'J' -> ATRÁS (brazo principal)
 *      'K' -> ABRIR GRIPPER              'L' -> CERRAR GRIPPER
 *    'S' o '0' -> Detener TODO (la app lo envía al SOLTAR cada botón)
 *  Se aceptan mayúsculas y minúsculas. Cualquier otro carácter se ignora sin
 *  alterar el estado.
 *
 *  Modo "mantener presionado" (hombre muerto), igual para ruedas y brazo:
 *    - Al presionar un botón la app envía su letra y la REPITE cada 100 ms
 *      mientras siga presionado (Clock en App Inventor).
 *    - Al soltarlo envía 'S': el carrito frena y el brazo se queda quieto.
 *    - Si deja de llegar una letra válida durante TIMEOUT_COMANDO_MS (se perdió
 *      la 'S', se cortó el Bluetooth o se cerró la app), todo se detiene.
 *    - Una letra del brazo NO modifica la locomoción, y viceversa.
 *
 *  Conexiones:
 *    L298N   : ENA=D5(PWM)  IN1=D22  IN2=D23  IN3=D24  IN4=D25  ENB=D6(PWM)
 *              OUT1/OUT2 = lado IZQUIERDO (2 motores en paralelo)
 *              OUT3/OUT4 = lado DERECHO   (2 motores en paralelo)
 *    HC-05   : TXD -> RX1 (D19)
 *              RXD <- TX1 (D18) a través de divisor 1 kΩ / 2 kΩ (5 V -> 3,3 V)
 *              STATE (opcional) -> D26
 *    ULN2003 : Base   IN1..IN4 = D30 D31 D32 D33
 *              Hombro IN1..IN4 = D34 D35 D36 D37  (brazo principal, I / J)
 *              Codo   IN1..IN4 = D38 D39 D40 D41  (antebrazo, E / F)
 *    SG90    : señal = D9
 *    Monitor serie (USB) a 115200 baudios: depuración y pruebas en banco
 *    (puedes escribir cualquier comando desde el Monitor Serie del IDE).
 *
 *  Alimentación del brazo (IMPORTANTE):
 *    Los tres 28BYJ-48 (~240 mA cada uno con torque) y el SG90 (picos de
 *    ~650 mA al trabarse) NO deben alimentarse desde el pin 5 V del Mega.
 *    Usa un regulador step-down (buck) de 5 V / 3 A desde la LiPo para los
 *    ULN2003 y el servo, y une su GND con el GND del Mega y del L298N.
 *
 *  Posición inicial (no hay finales de carrera):
 *    Enciende el carrito con el brazo en la posición de reposo: base mirando
 *    al frente, brazo principal vertical, antebrazo horizontal y gripper
 *    abierto. Los límites por software se cuentan desde esa posición.
 *
 *  Características de robustez:
 *    - UART por hardware (Serial1), sin SoftwareSerial.
 *    - Rampa de aceleración no bloqueante (limita picos de corriente que
 *      reinician el Mega y protegen el L298N).
 *    - Toda inversión de sentido pasa por PWM = 0 (sin cambios bruscos).
 *    - Compensación (trim) por lado para igualar las diferencias entre motores.
 *    - Motores paso a paso y servo sin delay(): todo se temporiza con micros()
 *      y millis(), así el Bluetooth nunca deja de leerse.
 *    - Límites por software en cada articulación, acople mecánico entre brazo
 *      y antebrazo, y protección para que la pinza no choque con el suelo.
 *    - Parada de seguridad opcional por pérdida de enlace (pin STATE) y por
 *      ausencia de comandos (timeout).
 *
 *  Gemelo digital: la simulación EcoKar (src/ecokar_sim) emula este sketch con
 *  las mismas constantes. Si cambias un valor aquí, cámbialo también en
 *  src/ecokar_sim/config.py.
 * ============================================================================
 */

#include <Arduino.h>
#include <Servo.h>  // En el Mega usa el Timer5: D44, D45 y D46 pierden PWM (D5 y D6 no).

// ----------------------------------------------------------------------------
//  Pines del L298N
// ----------------------------------------------------------------------------
const uint8_t PIN_ENA = 5;    // PWM lado izquierdo  (Timer3 en el Mega)
const uint8_t PIN_IN1 = 22;   // Dirección lado izquierdo
const uint8_t PIN_IN2 = 23;
const uint8_t PIN_ENB = 6;    // PWM lado derecho    (Timer4 en el Mega)
const uint8_t PIN_IN3 = 24;   // Dirección lado derecho
const uint8_t PIN_IN4 = 25;

// ----------------------------------------------------------------------------
//  Pines del brazo robótico
// ----------------------------------------------------------------------------
const uint8_t PINES_BASE[4]   = { 30, 31, 32, 33 };  // ULN2003 IN1..IN4
const uint8_t PINES_HOMBRO[4] = { 34, 35, 36, 37 };
const uint8_t PINES_CODO[4]   = { 38, 39, 40, 41 };
const uint8_t PIN_SERVO_PINZA = 9;

// ----------------------------------------------------------------------------
//  Bluetooth HC-05
// ----------------------------------------------------------------------------
const long BT_BAUD    = 9600;    // Baudios por defecto del HC-05 en modo datos
const long DEBUG_BAUD = 115200;  // Monitor serie por USB

// 1 = usar el pin STATE del HC-05 (HIGH cuando hay conexión) para detener el
//     carrito si se pierde el enlace. Déjalo en 0 si NO cableaste STATE
//     (un pin flotante produciría paradas aleatorias).
#define USAR_PIN_STATE 0
const uint8_t PIN_BT_STATE = 26;

// ----------------------------------------------------------------------------
//  Parámetros de movimiento (ajustables)
// ----------------------------------------------------------------------------
const int PWM_MAX    = 255;  // Límite absoluto de PWM. Con batería 2S (8,4 V
                             // a plena carga) 255 es seguro para motores TT de
                             // 5 V gracias a la caída de ~2 V del L298N.
const int VEL_AVANCE = 200;  // PWM para avanzar / retroceder (0..255)
const int VEL_GIRO   = 170;  // PWM para giros sobre el eje (0..255)

// Compensación por lado (unidades PWM, positivas o negativas).
// Si el carrito se desvía al AVANZAR hacia la derecha, el lado izquierdo va
// más rápido: reduce TRIM_IZQ (p. ej. -15) o aumenta TRIM_DER.
const int TRIM_IZQ = 0;      // Lado izquierdo (2 motores)
const int TRIM_DER = 0;      // Lado derecho   (2 motores)

// Si un lado completo gira al revés, cambia su bandera a true
// (equivale a intercambiar los cables OUT de ese canal).
const bool INVERTIR_IZQ = false;
const bool INVERTIR_DER = false;

// Rampa: cada RAMPA_INTERVALO_MS el PWM se acerca RAMPA_PASO unidades al
// objetivo. Con 15 / 10 ms: 0 -> 200 en ~140 ms; inversión completa ~270 ms.
const int           RAMPA_PASO         = 15;
const unsigned long RAMPA_INTERVALO_MS = 10;

// Parada automática si no llega ningún comando válido en este tiempo.
// La app reenvía la letra cada 100 ms mientras el botón está presionado, así
// que 400 ms deja margen para 3 paquetes perdidos. 0 = desactivado (solo si
// la app NO repite el comando).
const unsigned long TIMEOUT_COMANDO_MS = 400;

// ----------------------------------------------------------------------------
//  Parámetros del brazo (ajustables; mismos valores que el gemelo digital)
// ----------------------------------------------------------------------------
// 28BYJ-48 en paso completo de dos fases: 2048 pasos por vuelta del eje de
// salida (ya incluye su reductora interna de ~1:64). Máximo seguro ~15 rpm.
const int PASOS_POR_VUELTA = 2048;

// Velocidad de cada articulación mientras se mantiene el botón (grados/s) y
// reducción entre el eje del motor y la articulación (1.0 = directo).
// La reducción de la base es aproximada: mide la tuya (vueltas del motor por
// cada vuelta de la base) y ajústala para que los grados sean exactos.
const float VEL_BASE_GS    = 30.0;
const float VEL_HOMBRO_GS  = 25.0;
const float VEL_CODO_GS    = 25.0;
const float REDUCCION_BASE   = 2.5;
const float REDUCCION_HOMBRO = 1.0;
const float REDUCCION_CODO   = 1.0;

// Ángulos (grados). Hombro: ángulo del brazo principal respecto a la
// horizontal hacia adelante (90 = vertical). Codo: ángulo ABSOLUTO del
// antebrazo respecto a la horizontal (el paralelogramo del EEZYbotARM lo
// mantiene independiente del hombro). Base: 0 = al frente, + = izquierda.
const float BASE_INICIO   = 0.0,  BASE_MIN   = -120.0, BASE_MAX   = 120.0;
const float HOMBRO_INICIO = 90.0, HOMBRO_MIN = 0.0,    HOMBRO_MAX = 125.0;
const float CODO_INICIO   = 0.0,  CODO_MIN   = -75.0,  CODO_MAX   = 35.0;

// Acople mecánico: (hombro - codo) debe quedar dentro de esta banda o los
// eslabones chocan entre sí.
const float ACOPLE_MIN = 25.0;
const float ACOPLE_MAX = 165.0;

// Protección de suelo: altura mínima del punto de agarre (m). Geometría del
// EEZYbotARM montado en el chasis, medida desde el piso.
#define USAR_LIMITE_SUELO 1
const float ALTURA_PLACA_M    = 0.062;  // cara superior del chasis
const float ALTURA_HOMBRO_M   = 0.085;  // eje del hombro sobre la placa
const float LARGO_BRAZO_M     = 0.135;  // brazo principal (L1)
const float LARGO_ANTEBRAZO_M = 0.147;  // antebrazo (L2)
const float CAIDA_PINZA_M     = 0.020;  // la pinza cuelga bajo la muñeca
const float AGARRE_MIN_M      = 0.012;

// Mantener las bobinas energizadas en reposo. El hombro y el codo cargan el
// peso del brazo y conviene mantenerlos; la base puede soltarse para ahorrar
// batería y evitar que el motor se caliente.
const bool TORQUE_BASE   = false;
const bool TORQUE_HOMBRO = true;
const bool TORQUE_CODO   = true;

// Si una articulación se mueve al revés, cambia su bandera a true.
const bool INVERTIR_BASE   = false;
const bool INVERTIR_HOMBRO = false;
const bool INVERTIR_CODO   = false;

// Gripper SG90: ángulo cerrado / abierto y velocidad mientras se mantiene
// ABRIR o CERRAR (1 grado cada 8333 us = 120 grados/s).
const int           PINZA_CERRADA      = 10;
const int           PINZA_ABIERTA      = 80;
const unsigned long PINZA_INTERVALO_US = 8333;

// ----------------------------------------------------------------------------
//  Modelo de cada lado del carrito
// ----------------------------------------------------------------------------
struct LadoMotor {
  uint8_t pinEn;      // Pin PWM (ENA / ENB)
  uint8_t pinA;       // IN1 / IN3
  uint8_t pinB;       // IN2 / IN4
  bool    invertido;  // Corrección de polaridad por software
  int     actual;     // Velocidad aplicada  (-PWM_MAX .. +PWM_MAX)
  int     objetivo;   // Velocidad deseada   (-PWM_MAX .. +PWM_MAX)
};

LadoMotor ladoIzq = { PIN_ENA, PIN_IN1, PIN_IN2, INVERTIR_IZQ, 0, 0 };
LadoMotor ladoDer = { PIN_ENB, PIN_IN3, PIN_IN4, INVERTIR_DER, 0, 0 };

// ----------------------------------------------------------------------------
//  Modelo de cada articulación del brazo (28BYJ-48 + ULN2003)
// ----------------------------------------------------------------------------
struct Articulacion {
  const char   *nombre;          // Para el monitor serie
  const uint8_t *pines;          // IN1..IN4 del ULN2003
  bool          invertido;
  bool          mantenerTorque;
  float         inicioGrados;    // Ángulo en la posición de reposo
  float         pasosPorGrado;
  long          minPasos;        // Límites relativos a la posición de reposo
  long          maxPasos;
  unsigned long intervaloUs;     // Tiempo entre pasos a la velocidad de jog
  long          posicion;        // Pasos desde la posición de reposo
  int8_t        jog;             // -1, 0 o +1 mientras se mantiene el botón
  uint8_t       fase;            // 0..3 dentro de la secuencia de bobinas
  bool          energizada;
  bool          limiteAvisado;   // El límite se informa una sola vez
  unsigned long ultimoPasoUs;
};

Articulacion base;
Articulacion hombro;
Articulacion codo;

Servo         servoPinza;
int           anguloPinza        = PINZA_ABIERTA;
int8_t        jogPinza           = 0;
bool          limitePinzaAvisado = false;
unsigned long ultimoPasoPinzaUs  = 0;

// Paso completo de dos fases: dos bobinas activas a la vez (más torque).
const uint8_t SECUENCIA[4][4] = {
  { HIGH, HIGH, LOW,  LOW  },
  { LOW,  HIGH, HIGH, LOW  },
  { LOW,  LOW,  HIGH, HIGH },
  { HIGH, LOW,  LOW,  HIGH },
};

unsigned long ultimoComandoMs = 0;
unsigned long ultimaRampaMs   = 0;
char          comandoActual   = 'S';

// ----------------------------------------------------------------------------
//  Capa de bajo nivel: escribe dirección + PWM en el L298N
// ----------------------------------------------------------------------------
void aplicarSalida(const LadoMotor &m) {
  int v = m.invertido ? -m.actual : m.actual;

  if (v > 0) {                       // Adelante
    digitalWrite(m.pinA, HIGH);
    digitalWrite(m.pinB, LOW);
  } else if (v < 0) {                // Atrás
    digitalWrite(m.pinA, LOW);
    digitalWrite(m.pinB, HIGH);
  } else {                           // Rueda libre (coast)
    digitalWrite(m.pinA, LOW);
    digitalWrite(m.pinB, LOW);
  }
  analogWrite(m.pinEn, abs(v));
}

// Avanza un paso de rampa. Si el siguiente valor cruza por cero (inversión de
// sentido), se detiene exactamente en 0 durante un ciclo antes de invertir.
void actualizarRampa(LadoMotor &m) {
  if (m.actual == m.objetivo) {
    return;
  }

  int siguiente;
  if (m.actual < m.objetivo) {
    siguiente = m.actual + RAMPA_PASO;
    if (siguiente > m.objetivo) siguiente = m.objetivo;
  } else {
    siguiente = m.actual - RAMPA_PASO;
    if (siguiente < m.objetivo) siguiente = m.objetivo;
  }

  if ((m.actual > 0 && siguiente < 0) || (m.actual < 0 && siguiente > 0)) {
    siguiente = 0;
  }

  m.actual = siguiente;
  aplicarSalida(m);
}

void fijarObjetivo(int velIzq, int velDer) {
  ladoIzq.objetivo = constrain(velIzq, -PWM_MAX, PWM_MAX);
  ladoDer.objetivo = constrain(velDer, -PWM_MAX, PWM_MAX);
}

// true si se ha pedido movimiento (aunque la rampa aún no haya llegado).
bool hayObjetivo() {
  return (ladoIzq.objetivo != 0) || (ladoDer.objetivo != 0);
}

bool enMovimiento() {
  return (ladoIzq.objetivo != 0) || (ladoDer.objetivo != 0) ||
         (ladoIzq.actual   != 0) || (ladoDer.actual   != 0);
}

// ----------------------------------------------------------------------------
//  Capa de bajo nivel del brazo
// ----------------------------------------------------------------------------
void configurarArticulacion(Articulacion &a, const char *nombre,
                            const uint8_t *pines, bool invertido,
                            bool mantenerTorque, float inicio, float minimo,
                            float maximo, float velocidadGs, float reduccion) {
  a.nombre         = nombre;
  a.pines          = pines;
  a.invertido      = invertido;
  a.mantenerTorque = mantenerTorque;
  a.inicioGrados   = inicio;
  a.pasosPorGrado  = PASOS_POR_VUELTA / 360.0 * reduccion;
  a.minPasos       = lround((minimo - inicio) * a.pasosPorGrado);
  a.maxPasos       = lround((maximo - inicio) * a.pasosPorGrado);
  a.intervaloUs    = (unsigned long)(1000000.0 / (velocidadGs * a.pasosPorGrado));
  a.posicion       = 0;
  a.jog            = 0;
  a.fase           = 0;
  a.energizada     = false;
  a.limiteAvisado  = false;
  a.ultimoPasoUs   = 0;

  for (uint8_t i = 0; i < 4; i++) {
    pinMode(a.pines[i], OUTPUT);
  }
}

float anguloGrados(const Articulacion &a, long posicion) {
  return a.inicioGrados + posicion / a.pasosPorGrado;
}

void escribirBobinas(Articulacion &a) {
  for (uint8_t i = 0; i < 4; i++) {
    digitalWrite(a.pines[i], SECUENCIA[a.fase][i]);
  }
  a.energizada = true;
}

void soltarBobinas(Articulacion &a) {
  for (uint8_t i = 0; i < 4; i++) {
    digitalWrite(a.pines[i], LOW);
  }
  a.energizada = false;
}

void avisarLimite(bool &yaAvisado, const char *nombre) {
  if (!yaAvisado) {
    yaAvisado = true;
    Serial.print(F("[BRAZO] Límite "));
    Serial.println(nombre);
  }
}

#if USAR_LIMITE_SUELO
// Altura del punto de agarre sobre el piso para unos ángulos dados.
float alturaAgarre(float hombroGrados, float codoGrados) {
  return ALTURA_PLACA_M + ALTURA_HOMBRO_M +
         LARGO_BRAZO_M * sin(radians(hombroGrados)) +
         LARGO_ANTEBRAZO_M * sin(radians(codoGrados)) - CAIDA_PINZA_M;
}
#endif

// Comprueba si la articulación puede dar un paso más en su sentido de jog.
// Devuelve el nombre del límite alcanzado, o nullptr si el paso es seguro.
const char *limiteDelPaso(const Articulacion &a, long siguiente) {
  if (siguiente < a.minPasos || siguiente > a.maxPasos) {
    return a.nombre;
  }
  if (&a == &base) {
    return nullptr;  // La base no interviene en el acople ni en el suelo
  }

  float hombroGrados = anguloGrados(hombro, &a == &hombro ? siguiente : hombro.posicion);
  float codoGrados   = anguloGrados(codo,   &a == &codo   ? siguiente : codo.posicion);
  float acople = hombroGrados - codoGrados;
  if (acople < ACOPLE_MIN || acople > ACOPLE_MAX) {
    return a.nombre;
  }
#if USAR_LIMITE_SUELO
  // Solo se bloquea el paso que BAJA la pinza; subir siempre está permitido.
  float alturaNueva  = alturaAgarre(hombroGrados, codoGrados);
  float alturaActual = alturaAgarre(anguloGrados(hombro, hombro.posicion),
                                    anguloGrados(codo, codo.posicion));
  if (alturaNueva < AGARRE_MIN_M && alturaNueva < alturaActual) {
    return "suelo";
  }
#endif
  return nullptr;
}

// Da un paso si toca según la velocidad de jog. No bloquea.
void actualizarArticulacion(Articulacion &a, unsigned long ahoraUs) {
  if (a.jog == 0) {
    if (a.energizada && !a.mantenerTorque) {
      soltarBobinas(a);
    }
    return;
  }
  if (!a.energizada) {
    escribirBobinas(a);  // Recupera el torque en la fase actual antes de moverse
    a.ultimoPasoUs = ahoraUs;
    return;
  }
  if (ahoraUs - a.ultimoPasoUs < a.intervaloUs) {
    return;
  }
  a.ultimoPasoUs = ahoraUs;

  long siguiente = a.posicion + a.jog;
  const char *limite = limiteDelPaso(a, siguiente);
  if (limite != nullptr) {
    avisarLimite(a.limiteAvisado, limite);
    return;  // El jog sigue "presionado", pero la articulación no se mueve
  }

  a.limiteAvisado = false;
  a.posicion = siguiente;
  int8_t sentidoMotor = a.invertido ? -a.jog : a.jog;
  a.fase = (a.fase + 4 + sentidoMotor) % 4;
  escribirBobinas(a);
}

void actualizarPinza(unsigned long ahoraUs) {
  if (jogPinza == 0 || ahoraUs - ultimoPasoPinzaUs < PINZA_INTERVALO_US) {
    return;
  }
  ultimoPasoPinzaUs = ahoraUs;

  int siguiente = anguloPinza + jogPinza;
  if (siguiente < PINZA_CERRADA || siguiente > PINZA_ABIERTA) {
    avisarLimite(limitePinzaAvisado, "pinza");
    return;
  }
  limitePinzaAvisado = false;
  anguloPinza = siguiente;
  servoPinza.write(anguloPinza);
}

bool brazoActivo() {
  return base.jog != 0 || hombro.jog != 0 || codo.jog != 0 || jogPinza != 0;
}

// ----------------------------------------------------------------------------
//  Primitivas de movimiento
// ----------------------------------------------------------------------------
void avanzar() {
  fijarObjetivo(VEL_AVANCE + TRIM_IZQ, VEL_AVANCE + TRIM_DER);
}

void retroceder() {
  fijarObjetivo(-(VEL_AVANCE + TRIM_IZQ), -(VEL_AVANCE + TRIM_DER));
}

// Giro sobre el eje: lado izquierdo hacia atrás, lado derecho hacia adelante.
void girarIzquierda() {
  fijarObjetivo(-(VEL_GIRO + TRIM_IZQ), VEL_GIRO + TRIM_DER);
}

// Giro sobre el eje: lado izquierdo hacia adelante, lado derecho hacia atrás.
void girarDerecha() {
  fijarObjetivo(VEL_GIRO + TRIM_IZQ, -(VEL_GIRO + TRIM_DER));
}

// Fija el sentido de jog de una articulación. Solo informa cuando cambia,
// porque la app repite la letra cada 100 ms.
void moverArticulacion(Articulacion &a, int8_t sentido, char letra) {
  if (a.jog != sentido) {
    a.jog = sentido;
    a.limiteAvisado = false;
    Serial.print(F("[BRAZO] "));
    Serial.println(letra);
  }
}

void moverPinza(int8_t sentido, char letra) {
  if (jogPinza != sentido) {
    jogPinza = sentido;
    limitePinzaAvisado = false;
    Serial.print(F("[BRAZO] "));
    Serial.println(letra);
  }
}

void detenerBrazo() {
  base.jog   = 0;
  hombro.jog = 0;
  codo.jog   = 0;
  jogPinza   = 0;
}

// Parada suave (con rampa) de las ruedas; el brazo se queda donde está.
void detener() {
  fijarObjetivo(0, 0);
  detenerBrazo();
}

// Parada inmediata (arranque del sistema y emergencias).
void detenerInmediato() {
  ladoIzq.objetivo = 0;
  ladoIzq.actual   = 0;
  ladoDer.objetivo = 0;
  ladoDer.actual   = 0;
  aplicarSalida(ladoIzq);
  aplicarSalida(ladoDer);
  detenerBrazo();
}

// ----------------------------------------------------------------------------
//  Intérprete de comandos
// ----------------------------------------------------------------------------
void procesarComando(char recibido) {
  char c = (char)toupper((unsigned char)recibido);
  bool esLocomocion = true;

  switch (c) {
    case 'A': avanzar();        break;
    case 'B': retroceder();     break;
    case 'C': girarIzquierda(); break;
    case 'D': girarDerecha();   break;
    case 'S':
    case '0': detener();        break;

    // Brazo: una letra solo mueve su articulación y no toca las ruedas.
    case 'E': moverArticulacion(codo,   +1, c); esLocomocion = false; break;  // SUBIR
    case 'F': moverArticulacion(codo,   -1, c); esLocomocion = false; break;  // BAJAR
    case 'G': moverArticulacion(base,   +1, c); esLocomocion = false; break;  // GIRAR BASE +
    case 'H': moverArticulacion(base,   -1, c); esLocomocion = false; break;  // GIRAR BASE -
    case 'I': moverArticulacion(hombro, -1, c); esLocomocion = false; break;  // ADELANTE
    case 'J': moverArticulacion(hombro, +1, c); esLocomocion = false; break;  // ATRÁS
    case 'K': moverPinza(+1, c);                esLocomocion = false; break;  // ABRIR GRIPPER
    case 'L': moverPinza(-1, c);                esLocomocion = false; break;  // CERRAR GRIPPER
    default:
      return;  // '\r', '\n', espacios o basura: se ignoran sin cambiar estado
  }

  ultimoComandoMs = millis();

  if (esLocomocion && c != comandoActual) {
    comandoActual = c;
    Serial.print(F("[CMD] "));
    Serial.println(c);
  }
}

// ----------------------------------------------------------------------------
//  Setup
// ----------------------------------------------------------------------------
void setup() {
  // Lo primero: dejar el puente H en estado seguro.
  pinMode(PIN_ENA, OUTPUT);
  pinMode(PIN_IN1, OUTPUT);
  pinMode(PIN_IN2, OUTPUT);
  pinMode(PIN_ENB, OUTPUT);
  pinMode(PIN_IN3, OUTPUT);
  pinMode(PIN_IN4, OUTPUT);
  detenerInmediato();

  // Brazo: se asume que arranca en la posición de reposo.
  configurarArticulacion(base, "base", PINES_BASE, INVERTIR_BASE, TORQUE_BASE,
                         BASE_INICIO, BASE_MIN, BASE_MAX,
                         VEL_BASE_GS, REDUCCION_BASE);
  configurarArticulacion(hombro, "hombro", PINES_HOMBRO, INVERTIR_HOMBRO,
                         TORQUE_HOMBRO, HOMBRO_INICIO, HOMBRO_MIN, HOMBRO_MAX,
                         VEL_HOMBRO_GS, REDUCCION_HOMBRO);
  configurarArticulacion(codo, "codo", PINES_CODO, INVERTIR_CODO, TORQUE_CODO,
                         CODO_INICIO, CODO_MIN, CODO_MAX,
                         VEL_CODO_GS, REDUCCION_CODO);
  if (TORQUE_HOMBRO) escribirBobinas(hombro);  // Sostiene el brazo desde el inicio
  if (TORQUE_CODO)   escribirBobinas(codo);

  servoPinza.attach(PIN_SERVO_PINZA);
  servoPinza.write(anguloPinza);

#if USAR_PIN_STATE
  pinMode(PIN_BT_STATE, INPUT);
#endif

  Serial.begin(DEBUG_BAUD);   // USB (depuración)
  Serial1.begin(BT_BAUD);     // HC-05 en RX1 (D19) / TX1 (D18)

  ultimoComandoMs = millis();
  ultimaRampaMs   = millis();

  Serial.println(F("Carrito BT listo. Comandos: A B C D S"));
}

// ----------------------------------------------------------------------------
//  Loop principal (100 % no bloqueante)
// ----------------------------------------------------------------------------
void loop() {
  // 1) Comandos desde Bluetooth
  while (Serial1.available() > 0) {
    procesarComando((char)Serial1.read());
  }

  // 2) Comandos desde el Monitor Serie (pruebas en banco con las ruedas al aire)
  while (Serial.available() > 0) {
    procesarComando((char)Serial.read());
  }

  unsigned long ahora = millis();

  // 3) Seguridad: pérdida del enlace Bluetooth
#if USAR_PIN_STATE
  static bool btConectado = false;
  bool conectado = (digitalRead(PIN_BT_STATE) == HIGH);
  if (conectado != btConectado) {
    btConectado = conectado;
    Serial.println(conectado ? F("[BT] Conectado") : F("[BT] Desconectado"));
  }
  if (!conectado && (hayObjetivo() || brazoActivo())) {
    detener();
    comandoActual = 'S';
  }
#endif

  // 4) Seguridad: tiempo sin comandos (ruedas y brazo)
  if (TIMEOUT_COMANDO_MS > 0 && (hayObjetivo() || brazoActivo()) &&
      (ahora - ultimoComandoMs > TIMEOUT_COMANDO_MS)) {
    detener();
    comandoActual = 'S';
    Serial.println(F("[SEG] Timeout de comando: parada"));
  }

  // 5) Rampa de velocidad
  if (ahora - ultimaRampaMs >= RAMPA_INTERVALO_MS) {
    ultimaRampaMs = ahora;
    actualizarRampa(ladoIzq);
    actualizarRampa(ladoDer);
  }

  // 6) Brazo robótico: un paso por articulación cuando toca, sin delay()
  unsigned long ahoraUs = micros();
  actualizarArticulacion(base,   ahoraUs);
  actualizarArticulacion(hombro, ahoraUs);
  actualizarArticulacion(codo,   ahoraUs);
  actualizarPinza(ahoraUs);
}
