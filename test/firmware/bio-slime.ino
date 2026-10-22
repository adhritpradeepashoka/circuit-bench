// Slime mold (Physarum) on an electrode grid: a BioAmp EXG Pill reads the difference between two electrode pins.
// Wire: Pill IN+ → an electrode pin the organism covers, IN− → one it does not (or the grid's common pin), REF → the organism's REF,
//       Pill OUT → A0, VCC → 5V, GND → GND. In the slime mold's settings raise "Time speed-up" so a cycle fits in a short run.
// Prints the signal with its slow drift removed, every 50 ms (open the Serial monitor). Illustrative model — not real culture data.

const unsigned long SAMPLE_US = 50000;   // 50 ms
unsigned long nextSample;
float baseline = 512;

void setup() {
  Serial.begin(115200);
  nextSample = micros();
}

void loop() {
  if ((long)(micros() - nextSample) >= 0) {
    nextSample += SAMPLE_US;
    int raw = analogRead(A0);
    baseline += (raw - baseline) / 200.0;      // the amplifier's resting level
    Serial.println((int)(raw - baseline));
  }
}
