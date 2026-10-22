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
  tilt: { name: 'Tilt meter (MPU-6050 + OLED)', code: `// Tilt meter: an MPU-6050 and a 128×64 OLED share the I²C bus.
// Wire both: VCC/VIN → 5V, GND → GND, SDA/DATA → A4, SCL/CLK → A5. Then right-click the MPU-6050 to tilt it.
// The MPU-6050 is read with Wire directly: Adafruit_MPU6050 plus the OLED's 1 KB screen buffer
// would not fit in the Uno's 2 KB of RAM (the display would stay blank on a real board too).
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);
const int MPU = 0x68;

int16_t readWord() {
  int16_t high = Wire.read();
  return (high << 8) | Wire.read();
}

void setup() {
  Serial.begin(9600);
  Wire.begin();
  Wire.beginTransmission(MPU);
  Wire.write(0x6B);          // PWR_MGMT_1
  Wire.write(0);             // wake up
  Wire.endTransmission();
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("OLED not found"));
    while (true) {}
  }
  display.setTextColor(SSD1306_WHITE);
}

void loop() {
  Wire.beginTransmission(MPU);
  Wire.write(0x3B);          // ACCEL_XOUT_H: 6 bytes of X, Y, Z follow
  Wire.endTransmission(false);
  Wire.requestFrom(MPU, 6);
  int16_t ax = readWord(), ay = readWord(), az = readWord();

  float roll = atan2(ay, az) * 180.0 / PI;
  float pitch = atan2(-ax, sqrt((float)ay * ay + (float)az * az)) * 180.0 / PI;

  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);  display.print(F("Roll"));
  display.setCursor(70, 0); display.print(F("Pitch"));
  display.setTextSize(2);
  display.setCursor(0, 12);  display.print(roll, 0);
  display.setCursor(70, 12); display.print(pitch, 0);
  // A bubble level: the dot drifts the way the board leans.
  display.drawCircle(64, 47, 15, SSD1306_WHITE);
  display.fillCircle(64 + constrain(roll, -45, 45) / 3, 47 + constrain(pitch, -45, 45) / 3, 3, SSD1306_WHITE);
  display.display();

  Serial.print(F("roll "));  Serial.print(roll, 1);
  Serial.print(F("  pitch ")); Serial.println(pitch, 1);
  delay(100);
}
` },
  weather: { name: 'Weather station (DHT22 + LCD)', code: `// Weather station: a DHT22 measures temperature and humidity, a 16×2 I²C LCD shows them.
// DHT22: VCC → 5V, GND → GND, DATA → D2.   LCD: GND → GND, VCC → 5V, SDA → A4, SCL → A5.
// Right-click the DHT22 to change the weather.
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);
DHT dht(2, DHT22);
byte degree[8] = {0b00110, 0b01001, 0b01001, 0b00110, 0b00000, 0b00000, 0b00000, 0b00000};

void setup() {
  Serial.begin(9600);
  dht.begin();
  lcd.init();
  lcd.backlight();
  lcd.createChar(0, degree);
  lcd.setCursor(0, 0);             // after createChar, writes go to character memory until the cursor is set again
  lcd.print("Weather station");
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  lcd.setCursor(0, 1);
  if (isnan(t) || isnan(h)) {
    lcd.print("Sensor error    ");
    Serial.println("DHT read failed - check the DATA wire");
  } else {
    lcd.print(t, 1); lcd.write(0); lcd.print("C  ");
    lcd.print(h, 0); lcd.print("%   ");
    Serial.print(t, 1); Serial.print(" C, "); Serial.print(h, 0); Serial.println(" %");
  }
  delay(2000);
}
` },
  ecg: { name: 'Heartbeat monitor (BioAmp EXG Pill)', code: `// Biosignal monitor: BioAmp EXG Pill OUT → A0, VCC → 5V, GND → GND, electrodes on the body source.
// Samples at 250 Hz and prints the signal with its slow drift removed (open the Serial monitor).
// The R wave of each heartbeat shows up as the tall spike. (Simulated, illustrative signal — not medical data.)

const unsigned long SAMPLE_US = 4000;   // 4 ms = 250 samples per second
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
    baseline += (raw - baseline) / 100.0;      // slow average = the amplifier's resting level
    Serial.println((int)(raw - baseline));
  }
}
` },
  motor: { name: 'Motor control (L298N)', code: `// DC motor through an L298N driver: speed ramps up, then the motor reverses.
// L298N: IN1 → D8, IN2 → D7, ENA → D9 (PWM), OUT1/OUT2 → the motor,
//        12V → battery +, GND → battery − AND the Arduino GND.
const int IN1 = 8, IN2 = 7, ENA = 9;

void drive(int speed) {            // -255 … 255
  digitalWrite(IN1, speed > 0);
  digitalWrite(IN2, speed < 0);
  analogWrite(ENA, abs(speed));
}

void setup() {
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT); pinMode(ENA, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  for (int s = 0; s <= 255; s += 51) { drive(s); Serial.print("speed "); Serial.println(s); delay(600); }
  drive(0); delay(500);
  for (int s = 0; s >= -255; s -= 51) { drive(s); Serial.print("speed "); Serial.println(s); delay(600); }
  drive(0); delay(500);
}
` },
};
