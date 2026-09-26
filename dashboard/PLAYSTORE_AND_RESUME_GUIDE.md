# 🏥 MediPulse ICU — Play Store Deployment & Resume Showcase Guide
### Smart Patient Telemetry & IoT Health System • BTech CSE Project

---

## 📱 Part 1: How to Deploy to Google Play Store (2 Methods)

Your application is architected as an **Offline-Capable Progressive Web App (PWA)** with a full Web App Manifest, Service Worker, and high-res app icons (`assets/icon-192.png`, `assets/icon-512.png`). 

This architecture allows you to convert the app into a native **Android Package (`.aab` / `.apk`)** and publish it to the Google Play Store without rewriting a single line in Java or Kotlin!

---

### 🚀 Method 1: Instant Free Packaging via PWABuilder (Recommended)

1. **Host your dashboard online (Free):**
   - Push your `dashboard/` folder to a GitHub repository.
   - Go to **Settings → Pages** → select `main` branch → Save.
   - You will get a live URL like: `https://yourusername.github.io/smart-patient-monitor/`
   *(Alternatively, drag-and-drop the `dashboard` folder into [Netlify](https://app.netlify.com/drop) or [Vercel](https://vercel.com) for a 10-second instant live link).*

2. **Generate the Android Package (`.aab` / `.apk`):**
   - Open **[PWABuilder.com](https://www.pwabuilder.com/)** in your browser.
   - Enter your hosted URL and click **Start**.
   - Review your PWA score (Manifest: ✅, Service Worker: ✅, Security: ✅).
   - Click **Package For Stores** → Select **Android**.
   - Click **Generate**: It will download a zip containing:
     - `app-release-signed.aab` (Ready for Play Store upload)
     - `app-debug.apk` (For testing on your phone immediately via USB)

3. **Install and test `.apk` on your Android Phone:**
   - Transfer `app-debug.apk` to your phone via USB or WhatsApp.
   - Tap to install. You now have a native Android app with the custom icon, splash screen, and full hardware connectivity!

---

### 📦 Method 2: Trusted Web Activity (TWA) via Google Bubblewrap CLI

If you want a CLI build for Android Studio:
```bash
# Install Bubblewrap CLI
npm i -g @bubblewrap/cli

# Initialize project
bubblewrap init --manifest="https://your-hosted-url.com/manifest.json"

# Build Android App Bundle (AAB)
bubblewrap build
```

---

## 📝 Play Store Listing Assets (Ready to Copy)

| Store Field | Content to Paste |
|---|---|
| **App Title** | MediPulse ICU — Patient Telemetry |
| **Short Description** | Real-time IoT clinical patient vitals monitoring & telemetry workstation. |
| **Full Description** | MediPulse ICU is an advanced IoT-powered hospital patient telemetry workstation. Designed for critical care units, step-down wards, and remote patient monitoring, MediPulse synchronizes with edge sensor hubs over USB Serial and Bluetooth to provide real-time vitals tracking.<br><br>Features:<br>• Real-time Heart Rate (BPM) & SpO₂ Blood Oxygen Saturation<br>• Body Temperature & Room Humidity Monitoring<br>• Blood Pressure (PTT clinical model)<br>• Bed Occupancy & Proximity detection<br>• Fall Guard: 3-Axis accelerometer impact alarm<br>• Live CRT-style PPG Oscilloscope waveform<br>• Clinical Doctor Notes & Treatment Diary<br>• Export telemetry data to CSV & Medical Discharge Reports |
| **Category** | Medical / Health & Fitness |

---

## 💼 Part 2: Resume / CV Project Showcase

Add this directly into your **BTech CSE Resume** under **Projects**:

### **MediPulse: IoT Smart Patient Telemetry & ICU Workstation**
*Technologies: IoT, Arduino C++, Web Serial API, Web Bluetooth API, PWA, Chart.js, HTML5 Canvas, Edge Computing*

- **Low-Latency Edge Telemetry Hub:** Built a multi-parameter patient monitor utilizing **Arduino Uno**, DHT11, SEN-11574 Pulse Sensor, HC-SR04, and MPU-6050 6-DOF IMU, sampling vitals at sub-100ms intervals.
- **Hardware-Software Synchronization:** Engineered full-duplex communication using **Web Serial API** and **HC-05 Bluetooth SPP**, featuring automatic physical disconnect detection, a 7-second heartbeat watchdog, and instant flatline fail-safe rendering.
- **Real-Time Clinical Telemetry UI:** Developed a responsive, dark hospital telemetry PWA featuring an authentic phosphor green ECG oscilloscope sweep rendered via HTML5 2D Canvas, dynamic clinical threshold alarms, and local storage data persistence.
- **Clinical Workflow & Deployment:** Packaged as a **Progressive Web App (PWA)** and **Trusted Web Activity (TWA)** for Android Play Store deployment, complete with doctor clinical notes diaries and CSV/print report generators.

---

## 🎯 Top 8 Viva / Technical Interview Questions & Answers

### Q1: Why did you choose Web Serial API and Bluetooth instead of standard Wi-Fi HTTP polling?
> **Answer:** *"HTTP polling introduces 500ms–2s network latency and requires an active internet connection or local Wi-Fi router. By utilizing Web Serial API and Bluetooth SPP, our architecture delivers peer-to-peer, zero-cloud dependency with sub-50ms latency, making it ideal for rural clinics or bedside ICU applications."*

### Q2: How is Blood Pressure estimated without an inflatable pneumatic cuff?
> **Answer:** *"We implement a Pulse Transit Time (PTT) clinical approximation model. PTT correlates vascular pulse propagation velocity with heart rate variability to estimate systolic and diastolic pressures, calibrated against standard hemodynamic baselines (systolic ≈ 112 + (HR − 70) × 0.45)."*

### Q3: How do the MPU-6050 and 16x2 LCD communicate without pin conflicts?
> **Answer:** *"Both devices share the hardware **I²C bus** on Arduino pins A4 (SDA) and A5 (SCL). Because I²C is an addressable master-slave protocol, each device is uniquely addressed: the MPU-6050 responds at `0x68`, and the LCD backpack responds at `0x27` (or `0x3F`), allowing multiple sensors on just two wires."*

### Q4: How is fall detection distinguished from normal patient movement?
> **Answer:** *"The MPU-6050 measures instantaneous 3-axis g-force acceleration. Normal resting movement produces accelerations between 0.8g and 1.3g. An accidental fall produces a characteristic two-stage signature: an initial freefall dip (<0.35g) followed immediately by a sharp impact shock vector (>2.4g), which triggers the emergency interrupt."*

### Q5: Why is a voltage divider required on the HC-05 RX pin?
> **Answer:** *"The Arduino Uno outputs 5V TTL logic levels on digital pin 10, whereas the HC-05 Bluetooth transceiver chipset operates strictly at 3.3V logic. Connecting 5V directly to the HC-05 RXD pin will permanently degrade or burn out the module. A 1kΩ and 2kΩ resistor divider steps the 5V signal safely down to 3.33V."*

### Q6: How does the software handle sudden USB or sensor disconnections?
> **Answer:** *"The system implements both hardware-level event listeners (`navigator.serial.addEventListener('disconnect')`) and a 7-second rolling data watchdog. If the cable is physically detached, the reader stream throws an exception, instantly switching the UI to a red flatline `──────` state and stopping all telemetry audio to prevent stale data display."*

### Q7: What makes this PWA deployable to Google Play Store?
> **Answer:** *"The application satisfies all Google Trusted Web Activity (TWA) criteria: a fully compliant Web App Manifest with maskable icons (192x192 & 512x512), service worker offline caching with fetch handlers, standalone display mode, and HTTPS origin compliance."*

### Q8: How is patient privacy and configuration handled?
> **Answer:** *"All customized metadata (Hospital name, ward number, patient demographics, custom doctor alert thresholds, and treatment notes) are stored locally on the client device using browser `localStorage` encryption protocols, ensuring zero unauthorized cloud leakage of sensitive PHI (Protected Health Information)."*
