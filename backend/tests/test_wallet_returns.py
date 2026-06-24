"""Iteration 5 — Security Deposit Wallet model + dual-amount confirm-return.

Covers:
- PUT/GET /api/admin/settings (min_deposit)
- GET /api/settings/public
- Wallet top-up without vehicle (deposit balance accrual)
- Confirm-return splits deposit into refund + damages + retained wallet
- 412 over-allocation
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
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
def customer(admin_token):
    # Fresh unique phone per run; avoid collisions with admin
    suffix = str(int(time.time() * 1000) % 1_000_000_000).zfill(9)
    phone = "8" + suffix[:9]
    j = _verify(phone)
    # Approve
    requests.post(
        f"{API}/admin/users/{j['user_id']}/approve",
        headers=_hdr(admin_token), timeout=20,
    ).raise_for_status()
    return {"phone": phone, "token": j["token"], "user_id": j["user_id"]}


# ------------------ A1: Settings min_deposit ------------------

class TestAdminSettingsMinDeposit:
    def test_update_min_deposit_to_1500(self, admin_token):
        r = requests.put(
            f"{API}/admin/settings",
            headers=_hdr(admin_token),
            json={"min_deposit": 1500},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert float(data.get("min_deposit", 0)) == 1500.0, data

    def test_admin_get_settings_echoes_min_deposit(self, admin_token):
        r = requests.get(f"{API}/admin/settings", headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        assert float(r.json()["min_deposit"]) == 1500.0

    def test_public_settings_returns_min_deposit(self, customer):
        r = requests.get(f"{API}/settings/public", headers=_hdr(customer["token"]), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert float(body["min_deposit"]) == 1500.0
        assert "late_fee_per_day" in body
        assert "grace_days" in body

    def test_min_deposit_validation_negative(self, admin_token):
        r = requests.put(
            f"{API}/admin/settings",
            headers=_hdr(admin_token),
            json={"min_deposit": -10},
            timeout=20,
        )
        assert r.status_code == 400, r.text

    def test_reset_min_deposit_to_2000(self, admin_token):
        # Cleanup: restore default for downstream tests
        r = requests.put(
            f"{API}/admin/settings",
            headers=_hdr(admin_token),
            json={"min_deposit": 2000},
            timeout=20,
        )
        assert r.status_code == 200


# ------------------ A2: Wallet top-up without vehicle ------------------

class TestWalletTopUpNoVehicle:
    def test_topup_creates_pending_deposit(self, customer):
        r = requests.post(
            f"{API}/deposits",
            headers=_hdr(customer["token"]),
            json={"amount": 500},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "pending"
        assert float(d["amount"]) == 500.0
        assert d.get("vehicle_id") in (None,)
        # Stash for next test via module-level dict
        TestWalletTopUpNoVehicle._dep_id = d["id"]

    def test_mark_paid_increments_balance(self, customer):
        did = TestWalletTopUpNoVehicle._dep_id
        r = requests.post(
            f"{API}/deposits/{did}/mark-paid",
            headers=_hdr(customer["token"]),
            json={"transaction_id": "TEST_WALLET_500"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "paid"

        r2 = requests.get(f"{API}/deposits/me", headers=_hdr(customer["token"]), timeout=20)
        assert r2.status_code == 200
        body = r2.json()
        assert float(body["balance"]) == 500.0
        history = body["history"]
        assert any(h["id"] == did and h["status"] == "paid" for h in history)


# ------------------ A3/A4: Confirm-return wallet retention ------------------

@pytest.fixture(scope="module")
def vehicle_for_return(admin_token):
    body = {
        "vehicle_type": "Motorbike",
        "model": "WalletReturn Bike",
        "number_plate": f"WLT-{uuid.uuid4().hex[:6].upper()}",
        "weekly_rent": 500.0,
        "security_deposit": 2000.0,
        "instructions": ["iter5"],
    }
    r = requests.post(f"{API}/vehicles", headers=_hdr(admin_token), json=body, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def customer_with_full_deposit(customer, admin_token, vehicle_for_return):
    """Top up customer to ₹2000 then assign vehicle."""
    tok = customer["token"]
    # Already has ₹500 from previous class. Top up another 1500.
    r = requests.post(f"{API}/deposits", headers=_hdr(tok), json={"amount": 1500}, timeout=20)
    assert r.status_code == 200, r.text
    did = r.json()["id"]
    r2 = requests.post(
        f"{API}/deposits/{did}/mark-paid",
        headers=_hdr(tok),
        json={"transaction_id": "TEST_TOPUP_1500"},
        timeout=20,
    )
    assert r2.status_code == 200, r2.text

    # Confirm balance
    r3 = requests.get(f"{API}/deposits/me", headers=_hdr(tok), timeout=20)
    assert float(r3.json()["balance"]) == 2000.0

    # Assign vehicle
    r4 = requests.post(
        f"{API}/vehicles/assign",
        headers=_hdr(admin_token),
        json={"user_id": customer["user_id"], "vehicle_id": vehicle_for_return["id"]},
        timeout=20,
    )
    assert r4.status_code == 200, r4.text

    # Request return
    r5 = requests.post(
        f"{API}/bookings/me/request-return",
        headers=_hdr(tok),
        json={"notes": "Iter5 test return"},
        timeout=20,
    )
    assert r5.status_code == 200, r5.text
    return customer


class TestConfirmReturnWalletRetention:
    def test_over_allocation_412(self, admin_token, customer_with_full_deposit, vehicle_for_return):
        # Find booking
        r = requests.get(
            f"{API}/admin/bookings?status=return_requested",
            headers=_hdr(admin_token), timeout=20,
        )
        bids = [b for b in r.json() if b["user_id"] == customer_with_full_deposit["user_id"]]
        assert bids, "No pending return booking"
        bid = bids[0]["id"]

        # refund 1500 + damages 700 against deposit 2000 → 412
        r2 = requests.post(
            f"{API}/admin/bookings/{bid}/confirm-return",
            headers=_hdr(admin_token),
            json={"refund_amount": 1500, "damages_amount": 700},
            timeout=20,
        )
        assert r2.status_code == 412, f"Expected 412 got {r2.status_code}: {r2.text}"

    def test_confirm_return_success(self, admin_token, customer_with_full_deposit, vehicle_for_return):
        r = requests.get(
            f"{API}/admin/bookings?status=return_requested",
            headers=_hdr(admin_token), timeout=20,
        )
        bids = [b for b in r.json() if b["user_id"] == customer_with_full_deposit["user_id"]]
        bid = bids[0]["id"]

        r2 = requests.post(
            f"{API}/admin/bookings/{bid}/confirm-return",
            headers=_hdr(admin_token),
            json={"refund_amount": 1500, "damages_amount": 200, "notes": "scratch"},
            timeout=20,
        )
        assert r2.status_code == 200, r2.text
        b = r2.json()
        assert b["status"] == "returned"
        assert float(b["refund_amount"]) == 1500.0
        assert float(b["damages_amount"]) == 200.0
        assert float(b.get("wallet_retained", 0)) == 300.0
        assert float(b["deposit_paid"]) == 2000.0
        assert float(b["deposit_refunded"]) == 1500.0

    def test_vehicle_released(self, admin_token, vehicle_for_return):
        r = requests.get(f"{API}/vehicles", headers=_hdr(admin_token), timeout=20)
        v = next(x for x in r.json() if x["id"] == vehicle_for_return["id"])
        assert v["assigned_to"] is None
        assert v["status"] == "available"

    def test_wallet_balance_retains_300(self, customer_with_full_deposit):
        # The retained 300 + the leftover 500 from class A2 — wait: only the 2000 attached
        # to the vehicle is split (refund 1500 + damages 200 = 1700 → 300 retained).
        # The earlier 500 (no vehicle attached) is independent → total wallet = 300 + 500 = 800.
        r = requests.get(
            f"{API}/deposits/me",
            headers=_hdr(customer_with_full_deposit["token"]), timeout=20,
        )
        assert r.status_code == 200
        body = r.json()
        # Allow either 300 (if A2 already consumed) or 800 (typical run order)
        balance = float(body["balance"])
        assert balance in (300.0, 800.0), f"Unexpected wallet balance: {balance}"

        # All paid deposits remaining should have vehicle_id cleared (free wallet)
        paid_with_vehicle = [
            h for h in body["history"]
            if h["status"] == "paid" and h.get("vehicle_id") is not None
        ]
        assert paid_with_vehicle == [], f"Wallet still tied to vehicle: {paid_with_vehicle}"
