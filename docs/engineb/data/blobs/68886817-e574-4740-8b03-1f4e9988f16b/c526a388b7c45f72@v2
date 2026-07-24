"""Inventory reporting utilities."""

from inventory import low_stock


def stock_report(store):
    """Return a list of (name, stock) pairs for every item in the store.

    Args:
        store: dict mapping item names to item dicts with at least a 'stock' key.

    Returns:
        List of (name, stock) tuples.
    """
    return [(name, item["stock"]) for name, item in store.items()]


def low_stock_report(store, threshold):
    """Return items whose stock is below *threshold*.

    Args:
        store: List of item dicts, each with at least ``"stock"`` (int).
        threshold: Stock level cutoff (exclusive).

    Returns:
        List of item dicts where ``item["stock"] < threshold``.
    """
    return low_stock(store, threshold)
# reviewed by ops
