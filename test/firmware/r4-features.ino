void setup() {
  Serial.begin(9600);
  analogReadResolution(14);
  analogWriteResolution(12);
  analogWrite(A0, 2048);
  analogWrite(DAC, 2048);
}

void loop() {
  int raw = analogRead(A1);
  Serial.println(raw);
  analogWrite(A0, raw / 4);
  delay(100);
}
