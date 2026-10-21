import asyncio
from typing import Dict
from agent import SlotAgent
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
