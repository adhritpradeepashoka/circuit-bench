// Example sketches. All plain Arduino C++ — they go through the same compiler as anything you type.
// Their firmware is also prebuilt (scripts/build-firmware.mjs → prebuilt.generated.js) so they run even without a compile service.

export const DEFAULT_SKETCH = `// Blink — the classic first program.
// Pin 13 is wired to the LED you build on the breadboard.

void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;

export const EXAMPLES = {
  blink: { name: 'Blink (pin 13)', code: DEFAULT_SKETCH },
  button: { name: 'Button → LED', code: `// Hold the pushbutton (wired between D2 and GND) to light the LED on D13.
// INPUT_PULLUP keeps D2 HIGH until the button pulls it to GND.

void setup() {
  pinMode(2, INPUT_PULLUP);
  pinMode(13, OUTPUT);
}

void loop() {
  if (digitalRead(2) == LOW) {
    digitalWrite(13, HIGH);
  } else {
    digitalWrite(13, LOW);
  }
}
` },
  alternate: { name: 'Two LEDs alternate', code: `// Wire one LED (with a resistor) to D12 and another to D13.

const int redLed = 12;
const int greenLed = 13;

void setup() {
  pinMode(redLed, OUTPUT);
  pinMode(greenLed, OUTPUT);
}

void loop() {
  digitalWrite(redLed, HIGH);
  digitalWrite(greenLed, LOW);
  delay(300);
  digitalWrite(redLed, LOW);
  digitalWrite(greenLed, HIGH);
  delay(300);
}
` },
  chaser: { name: 'LED chaser (array)', code: `// Wire LEDs (each with a resistor) to D9, D10, D11 and D12.

int leds[] = {9, 10, 11, 12};
int count = 4;

void setup() {
  for (int i = 0; i < count; i++) {
    pinMode(leds[i], OUTPUT);
  }
}

void loop() {
  for (int i = 0; i < count; i++) {
    digitalWrite(leds[i], HIGH);
    delay(150);
    digitalWrite(leds[i], LOW);
  }
}
` },
  dimmer: { name: 'Potentiometer dimmer', code: `// Wire a potentiometer's wiper (SIG) to A0 (ends to 5V and GND) and an LED + resistor to D9.
// analogRead gives 0–1023; analogWrite (PWM) takes 0–255, so map() rescales it.
// Right-click the potentiometer and drag its slider while this runs.

const int knob = A0;
const int ledPin = 9;

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  int reading = analogRead(knob);
  int brightness = map(reading, 0, 1023, 0, 255);
  analogWrite(ledPin, brightness);
  delay(10);
}
` },
  nightlight: { name: 'Light-sensor night-light', code: `// Photoresistor module: VCC to 5V, GND to GND, AO to A0. LED + resistor on D13.
// The module's AO voltage FALLS as light rises (like Wokwi's), so a high reading means dark.
// Right-click the module and change the light level while this runs.

const int darkLevel = 600;     // roughly 30 lux

void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  if (analogRead(A0) > darkLevel) {
    digitalWrite(13, HIGH);    // dark  -> light on
  } else {
    digitalWrite(13, LOW);     // bright -> light off
  }
  delay(20);
}
` },
  sos: { name: 'SOS signal', code: `// Morse code SOS (· · ·  — — —  · · ·) on pin 13.

void blink(int onTime) {
  digitalWrite(13, HIGH);
  delay(onTime);
  digitalWrite(13, LOW);
  delay(150);
}

void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  for (int i = 0; i < 3; i++) blink(150);
  delay(150);
  for (int i = 0; i < 3; i++) blink(450);
  delay(150);
  for (int i = 0; i < 3; i++) blink(150);
  delay(1200);
}
` },
};
