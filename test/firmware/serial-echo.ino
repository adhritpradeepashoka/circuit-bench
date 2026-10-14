// Serial TX + RX: greets, then echoes what it receives in upper case.
void setup() {
  Serial.begin(9600);
  Serial.println("Hello from Arduino");
}
void loop() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c >= 'a' && c <= 'z') c = c - 32;
    Serial.write(c);
  }
}
