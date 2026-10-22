// DHT22 on D7 with the real Adafruit DHT library.
#include <DHT.h>

DHT dht(7, DHT22);

void setup() {
  Serial.begin(115200);
  dht.begin();
}

void loop() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h) || isnan(t)) Serial.println("fail");
  else { Serial.print("t:"); Serial.print(t, 1); Serial.print(" h:"); Serial.println(h, 1); }
  delay(2100);
}
