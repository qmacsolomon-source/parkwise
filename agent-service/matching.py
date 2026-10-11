from thefuzz import fuzz
from config import settings
from logger import get_logger

logger = get_logger(__name__)


def fuzzy_match(detected: str, expected: str) -> float:
    """
    Fuzzy match between detected and expected plate numbers.
    Returns similarity score (0-1).
    """
    if not detected or not expected:
        return 0.0
    
    # Use ratio for full string comparison
    ratio = fuzz.ratio(detected, expected) / 100.0
    
    # Also use partial ratio for cases where OCR might miss some characters
    partial = fuzz.partial_ratio(detected, expected) / 100.0
    
    # Use token sort for cases where characters might be in different order
    token_sort = fuzz.token_sort_ratio(detected, expected) / 100.0
    
    # Take the maximum of the three
    similarity = max(ratio, partial, token_sort)
    
    logger.debug("Fuzzy match computed", detected=detected, expected=expected, 
                 similarity=similarity)
    return similarity


def is_match(detected: str, expected: str, threshold: float = None) -> bool:
    """
    Check if detected plate matches expected plate within threshold.
    """
    if threshold is None:
        threshold = settings.fuzzy_match_threshold
    
    similarity = fuzzy_match(detected, expected)
    is_matching = similarity >= threshold
    
    logger.info("Match check", detected=detected, expected=expected, 
                similarity=similarity, threshold=threshold, is_match=is_matching)
    
    return is_matching
