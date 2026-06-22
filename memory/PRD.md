# RideLease - Weekly Bike Rental Management App

## Overview
Cross-role (customer + admin) Expo mobile app for a rental bike business. Customers register via OTP, manage their assigned vehicle, pay weekly rent via UPI deep-link, upload KYC documents, and share their location with the business. Admin manages fleet, users, payments, documents, and announcements — all inside the same mobile app.

## Tech Stack
- Frontend: Expo SDK 54 (React Native), expo-router, expo-image, expo-location, expo-image-picker, expo-document-picker, expo-linking
- Backend: FastAPI + Motor (async MongoDB), PyJWT
- Auth: Mocked OTP + JWT (any 6-digit code accepted in dev)
- Storage: MongoDB (vehicles, users, payments, documents, notifications, location_history)

## Key Features
### Customer
- OTP login (mobile + 6-digit code, dev mode)
- Home dashboard: assigned vehicle, weekly payment status, due date, recent notifications, quick pay
- Vehicle page: hero image, rental info, step-by-step usage instructions
- Payments: history with status chips, pending balance banner, UPI deep-link (`upi://pay`) launches GPay/PhonePe, transaction ID confirmation marks payment as paid
- Documents: upload DL / ID proof / agreement / PDFs as base64, view status (pending/approved/rejected)
- Profile: name + address edit, logout
- Live location: foreground + background permission requested, current location posted on home open

### Admin (same app, phone `9999999999`)
- Dashboard: total vehicles, active rentals, users, pending docs, earned/pending amounts
- Vehicles: CRUD with image URL, instructions
- Users: list customers with last known location, assign/change vehicle (auto-creates first weekly payment)
- Payments: see all transactions across users with status
- Documents review: approve/reject pending uploads with image preview
- Announcements: broadcast notification to all customers

## Architecture
- `app/index.tsx` - splash, redirects to auth / customer / admin based on stored token
- `app/auth/*` - login + OTP screens
- `app/customer/*` - bottom tabs (home, vehicle, payments, documents, profile)
- `app/admin/*` - bottom tabs (dashboard, vehicles, users, payments, more [docs+announcements])
- `src/api/client.ts` - typed fetch wrapper using `EXPO_PUBLIC_BACKEND_URL`
- `src/theme/index.ts` - Moss-Green color palette per design guidelines
- `backend/server.py` - all REST endpoints under `/api` prefix

## Mocked / Not-Real Integrations
- **OTP is MOCKED**: any 6-digit code works. To plug real SMS, swap `verify_otp` logic to compare DB-stored OTP and integrate Twilio/MSG91.
- **UPI is deep-link only**: opens user's UPI app; payment confirmation is manual (user enters Txn ID). Real settlement requires Razorpay/PhonePe Business merchant onboarding.
- **Notifications are in-app only** (no push). Weekly reminders are admin-broadcast or auto-created when payments are marked paid.

## Next Steps
- Add real SMS OTP via Twilio/MSG91
- Add real UPI gateway (Razorpay) for automatic verification
- Add scheduled weekly reminder via cron / Celery
- Map view for admin to see user live locations
