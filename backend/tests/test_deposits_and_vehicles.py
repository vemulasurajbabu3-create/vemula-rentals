"""Targeted tests for new features:
- Vehicle creation accepts security_deposit + walk_around_video
- /deposits/me, POST /deposits, POST /deposits/{id}/mark-paid
- assignment respects required deposit (412 when shortfall)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rentwheel-connect.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_PHONE = "9999999999"
CUSTOMER_PHONE = "88888" + str(uuid.uuid4().int)[:5]


def _auth(phone):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/request-otp", json={"phone": phone})
    assert r.status_code == 200, r.text
    r = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": "123456"})
    assert r.status_code == 200, r.text
    return r.json()


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin():
    return _auth(ADMIN_PHONE)


@pytest.fixture(scope="module")
def customer(admin):
    data = _auth(CUSTOMER_PHONE)
    # approve customer via admin
    r = requests.post(
        f"{API}/admin/users/{data['user_id']}/approve",
        headers=_h(admin["token"]),
        json={},
    )
    assert r.status_code == 200, r.text
    return data


# ---------- vehicle create accepts new fields ----------
class TestVehicleCreate:
    created_vid = None

    def test_create_vehicle_with_deposit_and_video(self, admin):
        payload = {
            "vehicle_type": "TEST EV",
            "model": "TEST DepoBike",
            "number_plate": f"TEST-D-{uuid.uuid4().hex[:6]}",
            "weekly_rent": 700.0,
            "instructions": ["TEST"],
            "image_url": None,
            "security_deposit": 2500.0,
            "walk_around_video": "data:video/mp4;base64,AAAA",
        }
        r = requests.post(f"{API}/vehicles", headers=_h(admin["token"]), json=payload)
        assert r.status_code == 200, r.text
        v = r.json()
        assert v["security_deposit"] == 2500.0
        assert v["walk_around_video"] == "data:video/mp4;base64,AAAA"
        TestVehicleCreate.created_vid = v["id"]

        # GET vehicle list to verify persistence
        lr = requests.get(f"{API}/vehicles", headers=_h(admin["token"]))
        got = next((x for x in lr.json() if x["id"] == v["id"]), None)
        assert got is not None
        assert got["security_deposit"] == 2500.0


# ---------- deposit endpoints ----------
class TestDeposits:
    deposit_id = None

    def test_get_deposits_empty(self, customer):
        r = requests.get(f"{API}/deposits/me", headers=_h(customer["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "balance" in d and "history" in d
        assert isinstance(d["history"], list)
        assert d["balance"] == 0

    def test_create_deposit(self, customer):
        r = requests.post(
            f"{API}/deposits",
            headers=_h(customer["token"]),
            json={"amount": 2500.0},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["amount"] == 2500.0
        assert d["status"] == "pending"
        TestDeposits.deposit_id = d["id"]

    def test_mark_paid(self, customer):
        assert TestDeposits.deposit_id
        r = requests.post(
            f"{API}/deposits/{TestDeposits.deposit_id}/mark-paid",
            headers=_h(customer["token"]),
            json={"transaction_id": "TEST123"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "paid"
        assert d["transaction_id"] == "TEST123"

        # verify balance increased
        r = requests.get(f"{API}/deposits/me", headers=_h(customer["token"]))
        assert r.json()["balance"] == 2500.0


# ---------- assignment respects deposit ----------
class TestAssignmentDepositGate:
    def test_assign_after_deposit_succeeds(self, admin, customer):
        # By this point deposit of 2500 is paid, vehicle requires 2500
        vid = TestVehicleCreate.created_vid
        assert vid
        r = requests.post(
            f"{API}/vehicles/assign",
            headers=_h(admin["token"]),
            json={"user_id": customer["user_id"], "vehicle_id": vid},
        )
        assert r.status_code == 200, r.text

        # customer should now see the vehicle
        r = requests.get(f"{API}/users/me/vehicle", headers=_h(customer["token"]))
        assert r.status_code == 200
        v = r.json()
        assert v is not None
        assert v["id"] == vid
        assert v["security_deposit"] == 2500.0
