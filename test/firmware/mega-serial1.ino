// Mega: Serial1 (TX1 = D18, RX1 = D19) echoes whatever arrives, upper-cased
void setup() { Serial1.begin(9600); Serial.begin(9600); }
void loop() {
  while (Serial1.available()) { char c = Serial1.read(); Serial1.write(toupper(c)); }
}
