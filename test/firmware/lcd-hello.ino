// 16x2 I2C LCD (PCF8574 backpack at 0x27) with the real LiquidCrystal_I2C library: text, a custom character, scrolling.
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);
byte heart[8] = {0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000};

void setup() {
  Serial.begin(115200);
  lcd.init();
  lcd.backlight();
  lcd.createChar(0, heart);
  lcd.setCursor(0, 0);
  lcd.print("Hello, world!");
  lcd.setCursor(2, 1);
  lcd.write(0);
  lcd.print(" CircuitBench");
  Serial.println("drawn");
  delay(500);
  lcd.clear();
  lcd.print("Count:");
}

int n = 0;
void loop() {
  lcd.setCursor(7, 0);
  lcd.print(n++);
  delay(100);
}
