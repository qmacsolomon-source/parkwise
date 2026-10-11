# ParkWise Agent Service

Intelligent parking slot agents for license plate recognition using YOLOv5 + EasyOCR, connected to the ParkWise Supabase database.

## Architecture

- **Per-Slot Agents**: Each parking slot has an independent agent running as a concurrent asyncio task
- **Model-Based**: Goal-based agents with internal state (expected_plate, accepted_at, elapsed time)
- **No Coordination**: Agents operate independently without inter-agent communication
- **Recognition Pipeline**: YOLOv5 detects plate region → EasyOCR reads text → Normalization → Fuzzy matching

## Features

- **Plate Recognition**: YOLOv5 detection + EasyOCR OCR with confidence scoring
- **State Machine**: idle → waiting → verifying → verified → alert
- **Retry Policy**: Up to 3 frames per grace window for verification
- **Overstay Detection**: Monitors reservation end time and alerts on overstay
- **PWD Verification**: Checks PWD permit status for PWD slots
- **Frame Storage**: Saves frames to Supabase Storage
- **Structured Logging**: JSON logging with context
- **Simulator**: Test without hardware
- **Evaluation Script**: Accuracy testing on labeled images

## Prerequisites

- Python 3.9+
- CUDA-capable GPU (optional, for faster inference)
- Supabase project (shared with ParkWise main system)
- YOLOv5 model file (download or train your own)

## Installation

### 1. Create Virtual Environment

```bash
cd agent-service
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure Environment

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

### 4. Download YOLOv5 Model

Option 1: Use pre-trained model (recommended for testing):
```bash
mkdir models
# The model will be auto-downloaded from torch.hub on first run
```

Option 2: Train your own model (for production):
- Follow YOLOv5 training guide: https://github.com/ultralytics/yolov5
- Place trained model at `models/yolov5s.pt`

### 5. Create Storage Bucket

In Supabase dashboard:
1. Go to Storage
2. Create a new bucket named `frames`
3. Make it public (or configure as needed)

## Running the Service

### Development Mode

```bash
python main.py
```

The service will start at `http://localhost:8000`

### Production Mode

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

## API Endpoints

### POST /frames/{slot_id}
Receive camera frame from ESP32-CAM.

**Request**: Multipart form data with `file` field (JPEG image)

**Response**:
```json
{
  "status": "processed",
  "slot_id": "uuid"
}
```

### POST /beam/{slot_id}
Trigger from infrared break-beam sensor.

**Response**:
```json
{
  "status": "triggered",
  "slot_id": "uuid"
}
```

### POST /agents/{slot_id}/accept
Attendant accepts a vehicle into the slot.

**Request Body**:
```json
{
  "expected_plate": "ABC1234"
}
```

**Response**:
```json
{
  "status": "accepted",
  "slot_id": "uuid"
}
```

### POST /agents/{slot_id}/release
Attendant releases vehicle from slot.

**Response**:
```json
{
  "status": "released",
  "slot_id": "uuid"
}
```

### GET /agents/{slot_id}/state
Get current state of specific agent.

**Response**:
```json
{
  "slot_id": "uuid",
  "state": "verifying",
  "expected_plate": "ABC1234",
  "accepted_at": "2024-01-01T12:00:00",
  "detected_plate": "ABC1234",
  "confidence": 0.95,
  "reservation_id": "uuid",
  "verified_at": "2024-01-01T12:01:00"
}
```

### GET /agents
Get states of all agents.

**Response**: JSON object with slot_id as keys and state objects as values.

### GET /health
Health check endpoint.

**Response**:
```json
{
  "status": "healthy",
  "agent_count": 20,
  "uptime_seconds": 3600
}
```

## Agent State Machine

```
IDLE → (attendant accepts) → WAITING → (frame received) → VERIFYING
VERIFYING → (match) → VERIFIED
VERIFYING → (no match, retry < 3) → VERIFYING
VERIFYING → (no match, retry >= 3) → ALERT
WAITING → (grace period expires) → ALERT
VERIFIED → (overstay detected) → ALERT
ALERT → (attendant releases) → IDLE
VERIFIED → (attendant releases) → IDLE
```

## Configuration

Edit `.env` to configure:

```env
# Agent Configuration
GRACE_PERIOD_SECONDS=60              # Time to verify after acceptance
OVERSTAY_CHECK_INTERVAL_SECONDS=30   # How often to check for overstay
FUZZY_MATCH_THRESHOLD=0.85           # Similarity threshold for match
MAX_RETRY_ATTEMPTS=3                 # Max frames to try for verification
FRAME_STORAGE_BUCKET=frames          # Supabase Storage bucket name

# Model Configuration
YOLO_MODEL_PATH=models/yolov5s.pt   # Path to YOLOv5 model
OCR_GPU=true                          # Use GPU for OCR (if available)

# Server Configuration
HOST=0.0.0.0
PORT=8000
LOG_LEVEL=INFO                       # DEBUG, INFO, WARNING, ERROR, JSON
```

## Testing

### Using the Simulator

Test without hardware using sample images:

```bash
# Multi-slot simulation
python simulator.py --test-dir test_images --slot-ids slot-1 slot-2 --duration 60

# Test accept/release flow
python simulator.py --mode accept-release

# Test beam trigger
python simulator.py --mode beam
```

### Evaluation Script

Test recognition accuracy on labeled images:

1. Create test directory with images:
```
test_images/
  image1.jpg
  image1.txt  (contains ground truth plate: ABC1234)
  image2.jpg
  image2.txt
  ...
```

2. Run evaluation:
```bash
python evaluate.py --test-dir test_images --output results.json --report report.txt
```

3. Review results:
- `results.json`: Detailed JSON results
- `report.txt`: Human-readable report

## ESP32-CAM Integration

### Hardware Setup

- ESP32-CAM with OV2640 camera
- Infrared break-beam sensor (optional)
- WiFi connection

### Firmware Code

Send JPEG frames to the agent service:

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <base64.h>

const char* ssid = "your_wifi";
const char* password = "your_password";
const char* agentUrl = "http://your-agent-ip:8000";

void sendFrame() {
  HTTPClient http;
  String url = String(agentUrl) + "/frames/YOUR_SLOT_ID";
  
  http.begin(url);
  http.addHeader("Content-Type", "image/jpeg");
  
  // Capture frame from camera
  camera_fb_t* fb = esp_camera_fb_get();
  
  int httpResponseCode = http.POST(fb->buf, fb->len);
  
  esp_camera_fb_return(fb);
  http.end();
}
```

### Break-Beam Sensor

Trigger frame capture when beam is broken:

```cpp
void IRAM_ATTR onBeamBreak() {
  sendFrame();
}

void setup() {
  pinMode(BEAM_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(BEAM_PIN), onBeamBreak, FALLING);
}
```

## Monitoring

### Logs

Logs are structured JSON (or console in dev mode):

```bash
# View logs
tail -f logs/agent.log

# Filter by slot
grep "slot_id=abc123" logs/agent.log

# Filter by level
grep "level=error" logs/agent.log
```

### Metrics

Check agent states via API:

```bash
curl http://localhost:8000/agents
curl http://localhost:8000/health
```

### Supabase Realtime

Agent states are synced to Supabase in real-time. Monitor via:
- Supabase Dashboard > Database > agent_states table
- Desktop console (shows live agent states)

## Troubleshooting

### Model Loading Issues

If YOLOv5 fails to load:
```bash
# Clear torch cache
rm -rf ~/.cache/torch/hub/

# Re-run service
python main.py
```

### OCR Too Slow

Disable GPU if causing issues:
```env
OCR_GPU=false
```

### Storage Upload Fails

Check:
1. Storage bucket exists in Supabase
2. Service role key has storage permissions
3. Bucket is public or has correct policies

### High Memory Usage

Reduce batch size or use smaller YOLO model:
```env
YOLO_MODEL_PATH=models/yolov5n.pt  # nano model
```

## Performance

### Expected Performance

- **Plate Detection**: 50-100ms per frame (GPU), 200-500ms (CPU)
- **OCR**: 100-200ms per plate (GPU), 500-1000ms (CPU)
- **Total Pipeline**: 150-300ms per frame (GPU), 700-1500ms (CPU)

### Optimization Tips

1. Use GPU for production
2. Reduce image resolution before processing
3. Use YOLOv5n (nano) for faster inference
4. Batch process frames if possible
5. Cache model in memory (already done)

## Security

- Use HTTPS in production
- Protect agent service behind firewall
- Use service role key only on trusted servers
- Validate slot IDs against database
- Rate limit frame uploads

## Deployment

### Docker

```dockerfile
FROM python:3.9-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Build and run:
```bash
docker build -t parkwise-agent .
docker run -p 8000:8000 --env-file .env parkwise-agent
```

### Systemd Service

Create `/etc/systemd/system/parkwise-agent.service`:

```ini
[Unit]
Description=ParkWise Agent Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/parkwise-agent
Environment="PATH=/opt/parkwise-agent/venv/bin"
ExecStart=/opt/parkwise-agent/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable parkwise-agent
sudo systemctl start parkwise-agent
sudo systemctl status parkwise-agent
```

## License

Part of the ParkWise project.
