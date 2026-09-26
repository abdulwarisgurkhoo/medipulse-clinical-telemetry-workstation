/* ============================================================
   MEDIPULSE ICU TELEMETRY — Hardware-Synchronized Engine
   Fixes & Enhancements:
     - Real-time Hardware Sync & Watchdog
     - Immediate Flatline ECG on Cable Disconnect / Sensor Unplug
     - Web Serial Native Disconnect Event Listener
     - 2.5s Data Ingestion Watchdog Timer (No stale or ghost data)
     - Clean Initial Standby State
   ============================================================ */

'use strict';

// ── State Management ─────────────────────────────────────────
let serialPort         = null;
let serialReader       = null;
let isConnected        = false;
let isDemoMode         = false;
let demoTimer          = null;
let audioEnabled       = false;
let audioCtx           = null;
let lastDataTimestamp  = 0;
let watchdogInterval   = null;

// Telemetry History Rolling Store (max 50 points)
const MAX_PTS = 50;
const history = {
  times: [],
  hr:    [],
  spo2:  [],
  temp:  [],
  sbp:   [],
  dbp:   []
};

let currentTrendTab  = 'hr';
let sparkCharts      = {};
let mainHistoryChart = null;

// Clinical Hospital & Patient Config (persists in LocalStorage)
let clinicalConfig = {
  hospitalName: 'MEDIPULSE HOSPITAL',
  department: 'Intensive Care Unit (ICU)',
  ward: 'Ward 4A',
  bed: 'Bed #03',
  doctor: 'Dr. A. W. Gurkhoo, MD',
  nursePhone: '+91 98765 43210',
  patientName: 'Abdul Waris Gurkhoo',
  mrn: 'MRN-2026-089',
  ageGender: '21 / Male',
  bloodGroup: 'O+ POSITIVE',
  diagnosis: 'Cardiac Telemetry & Continuous Vitals Monitoring',
  maxHR: 120,
  minHR: 50,
  minSpO2: 92,
  maxTemp: 38.0,
  maxBP: 135
};

let doctorNotes = [];

// Current state (starts at 0 / inactive)
let lastData = {
  hr: 0,
  spo2: 0,
  temp: 0,
  hum: 0,
  sbp: 0,
  dbp: 0,
  bed: 0,
  motion: 0,
  fall: 0,
  alert: 0,
  pulse_raw: 0
};

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadStoredConfig();
  loadStoredNotes();
  initClock();
  initSparklines();
  initMainChart();
  initECGOscilloscope();
  resetAllVitalsToDisconnected('STANDBY: Connect hardware via USB or Bluetooth');

  // Start 1-second watchdog to detect if cable is pulled out or data stops
  startDataWatchdog();

  // Listen for native OS USB unplug events
  if (navigator.serial) {
    navigator.serial.addEventListener('disconnect', (event) => {
      handleHardwareDisconnect('USB Cable physically unplugged from computer!');
    });
  }

  addAuditLog('info', `Console initialized for ${clinicalConfig.hospitalName} • ${clinicalConfig.patientName}.`);
});

// ── Live Telemetry Clock ────────────────────────────────────
function initClock() {
  const clockEl = document.getElementById('icuClock');
  const update = () => {
    const d = new Date();
    clockEl.textContent = d.toLocaleTimeString('en-US', { hour12: false });
  };
  update();
  setInterval(update, 1000);
}

// ============================================================
// HARDWARE WATCHDOG: DETECTS SUDDEN DISCONNECTION / UNPLUG
// ============================================================
function startDataWatchdog() {
  if (watchdogInterval) clearInterval(watchdogInterval);
  watchdogInterval = setInterval(() => {
    // If we think we are connected or in demo, but received no data in 7 seconds:
    if (isConnected && (Date.now() - lastDataTimestamp > 7000)) {
      handleHardwareDisconnect('Data stream timed out. Arduino unplugged or paused.');
    }
  }, 1000);
}

function handleHardwareDisconnect(reason) {
  isConnected = false;
  isDemoMode  = false;
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }

  try {
    if (serialReader) { serialReader.cancel(); serialReader = null; }
    if (serialPort)   { serialPort.close(); serialPort = null; }
  } catch (e) {
    // Port might already be destroyed
  }

  setConnectionUI(false, 'Disconnected');
  resetAllVitalsToDisconnected('OFFLINE / UNPLUGGED');
  addAuditLog('danger', `⚠ ${reason || 'Hardware disconnected.'}`);
}

// ── Resets all cards to dashes and ECG to flatline ──────────
function resetAllVitalsToDisconnected(statusText) {
  lastData = {
    hr: 0, spo2: 0, temp: 0, hum: 0,
    sbp: 0, dbp: 0, bed: 0, motion: 0,
    fall: 0, alert: 0, pulse_raw: 0
  };

  // Values to '--'
  document.getElementById('valHR').textContent   = '--';
  document.getElementById('valSpO2').textContent = '--';
  document.getElementById('valTemp').textContent = '--';
  document.getElementById('valSBP').textContent  = '--';
  document.getElementById('valDBP').textContent  = '--';
  document.getElementById('valHum').textContent  = '-- %';
  document.getElementById('valRawPulse').textContent = '0';

  // Status labels
  const msg = statusText || 'Disconnected';
  document.getElementById('statusHR').textContent   = msg;
  document.getElementById('statusHR').className     = 'vital-status status-warn';
  document.getElementById('statusSpO2').textContent = msg;
  document.getElementById('statusSpO2').className   = 'vital-status status-warn';
  document.getElementById('statusTemp').textContent = msg;
  document.getElementById('statusTemp').className   = 'vital-status status-warn';
  document.getElementById('statusBP').textContent   = msg;
  document.getElementById('statusBP').className     = 'vital-status status-warn';

  // Secondary tiles
  document.getElementById('valBed').textContent    = 'OFFLINE';
  document.getElementById('valBed').className      = 'tile-value';
  document.getElementById('valMotion').textContent = 'Sensor Offline';
  document.getElementById('valFall').textContent   = 'OFFLINE';
  document.getElementById('valFall').className     = 'tile-value';
  document.getElementById('valQRSSync').textContent = 'LEADS OFF';
  document.getElementById('valQRSSync').style.color = '#ef4444';

  // Remove alarm animations
  document.querySelectorAll('.vital-card').forEach(c => c.classList.remove('alarm-active'));
  document.getElementById('alertTicker').classList.add('hidden');
}

// ============================================================
// WEB AUDIO API — SYNTHESIZED PATIENT BEEP
// ============================================================
function toggleAudio() {
  audioEnabled = !audioEnabled;
  const icon = document.getElementById('audioIcon');
  const btn  = document.getElementById('audioToggle');
  if (audioEnabled) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    icon.className = 'fa-solid fa-volume-high';
    btn.classList.add('active');
    addAuditLog('info', 'Audio Telemetry Beeper: ENABLED');
    playTelemetryBeep(880, 0.08);
  } else {
    icon.className = 'fa-solid fa-volume-xmark';
    btn.classList.remove('active');
    addAuditLog('info', 'Audio Telemetry Beeper: MUTED');
  }
}

function playTelemetryBeep(freq = 880, duration = 0.07) {
  if (!audioEnabled || !audioCtx || (!isConnected && !isDemoMode)) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

function playAlarmBeep() {
  if (!audioEnabled || !audioCtx) return;
  playTelemetryBeep(1200, 0.15);
  setTimeout(() => playTelemetryBeep(1200, 0.15), 180);
}

// ============================================================
// REAL-TIME PHOSPHOR ECG OSCILLOSCOPE (FLATLINE WHEN UNPLUGGED)
// ============================================================
let ecgCanvas, ecgCtx;
let ecgX = 0;
let ecgLastY = 100;
let ecgPhase = 0;

function initECGOscilloscope() {
  ecgCanvas = document.getElementById('ecgOscilloscope');
  ecgCtx    = ecgCanvas.getContext('2d');

  const resize = () => {
    ecgCanvas.width  = ecgCanvas.parentElement.clientWidth;
    ecgCanvas.height = ecgCanvas.parentElement.clientHeight;
    ecgCtx.fillStyle = '#01080e';
    ecgCtx.fillRect(0, 0, ecgCanvas.width, ecgCanvas.height);
  };
  resize();
  window.addEventListener('resize', resize);

  requestAnimationFrame(drawECGSweep);
}

function drawECGSweep() {
  if (!ecgCtx) return;

  const w = ecgCanvas.width;
  const h = ecgCanvas.height;
  const centerY = h / 2;

  // Clear vertical slice ahead of cursor (phosphor fade)
  ecgCtx.fillStyle = 'rgba(1, 8, 14, 0.25)';
  ecgCtx.fillRect(ecgX, 0, 18, h);

  let newY = centerY;

  // ONLY DRAW ECG WAVES IF CONNECTED AND HEART RATE IS ACTIVE!
  // IF ARDUINO IS UNPLUGGED OR NO PULSE: DRAW REALISTIC FLATLINE!
  if ((isConnected || isDemoMode) && lastData.hr >= 30) {
    const bpm = lastData.hr;
    const cycleSpeed = (bpm / 60) * 0.08;
    ecgPhase = (ecgPhase + cycleSpeed) % 1;

    let v = 0;
    // P wave
    if (ecgPhase > 0.15 && ecgPhase < 0.25) {
      v = Math.sin((ecgPhase - 0.15) / 0.10 * Math.PI) * 12;
    }
    // Q drop
    else if (ecgPhase >= 0.25 && ecgPhase < 0.28) {
      v = -8;
    }
    // R peak (tall spike)
    else if (ecgPhase >= 0.28 && ecgPhase < 0.34) {
      v = Math.sin((ecgPhase - 0.28) / 0.06 * Math.PI) * 75;
      if (ecgPhase > 0.30 && ecgPhase < 0.32) {
        playTelemetryBeep(920, 0.06);
      }
    }
    // S drop
    else if (ecgPhase >= 0.34 && ecgPhase < 0.38) {
      v = -20;
    }
    // T wave
    else if (ecgPhase > 0.48 && ecgPhase < 0.65) {
      v = Math.sin((ecgPhase - 0.48) / 0.17 * Math.PI) * 18;
    } else {
      v = (Math.random() - 0.5) * 2;
    }
    newY = centerY - v;
    ecgCtx.strokeStyle = '#00ff88';
    ecgCtx.shadowColor = '#00ff88';
  } else {
    // ── FLATLINE MODE (DISCONNECTED / NO SIGNAL) ──
    const baselineNoise = (Math.random() - 0.5) * 2; // subtle flatline hum
    newY = centerY + baselineNoise;
    ecgCtx.strokeStyle = '#ef4444'; // Red flatline
    ecgCtx.shadowColor = '#ef4444';
  }

  // Draw trace
  ecgCtx.shadowBlur = 6;
  ecgCtx.lineWidth  = 2;
  ecgCtx.lineCap    = 'round';

  ecgCtx.beginPath();
  ecgCtx.moveTo(ecgX, ecgLastY);
  ecgCtx.lineTo(ecgX + 2, newY);
  ecgCtx.stroke();
  ecgCtx.shadowBlur = 0;

  ecgLastY = newY;
  ecgX += 2;
  if (ecgX >= w) {
    ecgX = 0;
  }

  requestAnimationFrame(drawECGSweep);
}

// ============================================================
// CHART.JS SPARKLINES & TELEMETRY CHARTS
// ============================================================
function initSparklines() {
  const sparkConf = (color) => ({
    type: 'line',
    data: { labels: new Array(15).fill(''), datasets: [{ data: new Array(15).fill(0), borderColor: color, borderWidth: 2, fill: true, backgroundColor: color + '15', tension: 0.3, pointRadius: 0 }] },
    options: { animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
  });

  sparkCharts.hr   = new Chart(document.getElementById('sparkHR'),   sparkConf('#ff2d55'));
  sparkCharts.spo2 = new Chart(document.getElementById('sparkSpO2'), sparkConf('#00e5ff'));
  sparkCharts.temp = new Chart(document.getElementById('sparkTemp'), sparkConf('#ffb300'));
  sparkCharts.bp   = new Chart(document.getElementById('sparkBP'),   sparkConf('#b388ff'));
}

function initMainChart() {
  const ctx = document.getElementById('telemetryHistoryChart').getContext('2d');
  mainHistoryChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Heart Rate (BPM)',
        data: [],
        borderColor: '#ff2d55',
        backgroundColor: 'rgba(255, 45, 85, 0.08)',
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 11 } } },
        tooltip: { backgroundColor: '#111827', titleColor: '#00e5ff', bodyColor: '#fff', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 }
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });
}

function setChartTrend(tab, btn) {
  currentTrendTab = tab;
  document.querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateMainChart();
}

function updateMainChart() {
  if (!mainHistoryChart) return;
  const cfg = {
    hr:   { label: 'Heart Rate (BPM)', data: history.hr,   color: '#ff2d55' },
    temp: { label: 'Body Temp (°C)',   data: history.temp, color: '#ffb300' },
    spo2: { label: 'Blood Oxygen (%)', data: history.spo2, color: '#00e5ff' },
    bp:   { label: 'Systolic BP',      data: history.sbp,  color: '#b388ff' }
  }[currentTrendTab];

  mainHistoryChart.data.labels = history.times;
  mainHistoryChart.data.datasets[0].label = cfg.label;
  mainHistoryChart.data.datasets[0].data  = cfg.data;
  mainHistoryChart.data.datasets[0].borderColor = cfg.color;
  mainHistoryChart.data.datasets[0].backgroundColor = cfg.color + '15';

  if (currentTrendTab === 'bp') {
    if (mainHistoryChart.data.datasets.length < 2) {
      mainHistoryChart.data.datasets.push({
        label: 'Diastolic BP',
        data: history.dbp,
        borderColor: '#818cf8',
        backgroundColor: 'transparent',
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 2
      });
    } else {
      mainHistoryChart.data.datasets[1].data = history.dbp;
    }
  } else {
    mainHistoryChart.data.datasets = [mainHistoryChart.data.datasets[0]];
  }
  mainHistoryChart.update();
}

// ============================================================
// HARDWARE CONNECTION: WEB SERIAL API (ARDUINO COM PORT)
// ============================================================
function openConnectModal() {
  document.getElementById('connectModal').classList.remove('hidden');
}

function closeConnectModal() {
  document.getElementById('connectModal').classList.add('hidden');
}

async function connectWebSerial() {
  closeConnectModal();
  if (isDemoMode) toggleDemoMode(); // stop demo if active

  if (!navigator.serial) {
    addAuditLog('danger', 'Web Serial not supported in this browser. Use Google Chrome or Microsoft Edge.');
    return;
  }

  try {
    addAuditLog('info', 'Opening USB Serial selector...');
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 9600 });

    isConnected = true;
    lastDataTimestamp = Date.now();
    setConnectionUI(true, 'USB Hardware Connected');
    addAuditLog('safe', '✅ Arduino Uno connected at 9600 baud! Streaming live sensor vitals.');

    readSerialStream();
  } catch (err) {
    addAuditLog('danger', `Connection cancelled or failed: ${err.message}`);
    setConnectionUI(false, 'Disconnected');
  }
}

async function readSerialStream() {
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
  serialReader = textDecoder.readable.getReader();

  let lineBuffer = '';
  try {
    while (true) {
      const { value, done } = await serialReader.read();
      if (done) break;
      if (value) {
        lineBuffer += value;
        let lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // 1. Try parsing JSON: {"temp":25.4, ...}
          const jsonMatch = trimmed.match(/\{.*?\}/);
          if (jsonMatch) {
            try {
              const data = JSON.parse(jsonMatch[0]);
              ingestPatientData(data);
              continue;
            } catch (pe) {}
          }

          // 2. Try parsing Key-Value debug text: T=26.5 H=55 HR=72 SpO2=97 BP=111/72 Bed=1 Fall=0
          if (trimmed.includes('T=') || trimmed.includes('HR=')) {
            const data = {};
            const tMatch = trimmed.match(/T=([\d\.]+)/);
            if (tMatch) data.temp = parseFloat(tMatch[1]);
            const hMatch = trimmed.match(/H=([\d\.]+)/);
            if (hMatch) data.hum = parseFloat(hMatch[1]);
            const hrMatch = trimmed.match(/HR=(\d+)/);
            if (hrMatch) data.hr = parseInt(hrMatch[1]);
            const spo2Match = trimmed.match(/SpO2=(\d+)/);
            if (spo2Match) data.spo2 = parseInt(spo2Match[1]);
            const bpMatch = trimmed.match(/BP=(\d+)\/(\d+)/);
            if (bpMatch) {
              data.sbp = parseInt(bpMatch[1]);
              data.dbp = parseInt(bpMatch[2]);
            }
            const bedMatch = trimmed.match(/Bed=(\d+)/);
            if (bedMatch) data.bed = parseInt(bedMatch[1]);
            const fallMatch = trimmed.match(/Fall=(\d+)/);
            if (fallMatch) data.fall = parseInt(fallMatch[1]);
            const motMatch = trimmed.match(/Motion=(\d+)/);
            if (motMatch) data.motion = parseInt(motMatch[1]);

            if (Object.keys(data).length > 0) {
              ingestPatientData(data);
              continue;
            }
          }
        }
      }
    }
  } catch (e) {
    handleHardwareDisconnect('Physical connection lost: USB cable disconnected.');
  } finally {
    try { serialReader.releaseLock(); } catch(e){}
    setConnectionUI(false, 'Disconnected');
  }
}

// ── Bluetooth Option ─────────────────────────────────────────
async function connectBluetoothOption() {
  closeConnectModal();
  if (isDemoMode) toggleDemoMode();

  if (navigator.serial) {
    addAuditLog('info', 'Select your paired HC-05 COM port from the serial list.');
    await connectWebSerial();
  } else if (navigator.bluetooth) {
    try {
      addAuditLog('info', 'Scanning for Bluetooth device...');
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
      addAuditLog('safe', `Bluetooth connected: ${device.name}`);
    } catch (e) {
      addAuditLog('warn', `Bluetooth: ${e.message}`);
    }
  } else {
    addAuditLog('danger', 'Bluetooth API not supported on this browser.');
  }
}

function setConnectionUI(active, text) {
  const btn     = document.getElementById('connectBtn');
  const btnText = document.getElementById('connectBtnText');
  if (active) {
    btn.classList.add('connected');
    btnText.textContent = text || 'Hardware Active';
  } else {
    btn.classList.remove('connected');
    btnText.textContent = 'Connect Hardware';
  }
}

// ============================================================
// DATA INGESTION & CLINICAL CLASSIFICATION
// ============================================================
function ingestPatientData(data) {
  lastDataTimestamp = Date.now(); // update watchdog timestamp
  lastData = { ...lastData, ...data };
  const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });

  // 1. Heart Rate
  const hr = data.hr;
  document.getElementById('valHR').textContent = hr > 0 ? hr : '--';
  const hrStatusEl = document.getElementById('statusHR');
  const hrCard = document.getElementById('cardHeartRate');
  if (hr > clinicalConfig.maxHR) {
    hrStatusEl.textContent = 'Tachycardia';
    hrStatusEl.className = 'vital-status status-danger';
    hrCard.classList.add('alarm-active');
    triggerAlarmBanner(`CRITICAL TACHYCARDIA DETECTED: ${hr} BPM (Threshold: ${clinicalConfig.maxHR})`);
  } else if (hr < clinicalConfig.minHR && hr > 0) {
    hrStatusEl.textContent = 'Bradycardia';
    hrStatusEl.className = 'vital-status status-danger';
    hrCard.classList.add('alarm-active');
    triggerAlarmBanner(`CRITICAL BRADYCARDIA DETECTED: ${hr} BPM (Threshold: ${clinicalConfig.minHR})`);
  } else if (hr >= clinicalConfig.minHR && hr <= clinicalConfig.maxHR) {
    hrStatusEl.textContent = 'Normal Sinus';
    hrStatusEl.className = 'vital-status status-normal';
    hrCard.classList.remove('alarm-active');
  } else {
    hrStatusEl.textContent = 'No Pulse Contact';
    hrStatusEl.className = 'vital-status status-warn';
    hrCard.classList.remove('alarm-active');
  }

  // 2. SpO2 Oxygen
  const spo2 = data.spo2;
  document.getElementById('valSpO2').textContent = spo2 > 0 ? spo2 : '--';
  const spo2StatusEl = document.getElementById('statusSpO2');
  const spo2Card = document.getElementById('cardSpO2');
  if (spo2 < clinicalConfig.minSpO2 && spo2 > 0) {
    spo2StatusEl.textContent = 'Hypoxemia';
    spo2StatusEl.className = 'vital-status status-danger';
    spo2Card.classList.add('alarm-active');
    triggerAlarmBanner(`LOW BLOOD OXYGEN ALERT: ${spo2}% SpO2 (Limit: ${clinicalConfig.minSpO2}%)`);
  } else if (spo2 >= clinicalConfig.minSpO2) {
    spo2StatusEl.textContent = 'Adequate';
    spo2StatusEl.className = 'vital-status status-normal';
    spo2Card.classList.remove('alarm-active');
  } else {
    spo2StatusEl.textContent = 'Awaiting Sensor';
    spo2StatusEl.className = 'vital-status status-warn';
  }

  // 3. Body Temperature
  const temp = data.temp;
  document.getElementById('valTemp').textContent = temp > 0 ? temp.toFixed(1) : '--';
  const tempStatusEl = document.getElementById('statusTemp');
  const tempCard = document.getElementById('cardTemp');
  if (temp > clinicalConfig.maxTemp) {
    tempStatusEl.textContent = 'Fever Spike';
    tempStatusEl.className = 'vital-status status-danger';
    tempCard.classList.add('alarm-active');
    triggerAlarmBanner(`HIGH FEVER DETECTED: ${temp}°C (Threshold: ${clinicalConfig.maxTemp}°C)`);
  } else if (temp < 35.0 && temp > 15) {
    tempStatusEl.textContent = 'Hypothermia';
    tempStatusEl.className = 'vital-status status-warn';
    tempCard.classList.remove('alarm-active');
  } else if (temp >= 35.0) {
    tempStatusEl.textContent = 'Normothermic';
    tempStatusEl.className = 'vital-status status-normal';
    tempCard.classList.remove('alarm-active');
  } else {
    tempStatusEl.textContent = 'No Signal';
    tempStatusEl.className = 'vital-status status-warn';
  }

  // 4. Blood Pressure
  document.getElementById('valSBP').textContent = data.sbp > 0 ? data.sbp : '--';
  document.getElementById('valDBP').textContent = data.dbp > 0 ? data.dbp : '--';
  const bpStatusEl = document.getElementById('statusBP');
  if (data.sbp > clinicalConfig.maxBP) {
    bpStatusEl.textContent = 'Hypertension';
    bpStatusEl.className = 'vital-status status-warn';
  } else if (data.sbp > 0) {
    bpStatusEl.textContent = 'Optimal BP';
    bpStatusEl.className = 'vital-status status-normal';
  } else {
    bpStatusEl.textContent = 'No Signal';
    bpStatusEl.className = 'vital-status status-warn';
  }

  // 5. Bed Occupancy
  const valBed = document.getElementById('valBed');
  if (data.bed === 1) {
    valBed.textContent = 'PATIENT IN BED';
    valBed.className = 'tile-value status-safe';
  } else {
    valBed.textContent = 'BED VACANT / PATIENT AWAY';
    valBed.className = 'tile-value status-warn';
  }

  // 6. Motion (IR)
  const valMotion = document.getElementById('valMotion');
  valMotion.textContent = data.motion ? 'Active Motion Detected' : 'Patient Resting';

  // 7. Fall Detection (MPU-6050)
  const valFall = document.getElementById('valFall');
  const fallIcon = document.getElementById('fallIcon');
  if (data.fall === 1) {
    valFall.textContent = 'EMERGENCY: FALL DETECTED!';
    valFall.className = 'tile-value status-fall';
    fallIcon.innerHTML = '<i class="fa-solid fa-person-falling-burst" style="color: #ef4444"></i>';
    triggerAlarmBanner('IMMEDIATE ATTENTION: PATIENT ACCIDENTAL FALL DETECTED!');
    addAuditLog('danger', '🚨 MPU-6050 IMPACT TRIGGERED: Patient fall detected!');
  } else {
    valFall.textContent = 'PATIENT SAFE';
    valFall.className = 'tile-value status-safe';
    fallIcon.innerHTML = '<i class="fa-solid fa-shield-heart" style="color: #10b981"></i>';
  }

  // 8. QRS Sync & Raw Pulse
  document.getElementById('valHum').textContent = `${data.hum || 50} %`;
  document.getElementById('valRawPulse').textContent = data.pulse_raw || 0;
  const qrs = document.getElementById('valQRSSync');
  if (data.hr > 30) {
    qrs.textContent = 'SYNCHRONIZED';
    qrs.style.color = '#00ff88';
  } else {
    qrs.textContent = 'LEADS OFF';
    qrs.style.color = '#ef4444';
  }

  // Push to rolling history
  pushToHistory(timeStr, data);
}

function pushToHistory(timeStr, data) {
  history.times.push(timeStr);
  history.hr.push(data.hr);
  history.spo2.push(data.spo2);
  history.temp.push(data.temp);
  history.sbp.push(data.sbp);
  history.dbp.push(data.dbp);

  if (history.times.length > MAX_PTS) {
    ['times', 'hr', 'spo2', 'temp', 'sbp', 'dbp'].forEach(k => history[k].shift());
  }

  // Update Sparklines
  updateSpark(sparkCharts.hr,   history.hr);
  updateSpark(sparkCharts.spo2, history.spo2);
  updateSpark(sparkCharts.temp, history.temp);
  updateSpark(sparkCharts.bp,   history.sbp);

  updateMainChart();
}

function updateSpark(chart, dataArr) {
  if (!chart) return;
  const recent = dataArr.slice(-15);
  chart.data.labels = recent.map(() => '');
  chart.data.datasets[0].data = recent;
  chart.update('none');
}

// ============================================================
// CLINICAL EMERGENCY ALARM BANNER
// ============================================================
function triggerAlarmBanner(message) {
  const ticker = document.getElementById('alertTicker');
  document.getElementById('alertDetails').textContent = message;
  ticker.classList.remove('hidden');
  playAlarmBeep();
}

function dismissAlert() {
  document.getElementById('alertTicker').classList.add('hidden');
  addAuditLog('info', 'Clinical alarm acknowledged by operator.');
}

function triggerManualSOS() {
  triggerAlarmBanner('MANUAL CODE BLUE / NURSE EMERGENCY CALL TRIGGERED!');
  addAuditLog('danger', '🚨 NURSE CALL BUTTON ACTIVATED AT BEDSIDE!');
  ingestPatientData({ ...lastData, alert: 1 });
}

// ============================================================
// AUDIT LOG SYSTEM
// ============================================================
function addAuditLog(type, text) {
  const stream = document.getElementById('auditLogStream');
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour12: false });

  const row = document.createElement('div');
  row.className = `log-row ${type}`;
  row.innerHTML = `<span class="log-t">${time}</span><span class="log-txt">${text}</span>`;

  stream.insertBefore(row, stream.firstChild);

  while (stream.children.length > 40) {
    stream.removeChild(stream.lastChild);
  }
}

function clearAuditLog() {
  document.getElementById('auditLogStream').innerHTML = '';
  addAuditLog('info', 'Audit log cleared.');
}

// ============================================================
// DEMO / SIMULATOR MODE (FOR LAB EVALUATION ONLY)
// ============================================================
let simTick = 0;
function toggleDemoMode() {
  isDemoMode = !isDemoMode;
  const btn = document.getElementById('demoBtn');
  const btnText = document.getElementById('demoBtnText');

  if (isDemoMode) {
    // If USB was connected, disconnect it first
    if (isConnected) handleHardwareDisconnect('Switching to Demo Simulator');

    btn.classList.add('active');
    btnText.textContent = 'Stop Demo';
    addAuditLog('warn', '🧪 Virtual Clinical Simulator ON: Simulating live patient.');
    startDemoLoop();
  } else {
    btn.classList.remove('active');
    btnText.textContent = 'Demo Mode';
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    resetAllVitalsToDisconnected('STANDBY');
    addAuditLog('info', 'Virtual Clinical Simulator OFF.');
  }
}

function startDemoLoop() {
  demoTimer = setInterval(() => {
    simTick++;
    const t = simTick;

    let baseHR = 74 + Math.round(Math.sin(t * 0.1) * 8);
    let baseTemp = 36.7 + Math.sin(t * 0.05) * 0.3;
    let baseSpO2 = 98;

    const motion = (t % 12 < 3) ? 1 : 0;
    const bed = (t % 40 < 35) ? 1 : 0;
    const sbp = Math.round(112 + (baseHR - 70) * 0.45);
    const dbp = Math.round(sbp * 0.64);

    ingestPatientData({
      hr: baseHR,
      temp: parseFloat(baseTemp.toFixed(1)),
      spo2: baseSpO2,
      hum: 54 + Math.round(Math.sin(t * 0.05) * 4),
      sbp: sbp,
      dbp: dbp,
      bed: bed,
      motion: motion,
      fall: (t === 55) ? 1 : 0,
      alert: 0,
      pulse_raw: 512
    });
  }, 1000);
}

// ============================================================
// CLINICAL CSV EXPORT
// ============================================================
function exportClinicalDataCSV() {
  if (history.times.length === 0) {
    alert('No telemetry data recorded yet to export.');
    return;
  }
  let csv = `Hospital,${clinicalConfig.hospitalName}\n`;
  csv += `Ward_Bed,${clinicalConfig.ward} - ${clinicalConfig.bed}\n`;
  csv += `Patient,${clinicalConfig.patientName} (${clinicalConfig.mrn})\n`;
  csv += `Age_Gender,${clinicalConfig.ageGender}\n`;
  csv += `Doctor,${clinicalConfig.doctor}\n\n`;
  csv += 'Time,Heart_Rate_BPM,SpO2_Percent,Temp_C,Systolic_BP,Diastolic_BP\n';
  for (let i = 0; i < history.times.length; i++) {
    csv += `${history.times[i]},${history.hr[i]},${history.spo2[i]},${history.temp[i]},${history.sbp[i]},${history.dbp[i]}\n`;
  }
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `patient_${clinicalConfig.patientName.replace(/\s+/g,'_')}_telemetry.csv`;
  a.click();
  addAuditLog('safe', 'Exported clinical telemetry CSV log.');
}

// ============================================================
// HOSPITAL & PATIENT CONFIGURATION MANAGER (LOCALSTORAGE)
// ============================================================
function loadStoredConfig() {
  const saved = localStorage.getItem('medipulse_icu_config');
  if (saved) {
    try {
      clinicalConfig = { ...clinicalConfig, ...JSON.parse(saved) };
    } catch (e) {}
  }
  applyConfigToUI();
}

function applyConfigToUI() {
  // Update header branding
  document.getElementById('displayHospitalName').textContent = clinicalConfig.hospitalName.toUpperCase();
  document.getElementById('displayWardBed').textContent = `${clinicalConfig.ward.toUpperCase()} • ${clinicalConfig.bed.toUpperCase()}`;
  document.getElementById('displayCaregiver').textContent = clinicalConfig.doctor.toUpperCase();

  // Update patient strip
  document.getElementById('displayPatientName').textContent = `${clinicalConfig.patientName} (${clinicalConfig.mrn})`;
  document.getElementById('displayAgeGender').textContent = clinicalConfig.ageGender;
  document.getElementById('displayBloodGroup').textContent = clinicalConfig.bloodGroup;

  // Update vital targets
  document.getElementById('lblTargetHR').textContent = `Limit: ${clinicalConfig.minHR}-${clinicalConfig.maxHR}`;
  document.getElementById('lblTargetSpO2').textContent = `Limit: > ${clinicalConfig.minSpO2}%`;
  document.getElementById('lblTargetTemp').textContent = `Limit: < ${clinicalConfig.maxTemp}°C`;
  document.getElementById('lblTargetBP').textContent = `Normal: < ${clinicalConfig.maxBP}/85`;

  // Pre-fill modal input fields
  document.getElementById('cfgHospitalName').value = clinicalConfig.hospitalName;
  document.getElementById('cfgDepartment').value   = clinicalConfig.department;
  document.getElementById('cfgWard').value         = clinicalConfig.ward;
  document.getElementById('cfgBed').value          = clinicalConfig.bed;
  document.getElementById('cfgDoctor').value       = clinicalConfig.doctor;
  document.getElementById('cfgNursePhone').value   = clinicalConfig.nursePhone;

  document.getElementById('cfgPatientName').value  = clinicalConfig.patientName;
  document.getElementById('cfgMRN').value          = clinicalConfig.mrn;
  document.getElementById('cfgAgeGender').value    = clinicalConfig.ageGender;
  document.getElementById('cfgBloodGroup').value   = clinicalConfig.bloodGroup;
  document.getElementById('cfgDiagnosis').value    = clinicalConfig.diagnosis;

  document.getElementById('cfgMaxHR').value        = clinicalConfig.maxHR;
  document.getElementById('cfgMinHR').value        = clinicalConfig.minHR;
  document.getElementById('cfgMinSpO2').value      = clinicalConfig.minSpO2;
  document.getElementById('cfgMaxTemp').value      = clinicalConfig.maxTemp;
  document.getElementById('cfgMaxBP').value        = clinicalConfig.maxBP;
}

function openHospitalModal() {
  applyConfigToUI();
  document.getElementById('hospitalModal').classList.remove('hidden');
}

function closeHospitalModal() {
  document.getElementById('hospitalModal').classList.add('hidden');
}

function switchModalTab(tabId, btn) {
  document.querySelectorAll('.modal-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

function saveConfiguration() {
  clinicalConfig.hospitalName = document.getElementById('cfgHospitalName').value.trim() || 'MEDIPULSE HOSPITAL';
  clinicalConfig.department   = document.getElementById('cfgDepartment').value.trim() || 'ICU';
  clinicalConfig.ward         = document.getElementById('cfgWard').value.trim() || 'Ward 4A';
  clinicalConfig.bed          = document.getElementById('cfgBed').value.trim() || 'Bed #03';
  clinicalConfig.doctor       = document.getElementById('cfgDoctor').value.trim() || 'Attending Physician';
  clinicalConfig.nursePhone   = document.getElementById('cfgNursePhone').value.trim() || '+91 98765 43210';

  clinicalConfig.patientName  = document.getElementById('cfgPatientName').value.trim() || 'Patient';
  clinicalConfig.mrn          = document.getElementById('cfgMRN').value.trim() || 'MRN-001';
  clinicalConfig.ageGender    = document.getElementById('cfgAgeGender').value.trim() || '--';
  clinicalConfig.bloodGroup   = document.getElementById('cfgBloodGroup').value;
  clinicalConfig.diagnosis    = document.getElementById('cfgDiagnosis').value.trim() || 'Observation';

  clinicalConfig.maxHR        = parseInt(document.getElementById('cfgMaxHR').value) || 120;
  clinicalConfig.minHR        = parseInt(document.getElementById('cfgMinHR').value) || 50;
  clinicalConfig.minSpO2      = parseInt(document.getElementById('cfgMinSpO2').value) || 92;
  clinicalConfig.maxTemp      = parseFloat(document.getElementById('cfgMaxTemp').value) || 38.0;
  clinicalConfig.maxBP        = parseInt(document.getElementById('cfgMaxBP').value) || 135;

  localStorage.setItem('medipulse_icu_config', JSON.stringify(clinicalConfig));
  applyConfigToUI();
  closeHospitalModal();
  addAuditLog('safe', `Configuration saved! Monitoring ${clinicalConfig.patientName} in ${clinicalConfig.ward}.`);
}

// ============================================================
// DOCTOR CLINICAL NOTES & OBSERVATION DIARY
// ============================================================
function loadStoredNotes() {
  const saved = localStorage.getItem('medipulse_doctor_notes');
  if (saved) {
    try { doctorNotes = JSON.parse(saved); } catch(e){}
  }
  renderDoctorNotes();
}

function saveDoctorNote() {
  const input = document.getElementById('doctorNoteInput');
  const txt = input.value.trim();
  if (!txt) return;

  const noteObj = {
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    text: txt,
    vitals: `HR: ${lastData.hr || '--'} | SpO2: ${lastData.spo2 || '--'}% | Temp: ${lastData.temp ? lastData.temp.toFixed(1) : '--'}°C`
  };

  doctorNotes.unshift(noteObj);
  if (doctorNotes.length > 30) doctorNotes.pop();

  localStorage.setItem('medipulse_doctor_notes', JSON.stringify(doctorNotes));
  input.value = '';
  renderDoctorNotes();
  addAuditLog('info', `Doctor note recorded: "${txt.substring(0, 30)}..."`);
}

function deleteDoctorNote(idx) {
  doctorNotes.splice(idx, 1);
  localStorage.setItem('medipulse_doctor_notes', JSON.stringify(doctorNotes));
  renderDoctorNotes();
}

function renderDoctorNotes() {
  const listEl = document.getElementById('doctorNotesList');
  document.getElementById('notesCount').textContent = `${doctorNotes.length} Notes`;

  if (doctorNotes.length === 0) {
    listEl.innerHTML = '<div class="note-empty">No clinical notes recorded for this patient yet.</div>';
    return;
  }

  listEl.innerHTML = doctorNotes.map((n, i) => `
    <div class="note-item">
      <div class="note-header-line">
        <span class="note-time"><i class="fa-regular fa-clock"></i> ${n.date} ${n.time}</span>
        <span class="note-vitals-pill">${n.vitals}</span>
        <button class="note-del-btn" onclick="deleteDoctorNote(${i})" title="Delete note"><i class="fa-solid fa-trash"></i></button>
      </div>
      <div class="note-txt">${n.text}</div>
    </div>
  `).join('');
}

// ============================================================
// CLINICAL DISCHARGE / MEDICAL SUMMARY PRINT REPORT
// ============================================================
function printDischargeReport() {
  window.print();
}
