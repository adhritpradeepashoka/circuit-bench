// The classic over-budget pairing: Adafruit_MPU6050 + Adafruit_SSD1306 128×64 on a 2 KB Uno.
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_MPU6050.h>
Adafruit_SSD1306 d(128, 64, &Wire, -1);
Adafruit_MPU6050 mpu;
void setup() { d.begin(SSD1306_SWITCHCAPVCC, 0x3C); mpu.begin(); d.setTextColor(SSD1306_WHITE); }
void loop() {
  sensors_event_t a, g, t; mpu.getEvent(&a, &g, &t);
  d.clearDisplay(); d.setTextSize(1); d.setCursor(0, 0); d.println("CircuitBench IMU");
  d.setTextSize(2); d.setCursor(0, 16); d.print("X "); d.println(a.acceleration.x, 1);
  d.print("Z "); d.println(a.acceleration.z, 1);
  d.display(); delay(100);
}
