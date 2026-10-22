// Nano: the same chip as the Uno, plus analog-only A6 / A7.
void setup() { Serial.begin(115200); pinMode(13, OUTPUT); }
void loop() {
  Serial.print("a6:"); Serial.print(analogRead(A6));
  Serial.print(" a7:"); Serial.println(analogRead(A7));
  digitalWrite(13, !digitalRead(13));
  delay(200);
}
