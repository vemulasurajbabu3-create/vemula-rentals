"""Per-user weekly reminders — iteration 9.

Validates that `_create_reminders_for_pending` fires reminders ANCHORED to each
payment's own due_date (within `reminder_lead_hours`) and re-fires every
`reminder_overdue_repeat_days` while overdue.

Tests seed payments directly via motor (same client `server.db`) so we can
fully control due_date / reminder_sent_at without waiting for the scheduler.
"""
import os
import sys
import uuid
import asyncio
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Import server module — we will swap server.db to a loop-local motor client
# inside each test so motor's executor is bound to the active asyncio loop.
import server  # noqa: E402
from server import _create_reminders_for_pending, get_settings_doc  # noqa: E402,F401
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def _fresh_db():
    """Return a motor db handle bound to the CURRENT event loop.
    Also re-points `server.db` to it so server-side helpers operate on the
    same DB this test is driving.
    """
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    fresh = client[os.environ["DB_NAME"]]
    server.db = fresh  # noqa: SLF001 — intentional swap for test isolation
    return fresh


BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "https://rentwheel-connect.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_PHONE = "9999999999"


# ---------------- helpers ----------------
def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


async def _reset_settings():
    """Restore the two new knobs to defaults so each test starts clean."""
    await db.settings.update_one(
        {"id": "global"},
        {"$set": {"reminder_lead_hours": 24.0, "reminder_overdue_repeat_days": 7.0}},
        upsert=True,
    )


async def _make_user(prefix: str) -> dict:
    uid = str(uuid.uuid4())
    u = {
        "id": uid,
        "phone": prefix + str(uuid.uuid4().int)[:6],
        "full_name": f"TEST_{prefix}",
        "is_admin": False,
        "status": "approved",
        "created_at": _iso(datetime.now(timezone.utc)),
    }
    await db.users.insert_one(dict(u))
    return u


async def _make_vehicle(assigned_to: str) -> dict:
    vid = str(uuid.uuid4())
    v = {
        "id": vid,
        "vehicle_type": "Motorbike",
        "model": "TEST_BIKE_" + vid[:6],
        "number_plate": "KA-99-" + vid[:4].upper(),
        "weekly_rent": 1000.0,
        "security_deposit": 0.0,
        "status": "rented",
        "assigned_to": assigned_to,
        "rental_start_date": _iso(datetime.now(timezone.utc)),
        "instructions": [],
        "created_at": _iso(datetime.now(timezone.utc)),
    }
    await db.vehicles.insert_one(dict(v))
    return v


async def _make_payment(user_id: str, vehicle_id: str, due: datetime, reminder_sent_at=None) -> dict:
    pid = str(uuid.uuid4())
    doc = {
        "id": pid,
        "user_id": user_id,
        "vehicle_id": vehicle_id,
        "amount": 1000.0,
        "late_fee": 0.0,
        "due_date": _iso(due),
        "status": "pending",
        "transaction_id": None,
        "paid_at": None,
        "created_at": _iso(datetime.now(timezone.utc)),
    }
    if reminder_sent_at is not None:
        doc["reminder_sent_at"] = _iso(reminder_sent_at)
        doc["reminder_sent"] = True
    await db.payments.insert_one(dict(doc))
    return doc


async def _cleanup(user_ids):
    if not user_ids:
        return
    await db.payments.delete_many({"user_id": {"$in": user_ids}})
    await db.notifications.delete_many({"user_id": {"$in": user_ids + [None]}, "title": {"$in": [
        "Weekly Payment Reminder", "Payment Overdue", "Reminder Sent", "Overdue Reminder Sent"
    ]}})
    await db.vehicles.delete_many({"assigned_to": {"$in": user_ids}})
    await db.users.delete_many({"id": {"$in": user_ids}})


# ---------------- Test 1: pre-due lead window + no duplicate ----------------
def test_pre_due_within_lead_window_fires_once():
    async def go():
        await _reset_settings()
        user = await _make_user("preDue")
        veh = await _make_vehicle(user["id"])
        await _make_payment(user["id"], veh["id"], datetime.now(timezone.utc) + timedelta(hours=12))

        count = await _create_reminders_for_pending()
        assert count >= 1, f"expected ≥1 reminder, got {count}"

        # Payment is flagged
        p = await db.payments.find_one({"user_id": user["id"]}, {"_id": 0})
        assert p.get("reminder_sent") is True, "reminder_sent should be True after first run"

        # Notification recorded with correct title & ~Xh hint
        notif = await db.notifications.find_one(
            {"user_id": user["id"], "title": "Weekly Payment Reminder"}, {"_id": 0}
        )
        assert notif is not None, "Weekly Payment Reminder notification missing"
        body = notif.get("body", "")
        assert "~" in body and "h" in body, f"body should mention '~Xh', got: {body}"

        # Second immediate call → no new pre-due reminder
        count2 = await _create_reminders_for_pending()
        assert count2 == 0, f"expected 0 on second call, got {count2}"

        await _cleanup([user["id"]])
    asyncio.run(go())


# ---------------- Test 2: too early → adjust lead hours → fires ----------------
def test_too_early_then_widen_lead_window():
    async def go():
        await _reset_settings()
        user = await _make_user("tooEarly")
        veh = await _make_vehicle(user["id"])
        await _make_payment(user["id"], veh["id"], datetime.now(timezone.utc) + timedelta(hours=72))

        count1 = await _create_reminders_for_pending()
        assert count1 == 0, f"with lead=24h and due=72h ahead, expected 0, got {count1}"

        # Widen the lead window
        await db.settings.update_one(
            {"id": "global"}, {"$set": {"reminder_lead_hours": 96.0}}, upsert=True
        )
        count2 = await _create_reminders_for_pending()
        assert count2 >= 1, f"with lead=96h, expected ≥1, got {count2}"

        await _cleanup([user["id"]])
        await _reset_settings()
    asyncio.run(go())


# ---------------- Test 3: two riders, different due windows ----------------
def test_two_riders_only_in_window_gets_reminder():
    async def go():
        await _reset_settings()  # lead = 24h
        u_near = await _make_user("near")
        u_far = await _make_user("far")
        v_near = await _make_vehicle(u_near["id"])
        v_far = await _make_vehicle(u_far["id"])
        await _make_payment(u_near["id"], v_near["id"], datetime.now(timezone.utc) + timedelta(hours=10))
        await _make_payment(u_far["id"], v_far["id"], datetime.now(timezone.utc) + timedelta(hours=72))

        await _create_reminders_for_pending()

        p_near = await db.payments.find_one({"user_id": u_near["id"]}, {"_id": 0})
        p_far = await db.payments.find_one({"user_id": u_far["id"]}, {"_id": 0})
        assert p_near.get("reminder_sent") is True, "near rider should have reminder_sent=True"
        assert not p_far.get("reminder_sent"), "far rider must NOT have reminder_sent flag yet"

        await _cleanup([u_near["id"], u_far["id"]])
    asyncio.run(go())


# ---------------- Test 4: overdue throttle + 'Payment Overdue' notification ----------------
def test_overdue_repeats_after_throttle_window():
    async def go():
        await _reset_settings()  # overdue_repeat=7d
        user = await _make_user("overdue")
        veh = await _make_vehicle(user["id"])
        # Due 36h ago AND last reminder was 8 days ago → should fire again
        due = datetime.now(timezone.utc) - timedelta(hours=36)
        last = datetime.now(timezone.utc) - timedelta(days=8)
        await _make_payment(user["id"], veh["id"], due, reminder_sent_at=last)

        count = await _create_reminders_for_pending()
        assert count >= 1, f"expected ≥1 overdue reminder, got {count}"

        notif = await db.notifications.find_one(
            {"user_id": user["id"], "title": "Payment Overdue"},
            sort=[("created_at", -1)],
        )
        assert notif is not None, "Payment Overdue notification missing"
        body = notif.get("body", "")
        assert "1 day late" in body, f"expected '1 day late' in body, got: {body}"

        # Immediate re-run → throttled (last_sent just now, repeat=7d)
        count2 = await _create_reminders_for_pending()
        assert count2 == 0, f"expected 0 on immediate re-run, got {count2}"

        await _cleanup([user["id"]])
    asyncio.run(go())


# ---------------- Test 5: settings validation ----------------
def test_settings_validation_via_api():
    # admin login
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    s.post(f"{API}/auth/request-otp", json={"phone": ADMIN_PHONE})
    r = s.post(f"{API}/auth/verify-otp", json={"phone": ADMIN_PHONE, "otp": "123456"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # too-large lead → 400
    r1 = s.put(f"{API}/admin/settings", headers=h, json={"reminder_lead_hours": 999})
    assert r1.status_code == 400, f"expected 400 for lead=999, got {r1.status_code} {r1.text}"

    # zero overdue-repeat → 400
    r2 = s.put(f"{API}/admin/settings", headers=h, json={"reminder_overdue_repeat_days": 0})
    assert r2.status_code == 400, f"expected 400 for repeat=0, got {r2.status_code} {r2.text}"

    # sanity: a valid update still succeeds
    r3 = s.put(f"{API}/admin/settings", headers=h, json={"reminder_lead_hours": 24, "reminder_overdue_repeat_days": 7})
    assert r3.status_code == 200, r3.text
