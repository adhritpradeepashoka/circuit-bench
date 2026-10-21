// The usual student sketch: Adafruit_MPU6050.
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Wire.h>

Adafruit_MPU6050 mpu;

void setup() {
  Serial.begin(115200);
  if (!mpu.begin()) { Serial.println("no mpu"); while (1) delay(10); }
  Serial.println("mpu ok");
}

void loop() {
  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);
  Serial.print("z:"); Serial.print(a.acceleration.z, 1);
  Serial.print(" x:"); Serial.print(a.acceleration.x, 1);
  Serial.print(" t:"); Serial.println(t.temperature, 0);
  delay(100);
}
