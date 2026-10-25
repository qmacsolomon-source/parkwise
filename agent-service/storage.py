from supabase import create_client
from config import settings
from logger import get_logger
import aiofiles
import os
from datetime import datetime
from typing import Optional

logger = get_logger(__name__)


class Storage:
    _instance = None
    
    @classmethod
    def get_client(cls):
        """Get Supabase storage client."""
        if cls._instance is None:
            cls._instance = create_client(
                settings.supabase_url,
                settings.supabase_service_role_key
            )
        return cls._instance
    
    @classmethod
    async def upload_frame(cls, slot_id: str, frame_data: bytes, timestamp: datetime) -> Optional[str]:
        """Upload frame to Supabase Storage."""
        try:
            client = cls.get_client()
            
            # Generate filename. Microsecond resolution, not just seconds -
            # two frames processed within the same second for this slot
            # (possible if a frame is ever re-POSTed, or a second camera is
            # pointed at the same slot) would otherwise collide on this
            # path; the upload has no upsert flag, so the second write
            # would fail (silently, caught below) and that frame's photo
            # would just never show up.
            filename = f"{slot_id}/{timestamp.strftime('%Y%m%d_%H%M%S_%f')}.jpg"

            # Upload to storage
            response = client.storage.from_(settings.frame_storage_bucket).upload(
                filename,
                frame_data,
                {'content-type': 'image/jpeg'}
            )
            
            # Get public URL
            url = f"{settings.supabase_url}/storage/v1/object/public/{settings.frame_storage_bucket}/{filename}"
            
            logger.info("Frame uploaded", slot_id=slot_id, filename=filename, url=url)
            return url
            
        except Exception as e:
            logger.error("Failed to upload frame", slot_id=slot_id, error=str(e))
            return None
    
    @classmethod
    async def save_local_frame(cls, slot_id: str, frame_data: bytes, timestamp: datetime) -> str:
        """Save frame locally for testing/backup."""
        try:
            # Create directory if it doesn't exist
            os.makedirs("frames", exist_ok=True)
            
            # Generate filename
            filename = f"frames/{slot_id}_{timestamp.strftime('%Y%m%d_%H%M%S')}.jpg"
            
            # Save locally
            async with aiofiles.open(filename, 'wb') as f:
                await f.write(frame_data)
            
            logger.info("Frame saved locally", slot_id=slot_id, filename=filename)
            return filename
            
        except Exception as e:
            logger.error("Failed to save frame locally", slot_id=slot_id, error=str(e))
            return ""
