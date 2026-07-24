"""
Inventory management module.

Provides functions for managing a store inventory represented as a list
of item dicts. Each item dict has at minimum: "name" (str), "price" (float),
and "stock" (int).

Usage:
    store = []
    add_item(store, {"name": "Widget", "price": 9.99, "stock": 50})
    item = find_item(store, "Widget")
    qty_chk(item, 10)       # True — 10 <= 50
    total_value(store)         # 499.5
    rm_item(store, "Widget")
"""


def qty_chk(item, n):
    """Check whether *n* units of *item* are available.

    Args:
        item: Dict with at least a ``"stock"`` key (int).
        n: Requested quantity.

    Returns:
        True if ``n <= item["stock"]``, False otherwise.
    """
    return n <= item["stock"]


def add_item(store, item):
    """Append *item* to *store*.

    Args:
        store: List of item dicts (mutated in place).
        item: Dict with ``"name"``, ``"price"``, and ``"stock"`` keys.

    Raises:
        ValueError: If an item with the same name already exists.
    """
    for existing in store:
        if existing["name"] == item["name"]:
            raise ValueError(f"Item '{item['name']}' already exists")
    store.append(item)


def rm_item(store, name):
    """Remove the item named *name* from *store*.

    Args:
        store: List of item dicts (mutated in place).
        name: Name string to match against ``item["name"]``.

    Raises:
        KeyError: If no item with that name is found.
    """
    for i, item in enumerate(store):
        if item["name"] == name:
            del store[i]
            return
    raise KeyError(f"Item '{name}' not found")


def find_item(store, name):
    """Return the first item in *store* whose name matches *name*.

    Args:
        store: List of item dicts.
        name: Name string to search for.

    Returns:
        The matching item dict, or None if not found.
    """
    for item in store:
        if item["name"] == name:
            return item
    return None


def total_value(store):
    """Sum ``price * stock`` across all items in *store*.

    Args:
        store: List of item dicts, each with ``"price"`` and ``"stock"`` keys.

    Returns:
        Total inventory value as a float.
    """
    return sum(item["price"] * item["stock"] for item in store)


def below_threshold(store, threshold):
    """Return items whose stock is below *threshold*.

    Args:
        store: List of item dicts.
        threshold: Stock level cutoff (exclusive).

    Returns:
        List of item dicts where ``item["stock"] < threshold``.
    """
    return [item for item in store if item["stock"] < threshold]


def replenish(store, name, n):
    """Add *n* units to the item named *name*, inserting it if absent.

    If the item exists, its stock is increased by *n*. If it does not
    exist, a new item is inserted with stock *n* and price 0.

    Uses ``qty_chk`` to verify current availability and ``add_item``
    to insert new items.

    Args:
        store: List of item dicts (mutated in place).
        name: Item name.
        n: Units to add.
    """
    item = find_item(store, name)
    if item is not None:
        had_stock = qty_chk(item, 1)
        item["stock"] += n
        return had_stock
    add_item(store, {"name": name, "price": 0, "stock": n})
    return False


def replenish_order(store, name, n):
    """Place a replenish_order for *n* units of *name* if stock is insufficient.

    If the item exists but has fewer than *n* units, tops it up to *n*.
    If the item does not exist, inserts it with stock *n* and price 0.

    Uses ``qty_chk`` to test current stock and ``add_item`` to insert
    new items.

    Args:
        store: List of item dicts (mutated in place).
        name: Item name.
        n: Desired minimum stock level.

    Returns:
        Number of units added, or 0 if stock was already sufficient.
    """
    item = find_item(store, name)
    if item is not None:
        if qty_chk(item, n):
            return 0
        deficit = n - item["stock"]
        item["stock"] = n
        return deficit
    add_item(store, {"name": name, "price": 0, "stock": n})
    return n


def shrink(store, name):
    """Remove an item and return its last known stock.

    Uses ``rm_item`` to delete the item from *store*.

    Args:
        store: List of item dicts (mutated in place).
        name: Item name to remove.

    Returns:
        The stock count the item had before removal, or 0 if not found.
    """
    item = find_item(store, name)
    if item is None:
        return 0
    stock = item["stock"]
    rm_item(store, name)
    return stock


def reserve(store, name, n):
    """Reserve *n* units of *name*, reducing available stock.

    Args:
        store: List of item dicts (mutated in place).
        name: Item name.
        n: Units to reserve.

    Raises:
        KeyError: If no item with that name is found.
        ValueError: If *n* exceeds available (unreserved) stock.
    """
    item = find_item(store, name)
    if item is None:
        raise KeyError(f"Item '{name}' not found")
    reserved = item.get("reserved", 0)
    available = item["stock"] - reserved
    if n > available:
        raise ValueError(f"Cannot reserve {n}; only {available} available")
    item["reserved"] = reserved + n


def reserve_all(store):
    """Reserve every unit of every item in *store*.

    Sets each item's ``"reserved"`` key equal to its ``"stock"`` value,
    marking all units as reserved.

    Args:
        store: List of item dicts (mutated in place).
    """
    for item in store:
        item["reserved"] = item["stock"]


def reserved_count(store):
    """Return the total number of reserved units across all items.

    Args:
        store: List of item dicts.

    Returns:
        Sum of ``"reserved"`` values across all items (int).
    """
    return sum(item.get("reserved", 0) for item in store)


def clear_reserved(store):
    """Clear all reservations across every item in *store*.

    Removes the ``"reserved"`` key from each item that has one,
    making all stock available again.

    Args:
        store: List of item dicts (mutated in place).
    """
    for item in store:
        item.pop("reserved", None)


def count_items(store):
    """Return the number of items in *store*.

    Args:
        store: List of item dicts.

    Returns:
        Integer count of items.
    """
    return len(store)


def least_valuable(store):
    """Return the item with the lowest ``price * stock`` value.

    Args:
        store: List of item dicts, each with ``"price"`` and ``"stock"`` keys.

    Returns:
        The item dict with the smallest total value, or None if *store* is empty.
    """
    if not store:
        return None
    return min(store, key=lambda item: item["price"] * item["stock"])


def transfer_stock(store, src, dst, n):
    """Move *n* units of stock from item *src* to item *dst*.

    Both items must already exist in *store*. The source item's stock is
    decreased by *n* and the destination item's stock is increased by *n*.

    Args:
        store: List of item dicts (mutated in place).
        src: Name of the item to take stock from.
        dst: Name of the item to receive stock.
        n: Number of units to transfer.

    Raises:
        KeyError: If *src* or *dst* is not found in *store*.
        ValueError: If *src* has fewer than *n* units available.
    """
    src_item = find_item(store, src)
    if src_item is None:
        raise KeyError(f"Item '{src}' not found")
    dst_item = find_item(store, dst)
    if dst_item is None:
        raise KeyError(f"Item '{dst}' not found")
    if not qty_chk(src_item, n):
        raise ValueError(f"Cannot transfer {n}; only {src_item['stock']} available")
    src_item["stock"] -= n
    dst_item["stock"] += n


def _make_item(name, price, stock):
    """Create a canonical item dict.

    Args:
        name: Item name.
        price: Unit price (float).
        stock: Units on hand (int).

    Returns:
        Dict with ``"name"``, ``"price"``, and ``"stock"`` keys.
    """
    return {"name": name, "price": price, "stock": stock}


if __name__ == "__main__":
    store = []
    add_item(store, _make_item("Widget", 9.99, 50))
    add_item(store, _make_item("Gadget", 24.99, 10))
    add_item(store, _make_item("Doohickey", 4.50, 200))

    w = find_item(store, "Widget")
    assert w is not None
    assert qty_chk(w, 50)
    assert not qty_chk(w, 51)

    assert total_value(store) == 9.99 * 50 + 24.99 * 10 + 4.50 * 200

    rm_item(store, "Gadget")
    assert find_item(store, "Gadget") is None
    assert len(store) == 2

    print("OK")
# reviewed by ops
# checked
# concurrency pass
# checked-2
