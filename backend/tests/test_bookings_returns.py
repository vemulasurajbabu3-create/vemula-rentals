"""Iteration 4 — Booking History + Vehicle Return flow.

Covers:
- POST /api/vehicles/assign creates booking (active)
- GET /api/bookings/me
- POST /api/bookings/me/request-return + cancel-return
- GET /api/admin/bookings with status filter
- POST /api/admin/bookings/{bid}/confirm-return (success + 412 over-refund)
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rentwheel-connect.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _verify(phone, otp="123456"):
    r = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp}, timeout=20)
    r.raise_for_status()
    return r.json()


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _verify("9999999999")["token"]


@pytest.fixture(scope="module")
def customer():
    # Fresh phone each run
    phone = "9" + str(int(time.time()) % 1000000000).zfill(9)
    if phone == "9999999999":
        phone = "9000000001"
    j = _verify(phone)
    return {"phone": phone, "token": j["token"], "user_id": j["user_id"]}


@pytest.fixture(scope="module")
def approved_customer(admin_token, customer):
    requests.post(f"{API}/admin/users/{customer['user_id']}/approve", headers=_hdr(admin_token), timeout=20).raise_for_status()
    return customer


@pytest.fixture(scope="module")
def vehicle(admin_token):
    body = {
        "vehicle_type": "Motorbike",
        "model": "TestBike Iter4",
        "number_plate": f"TST-{uuid.uuid4().hex[:6].upper()}",
        "weekly_rent": 500.0,
        "security_deposit": 2000.0,
        "instructions": ["test"],
    }
    r = requests.post(f"{API}/vehicles", headers=_hdr(admin_token), json=body, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def deposit_paid(approved_customer):
    tok = approved_customer["token"]
    # Create deposit and mark paid
    r = requests.post(f"{API}/deposits", headers=_hdr(tok), json={"amount": 2000.0}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    r2 = requests.post(f"{API}/deposits/{d['id']}/mark-paid", headers=_hdr(tok), json={"transaction_id": "TEST_TXN_IT4"}, timeout=20)
    assert r2.status_code == 200, r2.text
    return d


@pytest.fixture(scope="module")
def assigned(admin_token, approved_customer, vehicle, deposit_paid):
    r = requests.post(f"{API}/vehicles/assign", headers=_hdr(admin_token), json={
        "user_id": approved_customer["user_id"], "vehicle_id": vehicle["id"],
    }, timeout=20)
    assert r.status_code == 200, r.text
    return True


# ---------- Tests ----------

def test_assign_creates_active_booking(admin_token, approved_customer, vehicle, assigned):
    # GET /api/bookings/me
    r = requests.get(f"{API}/bookings/me", headers=_hdr(approved_customer["token"]), timeout=20)
    assert r.status_code == 200, r.text
    bookings = r.json()
    assert isinstance(bookings, list) and len(bookings) >= 1
    active = [b for b in bookings if b["status"] == "active" and b["vehicle_id"] == vehicle["id"]]
    assert active, f"No active booking found: {bookings}"
    b = active[0]
    assert b["vehicle_snapshot"]["model"] == "TestBike Iter4"
    assert b["vehicle_snapshot"]["number_plate"] == vehicle["number_plate"]
    assert float(b["vehicle_snapshot"]["security_deposit"]) == 2000.0
    assert float(b["vehicle_snapshot"]["weekly_rent"]) == 500.0
    assert b["start_date"]
    assert b["end_date"] is None
    # Also visible via admin?status=active
    r2 = requests.get(f"{API}/admin/bookings?status=active", headers=_hdr(admin_token), timeout=20)
    assert r2.status_code == 200
    assert any(x["id"] == b["id"] for x in r2.json())


def test_request_return_then_cancel(approved_customer):
    tok = approved_customer["token"]
    r = requests.post(f"{API}/bookings/me/request-return", headers=_hdr(tok), json={"notes": "Returning tomorrow, brake check pending"}, timeout=20)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["status"] == "return_requested"
    assert b["customer_notes"] == "Returning tomorrow, brake check pending"
    assert b["return_requested_at"]
    # cancel
    r2 = requests.post(f"{API}/bookings/me/cancel-return", headers=_hdr(tok), json={}, timeout=20)
    assert r2.status_code == 200, r2.text
    b2 = r2.json()
    assert b2["status"] == "active"
    assert b2["customer_notes"] is None


def test_admin_sees_pending_return(admin_token, approved_customer):
    # request again so admin can confirm
    tok = approved_customer["token"]
    r = requests.post(f"{API}/bookings/me/request-return", headers=_hdr(tok), json={"notes": "Final return"}, timeout=20)
    assert r.status_code == 200
    r2 = requests.get(f"{API}/admin/bookings?status=return_requested", headers=_hdr(admin_token), timeout=20)
    assert r2.status_code == 200
    pending = [b for b in r2.json() if b["user_id"] == approved_customer["user_id"]]
    assert pending, "Admin did not see pending return"


def test_confirm_return_over_refund_412(admin_token, approved_customer):
    r = requests.get(f"{API}/admin/bookings?status=return_requested", headers=_hdr(admin_token), timeout=20)
    bid = [b for b in r.json() if b["user_id"] == approved_customer["user_id"]][0]["id"]
    r2 = requests.post(f"{API}/admin/bookings/{bid}/confirm-return", headers=_hdr(admin_token), json={"refund_amount": 99999, "notes": "over"}, timeout=20)
    assert r2.status_code == 412, f"Expected 412, got {r2.status_code}: {r2.text}"


def test_confirm_return_success(admin_token, approved_customer, vehicle):
    r = requests.get(f"{API}/admin/bookings?status=return_requested", headers=_hdr(admin_token), timeout=20)
    bid = [b for b in r.json() if b["user_id"] == approved_customer["user_id"]][0]["id"]
    r2 = requests.post(f"{API}/admin/bookings/{bid}/confirm-return", headers=_hdr(admin_token),
                      json={"refund_amount": 1500, "notes": "Minor scratch"}, timeout=20)
    assert r2.status_code == 200, r2.text
    b = r2.json()
    assert b["status"] == "returned"
    assert b["end_date"]
    assert b["returned_at"]
    assert float(b["deposit_paid"]) == 2000.0
    assert float(b["deposit_refunded"]) == 1500.0
    assert float(b["refund_amount"]) == 1500.0

    # vehicle released
    r3 = requests.get(f"{API}/vehicles", headers=_hdr(admin_token), timeout=20)
    assert r3.status_code == 200
    v = [x for x in r3.json() if x["id"] == vehicle["id"]][0]
    assert v["assigned_to"] is None
    assert v["status"] == "available"
    assert v["rental_start_date"] is None

    # deposits split: refunded sum=1500, forfeited sum=500
    r4 = requests.get(f"{API}/admin/deposits", headers=_hdr(admin_token), timeout=20)
    assert r4.status_code == 200
    user_deps = [d for d in r4.json() if d["user_id"] == approved_customer["user_id"] and d.get("vehicle_id") == vehicle["id"]]
    refunded = sum(float(d["amount"]) for d in user_deps if d["status"] == "refunded")
    forfeited = sum(float(d["amount"]) for d in user_deps if d["status"] == "forfeited")
    assert abs(refunded - 1500.0) < 0.5, f"refunded={refunded}"
    assert abs(forfeited - 500.0) < 0.5, f"forfeited={forfeited}"

    # pending payments for this user+vehicle deleted
    r5 = requests.get(f"{API}/payments/me", headers=_hdr(approved_customer["token"]), timeout=20)
    pending = [p for p in r5.json() if p.get("vehicle_id") == vehicle["id"] and p["status"] == "pending"]
    assert pending == [], f"Pending payments not cleared: {pending}"


def test_history_shows_returned_booking(approved_customer, vehicle):
    r = requests.get(f"{API}/bookings/me", headers=_hdr(approved_customer["token"]), timeout=20)
    assert r.status_code == 200
    bks = [b for b in r.json() if b["vehicle_id"] == vehicle["id"]]
    assert bks and bks[0]["status"] == "returned"
    assert float(bks[0]["deposit_refunded"]) == 1500.0
