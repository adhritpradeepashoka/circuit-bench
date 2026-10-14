// Hold the button (D2 to GND) to light the LED on D13.
void setup() { pinMode(2, INPUT_PULLUP); pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, digitalRead(2) == LOW ? HIGH : LOW); }
