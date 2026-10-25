// Calculator: 4×4 keypad in, screen out
// Membrane Keypad 4×4 R1 → pin 8
// Membrane Keypad 4×4 R2 → pin 7
// Membrane Keypad 4×4 R3 → pin 4
// Membrane Keypad 4×4 R4 → pin 2
// Membrane Keypad 4×4 C1 → pin 12
// Membrane Keypad 4×4 C2 → pin 13
// Membrane Keypad 4×4 C3 → pin 5
// Membrane Keypad 4×4 C4 → pin 3
// OLED Display 128×64 DATA → A4
// OLED Display 128×64 CLK → A5
// OLED Display 128×64 VIN → 5V
// OLED Display 128×64 GND → GND
// Keys: 0-9 digits   A = +   B = -   C = x   D = /   # = equals   * = clear

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

const char KEYS[4][4] = {{'1', '2', '3', 'A'}, {'4', '5', '6', 'B'}, {'7', '8', '9', 'C'}, {'*', '0', '#', 'D'}};
const int ROW_PINS[] = {8, 7, 4, 2};
const int COL_PINS[] = {12, 13, 5, 3};

String entry = "";        // the number being typed
double acc = 0;           // the running total
char pending = 0;         // the operator waiting for its second number
bool typed = false;       // has a digit been typed since the last operator?
bool failed = false;      // divided by zero
char lastKey = 0;

String format(double v) {
  if (failed) return "Error";
  if (fabs(v) < 1000000000.0 && v == (long)v) return String((long)v);
  String s = String(v, 4);
  while (s.endsWith("0")) s.remove(s.length() - 1);
  if (s.endsWith(".")) s.remove(s.length() - 1);
  return s;
}

void draw() {
  String top = failed ? "" : (pending ? format(acc) + " " + String(pending) : "");
  String big = typed ? entry : format(acc);
  Serial.println(big);                // also visible in the Serial Monitor
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(top);
  display.setTextSize(2);
  display.setCursor(0, 30);
  display.print(big);
  display.display();
}

void calculate() {
  double v = entry.toDouble();
  if (!pending) acc = v;
  else if (pending == '+') acc += v;
  else if (pending == '-') acc -= v;
  else if (pending == 'x') acc *= v;
  else if (v == 0) failed = true;
  else acc /= v;
  entry = "";
}

void press(char k) {
  if (failed && k != '*') return;
  if (k >= '0' && k <= '9') {
    if (!typed) { entry = ""; typed = true; }
    if (entry.length() < 9) entry += k;
  } else if (k == '*') {
    entry = ""; acc = 0; pending = 0; typed = false; failed = false;
  } else if (k == '#') {
    if (typed) calculate();
    pending = 0; typed = false;
  } else if (k == 'A' || k == 'B' || k == 'C' || k == 'D') {
    if (typed) calculate();
    pending = (k == 'A') ? '+' : (k == 'B') ? '-' : (k == 'C') ? 'x' : '/';
    typed = false;
  }
  draw();
}

char scanKeys() {
  char key = 0;
  for (int r = 0; r < 4; r++) {
    digitalWrite(ROW_PINS[r], LOW);
    for (int c = 0; c < 4; c++) if (digitalRead(COL_PINS[c]) == LOW) key = KEYS[r][c];
    digitalWrite(ROW_PINS[r], HIGH);
  }
  return key;
}

void setup() {
  for (int r = 0; r < 4; r++) { pinMode(ROW_PINS[r], OUTPUT); digitalWrite(ROW_PINS[r], HIGH); }
  for (int c = 0; c < 4; c++) pinMode(COL_PINS[c], INPUT_PULLUP);
  delay(50);                       // let the pull-ups settle before the first read
  Serial.begin(9600);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("OLED not found"));
    while (true) {}
  }
  display.setTextColor(SSD1306_WHITE);
  draw();
}

void loop() {
  char key = scanKeys();
  if (key && key != lastKey) press(key);          // a new key went down
  lastKey = key;
  delay(30);
}
