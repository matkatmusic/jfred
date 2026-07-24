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
    tot_value(store)         # 499.5
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


def tot_value(store):
    """Sum ``price * stock`` across all items in *store*.

    Args:
        store: List of item dicts, each with ``"price"`` and ``"stock"`` keys.

    Returns:
        Total inventory value as a float.
    """
    return sum(item["price"] * item["stock"] for item in store)


def low_stock(store, threshold):
    """Return items whose stock is below *threshold*.

    Args:
        store: List of item dicts.
        threshold: Stock level cutoff (exclusive).

    Returns:
        List of item dicts where ``item["stock"] < threshold``.
    """
    return [item for item in store if item["stock"] < threshold]


def restock(store, name, n):
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


def reorder(store, name, n):
    """Place a reorder for *n* units of *name* if stock is insufficient.

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


def count_items(store):
    """Return the number of items in *store*.

    Args:
        store: List of item dicts.

    Returns:
        Integer count of items.
    """
    return len(store)


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

    assert tot_value(store) == 9.99 * 50 + 24.99 * 10 + 4.50 * 200

    rm_item(store, "Gadget")
    assert find_item(store, "Gadget") is None
    assert len(store) == 2

    print("OK")
# reviewed by ops
