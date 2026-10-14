void setup() { pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, analogRead(A0) > 512 ? HIGH : LOW); delay(5); }
