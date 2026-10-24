void setup() {
  Serial.begin(115200);
  pinMode(16, INPUT_PULLUP);
  pinMode(14, OUTPUT);
  analogWrite(13, 128);
}

void loop() {
  int a = analogRead(A0);
  int b = digitalRead(16);
  digitalWrite(14, b ? LOW : HIGH);
  Serial.print("adc=");
  Serial.print(a);
  Serial.print(" btn=");
  Serial.println(b);
  delay(50);
}
