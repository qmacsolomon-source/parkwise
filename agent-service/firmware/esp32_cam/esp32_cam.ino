/**
 * ParkWise - ESP32-CAM frame sender
 * ==================================
 *
 * Captures a JPEG from the OV2640 and POSTs it as a RAW body to the agent
 * service endpoint `POST /frames/<SLOT_CODE>/raw`.
 *
 * Why raw and not multipart: the service's other endpoint
 * (`POST /frames/{slot_id}`) expects multipart/form-data with a field named
 * "file", which the ESP32 HTTPClient cannot build without hand-rolling the
 * boundary. The `/raw` endpoint reads the request body directly, so
 * `http.POST(fb->buf, fb->len)` works as-is.
 *
 * Board:   "AI Thinker ESP32-CAM" (Arduino ESP32 core 2.x or 3.x)
 * Wiring:  none -- the camera is the only input. No external parts.
 *
 * Before flashing, set WIFI_SSID / WIFI_PASSWORD / AGENT_HOST / SLOT_CODE.
 * AGENT_HOST must be the LAN IP of the machine running the agent-service
 * (the ESP32 and that machine have to be on the same network).
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_camera.h"

// ---------------------------------------------------------------------------
// CONFIGURE ME
// ---------------------------------------------------------------------------
static const char* WIFI_SSID     = "your_wifi";
static const char* WIFI_PASSWORD = "your_password";

// LAN address of the machine running `uvicorn main:app --host 0.0.0.0 --port 8000`
static const char* AGENT_HOST = "192.168.1.20";
static const int   AGENT_PORT = 8000;

// Parking slot this camera watches. Either the slot code ("1A1") or the slot
// UUID works -- the service resolves both.
static const char* SLOT_CODE = "1A1";

// How often to capture and send a frame. The camera is the only sensor, so it
// polls continuously; must be greater than 0.
static const unsigned long SEND_INTERVAL_MS = 15000;

// ---------------------------------------------------------------------------
// AI-Thinker ESP32-CAM camera pin map
// ---------------------------------------------------------------------------
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define Y1_GPIO_NUM        4
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

static unsigned long lastSendAt = 0;

// --- Camera -----------------------------------------------------------------
bool initCamera() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // VGA is enough for plate detection and keeps the POST small.
  if (psramFound()) {
    config.frame_size   = FRAMESIZE_VGA;
    config.jpeg_quality = 12;
    config.fb_count     = 2;
  } else {
    config.frame_size   = FRAMESIZE_QVGA;
    config.jpeg_quality = 15;
    config.fb_count     = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[cam] init failed: 0x%04X\n", err);
    return false;
  }

  // Some AI-Thinker boards mount the camera module upside-down - confirmed
  // visually via a live-stream test sketch on real hardware. If your board
  // captures right-side-up already, remove these two lines.
  sensor_t *s = esp_camera_sensor_get();
  s->set_vflip(s, 1);
  s->set_hmirror(s, 1);

  Serial.println("[cam] ready");
  return true;
}

// --- WiFi -------------------------------------------------------------------
void connectWiFi() {
  Serial.printf("[wifi] connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 30000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[wifi] connected, ip=%s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[wifi] failed, will retry");
  }
}

// --- Upload -----------------------------------------------------------------
bool sendFrame() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    if (WiFi.status() != WL_CONNECTED) return false;
  }

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[cam] capture failed");
    return false;
  }

  char url[128];
  snprintf(url, sizeof(url), "http://%s:%d/frames/%s/raw", AGENT_HOST, AGENT_PORT, SLOT_CODE);

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(15000);

  bool ok = false;
  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "image/jpeg");
    int status = http.POST(fb->buf, fb->len);

    if (status > 0) {
      Serial.printf("[post] %s -> HTTP %d (%u bytes)\n", SLOT_CODE, status, (unsigned)fb->len);
      ok = (status >= 200 && status < 300);
      if (!ok) Serial.println(http.getString());
    } else {
      Serial.printf("[post] failed: %s\n", http.errorToString(status).c_str());
    }
    http.end();
  } else {
    Serial.println("[post] could not begin request");
  }

  esp_camera_fb_return(fb);
  return ok;
}

// --- Arduino ----------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(600);
  Serial.println("\n=== ParkWise ESP32-CAM ===");
  Serial.printf("slot=%s agent=http://%s:%d\n", SLOT_CODE, AGENT_HOST, AGENT_PORT);

  if (!initCamera()) {
    Serial.println("[cam] halting");
    while (true) delay(1000);
  }

  connectWiFi();
}

void loop() {
  if (millis() - lastSendAt >= SEND_INTERVAL_MS) {
    lastSendAt = millis();
    sendFrame();
  }

  delay(50);
}
