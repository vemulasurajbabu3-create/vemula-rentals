"""RideLease backend - rental bike management API."""
from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
import jwt
from datetime import datetime, timedelta, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get("JWT_SECRET", "ridelease-dev-secret-change-me")
JWT_ALG = "HS256"
ADMIN_PHONE = "9999999999"  # special admin phone
BUSINESS_PHONE = "9160442323"  # owner contact - calls & messages
BUSINESS_NAME = "Vemula Rentals"

app = FastAPI(title="RideLease API")
api_router = APIRouter(prefix="/api")


# -------------------- MODELS --------------------
def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PhoneIn(BaseModel):
    phone: str


class OtpVerifyIn(BaseModel):
    phone: str
    otp: str


class TokenOut(BaseModel):
    token: str
    user_id: str
    is_admin: bool
    is_new_user: bool
    status: str = "approved"


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    address: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None


class UserProfile(BaseModel):
    id: str
    phone: str
    full_name: Optional[str] = None
    address: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    is_admin: bool = False
    status: str = "approved"  # pending | approved | rejected
    created_at: str


class LocationIn(BaseModel):
    latitude: float
    longitude: float


class Vehicle(BaseModel):
    id: str
    vehicle_type: str
    model: str
    number_plate: str
    weekly_rent: float
    security_deposit: float = 2000.0
    status: str = "available"  # available | rented | maintenance | blocked
    assigned_to: Optional[str] = None  # user_id
    rental_start_date: Optional[str] = None
    instructions: List[str] = []
    image_url: Optional[str] = None
    walk_around_video: Optional[str] = None
    created_at: str


class VehicleCreate(BaseModel):
    vehicle_type: str
    model: str
    number_plate: str
    weekly_rent: float
    security_deposit: float = 2000.0
    instructions: List[str] = []
    image_url: Optional[str] = None
    walk_around_video: Optional[str] = None


class VehicleUpdate(BaseModel):
    vehicle_type: Optional[str] = None
    model: Optional[str] = None
    number_plate: Optional[str] = None
    weekly_rent: Optional[float] = None
    security_deposit: Optional[float] = None
    status: Optional[str] = None
    instructions: Optional[List[str]] = None
    image_url: Optional[str] = None
    walk_around_video: Optional[str] = None


class AssignIn(BaseModel):
    user_id: str
    vehicle_id: str
    rental_start_date: Optional[str] = None


class Payment(BaseModel):
    id: str
    user_id: str
    vehicle_id: Optional[str]
    amount: float
    late_fee: float = 0.0
    due_date: str
    status: str  # pending | paid | failed
    transaction_id: Optional[str] = None
    paid_at: Optional[str] = None
    payment_method: Optional[str] = None  # upi | cash | other
    created_at: str


class PaymentMarkPaid(BaseModel):
    transaction_id: str
    payment_method: Optional[str] = "upi"


class AdminMarkCashIn(BaseModel):
    note: Optional[str] = None


class PaymentAdminUpdate(BaseModel):
    amount: Optional[float] = None
    late_fee: Optional[float] = None
    due_date: Optional[str] = None
    status: Optional[str] = None  # pending | paid | failed
    transaction_id: Optional[str] = None


class Document(BaseModel):
    id: str
    user_id: str
    doc_type: str  # license | id_proof | agreement | other
    name: str
    base64_data: str
    mime_type: Optional[str] = None
    status: str = "pending"  # pending | approved | rejected
    created_at: str


class DocumentCreate(BaseModel):
    doc_type: str
    name: str
    base64_data: str
    mime_type: Optional[str] = None


class DocumentReview(BaseModel):
    status: str  # approved | rejected


class Notification(BaseModel):
    id: str
    user_id: Optional[str]  # None = broadcast
    title: str
    body: str
    read: bool = False
    created_at: str


class NotificationCreate(BaseModel):
    user_id: Optional[str] = None
    title: str
    body: str


class SettingsModel(BaseModel):
    reminder_weekday: int = 0
    reminder_hour_ist: int = 9
    late_fee_per_day: float = 50.0
    grace_days: int = 0
    block_after_days: int = 7  # auto-suspend vehicle after N days overdue
    min_deposit: float = 2000.0  # recommended wallet balance even before assignment
    merchant_upi: str = "vemula.balajee@ybl"
    merchant_name: str = "Vemula Rentals"
    business_phone: str = "+919160442323"
    pickup_address: str = "Vemula Rentals Pickup Point"
    pickup_lat: float = 17.527688
    pickup_lng: float = 78.394619


class SettingsUpdate(BaseModel):
    reminder_weekday: Optional[int] = None
    reminder_hour_ist: Optional[int] = None
    late_fee_per_day: Optional[float] = None
    grace_days: Optional[int] = None
    block_after_days: Optional[int] = None
    min_deposit: Optional[float] = None
    merchant_upi: Optional[str] = None
    merchant_name: Optional[str] = None
    business_phone: Optional[str] = None
    pickup_address: Optional[str] = None
    pickup_lat: Optional[float] = None
    pickup_lng: Optional[float] = None


class Deposit(BaseModel):
    id: str
    user_id: str
    vehicle_id: Optional[str] = None
    amount: float
    status: str  # pending | paid | forfeited | refunded
    transaction_id: Optional[str] = None
    paid_at: Optional[str] = None
    forfeit_reason: Optional[str] = None
    forfeit_at: Optional[str] = None
    created_at: str


class DepositCreate(BaseModel):
    amount: float
    vehicle_id: Optional[str] = None


class DepositMarkPaid(BaseModel):
    transaction_id: str


class ForfeitIn(BaseModel):
    amount: float
    reason: str


class Booking(BaseModel):
    id: str
    user_id: str
    vehicle_id: str
    vehicle_snapshot: dict = {}  # model, number_plate, vehicle_type, weekly_rent, security_deposit
    start_date: str
    end_date: Optional[str] = None
    status: str  # active | return_requested | returned | cancelled
    return_requested_at: Optional[str] = None
    customer_notes: Optional[str] = None
    returned_at: Optional[str] = None
    admin_notes: Optional[str] = None
    refund_amount: Optional[float] = None
    total_rent_paid: Optional[float] = None
    deposit_paid: Optional[float] = None
    deposit_refunded: Optional[float] = None
    created_at: str


class ReturnRequestIn(BaseModel):
    notes: Optional[str] = None


class ConfirmReturnIn(BaseModel):
    refund_amount: float = 0.0
    damages_amount: float = 0.0
    notes: Optional[str] = None


# -------------------- AUTH HELPERS --------------------
def create_token(user_id: str, phone: str, is_admin: bool) -> str:
    payload = {
        "user_id": user_id,
        "phone": phone,
        "is_admin": is_admin,
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # Backfill legacy users without status field
    if "status" not in user:
        user["status"] = "approved"
    return user


async def approved_user(user: dict = Depends(current_user)) -> dict:
    """Gate non-admin endpoints — pending/rejected customers cannot access app data."""
    if user.get("is_admin"):
        return user
    s = user.get("status", "approved")
    if s == "pending":
        raise HTTPException(status_code=403, detail={"code": "pending_approval", "message": "Your account is awaiting approval from the business."})
    if s == "rejected":
        raise HTTPException(status_code=403, detail={"code": "rejected", "message": "Your account has been rejected. Please contact the business."})
    return user


async def admin_required(user: dict = Depends(current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def strip_id(doc: Optional[dict]) -> Optional[dict]:
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc


# -------------------- AUTH ROUTES --------------------
@api_router.post("/auth/request-otp")
async def request_otp(body: PhoneIn):
    if not body.phone or len(body.phone) < 6:
        raise HTTPException(status_code=400, detail="Invalid phone")
    # In dev mode, OTP is always 123456 (but any 6-digit code accepted on verify)
    await db.otps.update_one(
        {"phone": body.phone},
        {"$set": {"phone": body.phone, "otp": "123456", "created_at": now_utc_iso()}},
        upsert=True,
    )
    return {"message": "OTP sent (dev mode: use any 6-digit code, e.g. 123456)", "dev_otp": "123456"}


@api_router.post("/auth/verify-otp", response_model=TokenOut)
async def verify_otp(body: OtpVerifyIn):
    if not (body.otp.isdigit() and len(body.otp) == 6):
        raise HTTPException(status_code=400, detail="OTP must be 6 digits")
    user = await db.users.find_one({"phone": body.phone}, {"_id": 0})
    is_new = False
    if not user:
        is_admin = body.phone == ADMIN_PHONE
        user = {
            "id": str(uuid.uuid4()),
            "phone": body.phone,
            "full_name": None,
            "address": None,
            "is_admin": is_admin,
            "status": "approved" if is_admin else "pending",
            "last_location": None,
            "created_at": now_utc_iso(),
        }
        await db.users.insert_one(dict(user))
        if not is_admin:
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()), "user_id": None,
                "title": "New Customer Signup",
                "body": f"+91 {body.phone} has signed up and is waiting for approval.",
                "read": False, "created_at": now_utc_iso(),
            })
        is_new = True
    # Backfill status field for legacy users
    if "status" not in user:
        legacy_status = "approved"  # existing users grandfathered
        await db.users.update_one({"id": user["id"]}, {"$set": {"status": legacy_status}})
        user["status"] = legacy_status
    token = create_token(user["id"], user["phone"], user.get("is_admin", False))
    return TokenOut(
        token=token, user_id=user["id"], is_admin=user.get("is_admin", False),
        is_new_user=is_new, status=user.get("status", "approved"),
    )


@api_router.get("/business-info")
async def business_info():
    return {"name": BUSINESS_NAME, "phone": BUSINESS_PHONE}


# -------------------- USER ROUTES --------------------
@api_router.get("/users/me", response_model=UserProfile)
async def get_me(user: dict = Depends(current_user)):
    return UserProfile(**{
        "id": user["id"], "phone": user["phone"], "full_name": user.get("full_name"),
        "address": user.get("address"),
        "emergency_contact_name": user.get("emergency_contact_name"),
        "emergency_contact_phone": user.get("emergency_contact_phone"),
        "is_admin": user.get("is_admin", False),
        "status": user.get("status", "approved"),
        "created_at": user["created_at"],
    })


@api_router.put("/users/me", response_model=UserProfile)
async def update_me(body: UserUpdate, user: dict = Depends(current_user)):
    upd = {k: v for k, v in body.dict().items() if v is not None}
    if upd:
        await db.users.update_one({"id": user["id"]}, {"$set": upd})
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return UserProfile(**{
        "id": u["id"], "phone": u["phone"], "full_name": u.get("full_name"),
        "address": u.get("address"),
        "emergency_contact_name": u.get("emergency_contact_name"),
        "emergency_contact_phone": u.get("emergency_contact_phone"),
        "is_admin": u.get("is_admin", False),
        "status": u.get("status", "approved"),
        "created_at": u["created_at"],
    })


@api_router.post("/users/me/location")
async def update_location(body: LocationIn, user: dict = Depends(approved_user)):
    loc = {"latitude": body.latitude, "longitude": body.longitude, "updated_at": now_utc_iso()}
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_location": loc}})
    await db.location_history.insert_one({
        "user_id": user["id"], **loc,
    })
    return {"ok": True}


@api_router.get("/users/me/vehicle")
async def get_my_vehicle(user: dict = Depends(approved_user)):
    v = await db.vehicles.find_one({"assigned_to": user["id"]}, {"_id": 0})
    return v


# -------------------- VEHICLE ROUTES --------------------
@api_router.get("/vehicles", response_model=List[Vehicle])
async def list_vehicles(_: dict = Depends(admin_required)):
    items = await db.vehicles.find({}, {"_id": 0}).to_list(500)
    return [Vehicle(**i) for i in items]


@api_router.post("/vehicles", response_model=Vehicle)
async def create_vehicle(body: VehicleCreate, _: dict = Depends(admin_required)):
    v = Vehicle(
        id=str(uuid.uuid4()),
        status="available",
        created_at=now_utc_iso(),
        **body.dict(),
    )
    await db.vehicles.insert_one(v.dict())
    return v


@api_router.put("/vehicles/{vid}", response_model=Vehicle)
async def update_vehicle(vid: str, body: VehicleUpdate, _: dict = Depends(admin_required)):
    upd = {k: v for k, v in body.dict().items() if v is not None}
    if upd:
        await db.vehicles.update_one({"id": vid}, {"$set": upd})
    v = await db.vehicles.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return Vehicle(**v)


@api_router.delete("/vehicles/{vid}")
async def delete_vehicle(vid: str, _: dict = Depends(admin_required)):
    await db.vehicles.delete_one({"id": vid})
    return {"ok": True}


@api_router.post("/vehicles/assign")
async def assign_vehicle(body: AssignIn, _: dict = Depends(admin_required)):
    veh = await db.vehicles.find_one({"id": body.vehicle_id}, {"_id": 0})
    if not veh:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if veh.get("assigned_to") and veh["assigned_to"] != body.user_id:
        raise HTTPException(status_code=409, detail="Vehicle already assigned to another user")
    # Security deposit gate
    required_deposit = float(veh.get("security_deposit", 0))
    if required_deposit > 0:
        balance = await get_user_deposit_balance(body.user_id)
        if balance < required_deposit:
            shortfall = round(required_deposit - balance, 2)
            raise HTTPException(
                status_code=412,
                detail={
                    "message": f"Security deposit not paid. Required ₹{required_deposit:.0f}, paid ₹{balance:.0f}. Shortfall ₹{shortfall:.0f}.",
                    "required_deposit": required_deposit,
                    "current_balance": balance,
                    "shortfall": shortfall,
                },
            )
    # Unassign any vehicle currently assigned to user (other than the target)
    await db.vehicles.update_many(
        {"assigned_to": body.user_id, "id": {"$ne": body.vehicle_id}},
        {"$set": {"assigned_to": None, "status": "available", "rental_start_date": None}},
    )
    start = body.rental_start_date or now_utc_iso()
    await db.vehicles.update_one(
        {"id": body.vehicle_id},
        {"$set": {"assigned_to": body.user_id, "status": "rented", "rental_start_date": start}},
    )
    # Create a Booking record for this rental period
    booking = {
        "id": str(uuid.uuid4()),
        "user_id": body.user_id,
        "vehicle_id": body.vehicle_id,
        "vehicle_snapshot": {
            "model": veh.get("model"),
            "number_plate": veh.get("number_plate"),
            "vehicle_type": veh.get("vehicle_type"),
            "weekly_rent": float(veh.get("weekly_rent", 0)),
            "security_deposit": float(veh.get("security_deposit", 0)),
        },
        "start_date": start,
        "end_date": None,
        "status": "active",
        "return_requested_at": None,
        "customer_notes": None,
        "returned_at": None,
        "admin_notes": None,
        "refund_amount": None,
        "total_rent_paid": None,
        "deposit_paid": None,
        "deposit_refunded": None,
        "created_at": now_utc_iso(),
    }
    await db.bookings.insert_one(dict(booking))
    # Tag deposits for cleaner forfeit tracking
    await db.deposits.update_many(
        {"user_id": body.user_id, "status": "paid", "vehicle_id": None},
        {"$set": {"vehicle_id": body.vehicle_id}},
    )
    existing = await db.payments.find_one({"user_id": body.user_id, "status": "pending"}, {"_id": 0})
    if not existing:
        # Anchor due date to vehicle assignment date + 7 days (per-user weekly cadence)
        try:
            start_dt = datetime.fromisoformat(start)
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
        except Exception:
            start_dt = datetime.now(timezone.utc)
        due = (start_dt + timedelta(days=7)).isoformat()
        await db.payments.insert_one({
            "id": str(uuid.uuid4()), "user_id": body.user_id, "vehicle_id": body.vehicle_id,
            "amount": veh["weekly_rent"], "late_fee": 0.0, "due_date": due, "status": "pending",
            "transaction_id": None, "paid_at": None, "created_at": now_utc_iso(),
        })
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": body.user_id,
        "title": "Vehicle Assigned",
        "body": f"You have been assigned {veh['model']} ({veh['number_plate']}). Happy riding!",
        "read": False, "created_at": now_utc_iso(),
    })
    return {"ok": True}


# -------------------- PAYMENT ROUTES --------------------
@api_router.get("/payments/me", response_model=List[Payment])
async def list_my_payments(user: dict = Depends(approved_user)):
    # Recompute late fees on read so amounts are always current
    await _compute_late_fees_once()
    items = await db.payments.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Payment(**i) for i in items]


@api_router.post("/payments/{pid}/mark-paid", response_model=Payment)
async def mark_payment_paid(pid: str, body: PaymentMarkPaid, user: dict = Depends(approved_user)):
    # Ensure late fee is current before marking paid
    await _compute_late_fees_once()
    p = await db.payments.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if p["status"] == "paid":
        return Payment(**p)
    paid_total = float(p["amount"]) + float(p.get("late_fee", 0.0))
    await db.payments.update_one(
        {"id": pid},
        {"$set": {
            "status": "paid",
            "transaction_id": body.transaction_id,
            "paid_at": now_utc_iso(),
            "payment_method": (body.payment_method or "upi"),
        }},
    )
    # Create next pending payment anchored to PREVIOUS due_date + 7 days
    veh = await db.vehicles.find_one({"assigned_to": user["id"]}, {"_id": 0})
    if veh:
        try:
            prev_due_dt = datetime.fromisoformat(p["due_date"])
            if prev_due_dt.tzinfo is None:
                prev_due_dt = prev_due_dt.replace(tzinfo=timezone.utc)
        except Exception:
            prev_due_dt = datetime.now(timezone.utc)
        due = (prev_due_dt + timedelta(days=7)).isoformat()
        await db.payments.insert_one({
            "id": str(uuid.uuid4()), "user_id": user["id"], "vehicle_id": veh["id"],
            "amount": veh["weekly_rent"], "late_fee": 0.0, "due_date": due, "status": "pending",
            "transaction_id": None, "paid_at": None, "created_at": now_utc_iso(),
        })
        # Unblock the vehicle if it was suspended due to this payment
        if veh.get("status") == "blocked":
            still_overdue = await db.payments.find_one({"user_id": user["id"], "status": "pending"}, {"_id": 0})
            # Only unblock if no other pending payment is overdue today
            unblock = True
            if still_overdue:
                try:
                    due_dt = datetime.fromisoformat(still_overdue["due_date"])
                    if due_dt.tzinfo is None:
                        due_dt = due_dt.replace(tzinfo=timezone.utc)
                    if due_dt.date() < datetime.now(timezone.utc).date():
                        unblock = False
                except Exception:
                    pass
            if unblock:
                await db.vehicles.update_one({"id": veh["id"]}, {"$set": {"status": "rented"}})
                await db.notifications.insert_one({
                    "id": str(uuid.uuid4()), "user_id": user["id"],
                    "title": "Vehicle Reactivated",
                    "body": "Your vehicle is active again. Ride safe!",
                    "read": False, "created_at": now_utc_iso(),
                })
    # Notify admin
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": None,
        "title": "Payment Received",
        "body": f"₹{paid_total:.0f} received from {user.get('full_name') or user['phone']} (txn {body.transaction_id})",
        "read": False, "created_at": now_utc_iso(),
    })
    p2 = await db.payments.find_one({"id": pid}, {"_id": 0})
    return Payment(**p2)


@api_router.get("/admin/payments", response_model=List[Payment])
async def admin_list_payments(q: Optional[str] = None, status: Optional[str] = None, _: dict = Depends(admin_required)):
    await _compute_late_fees_once()
    query: dict = {}
    if status:
        query["status"] = status
    if q:
        rx = {"$regex": q, "$options": "i"}
        # match by transaction id directly, or by users whose name/phone match
        matched_users = await db.users.find({"$or": [{"full_name": rx}, {"phone": rx}]}, {"_id": 0, "id": 1}).to_list(500)
        uids = [u["id"] for u in matched_users]
        query["$or"] = [{"transaction_id": rx}]
        if uids:
            query["$or"].append({"user_id": {"$in": uids}})
    items = await db.payments.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Payment(**i) for i in items]


@api_router.put("/admin/payments/{pid}", response_model=Payment)
async def admin_edit_payment(pid: str, body: PaymentAdminUpdate, _: dict = Depends(admin_required)):
    upd = {k: v for k, v in body.dict().items() if v is not None}
    if "status" in upd and upd["status"] not in ("pending", "paid", "failed"):
        raise HTTPException(status_code=400, detail="status must be pending|paid|failed")
    if "amount" in upd and upd["amount"] < 0:
        raise HTTPException(status_code=400, detail="amount must be >= 0")
    if "late_fee" in upd and upd["late_fee"] < 0:
        raise HTTPException(status_code=400, detail="late_fee must be >= 0")
    if upd.get("status") == "paid":
        upd["paid_at"] = now_utc_iso()
    if upd:
        await db.payments.update_one({"id": pid}, {"$set": upd})
    p = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    return Payment(**p)


@api_router.delete("/admin/payments/{pid}")
async def admin_delete_payment(pid: str, _: dict = Depends(admin_required)):
    await db.payments.delete_one({"id": pid})
    return {"ok": True}


@api_router.post("/admin/payments/{pid}/mark-paid-cash", response_model=Payment)
async def admin_mark_cash_paid(pid: str, body: AdminMarkCashIn, admin: dict = Depends(admin_required)):
    """Admin marks a pending payment as paid in cash (records who took it & when).

    Also creates the NEXT pending payment anchored to this payment's due_date + 7 days,
    keeping the per-user weekly cadence aligned with their vehicle assignment day/time.
    """
    await _compute_late_fees_once()
    p = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if p["status"] == "paid":
        return Payment(**p)
    now_iso = now_utc_iso()
    txn = f"CASH-{int(datetime.now(timezone.utc).timestamp())}"
    await db.payments.update_one(
        {"id": pid},
        {"$set": {
            "status": "paid",
            "payment_method": "cash",
            "transaction_id": txn,
            "paid_at": now_iso,
            "cash_received_by": admin.get("id"),
            "cash_note": (body.note or "").strip() or None,
        }},
    )
    # Create next pending payment anchored to previous due_date + 7 days
    veh = await db.vehicles.find_one({"id": p.get("vehicle_id")}, {"_id": 0})
    if veh and veh.get("assigned_to") == p["user_id"]:
        try:
            prev_due_dt = datetime.fromisoformat(p["due_date"])
            if prev_due_dt.tzinfo is None:
                prev_due_dt = prev_due_dt.replace(tzinfo=timezone.utc)
        except Exception:
            prev_due_dt = datetime.now(timezone.utc)
        # Don't duplicate if a later pending already exists
        existing_later = await db.payments.find_one(
            {"user_id": p["user_id"], "vehicle_id": veh["id"], "status": "pending"},
            {"_id": 0},
        )
        if not existing_later:
            await db.payments.insert_one({
                "id": str(uuid.uuid4()), "user_id": p["user_id"], "vehicle_id": veh["id"],
                "amount": veh["weekly_rent"], "late_fee": 0.0,
                "due_date": (prev_due_dt + timedelta(days=7)).isoformat(),
                "status": "pending", "transaction_id": None, "paid_at": None,
                "created_at": now_iso,
            })
        # Unblock the vehicle if it was suspended
        if veh.get("status") == "blocked":
            await db.vehicles.update_one({"id": veh["id"]}, {"$set": {"status": "rented"}})
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": p["user_id"],
        "title": "Payment Received (Cash)",
        "body": f"Weekly rent of ₹{(p['amount'] + p.get('late_fee', 0)):.0f} confirmed in cash. Thank you!",
        "read": False, "created_at": now_iso,
    })
    updated = await db.payments.find_one({"id": pid}, {"_id": 0})
    return Payment(**updated)


# -------------------- DOCUMENT ROUTES --------------------
@api_router.post("/documents", response_model=Document)
async def upload_document(body: DocumentCreate, user: dict = Depends(approved_user)):
    doc = Document(
        id=str(uuid.uuid4()), user_id=user["id"], doc_type=body.doc_type,
        name=body.name, base64_data=body.base64_data, mime_type=body.mime_type,
        status="pending", created_at=now_utc_iso(),
    )
    await db.documents.insert_one(doc.dict())
    return doc


@api_router.get("/documents/me", response_model=List[Document])
async def list_my_docs(user: dict = Depends(approved_user)):
    items = await db.documents.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [Document(**i) for i in items]


@api_router.delete("/documents/{did}")
async def delete_my_doc(did: str, user: dict = Depends(approved_user)):
    await db.documents.delete_one({"id": did, "user_id": user["id"]})
    return {"ok": True}


@api_router.get("/admin/documents", response_model=List[Document])
async def admin_list_docs(_: dict = Depends(admin_required)):
    items = await db.documents.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Document(**i) for i in items]


@api_router.post("/admin/documents/{did}/review", response_model=Document)
async def admin_review_doc(did: str, body: DocumentReview, _: dict = Depends(admin_required)):
    if body.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await db.documents.update_one({"id": did}, {"$set": {"status": body.status}})
    d = await db.documents.find_one({"id": did}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404)
    return Document(**d)


# -------------------- NOTIFICATIONS --------------------
@api_router.get("/notifications/me", response_model=List[Notification])
async def list_my_notifications(user: dict = Depends(approved_user)):
    items = await db.notifications.find(
        {"$or": [{"user_id": user["id"]}, {"user_id": None}]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return [Notification(**i) for i in items]


@api_router.post("/notifications/me/read-all")
async def mark_all_read(user: dict = Depends(approved_user)):
    await db.notifications.update_many(
        {"$or": [{"user_id": user["id"]}, {"user_id": None}]}, {"$set": {"read": True}}
    )
    return {"ok": True}


@api_router.post("/admin/notifications", response_model=Notification)
async def admin_create_notification(body: NotificationCreate, _: dict = Depends(admin_required)):
    n = Notification(
        id=str(uuid.uuid4()), user_id=body.user_id, title=body.title, body=body.body,
        read=False, created_at=now_utc_iso(),
    )
    await db.notifications.insert_one(n.dict())
    return n


# -------------------- ADMIN: USERS & STATS --------------------
@api_router.get("/admin/users")
async def admin_list_users(q: Optional[str] = None, status: Optional[str] = None, _: dict = Depends(admin_required)):
    query: dict = {}
    if status:
        query["status"] = status
    if q:
        rx = {"$regex": q, "$options": "i"}
        query["$or"] = [{"full_name": rx}, {"phone": rx}, {"address": rx}]
    items = await db.users.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    out = []
    for u in items:
        v = await db.vehicles.find_one({"assigned_to": u["id"]}, {"_id": 0})
        u["assigned_vehicle"] = v
        u["deposit_balance"] = await get_user_deposit_balance(u["id"])
        if "status" not in u:
            u["status"] = "approved"
        out.append(u)
    return out


@api_router.post("/admin/users/{uid}/approve")
async def admin_approve_user(uid: str, _: dict = Depends(admin_required)):
    res = await db.users.update_one({"id": uid}, {"$set": {"status": "approved"}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": uid,
        "title": "Account Approved",
        "body": "Your account has been approved. Welcome to Vemula Rentals!",
        "read": False, "created_at": now_utc_iso(),
    })
    return {"ok": True}


@api_router.post("/admin/users/{uid}/reject")
async def admin_reject_user(uid: str, _: dict = Depends(admin_required)):
    res = await db.users.update_one({"id": uid}, {"$set": {"status": "rejected"}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@api_router.get("/admin/stats")
async def admin_stats(_: dict = Depends(admin_required)):
    total_vehicles = await db.vehicles.count_documents({})
    rented = await db.vehicles.count_documents({"status": "rented"})
    total_users = await db.users.count_documents({"is_admin": {"$ne": True}})
    pending_pmt = await db.payments.count_documents({"status": "pending"})
    pending_amt_agg = await db.payments.aggregate([
        {"$match": {"status": "pending"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    paid_amt_agg = await db.payments.aggregate([
        {"$match": {"status": "paid"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    pending_docs = await db.documents.count_documents({"status": "pending"})
    return {
        "total_vehicles": total_vehicles,
        "rented_vehicles": rented,
        "total_users": total_users,
        "pending_payments": pending_pmt,
        "pending_amount": (pending_amt_agg[0]["total"] if pending_amt_agg else 0),
        "total_earned": (paid_amt_agg[0]["total"] if paid_amt_agg else 0),
        "pending_documents": pending_docs,
    }


@api_router.post("/admin/reminders/run")
async def admin_run_reminders(_: dict = Depends(admin_required)):
    """Manually trigger late fee recompute + reminders for all pending payments."""
    await _compute_late_fees_once()
    count = await _create_reminders_for_pending()
    return {"ok": True, "reminders_sent": count}


# -------------------- DEPOSITS --------------------
@api_router.get("/deposits/me")
async def my_deposits(user: dict = Depends(approved_user)):
    items = await db.deposits.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    balance = await get_user_deposit_balance(user["id"])
    return {"balance": balance, "history": [Deposit(**d) for d in items]}


@api_router.post("/deposits", response_model=Deposit)
async def create_deposit(body: DepositCreate, user: dict = Depends(approved_user)):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    d = Deposit(
        id=str(uuid.uuid4()), user_id=user["id"], vehicle_id=body.vehicle_id,
        amount=body.amount, status="pending", created_at=now_utc_iso(),
    )
    await db.deposits.insert_one(d.dict())
    return d


@api_router.post("/deposits/{did}/mark-paid", response_model=Deposit)
async def mark_deposit_paid(did: str, body: DepositMarkPaid, user: dict = Depends(approved_user)):
    d = await db.deposits.find_one({"id": did, "user_id": user["id"]}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Deposit not found")
    if d["status"] == "paid":
        return Deposit(**d)
    if d["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"Deposit already {d['status']}")
    await db.deposits.update_one(
        {"id": did},
        {"$set": {"status": "paid", "transaction_id": body.transaction_id, "paid_at": now_utc_iso()}},
    )
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": None,
        "title": "Security Deposit Received",
        "body": f"₹{d['amount']:.0f} deposit from {user.get('full_name') or user['phone']} (txn {body.transaction_id})",
        "read": False, "created_at": now_utc_iso(),
    })
    new_doc = await db.deposits.find_one({"id": did}, {"_id": 0})
    return Deposit(**new_doc)


@api_router.get("/admin/deposits")
async def admin_list_deposits(_: dict = Depends(admin_required)):
    items = await db.deposits.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Deposit(**i) for i in items]


@api_router.post("/admin/users/{user_id}/forfeit-deposit")
async def admin_forfeit_deposit(user_id: str, body: ForfeitIn, _: dict = Depends(admin_required)):
    """Forfeit up to `amount` from the user's paid deposit balance.
    Applies to oldest paid deposits first (FIFO). Records reason on each forfeited deposit."""
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    paid = await db.deposits.find({"user_id": user_id, "status": "paid"}, {"_id": 0}).sort("created_at", 1).to_list(200)
    balance = round(sum(float(d["amount"]) for d in paid), 2)
    if balance < body.amount:
        raise HTTPException(status_code=412, detail=f"Insufficient deposit balance. Available ₹{balance:.0f}, requested ₹{body.amount:.0f}")
    remaining = body.amount
    forfeited_ids: List[str] = []
    for d in paid:
        if remaining <= 0:
            break
        amt = float(d["amount"])
        if amt <= remaining + 0.001:
            # Forfeit whole record
            await db.deposits.update_one(
                {"id": d["id"]},
                {"$set": {"status": "forfeited", "forfeit_reason": body.reason, "forfeit_at": now_utc_iso()}},
            )
            forfeited_ids.append(d["id"])
            remaining = round(remaining - amt, 2)
        else:
            # Split: shrink this record to (amt - remaining) and create a forfeited split for `remaining`
            await db.deposits.update_one({"id": d["id"]}, {"$set": {"amount": round(amt - remaining, 2)}})
            split = Deposit(
                id=str(uuid.uuid4()), user_id=user_id, vehicle_id=d.get("vehicle_id"),
                amount=remaining, status="forfeited",
                transaction_id=d.get("transaction_id"), paid_at=d.get("paid_at"),
                forfeit_reason=body.reason, forfeit_at=now_utc_iso(),
                created_at=d["created_at"],
            )
            await db.deposits.insert_one(split.dict())
            forfeited_ids.append(split.id)
            remaining = 0
    # Apply forfeited amount toward pending overdue payments (oldest first)
    applied = body.amount
    cursor = db.payments.find({"user_id": user_id, "status": "pending"}, {"_id": 0}).sort("due_date", 1)
    async for p in cursor:
        if applied <= 0:
            break
        total_due = float(p["amount"]) + float(p.get("late_fee", 0.0))
        if total_due <= applied + 0.001:
            await db.payments.update_one(
                {"id": p["id"]},
                {"$set": {"status": "paid", "transaction_id": f"FORFEIT-{body.reason[:20]}", "paid_at": now_utc_iso()}},
            )
            applied = round(applied - total_due, 2)
        else:
            new_amount = round(total_due - applied, 2)
            # Apply against amount first, then late_fee
            new_late = min(float(p.get("late_fee", 0.0)), new_amount)
            new_rent = round(new_amount - new_late, 2)
            await db.payments.update_one({"id": p["id"]}, {"$set": {"amount": new_rent, "late_fee": new_late}})
            applied = 0
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id,
        "title": "Security Deposit Forfeited",
        "body": f"₹{body.amount:.0f} of your security deposit has been forfeited. Reason: {body.reason}",
        "read": False, "created_at": now_utc_iso(),
    })
    return {"ok": True, "forfeited_ids": forfeited_ids}


@api_router.get("/admin/settings")
async def admin_get_settings(_: dict = Depends(admin_required)):
    s = await get_settings_doc()
    return {
        "reminder_weekday": s.get("reminder_weekday", 0),
        "reminder_hour_ist": s.get("reminder_hour_ist", 9),
        "late_fee_per_day": s.get("late_fee_per_day", 50.0),
        "grace_days": s.get("grace_days", 0),
        "block_after_days": s.get("block_after_days", 7),
        "min_deposit": s.get("min_deposit", 2000.0),
        "merchant_upi": s.get("merchant_upi", "vemula.balajee@ybl"),
        "merchant_name": s.get("merchant_name", "Vemula Rentals"),
        "business_phone": s.get("business_phone", "+919160442323"),
        "pickup_address": s.get("pickup_address", "Vemula Rentals Pickup Point"),
        "pickup_lat": s.get("pickup_lat", 17.527688),
        "pickup_lng": s.get("pickup_lng", 78.394619),
    }


@api_router.get("/settings/public")
async def get_public_settings(_: dict = Depends(approved_user)):
    s = await get_settings_doc()
    return {
        "min_deposit": s.get("min_deposit", 2000.0),
        "late_fee_per_day": s.get("late_fee_per_day", 50.0),
        "grace_days": s.get("grace_days", 0),
        "merchant_upi": s.get("merchant_upi", "vemula.balajee@ybl"),
        "merchant_name": s.get("merchant_name", "Vemula Rentals"),
        "business_phone": s.get("business_phone", "+919160442323"),
        "pickup_address": s.get("pickup_address", "Vemula Rentals Pickup Point"),
        "pickup_lat": s.get("pickup_lat", 17.527688),
        "pickup_lng": s.get("pickup_lng", 78.394619),
    }


@api_router.put("/admin/settings")
async def admin_update_settings(body: SettingsUpdate, _: dict = Depends(admin_required)):
    upd = {k: v for k, v in body.dict().items() if v is not None}
    if upd:
        # validate ranges
        if "reminder_weekday" in upd and not 0 <= upd["reminder_weekday"] <= 6:
            raise HTTPException(status_code=400, detail="reminder_weekday must be 0-6")
        if "reminder_hour_ist" in upd and not 0 <= upd["reminder_hour_ist"] <= 23:
            raise HTTPException(status_code=400, detail="reminder_hour_ist must be 0-23")
        if "late_fee_per_day" in upd and upd["late_fee_per_day"] < 0:
            raise HTTPException(status_code=400, detail="late_fee_per_day must be >= 0")
        if "grace_days" in upd and upd["grace_days"] < 0:
            raise HTTPException(status_code=400, detail="grace_days must be >= 0")
        if "block_after_days" in upd and upd["block_after_days"] < 0:
            raise HTTPException(status_code=400, detail="block_after_days must be >= 0")
        if "min_deposit" in upd and upd["min_deposit"] < 0:
            raise HTTPException(status_code=400, detail="min_deposit must be >= 0")
        if "merchant_upi" in upd:
            v = (upd["merchant_upi"] or "").strip()
            if not v or "@" not in v:
                raise HTTPException(status_code=400, detail="merchant_upi must look like name@bank")
            upd["merchant_upi"] = v
        if "merchant_name" in upd:
            v = (upd["merchant_name"] or "").strip()
            if not v:
                raise HTTPException(status_code=400, detail="merchant_name cannot be empty")
            upd["merchant_name"] = v
        if "business_phone" in upd:
            upd["business_phone"] = (upd["business_phone"] or "").strip()
        if "pickup_address" in upd:
            upd["pickup_address"] = (upd["pickup_address"] or "").strip()
        if "pickup_lat" in upd and not -90 <= upd["pickup_lat"] <= 90:
            raise HTTPException(status_code=400, detail="pickup_lat must be between -90 and 90")
        if "pickup_lng" in upd and not -180 <= upd["pickup_lng"] <= 180:
            raise HTTPException(status_code=400, detail="pickup_lng must be between -180 and 180")
        await db.settings.update_one({"id": "global"}, {"$set": upd}, upsert=True)
        # Recompute fees immediately if fee/grace changed
        if "late_fee_per_day" in upd or "grace_days" in upd:
            await _compute_late_fees_once()
    return await admin_get_settings()


# -------------------- SEED --------------------
async def seed_demo_data():
    """Seed a small demo dataset. Disabled by default - set SEED_DEMO=true to enable."""
    if os.environ.get("SEED_DEMO", "false").lower() not in ("1", "true", "yes"):
        return
    count = await db.vehicles.count_documents({})
    if count > 0:
        return
    samples = [
        {
            "id": str(uuid.uuid4()),
            "vehicle_type": "Electric Scooter", "model": "Ola S1 Pro",
            "number_plate": "KA-01-EV-1001", "weekly_rent": 1499.0, "status": "available",
            "assigned_to": None, "rental_start_date": None,
            "instructions": [
                "Unlock the scooter using the key fob.",
                "Press the power button on the right handlebar for 2 seconds.",
                "Wait for the dashboard to light up, then twist the throttle gently.",
                "Always wear a helmet. Speed limit is 60 km/h.",
            ],
            "image_url": "https://images.pexels.com/photos/16498803/pexels-photo-16498803.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
            "created_at": now_utc_iso(),
        },
        {
            "id": str(uuid.uuid4()),
            "vehicle_type": "Electric Bike", "model": "Ather 450X",
            "number_plate": "KA-05-EV-2002", "weekly_rent": 1799.0, "status": "available",
            "assigned_to": None, "rental_start_date": None,
            "instructions": [
                "Insert smart key and tap to unlock.",
                "Tap the screen and press the start button.",
                "Use 'Eco' mode for longer range.",
                "Battery level shown on the dashboard.",
            ],
            "image_url": "https://images.pexels.com/photos/10381519/pexels-photo-10381519.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
            "created_at": now_utc_iso(),
        },
        {
            "id": str(uuid.uuid4()),
            "vehicle_type": "Motorbike", "model": "Royal Enfield Hunter 350",
            "number_plate": "KA-03-HU-3003", "weekly_rent": 1999.0, "status": "available",
            "assigned_to": None, "rental_start_date": None,
            "instructions": [
                "Turn the ignition key clockwise.",
                "Pull the clutch and press the electric start button.",
                "Shift to 1st gear, gently release clutch.",
                "Always wear a helmet and riding gloves.",
            ],
            "image_url": "https://images.pexels.com/photos/2611686/pexels-photo-2611686.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
            "created_at": now_utc_iso(),
        },
    ]
    await db.vehicles.insert_many(samples)


# -------------------- SETTINGS HELPERS --------------------
DEFAULT_SETTINGS = {
    "id": "global",
    "reminder_weekday": 0,
    "reminder_hour_ist": 9,
    "late_fee_per_day": 50.0,
    "grace_days": 0,
    "block_after_days": 7,
}
IST = timezone(timedelta(hours=5, minutes=30))


async def get_settings_doc() -> dict:
    doc = await db.settings.find_one({"id": "global"}, {"_id": 0})
    if not doc:
        await db.settings.insert_one(dict(DEFAULT_SETTINGS))
        return dict(DEFAULT_SETTINGS)
    return doc


async def get_user_deposit_balance(user_id: str) -> float:
    """Sum of paid deposits minus what has been forfeited/refunded."""
    items = await db.deposits.find({"user_id": user_id, "status": "paid"}, {"_id": 0}).to_list(500)
    return round(sum(float(d["amount"]) for d in items), 2)


# -------------------- LATE FEE ENGINE --------------------
async def _compute_late_fees_once():
    """For each pending payment past due_date:
    - set late_fee = max(0, days_overdue - grace) * late_fee_per_day
    - auto-block vehicle when days_overdue > block_after_days"""
    settings = await get_settings_doc()
    fee_per_day = float(settings.get("late_fee_per_day", 50.0))
    grace = int(settings.get("grace_days", 0))
    block_after = int(settings.get("block_after_days", 7))
    now = datetime.now(timezone.utc)
    cursor = db.payments.find({"status": "pending"}, {"_id": 0})
    async for p in cursor:
        try:
            due = datetime.fromisoformat(p["due_date"])
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        days_overdue = max(0, (now.date() - due.date()).days)
        billable_days = max(0, days_overdue - grace)
        new_fee = round(billable_days * fee_per_day, 2)
        if abs(float(p.get("late_fee", 0.0)) - new_fee) > 0.001:
            await db.payments.update_one({"id": p["id"]}, {"$set": {"late_fee": new_fee}})
        # Auto-block vehicle
        vid = p.get("vehicle_id")
        if vid and days_overdue > block_after:
            await db.vehicles.update_one(
                {"id": vid, "status": "rented"},
                {"$set": {"status": "blocked"}},
            )
            # Notify user (once via reminder mechanism — separate one-shot block notice)
            already = await db.notifications.find_one({"user_id": p["user_id"], "title": "Vehicle Suspended", "body": {"$regex": p["id"][:8]}}, {"_id": 0})
            if not already:
                await db.notifications.insert_one({
                    "id": str(uuid.uuid4()), "user_id": p["user_id"],
                    "title": "Vehicle Suspended",
                    "body": f"Your vehicle has been suspended due to overdue payment (#{p['id'][:8]}). Please clear dues to resume.",
                    "read": False, "created_at": now_utc_iso(),
                })


# -------------------- BOOKING ROUTES --------------------
async def _booking_to_dict(b: dict) -> dict:
    b = dict(b)
    b.pop("_id", None)
    return b


async def _get_active_booking_for_user(user_id: str) -> Optional[dict]:
    """Return the user's currently active or return-requested booking, if any."""
    b = await db.bookings.find_one(
        {"user_id": user_id, "status": {"$in": ["active", "return_requested"]}},
        {"_id": 0},
    )
    return b


@api_router.get("/bookings/me")
async def my_bookings(user: dict = Depends(approved_user)):
    items = await db.bookings.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@api_router.post("/bookings/me/request-return")
async def request_return(body: ReturnRequestIn, user: dict = Depends(approved_user)):
    active = await db.bookings.find_one({"user_id": user["id"], "status": "active"}, {"_id": 0})
    if not active:
        raise HTTPException(status_code=404, detail="No active rental to return")
    await db.bookings.update_one(
        {"id": active["id"]},
        {"$set": {
            "status": "return_requested",
            "return_requested_at": now_utc_iso(),
            "customer_notes": (body.notes or "").strip() or None,
        }},
    )
    veh = await db.vehicles.find_one({"id": active["vehicle_id"]}, {"_id": 0})
    veh_text = f"{veh['model']} ({veh['number_plate']})" if veh else "vehicle"
    rider = user.get("full_name") or user.get("phone") or "Rider"
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": None,
        "title": "Return Requested",
        "body": f"{rider} requested to return {veh_text}. Please confirm in Admin > Bookings.",
        "read": False, "created_at": now_utc_iso(),
    })
    updated = await db.bookings.find_one({"id": active["id"]}, {"_id": 0})
    return updated


@api_router.post("/bookings/me/cancel-return")
async def cancel_return_request(user: dict = Depends(approved_user)):
    """Customer can cancel their return request before admin confirms."""
    b = await db.bookings.find_one({"user_id": user["id"], "status": "return_requested"}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="No pending return request")
    await db.bookings.update_one(
        {"id": b["id"]},
        {"$set": {"status": "active", "return_requested_at": None, "customer_notes": None}},
    )
    updated = await db.bookings.find_one({"id": b["id"]}, {"_id": 0})
    return updated


@api_router.get("/admin/bookings")
async def admin_list_bookings(
    status: Optional[str] = None,
    user_id: Optional[str] = None,
    _: dict = Depends(admin_required),
):
    query: dict = {}
    if status:
        query["status"] = status
    if user_id:
        query["user_id"] = user_id
    items = await db.bookings.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return items


@api_router.get("/admin/users/{uid}/bookings")
async def admin_user_bookings(uid: str, _: dict = Depends(admin_required)):
    items = await db.bookings.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@api_router.post("/admin/bookings/{bid}/confirm-return")
async def admin_confirm_return(bid: str, body: ConfirmReturnIn, _: dict = Depends(admin_required)):
    """
    Confirm a vehicle return.

    Wallet model:
      - Customer's paid deposits act as a wallet held by the business.
      - `damages_amount` is forfeited to the business (for damages, deductions).
      - `refund_amount` is paid back to the customer (status=refunded).
      - The rest stays in wallet (status=paid, vehicle_id cleared) so it can be
        used for the next rental until the user fully exits.

    Validation: refund + damages <= total paid deposits for this vehicle.
    """
    b = await db.bookings.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b["status"] == "returned":
        raise HTTPException(status_code=409, detail="Booking already returned")
    refund_amt = float(body.refund_amount or 0.0)
    damages_amt = float(body.damages_amount or 0.0)
    if refund_amt < 0 or damages_amt < 0:
        raise HTTPException(status_code=400, detail="Amounts must be >= 0")

    user_id = b["user_id"]
    vehicle_id = b["vehicle_id"]

    # Compute totals from existing data
    paid_deposits = await db.deposits.find(
        {"user_id": user_id, "status": "paid", "vehicle_id": vehicle_id},
        {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    deposit_paid = round(sum(float(d["amount"]) for d in paid_deposits), 2)

    if refund_amt + damages_amt > deposit_paid + 0.001:
        raise HTTPException(
            status_code=412,
            detail=(
                f"Refund ₹{refund_amt:.0f} + damages ₹{damages_amt:.0f} exceeds "
                f"deposit balance ₹{deposit_paid:.0f} for this rental."
            ),
        )

    paid_rents = await db.payments.find(
        {"user_id": user_id, "vehicle_id": vehicle_id, "status": "paid"},
        {"_id": 0},
    ).to_list(500)
    total_rent_paid = round(
        sum(float(p["amount"]) + float(p.get("late_fee", 0.0)) for p in paid_rents),
        2,
    )

    async def _split_deposit(d: dict, take_amt: float, new_status: str, extra: dict):
        """Take `take_amt` from deposit d and create a new record with new_status."""
        amt = float(d["amount"])
        if take_amt >= amt - 0.001:
            patch = {"status": new_status, **extra}
            await db.deposits.update_one({"id": d["id"]}, {"$set": patch})
            return amt
        # Split: shrink the original (stays as is), create a new sibling for `take_amt`
        remaining = round(amt - take_amt, 2)
        await db.deposits.update_one({"id": d["id"]}, {"$set": {"amount": remaining}})
        split = Deposit(
            id=str(uuid.uuid4()), user_id=d["user_id"], vehicle_id=d.get("vehicle_id"),
            amount=take_amt, status=new_status,
            transaction_id=d.get("transaction_id"), paid_at=d.get("paid_at"),
            created_at=d["created_at"],
        ).dict()
        split.update(extra)
        await db.deposits.insert_one(split)
        return take_amt

    now_iso = now_utc_iso()
    remaining_refund = refund_amt
    remaining_damages = damages_amt

    # Pass 1: apply refund FIFO
    for d in paid_deposits:
        if remaining_refund <= 0:
            break
        fresh = await db.deposits.find_one({"id": d["id"]}, {"_id": 0})
        if not fresh or fresh.get("status") != "paid" or float(fresh["amount"]) <= 0:
            continue
        applied = await _split_deposit(
            fresh, min(remaining_refund, float(fresh["amount"])),
            new_status="refunded",
            extra={"refunded_amount": min(remaining_refund, float(fresh["amount"])), "refunded_at": now_iso},
        )
        remaining_refund = round(remaining_refund - applied, 2)

    # Pass 2: apply damages FIFO
    reason = (body.notes or "Return deductions")
    paid_deposits_after = await db.deposits.find(
        {"user_id": user_id, "status": "paid", "vehicle_id": vehicle_id},
        {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    for d in paid_deposits_after:
        if remaining_damages <= 0:
            break
        applied = await _split_deposit(
            d, min(remaining_damages, float(d["amount"])),
            new_status="forfeited",
            extra={"forfeit_reason": reason, "forfeit_at": now_iso},
        )
        remaining_damages = round(remaining_damages - applied, 2)

    # Pass 3: leftover "paid" deposits become wallet (clear vehicle_id so they
    # are clearly free balance and not tied to the returned vehicle).
    await db.deposits.update_many(
        {"user_id": user_id, "status": "paid", "vehicle_id": vehicle_id},
        {"$set": {"vehicle_id": None}},
    )

    leftover_wallet = round(deposit_paid - refund_amt - damages_amt, 2)

    # Release the vehicle
    await db.vehicles.update_one(
        {"id": vehicle_id},
        {"$set": {"assigned_to": None, "status": "available", "rental_start_date": None}},
    )

    # Cancel pending payments for this rental (future rent shouldn't be billed after return)
    cancelled_count = (await db.payments.delete_many({
        "user_id": user_id, "vehicle_id": vehicle_id, "status": "pending",
    })).deleted_count

    # Close the booking
    await db.bookings.update_one(
        {"id": bid},
        {"$set": {
            "status": "returned",
            "end_date": now_iso,
            "returned_at": now_iso,
            "refund_amount": refund_amt,
            "damages_amount": damages_amt,
            "wallet_retained": leftover_wallet,
            "admin_notes": (body.notes or "").strip() or None,
            "total_rent_paid": total_rent_paid,
            "deposit_paid": deposit_paid,
            "deposit_refunded": refund_amt,
        }},
    )

    # Notify customer
    veh = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    veh_text = f"{veh['model']} ({veh['number_plate']})" if veh else "vehicle"
    parts = [f"Refund ₹{refund_amt:.0f}"]
    if damages_amt > 0:
        parts.append(f"Damages ₹{damages_amt:.0f}")
    if leftover_wallet > 0:
        parts.append(f"Wallet ₹{leftover_wallet:.0f} retained")
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id,
        "title": "Return Confirmed",
        "body": f"Your return of {veh_text} is confirmed. " + " · ".join(parts) + ".",
        "read": False, "created_at": now_utc_iso(),
    })

    updated = await db.bookings.find_one({"id": bid}, {"_id": 0})
    updated["cancelled_pending_payments"] = cancelled_count
    updated["wallet_retained"] = leftover_wallet
    return updated


# -------------------- WEEKLY REMINDER SCHEDULER --------------------
async def _create_reminders_for_pending():
    """Send a reminder to every customer with a pending payment + a summary to admin."""
    now = datetime.now(timezone.utc)
    settings = await get_settings_doc()
    cursor = db.payments.find({"status": "pending"}, {"_id": 0})
    sent_count = 0
    async for p in cursor:
        # Avoid spamming: skip if a reminder was already sent in the last 6 days
        last_at = p.get("reminder_sent_at")
        if last_at:
            try:
                la = datetime.fromisoformat(last_at)
                if la.tzinfo is None:
                    la = la.replace(tzinfo=timezone.utc)
                if (now - la).total_seconds() < 6 * 86400:
                    continue
            except Exception:
                pass
        user = await db.users.find_one({"id": p["user_id"]}, {"_id": 0})
        veh = await db.vehicles.find_one({"id": p.get("vehicle_id")}, {"_id": 0}) if p.get("vehicle_id") else None
        try:
            due_str = datetime.fromisoformat(p["due_date"]).strftime("%d %b")
        except Exception:
            due_str = ""
        late_fee = float(p.get("late_fee", 0.0))
        total = float(p["amount"]) + late_fee
        fee_line = f" (incl. ₹{late_fee:.0f} late fee)" if late_fee > 0 else ""
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": p["user_id"],
            "title": "Weekly Payment Reminder",
            "body": f"Your weekly rent of ₹{total:.0f}{fee_line} is due on {due_str}. Pay via UPI from the Payments tab.",
            "read": False, "created_at": now_utc_iso(),
        })
        rider = (user.get("full_name") if user else None) or (user.get("phone") if user else "Rider")
        veh_text = f"{veh['model']} ({veh['number_plate']})" if veh else "Vehicle"
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": None,
            "title": "Payment Reminder Sent",
            "body": f"{rider} · {veh_text} · ₹{total:.0f}{fee_line} due {due_str}",
            "read": False, "created_at": now_utc_iso(),
        })
        await db.payments.update_one({"id": p["id"]}, {"$set": {"reminder_sent": True, "reminder_sent_at": now_utc_iso()}})
        sent_count += 1
    return sent_count


async def _create_reminders_once():
    """Backwards-compatible alias used by manual trigger and old code paths."""
    await _compute_late_fees_once()
    return await _create_reminders_for_pending()


async def scheduler_loop():
    """Runs forever, wakes up every 5 minutes.
    - Daily at any time: recompute late fees (idempotent).
    - On configured weekday at configured IST hour: send reminders (once per day, idempotent via last_fired_date)."""
    await asyncio.sleep(15)
    while True:
        try:
            await _compute_late_fees_once()
            settings = await get_settings_doc()
            now_ist = datetime.now(IST)
            today_key = now_ist.strftime("%Y-%m-%d")
            target_wd = int(settings.get("reminder_weekday", 0))
            target_hr = int(settings.get("reminder_hour_ist", 9))
            if now_ist.weekday() == target_wd and now_ist.hour == target_hr:
                state = await db.scheduler_state.find_one({"id": "reminders"}, {"_id": 0})
                if not state or state.get("last_fired_date") != today_key:
                    count = await _create_reminders_for_pending()
                    await db.scheduler_state.update_one(
                        {"id": "reminders"},
                        {"$set": {"id": "reminders", "last_fired_date": today_key, "last_fired_at": now_utc_iso(), "last_count": count}},
                        upsert=True,
                    )
                    logging.getLogger(__name__).info(f"Weekly reminders fired at IST {now_ist.isoformat()} for {count} payment(s).")
        except Exception as e:
            logging.getLogger(__name__).warning(f"Scheduler loop error: {e}")
        await asyncio.sleep(300)  # 5 minutes


# Backwards-compatible alias for older startup hook
reminder_loop = scheduler_loop


# -------------------- APP SETUP --------------------
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware, allow_credentials=True, allow_origins=["*"],
    allow_methods=["*"], allow_headers=["*"],
)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def on_startup():
    await db.otps.create_index("created_at", expireAfterSeconds=600)
    await seed_demo_data()
    await get_settings_doc()
    asyncio.create_task(scheduler_loop())
    logger.info("RideLease backend ready.")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
