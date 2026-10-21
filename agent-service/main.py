from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import uvicorn
from config import settings
from logger import configure_logger, get_logger
from agent_manager import get_agent_manager
from database import Database

# Configure logging
configure_logger()
logger = get_logger(__name__)

# Create FastAPI app
app = FastAPI(
    title="ParkWise Agent Service",
    description="Intelligent parking slot agents for license plate recognition",
    version="1.0.0"
)

# The desktop console (http://localhost:5173) and this service
# (http://localhost:8000) are different origins, so without CORS headers
# every fetch() call from the browser - Accept Vehicle, Confirm Match, Retry
# Capture, Release - is blocked outright with "Failed to fetch" before the
# request even reaches a route handler. Wide open ("*") rather than a fixed
# origin list: this is a LAN-only testing tool with no auth on its own
# endpoints already (see README), so there is nothing an open CORS policy
# exposes that an open API did not already.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Agent manager
agent_manager = get_agent_manager()


class AcceptVehicleRequest(BaseModel):
    expected_plate: str


class HealthResponse(BaseModel):
    status: str
    agent_count: int
    uptime_seconds: float


@app.on_event("startup")
async def startup_event():
    """Initialize agent manager on startup."""
    logger.info("Starting ParkWise Agent Service")
    await agent_manager.initialize()
    await agent_manager.start()


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("Shutting down ParkWise Agent Service")
    await agent_manager.stop()


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    states = agent_manager.get_all_states()
    return HealthResponse(
        status="healthy",
        agent_count=len(states),
        uptime_seconds=0.0  # TODO: track actual uptime
    )


@app.post("/frames/{slot_id}")
async def receive_frame(slot_id: str, file: UploadFile = File(...)):
    """
    Receive camera frame from ESP32-CAM.
    Processes frame through plate recognition pipeline.
    """
    try:
        # Validate file type
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Invalid file type. Must be an image.")
        
        # Read file data
        frame_data = await file.read()
        
        logger.info("Frame received", slot_id=slot_id, size=len(frame_data))
        
        # Process frame
        await agent_manager.process_frame(slot_id, frame_data)
        
        return JSONResponse(content={"status": "processed", "slot_id": slot_id})
        
    except Exception as e:
        logger.error("Failed to process frame", slot_id=slot_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/frames/{slot_ref}/raw")
async def receive_frame_raw(slot_ref: str, request: Request):
    """
    Receive a raw JPEG body from an ESP32-CAM (no multipart wrapper).

    ESP32 HTTPClient can POST a camera buffer directly, but cannot easily build
    multipart/form-data, so this is the endpoint firmware should target. The
    UploadFile variant above requires a multipart field named "file", which is
    what the desktop simulator uses.

    `slot_ref` may be a slot_code ("1A1") or a slot UUID.
    """
    try:
        frame_data = await request.body()
        if not frame_data:
            raise HTTPException(status_code=400, detail="Empty frame body")

        slot = await Database.resolve_slot(slot_ref)
        if not slot:
            raise HTTPException(status_code=404, detail=f"Unknown slot: {slot_ref}")

        logger.info("Raw frame received", slot_code=slot['slot_code'], size=len(frame_data))
        await agent_manager.process_frame(slot['id'], frame_data)

        return JSONResponse(content={"status": "processed", "slot_code": slot['slot_code']})

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to process raw frame", slot_ref=slot_ref, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/beam/{slot_id}")
async def beam_trigger(slot_id: str):
    """
    Manual detection trigger from the desktop console's "trigger capture" action.

    The ESP32 firmware has no beam sensor -- the camera captures and sends its
    own frames on a timer -- so this route only logs the event.
    """
    try:
        logger.info("Beam triggered", slot_id=slot_id)
        
        # In a real implementation, this would trigger the camera to capture
        # For now, we just log the event
        # The ESP32-CAM should capture and send the frame separately
        
        return JSONResponse(content={"status": "triggered", "slot_id": slot_id})
        
    except Exception as e:
        logger.error("Failed to process beam trigger", slot_id=slot_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/agents/{slot_id}/accept")
async def accept_vehicle(slot_id: str, request: AcceptVehicleRequest):
    """
    Attendant accepts a vehicle into the slot.
    Sets expected plate and starts verification process.
    """
    try:
        logger.info("Vehicle accept request", slot_id=slot_id, expected_plate=request.expected_plate)
        
        await agent_manager.accept_vehicle(slot_id, request.expected_plate)
        
        return JSONResponse(content={"status": "accepted", "slot_id": slot_id})
        
    except Exception as e:
        logger.error("Failed to accept vehicle", slot_id=slot_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/agents/{slot_id}/release")
async def release_vehicle(slot_id: str):
    """
    Attendant releases vehicle from slot.
    Resets agent to idle state.
    """
    try:
        logger.info("Vehicle release request", slot_id=slot_id)
        
        await agent_manager.release_vehicle(slot_id)
        
        return JSONResponse(content={"status": "released", "slot_id": slot_id})
        
    except Exception as e:
        logger.error("Failed to release vehicle", slot_id=slot_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/agents/{slot_id}/confirm")
async def confirm_vehicle(slot_id: str):
    """
    Attendant manually confirms the vehicle from the live photo, overriding
    the OCR match/confidence check. Used when the detected plate either
    didn't match or wasn't read confidently enough to auto-verify, but the
    attendant can see from the camera frame that it's correct.
    """
    try:
        logger.info("Vehicle confirm request", slot_id=slot_id)

        await agent_manager.confirm_vehicle(slot_id)

        return JSONResponse(content={"status": "confirmed", "slot_id": slot_id})

    except Exception as e:
        logger.error("Failed to confirm vehicle", slot_id=slot_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/agents/{slot_id}/state")
async def get_agent_state(slot_id: str):
    """
    Get current state of agent for specific slot.
    """
    try:
        state = await agent_manager.get_agent_state(slot_id)
        return JSONResponse(content=state)
        
    except Exception as e:
        logger.error("Failed to get agent state", slot_id=slot_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/agents")
async def get_all_agent_states():
    """
    Get states of all agents.
    """
    try:
        states = agent_manager.get_all_states()
        return JSONResponse(content=states)
        
    except Exception as e:
        logger.error("Failed to get all agent states", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        reload=True
    )
