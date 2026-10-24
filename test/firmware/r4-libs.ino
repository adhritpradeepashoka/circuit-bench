// An R4 sketch that includes libraries: the compatibility header must not break Arduino's library discovery
#include <Wire.h>
#include <Servo.h>
Servo s;
void setup() { Serial.begin(9600); Wire.begin(); s.attach(9); analogReadResolution(14); }
void loop() { s.write(90); Serial.println(analogRead(A0)); delay(100); }
