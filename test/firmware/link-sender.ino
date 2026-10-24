// Board A: sends a line every 200 ms on its hardware serial (TX = D1)
int n = 0;
void setup() { Serial.begin(9600); }
void loop() { Serial.print("msg:"); Serial.println(n++); delay(200); }
