"""
Simulator for testing the agent service without hardware.
Feeds sample images to simulate camera frames.
"""
import asyncio
import aiohttp
import random
from pathlib import Path
from typing import List
from datetime import datetime
from logger import get_logger, configure_logger

logger = get_logger(__name__)


class AgentSimulator:
    """Simulates camera frames for testing."""
    
    def __init__(self, agent_url: str = "http://localhost:8000", test_images_dir: str = "test_images"):
        self.agent_url = agent_url
        self.test_images_dir = Path(test_images_dir)
        self.session = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    def load_test_images(self) -> List[Path]:
        """Load test images from directory."""
        images = list(self.test_images_dir.glob("*.jpg")) + list(self.test_images_dir.glob("*.png"))
        logger.info("Loaded test images", count=len(images))
        return images
    
    async def send_frame(self, slot_id: str, image_path: Path):
        """Send frame to agent service."""
        with open(image_path, 'rb') as f:
            data = f.read()
        
        url = f"{self.agent_url}/frames/{slot_id}"
        
        async with self.session.post(url, data={'file': (image_path.name, data, 'image/jpeg')}) as response:
            if response.status == 200:
                logger.info("Frame sent successfully", slot_id=slot_id, image=image_path.name)
            else:
                logger.error("Failed to send frame", slot_id=slot_id, status=response.status)
    
    async def simulate_slot(self, slot_id: str, images: List[Path], duration_seconds: int = 60):
        """
        Simulate a single slot with random frame sending.
        """
        logger.info("Starting slot simulation", slot_id=slot_id, duration=duration_seconds)
        
        start_time = datetime.now()
        frame_count = 0
        
        while (datetime.now() - start_time).total_seconds() < duration_seconds:
            # Send random frame
            if images:
                image = random.choice(images)
                await self.send_frame(slot_id, image)
                frame_count += 1
            
            # Wait random interval (1-5 seconds)
            await asyncio.sleep(random.uniform(1, 5))
        
        logger.info("Slot simulation complete", slot_id=slot_id, frames_sent=frame_count)
    
    async def simulate_multiple_slots(self, slot_ids: List[str], images: List[Path], duration_seconds: int = 60):
        """
        Simulate multiple slots concurrently.
        """
        logger.info("Starting multi-slot simulation", slot_count=len(slot_ids), duration=duration_seconds)
        
        tasks = []
        for slot_id in slot_ids:
            task = asyncio.create_task(self.simulate_slot(slot_id, images, duration_seconds))
            tasks.append(task)
        
        await asyncio.gather(*tasks)
        
        logger.info("Multi-slot simulation complete")


async def test_accept_release_flow():
    """Test the accept -> frame -> release flow."""
    agent_url = "http://localhost:8000"
    
    async with AgentSimulator(agent_url) as simulator:
        session = simulator.session
        
        # Test slot ID
        slot_id = "test-slot-1"
        
        # Accept vehicle
        accept_url = f"{agent_url}/agents/{slot_id}/accept"
        accept_data = {"expected_plate": "ABC1234"}
        
        async with session.post(accept_url, json=accept_data) as response:
            if response.status == 200:
                logger.info("Vehicle accepted", slot_id=slot_id, plate="ABC1234")
            else:
                logger.error("Failed to accept vehicle", status=response.status)
                return
        
        # Send some frames
        images = simulator.load_test_images()
        if images:
            for i in range(3):
                await simulator.send_frame(slot_id, images[0])
                await asyncio.sleep(2)
        
        # Check state
        state_url = f"{agent_url}/agents/{slot_id}/state"
        async with session.get(state_url) as response:
            if response.status == 200:
                state = await response.json()
                logger.info("Agent state", state=state)
        
        # Release vehicle
        release_url = f"{agent_url}/agents/{slot_id}/release"
        async with session.post(release_url) as response:
            if response.status == 200:
                logger.info("Vehicle released", slot_id=slot_id)
            else:
                logger.error("Failed to release vehicle", status=response.status)


async def test_beam_trigger():
    """Test beam trigger endpoint."""
    agent_url = "http://localhost:8000"
    
    async with AgentSimulator(agent_url) as simulator:
        session = simulator.session
        
        slot_id = "test-slot-1"
        beam_url = f"{agent_url}/beam/{slot_id}"
        
        async with session.post(beam_url) as response:
            if response.status == 200:
                logger.info("Beam trigger successful", slot_id=slot_id)
            else:
                logger.error("Beam trigger failed", status=response.status)


def main():
    """Main simulator function."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Simulate camera frames for testing")
    parser.add_argument("--agent-url", default="http://localhost:8000", help="Agent service URL")
    parser.add_argument("--test-dir", default="test_images", help="Directory containing test images")
    parser.add_argument("--slot-ids", nargs="+", default=["slot-1", "slot-2"], help="Slot IDs to simulate")
    parser.add_argument("--duration", type=int, default=60, help="Simulation duration in seconds")
    parser.add_argument("--mode", choices=["multi-slot", "accept-release", "beam"], default="multi-slot", 
                       help="Simulation mode")
    
    args = parser.parse_args()
    
    # Configure logger
    configure_logger()
    
    if args.mode == "multi-slot":
        async def run():
            async with AgentSimulator(args.agent_url, args.test_dir) as simulator:
                images = simulator.load_test_images()
                await simulator.simulate_multiple_slots(args.slot_ids, images, args.duration)
        
        asyncio.run(run())
    
    elif args.mode == "accept-release":
        asyncio.run(test_accept_release_flow())
    
    elif args.mode == "beam":
        asyncio.run(test_beam_trigger())


if __name__ == "__main__":
    main()
