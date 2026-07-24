"""Inventory reporting utilities."""


def stock_report(store):
    """Return a list of (name, stock) pairs for every item in the store.

    Args:
        store: dict mapping item names to item dicts with at least a 'stock' key.

    Returns:
        List of (name, stock) tuples.
    """
    return [(name, item["stock"]) for name, item in store.items()]
# reviewed by ops
