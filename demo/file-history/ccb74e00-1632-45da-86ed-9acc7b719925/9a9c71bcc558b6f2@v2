import csv
import re
import os

base = os.path.dirname(os.path.abspath(__file__))
csv_path = os.path.join(base, "renames.csv")
targets = [
    os.path.join(base, "inventory.py"),
    os.path.join(base, "tests", "test_inventory.py"),
]

with open(csv_path) as f:
    pairs = [(r["old"], r["new"]) for r in csv.DictReader(f)]

for path in targets:
    with open(path) as f:
        text = f.read()
    for old, new in pairs:
        text = re.sub(rf"\b{re.escape(old)}\b", new, text)
    with open(path, "w") as f:
        f.write(text)
    print(f"updated {os.path.relpath(path, base)}")
