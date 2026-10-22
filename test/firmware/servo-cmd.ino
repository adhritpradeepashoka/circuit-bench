#include <Servo.h>
Servo s;
void setup() { Serial.begin(9600); s.attach(9); s.write(90); }
void loop() {
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'a') s.write(0);
    if (c == 'b') s.write(90);
    if (c == 'c') s.write(180);
    Serial.println("ok");
  }
}
