# Inventory Module Handoff

## What's implemented

`inventory.py` has these public functions:

- `qty_chk(item, n)` — check if n units are available
- `add_item(store, item)` — append item, raise on duplicate
- `rm_item(store, name)` — remove item by name
- `find_item(store, name)` — lookup by name, returns None if missing
- `tot_value(store)` — sum of price * stock across all items
- `low_stock(store, threshold)` — items below threshold
- `restock(store, name, n)` — add n units, insert if absent
- `reorder(store, name, n)` — top up to n if below
- `shrink(store, name)` — remove item, return its last stock
- `reserve(store, name, n)` — hold n units aside via a "reserved" key
- `count_items(store)` — len(store)
- `least_valuable(store)` — item with lowest price * stock
- `_make_item(name, price, stock)` — helper to build item dicts

`tests/test_inventory.py` covers `qty_chk`, `tot_value`, and `reserve` (12 tests total).

## Functions to rename

A rename script (`rename_inv.py`) was created but never executed. These short names should be expanded:

| Current | Rename to |
|---------|-----------|
| `qty_chk` | `check_quantity` |
| `rm_item` | `remove_item` |
| `tot_value` | `total_value` |

Update all call sites in `inventory.py`, `tests/test_inventory.py`, and `reporting.py` (which imports `low_stock` from inventory).
