void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(15, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  digitalWrite(15, HIGH);
  delay(100);
  digitalWrite(LED_BUILTIN, LOW);
  digitalWrite(15, LOW);
  delay(100);
}
