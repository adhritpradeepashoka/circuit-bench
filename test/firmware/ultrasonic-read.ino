void setup() { Serial.begin(9600); pinMode(7, OUTPUT); pinMode(8, INPUT); }
void loop() {
  digitalWrite(7, LOW); delayMicroseconds(2);
  digitalWrite(7, HIGH); delayMicroseconds(10);
  digitalWrite(7, LOW);
  long us = pulseIn(8, HIGH, 30000);
  Serial.print("cm="); Serial.println(us / 58);
  delay(100);
}
