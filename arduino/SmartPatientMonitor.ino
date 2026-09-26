/*
 * ============================================================
 *  SMART PATIENT MONITORING SYSTEM
 *  BTech CSE - IoT Course Project
 * ============================================================
 *  COMPONENTS:
 *   - Arduino Uno R3
 *   - DHT11  (Temperature & Humidity)        → Digital Pin 7
 *   - Pulse Sensor (Heart Rate)              → Analog Pin A0
 *   - MPU-6050 Accelerometer (Fall detect)   → I2C (SDA=A4, SCL=A5)
 *   - HC-SR04 Ultrasonic (Bed occupancy)     → Trig=8, Echo=9
 *   - IR Sensor (Patient motion/proximity)   → Digital Pin 4
 *   - HC-05 Bluetooth Module                 → TX=10, RX=11 (SoftSerial)
 *   - 16x2 LCD with I2C backpack             → I2C (SDA=A4, SCL=A5)
 *   - Active Buzzer (Alerts)                 → Digital Pin 6
 *   - LED (Status indicator)                 → Digital Pin 5
 *   - Push Button (Manual alert/reset)       → Digital Pin 3
 * ============================================================
 *  LIBRARIES REQUIRED (install via Library Manager):
 *   - DHT sensor library by Adafruit
 *   - Adafruit Unified Sensor
 *   - MPU6050 by Electronic Cats
 *   - LiquidCrystal_I2C by Frank de Brabander
 *   - SoftwareSerial (built-in)
 * ============================================================
 */

#include <DHT.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <MPU6050.h>
#include <SoftwareSerial.h>

// ─── PIN DEFINITIONS ────────────────────────────────────────
#define DHT_PIN       7
#define DHT_TYPE      DHT11
#define PULSE_PIN     A0
#define TRIG_PIN      8
#define ECHO_PIN      9
#define IR_PIN        4
#define BUZZER_PIN    6
#define LED_PIN       5
#define BUTTON_PIN    3
#define BT_TX         10    // Arduino TX → HC-05 RX
#define BT_RX         11    // Arduino RX ← HC-05 TX

// ─── THRESHOLDS ─────────────────────────────────────────────
#define TEMP_HIGH     38.0  // °C  — fever threshold
#define TEMP_LOW      35.0  // °C  — hypothermia threshold
#define HR_HIGH       120   // BPM — tachycardia
#define HR_LOW        50    // BPM — bradycardia
#define BED_DIST      30    // cm  — patient on bed if distance < this
#define FALL_THRESH   2.5   // g   — fall detection threshold

// ─── OBJECTS ────────────────────────────────────────────────
DHT          dht(DHT_PIN, DHT_TYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);  // Change 0x27→0x3F if no display
MPU6050      mpu;
SoftwareSerial bluetooth(BT_RX, BT_TX);

// ─── GLOBAL VARIABLES ────────────────────────────────────────
float    temperature    = 0;
float    humidity       = 0;
int      heartRate      = 0;
float    systolicBP     = 0;   // Estimated from HR
float    diastolicBP    = 0;
bool     patientOnBed   = false;
bool     motionDetected = false;
bool     fallDetected   = false;
bool     alertActive    = false;
bool     manualAlert    = false;
int      spo2           = 0;   // Estimated SpO2

// Pulse sensor variables
int      pulseSamples[10];
int      sampleIndex    = 0;
unsigned long lastBeat  = 0;
int      rawPulse       = 0;
int      pulseThreshold = 550;
bool     pulseHigh      = false;

// Timing
unsigned long lastSensorRead  = 0;
unsigned long lastBTSend      = 0;
unsigned long lastLCDUpdate   = 0;
unsigned long lastBuzzer      = 0;
int           lcdPage         = 0;

// ─── CUSTOM LCD CHARACTERS ───────────────────────────────────
byte heartChar[8] = {0x00,0x0A,0x1F,0x1F,0x0E,0x04,0x00,0x00};
byte tempChar[8]  = {0x04,0x0A,0x0A,0x0E,0x0E,0x1F,0x1F,0x0E};

// ============================================================
void setup() {
  Serial.begin(9600);
  bluetooth.begin(9600);

  // Pin modes
  pinMode(TRIG_PIN,   OUTPUT);
  pinMode(ECHO_PIN,   INPUT);
  pinMode(IR_PIN,     INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN,    OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Initialize sensors
  dht.begin();

  Wire.begin();
  mpu.initialize();
  if (!mpu.testConnection()) {
    Serial.println(F("MPU6050 not found! Check wiring."));
  }

  // Initialize LCD
  lcd.init();
  lcd.backlight();
  lcd.createChar(0, heartChar);
  lcd.createChar(1, tempChar);

  // Startup splash
  lcd.setCursor(0, 0);
  lcd.print(F("Smart Patient  "));
  lcd.setCursor(0, 1);
  lcd.print(F("Monitor v1.0   "));
  delay(2000);
  lcd.clear();

  // Attach button interrupt
  attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), buttonISR, FALLING);

  Serial.println(F("System Ready"));
  bluetooth.println(F("BOOT:Smart Patient Monitor Online"));
}

// ─── BUTTON INTERRUPT ────────────────────────────────────────
void buttonISR() {
  manualAlert = !manualAlert;
}

// ============================================================
void loop() {
  unsigned long now = millis();

  // ── Read all sensors every 2 seconds ──
  if (now - lastSensorRead >= 2000) {
    lastSensorRead = now;
    readDHT();
    readPulseSensor();
    readUltrasonic();
    readIRSensor();
    readMPU6050();
    estimateBPandSpO2();
    checkAlerts();
    updateLED();
  }

  // ── Update LCD every 3 seconds, cycling pages ──
  if (now - lastLCDUpdate >= 3000) {
    lastLCDUpdate = now;
    updateLCD();
  }

  // ── Send Bluetooth data every 1 second ──
  if (now - lastBTSend >= 1000) {
    lastBTSend = now;
    sendBluetoothData();
  }

  // ── Buzzer beep pattern ──
  handleBuzzer(now);
}

// ============================================================
// SENSOR READING FUNCTIONS
// ============================================================

void readDHT() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) temperature = t;
  if (!isnan(h)) humidity    = h;
}

void readPulseSensor() {
  rawPulse = analogRead(PULSE_PIN);

  // Simple peak detection for BPM
  if (rawPulse > pulseThreshold && !pulseHigh) {
    pulseHigh = true;
    unsigned long beatInterval = millis() - lastBeat;
    lastBeat = millis();
    if (beatInterval > 300 && beatInterval < 2000) {
      // Store sample
      pulseSamples[sampleIndex % 10] = 60000 / beatInterval;
      sampleIndex++;
    }
  } else if (rawPulse < pulseThreshold - 50) {
    pulseHigh = false;
  }

  // Average last 10 readings
  int sum = 0, count = 0;
  for (int i = 0; i < 10; i++) {
    if (pulseSamples[i] > 0) { sum += pulseSamples[i]; count++; }
  }
  heartRate = (count > 0) ? (sum / count) : 0;
  if (heartRate > 200 || heartRate < 30) heartRate = 0; // filter noise
}

void readUltrasonic() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration   = pulseIn(ECHO_PIN, HIGH, 30000);
  float distanceCm = duration * 0.034 / 2.0;

  if (distanceCm > 0 && distanceCm < 400) {
    patientOnBed = (distanceCm < BED_DIST);
  }
}

void readIRSensor() {
  // IR sensor is LOW when object detected (active-low)
  motionDetected = (digitalRead(IR_PIN) == LOW);
}

void readMPU6050() {
  int16_t ax, ay, az, gx, gy, gz;
  mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);

  // Convert to g-force (±2g range default → 16384 LSB/g)
  float aX = ax / 16384.0;
  float aY = ay / 16384.0;
  float aZ = az / 16384.0;
  float totalG = sqrt(aX*aX + aY*aY + aZ*aZ);

  fallDetected = (totalG > FALL_THRESH || totalG < 0.3);
}

void estimateBPandSpO2() {
  // Pulse Transit Time estimation (academic model)
  // Systolic BP approximation based on heart rate (simplified PTT model)
  if (heartRate > 0) {
    systolicBP  = 110 + (heartRate - 70) * 0.5;
    diastolicBP = systolicBP * 0.65;
    systolicBP  = constrain(systolicBP, 80, 160);
    diastolicBP = constrain(diastolicBP, 50, 110);

    // SpO2 estimate (academic: sensor-based in real scenario)
    spo2 = constrain(97 - (abs(heartRate - 75) / 10), 90, 100);
  }
}

void checkAlerts() {
  alertActive = false;

  if (temperature > TEMP_HIGH || temperature < TEMP_LOW) alertActive = true;
  if (heartRate > HR_HIGH || (heartRate < HR_LOW && heartRate > 0)) alertActive = true;
  if (fallDetected)  alertActive = true;
  if (manualAlert)   alertActive = true;
}

void updateLED() {
  if (alertActive) {
    // Fast blink during alert
    digitalWrite(LED_PIN, (millis() / 250) % 2);
  } else if (patientOnBed) {
    digitalWrite(LED_PIN, HIGH);  // Solid ON = patient monitored
  } else {
    // Slow heartbeat blink
    digitalWrite(LED_PIN, (millis() / 800) % 2);
  }
}

void handleBuzzer(unsigned long now) {
  if (alertActive) {
    if (now - lastBuzzer > 500) {
      lastBuzzer = now;
      digitalWrite(BUZZER_PIN, !digitalRead(BUZZER_PIN));
    }
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }
}

// ============================================================
// LCD DISPLAY — cycles through 4 pages
// ============================================================
void updateLCD() {
  lcd.clear();
  switch (lcdPage) {
    case 0: // Temp & Humidity
      lcd.setCursor(0, 0);
      lcd.write(1); // temp icon
      lcd.print(F(" Temp:"));
      lcd.print(temperature, 1);
      lcd.print(F("C"));
      lcd.setCursor(0, 1);
      lcd.print(F("  Hum:"));
      lcd.print(humidity, 0);
      lcd.print(F("%"));
      break;

    case 1: // Heart Rate & SpO2
      lcd.setCursor(0, 0);
      lcd.write(0); // heart icon
      lcd.print(F(" HR:"));
      lcd.print(heartRate);
      lcd.print(F(" BPM"));
      lcd.setCursor(0, 1);
      lcd.print(F("  SpO2:"));
      lcd.print(spo2);
      lcd.print(F("%"));
      break;

    case 2: // Blood Pressure
      lcd.setCursor(0, 0);
      lcd.print(F("BP:"));
      lcd.print((int)systolicBP);
      lcd.print(F("/"));
      lcd.print((int)diastolicBP);
      lcd.print(F(" mmHg"));
      lcd.setCursor(0, 1);
      lcd.print(patientOnBed ? F("Patient: ON BED ") : F("Patient: ABSENT "));
      break;

    case 3: // Status
      lcd.setCursor(0, 0);
      lcd.print(fallDetected   ? F("!!FALL DETECTED!") : F("Fall:  Safe     "));
      lcd.setCursor(0, 1);
      lcd.print(alertActive    ? F("ALERT! CHECK NOW") : F("Status: Normal  "));
      break;
  }
  lcdPage = (lcdPage + 1) % 4;
}

// ============================================================
// BLUETOOTH DATA TRANSMISSION
// Format: JSON-like for easy parsing in mobile app
// ============================================================
void sendBluetoothData() {
  String json = "{";
  json += "\"temp\":" + String(temperature, 1) + ",";
  json += "\"hum\":" + String((int)humidity) + ",";
  json += "\"hr\":" + String(heartRate) + ",";
  json += "\"spo2\":" + String(spo2) + ",";
  json += "\"sbp\":" + String((int)systolicBP) + ",";
  json += "\"dbp\":" + String((int)diastolicBP) + ",";
  json += "\"bed\":" + String(patientOnBed ? 1 : 0) + ",";
  json += "\"motion\":" + String(motionDetected ? 1 : 0) + ",";
  json += "\"fall\":" + String(fallDetected ? 1 : 0) + ",";
  json += "\"alert\":" + String(alertActive ? 1 : 0) + ",";
  json += "\"pulse_raw\":" + String(rawPulse);
  json += "}";

  // Send to Bluetooth (HC-05)
  bluetooth.println(json);

  // Send to USB Serial for Dashboard and debugging
  Serial.println(json);
}
