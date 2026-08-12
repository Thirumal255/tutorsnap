"""
One-time backup script — dumps all task/finance rows to a timestamped JSON file.

Usage (against Cloud SQL via proxy):
    DATABASE_URL="postgresql://..." python backend/scripts/export_tasks_backup.py

Output: backup_YYYYMMDD_HHMMSS.json  (in cwd — do NOT commit, see .gitignore)
"""
import json
import os
import sys
from datetime import datetime, date

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    sys.exit("ERROR: DATABASE_URL env var not set")

engine = create_engine(DATABASE_URL)

TABLES = [
    "admin_tasks",
    "admin_task_expenses",
    "admin_task_dependencies",
    "payment_accounts",
    "fund_sources",
    "fund_receipts",
    "category_allocations",
    "fund_transfers",
]

def serialize(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")

backup = {}
with engine.connect() as conn:
    for table in TABLES:
        rows = conn.execute(text(f"SELECT * FROM {table}")).mappings().all()
        backup[table] = [dict(r) for r in rows]
        print(f"  {table}: {len(backup[table])} rows")

filename = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
with open(filename, "w", encoding="utf-8") as f:
    json.dump(backup, f, indent=2, default=serialize)

print(f"\nBackup written to: {filename}")
print("Do NOT commit this file — it may contain financial data.")
