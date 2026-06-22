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


class UserProfile(BaseModel):
    id: str
    phone: str
    full_name: Optional[str] = None
    address: Optional[str] = None
    is_admin: bool = False
    created_at: str


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    address: Optional[str] = None


class LocationIn(BaseModel):
    latitude: float
    longitude: float


class Vehicle(BaseModel):
    id: str
    vehicle_type: str
    model: str
    number_plate: str
    weekly_rent: float
    status: str = "available"  # available | rented | maintenance
    assigned_to: Optional[str] = None  # user_id
    rental_start_date: Optional[str] = None
    instructions: List[str] = []
    image_url: Optional[str] = None
    created_at: str


class VehicleCreate(BaseModel):
    vehicle_type: str
    model: str
    number_plate: str
    weekly_rent: float
    instructions: List[str] = []
    image_url: Optional[str] = None


class VehicleUpdate(BaseModel):
    vehicle_type: Optional[str] = None
    model: Optional[str] = None
    number_plate: Optional[str] = None
    weekly_rent: Optional[float] = None
    status: Optional[str] = None
    instructions: Optional[List[str]] = None
    image_url: Optional[str] = None


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
    created_at: str


class PaymentMarkPaid(BaseModel):
    transaction_id: str


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
    reminder_weekday: int = 0  # 0=Monday ... 6=Sunday
    reminder_hour_ist: int = 9  # 0-23, IST hour
    late_fee_per_day: float = 50.0  # ₹ per day overdue
    grace_days: int = 0  # no fee for first N days late


class SettingsUpdate(BaseModel):
    reminder_weekday: Optional[int] = None
    reminder_hour_ist: Optional[int] = None
    late_fee_per_day: Optional[float] = None
    grace_days: Optional[int] = None


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
    # Dev mode: accept any 6 digit code
    user = await db.users.find_one({"phone": body.phone}, {"_id": 0})
    is_new = False
    if not user:
        user = {
            "id": str(uuid.uuid4()),
            "phone": body.phone,
            "full_name": None,
            "address": None,
            "is_admin": body.phone == ADMIN_PHONE,
            "last_location": None,
            "created_at": now_utc_iso(),
        }
        await db.users.insert_one(dict(user))
        is_new = True
    token = create_token(user["id"], user["phone"], user.get("is_admin", False))
    return TokenOut(token=token, user_id=user["id"], is_admin=user.get("is_admin", False), is_new_user=is_new)


# -------------------- USER ROUTES --------------------
@api_router.get("/users/me", response_model=UserProfile)
async def get_me(user: dict = Depends(current_user)):
    return UserProfile(**{
        "id": user["id"], "phone": user["phone"], "full_name": user.get("full_name"),
        "address": user.get("address"), "is_admin": user.get("is_admin", False),
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
        "address": u.get("address"), "is_admin": u.get("is_admin", False),
        "created_at": u["created_at"],
    })


@api_router.post("/users/me/location")
async def update_location(body: LocationIn, user: dict = Depends(current_user)):
    loc = {"latitude": body.latitude, "longitude": body.longitude, "updated_at": now_utc_iso()}
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_location": loc}})
    await db.location_history.insert_one({
        "user_id": user["id"], **loc,
    })
    return {"ok": True}


@api_router.get("/users/me/vehicle")
async def get_my_vehicle(user: dict = Depends(current_user)):
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
        id=str(uuid.uuid4()), vehicle_type=body.vehicle_type, model=body.model,
        number_plate=body.number_plate, weekly_rent=body.weekly_rent,
        status="available", instructions=body.instructions, image_url=body.image_url,
        created_at=now_utc_iso(),
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
    # Validate target vehicle exists FIRST (and is available or already assigned to this user)
    veh = await db.vehicles.find_one({"id": body.vehicle_id}, {"_id": 0})
    if not veh:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if veh.get("assigned_to") and veh["assigned_to"] != body.user_id:
        raise HTTPException(status_code=409, detail="Vehicle already assigned to another user")
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
    # Create first pending payment if none exists
    existing = await db.payments.find_one({"user_id": body.user_id, "status": "pending"}, {"_id": 0})
    if not existing:
        due = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        await db.payments.insert_one({
            "id": str(uuid.uuid4()), "user_id": body.user_id, "vehicle_id": body.vehicle_id,
            "amount": veh["weekly_rent"], "due_date": due, "status": "pending",
            "transaction_id": None, "paid_at": None, "created_at": now_utc_iso(),
        })
    # Notify user
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": body.user_id,
        "title": "Vehicle Assigned",
        "body": f"You have been assigned {veh['model']} ({veh['number_plate']}). Happy riding!",
        "read": False, "created_at": now_utc_iso(),
    })
    return {"ok": True}


# -------------------- PAYMENT ROUTES --------------------
@api_router.get("/payments/me", response_model=List[Payment])
async def list_my_payments(user: dict = Depends(current_user)):
    # Recompute late fees on read so amounts are always current
    await _compute_late_fees_once()
    items = await db.payments.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Payment(**i) for i in items]


@api_router.post("/payments/{pid}/mark-paid", response_model=Payment)
async def mark_payment_paid(pid: str, body: PaymentMarkPaid, user: dict = Depends(current_user)):
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
        {"$set": {"status": "paid", "transaction_id": body.transaction_id, "paid_at": now_utc_iso()}},
    )
    # Create next pending payment
    veh = await db.vehicles.find_one({"assigned_to": user["id"]}, {"_id": 0})
    if veh:
        due = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        await db.payments.insert_one({
            "id": str(uuid.uuid4()), "user_id": user["id"], "vehicle_id": veh["id"],
            "amount": veh["weekly_rent"], "late_fee": 0.0, "due_date": due, "status": "pending",
            "transaction_id": None, "paid_at": None, "created_at": now_utc_iso(),
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
async def admin_list_payments(_: dict = Depends(admin_required)):
    items = await db.payments.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Payment(**i) for i in items]


# -------------------- DOCUMENT ROUTES --------------------
@api_router.post("/documents", response_model=Document)
async def upload_document(body: DocumentCreate, user: dict = Depends(current_user)):
    doc = Document(
        id=str(uuid.uuid4()), user_id=user["id"], doc_type=body.doc_type,
        name=body.name, base64_data=body.base64_data, mime_type=body.mime_type,
        status="pending", created_at=now_utc_iso(),
    )
    await db.documents.insert_one(doc.dict())
    return doc


@api_router.get("/documents/me", response_model=List[Document])
async def list_my_docs(user: dict = Depends(current_user)):
    items = await db.documents.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [Document(**i) for i in items]


@api_router.delete("/documents/{did}")
async def delete_my_doc(did: str, user: dict = Depends(current_user)):
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
async def list_my_notifications(user: dict = Depends(current_user)):
    items = await db.notifications.find(
        {"$or": [{"user_id": user["id"]}, {"user_id": None}]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return [Notification(**i) for i in items]


@api_router.post("/notifications/me/read-all")
async def mark_all_read(user: dict = Depends(current_user)):
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
async def admin_list_users(_: dict = Depends(admin_required)):
    items = await db.users.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Enrich with assigned vehicle
    out = []
    for u in items:
        v = await db.vehicles.find_one({"assigned_to": u["id"]}, {"_id": 0})
        u["assigned_vehicle"] = v
        out.append(u)
    return out


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


@api_router.get("/admin/settings")
async def admin_get_settings(_: dict = Depends(admin_required)):
    s = await get_settings_doc()
    return {
        "reminder_weekday": s.get("reminder_weekday", 0),
        "reminder_hour_ist": s.get("reminder_hour_ist", 9),
        "late_fee_per_day": s.get("late_fee_per_day", 50.0),
        "grace_days": s.get("grace_days", 0),
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
        await db.settings.update_one({"id": "global"}, {"$set": upd}, upsert=True)
        # Recompute fees immediately if fee/grace changed
        if "late_fee_per_day" in upd or "grace_days" in upd:
            await _compute_late_fees_once()
    return await admin_get_settings()


# -------------------- SEED --------------------
async def seed_demo_data():
    """Seed a small demo dataset on first boot."""
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
}
IST = timezone(timedelta(hours=5, minutes=30))


async def get_settings_doc() -> dict:
    doc = await db.settings.find_one({"id": "global"}, {"_id": 0})
    if not doc:
        await db.settings.insert_one(dict(DEFAULT_SETTINGS))
        return dict(DEFAULT_SETTINGS)
    return doc


# -------------------- LATE FEE ENGINE --------------------
async def _compute_late_fees_once():
    """For each pending payment past due_date, set late_fee = max(0, days_overdue - grace) * late_fee_per_day.
    Idempotent — re-runs simply recompute to the correct current value."""
    settings = await get_settings_doc()
    fee_per_day = float(settings.get("late_fee_per_day", 50.0))
    grace = int(settings.get("grace_days", 0))
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
