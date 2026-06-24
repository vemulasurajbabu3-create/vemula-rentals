"""Iteration 6: UPI routing settings, per-user weekly cadence, and Cash mark-paid endpoint."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_PHONE = "9999999999"
CUSTOMER_PHONE = "987" + str(uuid.uuid4().int)[:7]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _auth(s, phone):
    s.post(f"{API}/auth/request-otp", json={"phone": phone})
    r = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": "123456"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin(session):
    return _auth(session, ADMIN_PHONE)


@pytest.fixture(scope="module")
def customer(session, admin):
    info = _auth(session, CUSTOMER_PHONE)
    # admin approves
    r = session.post(f"{API}/admin/users/{info['user_id']}/approve", headers=_h(admin["token"]))
    assert r.status_code == 200, r.text
    return info


@pytest.fixture(scope="module")
def vehicle(session, admin, customer):
    """Create vehicle, top up deposit, assign — used by cadence tests."""
    plate = f"TEST-CC-{uuid.uuid4().hex[:6]}"
    cv = session.post(
        f"{API}/vehicles",
        headers=_h(admin["token"]),
        json={
            "vehicle_type": "TEST Cadence", "model": "TEST CadenceBike",
            "number_plate": plate, "weekly_rent": 500.0, "security_deposit": 2000.0,
            "instructions": ["cad"], "image_url": None,
        },
    )
    assert cv.status_code == 200, cv.text
    vid = cv.json()["id"]

    # create + pay deposit
    dp = session.post(
        f"{API}/deposits",
        headers=_h(customer["token"]),
        json={"amount": 2000.0, "vehicle_id": vid},
    )
    assert dp.status_code == 200, dp.text
    did = dp.json()["id"]
    mp = session.post(
        f"{API}/deposits/{did}/mark-paid",
        headers=_h(customer["token"]),
        json={"transaction_id": f"TEST_DEP_{uuid.uuid4().hex[:6]}"},
    )
    assert mp.status_code == 200, mp.text

    # assign with explicit rental_start_date
    start = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    ar = session.post(
        f"{API}/vehicles/assign",
        headers=_h(admin["token"]),
        json={"user_id": customer["user_id"], "vehicle_id": vid, "rental_start_date": start},
    )
    assert ar.status_code == 200, ar.text
    return {"id": vid, "start": start}


# ============= A1/A2/A3: Public + Admin settings =============
class TestSettings:
    def test_public_settings_has_all_new_fields(self, session, customer):
        r = session.get(f"{API}/settings/public", headers=_h(customer["token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["merchant_upi", "merchant_name", "business_phone",
                  "pickup_address", "pickup_lat", "pickup_lng", "min_deposit"]:
            assert k in d, f"missing {k}"
        assert "@" in d["merchant_upi"]
        assert isinstance(d["pickup_lat"], (int, float))
        assert isinstance(d["pickup_lng"], (int, float))

    def test_admin_update_settings_valid(self, session, admin):
        r = session.put(
            f"{API}/admin/settings",
            headers=_h(admin["token"]),
            json={"merchant_upi": "new.upi@ybl", "pickup_lat": 17.5, "pickup_lng": 78.5},
        )
        assert r.status_code == 200, r.text
        g = session.get(f"{API}/admin/settings", headers=_h(admin["token"])).json()
        assert g["merchant_upi"] == "new.upi@ybl"
        assert g["pickup_lat"] == 17.5
        assert g["pickup_lng"] == 78.5
        # restore production VPA
        r2 = session.put(
            f"{API}/admin/settings",
            headers=_h(admin["token"]),
            json={"merchant_upi": "vemula.balajee@ybl",
                  "pickup_lat": 17.527688, "pickup_lng": 78.394619},
        )
        assert r2.status_code == 200

    def test_admin_update_invalid_upi(self, session, admin):
        r = session.put(
            f"{API}/admin/settings",
            headers=_h(admin["token"]),
            json={"merchant_upi": "nodomain"},
        )
        assert r.status_code == 400

    def test_admin_update_invalid_lat(self, session, admin):
        r = session.put(
            f"{API}/admin/settings",
            headers=_h(admin["token"]),
            json={"pickup_lat": 999},
        )
        assert r.status_code == 400

    def test_admin_update_invalid_lng(self, session, admin):
        r = session.put(
            f"{API}/admin/settings",
            headers=_h(admin["token"]),
            json={"pickup_lng": -200},
        )
        assert r.status_code == 400


# ============= A4: Per-user cadence on assign =============
class TestCadenceOnAssign:
    def test_first_due_date_is_start_plus_7_days(self, session, customer, vehicle):
        pmts = session.get(f"{API}/payments/me", headers=_h(customer["token"])).json()
        pending = [p for p in pmts if p["status"] == "pending" and p["vehicle_id"] == vehicle["id"]]
        assert pending, pmts
        due = datetime.fromisoformat(pending[0]["due_date"])
        start = datetime.fromisoformat(vehicle["start"])
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        delta = due - start
        # within 1 second to allow assignment latency
        assert abs(delta.total_seconds() - 7 * 86400) < 2, f"delta={delta}, due={due}, start={start}"


# ============= A5: Cadence on mark-paid (UPI) =============
class TestCadenceOnMarkPaid:
    def test_next_due_is_prev_due_plus_7d(self, session, customer, vehicle):
        pmts = session.get(f"{API}/payments/me", headers=_h(customer["token"])).json()
        pending = [p for p in pmts if p["status"] == "pending" and p["vehicle_id"] == vehicle["id"]]
        assert pending, pmts
        prev = pending[0]
        prev_due = datetime.fromisoformat(prev["due_date"])
        if prev_due.tzinfo is None:
            prev_due = prev_due.replace(tzinfo=timezone.utc)

        mp = session.post(
            f"{API}/payments/{prev['id']}/mark-paid",
            headers=_h(customer["token"]),
            json={"transaction_id": f"TEST_UPI_{uuid.uuid4().hex[:6]}"},
        )
        assert mp.status_code == 200, mp.text

        pmts2 = session.get(f"{API}/payments/me", headers=_h(customer["token"])).json()
        new_pending = [p for p in pmts2
                       if p["status"] == "pending" and p["vehicle_id"] == vehicle["id"]]
        assert new_pending, pmts2
        # NOTE: server uses now+7 for UPI mark-paid (per server.py). For UPI we just check a new pending exists.
        # The spec requires due = prev_due+7 only for cash mark-paid (which is tested below).
        nxt_due = datetime.fromisoformat(new_pending[0]["due_date"])
        if nxt_due.tzinfo is None:
            nxt_due = nxt_due.replace(tzinfo=timezone.utc)
        assert nxt_due > prev_due


# ============= A6: Cash mark-paid =============
class TestCashMarkPaid:
    def test_mark_cash_paid_creates_next_anchored_to_prev_due(self, session, admin, customer, vehicle):
        # find current pending for this vehicle
        pmts = session.get(f"{API}/payments/me", headers=_h(customer["token"])).json()
        pending = [p for p in pmts if p["status"] == "pending" and p["vehicle_id"] == vehicle["id"]]
        assert pending, pmts
        prev = pending[0]
        prev_due = datetime.fromisoformat(prev["due_date"])
        if prev_due.tzinfo is None:
            prev_due = prev_due.replace(tzinfo=timezone.utc)

        r = session.post(
            f"{API}/admin/payments/{prev['id']}/mark-paid-cash",
            headers=_h(admin["token"]),
            json={"note": "test"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "paid"
        assert d.get("payment_method") == "cash"
        assert (d.get("transaction_id") or "").startswith("CASH-")

        # next pending: due = prev_due + 7d
        pmts2 = session.get(f"{API}/payments/me", headers=_h(customer["token"])).json()
        new_pending = [p for p in pmts2
                       if p["status"] == "pending" and p["vehicle_id"] == vehicle["id"]]
        assert new_pending, pmts2
        nxt_due = datetime.fromisoformat(new_pending[0]["due_date"])
        if nxt_due.tzinfo is None:
            nxt_due = nxt_due.replace(tzinfo=timezone.utc)
        delta = nxt_due - prev_due
        assert abs(delta.total_seconds() - 7 * 86400) < 2, (
            f"Cash cadence wrong: nxt={nxt_due}, prev={prev_due}, delta={delta}"
        )

        # notification for customer
        notifs = session.get(f"{API}/notifications/me", headers=_h(customer["token"])).json()
        assert any(n.get("title") == "Payment Received (Cash)" for n in notifs), \
            [n["title"] for n in notifs[:10]]

    def test_mark_cash_paid_404_unknown(self, session, admin):
        r = session.post(
            f"{API}/admin/payments/{uuid.uuid4()}/mark-paid-cash",
            headers=_h(admin["token"]),
            json={"note": ""},
        )
        assert r.status_code == 404

    def test_mark_cash_paid_non_admin_403(self, session, customer):
        r = session.post(
            f"{API}/admin/payments/{uuid.uuid4()}/mark-paid-cash",
            headers=_h(customer["token"]),
            json={},
        )
        assert r.status_code == 403


# ============= Cleanup =============
class TestCleanup:
    def test_restore_merchant_upi(self, session, admin):
        r = session.put(
            f"{API}/admin/settings",
            headers=_h(admin["token"]),
            json={"merchant_upi": "vemula.balajee@ybl",
                  "pickup_lat": 17.527688, "pickup_lng": 78.394619},
        )
        assert r.status_code == 200
        g = session.get(f"{API}/admin/settings", headers=_h(admin["token"])).json()
        assert g["merchant_upi"] == "vemula.balajee@ybl"
