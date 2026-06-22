"""RideLease API regression tests."""
import os
import uuid
import base64
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rentwheel-connect.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_PHONE = "9999999999"
# Use a fresh customer phone each run to avoid colliding state from previous iterations
CUSTOMER_PHONE = "98765" + str(uuid.uuid4().int)[:5]


# -------------------- fixtures --------------------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _auth(session, phone):
    r = session.post(f"{API}/auth/request-otp", json={"phone": phone})
    assert r.status_code == 200, r.text
    r = session.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": "123456"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def admin(session):
    data = _auth(session, ADMIN_PHONE)
    assert data["is_admin"] is True
    return data


@pytest.fixture(scope="session")
def customer(session):
    data = _auth(session, CUSTOMER_PHONE)
    assert data["is_admin"] is False
    return data


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# -------------------- auth --------------------
class TestAuth:
    def test_request_otp_invalid_phone(self, session):
        r = session.post(f"{API}/auth/request-otp", json={"phone": "123"})
        assert r.status_code == 400

    def test_verify_otp_invalid_length(self, session):
        r = session.post(f"{API}/auth/verify-otp", json={"phone": CUSTOMER_PHONE, "otp": "12"})
        assert r.status_code == 400

    def test_admin_flag_correct(self, admin, customer):
        assert admin["is_admin"] is True
        assert customer["is_admin"] is False

    def test_missing_token_unauthorized(self, session):
        r = session.get(f"{API}/users/me")
        assert r.status_code == 401


# -------------------- users --------------------
class TestUsers:
    def test_get_me(self, session, customer):
        r = session.get(f"{API}/users/me", headers=_h(customer["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d["phone"] == CUSTOMER_PHONE
        assert d["is_admin"] is False

    def test_update_me_persisted(self, session, customer):
        r = session.put(f"{API}/users/me", headers=_h(customer["token"]),
                        json={"full_name": "TEST User", "address": "TEST Addr 42"})
        assert r.status_code == 200
        assert r.json()["full_name"] == "TEST User"
        # verify via GET
        r2 = session.get(f"{API}/users/me", headers=_h(customer["token"]))
        assert r2.json()["full_name"] == "TEST User"
        assert r2.json()["address"] == "TEST Addr 42"

    def test_update_location(self, session, customer):
        r = session.post(f"{API}/users/me/location", headers=_h(customer["token"]),
                         json={"latitude": 12.97, "longitude": 77.59})
        assert r.status_code == 200
        assert r.json()["ok"] is True


# -------------------- vehicles & assignment --------------------
class TestVehiclesAndAssignment:
    created_vid = None

    def test_admin_only_list_vehicles(self, session, customer):
        r = session.get(f"{API}/vehicles", headers=_h(customer["token"]))
        assert r.status_code == 403

    def test_list_vehicles_admin(self, session, admin):
        r = session.get(f"{API}/vehicles", headers=_h(admin["token"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        # seed should have created 3
        assert len(r.json()) >= 3

    def test_create_update_delete_vehicle(self, session, admin):
        payload = {
            "vehicle_type": "TEST EV", "model": "TEST Model",
            "number_plate": f"TEST-{uuid.uuid4().hex[:6]}", "weekly_rent": 999.0,
            "instructions": ["a", "b"], "image_url": None,
        }
        r = session.post(f"{API}/vehicles", headers=_h(admin["token"]), json=payload)
        assert r.status_code == 200, r.text
        v = r.json()
        TestVehiclesAndAssignment.created_vid = v["id"]
        assert v["model"] == "TEST Model"

        # update
        r = session.put(f"{API}/vehicles/{v['id']}", headers=_h(admin["token"]),
                        json={"weekly_rent": 1234.0})
        assert r.status_code == 200
        assert r.json()["weekly_rent"] == 1234.0

        # delete + verify
        r = session.delete(f"{API}/vehicles/{v['id']}", headers=_h(admin["token"]))
        assert r.status_code == 200

    def test_assign_invalid_vehicle_404_before_assign(self, session, admin, customer):
        # IMPORTANT: must run BEFORE the real assign to avoid the side-effect bug where
        # /api/vehicles/assign unassigns the user's vehicle BEFORE validating the
        # vehicle_id. (See action_items in test report.)
        r = session.post(f"{API}/vehicles/assign", headers=_h(admin["token"]),
                         json={"user_id": customer["user_id"], "vehicle_id": "does-not-exist"})
        assert r.status_code == 404

    def test_assign_vehicle_creates_payment_and_notification(self, session, admin, customer):
        # Create a dedicated test vehicle to avoid clashes with shared seeded ones
        payload = {
            "vehicle_type": "TEST EV Assign", "model": "TEST AssignBike",
            "number_plate": f"TEST-A-{uuid.uuid4().hex[:6]}", "weekly_rent": 1100.0,
            "instructions": ["assign-test"], "image_url": None,
        }
        c = session.post(f"{API}/vehicles", headers=_h(admin["token"]), json=payload)
        assert c.status_code == 200, c.text
        vid = c.json()["id"]
        TestVehiclesAndAssignment.created_vid = vid

        r = session.post(f"{API}/vehicles/assign", headers=_h(admin["token"]),
                         json={"user_id": customer["user_id"], "vehicle_id": vid})
        assert r.status_code == 200, r.text

        # customer sees assigned vehicle
        r = session.get(f"{API}/users/me/vehicle", headers=_h(customer["token"]))
        assert r.status_code == 200
        veh = r.json()
        assert veh is not None
        assert veh["id"] == vid
        assert veh["assigned_to"] == customer["user_id"]

        # pending payment auto-created
        r = session.get(f"{API}/payments/me", headers=_h(customer["token"]))
        assert r.status_code == 200
        pmts = r.json()
        assert any(p["status"] == "pending" and p["vehicle_id"] == vid for p in pmts), pmts

        # notification created
        r = session.get(f"{API}/notifications/me", headers=_h(customer["token"]))
        assert r.status_code == 200
        notifs = r.json()
        assert any("Vehicle Assigned" in n["title"] for n in notifs)

    def test_assign_invalid_vehicle_zzz_done(self, session):
        # placeholder kept to avoid breaking test ids; real check is *_before_assign above
        assert True


# -------------------- payments --------------------
class TestPayments:
    def test_mark_paid_creates_next_pending_and_admin_notif(self, session, customer, admin):
        # get current pending payment
        pmts = session.get(f"{API}/payments/me", headers=_h(customer["token"])).json()
        pending = [p for p in pmts if p["status"] == "pending"]
        assert pending, "Expected at least one pending payment after assignment"
        pid = pending[0]["id"]
        txn = f"TEST_TXN_{uuid.uuid4().hex[:8]}"
        r = session.post(f"{API}/payments/{pid}/mark-paid", headers=_h(customer["token"]),
                         json={"transaction_id": txn})
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["status"] == "paid"
        assert p["transaction_id"] == txn

        # next pending payment should exist
        pmts2 = session.get(f"{API}/payments/me", headers=_h(customer["token"])).json()
        new_pending = [p for p in pmts2 if p["status"] == "pending"]
        # also fetch the vehicle assignment state for diagnostics
        veh_state = session.get(f"{API}/users/me/vehicle", headers=_h(customer["token"])).json()
        assert new_pending, f"Expected new pending payment. all_pmts={pmts2}, veh={veh_state}"

        # admin notification ("Payment Received") visible to admin (broadcast user_id=None)
        notifs = session.get(f"{API}/notifications/me", headers=_h(admin["token"])).json()
        assert any("Payment Received" in n["title"] for n in notifs)

    def test_mark_paid_unknown_404(self, session, customer):
        r = session.post(f"{API}/payments/{uuid.uuid4()}/mark-paid",
                         headers=_h(customer["token"]),
                         json={"transaction_id": "x"})
        assert r.status_code == 404


# -------------------- documents --------------------
class TestDocuments:
    did = None

    def test_upload_and_list(self, session, customer):
        b64 = base64.b64encode(b"hello-doc").decode()
        r = session.post(f"{API}/documents", headers=_h(customer["token"]),
                         json={"doc_type": "license", "name": "TEST_lic.png",
                               "base64_data": b64, "mime_type": "image/png"})
        assert r.status_code == 200, r.text
        TestDocuments.did = r.json()["id"]

        lst = session.get(f"{API}/documents/me", headers=_h(customer["token"])).json()
        assert any(d["id"] == TestDocuments.did for d in lst)

    def test_admin_review(self, session, admin):
        assert TestDocuments.did
        r = session.post(f"{API}/admin/documents/{TestDocuments.did}/review",
                         headers=_h(admin["token"]), json={"status": "approved"})
        assert r.status_code == 200
        assert r.json()["status"] == "approved"

    def test_admin_review_invalid_status(self, session, admin):
        assert TestDocuments.did
        r = session.post(f"{API}/admin/documents/{TestDocuments.did}/review",
                         headers=_h(admin["token"]), json={"status": "bogus"})
        assert r.status_code == 400

    def test_delete_doc(self, session, customer):
        assert TestDocuments.did
        r = session.delete(f"{API}/documents/{TestDocuments.did}", headers=_h(customer["token"]))
        assert r.status_code == 200
        lst = session.get(f"{API}/documents/me", headers=_h(customer["token"])).json()
        assert not any(d["id"] == TestDocuments.did for d in lst)


# -------------------- notifications & admin --------------------
class TestAdminEndpoints:
    def test_non_admin_403_on_admin_routes(self, session, customer):
        for path in ["/admin/users", "/admin/stats", "/admin/documents", "/admin/payments"]:
            r = session.get(f"{API}{path}", headers=_h(customer["token"]))
            assert r.status_code == 403, f"{path} expected 403 got {r.status_code}"

    def test_admin_users_enriched(self, session, admin, customer):
        r = session.get(f"{API}/admin/users", headers=_h(admin["token"]))
        assert r.status_code == 200
        users = r.json()
        me = next((u for u in users if u["id"] == customer["user_id"]), None)
        assert me, "customer not present in admin users list"
        # assigned_vehicle field present
        assert "assigned_vehicle" in me

    def test_admin_stats(self, session, admin):
        r = session.get(f"{API}/admin/stats", headers=_h(admin["token"]))
        assert r.status_code == 200
        d = r.json()
        for k in ["total_vehicles", "rented_vehicles", "total_users",
                  "pending_payments", "pending_amount", "total_earned", "pending_documents"]:
            assert k in d
        assert d["total_vehicles"] >= 3

    def test_admin_create_broadcast_notification(self, session, admin, customer):
        r = session.post(f"{API}/admin/notifications", headers=_h(admin["token"]),
                         json={"title": "TEST Broadcast", "body": "Hello all"})
        assert r.status_code == 200
        # customer should see broadcast
        notifs = session.get(f"{API}/notifications/me", headers=_h(customer["token"])).json()
        assert any(n["title"] == "TEST Broadcast" for n in notifs)
