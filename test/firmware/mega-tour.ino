// Exercises what differs on the Mega: LED_BUILTIN on PB7, millis() (Timer0's vector moved), Serial (USART0's vectors
// moved), a high pin (D40 on PORTG), analogRead on A8 (MUX5), PWM from Timer5 on D44, and I²C on 20/21.
#include <Wire.h>

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(40, OUTPUT);
  digitalWrite(40, HIGH);
  analogWrite(44, 64);
  Wire.begin();
  Wire.beginTransmission(0x68);
  Serial.print("ack:"); Serial.println(Wire.endTransmission());
  Serial.print("a8:"); Serial.println(analogRead(A8));
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH); delay(250);
  digitalWrite(LED_BUILTIN, LOW);  delay(250);
  Serial.print("t:"); Serial.println(millis());
}
