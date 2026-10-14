// Reads A0 every 100 ms and prints "A0=<raw> <mapped>".
void setup() { Serial.begin(9600); }
void loop() {
  int raw = analogRead(A0);
  Serial.print("A0=");
  Serial.print(raw);
  Serial.print(" ");
  Serial.println(map(raw, 0, 1023, 0, 255));
  delay(100);
}
