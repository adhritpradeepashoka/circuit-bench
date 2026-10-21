// Adafruit_SSD1306 at 0x3C: a 10×10 block in the top-left corner and one pixel in the bottom-right.
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  Serial.begin(115200);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { Serial.println("no oled"); while (1); }
  display.clearDisplay();
  display.fillRect(0, 0, 10, 10, SSD1306_WHITE);
  display.drawPixel(127, 63, SSD1306_WHITE);
  display.display();
  Serial.println("drawn");
}

void loop() {}
