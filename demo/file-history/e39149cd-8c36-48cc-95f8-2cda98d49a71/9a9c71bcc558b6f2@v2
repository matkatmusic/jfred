import csv, re, os

base = os.path.dirname(os.path.abspath(__file__))
csv_path = os.path.join(base, "renames.csv")
target = os.path.join(base, "inventory_core.py")

with open(csv_path) as f:
    pairs = [(r["old"], r["new"]) for r in csv.DictReader(f)]

text = open(target).read()
for old, new in pairs:
    text = re.sub(rf"\b{re.escape(old)}\b", new, text)
    print(f"{old} -> {new}")
open(target, "w").write(text)
