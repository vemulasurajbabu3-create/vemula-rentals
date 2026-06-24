"""Iteration 7: Verifies Weekly/Wallet tabs on Customer Payments via Playwright.
Hybrid approach: admin/seed actions via API; customer-facing UI via Playwright."""
import asyncio
import os
import re
import uuid
import json
import requests
from playwright.async_api import async_playwright

BASE = "https://rentwheel-connect.preview.emergentagent.com"
API = f"{BASE}/api"
SCRN = "/app/test_reports/screens/it7"
os.makedirs(SCRN, exist_ok=True)

ADMIN_PHONE = "9999999999"
CUST_PHONE = "7" + str(uuid.uuid4().int)[:9]
results = {"steps": []}


def step(name, ok, detail=""):
    print(f"{'[PASS]' if ok else '[FAIL]'} {name} :: {detail}")
    results["steps"].append({"name": name, "ok": ok, "detail": detail})


def auth(phone):
    requests.post(f"{API}/auth/request-otp", json={"phone": phone}, timeout=15)
    r = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": "123456"}, timeout=15)
    r.raise_for_status()
    return r.json()


def h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


async def fill_otp(page, code="123456"):
    for i, c in enumerate(code):
        await page.fill(f'[data-testid="otp-digit-{i}"]', c)
    await page.click('[data-testid="verify-otp-button"]', force=True)


async def login(page, phone):
    await page.goto(f"http://localhost:3000/auth/login", wait_until="domcontentloaded")
    await page.wait_for_selector('[data-testid="phone-input"]', timeout=15000)
    await page.fill('[data-testid="phone-input"]', phone)
    await page.click('[data-testid="send-otp-button"]', force=True)
    await page.wait_for_selector('[data-testid="otp-digit-0"]', timeout=15000)
    await fill_otp(page)
    await page.wait_for_timeout(2500)


async def go_payments(page):
    await page.goto("http://localhost:3000/customer/payments", wait_until="domcontentloaded")
    await page.wait_for_selector('[data-testid="payments-tabs"]', timeout=15000)
    await page.wait_for_timeout(800)


async def run():
    # --- API setup: register + approve customer ---
    admin = auth(ADMIN_PHONE)
    cust = auth(CUST_PHONE)
    ar = requests.post(f"{API}/admin/users/{cust['user_id']}/approve", headers=h(admin["token"]))
    step("admin_approves_customer", ar.status_code == 200, f"phone={CUST_PHONE} {ar.status_code}")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await ctx.new_page()
        page.on("console", lambda m: print(f"CONSOLE[{m.type}]: {m.text}") if m.type == "error" else None)

        try:
            await login(page, CUST_PHONE)
            await go_payments(page)

            # === Step 1: Default state ===
            tabs_visible = await page.is_visible('[data-testid="payments-tabs"]')
            tab_weekly = await page.is_visible('[data-testid="tab-weekly"]')
            tab_wallet = await page.is_visible('[data-testid="tab-wallet"]')
            step("tabs_visible", tabs_visible and tab_weekly and tab_wallet, f"tabs={tabs_visible} w={tab_weekly} v={tab_wallet}")

            # Default active = weekly → wallet card hidden
            wallet_card_default = await page.query_selector('[data-testid="deposit-card"]')
            step("default_weekly_active_no_wallet_card", wallet_card_default is None, "deposit-card absent in default Weekly tab")
            await page.screenshot(path=f"{SCRN}/01_weekly_default.png", quality=40, full_page=False)

            # === Step 2: Wallet top-up ===
            await page.click('[data-testid="tab-wallet"]', force=True)
            await page.wait_for_selector('[data-testid="deposit-card"]', timeout=8000)
            await page.screenshot(path=f"{SCRN}/02_wallet_empty.png", quality=40, full_page=False)
            step("wallet_tab_shows_deposit_card", True, "deposit-card visible after switch")

            await page.click('[data-testid="top-up-button"]', force=True)
            await page.wait_for_selector('[data-testid="top-up-sheet"]', timeout=8000)
            await page.click('[data-testid="preset-1000"]', force=True)
            await page.click('[data-testid="confirm-top-up-button"]', force=True)
            await page.wait_for_selector('[data-testid="deposit-txn-input"]', timeout=10000)
            txn_dep = f"DEPTEST{uuid.uuid4().hex[:6].upper()}"
            await page.fill('[data-testid="deposit-txn-input"]', txn_dep)
            await page.click('[data-testid="confirm-deposit-button"]', force=True)
            await page.wait_for_timeout(2500)
            # Re-open Wallet tab to ensure refresh
            await page.click('[data-testid="tab-wallet"]', force=True)
            await page.wait_for_timeout(800)
            bal_text = await page.text_content('[data-testid="wallet-balance"]')
            step("wallet_balance_at_least_1000", "1000" in (bal_text or ""), f"wallet-balance='{bal_text}'")

            wallet_rows = await page.query_selector_all('[data-testid^="wallet-row-"]')
            step("wallet_list_has_row", len(wallet_rows) >= 1, f"rows={len(wallet_rows)}")
            row_text = (await wallet_rows[0].text_content()) if wallet_rows else ""
            step("wallet_row_shows_paid_plus_1000", "+₹1000" in row_text and "Paid" in row_text, f"row='{row_text[:120]}'")
            await page.screenshot(path=f"{SCRN}/03_wallet_after_topup.png", quality=40, full_page=False)

            # Switch back to weekly → deposit-card hidden
            await page.click('[data-testid="tab-weekly"]', force=True)
            await page.wait_for_timeout(600)
            dep_card_weekly = await page.query_selector('[data-testid="deposit-card"]')
            step("weekly_tab_hides_deposit_card", dep_card_weekly is None, "deposit-card absent in Weekly")

            # === Step 3: Admin assigns vehicle with security_deposit ≤ wallet balance ===
            plate = f"IT7-{uuid.uuid4().hex[:6].upper()}"
            cv = requests.post(f"{API}/vehicles", headers=h(admin["token"]), json={
                "vehicle_type": "TEST IT7", "model": "TEST IT7 Bike",
                "number_plate": plate, "weekly_rent": 400.0, "security_deposit": 500.0,
                "instructions": ["it7"], "image_url": None,
            })
            step("admin_create_vehicle", cv.status_code == 200, f"{cv.status_code} {cv.text[:80]}")
            vid = cv.json()["id"]
            ar2 = requests.post(f"{API}/vehicles/assign", headers=h(admin["token"]),
                                json={"user_id": cust["user_id"], "vehicle_id": vid})
            step("admin_assign_vehicle", ar2.status_code == 200, f"{ar2.status_code} {ar2.text[:80]}")

            # === Step 4: Customer sees pending row, marks paid via UPI ===
            await page.reload(wait_until="domcontentloaded")
            await page.wait_for_selector('[data-testid="payments-tabs"]', timeout=10000)
            await page.click('[data-testid="tab-weekly"]', force=True)
            await page.wait_for_timeout(1200)

            payments = requests.get(f"{API}/payments/me", headers=h(cust["token"])).json()
            pending = [p for p in payments if p["status"] == "pending"]
            step("backend_has_pending", len(pending) >= 1, f"pending={len(pending)}")
            pay_id = pending[0]["id"] if pending else None

            row_sel = f'[data-testid="payment-{pay_id}"]' if pay_id else ""
            visible_row = await page.is_visible(row_sel) if pay_id else False
            step("ui_pending_row_visible", visible_row, row_sel)
            await page.screenshot(path=f"{SCRN}/04_weekly_pending.png", quality=40, full_page=False)

            await page.click(row_sel, force=True)
            await page.wait_for_selector('[data-testid="confirm-payment-sheet"]', timeout=8000)
            txn_pay = f"UPITEST{uuid.uuid4().hex[:6].upper()}"
            await page.fill('[data-testid="txn-input"]', txn_pay)
            await page.click('[data-testid="confirm-payment-button"]', force=True)
            await page.wait_for_timeout(2500)

            # Reload, re-fetch row
            await page.click('[data-testid="tab-weekly"]', force=True)
            await page.wait_for_timeout(600)
            row_text_paid = await page.text_content(row_sel)
            step("ui_row_paid_upi", row_text_paid and "Paid" in row_text_paid and "UPI" in row_text_paid,
                 f"row='{(row_text_paid or '')[:150]}'")

            # Backend should also have new pending row
            payments2 = requests.get(f"{API}/payments/me", headers=h(cust["token"])).json()
            new_pending = [p for p in payments2 if p["status"] == "pending"]
            step("new_pending_after_upi", len(new_pending) >= 1, f"new_pending={len(new_pending)}")
            await page.screenshot(path=f"{SCRN}/05_weekly_paid_upi.png", quality=40, full_page=False)

            # === Step 5: Wallet tab unchanged ===
            await page.click('[data-testid="tab-wallet"]', force=True)
            await page.wait_for_timeout(600)
            bal_text2 = await page.text_content('[data-testid="wallet-balance"]')
            step("wallet_balance_unchanged", "1000" in (bal_text2 or ""), f"wallet-balance='{bal_text2}'")
            await page.screenshot(path=f"{SCRN}/06_wallet_after_upi.png", quality=40, full_page=False)

            # === Step 6: Admin marks new pending as Cash ===
            if new_pending:
                cash_pid = new_pending[0]["id"]
                mc = requests.post(f"{API}/admin/payments/{cash_pid}/mark-paid-cash", headers=h(admin["token"]))
                step("admin_mark_cash_paid", mc.status_code == 200, f"{mc.status_code} {mc.text[:80]}")

                await page.reload(wait_until="domcontentloaded")
                await page.wait_for_selector('[data-testid="payments-tabs"]', timeout=10000)
                await page.click('[data-testid="tab-weekly"]', force=True)
                await page.wait_for_timeout(1500)

                cash_row_sel = f'[data-testid="payment-{cash_pid}"]'
                cash_row_text = await page.text_content(cash_row_sel)
                txn_check = "CASH-" in (cash_row_text or "")
                step("ui_row_paid_cash", cash_row_text and "Paid" in cash_row_text and "Cash" in cash_row_text and txn_check,
                     f"row='{(cash_row_text or '')[:200]}'")
                await page.screenshot(path=f"{SCRN}/07_weekly_paid_cash.png", quality=40, full_page=False)

            # === Step 7: Regression sanity ===
            # tab-history works
            await page.click('[data-testid="tab-history"]', force=True)
            await page.wait_for_timeout(1200)
            on_hist = await page.is_visible('[data-testid="history-screen"]') or "/history" in page.url
            step("tab_history_works", on_hist, page.url)

            # PickupAddressCard on home
            await page.goto("http://localhost:3000/customer/home", wait_until="domcontentloaded")
            await page.wait_for_timeout(1500)
            pickup_ok = await page.is_visible('[data-testid="pickup-address-card"]')
            step("pickup_address_card_on_home", pickup_ok, "")

        except Exception as e:
            print(f"EXC: {e}")
            await page.screenshot(path=f"{SCRN}/error.png", quality=40, full_page=False)
            step("exception", False, str(e)[:300])
        finally:
            with open("/app/test_reports/it7_steps.json", "w") as f:
                json.dump(results, f, indent=2)
            await ctx.close()
            await browser.close()

    passed = sum(1 for s in results["steps"] if s["ok"])
    total = len(results["steps"])
    print(f"\n=== IT7 RESULT: {passed}/{total} passed ===")


if __name__ == "__main__":
    asyncio.run(run())
