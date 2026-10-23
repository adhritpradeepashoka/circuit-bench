// Six-step drive of a bare brushless motor on pins 3, 4, 5 (U, V, W): one step every 1.6 ms.
// 100 → 110 → 010 → 011 → 001 → 101. Send 'r' over serial to run it backwards.
const int PH[3] = {3, 4, 5};
const byte SIX[6] = {0b100, 0b110, 0b010, 0b011, 0b001, 0b101};
int idx = 0, dir = 1;
void setup() {
  for (int i = 0; i < 3; i++) pinMode(PH[i], OUTPUT);
  Serial.begin(9600);
  Serial.println("go");
}
void loop() {
  if (Serial.available() && Serial.read() == 'r') dir = -dir;
  byte s = SIX[idx];
  for (int i = 0; i < 3; i++) digitalWrite(PH[i], (s >> (2 - i)) & 1);
  idx = (idx + dir + 6) % 6;
  delayMicroseconds(1600);
}
