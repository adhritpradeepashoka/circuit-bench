// Raw Wire access to an MPU-6050 at 0x68: is it there, who is it, then accel X/Y/Z every 100 ms.
#include <Wire.h>

void setup() {
  Serial.begin(115200);
  Wire.begin();
  Wire.beginTransmission(0x68);
  Serial.print("ack:"); Serial.println(Wire.endTransmission());
  Wire.beginTransmission(0x68); Wire.write(0x75); Wire.endTransmission(false);
  Wire.requestFrom(0x68, 1);
  Serial.print("who:"); Serial.println(Wire.read(), HEX);
  Wire.beginTransmission(0x68); Wire.write(0x6B); Wire.write(0); Wire.endTransmission();   // wake up
}

void loop() {
  Wire.beginTransmission(0x68); Wire.write(0x3B); Wire.endTransmission(false);
  Wire.requestFrom(0x68, 6);
  int16_t ax = Wire.read() << 8; ax |= Wire.read();
  int16_t ay = Wire.read() << 8; ay |= Wire.read();
  int16_t az = Wire.read() << 8; az |= Wire.read();
  Serial.print("a:"); Serial.print(ax); Serial.print(','); Serial.print(ay); Serial.print(','); Serial.println(az);
  delay(100);
}
