/**
 * ParkWise - Servo Gate Controller (Arduino Uno)
 * ============================================
 * 
 * Drives one servo gate based on serial commands from the ESP32-CAM.
 * Default boot state: OPEN (fail-open).
 * 
 * Wiring (per user diagram):
 * - Servo Signal (Orange) -> Pin 9
 * - Uno Pin 2 (RX) -> ESP32-CAM GPIO 14 (TX)
 * - Uno Pin 3 (TX) -> ESP32-CAM GPIO 13 (RX) via 1k/2k voltage divider
 * - Shared GND for all components
 * - External 5V for Servo (Red/Brown)
 */

#include <Servo.h>
#include <SoftwareSerial.h>

// SoftwareSerial mouth and ear: RX=2, TX=3
SoftwareSerial link(2, 3);

// Servo configuration
Servo gateServo;
const int SERVO_PIN = 9;

// Calibration: adjust these angles to fit your physical gate
const int OPEN_DEG = 90;
const int CLOSE_DEG = 0;

void applyGate(bool open) {
  int targetAngle = open ? OPEN_DEG : CLOSE_DEG;
  gateServo.write(targetAngle);
  Serial.print("Gate moved to: ");
  Serial.println(open ? "OPEN" : "CLOSED");
}

void setup() {
  // Debug serial (USB)
  Serial.begin(115200);
  
  // Link to ESP32-CAM (must match ESP32 speed)
  link.begin(9600);
  
  // Initialize servo
  gateServo.attach(SERVO_PIN);
  
  // Default state: OPEN (fail-open)
  applyGate(true);
  
  Serial.println("ParkWise Servo Gate ready (Fail-Open)");
}

void loop() {
  if (link.available()) {
    String cmd = link.readStringUntil('\n');
    cmd.trim();
    
    if (cmd == "OPEN 1") {
      applyGate(true);
      link.println("ACK OPEN 1");
    } 
    else if (cmd == "CLOSE 1") {
      applyGate(false);
      link.println("ACK CLOSE 1");
    }
  }
}
