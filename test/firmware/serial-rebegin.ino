// Calling Serial.begin() again (the common "while(!Serial); Serial.begin(...)" idiom, or a rate change) must not silence later output
void setup() {
  Serial.begin(115200); Serial.println("a"); delay(50);
  Serial.begin(9600);   Serial.println("b"); delay(50);
  Serial.end(); Serial.begin(9600); Serial.println("c");
}
void loop() {}
