// Digit "3" on a 7-segment display (D2..D9 = A B C D E F G DP) and magenta on an RGB LED (A0 red, A1 green, A2 blue).
void setup() {
  for (int p = 2; p <= 9; p++) pinMode(p, OUTPUT);
  pinMode(A0, OUTPUT); pinMode(A1, OUTPUT); pinMode(A2, OUTPUT);
  digitalWrite(2, HIGH); digitalWrite(3, HIGH); digitalWrite(4, HIGH); digitalWrite(5, HIGH); digitalWrite(8, HIGH);
  digitalWrite(A0, HIGH); digitalWrite(A2, HIGH);
}
void loop() {}
