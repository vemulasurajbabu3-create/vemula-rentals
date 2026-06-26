"""Tests for DELETE /api/admin/users/{uid} cascade.

Covers:
1. Full cascade delete (releases vehicle, deletes payments/deposits/docs, cancels active bookings).
2. Cannot delete self (400).
3. Cannot delete another admin (403).
4. 404 on non-existent user.
5. Non-admin caller forbidden (403 via admin_required).
"""
import os
import uuid
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

# Load backend env for direct mongo access
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://rentwheel-connect.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

ADMIN_PHONE = "9999999999"


def _auth(phone):
    r = requests.post(f"{API}/auth/request-otp", json={"phone": phone})
    assert r.status_code == 200, r.text
    r = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": "123456"})
    assert r.status_code == 200, r.text
    return r.json()


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin():
    return _auth(ADMIN_PHONE)


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _new_phone():
    return "777" + str(uuid.uuid4().int)[:7]


def _make_approved_customer(admin):
    """Sign up a fresh customer via OTP and approve them as admin."""
    data = _auth(_new_phone())
    r = requests.post(
        f"{API}/admin/users/{data['user_id']}/approve",
        headers=_h(admin["token"]),
        json={},
    )
    assert r.status_code == 200, r.text
    return data


# ---------- 1) Full cascade delete ----------
class TestCascadeDelete:
    def test_delete_user_full_cascade(self, admin, mongo):
        customer = _make_approved_customer(admin)
        cust_token = customer["token"]
        cust_id = customer["user_id"]

        # 1a. Create a vehicle (security_deposit=500 to keep <= wallet of 500)
        veh_payload = {
            "vehicle_type": "TEST EV",
            "model": "TEST DelBike",
            "number_plate": f"TEST-DEL-{uuid.uuid4().hex[:6]}",
            "weekly_rent": 400.0,
            "security_deposit": 500.0,
            "instructions": ["TEST"],
        }
        r = requests.post(f"{API}/vehicles", headers=_h(admin["token"]), json=veh_payload)
        assert r.status_code == 200, r.text
        vid = r.json()["id"]

        # 1b. Customer creates and pays a security deposit of 500
        r = requests.post(
            f"{API}/deposits",
            headers=_h(cust_token),
            json={"amount": 500.0},
        )
        assert r.status_code == 200, r.text
        dep_id = r.json()["id"]
        r = requests.post(
            f"{API}/deposits/{dep_id}/mark-paid",
            headers=_h(cust_token),
            json={"transaction_id": "TEST-DEL-DEP"},
        )
        assert r.status_code == 200

        # 1c. Assign vehicle -> creates booking + pending payment
        r = requests.post(
            f"{API}/vehicles/assign",
            headers=_h(admin["token"]),
            json={"user_id": cust_id, "vehicle_id": vid},
        )
        assert r.status_code == 200, r.text

        # 1d. Pay the weekly pending payment to add a paid payment row
        r = requests.get(f"{API}/payments/me", headers=_h(cust_token))
        assert r.status_code == 200
        pendings = [p for p in r.json() if p["status"] == "pending"]
        assert pendings, "expected at least one pending payment after assign"
        pid = pendings[0]["id"]
        r = requests.post(
            f"{API}/payments/{pid}/mark-paid",
            headers=_h(cust_token),
            json={"transaction_id": "TEST-DEL-WK", "payment_method": "upi"},
        )
        assert r.status_code == 200, r.text

        # 1e. DELETE the user
        r = requests.delete(
            f"{API}/admin/users/{cust_id}",
            headers=_h(admin["token"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["deleted_user_id"] == cust_id
        assert body["released_vehicle_id"] == vid
        cas = body["cascade_deleted"]
        # at least 1 deposit, 2 payments (paid + new pending), maybe docs/locations 0
        assert cas["deposits"] >= 1
        assert cas["payments"] >= 1

        # 1f. Verify vehicle released (sync pymongo)
        v = mongo.vehicles.find_one({"id": vid}, {"_id": 0})
        assert v is not None
        assert v["assigned_to"] is None
        assert v["status"] == "available"
        assert v.get("rental_start_date") is None

        # 1g. payments/deposits/documents for that user are gone
        assert mongo.payments.count_documents({"user_id": cust_id}) == 0
        assert mongo.deposits.count_documents({"user_id": cust_id}) == 0
        assert mongo.documents.count_documents({"user_id": cust_id}) == 0

        # 1h. active booking is now cancelled
        cancelled = mongo.bookings.count_documents({"user_id": cust_id, "status": "cancelled"})
        assert cancelled >= 1
        active = mongo.bookings.count_documents(
            {"user_id": cust_id, "status": {"$in": ["active", "return_requested"]}}
        )
        assert active == 0

        # 1i. GET /api/admin/users no longer lists the user
        r = requests.get(f"{API}/admin/users", headers=_h(admin["token"]))
        assert r.status_code == 200
        ids = [u["id"] for u in r.json()]
        assert cust_id not in ids

        # cleanup the test vehicle
        requests.delete(f"{API}/vehicles/{vid}", headers=_h(admin["token"]))


# ---------- 2) Cannot delete self ----------
class TestDeleteSelf:
    def test_admin_cannot_delete_self(self, admin):
        r = requests.delete(
            f"{API}/admin/users/{admin['user_id']}",
            headers=_h(admin["token"]),
        )
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "")
        assert "own account" in str(detail).lower()


# ---------- 3) Cannot delete another admin ----------
class TestDeleteOtherAdmin:
    def test_cannot_delete_another_admin(self, admin, mongo):
        other_admin_id = str(uuid.uuid4())
        try:
            mongo.users.insert_one({
                "id": other_admin_id,
                "phone": "5550000001",  # not the special admin phone
                "full_name": "TEST Other Admin",
                "is_admin": True,
                "status": "approved",
                "created_at": "2026-01-01T00:00:00+00:00",
            })
            r = requests.delete(
                f"{API}/admin/users/{other_admin_id}",
                headers=_h(admin["token"]),
            )
            assert r.status_code == 403, r.text
            detail = r.json().get("detail", "")
            assert "admin" in str(detail).lower()
        finally:
            mongo.users.delete_one({"id": other_admin_id})


# ---------- 4) 404 on non-existent user ----------
class TestDeleteMissing:
    def test_delete_nonexistent_user(self, admin):
        fake_id = f"nonexistent-{uuid.uuid4().hex}"
        r = requests.delete(
            f"{API}/admin/users/{fake_id}",
            headers=_h(admin["token"]),
        )
        assert r.status_code == 404, r.text


# ---------- 5) Non-admin caller forbidden ----------
class TestDeleteRequiresAdmin:
    def test_non_admin_caller_forbidden(self, admin):
        # approved customer trying to call DELETE
        attacker = _make_approved_customer(admin)
        victim = _make_approved_customer(admin)
        r = requests.delete(
            f"{API}/admin/users/{victim['user_id']}",
            headers=_h(attacker["token"]),
        )
        assert r.status_code == 403, r.text
        # cleanup via admin
        requests.delete(
            f"{API}/admin/users/{attacker['user_id']}",
            headers=_h(admin["token"]),
        )
        requests.delete(
            f"{API}/admin/users/{victim['user_id']}",
            headers=_h(admin["token"]),
        )
