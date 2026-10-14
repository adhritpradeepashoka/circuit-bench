void setup() {
  pinMode(9, OUTPUT); pinMode(6, OUTPUT); pinMode(3, OUTPUT); pinMode(5, OUTPUT);
  analogWrite(9, 128);
  analogWrite(6, 64);
  analogWrite(3, 255);
  analogWrite(5, 0);
}
void loop() {}
