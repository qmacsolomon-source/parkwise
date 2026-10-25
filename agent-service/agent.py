import asyncio
from datetime import datetime, timedelta
from typing import Optional
from enum import Enum
from config import settings
from logger import get_logger
from database import Database
from plate_recognition import get_plate_recognizer
from matching import is_match
from storage import Storage

logger = get_logger(__name__)


class AgentState(Enum):
    IDLE = "idle"
    WAITING = "waiting"
    VERIFYING = "verifying"
    VERIFIED = "verified"
    ALERT = "alert"


class SlotAgent:
    """
    Independent agent for a single parking slot.
    Runs as an asyncio task with its own state machine.
    """
    
    def __init__(self, slot_id: str):
        self.slot_id = slot_id
        self.state = AgentState.IDLE
        self.expected_plate: Optional[str] = None
        self.accepted_at: Optional[datetime] = None
        self.detected_plate: Optional[str] = None
        self.confidence: float = 0.0
        self.retry_count = 0
        self.last_frame: Optional[bytes] = None
        self.last_frame_time: Optional[datetime] = None
        self.reservation_id: Optional[str] = None
        self.verified_at: Optional[datetime] = None
        self.overstay_timer: Optional[asyncio.Task] = None
        self.grace_timer: Optional[asyncio.Task] = None

        # process_frame() has several await points (Storage upload, DB
        # calls) with shared mutable state (detected_plate, confidence,
        # retry_count, state) read and written across them. Two frames for
        # this slot landing close together without this lock could
        # interleave - frame B's detection could overwrite frame A's before
        # A's own check runs, or both could pass the match check and both
        # call _verify_success(), producing duplicate verification_event
        # rows. Low likelihood given the camera's send interval, but
        # nothing server-side enforced that spacing.
        self._frame_lock = asyncio.Lock()

        logger.info("SlotAgent initialized", slot_id=slot_id)
    
    async def initialize(self):
        """Initialize agent from database state."""
        try:
            # Get current agent state from database
            db_state = await Database.get_agent_state(self.slot_id)
            if db_state:
                self.state = AgentState(db_state['state'])
                self.expected_plate = db_state.get('expected_plate')
                # Supabase returns timestamp columns as ISO strings, not
                # datetime objects - accept_vehicle() sets this field as a
                # real datetime, so get_state_dict()'s .isoformat() call
                # crashes on an agent reloaded from the database unless this
                # is parsed back into one here.
                accepted_at_raw = db_state.get('accepted_at')
                self.accepted_at = (
                    datetime.fromisoformat(accepted_at_raw) if accepted_at_raw else None
                )
                self.detected_plate = db_state.get('detected_plate')
                self.confidence = db_state.get('confidence', 0.0)
                self.reservation_id = await self._get_active_reservation_id()
                
                logger.info("Agent initialized from database", slot_id=self.slot_id, 
                           state=self.state.value)
            
            # Start overstay monitoring if verified
            if self.state == AgentState.VERIFIED and self.reservation_id:
                self._start_overstay_monitoring()
                
        except Exception as e:
            logger.error("Failed to initialize agent", slot_id=self.slot_id, error=str(e))
    
    async def _get_active_reservation_id(self) -> Optional[str]:
        """Get active reservation for this slot."""
        reservation = await Database.get_active_reservation(self.slot_id)
        return reservation['id'] if reservation else None

    async def arm_from_reservation(self) -> bool:
        """
        Auto-arm this slot from its live reservation.

        Used by the ESP32-CAM path: instead of waiting for an attendant to press
        "accept", the expected plate is taken from the vehicle on the slot's live
        reservation. Returns True when the agent was armed.
        """
        reservation = await Database.get_live_reservation(self.slot_id)
        if not reservation:
            logger.debug("No live reservation to arm from", slot_id=self.slot_id)
            return False

        vehicle = await Database.get_vehicle_by_id(reservation['vehicle_id'])
        if not vehicle or not vehicle.get('plate_number'):
            logger.warning("Live reservation has no readable vehicle",
                           slot_id=self.slot_id, reservation_id=reservation['id'])
            return False

        await self.accept_vehicle(vehicle['plate_number'], reservation_id=reservation['id'])
        logger.info("Agent auto-armed from reservation", slot_id=self.slot_id,
                    expected_plate=vehicle['plate_number'])
        return True

    async def accept_vehicle(self, expected_plate: str, reservation_id: Optional[str] = None):
        """
        Attendant accepts a vehicle into the slot.
        Sets expected plate and transitions to WAITING state.
        """
        logger.info("Vehicle accepted", slot_id=self.slot_id, expected_plate=expected_plate)

        self.expected_plate = expected_plate
        self.accepted_at = datetime.utcnow()
        self.state = AgentState.WAITING
        self.retry_count = 0
        # Use the caller's own reservation_id when it already found one - the
        # ESP32 auto-arm path (arm_from_reservation()) looks up ANY live
        # reservation (pending/active/verified/overstay), not just 'active'
        # ones, specifically so a car can be auto-armed before an attendant
        # has ever clicked Accept. Re-deriving it here via the 'active'-only
        # lookup instead would silently discard that - the attendant-click
        # paths (Plate Verification, Manual Entry) always set the
        # reservation to 'active' before calling this, so the fallback
        # lookup still works correctly for them.
        self.reservation_id = reservation_id if reservation_id is not None else await self._get_active_reservation_id()
        
        # Update database
        await Database.update_agent_state(self.slot_id, {
            'state': self.state.value,
            'expected_plate': self.expected_plate,
            'accepted_at': self.accepted_at.isoformat(),
            'detected_plate': None,
            'confidence': None
        })
        
        # Start grace period timer. Cancel any previous one first - every
        # accept_vehicle() call (including a re-accept/retry) used to spawn a
        # brand new timer without ever cancelling the last one, so repeated
        # accept/release cycles on the same slot left old timers sleeping in
        # the background. Each one only checks "is the agent WAITING right
        # now" with no way to tell it apart from a later, unrelated cycle -
        # so a stale timer from minutes earlier could (and did) fire a
        # grace_period_expired alert on a completely fresh accept, seconds
        # after it was armed.
        if self.grace_timer:
            self.grace_timer.cancel()
        self.grace_timer = asyncio.create_task(self._grace_period_timer())
    
    async def release_vehicle(self):
        """
        Attendant releases vehicle from slot.
        Resets to IDLE state.
        """
        logger.info("Vehicle released", slot_id=self.slot_id)

        # Cancel overstay timer if running
        if self.overstay_timer:
            self.overstay_timer.cancel()
            self.overstay_timer = None

        # Cancel grace period timer if running
        if self.grace_timer:
            self.grace_timer.cancel()
            self.grace_timer = None
        
        # Reset state
        self.state = AgentState.IDLE
        self.expected_plate = None
        self.accepted_at = None
        self.detected_plate = None
        self.confidence = 0.0
        self.retry_count = 0
        self.reservation_id = None
        self.verified_at = None
        
        # Update database
        await Database.update_agent_state(self.slot_id, {
            'state': self.state.value,
            'expected_plate': None,
            'accepted_at': None,
            'detected_plate': None,
            'confidence': None
        })
        
        # Update slot status
        await Database.update_slot_status(self.slot_id, 'available', None)

    def suspend_grace_timer(self):
        """
        Cancel the grace-period timer without touching anything else -
        used when the one real camera gets pointed at a different slot
        (see AgentManager.set_camera_target()) while this slot is still
        WAITING. Without this, _grace_period_timer() has no way to know
        the camera moved away for testing rather than a real car just
        never showing up, and would still fire grace_period_expired on
        its own clock - wrongly alerting a slot nobody actually failed to
        verify. Leaves state/expected_plate/etc. exactly as they are
        (still WAITING, stale) - same "frozen, not wrong" treatment as the
        rest of this slot once the camera moves on.
        """
        if self.grace_timer:
            self.grace_timer.cancel()
            self.grace_timer = None

    async def process_frame(self, frame_data: bytes):
        """
        Process a camera frame - serialized per agent via _frame_lock so two
        frames landing close together for this slot can't interleave their
        reads/writes of detected_plate/confidence/retry_count/state.
        """
        async with self._frame_lock:
            await self._process_frame_locked(frame_data)

    async def _process_frame_locked(self, frame_data: bytes):
        """
        Performs plate recognition and verification. Only ever called from
        process_frame(), which holds _frame_lock for the duration.
        """
        if self.state == AgentState.IDLE and settings.auto_arm_frames:
            # Hardware path: a camera just sent a frame for an idle slot, so arm
            # the agent from the slot's live reservation instead of dropping it.
            await self.arm_from_reservation()

        if self.state not in [AgentState.WAITING, AgentState.VERIFYING]:
            logger.debug("Ignoring frame - agent not in verification state", 
                        slot_id=self.slot_id, state=self.state.value)
            return
        
        logger.info("Processing frame", slot_id=self.slot_id, state=self.state.value)
        
        self.last_frame = frame_data
        self.last_frame_time = datetime.utcnow()

        # Decode image for recognition
        import numpy as np
        import cv2

        nparr = np.frombuffer(frame_data, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            logger.error("Failed to decode frame", slot_id=self.slot_id)
            return

        # The firmware's own sensor_t.set_vflip()/set_hmirror() calls
        # (esp32_cam.ino's initCamera()) are the "correct" place to fix this,
        # but don't reliably take effect on this board's sensor - confirmed
        # by re-flashing the verified-correct firmware and still getting a
        # wrong-orientation frame. Doing it here instead doesn't depend on
        # sensor-driver quirks, so it's what's actually relied on.
        #
        # This is a vertical flip ONLY, not a full 180 rotation - empirically
        # confirmed against real captured frames (both a frame from before
        # any orientation fix, and one from after re-flashing the firmware's
        # own vflip+hmirror fix): a plain top/bottom flip alone produces a
        # correctly-readable plate, while rotating both axes over-corrects.
        # Re-encoding so the stored/displayed frame matches what recognition
        # sees, instead of showing attendants a wrong-orientation photo while
        # detection silently works on a corrected copy.
        image = cv2.flip(image, 0)
        encode_ok, encoded = cv2.imencode('.jpg', image)
        upload_bytes = encoded.tobytes() if encode_ok else frame_data

        # Save frame to storage
        frame_url = await Storage.upload_frame(self.slot_id, upload_bytes, self.last_frame_time)

        # Recognize plate
        recognizer = get_plate_recognizer()
        detected_plate, confidence = recognizer.recognize(image)
        
        self.detected_plate = detected_plate
        self.confidence = confidence
        
        # Update database with detection
        await Database.update_agent_state(self.slot_id, {
            'detected_plate': self.detected_plate,
            'confidence': self.confidence,
            'last_frame_url': frame_url
        })
        
        # Verify if in waiting or verifying state
        if self.state == AgentState.WAITING or self.state == AgentState.VERIFYING:
            await self._verify_plate()
    
    async def _verify_plate(self):
        """Verify detected plate against expected plate."""
        if not self.detected_plate or not self.expected_plate:
            logger.warning("Cannot verify - missing plate data", slot_id=self.slot_id)
            return
        
        # Check match
        match = is_match(self.detected_plate, self.expected_plate)

        if match and self.confidence >= settings.auto_verify_confidence_threshold:
            # Plate matches and the OCR read was confident - verify automatically
            await self._verify_success()
        else:
            # Either no match, or it matched on a low-confidence read we don't
            # trust alone. Either way this frame doesn't auto-verify - the
            # attendant sees the live photo + detected text on their screen
            # and can call confirm_vehicle() to accept it by eye, so a bad
            # OCR read doesn't block an otherwise-correct vehicle for the
            # full retry window.
            self.retry_count += 1

            if self.retry_count >= settings.max_retry_attempts:
                # Max retries reached - raise alert
                await self._raise_alert("max_retries")
            else:
                # Still in verifying state
                self.state = AgentState.VERIFYING
                await Database.update_agent_state(self.slot_id, {
                    'state': self.state.value
                })

    async def confirm_vehicle(self):
        """
        Attendant manually confirms the vehicle from the live photo,
        overriding the OCR/confidence gate in _verify_plate(). Used when the
        camera's last frame looks correct to a human but the detected plate
        either didn't match or wasn't read confidently enough to auto-verify.
        """
        logger.info("Vehicle manually confirmed by attendant", slot_id=self.slot_id,
                    detected=self.detected_plate, expected=self.expected_plate)
        await self._verify_success()
    
    async def _verify_success(self):
        """Handle successful verification."""
        logger.info("Verification successful", slot_id=self.slot_id,
                   detected=self.detected_plate, expected=self.expected_plate)

        # Check PWD slot requirements - a violation here must stop the rest
        # of this function from running. _check_pwd_permit() itself raises
        # an alert (state=ALERT, slot='unverified') on a violation, but
        # previously nothing checked that before continuing on to set
        # state=VERIFIED and slot='occupied' a few lines below, silently
        # overwriting the alert it had just raised - so a PWD violation was
        # detected, logged, and then immediately undone every time.
        slot = await Database.get_slot(self.slot_id)
        if slot and slot['is_pwd']:
            if not await self._check_pwd_permit():
                return

        # Update state
        self.state = AgentState.VERIFIED
        self.verified_at = datetime.utcnow()
        
        # Update database
        await Database.update_agent_state(self.slot_id, {
            'state': self.state.value
        })
        
        # Update slot status
        await Database.update_slot_status(self.slot_id, 'occupied', self.reservation_id)
        
        # Create verification event
        if self.reservation_id:
            await Database.create_verification_event(
                self.slot_id,
                self.reservation_id,
                self.detected_plate,
                self.expected_plate,
                self.confidence,
                'match'
            )
        
        # Update reservation status
        if self.reservation_id:
            await Database.update_reservation_status(self.reservation_id, 'verified')
        
        # Start overstay monitoring
        self._start_overstay_monitoring()
    
    async def _check_pwd_permit(self) -> bool:
        """
        Check if vehicle owner has PWD permit for PWD slot.
        Returns False (having already raised an alert) if this is a real
        violation that should block verification; True otherwise - including
        the "can't actually check" cases (no plate, no matching vehicle/profile
        row), which were already silent no-ops before this returned anything
        and stay that way rather than blocking verification on missing data.
        """
        if not self.detected_plate:
            return True

        # Get vehicle
        vehicle = await Database.get_vehicle(self.detected_plate)
        if not vehicle:
            logger.warning("Vehicle not found for PWD check", plate=self.detected_plate)
            return True

        # Get owner profile
        profile = await Database.get_profile(vehicle['owner_id'])
        if not profile:
            logger.warning("Profile not found for PWD check", owner_id=vehicle['owner_id'])
            return True

        # Check PWD verification
        if not profile.get('pwd_verified', False):
            logger.warning("PWD slot violation - vehicle not PWD verified",
                         slot_id=self.slot_id, plate=self.detected_plate)
            await self._raise_alert("pwd_violation")
            return False

        return True
    
    async def _raise_alert(self, reason: str):
        """Raise alert for verification failure."""
        logger.warning("Alert raised", slot_id=self.slot_id, reason=reason)
        
        self.state = AgentState.ALERT
        
        # Update database
        await Database.update_agent_state(self.slot_id, {
            'state': self.state.value
        })
        
        # Update slot status
        await Database.update_slot_status(self.slot_id, 'unverified', self.reservation_id)
        
        # Create verification event
        if self.reservation_id:
            await Database.create_verification_event(
                self.slot_id,
                self.reservation_id,
                self.detected_plate or "",
                self.expected_plate or "",
                self.confidence,
                'mismatch'
            )
        
        # Note: Realtime notification will be handled by Supabase triggers
    
    async def _grace_period_timer(self):
        """Timer for grace period after acceptance."""
        logger.info("Grace period timer started", slot_id=self.slot_id, 
                   seconds=settings.grace_period_seconds)
        
        await asyncio.sleep(settings.grace_period_seconds)
        
        # Check if still in waiting state
        if self.state == AgentState.WAITING:
            logger.warning("Grace period expired without verification", slot_id=self.slot_id)
            await self._raise_alert("grace_period_expired")
    
    def _start_overstay_monitoring(self):
        """Start monitoring for overstay."""
        if self.overstay_timer:
            self.overstay_timer.cancel()
        
        self.overstay_timer = asyncio.create_task(self._overstay_monitor())
        logger.info("Overstay monitoring started", slot_id=self.slot_id)
    
    async def _overstay_monitor(self):
        """Monitor for overstay."""
        while self.state == AgentState.VERIFIED:
            await asyncio.sleep(settings.overstay_check_interval_seconds)
            
            # Check if reservation has ended. get_live_reservation(), not
            # get_active_reservation() - this reservation was just set to
            # 'verified' right before _start_overstay_monitoring() was
            # called (see _verify_success()), so the status='active'-only
            # lookup always found nothing here: this loop's end_time check
            # never ran, and _handle_overstay() never fired, for every
            # single verified reservation.
            if self.reservation_id:
                reservation = await Database.get_live_reservation(self.slot_id)
                if reservation:
                    end_time = datetime.fromisoformat(reservation['end_time'])
                    if datetime.utcnow() > end_time:
                        # Overstay detected
                        logger.warning("Overstay detected", slot_id=self.slot_id, 
                                     reservation_id=self.reservation_id)
                        await self._handle_overstay()
                        break
    
    async def _handle_overstay(self):
        """Handle overstay situation."""
        self.state = AgentState.ALERT
        
        # Update database
        await Database.update_agent_state(self.slot_id, {
            'state': self.state.value
        })
        
        # Update slot status
        await Database.update_slot_status(self.slot_id, 'overstay', self.reservation_id)
        
        # Update reservation status
        if self.reservation_id:
            await Database.update_reservation_status(self.reservation_id, 'overstay')
        
        # Note: Penalty creation will be handled by database triggers
    
    def get_state_dict(self) -> dict:
        """Get current state as dictionary."""
        return {
            'slot_id': self.slot_id,
            'state': self.state.value,
            'expected_plate': self.expected_plate,
            'accepted_at': self.accepted_at.isoformat() if self.accepted_at else None,
            'detected_plate': self.detected_plate,
            'confidence': self.confidence,
            'reservation_id': self.reservation_id,
            'verified_at': self.verified_at.isoformat() if self.verified_at else None,
        }
