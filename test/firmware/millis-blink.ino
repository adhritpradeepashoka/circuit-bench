// Non-blocking blink driven by millis() — needs Timer0 overflow interrupts working.
unsigned long last = 0;
bool on = false;
void setup() { pinMode(LED_BUILTIN, OUTPUT); }
void loop() {
  if (millis() - last >= 250) {
    last += 250;
    on = !on;
    digitalWrite(LED_BUILTIN, on);
  }
}
