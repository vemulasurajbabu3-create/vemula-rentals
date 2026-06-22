"""Tests for admin settings (reminder + late fee) and late fee engine."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio
from dotenv import load_dotenv
from pathlib import Path

# Load backend .env for direct DB access (to backdate due_date)
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rentwheel-connect.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_PHONE = "9999999999"
CUSTOMER_PHONE = "98712" + str(uuid.uuid4().int)[:5]


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _auth(session, phone):
    session.post(f"{API}/auth/request-otp", json={"phone": phone})
    r = session.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": "123456"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def admin(session):
    return _auth(session, ADMIN_PHONE)


@pytest.fixture(scope="module")
def customer(session):
    return _auth(session, CUSTOMER_PHONE)


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --------- ADMIN SETTINGS ----------
class TestAdminSettings:
    def test_get_settings_admin(self, session, admin):
        r = session.get(f"{API}/admin/settings", headers=_h(admin["token"]))
        assert r.status_code == 200
        d = r.json()
        for k in ["reminder_weekday", "reminder_hour_ist", "late_fee_per_day", "grace_days"]:
            assert k in d, f"missing {k}"
        assert 0 <= d["reminder_weekday"] <= 6
        assert 0 <= d["reminder_hour_ist"] <= 23

    def test_get_settings_non_admin_403(self, session, customer):
        r = session.get(f"{API}/admin/settings", headers=_h(customer["token"]))
        assert r.status_code == 403

    def test_put_settings_valid_persists(self, session, admin):
        payload = {"reminder_weekday": 3, "reminder_hour_ist": 14, "late_fee_per_day": 75.0, "grace_days": 2}
        r = session.put(f"{API}/admin/settings", headers=_h(admin["token"]), json=payload)
        assert r.status_code == 200, r.text
        # verify via GET
        g = session.get(f"{API}/admin/settings", headers=_h(admin["token"])).json()
        assert g["reminder_weekday"] == 3
        assert g["reminder_hour_ist"] == 14
        assert g["late_fee_per_day"] == 75.0
        assert g["grace_days"] == 2

    def test_put_settings_invalid_weekday(self, session, admin):
        r = session.put(f"{API}/admin/settings", headers=_h(admin["token"]), json={"reminder_weekday": 9})
        assert r.status_code == 400

    def test_put_settings_invalid_weekday_negative(self, session, admin):
        r = session.put(f"{API}/admin/settings", headers=_h(admin["token"]), json={"reminder_weekday": -1})
        assert r.status_code == 400

    def test_put_settings_invalid_hour(self, session, admin):
        r = session.put(f"{API}/admin/settings", headers=_h(admin["token"]), json={"reminder_hour_ist": 24})
        assert r.status_code == 400

    def test_put_settings_invalid_hour_negative(self, session, admin):
        r = session.put(f"{API}/admin/settings", headers=_h(admin["token"]), json={"reminder_hour_ist": -2})
        assert r.status_code == 400

    def test_put_settings_invalid_fee(self, session, admin):
        r = session.put(f"{API}/admin/settings", headers=_h(admin["token"]), json={"late_fee_per_day": -10})
        assert r.status_code == 400

    def test_put_settings_invalid_grace(self, session, admin):
        r = session.put(f"{API}/admin/settings", headers=_h(admin["token"]), json={"grace_days": -1})
        assert r.status_code == 400

    def test_put_settings_non_admin_403(self, session, customer):
        r = session.put(f"{API}/admin/settings", headers=_h(customer["token"]), json={"grace_days": 0})
        assert r.status_code == 403

    def test_put_settings_partial(self, session, admin):
        # restore baseline to known state for later tests: 50 fee, 0 grace
        r = session.put(f"{API}/admin/settings", headers=_h(admin["token"]),
                        json={"late_fee_per_day": 50.0, "grace_days": 0})
        assert r.status_code == 200
        # changing only weekday should not reset fee
        r = session.put(f"{API}/admin/settings", headers=_h(admin["token"]), json={"reminder_weekday": 1})
        assert r.status_code == 200
        g = session.get(f"{API}/admin/settings", headers=_h(admin["token"])).json()
        assert g["reminder_weekday"] == 1
        assert g["late_fee_per_day"] == 50.0


# --------- REMINDERS RUN ----------
class TestRemindersRun:
    def test_reminders_run_non_admin_403(self, session, customer):
        r = session.post(f"{API}/admin/reminders/run", headers=_h(customer["token"]))
        assert r.status_code == 403

    def test_reminders_run_ok(self, session, admin):
        r = session.post(f"{API}/admin/reminders/run", headers=_h(admin["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert "reminders_sent" in d
        assert isinstance(d["reminders_sent"], int)

    def test_reminders_idempotent_within_6_days(self, session, admin):
        # immediate re-run should send 0 reminders (last_at within 6 days)
        r = session.post(f"{API}/admin/reminders/run", headers=_h(admin["token"]))
        assert r.status_code == 200
        assert r.json()["reminders_sent"] == 0


# --------- LATE FEE ENGINE (end-to-end) ----------
# Uses direct DB manipulation to backdate due_date.
class TestLateFeeEngine:
    @pytest.mark.asyncio
    async def test_late_fee_auto_recomputed_on_payments_me(self, session, admin, customer):
        # Reset settings to fee=50, grace=0 first
        r = session.put(f"{API}/admin/settings", headers=_h(admin["token"]),
                        json={"late_fee_per_day": 50.0, "grace_days": 0})
        assert r.status_code == 200

        # Create vehicle + assign to customer
        payload = {
            "vehicle_type": "TEST EV LF", "model": "TEST LateFeeBike",
            "number_plate": f"TEST-LF-{uuid.uuid4().hex[:6]}", "weekly_rent": 1000.0,
            "instructions": ["lf"], "image_url": None,
        }
        c = session.post(f"{API}/vehicles", headers=_h(admin["token"]), json=payload)
        assert c.status_code == 200, c.text
        vid = c.json()["id"]

        ar = session.post(f"{API}/vehicles/assign", headers=_h(admin["token"]),
                          json={"user_id": customer["user_id"], "vehicle_id": vid})
        assert ar.status_code == 200, ar.text

        # Find the pending payment
        pmts = session.get(f"{API}/payments/me", headers=_h(customer["token"])).json()
        pending = [p for p in pmts if p["status"] == "pending" and p["vehicle_id"] == vid]
        assert pending, pmts
        pid = pending[0]["id"]

        # Backdate due_date 3 days ago via direct DB
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]
        cli = AsyncIOMotorClient(mongo_url)
        db = cli[db_name]
        back = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        await db.payments.update_one({"id": pid}, {"$set": {"due_date": back, "late_fee": 0.0}})

        # Re-list payments → triggers _compute_late_fees_once
        pmts2 = session.get(f"{API}/payments/me", headers=_h(customer["token"])).json()
        target = next((p for p in pmts2 if p["id"] == pid), None)
        assert target, pmts2
        # 3 days overdue * ₹50 = ₹150 expected
        assert target["late_fee"] == 150.0, f"Expected 150, got {target}"

        # mark-paid should bill amount + late_fee
        txn = f"TEST_TXN_LF_{uuid.uuid4().hex[:6]}"
        mp = session.post(f"{API}/payments/{pid}/mark-paid",
                          headers=_h(customer["token"]), json={"transaction_id": txn})
        assert mp.status_code == 200, mp.text
        # next pending payment should exist with late_fee == 0
        pmts3 = session.get(f"{API}/payments/me", headers=_h(customer["token"])).json()
        new_pending = [p for p in pmts3 if p["status"] == "pending"]
        assert new_pending, pmts3
        assert all(p["late_fee"] == 0.0 for p in new_pending), new_pending

        # Admin notification has total = 1000 + 150 = 1150
        notifs = session.get(f"{API}/notifications/me", headers=_h(admin["token"])).json()
        assert any("Payment Received" in n["title"] and "1150" in n["body"] for n in notifs), \
            [n["body"] for n in notifs if "Payment" in n["title"]]

        cli.close()

    @pytest.mark.asyncio
    async def test_grace_days_reduces_late_fee(self, session, admin, customer):
        # Set grace_days = 2 → 3 days late means 1 billable day = ₹50
        r = session.put(f"{API}/admin/settings", headers=_h(admin["token"]),
                        json={"late_fee_per_day": 50.0, "grace_days": 2})
        assert r.status_code == 200

        # Find current pending payment for customer
        pmts = session.get(f"{API}/payments/me", headers=_h(customer["token"])).json()
        pending = [p for p in pmts if p["status"] == "pending"]
        assert pending, pmts
        pid = pending[0]["id"]

        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]
        cli = AsyncIOMotorClient(mongo_url)
        db = cli[db_name]
        back = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        await db.payments.update_one({"id": pid}, {"$set": {"due_date": back, "late_fee": 0.0}})

        pmts2 = session.get(f"{API}/payments/me", headers=_h(customer["token"])).json()
        target = next((p for p in pmts2 if p["id"] == pid), None)
        assert target["late_fee"] == 50.0, f"Expected 50 (1 billable day after 2 grace), got {target}"

        # reset to baseline
        session.put(f"{API}/admin/settings", headers=_h(admin["token"]),
                    json={"late_fee_per_day": 50.0, "grace_days": 0})
        cli.close()
