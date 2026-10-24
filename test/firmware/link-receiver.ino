// Board B: reads what board A sends (RX = D0) and lights D13 when it hears a line
String line;
void setup() { pinMode(13, OUTPUT); Serial.begin(9600); }
void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { digitalWrite(13, line.startsWith("msg:") ? HIGH : LOW); line = ""; }
    else if (c != '\r') line += c;
  }
}
