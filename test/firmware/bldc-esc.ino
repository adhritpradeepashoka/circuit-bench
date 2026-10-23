// Hobby brushless ESC on pin 9: arm with 1000 us for about a second, then ramp to 1500 us (half throttle).
#include <Servo.h>
Servo esc;
void setup() {
  Serial.begin(9600);
  esc.attach(9);
  esc.writeMicroseconds(1000);
  delay(1500);
  Serial.println("armed");
  esc.writeMicroseconds(1500);
}
void loop() {}
