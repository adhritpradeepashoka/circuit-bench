const byte seg[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};
void setup() { for (int p = 2; p <= 9; p++) pinMode(p, OUTPUT); }
void loop() {
  for (int n = 0; n < 10; n++) {
    for (int i = 0; i < 8; i++) digitalWrite(2 + i, (seg[n] >> i) & 1);
    delay(400);
  }
}
