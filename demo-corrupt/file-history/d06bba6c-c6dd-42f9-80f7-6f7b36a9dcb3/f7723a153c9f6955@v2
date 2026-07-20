import re

RENAMES = [
    ("qty_chk", "check_quantity"),
    ("add_item", "insert_item"),
    ("rm_item", "remove_item"),
]

FILES = ["inventory.py", "tests/test_inventory.py"]

for path in FILES:
    with open(path) as f:
        text = f.read()
    for old, new in RENAMES:
        text = re.sub(rf"\b{re.escape(old)}\b", new, text)
    with open(path, "w") as f:
        f.write(text)
