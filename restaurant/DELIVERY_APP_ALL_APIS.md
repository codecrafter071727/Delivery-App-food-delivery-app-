# Delivery App — complete API list (all services)

> **Who:** Delivery partner / rider iOS · Android · web (same Expo project as kitchen: `Food-Delivery-App/delivery/restaurant/`, routes under `app/(app)/delivery/`).  
> **Source:** actual routes in code (not customer checkout, kitchen KDS, or admin panel).  
> **Gateway:** `{BASE}/api/v1/{service-prefix}{path}` except gateway host paths.  
> **Auth:** cookie `_sid` (role `delivery_partner`). Mutating methods: CSRF `GET /api/csrf-token` → header `x-csrf-token`.  
> **Contracts:** [API_REQUEST_RESPONSE.md](API_REQUEST_RESPONSE.md) · service inventory [DELIVERY_SERVICE_APIS.md](DELIVERY_SERVICE_APIS.md)  
> **Platform table:** [API_ROUTES_REFERENCE.md](API_ROUTES_REFERENCE.md#9-delivery-service)

Implement **every LIVE row** below. Prefer **canonical `/partners/me/*`** on delivery-service. Do **not** dual-wire `/finance/*`, `/support/*`, `/notifications/*`, `/communication/*`, or `/deliveries/:id/*` aliases for the same job. Do **not** call `/admin/*`, `/internal/*`, `/dispatch/*`, `/ops/*`, customer cart/checkout, kitchen accept/ready, or legacy `admin-service`.

**Audit vs code (this file is complete for the rider app):** every mounted partner-callable path in `delivery-service/src/routes/` (`/partners/*` + rider tracking + public zones + health + unique `/communication` + `/support` accident/fraud + unread/delete notification) is listed. `/finance`, `/support` (except accident/fraud), `/notifications` (except unread-count + delete), `/communication` chat/call twins, `/deliveries/:id`, and `/tracking/order/:id/{location,eta,route}` are **ALIAS** of the same handlers. Admin `/admin/*` + `/ops/*` + `/dispatch/*` + all `/internal/*` + customer tracker extras are **intentionally omitted** from implement-order (listed under §6 never-call). Spec-only wish-list paths from `remaining api.md` that are **not mounted** are in §7 — they are not missing rider APIs.

| Legend | Meaning |
|---|---|
| 🔓 | Public (no login) |
| 🔑 | Logged-in `_sid` |
| 🚴 | `delivery_partner` (registered partner; many routes also `requirePartner`) |
| **LIVE** | Wired in code — call it |
| **ALIAS** | Same job exists on another path — **do not duplicate** in the app |
| **PROXY** | Delivery-service calls notification-service / payment-service; app still uses this path |

---

## 0. Implement order (screens)

1. Splash → `GET /partners/me/config` (min app version, city flags)  
2. Login → user-service (`role=delivery_partner` on register)  
3. Register partner → `POST /partners/register` (or `register-with-invite`)  
4. KYC → `POST /partners/me/documents` → wait for **admin** approve  
5. Bank → IFSC lookup → OTP → save → penny-drop verify  
6. Duty → `GET /status` → `PUT /go-online` (needs KYC `active`) / `go-offline` / break  
7. GPS → `POST /partners/me/location` + socket `partner:location` / `partner:heartbeat`  
8. Offer → socket `delivery:new` → `PUT .../accept` or `reject`  
9. Trip → arrived (150 m) → pickup OTP → OFD → arrived-customer (100 m) → drop OTP / POD → `deliver`  
10. COD → UPI QR or cash → remit when due  
11. Earnings / payouts / heatmap / SOS / support / inbox  

**Go-live gate:** admin `PUT /admin/partners/:id/kyc/:documentId/approve` (admin panel, not this app). Until then `PUT /go-online` returns `409 PARTNER_NOT_ACTIVE` / KYC incomplete. That is correct.

---

## 1. Gateway

**Prefix:** none (gateway host)

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/health` | 🔓 | Liveness |
| LIVE | `GET` | `/health/ready` | 🔓 | Downstream ready |
| LIVE | `GET` | `/api/csrf-token` | 🔓 | CSRF for POST/PUT/PATCH/DELETE |
| LIVE | `POST` | `/api/v1/socket-token` | 🔑 | Short-lived Socket.IO token (`auth.socketToken`) |
| LIVE | WS | `{GATEWAY}/socket.io/` | 🔑 `auth.socketToken` / `_sid` | Realtime rider |

### Sockets (rider)

Connect with verified session (cookie `_sid`, `auth.sid`, or `auth.socketToken`). Raw `userId` alone is rejected. Inbound events run the **same services as REST**.

| Status | Dir | Event | Use |
|---|---|---|---|
| LIVE | S→R | `delivery:new` | New offer (timeout + pins + fee) |
| LIVE | S→R | `delivery:assigned` | This rider’s trip |
| LIVE | S→R | `delivery:assignment-expiring` | Offer ~10s from timeout |
| LIVE | S→R | `delivery:cancelled` | `OFFER_TIMEOUT` / `OFFER_TAKEN` / cancel |
| LIVE | S→R | `delivery:updated` | Trip status change |
| LIVE | S→R | `notification:new` | Inbox badge |
| LIVE | S→R | `earnings:updated` | IST ledger delta |
| LIVE | S→R | `wallet:credited` | Wallet credit (real only) |
| LIVE | R→S | `partner:online` | Same as `PUT /go-online` |
| LIVE | R→S | `partner:offline` | Same as `PUT /go-offline` (`409 ACTIVE_DELIVERY`; disconnect ≠ offline) |
| LIVE | R→S | `partner:heartbeat` | Keep GPS/duty alive |
| LIVE | R→S | `partner:location` | Stream GPS (mock / jump gates) |
| LIVE | R→S | `delivery:accept` | Same as `PUT .../accept` |
| LIVE | R→S | `delivery:reject` | Same as `PUT .../reject` (`reasonCode` required) |
| LIVE | R→S | `delivery:arrived` | Arrived at restaurant |
| LIVE | R→S | `delivery:picked-up` | Pickup (OTP/photo as REST) |
| LIVE | R→S | `delivery:reached-customer` | Arrived at drop |
| LIVE | R→S | `delivery:completed` | Complete (`PROOF_REQUIRED` if no OTP/POD) |
| LIVE | Both | `chat:new-message` | In-trip chat (`deliveryId`) |
| LIVE | Both | `typing` | Typing dots (Redis TTL 2s) |

REST poll (`GET /partners/me/active-delivery`) remains the fallback if the socket drops.

---

## 2. user-service — auth + account

**Prefix:** `/api/v1/user-service`

Register with `"role": "delivery_partner"`. Then `POST /api/v1/delivery-service/partners/register` to create the partner profile.

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/health` | 🔓 | Liveness |
| LIVE | `POST` | `/auth/register` | 🔓 | Sign up (`role=delivery_partner`) |
| LIVE | `POST` | `/auth/login` | 🔓 | Email + password |
| LIVE | `POST` | `/auth/otp/send` | 🔓 | Phone OTP |
| LIVE | `POST` | `/auth/otp/resend` | 🔓 | Resend OTP (cooldown) |
| LIVE | `POST` | `/auth/otp/verify` | 🔓 | Verify → `_sid` |
| LIVE | `POST` | `/auth/social/google` | 🔓 | Google `idToken` → `_sid` |
| LIVE | `POST` | `/auth/social/apple` | 🔓 | Apple identity token → `_sid` |
| LIVE | `POST` | `/auth/forgot-password` | 🔓 | Forgot password |
| LIVE | `POST` | `/auth/reset-password` | 🔓 | Reset with token |
| LIVE | `GET` | `/auth/email/verify/:token` | 🔓 | Email verify link |
| LIVE | `POST` | `/auth/logout` | 🔑 | Logout this device |
| LIVE | `POST` | `/auth/logout-all` | 🔑 | Logout all devices |
| LIVE | `POST` | `/auth/change-password` | 🔑 | Change password |
| LIVE | `POST` | `/auth/email/send-verify` | 🔑 | Resend verify email |
| LIVE | `GET` | `/users/me` | 🔑 | Platform profile |
| LIVE | `PUT` | `/users/me` | 🔑 | Edit name |
| LIVE | `GET` | `/users/me/delete-preview` | 🔑 | What is lost before delete |
| LIVE | `DELETE` | `/users/me` | 🔑 | Delete account |
| LIVE | `POST` | `/users/me/profile-photo` | 🔑 | Upload photo |
| LIVE | `DELETE` | `/users/me/profile-photo` | 🔑 | Remove photo |
| LIVE | `GET` | `/users/me/preferences` | 🔑 | Prefs hub |
| LIVE | `PUT` | `/users/me/preferences/notifications` | 🔑 | Push / SMS / email |
| LIVE | `PUT` | `/users/me/preferences/language` | 🔑 | Language |
| LIVE | `PUT` | `/users/me/phone` | 🔑 | Change phone (OTP) |
| LIVE | `PUT` | `/users/me/email` | 🔑 | Change email |
| LIVE | `GET` | `/users/me/sessions` | 🔑 | Active devices |
| LIVE | `DELETE` | `/users/me/sessions/:sessionId` | 🔑 | Revoke session |
| LIVE | `GET` | `/users/me/devices` | 🔑 | FCM / APNs tokens |
| LIVE | `POST` | `/users/me/devices` | 🔑 | Register push token |
| LIVE | `DELETE` | `/users/me/devices/:deviceId` | 🔑 | Unregister |

Do **not** wire customer-only account APIs in the rider UI: customer wallet, dietary prefs, age-gate, customer referral. Rider wallet / referrals live on **delivery-service** §3.

Rider push for offers should use **§3.8** `POST /partners/me/devices/register` (`app: "rider"`) so zone/tier sync into notification-service. User-service devices are the platform fallback.

---

## 3. delivery-service — rider (canonical)

**Prefix:** `/api/v1/delivery-service`

Partner routes require a registered partner. Illegal duty/trip transitions return typed `AppError` (`PARTNER_NOT_ACTIVE`, `ACTIVE_DELIVERY`, `PARTNER_OFFLINE`, `COD_LIMIT_EXCEEDED`, `PROOF_REQUIRED`, `GEOFENCE_MISS`, …) — never silent no-ops.

### 3.1 Onboarding, profile, KYC, bank & tax

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/partners/invite/validate` | 🔓 | Validate restaurant invite token |
| LIVE | `POST` | `/partners/register` | 🔑 | Create partner profile (standard) |
| LIVE | `POST` | `/partners/register-with-invite` | 🔑 | Register via restaurant invite |
| LIVE | `GET` | `/partners/me` | 🔑🚴 | Own partner profile |
| LIVE | `PUT` | `/partners/me` | 🔑🚴 | Update profile / vehicle (not bank) |
| LIVE | `POST` | `/partners/me/documents` | 🔑🚴 | Upload KYC (`multipart/form-data`) |
| LIVE | `GET` | `/partners/me/bank/ifsc/:ifsc` | 🔑🚴 | Bank name/branch while typing IFSC |
| LIVE | `POST` | `/partners/me/bank/otp` | 🔑🚴 | SMS OTP before changing bank |
| LIVE | `GET` | `/partners/me/bank` | 🔑🚴 | Masked account + verify status |
| LIVE | `PUT` | `/partners/me/bank` | 🔑🚴 | Save bank (`otp` required when changing) |
| LIVE | `POST` | `/partners/me/bank/verify` | 🔑🚴 | Penny-drop (Cashfree; `503 BANK_VERIFY_UNAVAILABLE` if unset) |
| LIVE | `GET` | `/partners/me/tax-details` | 🔑🚴 | Masked PAN / GSTIN |
| LIVE | `PUT` | `/partners/me/tax-details` | 🔑🚴 | Update PAN / GSTIN |
| LIVE | `GET` | `/partners/me/tax-documents` | 🔑🚴 | TDS / Form 16A / annual list |
| LIVE | `GET` | `/partners/me/tax-documents/:documentId/download` | 🔑🚴 | Download tax PDF |

KYC files stay `uploaded` until **ops** approve. `PUT /partners/me` bank fields return `USE_BANK_API`.

### 3.2 Duty, breaks, shifts, attendance, hubs

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `PUT` | `/partners/me/go-online` | 🔑🚴 | Go online (KYC `active` + GPS) |
| LIVE | `PUT` | `/partners/me/go-offline` | 🔑🚴 | Go offline (`409 ACTIVE_DELIVERY` if on trip) |
| LIVE | `GET` | `/partners/me/status` | 🔑🚴 | Duty, break quota, active delivery, hub |
| LIVE | `PUT` | `/partners/me/status` | 🔑🚴 | Explicit `offline`/`online`/`on_break`/`on_way_to_hub` + lat/lng |
| LIVE | `GET` | `/partners/me/duty-summary` | 🔑🚴 | IST-today minutes, km, deliveries |
| LIVE | `PUT` | `/partners/me/break/start` | 🔑🚴 | Start break (max 30 / 60 min IST day) |
| LIVE | `PUT` | `/partners/me/break/end` | 🔑🚴 | End break |
| LIVE | `POST` | `/partners/me/break/extend` | 🔑🚴 | Extend within caps |
| LIVE | `GET` | `/partners/me/break/policy` | 🔑🚴 | Allowed minutes / day |
| LIVE | `GET` | `/partners/me/hub/nearby` | 🔑🚴 | Nearest hubs / cash-drop |
| LIVE | `POST` | `/partners/me/hub/check-in` | 🔑🚴 | Hub check-in (geofence) |
| LIVE | `POST` | `/partners/me/hub/check-out` | 🔑🚴 | Leave hub → online |
| LIVE | `GET` | `/partners/me/shifts` | 🔑🚴 | Bookable slots `?from=&to=` |
| LIVE | `POST` | `/partners/me/shifts/:shiftId/book` | 🔑🚴 | Book shift |
| LIVE | `DELETE` | `/partners/me/shifts/:shiftId` | 🔑🚴 | Cancel (≥2h before start) |
| LIVE | `GET` | `/partners/me/attendance/streak` | 🔑🚴 | Login streak |
| LIVE | `GET` | `/partners/me/attendance` | 🔑🚴 | Attendance log `?from=&to=` |

### 3.3 Location & demand

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `POST` | `/partners/me/location` | 🔑🚴 | Push GPS (lat/lng/heading/speed/accuracy) |
| LIVE | `GET` | `/partners/me/location/last` | 🔑🚴 | Last recorded GPS |
| LIVE | `PUT` | `/partners/me/home-location` | 🔑🚴 | Saved home/base pin |
| LIVE | `GET` | `/partners/me/nearby-orders-heatmap` | 🔑🚴 | Demand heatmap |
| LIVE | `POST` | `/tracking/gps-heartbeat` | 🔑🚴 | Periodic heartbeat (optional coords) |
| LIVE | `GET` | `/tracking/location-history/:deliveryId` | 🔑🚴 | GPS trail for assigned trip |
| LIVE | `GET` | `/tracking/status/:deliveryId` | 🔑 | Tracking status by delivery id |
| LIVE | `GET` | `/tracking/order/:orderId` | 🔑 | Track assigned order (same as customer tracker, rider-scoped) |
| LIVE | `GET` | `/tracking/live-location/:orderId` | 🔑 | Live GPS for assigned order |
| LIVE | `GET` | `/tracking/eta/:orderId` | 🔑 | ETA |
| LIVE | `GET` | `/tracking/route/:orderId` | 🔑 | Route polyline |

Path-suffix twins `GET /tracking/order/:orderId/location|eta|route` are **ALIAS** of the three LIVE rows above — see §4.6. Prefer these canonical `/tracking/{live-location|eta|route}/:orderId` paths (or trip `GET .../deliveries/:id/route`).

Do **not** call customer-only tracking: share-link, nudge, tip, rate-partner, drop-OTP display, address-change, `/tracking/order/:id/chat` (customer thread — rider chat is `GET/POST .../deliveries/:id/chat`).

### 3.4 Offers, trips, pickup, drop, RTO, chat, calls

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/partners/me/active-delivery` | 🔑🚴 | Current assignment |
| LIVE | `GET` | `/partners/me/active-deliveries` | 🔑🚴 | Multi-order / batch |
| LIVE | `GET` | `/partners/me/deliveries` | 🔑🚴 | History (paginated) |
| LIVE | `GET` | `/partners/me/deliveries/batch/:batchId` | 🔑🚴 | Batch assignment |
| LIVE | `PUT` | `/partners/me/deliveries/batch/:batchId/accept` | 🔑🚴 | Accept whole batch |
| LIVE | `PUT` | `/partners/me/deliveries/batch/:batchId/sequence` | 🔑🚴 | Confirm pickup-drop sequence |
| LIVE | `GET` | `/partners/me/deliveries/:deliveryId` | 🔑🚴 | Trip detail |
| LIVE | `GET` | `/partners/me/deliveries/:deliveryId/timeline` | 🔑🚴 | Timeline |
| LIVE | `GET` | `/partners/me/deliveries/:deliveryId/events` | 🔑🚴 | Events + issues + dispatch |
| LIVE | `PUT` | `/partners/me/deliveries/:deliveryId/accept` | 🔑🚴 | Accept offer |
| LIVE | `PUT` | `/partners/me/deliveries/:deliveryId/reject` | 🔑🚴 | Reject + reason → reassign |
| LIVE | `PUT` | `/partners/me/deliveries/:deliveryId/arrived` | 🔑🚴 | At restaurant (150 m) |
| LIVE | `PUT` | `/partners/me/deliveries/:deliveryId/order-not-ready` | 🔑🚴 | Kitchen wait clock |
| LIVE | `PUT` | `/partners/me/deliveries/:deliveryId/waiting` | 🔑🚴 | Waiting at store |
| LIVE | `PUT` | `/partners/me/deliveries/:deliveryId/order-ready` | 🔑🚴 | Kitchen prepared |
| LIVE | `PUT` | `/partners/me/deliveries/:deliveryId/pickup-verify` | 🔑🚴 | Pickup OTP / photo / checklist |
| LIVE | `PUT` | `/partners/me/deliveries/:deliveryId/pickup` | 🔑🚴 | Picked up → order OFD |
| LIVE | `PUT` | `/partners/me/deliveries/:deliveryId/on-the-way` | 🔑🚴 | Start to customer |
| LIVE | `PUT` | `/partners/me/deliveries/:deliveryId/arrived-customer` | 🔑🚴 | At drop (100 m) |
| LIVE | `PUT` | `/partners/me/deliveries/:deliveryId/reached-customer` | 🔑🚴 | Alias of arrived-customer |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/verify-otp` | 🔑🚴 | Verify drop OTP (not complete) |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/deliver` | 🔑🚴 | Deliver (OTP/photo/signature + geofence) |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/cancel` | 🔑🚴 | Cancel in-progress (post-accept) |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/report-issue` | 🔑🚴 | Mid-trip issue |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/signature` | 🔑🚴 | Customer signature |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/proof-of-delivery` | 🔑🚴 | POD photo (`multipart`) |
| LIVE | `PUT` | `/partners/me/deliveries/:deliveryId/customer-unreachable` | 🔑🚴 | Start RTO timer |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/customer-unavailable` | 🔑🚴 | Alias of unreachable |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/return-to-restaurant` | 🔑🚴 | RTO / refuse return |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/return-order` | 🔑🚴 | Alias of return-to-restaurant |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/failed` | 🔑🚴 | Terminal fail after pickup |
| LIVE | `GET` | `/partners/me/deliveries/:deliveryId/route` | 🔑🚴 | Turn-by-turn (Google + haversine) |
| LIVE | `GET` | `/partners/me/deliveries/:deliveryId/chat` | 🔑🚴 | Chat thread |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/chat` | 🔑🚴 | Send chat |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/call/customer` | 🔑🚴 | Masked call customer (`503` if telephony unset) |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/call/restaurant` | 🔑🚴 | Masked call restaurant |

### 3.5 Earnings, payouts, wallet, COD

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/partners/me/earnings` | 🔑🚴 | Today / week / month IST + lifetime |
| LIVE | `GET` | `/partners/me/earnings/daily` | 🔑🚴 | Daily `?days=` (default 7) |
| LIVE | `GET` | `/partners/me/earnings/:deliveryId` | 🔑🚴 | Per-trip breakdown |
| LIVE | `GET` | `/partners/me/payouts` | 🔑🚴 | Settlements list |
| LIVE | `GET` | `/partners/me/payouts/instant/eligibility` | 🔑🚴 | Instant eligibility + balance |
| LIVE | `GET` | `/partners/me/payouts/schedule` | 🔑🚴 | Weekly cycle + instant fee/cap |
| LIVE | `POST` | `/partners/me/payouts/instant` | 🔑🚴 | Instant payout |
| LIVE | `GET` | `/partners/me/payouts/:payoutId` | 🔑🚴 | Payout detail |
| LIVE | `GET` | `/partners/me/wallet` | 🔑🚴 | Payable earnings + COD cash-in-hand |
| LIVE | `GET` | `/partners/me/wallet/transactions` | 🔑🚴 | Ledger |
| LIVE | `GET` | `/partners/me/cod/pending` | 🔑🚴 | Cash due to remit |
| LIVE | `POST` | `/partners/me/cod/remit` | 🔑🚴 | Remit hub / UPI / bank |
| LIVE | `GET` | `/partners/me/cod/remittance-history` | 🔑🚴 | Past remittances |
| LIVE | `GET` | `/partners/me/cod/limit-status` | 🔑🚴 | COD cap / blocked |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/cod/upi-qr` | 🔑🚴 | Doorstep UPI QR (platform VPA) |
| LIVE | `POST` | `/partners/me/deliveries/:deliveryId/cod/mark-upi` | 🔑🚴 | Customer paid UPI |

Payouts need `bankVerificationStatus=verified`. Instant / weekly never fake `paid` without payment-service.

### 3.6 Incentives, rewards, performance, ratings, referrals

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/partners/me/incentives` | 🔑🚴 | Active programs + progress |
| LIVE | `GET` | `/partners/me/incentives/current` | 🔑🚴 | Running now |
| LIVE | `GET` | `/partners/me/incentives/history` | 🔑🚴 | Credited bonuses |
| LIVE | `GET` | `/partners/me/incentives/:incentiveId` | 🔑🚴 | Scheme + slabs |
| LIVE | `GET` | `/partners/me/incentives/:incentiveId/progress` | 🔑🚴 | Live slab progress |
| LIVE | `POST` | `/partners/me/incentives/:incentiveId/opt-in` | 🔑🚴 | Opt in |
| LIVE | `GET` | `/partners/me/rewards` | 🔑🚴 | Points balance |
| LIVE | `GET` | `/partners/me/rewards/catalog` | 🔑🚴 | Redeem catalog |
| LIVE | `POST` | `/partners/me/rewards/redeem` | 🔑🚴 | Redeem `itemId` / `sku` |
| LIVE | `GET` | `/partners/me/quests` | 🔑🚴 | Milestone quests |
| LIVE | `GET` | `/partners/me/challenges` | 🔑🚴 | Peak challenges |
| LIVE | `GET` | `/partners/leaderboard` | 🔑🚴 | Zone/city `?metric=&scope=&period=` |
| LIVE | `GET` | `/partners/me/performance` | 🔑🚴 | Acceptance / on-time / tier / rank |
| LIVE | `GET` | `/partners/me/acceptance-rate` | 🔑🚴 | Acceptance + at-risk |
| LIVE | `GET` | `/partners/me/cancellation-rate` | 🔑🚴 | Cancel rate + at-risk |
| LIVE | `GET` | `/partners/me/ratings` | 🔑🚴 | Rating history |
| LIVE | `GET` | `/partners/me/reviews` | 🔑🚴 | Customer reviews only |
| LIVE | `GET` | `/partners/me/ratings/summary` | 🔑🚴 | Stars + 30-day trend |
| LIVE | `GET` | `/partners/me/tier` | 🔑🚴 | Bronze–Platinum + perks |
| LIVE | `GET` | `/partners/me/tier/criteria` | 🔑🚴 | Next-tier progress |
| LIVE | `GET` | `/partners/me/warnings` | 🔑🚴 | Strikes |
| LIVE | `POST` | `/partners/me/warnings/:warningId/acknowledge` | 🔑🚴 | Ack warning |
| LIVE | `GET` | `/partners/me/referrals/code` | 🔑🚴 | Own code + share link |
| LIVE | `GET` | `/partners/me/referrals` | 🔑🚴 | Referred riders |
| LIVE | `GET` | `/partners/me/referrals/earnings` | 🔑🚴 | Referral bonuses |

### 3.7 Complaints, support, SOS, safety

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `POST` | `/partners/me/complaints` | 🔑🚴 | Complaint vs customer / restaurant |
| LIVE | `GET` | `/partners/me/complaints` | 🔑🚴 | Own complaints |
| LIVE | `POST` | `/partners/me/support/tickets` | 🔑🚴 | Ticket (earnings, bug, KYC, COD) |
| LIVE | `GET` | `/partners/me/support/tickets` | 🔑🚴 | Ticket list |
| LIVE | `GET` | `/partners/me/support/tickets/:ticketId` | 🔑🚴 | Detail + thread |
| LIVE | `POST` | `/partners/me/support/tickets/:ticketId/messages` | 🔑🚴 | Reply / attachment |
| LIVE | `PUT` | `/partners/me/support/tickets/:ticketId/close` | 🔑🚴 | Close own ticket |
| LIVE | `GET` | `/partners/me/support/faq` | 🔓 | Help articles `?category=&q=` |
| LIVE | `POST` | `/partners/me/support/call-request` | 🔑🚴 | Request ops callback |
| LIVE | `POST` | `/partners/me/earnings/disputes` | 🔑🚴 | Dispute earning (opens ticket) |
| LIVE | `POST` | `/partners/me/sos` | 🔑🚴 | Panic SOS + GPS |
| LIVE | `PUT` | `/partners/me/sos/:sosId/resolve` | 🔑🚴 | Resolve / false alarm |
| LIVE | `GET` | `/partners/me/sos/history` | 🔑🚴 | SOS history |
| LIVE | `POST` | `/partners/me/safety/incident-report` | 🔑🚴 | Non-emergency incident |
| LIVE | `GET` | `/partners/me/safety/insurance-cover` | 🔑🚴 | On-duty cover |
| LIVE | `POST` | `/partners/me/safety/insurance-claim` | 🔑🚴 | File claim |
| LIVE | `GET` | `/partners/me/safety/insurance-claim/:claimId` | 🔑🚴 | Track claim |

### 3.8 Config, feedback, inbox, devices, training

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/partners/me/config` | 🔑🚴 | Flags, min version, city rules |
| LIVE | `GET` | `/partners/me/config/pricing-rules` | 🔑🚴 | Fare / payout / COD rules |
| LIVE | `POST` | `/partners/me/app/feedback` | 🔑🚴 | App feedback |
| LIVE | `POST` | `/partners/me/app/crash-report` | 🔑🚴 | Crash report |
| LIVE | `GET` | `/partners/me/notifications` | 🔑🚴 PROXY | Inbox `?page=&limit=&unread=` |
| LIVE | `PUT` | `/partners/me/notifications/read-all` | 🔑🚴 PROXY | Mark all read |
| LIVE | `PUT` | `/partners/me/notifications/:notificationId/read` | 🔑🚴 PROXY | Mark one read |
| LIVE | `GET` | `/partners/me/notifications/preferences` | 🔑🚴 PROXY | Channel prefs |
| LIVE | `PUT` | `/partners/me/notifications/preferences` | 🔑🚴 PROXY | Update prefs |
| LIVE | `POST` | `/partners/me/devices/register` | 🔑🚴 PROXY | FCM/APNs (`app: "rider"`) |
| LIVE | `DELETE` | `/partners/me/devices/:deviceId` | 🔑🚴 PROXY | Unregister |
| LIVE | `GET` | `/partners/me/training/modules` | 🔑🚴 | Training catalog |
| LIVE | `GET` | `/partners/me/training/modules/:moduleId` | 🔑🚴 | Lessons + quiz (no answer key) |
| LIVE | `POST` | `/partners/me/training/modules/:moduleId/complete` | 🔑🚴 | Submit quiz |
| LIVE | `GET` | `/partners/me/training/certificates` | 🔑🚴 | Certificates |

### 3.9 Public zones + health (rider may call)

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/health` | 🔓 | Probe |
| LIVE | `GET` | `/health/ready` | 🔓 | Mongo + Redis |
| LIVE | `GET` | `/version` | 🔓 | Version |
| LIVE | `GET` | `/public/cities` | 🔓 | Launch cities + IST hours |
| LIVE | `GET` | `/zones` | 🔓 | Zones `?city=` required |
| LIVE | `GET` | `/zones/:zoneId` | 🔓 | Zone detail |
| LIVE | `GET` | `/zones/:zoneId/surge-status` | 🔓 | Live surge chip |

---

## 4. delivery-service — ALIAS only (do not dual-wire)

**Prefix:** `/api/v1/delivery-service`

Same LIVE handlers as §3. Calling both causes double accept / double chat / double payout request.

### 4.1 Finance aliases — `/finance`

| Status | Method | Path | Use instead |
|---|---|---|---|
| ALIAS | `GET` | `/finance/earnings/today` | `GET /partners/me/earnings` |
| ALIAS | `GET` | `/finance/earnings/week` | `GET /partners/me/earnings` |
| ALIAS | `GET` | `/finance/earnings/month` | `GET /partners/me/earnings` |
| ALIAS | `GET` | `/finance/transactions` | `GET /partners/me/wallet/transactions` |
| ALIAS | `GET` | `/finance/wallet` | `GET /partners/me/wallet` |
| ALIAS | `GET` | `/finance/payouts` | `GET /partners/me/payouts` |
| ALIAS | `GET` | `/finance/payouts/:payoutId` | `GET /partners/me/payouts/:payoutId` |
| ALIAS | `POST` | `/finance/payout/request` | `POST /partners/me/payouts/instant` |
| ALIAS | `GET` | `/finance/cash-collection` | `GET /partners/me/cod/pending` + limit-status |
| ALIAS | `GET` | `/finance/tax-summary` | `GET /partners/me/tax-documents` |

### 4.2 Communication aliases — `/communication`

| Status | Method | Path | Use instead |
|---|---|---|---|
| ALIAS | `POST` | `/communication/chat` | `POST .../deliveries/:id/chat` |
| ALIAS | `GET` | `/communication/messages/:deliveryId` | `GET .../deliveries/:id/chat` |
| ALIAS | `POST` | `/communication/call/customer` | `POST .../call/customer` |
| ALIAS | `POST` | `/communication/call/restaurant` | `POST .../call/restaurant` |
| LIVE | `GET` | `/communication/templates` | Quick-reply templates (`?audience=`) — **no `/partners/me` twin; call this** |
| LIVE | `POST` | `/communication/quick-reply` | Send template as chat (`templateId`) — **call this** |
| LIVE | `GET` | `/communication/call-history` | Masked-call history — **call this** |
| LIVE | `POST` | `/communication/report-abuse` | Report abusive chat/call — **call this** |

Templates / call-history / report-abuse are **canonical on `/communication`** (not aliases). Wire those four in the rider app.

### 4.3 Support aliases — `/support`

| Status | Method | Path | Use instead |
|---|---|---|---|
| ALIAS | `POST` | `/support/tickets` | `POST /partners/me/support/tickets` |
| ALIAS | `GET` | `/support/tickets` | `GET /partners/me/support/tickets` |
| ALIAS | `GET` | `/support/tickets/:ticketId` | `GET /partners/me/support/tickets/:ticketId` |
| ALIAS | `POST` | `/support/sos` | `POST /partners/me/sos` |
| LIVE | `POST` | `/support/report-accident` | Accident incident (`kind=accident`) — **call this** |
| LIVE | `POST` | `/support/report-fraud` | Fraud incident (`kind=fraud`) — **call this** |
| ALIAS | `GET` | `/support/help-center` | `GET /partners/me/support/faq` |
| ALIAS | `POST` | `/support/feedback` | `POST /partners/me/app/feedback` |

### 4.4 Notifications aliases — `/notifications`

Prefer §3.8 `/partners/me/notifications*`. Extra unique paths:

| Status | Method | Path | Use |
|---|---|---|---|
| ALIAS | `POST` | `/notifications/device-token` | `POST /partners/me/devices/register` |
| ALIAS | `GET` | `/notifications` | `GET /partners/me/notifications` |
| ALIAS | `PUT` | `/notifications/read/:notificationId` | `PUT /partners/me/notifications/:id/read` |
| ALIAS | `PUT` | `/notifications/read-all` | `PUT /partners/me/notifications/read-all` |
| LIVE | `DELETE` | `/notifications/:notificationId` | Delete one inbox item — **call this or notification-service** |
| LIVE | `GET` | `/notifications/unread-count` | Badge — **call this** |
| ALIAS | `PUT` | `/notifications/settings` | `PUT /partners/me/notifications/preferences` |
| ALIAS | `POST` | `/notifications/test` | **Admin only** — do not call from rider app |

### 4.5 Lifecycle aliases — `/deliveries/:deliveryId`

| Status | Method | Path | Use instead |
|---|---|---|---|
| ALIAS | `GET` | `/deliveries/:deliveryId` | `GET /partners/me/deliveries/:id` |
| ALIAS | `GET` | `/deliveries/:deliveryId/timeline` | `.../timeline` |
| ALIAS | `GET` | `/deliveries/:deliveryId/events` | `.../events` |
| ALIAS | `PUT` | `/deliveries/:deliveryId/waiting` | `.../waiting` |
| ALIAS | `PUT` | `/deliveries/:deliveryId/order-ready` | `.../order-ready` |
| ALIAS | `PUT` | `/deliveries/:deliveryId/on-the-way` | `.../on-the-way` |
| ALIAS | `PUT` | `/deliveries/:deliveryId/reached-customer` | `.../arrived-customer` |
| ALIAS | `POST` | `/deliveries/:deliveryId/verify-otp` | `.../verify-otp` |
| ALIAS | `POST` | `/deliveries/:deliveryId/upload-proof` | `POST .../proof-of-delivery` |
| ALIAS | `POST` | `/deliveries/:deliveryId/signature` | `.../signature` |
| ALIAS | `POST` | `/deliveries/:deliveryId/customer-unavailable` | `.../customer-unreachable` |
| ALIAS | `POST` | `/deliveries/:deliveryId/report-issue` | `.../report-issue` |
| ALIAS | `POST` | `/deliveries/:deliveryId/return-order` | `.../return-to-restaurant` |
| ALIAS | `POST` | `/deliveries/:deliveryId/failed` | `.../failed` |

### 4.6 Tracking aliases — `/tracking/order/:orderId/{location,eta,route}`

Same handlers as §3.3. Do **not** dual-wire with `/tracking/live-location|eta|route/:orderId`.

| Status | Method | Path | Use instead |
|---|---|---|---|
| ALIAS | `GET` | `/tracking/order/:orderId/location` | `GET /tracking/live-location/:orderId` |
| ALIAS | `GET` | `/tracking/order/:orderId/eta` | `GET /tracking/eta/:orderId` |
| ALIAS | `GET` | `/tracking/order/:orderId/route` | `GET /tracking/route/:orderId` |

---

## 5. notification-service — ALIAS (do not dual-wire inbox)

**Prefix:** `/api/v1/notification-service`

Rider inbox / devices / prefs are **proxied** on delivery-service §3.8. Direct notification-service is the same backend (`app: "rider"`). Do **not** register the token twice.

| Status | Method | Path | Use delivery-service instead |
|---|---|---|---|
| ALIAS | `GET` | `/notifications` | `GET /partners/me/notifications` |
| ALIAS | `GET` | `/notifications/unread-count` | `GET /notifications/unread-count` on delivery-service |
| ALIAS | `PUT` | `/notifications/read-all` | `PUT /partners/me/notifications/read-all` |
| ALIAS | `PUT` | `/notifications/:id/read` | `PUT /partners/me/notifications/:id/read` |
| ALIAS | `DELETE` | `/notifications/:id` | `DELETE /notifications/:id` on delivery-service |
| ALIAS | `DELETE` | `/notifications/clear-all` | (delivery façade has no clear-all; use this **only** if the rider UI needs clear-all) |
| ALIAS | `GET` | `/devices` | Partner devices via register/unregister |
| ALIAS | `POST` | `/devices/register` | `POST /partners/me/devices/register` |
| ALIAS | `DELETE` | `/devices/:deviceId` | `DELETE /partners/me/devices/:deviceId` |
| ALIAS | `GET`/`PUT` | `/preferences` | `.../notifications/preferences` |

Do **not** call `/admin/*` or `/internal/*` on notification-service.

---

## 6. Never call from delivery app

| Pattern | Who |
|---|---|
| `/api/v1/admin-service/*` | Legacy |
| `*/admin/*` | Admin panel (KYC **approve** is here — ops, not rider) |
| `*/internal/*` | Services only |
| `/api/v1/delivery-service/dispatch/*` | Dispatch engine / admin |
| `/api/v1/delivery-service/ops/*` | Ops health |
| `/api/v1/delivery-service/restaurant/*` | Kitchen fleet / handover |
| `/api/v1/delivery-service/metrics` | Internal Prometheus (`requireInternal`) |
| `/api/v1/delivery-service/tracking/order/:id/share` · nudge · tip · rate · otp · partner card · customer chat | Customer tracker |
| `/api/v1/restaurant-service/restaurants/:id/orders/*` | Kitchen KDS |
| `/api/v1/customer-service/*` | Customer app |
| `/api/v1/cart-service/*` | Customer cart |
| `/api/v1/search-service/*` | Customer search |
| `/api/v1/address-service/*` | Customer addresses (rider pin = `POST /partners/me/location`) |
| `/api/v1/order-service/orders` `POST` | Customer place-order |
| Dual-wire `/partners/me/deliveries/:id/accept` **and** `/deliveries/:id` aliases | Double accept |
| Dual-wire notification-service **and** `/partners/me/devices/register` | Double FCM |

---

## 7. Spec-only (not mounted — do not implement as missing APIs)

These appeared in older `delivery-service/remaining api.md` wish-lists. They are **not** HTTP routes in `delivery-service/src/routes`. Do **not** stub them in the app. Profile/KYC/vehicle live on `GET/PUT /partners/me` + `POST /partners/me/documents`.

| Spec path | Reality |
|---|---|
| `/auth/otp/*`, `/auth/refresh`, `/auth/logout*`, `/auth/sessions*` on delivery-service | Login/session is **user-service** §2 |
| `/auth/pin/set` · `/auth/pin/verify` on delivery-service | App-lock is client-side; login is user-service |
| `/partners/onboarding/*` | Use `GET /partners/me` + documents + bank |
| `GET /partners/me/account-status` | Status is on `GET /partners/me` (`kycStatus`, `status`) |
| `PUT /partners/me/phone` · `/email` · `/language` | User-service `PUT /users/me/phone` · `/email` · `/preferences/language` |
| `DELETE /partners/me` | User-service `DELETE /users/me` |
| `GET/PUT/DELETE /partners/me/documents/:id` · `/documents/expiring` · `.../renew` | Upload is `POST /partners/me/documents` only; status is on profile |
| `/partners/me/vehicles*` | Vehicle fields on `PUT /partners/me` |
| `/partners/me/profile-photo` | Use user-service `POST /users/me/profile-photo` |
| `/partners/me/emergency-contacts` | Emergency contact on `PUT /partners/me` |
| Batch skip-stop / dissolve / waypoints alias (`remaining api.md` §46.7 leftover) | Not mounted; use `GET/PUT .../batch/:batchId` + sequence |

---

## 8. Count (delivery-app LIVE — implement these)

| Service | Approx. rider APIs |
|---|---|
| Gateway (+ sockets) | 4 HTTP + 20 events |
| user-service | 31 |
| delivery-service canonical `/partners/me*` + register + tracking rider + public zones | **155** |
| delivery-service unique `/communication` + `/support` accident/fraud + unread-count + delete notification | **8** |

**§3 split:** onboarding/KYC/bank (15) · duty/hubs/shifts (17) · location/tracking (11 LIVE; 3 path-suffix aliases in §4.6) · trips/lifecycle/chat/calls (37) · earnings/COD (16) · incentives/performance/referrals (25) · support/SOS (17) · config/inbox/training (15) · public/health (7).

Aliases in §4 (including the three tracking path-suffix twins) are **not extra jobs**. Kitchen, admin, internal, customer tracking extras are **not** rider-app APIs.

Path-by-path check against `delivery-service/src/routes/*.ts`: **209** rider-callable mounted paths; **0** left out after §4.6.

**All of these are LIVE in code.** Cannot go online = KYC still pending (admin must approve). Empty earnings = no delivered trips. Masked call / penny-drop / instant payout need provider keys — APIs return typed `503`, they are not missing.

---

## 9. Related docs

| Doc | Use |
|---|---|
| [CUSTOMER_APP_ALL_APIS.md](CUSTOMER_APP_ALL_APIS.md) | Same layout for customer app |
| [RESTAURANT_APP_ALL_APIS.md](RESTAURANT_APP_ALL_APIS.md) | Same layout for kitchen app |
| [DELIVERY_SERVICE_APIS.md](DELIVERY_SERVICE_APIS.md) | Full delivery-service (4 clients) |
| [API_ROUTES_REFERENCE.md](API_ROUTES_REFERENCE.md#9-delivery-service) | Full platform inventory §9 |
| [API_REQUEST_RESPONSE.md](API_REQUEST_RESPONSE.md) | Request/response bodies (Availability, Assignment, Tracking, Earnings, Wallet, Bank, Incentives, Performance, Referral, Communication, Support, Rider WebSocket) |
| [delivery-service/remaining api.md](../delivery-service/remaining%20api.md) | Historical catalog — **this file wins** for what the rider app should call |
