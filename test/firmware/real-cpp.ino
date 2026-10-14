// Language features the old mini-compiler could not build: float, long, String, math, struct, class.
struct Point { int x; int y; };
class Counter {
  public:
    Counter() : n(0) {}
    long next() { n += 100000L; return n; }
  private:
    long n;
};
void setup() {
  Serial.begin(9600);
  float r = sqrt(2.0);
  Serial.println(r, 4);
  Counter c;
  c.next(); c.next();
  Serial.println(c.next());
  Point p = {3, 4};
  Serial.println(p.x * p.x + p.y * p.y);
  String s = "abc";
  s += String(42);
  s.toUpperCase();
  Serial.println(s);
  Serial.println(millis() < 1000UL ? "early" : "late");
}
void loop() {}
