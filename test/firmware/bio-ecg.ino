// Samples A0 at 250 Hz for 3 seconds and reports the largest and smallest reading (a biosignal test).
void setup() {
  Serial.begin(9600);
  int hi = 0, lo = 1023;
  unsigned long next = micros();
  for (int i = 0; i < 750; i++) {
    while ((long)(micros() - next) < 0) {}
    next += 4000;
    int v = analogRead(A0);
    if (v > hi) hi = v;
    if (v < lo) lo = v;
  }
  Serial.print("max=");
  Serial.print(hi);
  Serial.print(" min=");
  Serial.println(lo);
}
void loop() {}
