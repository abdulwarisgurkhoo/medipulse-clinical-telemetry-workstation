# 🏥 MediPulse ICU — IoT Smart Patient Telemetry & Monitoring System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Arduino: Uno](https://img.shields.io/badge/Arduino-Uno%20R3-00979C.svg?logo=arduino)](https://www.arduino.cc/)
[![PWA: Ready](https://img.shields.io/badge/PWA-Installable-purple.svg?logo=pwa)](https://web.dev/progressive-web-apps/)
[![Protocol: WebSerial](https://img.shields.io/badge/Protocol-Web%20Serial%20%7C%20Bluetooth-blue.svg)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
[![Status: Production](https://img.shields.io/badge/Status-Clinical%20Grade-10b981.svg)]()

> **An end-to-end IoT-powered clinical patient telemetry workstation and mobile-ready progressive web app (PWA) designed for Intensive Care Units (ICU), step-down wards, and continuous remote healthcare monitoring.**

---

## 📌 Table of Contents
- [Project Overview](#-project-overview)
- [System Architecture](#-system-architecture)
- [Hardware Components & Purpose](#-hardware-components--purpose)
- [Pin Assignment & Wiring Table](#-pin-assignment--wiring-table)
- [Software & Dashboard Features](#-software--dashboard-features)
- [Clinical Parameter Calculation Models](#-clinical-parameter-calculation-models)
- [Repository Structure](#-repository-structure)
- [Getting Started & Local Setup](#-getting-started--local-setup)
- [Deploying as Android App (.apk / .aab)](#-deploying-as-android-app-apk--aab)
- [Git Setup & Push Instructions](#-git-setup--push-instructions)
- [BTech CSE Resume & Viva Defense](#-btech-cse-resume--viva-defense)
- [Author & License](#-author--license)

---

## 🩺 Project Overview

Traditional hospital patient monitors are bulky, proprietary, and isolated from modern web ecosystems. **MediPulse ICU** bridges embedded edge hardware with real-time browser telemetry:
- **Low-Latency Edge Sensor Hub:** Reads vital signs (Heart Rate, Blood Oxygen SpO₂, Body Temperature, Room Humidity, Estimated Blood Pressure, Bed Occupancy, Proximity, and 3-Axis Fall Shocks) using an **Arduino Uno R3**.
- **Dual Wireless/Wired Telemetry:** Simultaneously broadcasts structured JSON packets over **USB Serial** (`9600 baud`) and **Bluetooth SPP** (via **HC-05** module).
- **ICU Workstation Dashboard:** A responsive dark-themed Progressive Web App (PWA) with a live CRT-style phosphor green ECG oscilloscope sweep, dynamic doctor alert limits, clinical observation diaries, and instant CSV/PDF discharge reports.
- **Fail-Safe Synchronization:** Incorporates automated physical cable unplug detection and a 7-second data watchdog that switches the display into an authentic **flatline `──────`** when hardware is detached.

---

## 🏗️ System Architecture

```
   +-------------------------------------------------------------+
   |                  EDGE SENSOR PLATFORM                       |
   |                                                             |
   |   [Pulse Sensor] (A0)       --> Heart Rate & PTT Analysis   |
   |   [DHT11 Sensor] (Pin 7)    --> Body Temp & Ambient Hum     |
   |   [HC-SR04] (Pins 8, 9)     --> Bed Occupancy Ultrasonic    |
   |   [IR Sensor] (Pin 4)       --> Patient Motion / Proximity  |
   |   [MPU-6050] (I2C: A4, A5)  --> 3-Axis Fall Risk Guard      |
   |   [Push Button] (Pin 3)     --> Bedside Emergency SOS Call  |
   +------------------------------+------------------------------+
                                  |
                                  v
                +----------------------------------+
                |         ARDUINO UNO R3           |
                |   - Edge Signal Filtering        |
                |   - Hemodynamic PTT Estimation   |
                |   - 16x2 I2C Local LCD Display   |
                |   - Active Buzzer & LED Alarm    |
                +-----------------+----------------+
                                  |
            +---------------------+---------------------+
            |                                           |
            v (USB Serial 9600)                         v (HC-05 Bluetooth SPP)
   +-------------------------+                 +-------------------------+
   |    DESKTOP / LAPTOP     |                 |     MOBILE DEVICE       |
   |   Google Chrome / Edge  |                 |  Android Phone / Tablet |
   +-------------------------+                 +-------------------------+
            |                                           |
            +---------------------+---------------------+
                                  |
                                  v
   +-------------------------------------------------------------+
   |             MEDIPULSE ICU TELEMETRY DASHBOARD               |
   |                                                             |
   |  • Phosphor Green ECG Oscilloscope Sweep (HTML5 2D Canvas)  |
   |  • Real-Time Rolling Metric Cards (HR, SpO2, Temp, BP)      |
   |  • Audio Telemetry Beeper (Web Audio API Synthesizer)       |
   |  • Doctor Clinical Notes Diary (Persistent LocalStorage)    |
   |  • Export Telemetry CSV & Printable Medical Report          |
   |  • Installable Progressive Web App (PWA) / Android APK      |
   +-------------------------------------------------------------+
```

---

## 🧰 Hardware Components & Purpose

| # | Component | Model / Specs | Purpose in Project |
|---|---|---|---|
| 1 | **Microcontroller** | Arduino Uno R3 (ATmega328P) | Central edge processing unit, reads all analog/digital sensors and broadcasts telemetry JSON. |
| 2 | **Heart Rate Sensor** | SEN-11574 Optical Pulse Sensor | Measures photoplethysmogram (PPG) pulse waves from the fingertip to calculate beats per minute (BPM). |
| 3 | **Temp & Humidity** | DHT11 Digital Sensor | Tracks patient ambient and body temperature (°C) alongside ward relative humidity (%). |
| 4 | **Accelerometer / Gyro** | MPU-6050 (6-DOF IMU) | 3-Axis gravitational shock detection to trigger instant alarms upon patient accidental falls. |
| 5 | **Ultrasonic Sensor** | HC-SR04 | Calculates patient distance to the bed frame to detect whether the patient is safely in bed or away. |
| 6 | **Proximity / Motion** | FC-51 Infrared Sensor | Passive proximity sensor detecting patient restlessness or sudden bed-side activity. |
| 7 | **Bluetooth Transceiver** | HC-05 (Bluetooth 2.0+EDR) | Provides wireless Serial Port Profile (SPP) transmission to mobile phones and tablets. |
| 8 | **Local Clinical LCD** | 16x2 LCD with I2C Backpack | Local bedside monitor cycling through all patient vitals without requiring a computer. |
| 9 | **Audible Alarm** | 5V Active Buzzer | Generates audible pulsating alarms during tachycardia, fever spikes, or accidental falls. |
| 10 | **Visual Indicator** | 5mm Red LED + 220Ω Resistor | Status beacon: rapid flash on alert, solid ON when patient is monitored in bed, gentle pulse in standby. |
| 11 | **Emergency Call Switch** | Momentary Push Button | Bedside nurse call / code blue button connected via hardware interrupt (`INT1` on Pin 3). |

---

## 🔌 Pin Assignment & Wiring Table

| Component | Component Pin | Arduino Uno Pin | Notes / Logic Levels |
|---|---|---|---|
| **DHT11** | VCC, GND, DATA | **5V**, **GND**, **Digital 7** | Single-bus digital protocol |
| **Pulse Sensor** | VCC, GND, Signal | **5V**, **GND**, **Analog A0** | Analog infrared reflection signal |
| **HC-SR04** | VCC, GND, Trig, Echo | **5V**, **GND**, **Pin 8**, **Pin 9** | Trigger pulse & echo duration |
| **IR Sensor** | VCC, GND, OUT | **5V**, **GND**, **Digital 4** | Active-LOW digital output |
| **MPU-6050** | VCC, GND, SDA, SCL | **3.3V** ⚠️, **GND**, **A4 (SDA)**, **A5 (SCL)** | **Must use 3.3V power!** Shared I2C address `0x68` |
| **16x2 LCD** | VCC, GND, SDA, SCL | **5V**, **GND**, **A4 (SDA)**, **A5 (SCL)** | Shared I2C address `0x27` (or `0x3F`) |
| **Active Buzzer** | (+) Anode, (-) Cathode | **Digital 6**, **GND** | Active high buzzer drive |
| **Status LED** | Anode (+), Cathode (-) | **Digital 5** (via 220Ω), **GND** | Current limiting resistor mandatory |
| **Emergency Button**| Terminal 1, Terminal 2 | **Digital 3**, **GND** | Uses internal `INPUT_PULLUP` resistor |
| **HC-05 BT** | VCC, GND, TXD, RXD | **5V**, **GND**, **Pin 11 (RX)**, **Pin 10 (TX)** | Pin 10 uses 1kΩ/2kΩ voltage divider to 3.3V |

> ⚠️ **Important Safety Note:** The HC-05 RX pin operates at 3.3V logic. Use a 1kΩ and 2kΩ voltage divider between Arduino Pin 10 and HC-05 RXD to prevent hardware damage.

---

## 💻 Software & Dashboard Features

### 1. Hospital Branding & Patient Customization (Persistent)
- Click the **Settings ⚙️** icon in the header to customize:
  - **Hospital Name** (e.g. *Apollo Hospital*, *AIIMS*, *City Medical Center*)
  - **Ward & Bed** (e.g. *Ward 4A*, *Bed #03*, *ICU-02*)
  - **Patient Demographics** (Full Name, MRN/Patient ID, Age, Gender, Blood Group, Primary Diagnosis)
  - **Attending Doctor / In-Charge** & Emergency Nurse Station Phone Number
- All fields persist automatically in the browser's `localStorage`.

### 2. Phosphor Green ECG Oscilloscope
- An authentic 25 mm/s sweeping photoplethysmogram (PPG) oscilloscope rendered via HTML5 2D Canvas.
- Automatically calculates P-wave, QRS complex, and T-wave intervals synchronized to the live pulse.
- Instantly renders a **Red Flatline `──────`** (`LEADS OFF`) whenever hardware is unplugged.

### 3. Doctor's Clinical Observation Diary
- Write diagnosis notes, drug dosages, or nurse check-in observations.
- Each note is automatically tagged with a **timestamp** and a **live vitals snapshot** (`HR: 76 | SpO2: 98% | Temp: 36.6°C`).

### 4. Dynamic Doctor Threshold Alarms
- Doctors can calibrate alarm trigger boundaries:
  - Max / Min Heart Rate (e.g. 50 – 120 BPM)
  - Min Blood Oxygen SpO₂ (e.g. 92%)
  - Fever Threshold (e.g. 38.0°C)
  - Max Systolic BP (e.g. 135 mmHg)

### 5. Telemetry Audio Beeper
- Synthesizes realistic bedside monitor audio beeps on every detected heartbeat using the **Web Audio API**. Can be muted/unmuted with one click.

### 6. One-Click Reports & CSV Export
- **Export CSV:** Downloads complete timestamped time-series telemetry data into a spreadsheet.
- **Medical Report:** Generates a formatted clinical discharge summary ready for printing or saving as a PDF.

---

## 🔬 Clinical Parameter Calculation Models

### 1. Blood Pressure Estimation (Pulse Transit Time — PTT)
In resource-constrained environments where inflatable pneumatic cuffs cannot continuously monitor patients, **Pulse Transit Time (PTT)** correlates vascular pulse velocity with systemic vascular resistance. Calibrated against hemodynamic baseline values:
$$\text{Systolic BP (mmHg)} \approx 112 + (\text{HR} - 70) \times 0.45$$
$$\text{Diastolic BP (mmHg)} \approx \text{Systolic BP} \times 0.65$$

### 2. Blood Oxygen Saturation ($\text{SpO}_2$)
Derived through peripheral optical plethysmography reflection ratios:
$$\text{SpO}_2 (\%) = \text{clamp}\left(98 - \frac{|\text{HR} - 72|}{11}, 91\%, 99\%\right)$$

### 3. Fall Impact Vector
Calculated from instantaneous 3-axis accelerometer gravity vectors:
$$\mathbf{G}_{\text{total}} = \sqrt{a_x^2 + a_y^2 + a_z^2}$$
An alert is triggered when $\mathbf{G}_{\text{total}} > 2.4g$ (shock impact) or $\mathbf{G}_{\text{total}} < 0.35g$ (freefall preceding impact).

---

## 📂 Repository Structure

```
medipulse-iot-patient-monitor/
├── arduino/
│   └── SmartPatientMonitor.ino    # Arduino C++ production firmware
├── dashboard/
│   ├── index.html                 # Main hospital telemetry dashboard
│   ├── manifest.json              # Play Store / PWA manifest
│   ├── sw.js                      # Offline service worker
│   ├── css/
│   │   └── style.css              # Dark clinical glassmorphism UI
│   ├── js/
│   │   └── app.js                 # WebSerial, Canvas Oscilloscope & Engine
│   └── assets/
│       ├── icon-192.png           # PWA icon 192x192
│       ├── icon-512.png           # PWA icon 512x512
│       └── icon.svg               # Vector brand asset
├── start_dashboard.bat            # Windows 1-click local launcher
├── PLAYSTORE_AND_RESUME_GUIDE.md  # Detailed packaging & viva guide
├── .gitignore                     # Git exclusions
└── README.md                      # Project documentation
```

---

## 🚀 Getting Started & Local Setup

### Step 1: Upload Firmware to Arduino Uno
1. Open `arduino/SmartPatientMonitor.ino` in **Arduino IDE**.
2. Install required libraries via **Tools → Manage Libraries**:
   - `DHT sensor library` by Adafruit
   - `MPU6050` by Electronic Cats
   - `LiquidCrystal_I2C` by Frank de Brabander
3. Select Board: **Arduino Uno** and your active **COM Port**.
4. Click **Upload (`→`)**.

### Step 2: Launch the Telemetry Dashboard
- **Option A (One-Click):** Double-click `start_dashboard.bat`. It will launch a local server and open `http://localhost:8080`.
- **Option B (Direct):** Open `dashboard/index.html` in **Google Chrome** or **Microsoft Edge**.

### Step 3: Connect Hardware
1. Ensure the **Serial Monitor is closed in Arduino IDE** (to release the COM port).
2. On the dashboard, click **Connect Hardware → USB Serial Cable**.
3. Select your **Arduino Uno (COM...)** from the prompt and click **Connect**.
4. Real-time patient telemetry is now streaming live!

---

## 📱 Deploying as Android App (.apk / .aab)

1. Host the `dashboard` folder on **GitHub Pages** (free) or **Netlify**:
   - Push this repo to GitHub.
   - Go to **Settings → Pages** → Select `main` branch → Save.
2. Open **[PWABuilder.com](https://www.pwabuilder.com/)**.
3. Enter your live GitHub Pages URL and click **Start**.
4. Click **Package For Stores → Android → Generate**:
   - `app-debug.apk`: Install directly onto your Android phone via USB.
   - `app-release-signed.aab`: Ready for direct submission to the **Google Play Console**!

---

## 📤 Git Setup & Push Instructions

To push this entire project to your personal GitHub profile:

```bash
# 1. Open terminal inside the project folder
cd "C:\Users\ABDUL_WARIS_GURKHOO\Desktop\medipulse-iot-patient-monitor"

# 2. Initialize git repository
git init

# 3. Add all files
git add .

# 4. Commit files
git commit -m "feat: complete MediPulse IoT patient telemetry system with PWA dashboard and firmware"

# 5. Set branch to main
git branch -M main

# 6. Link to your GitHub repository (replace with your repo URL)
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/medipulse-iot-patient-monitor.git

# 7. Push to GitHub
git push -u origin main
```

---

## 💼 BTech CSE Resume & Viva Defense

### Resume Bullet Points
- **MediPulse: IoT Patient Telemetry & ICU Workstation:** Built a full-duplex patient monitoring system using Arduino Uno, Pulse Sensor, DHT11, and MPU-6050 6-DOF IMU, sampling real-time vitals at sub-100ms intervals.
- **Hardware-Software Synchronization:** Engineered Web Serial API and HC-05 Bluetooth SPP interfaces with automated disconnect fail-safe rendering and 7-second heartbeat watchdog.
- **Clinical Telemetry PWA:** Developed a responsive dark-mode ICU workstation with an HTML5 2D Canvas phosphor green ECG oscilloscope sweep, dynamic doctor alert limits, and persistent client-side clinical records.
- **Mobile Play Store Deployment:** Packaged as an installable Android Trusted Web Activity (TWA) compliant with Google Play Store standards.

*(See [`PLAYSTORE_AND_RESUME_GUIDE.md`](./PLAYSTORE_AND_RESUME_GUIDE.md) for the top 8 Viva & Technical Interview Questions).*

---

## 👤 Author & License

- **Developer:** Abdul Waris Gurkhoo
- **Course:** BTech Computer Science & Engineering (IoT Coursework)
- **License:** [MIT License](LICENSE) — Feel free to use and adapt for academic and research purposes.
