import asyncio
from typing import Dict, Optional
from agent import SlotAgent, AgentState
from database import Database
from logger import get_logger

logger = get_logger(__name__)


class AgentManager:
    """
    Manages all slot agents as concurrent asyncio tasks.
    """

    def __init__(self):
        self.agents: Dict[str, SlotAgent] = {}
        self.running = False

        # With only one real ESP32-CAM available for testing, its firmware
        # always posts frames tagged with its own hardcoded SLOT_CODE. This
        # override lets the attendant "aim" that one camera at whichever
        # slot they're actually testing, by redirecting every incoming
        # frame to this slot instead of the one in the URL - see
        # set_camera_target()/resolve_camera_target() and their use in
        # main.py's receive_frame_raw. None means "use the frame's own
        # slot", i.e. normal behavior for a real one-camera-per-slot
        # deployment.
        self.camera_target_slot_id: Optional[str] = None

        # The slot that actually last received a frame - distinct from
        # camera_target_slot_id, which stays None until the first explicit
        # /camera/target call. Needed because a frame can arm a slot via
        # arm_from_reservation() before any attendant ever retargets
        # anything (the camera's own hardcoded slot, used by
        # resolve_camera_target()'s default). Without tracking this
        # separately, the very first retarget of a session has no
        # "previous" slot to suspend the grace timer on, reproducing the
        # same false grace_period_expired alert suspend_grace_timer() exists
        # to prevent.
        self.last_frame_target_slot_id: Optional[str] = None

    def set_camera_target(self, slot_id: str) -> None:
        # The slot being moved away from, if it's still WAITING on a car
        # that simply hasn't arrived yet, has a grace_timer ticking down on
        # real wall-clock time, independent of whether any more frames ever
        # arrive for it. Left running, it has no way to tell "the camera
        # moved away for testing" apart from "the car never showed up", and
        # fires grace_period_expired regardless - a false alert on a slot
        # nobody actually failed to verify. Only WAITING needs this: once
        # past that into VERIFYING, _grace_period_timer()'s own state check
        # already no-ops; before it (IDLE) there's no timer to suspend.
        previous_id = self.last_frame_target_slot_id
        if previous_id and previous_id != slot_id:
            previous_agent = self.agents.get(previous_id)
            if isinstance(previous_agent, SlotAgent) and previous_agent.state == AgentState.WAITING:
                previous_agent.suspend_grace_timer()

        self.camera_target_slot_id = slot_id

    def resolve_camera_target(self, default_slot_id: str) -> str:
        target = self.camera_target_slot_id or default_slot_id
        self.last_frame_target_slot_id = target
        return target
    
    async def initialize(self):
        """Initialize all agents from database."""
        logger.info("Initializing AgentManager")
        
        # Get all slots from database
        client = Database.get_client()
        response = client.table('slots').select('*').execute()

        if response.data:
            for slot in response.data:
                slot_id = slot['id']
                agent = SlotAgent(slot_id)
                await agent.initialize()
                self.agents[slot_id] = agent
                logger.info("Agent initialized", slot_id=slot_id)
        
        logger.info("AgentManager initialized", agent_count=len(self.agents))
    
    async def start(self):
        """Start all agents."""
        logger.info("Starting AgentManager")
        self.running = True
    
    async def stop(self):
        """Stop all agents."""
        logger.info("Stopping AgentManager")
        self.running = False
    
    def get_agent(self, slot_id: str) -> SlotAgent:
        """Get agent by slot ID."""
        if slot_id not in self.agents:
            # Create new agent if not exists
            agent = SlotAgent(slot_id)
            self.agents[slot_id] = agent
            logger.info("New agent created", slot_id=slot_id)
            return agent
        
        # Return existing agent (need to store actual agent instances, not IDs)
        # Fix: store agent instances
        if isinstance(self.agents[slot_id], str):
            agent = SlotAgent(slot_id)
            self.agents[slot_id] = agent
            return agent
        
        return self.agents[slot_id]
    
    async def process_frame(self, slot_id: str, frame_data: bytes):
        """Process frame for specific slot."""
        agent = self.get_agent(slot_id)
        await agent.process_frame(frame_data)
    
    async def accept_vehicle(self, slot_id: str, expected_plate: str):
        """Accept vehicle for specific slot."""
        agent = self.get_agent(slot_id)
        await agent.accept_vehicle(expected_plate)
    
    async def release_vehicle(self, slot_id: str):
        """Release vehicle from specific slot."""
        agent = self.get_agent(slot_id)
        await agent.release_vehicle()

    async def confirm_vehicle(self, slot_id: str):
        """Attendant manually confirms vehicle for specific slot."""
        agent = self.get_agent(slot_id)
        await agent.confirm_vehicle()
    
    async def get_agent_state(self, slot_id: str) -> dict:
        """Get state of specific agent."""
        agent = self.get_agent(slot_id)
        return agent.get_state_dict()
    
    def get_all_states(self) -> Dict[str, dict]:
        """Get states of all agents."""
        states = {}
        for slot_id, agent in self.agents.items():
            if isinstance(agent, SlotAgent):
                states[slot_id] = agent.get_state_dict()
        return states


# Singleton instance
_agent_manager: AgentManager = None


def get_agent_manager() -> AgentManager:
    """Get agent manager singleton."""
    global _agent_manager
    if _agent_manager is None:
        _agent_manager = AgentManager()
    return _agent_manager
