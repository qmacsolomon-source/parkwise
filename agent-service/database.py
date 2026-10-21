from supabase import create_client, Client
from config import settings
from logger import get_logger
import re

logger = get_logger(__name__)

_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE
)


class Database:
    _instance: Client = None
    
    @classmethod
    def get_client(cls) -> Client:
        """Get Supabase client singleton."""
        if cls._instance is None:
            cls._instance = create_client(
                settings.supabase_url,
                settings.supabase_service_role_key
            )
            logger.info("Supabase client initialized")
        return cls._instance
    
    @classmethod
    async def get_slot(cls, slot_id: str):
        """Get slot by ID."""
        client = cls.get_client()
        response = client.table('slots').select('*').eq('id', slot_id).single().execute()
        if response.data:
            return response.data
        return None
    
    @classmethod
    async def resolve_slot(cls, slot_ref: str):
        """
        Resolve a slot reference from a camera's URL to the slots row.

        Accepts either a slot_code ("1A1", case-insensitive) or a slot UUID, so
        ESP32 firmware can hardcode the human-readable code instead of a UUID.
        Returns the slot row, or None when nothing matches.
        """
        client = cls.get_client()
        ref = (slot_ref or "").strip()
        if not ref:
            return None

        if _UUID_RE.match(ref):
            response = client.table('slots').select('*').eq('id', ref).limit(1).execute()
            if response.data:
                return response.data[0]

        response = (
            client.table('slots')
            .select('*')
            .ilike('slot_code', ref)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    @classmethod
    async def get_live_reservation(cls, slot_id: str):
        """
        Get the reservation currently holding a slot.

        "Live" mirrors the no_overlapping_reservations EXCLUDE constraint in
        schema.sql: anything not cancelled/completed/no_show. get_active_reservation()
        only looks for status='active', which misses 'pending' bookings.

        The status filter is applied here rather than in the query so it does not
        depend on the postgrest client's negation API.
        """
        client = cls.get_client()
        response = (
            client.table('reservations')
            .select('*')
            .eq('slot_id', slot_id)
            .order('start_time')
            .limit(10)
            .execute()
        )
        dead = {'cancelled', 'completed', 'no_show'}
        for row in response.data or []:
            if row.get('status') not in dead:
                return row
        return None

    @classmethod
    async def get_vehicle_by_id(cls, vehicle_id: str):
        """Get vehicle by its id."""
        client = cls.get_client()
        response = client.table('vehicles').select('*').eq('id', vehicle_id).limit(1).execute()
        return response.data[0] if response.data else None

    @classmethod
    async def get_agent_state(cls, slot_id: str):
        """Get agent state for slot."""
        client = cls.get_client()
        response = client.table('agent_states').select('*').eq('slot_id', slot_id).single().execute()
        if response.data:
            return response.data
        return None
    
    @classmethod
    async def update_agent_state(cls, slot_id: str, updates: dict):
        """Update agent state."""
        client = cls.get_client()
        response = client.table('agent_states').update(updates).eq('slot_id', slot_id).execute()
        logger.info("Agent state updated", slot_id=slot_id, updates=updates)
        return response.data
    
    @classmethod
    async def update_slot_status(cls, slot_id: str, status: str, reservation_id: str = None):
        """Update slot status."""
        client = cls.get_client()
        updates = {'status': status}
        if reservation_id:
            updates['current_reservation_id'] = reservation_id
        response = client.table('slots').update(updates).eq('id', slot_id).execute()
        logger.info("Slot status updated", slot_id=slot_id, status=status)
        return response.data
    
    @classmethod
    async def get_active_reservation(cls, slot_id: str):
        """Get active reservation for slot."""
        client = cls.get_client()
        response = client.table('reservations').select('*').eq('slot_id', slot_id).eq('status', 'active').limit(1).execute()
        if response.data:
            return response.data[0]
        return None
    
    @classmethod
    async def update_reservation_status(cls, reservation_id: str, status: str):
        """Update reservation status."""
        client = cls.get_client()
        response = client.table('reservations').update({'status': status}).eq('id', reservation_id).execute()
        logger.info("Reservation status updated", reservation_id=reservation_id, status=status)
        return response.data
    
    @classmethod
    async def create_verification_event(cls, slot_id: str, reservation_id: str, 
                                        detected_plate: str, expected_plate: str, 
                                        confidence: float, result: str, frame_url: str = None):
        """Create verification event."""
        client = cls.get_client()
        data = {
            'slot_id': slot_id,
            'reservation_id': reservation_id,
            'detected_plate': detected_plate,
            'expected_plate': expected_plate,
            'confidence': confidence,
            'result': result,
            'frame_url': frame_url
        }
        response = client.table('verification_events').insert(data).execute()
        logger.info("Verification event created", slot_id=slot_id, result=result)
        return response.data
    
    @classmethod
    async def get_profile(cls, user_id: str):
        """Get user profile."""
        client = cls.get_client()
        response = client.table('profiles').select('*').eq('id', user_id).single().execute()
        if response.data:
            return response.data
        return None
    
    @classmethod
    async def get_vehicle(cls, plate_number: str):
        """Get vehicle by plate number."""
        client = cls.get_client()
        response = client.table('vehicles').select('*').eq('plate_number', plate_number).single().execute()
        if response.data:
            return response.data
        return None
    
    @classmethod
    async def get_rates(cls):
        """Get current rates."""
        client = cls.get_client()
        response = client.table('rates').select('*').order('updated_at', desc=True).limit(1).single().execute()
        if response.data:
            return response.data
        return None
