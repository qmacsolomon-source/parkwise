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


class SetCameraTargetRequest(BaseModel):
    slot_ref: str


class HealthResponse(BaseModel):
    status: str
    agent_count: int
    uptime_seconds: float


class ConfigResponse(BaseModel):
    grace_period_seconds: int


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


@app.get("/config", response_model=ConfigResponse)
async def get_config():
    """
    Expose config the desktop console needs to render accurately, rather
    than hardcoding a guess that can drift from this service's own .env.
    PlateVerification.tsx's grace-period countdown used to hardcode 60
    seconds while the live .env's GRACE_PERIOD_SECONDS was actually 900 -
    the UI hit zero 14 minutes before the real timer (_grace_period_timer()
    in agent.py) would ever fire.
    """
    return ConfigResponse(grace_period_seconds=settings.grace_period_seconds)


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

        # Normally the camera's own slot. While a camera target is set (see
        # /camera/target), every frame is redirected there instead - lets
        # one real camera simulate whichever slot the attendant is testing.
        target_slot_id = agent_manager.resolve_camera_target(slot['id'])

        logger.info(
            "Raw frame received",
            camera_slot_code=slot['slot_code'],
            target_slot_id=target_slot_id,
            size=len(frame_data),
        )
        await agent_manager.process_frame(target_slot_id, frame_data)

        return JSONResponse(content={"status": "processed", "slot_code": slot['slot_code']})

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to process raw frame", slot_ref=slot_ref, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/camera/target")
async def set_camera_target(request: SetCameraTargetRequest):
    """
    Point the one real camera's incoming frames at a slot other than its own
    hardcoded SLOT_CODE.

    With only one physical ESP32-CAM available for testing, its firmware
    always posts frames tagged with whatever slot it was flashed for. This
    lets the desktop console redirect every incoming frame to a different
    slot instead - the attendant just clicks Start Verification on whichever
    slot they're testing (see PlateVerification.tsx), and this gets called
    first so that slot's agent actually starts receiving real frames.

    Does NOT touch whatever slot the camera was previously pointed at -
    release_vehicle() resets slots.status to 'available' unconditionally,
    so auto-releasing it here could desync a slot that still has a genuinely
    live reservation. The old target just stops receiving frames and keeps
    showing its last captured photo until released some other way.
    """
    try:
        target_slot = await Database.resolve_slot(request.slot_ref)
        if not target_slot:
            raise HTTPException(status_code=404, detail=f"Unknown slot: {request.slot_ref}")

        agent_manager.set_camera_target(target_slot['id'])
        logger.info("Camera retargeted", slot_id=target_slot['id'], slot_code=target_slot['slot_code'])

        return JSONResponse(content={
            "status": "retargeted",
            "slot_id": target_slot['id'],
            "slot_code": target_slot['slot_code'],
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to set camera target", slot_ref=request.slot_ref, error=str(e))
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
