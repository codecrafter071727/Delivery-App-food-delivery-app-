# API Request & Response Contracts

> Pair this file with [API_ROUTES_REFERENCE.md](API_ROUTES_REFERENCE.md) (route inventory).  
> After any new API ships, add the route row **and** the contract here under the matching heading.  
> **Customer app (all services, production request/response + remaining to form):** [CUSTOMER_APP_REQUEST_RESPONSE.md](CUSTOMER_APP_REQUEST_RESPONSE.md) · inventory [CUSTOMER_APP_API.md](CUSTOMER_APP_API.md)

**Gateway:** `{BASE}/api/v1/{service}`  
**Delivery:** `{BASE}/api/v1/delivery-service`  
Example: `http://192.168.x.x:4000/api/v1/delivery-service`

### Envelope

```json
{ "success": true, "message": "Location updated", "data": {} }
```

---

# COD Eligibility & Admin Rules — payment-service

Gateway prefix: `/api/v1/payment-service`. Rules are persisted in Mongo (`CodRule`,
unique by `zoneId`). Missing rules use `enabled=true`, `prepaidOnly=false`,
`maxCodAmount=5000`; this default is evaluated, not inserted.

## Check COD eligibility

**API name:** COD checkout eligibility
**Method / full path:** `GET /api/v1/payment-service/payments/cod/eligibility`
**Auth / who:** 🔑 authenticated customer; checkout payment-method screen

### Request

Headers: authenticated gateway session/JWT. No body. Use exactly one query form:

- Existing order: `?orderId=66c2...`
- Before placement: `?amount=1026&lat=28.5921&lng=77.0460&restaurantId=66r1...`

With `orderId`, payment-service loads the order through order-service internal API,
checks that `userId` owns it, and resolves `grandTotal`, delivery coordinates, and
restaurant. It then calls delivery serviceability and the restaurant internal snapshot.

### Success response `200`

Eligible:

```json
{
  "success": true,
  "message": "COD eligibility",
  "data": {
    "eligible": true,
    "maxCodAmount": 5000,
    "amount": 1026,
    "reason": null,
    "zoneId": "66z1...",
    "prepaidOnly": false
  }
}
```

# Phase B Wallet Top-up, Scheduled Place, and Tip Idempotency

## Initiate wallet top-up

**API name:** Initiate real wallet top-up
**Method / full path:** `POST /api/v1/payment-service/payments/wallet/topup`
**Auth / caller:** Bearer auth; customer app
**Headers:** `Authorization: Bearer <JWT>`, `Idempotency-Key: <8-128 character key>`, `Content-Type: application/json`
**Params / query:** none
**Body:** `{ "amount": 500, "method": "upi" }`; method is `card|upi|netbanking|wallet|emi`, amount is `> 0` and `<= 100000`.

Creates a persisted `WalletTopUp` and a real Razorpay order (`notes.kind=wallet_topup`). It never increases wallet balance before capture.

**Success `201`:**
```json
{
  "success": true,
  "message": "Top-up initiated",
  "data": {
    "paymentId": "66…",
    "amount": 500,
    "status": "pending",
    "gatewaySession": {
      "id": "order_…",
      "amount": 50000,
      "currency": "INR",
      "key_id": "rzp_…",
      "requiresGateway": true,
      "kind": "wallet_topup"
    }
  }
}
```
**Errors:** `400 IDEMPOTENCY_KEY_REQUIRED`, `409 IDEMPOTENCY_CONFLICT`, `422 VALIDATION_ERROR`, `503 GATEWAY_UNAVAILABLE`.

## Verify and credit wallet top-up

**API name:** Verify wallet top-up and retry credit
**Method / full path:** `POST /api/v1/payment-service/payments/wallet/topup/verify`
**Auth / caller:** Bearer auth; customer app after Razorpay checkout
**Headers:** `Authorization`, `Content-Type: application/json`
**Params / query:** none
**Body:** `{ "paymentId": "66…", "gatewayPaymentId": "pay_…", "gatewayOrderId": "order_…", "gatewaySignature": "hex…" }`

**Success `200`:**
```json
{
  "success": true,
  "data": {
    "paymentId": "66…",
    "amount": 500,
    "status": "paid",
    "userCredited": true
  }
}
```
If user-service is unavailable, the honest response remains `status: "paid", userCredited: false`; retrying verify safely retries credit. Razorpay `payment.captured` runs the same path.
**Errors:** `400 INVALID_SIGNATURE`, `400 GATEWAY_ORDER_MISMATCH`, `404 NOT_FOUND`, `503 GATEWAY_UNAVAILABLE`.

## Internal user wallet APIs

**API name:** Read internal wallet
**Method / full path:** `GET /api/v1/user-service/internal/users/:userId/wallet`
**Auth / caller:** `X-Internal-Key`; payment-service
**Request:** path `userId`; no body/query.
**Success `200`:** `{ "success": true, "data": { "balance": 500, "currency": "INR", "isLocked": false } }`
**Errors:** `401/403` internal auth, `404` user not found, `503 WALLET_UNAVAILABLE`.

**API name:** Read internal wallet transactions
**Method / full path:** `GET /api/v1/user-service/internal/users/:userId/wallet/transactions?page=1&limit=20`
**Auth / caller:** `X-Internal-Key`; payment-service
**Request:** path `userId`; query `page>=1`, `limit=1..MAX_LIMIT`; no body.
**Success `200`:** `{ "success": true, "data": { "data": [], "total": 0, "page": 1, "limit": 20, "totalPages": 0 } }`
**Errors:** `401/403` internal auth, `404` user not found.

**API name:** Idempotently credit paid wallet top-up
**Method / full path:** `POST /api/v1/user-service/internal/wallet/credit`
**Auth / caller:** `X-Internal-Key`; payment-service webhook/verify
**Request:** no params/query; body `{ "userId": "66…", "amount": 500, "source": "topup", "referenceId": "pay_…", "referenceType": "payment", "description": "Wallet top-up" }`
**Success `200`:** `{ "success": true, "data": { "balance": 500, "currency": "INR", "isLocked": false } }`. Reusing the same `source + referenceId` returns current wallet without another credit.
**Errors:** `403 WALLET_LOCKED`, `404` user not found, `422` validation, `500 WALLET_CREDIT_FAILED`.

**API name:** Idempotently debit wallet at checkout  
**Method / full path:** `POST /api/v1/user-service/internal/wallet/debit`  
**Auth / caller:** `X-Internal-Key`; order-service on COD/full-wallet place or after online verify  
**Body:** `{ "userId": "66…", "amount": 120, "source": "order_payment", "referenceId": "order_payment:66…", "referenceType": "order", "description": "Order … wallet debit" }`  
**Success `200`:** `{ "success": true, "data": { "balance": 380, "currency": "INR", "isLocked": false } }`. Same `source + referenceId` replays without a second debit (Mongo transaction + `$gte` atomic decrement).  
**Errors:** `400 WALLET_INSUFFICIENT`, `403 WALLET_LOCKED`, `404` user not found, `422` validation.

`POST /api/v1/user-service/users/me/wallet/add` no longer credits directly and always returns `400 USE_PAYMENT_TOPUP`.

## OTP resend

**API name:** Resend login/register OTP  
**Method / full path:** `POST /api/v1/user-service/auth/otp/resend`  
**Auth / caller:** 🔓 public; customer app login  
**Body:** `{ "identifier": "+919876543210" | "user@mail.com", "purpose": "login"|"register"|"forgot_password"|"update_phone"|"delete_account" }`

Same purposes as `POST /auth/otp/send`. Cooldown 30s (`OTP_COOLDOWN`), max 5 / 15 min (`OTP_RATE_LIMITED`). Phone OTP is sent via notification-service `/internal/channels/sms`, else Twilio, else MSG91. Never returns the OTP. Unconfigured SMS → `503 SMS_UNAVAILABLE` (never log-and-succeed).

**Success `200`:** `{ "cooldownSeconds": 30 }`

**Errors:** `429 OTP_COOLDOWN` · `429 OTP_RATE_LIMITED` · `503 SMS_UNAVAILABLE` · `422` validation

## Social login — Google

**API name:** Google social login  
**Method / full path:** `POST /api/v1/user-service/auth/social/google`  
**Auth / caller:** 🔓 public; customer app  
**Body:** `{ "idToken": "<Google ID token>", "source"?: "web"|"ios"|"android", "deviceId"?: "..." }`

Verifies `idToken` with Google tokeninfo (`aud` must match `GOOGLE_CLIENT_IDS`). Links or creates customer (`googleId`), sets `_sid`. Never trusts client claims without Google.

**Success `200`:** same envelope as password login (`user` + `_sid` cookie).

**Errors:** `401 SOCIAL_TOKEN_INVALID` · `403 ACCOUNT_SUSPENDED` · `409 SOCIAL_ACCOUNT_CONFLICT` · `503 SOCIAL_AUTH_UNAVAILABLE` · `422` validation

## Social login — Apple

**API name:** Apple social login  
**Method / full path:** `POST /api/v1/user-service/auth/social/apple`  
**Auth / caller:** 🔓 public; customer / iOS app  
**Body:** `{ "identityToken": "<Apple JWT>", "authorizationCode"?: "...", "firstName"?: "...", "lastName"?: "...", "email"?: "...", "source"?: "web"|"ios"|"android", "deviceId"?: "..." }`

Verifies JWT against Apple JWKS (`iss=https://appleid.apple.com`, `aud` in `APPLE_CLIENT_IDS`). Name/email from Apple (first login) or body. Sets `_sid`.

**Success `200`:** same envelope as password login.

**Errors:** `401 SOCIAL_TOKEN_INVALID` · `403 ACCOUNT_SUSPENDED` · `409 SOCIAL_ACCOUNT_CONFLICT` · `503 SOCIAL_AUTH_UNAVAILABLE` · `422` validation

## Delete account preview

**API name:** Preview account deletion  
**Method / full path:** `GET /api/v1/user-service/users/me/delete-preview`  
**Auth / caller:** 🔑 customer  

**Success `200`:**

```json
{
  "openOrders": 1,
  "walletBalance": 12.5,
  "activeSubscription": false,
  "canDelete": false,
  "warn": "You have an active order. Finish or cancel before delete."
}
```

`openOrders` from order-service `GET /orders/internal/users/:userId/open-count` (active + future scheduled). `activeSubscription` from customer `GET /internal/subscriptions/:userId` (false if customer-service down).  
`DELETE /users/me` → `409 ACCOUNT_HAS_OPEN_ORDERS` when `openOrders > 0`. Order-service down → `503 ORDER_SERVICE_UNAVAILABLE` (fail-closed).

## Place scheduled order

**API name:** Place order with schedule enforcement
**Method / full path:** `POST /api/v1/order-service/orders`
**Auth / caller:** Bearer auth; customer app
**Headers:** `Authorization`, `Idempotency-Key`, `Content-Type: application/json`
**Request:** existing place-order body; optional `isScheduled` and ISO `scheduledFor`. The validated cart schedule is authoritative when the client omits scheduling fields.
**Success:** existing place-order DTO includes `isScheduled: true` and persisted `scheduledFor`. Scheduled slots must be at least 45 minutes in the future. `acceptBy` is not started until the slot becomes due.
**Errors:** existing place-order errors plus `400 SLOT_UNAVAILABLE`.
When a delivery order becomes ready, assignment is retried immediately three times, then from a Mongo job every 60 seconds with backoff, up to eight attempts.

## Add delivery tip idempotently

**API name:** Increase delivery tip
**Method / full path:** `POST /api/v1/delivery-service/tracking/order/:orderId/tip`
**Auth / caller:** Bearer auth; owning customer/admin
**Headers:** `Authorization`, required `Idempotency-Key`, `Content-Type: application/json`
**Request:** path `orderId`; no query; body `{ "tipAmount": 75 }`
**Success `200`:**
```json
{
  "success": true,
  "message": "Tip updated",
  "data": {
    "orderId": "66…",
    "deliveryId": "66…",
    "tipAmount": 75,
    "previousTip": 50,
    "creditedNow": true,
    "syncedOrder": true
  }
}
```
The response is cached for 24 hours. Same key and amount replays it; a different amount returns `409 IDEMPOTENCY_CONFLICT`. A Redis lock prevents concurrent delivered-tip earnings credits.
**Errors:** `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 DELIVERY_NOT_FOUND`, `409 IDEMPOTENCY_CONFLICT`, `409 IDEMPOTENCY_IN_PROGRESS`, `409 ILLEGAL_TRANSITION`, `422 IDEMPOTENCY_KEY_REQUIRED`, `422 INVALID_TIP`.

# COD Eligibility & Admin Rules — continued

Business rejection is also `200` so the app can hide COD:

```json
{
  "success": true,
  "message": "COD eligibility",
  "data": {
    "eligible": false,
    "maxCodAmount": 5000,
    "amount": 6200,
    "reason": "COD_LIMIT",
    "zoneId": "66z1...",
    "prepaidOnly": false
  }
}
```

`reason`: `OUT_OF_ZONE`, `ZONE_RAIN`, `ZONE_CLOSED`, `OUTSIDE_HOURS`,
`ZONE_PREPAID_ONLY`, `ZONE_COD_DISABLED`, `COD_LIMIT`, or `RESTAURANT_COD_OFF`.
Rain/closed/out-of-zone never returns `eligible:true`.

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No authenticated customer |
| 403 | `FORBIDDEN` | `orderId` belongs to another user |
| 404 | `ORDER_NOT_FOUND` / `RESTAURANT_NOT_FOUND` | Referenced resource missing |
| 409 | `ORDER_CHECKOUT_INCOMPLETE` | Order lacks total, restaurant, or drop coordinates |
| 422 | `VALIDATION_ERROR` | Neither complete query form was supplied |
| 503 | `ORDER_SERVICE_UNAVAILABLE` | Order lookup unavailable |
| 503 | `DELIVERY_SERVICE_UNAVAILABLE` | Serviceability unavailable or malformed |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` | Restaurant setting unavailable or malformed |

## List COD rules

**API name:** Admin COD rules list
**Method / full path:** `GET /api/v1/payment-service/admin/cod/rules`
**Auth / who:** 🔐 admin; admin panel
**Request:** authenticated admin headers; no params, query, or body.

**Success response `200`:**

```json
{
  "success": true,
  "message": "COD rules",
  "data": [{
    "_id": "66cr...",
    "zoneId": "66z1...",
    "enabled": true,
    "prepaidOnly": false,
    "maxCodAmount": 5000,
    "createdAt": "2026-08-13T03:00:00.000Z",
    "updatedAt": "2026-08-13T03:00:00.000Z"
  }]
}
```

Errors: `401 UNAUTHORIZED`, `403 FORBIDDEN`.

## Upsert COD rule

**API name:** Admin update per-zone COD rule
**Method / full path:** `PUT /api/v1/payment-service/admin/cod/rules/:zoneId`
**Auth / who:** 🔐 admin; admin panel

### Request

Path param: `zoneId`. Header `Content-Type: application/json`.

```json
{ "maxCodAmount": 5000, "prepaidOnly": false, "enabled": true }
```

All fields are required. `maxCodAmount` is `0..1000000`. The write is an atomic Mongo
upsert against the unique zone key.

**Success response `200`:** `data` is the persisted rule document in the same shape
as the list item. Message: `COD rule updated`.

Errors: `401 UNAUTHORIZED`, `403 FORBIDDEN`, `422 VALIDATION_ERROR`.

```json
{ "success": false, "message": "You cannot track this order", "code": "FORBIDDEN" }
```

### Auth (apps)

| Header / cookie | When |
|---|---|
| Cookie `_sid` | Logged-in rider / customer / restaurant / admin |
| `x-csrf-token` | POST / PUT / DELETE through the gateway |
| `x-internal-key` | Internal routes only (not mobile apps) |

**Socket.IO auth:** do not send raw `userId` alone. Use `_sid` cookie (credentials), `auth.sid` / `auth.sessionId`, mint `POST /api/v1/socket-token` → `auth.socketToken` (TTL 10 min), or guest share-track `auth.shareToken` (delivery share link; joins only that `order:{orderId}`). `order:cancelled` fires alongside `order:status` when cancelled; `tracking:location` aliases `partner:location`.

### Shared types

**PartnerLiveLocation**

```json
{
  "partnerId": "66a9...",
  "latitude": 28.6139,
  "longitude": 77.2090,
  "heading": 180,
  "speed": 22.5,
  "accuracy": 12,
  "updatedAt": "2026-08-08T14:30:00.120Z",
  "ageSeconds": 0,
  "stale": false,
  "source": "redis",
  "lowAccuracy": false
}
```

`source`: `redis` | `mongo`  
`stale`: true if GPS older than 20s.

**Delivery status:** `assigned` | `accepted` | `arrived_at_restaurant` | `picked_up` | `out_for_delivery` | `arrived_at_customer` | `returning_to_restaurant` | `returned` | `delivered` | `cancelled` | `reassigned`

**Maps `provider`:** `google` | `haversine`

---

# Availability APIs

Duty, break, shifts, attendance.  
Service: **delivery-service**. Auth: 🔑 + 🚴. Break/shift windows use **Asia/Kolkata**.

Shared **PartnerDutyStatus** (`data` on status / break / go-online.status / go-offline.status):

```json
{
  "dutyStatus": "online",
  "isOnline": true,
  "isAvailable": true,
  "accountStatus": "active",
  "onlineSince": "2026-08-08T03:30:00.000Z",
  "lastOfflineAt": null,
  "zoneId": "66z1...",
  "activeDeliveryId": null,
  "break": {
    "active": false,
    "startedAt": null,
    "elapsedMinutes": 0,
    "minutesUsedToday": 15,
    "minutesRemainingToday": 45,
    "maxMinutesPerDay": 60,
    "maxSingleMinutes": 30,
    "defaultMinutes": 15,
    "expiresAt": null
  },
  "hub": { "hubId": null, "checkedInAt": null }
}
```

`dutyStatus`: `offline` | `online` | `on_delivery` | `on_break` | `on_way_to_hub`.

Also on **PartnerDutyStatus**: `hub.hubId` / `hub.checkedInAt`, and `break.expiresAt` (ISO) while on break.

---

## Go online

**API name:** Go online  
**Method / path:** `PUT /partners/me/go-online`  
**Who:** Rider. KYC must be `active`. GPS required.

### Request

```json
{ "latitude": 28.6139, "longitude": 77.2090, "zoneId": "66z1..." }
```

`zoneId` optional — inferred from pin if omitted.

### Success response `200`

```json
{
  "success": true,
  "message": "You are now online",
  "data": { "partner": { }, "status": { } }
}
```

`status` is **PartnerDutyStatus**. `partner` is the partner profile row.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `PARTNER_NOT_ACTIVE` | KYC not live |
| 409 | `ACTIVE_DELIVERY` | On a trip |
| 404 | `PARTNER_NOT_FOUND` | No profile |

---

## Go offline

**API name:** Go offline  
**Method / path:** `PUT /partners/me/go-offline`  
**Who:** Rider. Blocked while on an active trip.

### Request

No body.

### Success response `200`

Same envelope as go-online (`partner` + **PartnerDutyStatus**). Message: `You are now offline`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ACTIVE_DELIVERY` | Finish or cancel trip first |

---

## Duty status

**API name:** Get duty status  
**Method / path:** `GET /partners/me/status`  
**Who:** Rider.

### Success response `200`

`data` is **PartnerDutyStatus**.

---

## Set duty status

**API name:** Explicit duty set  
**Method / path:** `PUT /partners/me/status`  
**Who:** Rider. CSRF. Cannot set `on_delivery` (trip-owned).

### Request

```json
{ "dutyStatus": "online", "latitude": 28.6139, "longitude": 77.2090, "durationMinutes": 15 }
```

| `dutyStatus` | Notes |
|---|---|
| `online` | Same as go-online; lat/lng required |
| `offline` | Same as go-offline; blocked on active trip |
| `on_break` | Same as break/start; optional `durationMinutes` |
| `on_way_to_hub` | Heading to hub; must already be online, no active trip |

### Success `200`

`data` is **PartnerDutyStatus**.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ACTIVE_DELIVERY` / `PARTNER_OFFLINE` / `BREAK_LIMIT_EXCEEDED` | Same as go-online / break |
| 422 | `LOCATION_REQUIRED` | Online without GPS |

---

## Duty summary (today)

**API name:** IST-today duty summary  
**Method / path:** `GET /partners/me/duty-summary`  
**Who:** Rider.

### Success `200`

```json
{
  "success": true,
  "message": "Duty summary",
  "data": {
    "date": "2026-08-10",
    "dutyStatus": "online",
    "onlineMinutes": 214,
    "onlineHours": 3.57,
    "deliveries": 8,
    "km": 42.3,
    "breakMinutes": 15,
    "stillOnDuty": true
  }
}
```

`km` = sum of `actualDistance` on delivered trips today. `deliveries` from IST earnings ledger (fallback delivered count).

---

## Extend break

**API name:** Extend current break  
**Method / path:** `POST /partners/me/break/extend`  
**Who:** Rider. CSRF.

### Request

```json
{ "additionalMinutes": 10 }
```

Optional; default 10. Cap: startedAt + 30 min single, and remaining daily quota.

### Success `200`

`data` is **PartnerDutyStatus** with later `break.expiresAt`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `NOT_ON_BREAK` | No active break |
| 409 | `BREAK_MAX_REACHED` / `BREAK_LIMIT_EXCEEDED` | Caps |

---

## Break policy

**API name:** Allowed break minutes  
**Method / path:** `GET /partners/me/break/policy`  
**Who:** Rider.

### Success `200`

```json
{
  "success": true,
  "message": "Break policy",
  "data": {
    "maxMinutesPerDay": 60,
    "maxSingleMinutes": 30,
    "defaultMinutes": 15,
    "extendDefaultMinutes": 10,
    "minOnlineMinutesBefore": 10,
    "timezone": "Asia/Kolkata"
  }
}
```

---

## Nearby hubs

**API name:** Nearest hubs / cash-drop  
**Method / path:** `GET /partners/me/hub/nearby`  
**Who:** Rider. Query `?lat=&lng=` optional (else last GPS).

### Success `200`

```json
{
  "success": true,
  "message": "Nearby hubs",
  "data": [
    {
      "hubId": "66h1...",
      "name": "Dwarka Hub",
      "city": "Delhi",
      "kind": "hub",
      "address": "Sector 12",
      "latitude": 28.59,
      "longitude": 77.04,
      "radiusMeters": 150,
      "distanceMeters": 420,
      "isActive": true
    }
  ]
}
```

Empty list if none nearby (not faked). `kind`: `hub` \| `dark_store` \| `cash_drop`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `LOCATION_REQUIRED` | No GPS |

---

## Hub check-in

**API name:** Check in at hub  
**Method / path:** `POST /partners/me/hub/check-in`  
**Who:** Rider. CSRF. Geofence = hub `radiusMeters` (default 150 m).

### Request

```json
{ "hubId": "66h1...", "latitude": 28.592, "longitude": 77.046 }
```

### Success `200`

```json
{
  "success": true,
  "message": "Checked in at hub",
  "data": { "hub": { }, "status": { } }
}
```

`status.dutyStatus` → `on_way_to_hub`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `HUB_NOT_FOUND` | Unknown / inactive hub |
| 409 | `HUB_GEOFENCE` | Too far |
| 409 | `ACTIVE_DELIVERY` | On a trip (unless returning to restaurant) |

---

## Hub check-out

**API name:** Leave hub  
**Method / path:** `POST /partners/me/hub/check-out`  
**Who:** Rider. CSRF.

### Success `200`

`data` is **PartnerDutyStatus** (`online`).

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `NOT_AT_HUB` | Not checked in |
| 409 | `ACTIVE_DELIVERY` | Still on a trip |

---

## Start break

**API name:** Start break  
**Method / path:** `PUT /partners/me/break/start`  
**Who:** Rider. Must be online, not on a trip. Max **30 min** single / **60 min** per IST day. Need ≥ 10 min online first.

### Request

```json
{ "durationMinutes": 15 }
```

`durationMinutes` optional (default 15, max 30).

### Success response `200`

`data` is **PartnerDutyStatus** with `dutyStatus: "on_break"`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `PARTNER_OFFLINE` | Go online first |
| 409 | `ACTIVE_DELIVERY` | On a trip |
| 409 | `ALREADY_ON_BREAK` | Already on break |
| 409 | `BREAK_LIMIT_EXCEEDED` | Daily 60 min quota |
| 409 | `BREAK_TOO_EARLY` | Not online ≥ 10 min |

---

## End break

**API name:** End break  
**Method / path:** `PUT /partners/me/break/end`  
**Who:** Rider.

### Request

No body.

### Success response `200`

**PartnerDutyStatus** with `dutyStatus: "online"`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `NOT_ON_BREAK` | Not on break |

---

## List shifts

**API name:** List shift slots  
**Method / path:** `GET /partners/me/shifts`  
**Who:** Rider.

### Request query

| Query | Required | Notes |
|---|---|---|
| `from` / `to` | no | IST `YYYY-MM-DD`, default next 7 days |

### Success response `200`

`data` is an array of **ShiftSlotView**:

```json
{
  "id": "66s1...",
  "zoneId": "66z1...",
  "date": "2026-08-09",
  "label": "dinner",
  "startAt": "2026-08-09T12:30:00.000Z",
  "endAt": "2026-08-09T16:30:00.000Z",
  "capacity": 50,
  "bookedCount": 12,
  "spotsLeft": 38,
  "guaranteedHours": 4,
  "incentiveAmount": 50,
  "status": "open",
  "bookedByMe": false,
  "canBook": true,
  "canCancel": false
}
```

---

## Book shift

**API name:** Book a shift  
**Method / path:** `POST /partners/me/shifts/:shiftId/book`  
**Who:** Rider. KYC active.

### Success response `200`

```json
{
  "success": true,
  "message": "Shift booked",
  "data": { "shift": { }, "bookingId": "66b9..." }
}
```

`shift` is **ShiftSlotView**.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `PARTNER_NOT_ACTIVE` | KYC not live |
| 400 | `ZONE_REQUIRED` | Go online once so we know your zone |
| 409 | `SHIFT_FULL` | No spots |
| 409 | `SHIFT_ALREADY_BOOKED` | Already booked this slot |
| 409 | `SHIFT_OVERLAP` | Overlapping booking |
| 409 | `SHIFT_CLOSED` | Slot not open |
| 409 | `SHIFT_ALREADY_STARTED` | Start time passed |
| 404 | `SHIFT_NOT_FOUND` | Bad id |

---

## Cancel shift booking

**API name:** Cancel shift booking  
**Method / path:** `DELETE /partners/me/shifts/:shiftId`  
**Who:** Rider. Must cancel ≥ **2 hours** before start.

### Success response `200`

`data` is the cancelled booking row. Message: `Shift booking cancelled`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `SHIFT_CANCEL_WINDOW_CLOSED` | Inside 2 h window |
| 409 | `SHIFT_ALREADY_STARTED` | Shift already started |
| 404 | `BOOKING_NOT_FOUND` | No booking |
| 404 | `SHIFT_NOT_FOUND` | Bad id |

---

## Attendance log

**API name:** Attendance log  
**Method / path:** `GET /partners/me/attendance`  
**Who:** Rider.

### Request query

`from` / `to` optional IST `YYYY-MM-DD`.

### Success response `200`

```json
{
  "from": "2026-08-01",
  "to": "2026-08-08",
  "days": [
    {
      "date": "2026-08-08",
      "loginAt": "2026-08-08T03:30:00.000Z",
      "logoutAt": null,
      "onlineMinutes": 240,
      "breakMinutes": 15,
      "stillOnDuty": true
    }
  ],
  "totals": { "onlineMinutes": 240, "breakMinutes": 15, "daysWorked": 1 }
}
```

---

## Attendance streak

**API name:** Attendance streak  
**Method / path:** `GET /partners/me/attendance/streak`  
**Who:** Rider.

### Success response `200`

```json
{ "currentStreak": 4, "todayCounted": true, "lastWorkedDate": "2026-08-08" }
```

---

## Admin create shift

**API name:** Create shift slot  
**Method / path:** `POST /admin/shifts`  
**Who:** Admin.

### Request

```json
{
  "zoneId": "66z1...",
  "startAt": "2026-08-09T12:30:00.000Z",
  "endAt": "2026-08-09T16:30:00.000Z",
  "label": "dinner",
  "capacity": 50,
  "guaranteedHours": 4,
  "incentiveAmount": 50
}
```

### Success response `201`

Created shift document. Message: `Shift created`.

---

# Tracking APIs

Location, live map, ETA, route, heartbeat, geofence.  
Service: **delivery-service**.

| API name | Method | Path | Who |
|---|---|---|---|
| Push GPS | `POST` | `/partners/me/location` | Rider |
| Last location | `GET` | `/partners/me/location/last` | Rider |
| Home location | `PUT` | `/partners/me/home-location` | Rider |
| Demand heatmap | `GET` | `/partners/me/nearby-orders-heatmap` | Rider |
| GPS heartbeat | `POST` | `/tracking/gps-heartbeat` | Rider |
| Location history | `GET` | `/tracking/location-history/:deliveryId` | Rider (assigned trip) |
| Track order | `GET` | `/tracking/order/:orderId` | Customer / assigned rider / admin |
| Live location | `GET` | `/tracking/live-location/:orderId` | Customer / assigned rider / admin |
| ETA | `GET` | `/tracking/eta/:orderId` | Customer / assigned rider / admin |
| Route | `GET` | `/tracking/route/:orderId` | Customer / assigned rider / admin |
| Tracking status | `GET` | `/tracking/status/:deliveryId` | Customer / assigned rider / admin |
| Kitchen partner | `GET` | `/restaurant/orders/:orderId/partner` | Restaurant |
| Kitchen handover display | `GET` | `/restaurant/orders/:orderId/handover` | Restaurant |
| Kitchen handover confirm | `PUT` | `/restaurant/orders/:orderId/handover` | Restaurant |
| Kitchen call customer | `POST` | `/restaurant/orders/:orderId/call-customer` | Restaurant |
| Recalculate route | `POST` | `/tracking/recalculate-route` | Internal |
| Geofence status | `GET` | `/tracking/geofence-status/:deliveryId` | Internal |
| Remaining distance | `GET` | `/tracking/distance/:deliveryId` | Internal |
| Rider snippet | `GET` | `/tracking/order/:orderId/partner` | Customer (owner) / admin |
| Create share link | `POST` | `/tracking/order/:orderId/share` | Customer (owner) / admin |
| Public share track | `GET` | `/tracking/share/:shareToken` | Public |
| Revoke share | `DELETE` | `/tracking/order/:orderId/share` | Customer (owner) / admin |
| Nudge rider | `POST` | `/tracking/order/:orderId/nudge-partner` | Customer (owner) / admin |
| Call rider | `POST` | `/tracking/order/:orderId/contact-partner` | Customer (owner) / admin |
| Contact support | `POST` | `/tracking/order/:orderId/contact-support` | Customer (owner) / admin |
| Drop instructions | `PUT` | `/tracking/order/:orderId/delivery-instructions` | Customer (owner) / admin |
| Contactless | `PUT` | `/tracking/order/:orderId/contactless` | Customer (owner) / admin |
| Address change | `PUT` | `/tracking/order/:orderId/address-change` | Customer (owner) / admin |
| Add tip | `POST` | `/tracking/order/:orderId/tip` | Customer (owner) / admin |
| Rate rider | `POST` | `/tracking/order/:orderId/rate-partner` | Customer (owner) / admin |
| Drop OTP | `GET` | `/tracking/order/:orderId/otp` | Customer (owner) / admin |

Restaurant **must not** call `/tracking/order/*` (returns `403 FORBIDDEN`). Use kitchen partner + sockets.

Aliases (same handlers as live / eta / route):  
`GET /tracking/order/:orderId/location` · `/eta` · `/route`

Customer post-order (`§46.2`) uses **CustomerTrackingService**. Owner check is order-service batch `userId` — **503 `ORDER_SERVICE_UNAVAILABLE`** if down (never fake allow). Share DTO never includes OTP or full phone.

---

## Push GPS

**API name:** Push real-time GPS location  
**Method / path:** `POST /partners/me/location`  
**Auth:** 🔑 Auth 🚴 Partner  
**Who:** Rider app (every ~4s on trip)

### Request

```json
{
  "latitude": 28.6139,
  "longitude": 77.2090,
  "heading": 180,
  "speed": 22.5,
  "accuracy": 12,
  "isMock": false,
  "timestamp": "2026-08-08T14:30:00.000Z"
}
```

| Field | Required | Notes |
|---|---|---|
| `latitude` | yes | -90 … 90 |
| `longitude` | yes | -180 … 180 |
| `heading` | no | 0 … 360 |
| `speed` | no | km/h, 0 … 200 |
| `accuracy` | no | meters, 0 … 5000 |
| `isMock` | no | `true` → 403 `MOCK_LOCATION` |
| `timestamp` | no | ISO string |

### Success response `200`

```json
{
  "success": true,
  "message": "Location updated",
  "data": {
    "accepted": true,
    "throttled": false,
    "recordedAt": "2026-08-08T14:30:00.120Z",
    "nextPingAfterMs": 4000,
    "staleAfterMs": 20000,
    "activeDeliveryId": "66b1...",
    "lowAccuracy": false,
    "location": { }
  }
}
```

`location` is **PartnerLiveLocation**. If ping is too fast, `throttled: true` and last point is reused. Message may be `"Location accepted (throttled)"`.

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Not logged in |
| 403 | `MOCK_LOCATION` | Mock GPS or impossible jump |
| 409 | `PARTNER_OFFLINE` | Not online |

---

## Last location

**API name:** Get last recorded location  
**Method / path:** `GET /partners/me/location/last`  
**Auth:** 🔑 Auth 🚴 Partner  
**Who:** Rider (debug / support)

### Request

No body. No query.

### Success response `200`

```json
{
  "success": true,
  "message": "Last location",
  "data": { }
}
```

`data` is **PartnerLiveLocation**.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `LOCATION_NOT_FOUND` | Never pinged |

---

## Home location

**API name:** Set / update home (base) location  
**Method / path:** `PUT /partners/me/home-location`  
**Auth:** 🔑 Auth 🚴 Partner  
**Who:** Rider (onboarding / settings)

### Request

```json
{
  "latitude": 28.61,
  "longitude": 77.20,
  "address": "Dwarka Sec 12",
  "zoneId": "66aa..."
}
```

| Field | Required |
|---|---|
| `latitude` | yes |
| `longitude` | yes |
| `address` | no, max 300 |
| `zoneId` | no — auto-resolved from point if omitted |

### Success response `200`

```json
{
  "success": true,
  "message": "Home location saved",
  "data": {
    "latitude": 28.61,
    "longitude": 77.20,
    "address": "Dwarka Sec 12",
    "zoneId": "66aa...",
    "updatedAt": "2026-08-08T14:00:00.000Z"
  }
}
```

---

## Demand heatmap

**API name:** Nearby orders heatmap  
**Method / path:** `GET /partners/me/nearby-orders-heatmap`  
**Auth:** 🔑 Auth 🚴 Partner  
**Who:** Rider (go-online / idle map)

### Request

No body. Uses live GPS, else home location.

### Success response `200`

```json
{
  "success": true,
  "message": "Nearby demand heatmap",
  "data": {
    "origin": { "latitude": 28.6139, "longitude": 77.2090 },
    "radiusKm": 8,
    "generatedAt": "2026-08-08T14:30:00.000Z",
    "zones": [
      {
        "zoneId": "66aa...",
        "name": "Connaught Place",
        "city": "Delhi",
        "latitude": 28.63,
        "longitude": 77.22,
        "distanceKm": 1.4,
        "surgeMultiplier": 1.2,
        "activePartners": 12,
        "openDeliveries": 5,
        "demandScore": 48,
        "intensity": "high"
      }
    ],
    "cells": [
      { "latitude": 28.62, "longitude": 77.21, "demand": 3, "intensity": "medium" }
    ]
  }
}
```

`intensity`: `low` | `medium` | `high` | `very_high`

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `LOCATION_REQUIRED` | No GPS and no home location |

---

## GPS heartbeat

**API name:** Periodic GPS heartbeat  
**Method / path:** `POST /tracking/gps-heartbeat`  
**Auth:** 🔑 Auth 🚴 Partner  
**Who:** Rider (~15s idle, ~4s on trip)

### Request

Empty `{}` refreshes Redis TTL only. Lat/lng must be sent together.

```json
{
  "latitude": 28.6139,
  "longitude": 77.2090,
  "heading": 90,
  "speed": 18,
  "accuracy": 10,
  "isMock": false,
  "timestamp": "2026-08-08T14:30:05.000Z"
}
```

### Success response `200`

```json
{
  "success": true,
  "message": "Heartbeat ok",
  "data": {
    "alive": true,
    "heartbeatAt": "2026-08-08T14:30:05.000Z",
    "nextHeartbeatMs": 4000,
    "onDelivery": true,
    "activeDeliveryId": "66b1...",
    "location": { }
  }
}
```

`location` is **PartnerLiveLocation** or `null`. `nextHeartbeatMs`: `4000` on trip, `15000` idle.

### Errors

Same as Push GPS (`PARTNER_OFFLINE`, `MOCK_LOCATION`). `422` if only one of lat/lng is sent.

---

## Location history

**API name:** Retrieve GPS history  
**Method / path:** `GET /tracking/location-history/:deliveryId`  
**Auth:** 🔑 Auth 🚴 Partner  
**Who:** Rider — **assigned delivery only**

### Request

Path param: `deliveryId` (Mongo ObjectId).

### Success response `200`

```json
{
  "success": true,
  "message": "Location history",
  "data": {
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "status": "out_for_delivery",
    "count": 24,
    "polyline": "encoded...",
    "points": [
      {
        "latitude": 28.61,
        "longitude": 77.20,
        "timestamp": "2026-08-08T14:10:00.000Z",
        "speed": 18
      }
    ]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `FORBIDDEN` | Not your delivery |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Track order

**API name:** Track delivery progress  
**Method / path:** `GET /tracking/order/:orderId`  
**Auth:** 🔑 Auth  
**Who:** Customer (order owner), assigned rider, admin

### Request

Path param: `orderId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Order tracking",
  "data": {
    "orderId": "66c2...",
    "deliveryId": "66b1...",
    "status": "out_for_delivery",
    "dutyHint": "Out for delivery",
    "etaSeconds": 720,
    "etaAt": "2026-08-08T14:42:00.000Z",
    "distanceMeters": 2400,
    "polyline": "google_or_haversine_encoded",
    "pickup": { "latitude": 28.62, "longitude": 77.21 },
    "drop": { "latitude": 28.61, "longitude": 77.20, "address": "House 12, Dwarka" },
    "riderLocation": { },
    "partner": {
      "partnerId": "66a9...",
      "name": "Rahul S.",
      "photo": "https://...",
      "vehicleType": "motorcycle",
      "vehicleNumber": "DL*123",
      "rating": 4.8,
      "phoneMasked": "******3210"
    },
    "geofence": {
      "pickupMeters": 150,
      "dropMeters": 100,
      "atPickup": false,
      "atDrop": false
    },
    "provider": "google",
    "trafficFactor": 1.15,
    "durationInTraffic": true
  }
}
```

`riderLocation` is **PartnerLiveLocation** or `null`. Customer sees masked name / phone / plate.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `FORBIDDEN` | Not owner / not assigned rider |
| 404 | `DELIVERY_NOT_FOUND` | No delivery for order |
| 409 | `TRACKING_INCOMPLETE` | Missing pickup/drop pins |

---

## Live location

**API name:** Get rider live GPS  
**Method / path:** `GET /tracking/live-location/:orderId`  
**Auth:** 🔑 Auth  
**Who:** Customer / assigned rider / admin

### Request

Path param: `orderId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Live location",
  "data": { }
}
```

`data` is **PartnerLiveLocation**.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `FORBIDDEN` | Not allowed to track |
| 404 | `LOCATION_NOT_FOUND` | Rider has not pinged yet |
| 404 | `DELIVERY_NOT_FOUND` | No delivery |

---

## ETA

**API name:** Get latest ETA  
**Method / path:** `GET /tracking/eta/:orderId`  
**Auth:** 🔑 Auth  
**Who:** Customer / assigned rider / admin

### Request

Path param: `orderId`.

### Success response `200`

```json
{
  "success": true,
  "message": "ETA",
  "data": {
    "orderId": "66c2...",
    "etaSeconds": 720,
    "etaAt": "2026-08-08T14:42:00.000Z",
    "distanceMeters": 2400,
    "trafficFactor": 1.15,
    "destination": "customer",
    "provider": "google",
    "durationInTraffic": true
  }
}
```

`destination`: `restaurant` | `customer` | `arrived`  
When `arrived`, `etaSeconds` is `0`. Google live traffic when `GOOGLE_MAPS_API_KEY` is set; else `provider: "haversine"`.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `FORBIDDEN` | Not allowed |
| 409 | `LOCATION_REQUIRED` | No rider GPS |

---

## Route

**API name:** Get current navigation route  
**Method / path:** `GET /tracking/route/:orderId`  
**Auth:** 🔑 Auth  
**Who:** Customer / assigned rider / admin

### Request

Path param: `orderId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Route",
  "data": {
    "orderId": "66c2...",
    "polyline": "encoded...",
    "points": [
      { "latitude": 28.615, "longitude": 77.208 },
      { "latitude": 28.61, "longitude": 77.20 }
    ],
    "distanceMeters": 2400,
    "etaSeconds": 720,
    "destination": { "latitude": 28.61, "longitude": 77.20, "kind": "customer" },
    "trafficFactor": 1.15,
    "provider": "google",
    "durationInTraffic": true
  }
}
```

Draw `polyline` on the map SDK.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `TRACKING_COMPLETE` | Already delivered |
| 409 | `TRACKING_INCOMPLETE` | Not enough points |
| 409 | `LOCATION_REQUIRED` | (ETA path) no GPS |

---

# Customer tracking & post-order

Owner-only tracker extras (`§46.2`). Auth: cookie `_sid` + CSRF on mutating. Admin/super_admin allowed. Restaurant → `403 FORBIDDEN`. Order-service down on owner check → `503 ORDER_SERVICE_UNAVAILABLE`.

Common errors unless noted: `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 DELIVERY_NOT_FOUND`, `404 ORDER_NOT_FOUND`, `503 ORDER_SERVICE_UNAVAILABLE`.

---

## Customer delivery chat

### Get chat thread

**API name:** Customer tracking chat thread
**Method / full path:** `GET /api/v1/delivery-service/tracking/order/:orderId/chat`
**Auth / who:** 🔑 authenticated order owner (customer app)

**Request:** signed session/JWT through gateway; path param `orderId`; optional query
`limit=1..100` (default `50`). No body.

**Success response `200`:**

```json
{
  "success": true,
  "message": "Chat thread",
  "data": {
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "status": "out_for_delivery",
    "count": 2,
    "messages": [{
      "id": "66m1...",
      "deliveryId": "66b1...",
      "orderId": "66c2...",
      "senderRole": "partner",
      "senderUserId": "66u9...",
      "to": "customer",
      "text": "I am at the gate.",
      "createdAt": "2026-08-13T03:00:00.000Z"
    }]
  }
}
```

### Send customer chat message

**API name:** Send customer tracking chat message
**Method / full path:** `POST /api/v1/delivery-service/tracking/order/:orderId/chat`
**Auth / who:** 🔑 authenticated order owner (customer app); CSRF required for cookie auth

**Request:** path param `orderId`; `Content-Type: application/json`.

```json
{ "text": "Please leave it with security." }
```

`text` is trimmed, required, and limited to 500 characters.

**Success response `201`:**

```json
{
  "success": true,
  "message": "Message sent",
  "data": {
    "id": "66m2...",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "senderRole": "customer",
    "senderUserId": "66u1...",
    "to": "partner",
    "text": "Please leave it with security.",
    "createdAt": "2026-08-13T03:01:00.000Z"
  }
}
```

Both endpoints verify ownership through order-service. Messages persist in Mongo and
`DELIVERY_CHAT_MESSAGE` fans out as `chat:new-message` to the order, rider, and customer user rooms.

**Errors:** `401 UNAUTHORIZED`; `403 FORBIDDEN`; `404 DELIVERY_NOT_FOUND`;
`409 CHAT_CLOSED`; `422 VALIDATION_ERROR`; `429 CHAT_RATE_LIMITED`;
`503 ORDER_SERVICE_UNAVAILABLE`.

---

## Rider snippet (customer)

**API name:** Masked rider on tracker  
**Method / path:** `GET /tracking/order/:orderId/partner`  
**Auth:** 🔑 Auth 👤 Customer / admin  
**Who:** Order owner (customer app)

### Request

Path param: `orderId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Rider details",
  "data": {
    "partnerId": "66a9...",
    "name": "Rahul S.",
    "photo": "https://...",
    "vehicleType": "motorcycle",
    "vehicleNumber": "DL*123",
    "rating": 4.8,
    "phoneMasked": "******3210"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `PARTNER_NOT_ASSIGNED` | Offer not accepted yet |

---

## Create share link

**API name:** Family live-track token  
**Method / path:** `POST /tracking/order/:orderId/share`  
**Auth:** 🔑 Auth 👤 Customer / admin  
**Who:** Order owner

### Request

Path param: `orderId`. Empty body.

### Success response `201`

```json
{
  "success": true,
  "message": "Share link created",
  "data": {
    "shareToken": "base64url...",
    "shareUrl": "https://track.fooddelivery.app/s/base64url...",
    "orderId": "66c2...",
    "deliveryId": "66b1...",
    "expiresAt": "2026-08-10T15:00:00.000Z",
    "createdAt": "2026-08-10T11:00:00.000Z"
  }
}
```

Idempotent while an unexpired link exists (TTL 4h). CSRF required.

---

## Public share track

**API name:** Live track via share token  
**Method / path:** `GET /tracking/share/:shareToken`  
**Auth:** 🔓 Public  
**Who:** Family / friend with the link

### Request

Path param: `shareToken`.

### Success response `200`

```json
{
  "success": true,
  "message": "Shared tracking",
  "data": {
    "orderId": "66c2...",
    "deliveryId": "66b1...",
    "status": "out_for_delivery",
    "dutyHint": "Out for delivery",
    "etaSeconds": 720,
    "etaAt": "2026-08-10T11:12:00.000Z",
    "polyline": "encoded...",
    "drop": { "latitude": 28.61, "longitude": 77.20, "address": "House 12, Dwarka" },
    "riderLocation": { },
    "partner": { "partnerId": "66a9...", "name": "Rahul S.", "photo": null, "vehicleType": "motorcycle", "vehicleNumber": "DL*123", "rating": 4.8, "phoneMasked": "******3210" },
    "expiresAt": "2026-08-10T15:00:00.000Z"
  }
}
```

Never includes drop OTP or full phone.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `SHARE_NOT_FOUND` / `SHARE_EXPIRED` | Unknown, revoked, or past TTL |

---

## Revoke share

**API name:** Revoke family share link  
**Method / path:** `DELETE /tracking/order/:orderId/share`  
**Auth:** 🔑 Auth 👤 Customer / admin  
**Who:** Order owner

### Success response `200`

```json
{ "success": true, "message": "Share link revoked", "data": { "revoked": true, "orderId": "66c2..." } }
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `SHARE_NOT_FOUND` | No active token |

---

## Nudge partner

**API name:** “Where are you?” ping  
**Method / path:** `POST /tracking/order/:orderId/nudge-partner`  
**Auth:** 🔑 Auth 👤 Customer / admin  
**Who:** Order owner while `picked_up` / `out_for_delivery` / `arrived_at_customer`

### Request

Empty body. CSRF required.

### Success response `200`

```json
{
  "success": true,
  "message": "Rider nudged",
  "data": {
    "orderId": "66c2...",
    "deliveryId": "66b1...",
    "nudgedAt": "2026-08-10T11:05:00.000Z",
    "remaining": 2
  }
}
```

Rate: 3 per 15 minutes. Emits `notification:new` + `delivery:updated`. Does not fake GPS.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ILLEGAL_TRANSITION` | Wrong trip status |
| 429 | `NUDGE_RATE_LIMITED` | Too many pings |

---

## Contact partner (customer → rider)

**API name:** Masked call customer → rider  
**Method / path:** `POST /tracking/order/:orderId/contact-partner`  
**Auth:** 🔑 Auth 👤 Customer / admin  
**Who:** Order owner

### Request

Empty body. CSRF required.

### Success response `201`

```json
{
  "success": true,
  "message": "Masked call started",
  "data": {
    "callId": "66d1...",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "target": "partner",
    "status": "initiated",
    "toMasked": "******3210",
    "virtualNumberMasked": "******1000",
    "provider": "exotel",
    "createdAt": "2026-08-10T11:06:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Call not allowed in this status |
| 409 | `PHONE_UNAVAILABLE` | Missing customer or rider phone |
| 429 | `CALL_RATE_LIMITED` | 8 / hour |
| 503 | `MASKED_CALL_UNAVAILABLE` | Exotel/Twilio not configured (never fake connect) |

---

## Contact support (tracker)

**API name:** Escalate to support from tracker  
**Method / path:** `POST /tracking/order/:orderId/contact-support`  
**Auth:** 🔑 Auth 👤 Customer / admin  
**Who:** Order owner

### Request

```json
{ "reason": "late", "message": "Rider has been nearby for 20 minutes" }
```

| Field | Required | Notes |
|---|---|---|
| `reason` | yes | `late` \| `wrong_address` \| `rider_issue` \| `food_issue` \| `other` |
| `message` | no | max 500 |

### Success response `201`

```json
{
  "success": true,
  "message": "Support request queued",
  "data": {
    "ticketNo": "TE-20260810-AB3K",
    "orderId": "66c2...",
    "deliveryId": "66b1...",
    "reason": "late",
    "status": "queued",
    "createdAt": "2026-08-10T11:07:00.000Z"
  }
}
```

Persisted locally. Never fakes a live agent call. 5 / hour per order.

### Errors

| HTTP | code | When |
|---|---|---|
| 429 | `ESCALATION_RATE_LIMITED` | Too many for this order |

---

## Delivery instructions

**API name:** Update drop instructions before pickup  
**Method / path:** `PUT /tracking/order/:orderId/delivery-instructions`  
**Auth:** 🔑 Auth 👤 Customer / admin  
**Who:** Order owner while `assigned` / `accepted` / `arrived_at_restaurant`

### Request

```json
{ "instructions": "Ring bell 2, leave at guard if no answer" }
```

### Success response `200`

```json
{
  "success": true,
  "message": "Drop instructions updated",
  "data": {
    "orderId": "66c2...",
    "deliveryId": "66b1...",
    "dropInstructions": "Ring bell 2, leave at guard if no answer",
    "updatedAt": "2026-08-10T11:08:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ILLEGAL_TRANSITION` | After pickup |

---

## Contactless / leave-at-door

**API name:** No-contact flag  
**Method / path:** `PUT /tracking/order/:orderId/contactless`  
**Auth:** 🔑 Auth 👤 Customer / admin  
**Who:** Order owner until delivered/cancelled

### Request

```json
{ "contactless": true }
```

### Success response `200`

```json
{
  "success": true,
  "message": "Contactless delivery updated",
  "data": {
    "orderId": "66c2...",
    "deliveryId": "66b1...",
    "contactlessDelivery": true,
    "updatedAt": "2026-08-10T11:08:30.000Z"
  }
}
```

Does **not** skip drop OTP. Rider still completes with OTP or POD photo.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ILLEGAL_TRANSITION` | Terminal trip status |

---

## Address change

**API name:** Change drop pin before pickup  
**Method / path:** `PUT /tracking/order/:orderId/address-change`  
**Auth:** 🔑 Auth 👤 Customer / admin  
**Who:** Order owner while `assigned` / `accepted` / `arrived_at_restaurant`

### Request

```json
{
  "formattedAddress": "Flat 8B, Tower C, Dwarka Sec 12",
  "lat": 28.5921,
  "lng": 77.0460,
  "landmark": "Near metro",
  "city": "New Delhi",
  "pincode": "110075"
}
```

Synced to order-service `PUT /orders/internal/:orderId/delivery-address` first. If order-service is down → 503 (delivery pin is not updated alone).

### Success response `200`

```json
{
  "success": true,
  "message": "Drop address updated",
  "data": {
    "orderId": "66c2...",
    "deliveryId": "66b1...",
    "address": "Flat 8B, Tower C, Dwarka Sec 12",
    "latitude": 28.5921,
    "longitude": 77.0460,
    "syncedOrder": true,
    "updatedAt": "2026-08-10T11:09:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ILLEGAL_TRANSITION` | After pickup / OFD |

---

## Add / increase tip (OFD)

**API name:** Tip while out for delivery  
**Method / path:** `POST /tracking/order/:orderId/tip`  
**Auth:** 🔑 Auth 👤 Customer / admin  
**Who:** Order owner while `picked_up` / `out_for_delivery` / `arrived_at_customer` (or just after `delivered`)

### Request

```json
{ "tipAmount": 40 }
```

Increase-only. ₹1–₹500. Synced to order-service `PUT /orders/internal/:orderId/tip`. If already delivered and earnings were credited, delta is wallet-credited immediately.

### Success response `200`

```json
{
  "success": true,
  "message": "Tip updated",
  "data": {
    "orderId": "66c2...",
    "deliveryId": "66b1...",
    "tipAmount": 40,
    "previousTip": 20,
    "creditedNow": false,
    "syncedOrder": true
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ILLEGAL_TRANSITION` / `TIP_DECREASE_NOT_ALLOWED` | Wrong status or decrease |
| 422 | `INVALID_TIP` | Outside ₹1–₹500 |

---

## Rate partner (after deliver)

**API name:** Rate rider after deliver  
**Method / path:** `POST /tracking/order/:orderId/rate-partner`  
**Auth:** 🔑 Auth 👤 Customer / admin  
**Who:** Order owner after `delivered`

### Request

```json
{ "stars": 5, "comment": "On time, polite" }
```

Proxies `PerformanceService.submitRating` (`source=customer`, unique per delivery).

### Success response `201`

```json
{
  "success": true,
  "message": "Rider rated",
  "data": {
    "ratingId": "66e1...",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "stars": 5,
    "comment": "On time, polite",
    "source": "customer",
    "reviewerMasked": null,
    "createdAt": "2026-08-10T11:40:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `DELIVERY_NOT_COMPLETE` | Not delivered yet |
| 409 | `RATING_ALREADY_SUBMITTED` | Already rated |
| 422 | `INVALID_RATING` | stars not 1–5 |

---

## Drop OTP (customer)

**API name:** Show drop OTP to customer  
**Method / path:** `GET /tracking/order/:orderId/otp`  
**Auth:** 🔑 Auth 👤 Customer / admin  
**Who:** Order owner only (never on share link)

### Request

Path param: `orderId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Drop OTP",
  "data": {
    "orderId": "66c2...",
    "deliveryId": "66b1...",
    "otp": "4821",
    "verified": false
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `OTP_UNAVAILABLE` | Not issued yet, or trip already terminal |

---

## Tracking status

**API name:** Get current tracking status by delivery  
**Method / path:** `GET /tracking/status/:deliveryId`  
**Auth:** 🔑 Auth  
**Who:** Customer / assigned rider / admin

### Request

Path param: `deliveryId`.

### Success response `200`

Same `data` shape as **Track order** (`OrderTrackingDto`). Message: `"Tracking status"`.

### Errors

Same as Track order (`FORBIDDEN`, `DELIVERY_NOT_FOUND`, `TRACKING_INCOMPLETE`).

---

## Kitchen partner (restaurant)

**API name:** Assigned partner for an order  
**Method / path:** `GET /restaurant/orders/:orderId/partner`  
**Auth:** 🔑 Auth  
**Who:** Kitchen / owner / manager / cashier of **that** restaurant (verified via restaurant-service). Admin allowed. Customers 403.

Restaurant owners **cannot** use `/tracking/order/:orderId` (403). Use this + sockets.

Marketplace rider → `phone` is `null`, `phoneMasked` only. Restaurant-owned fleet rider → full `phone`.

### Request

Path param: `orderId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Assigned partner",
  "data": {
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "restaurantId": "66aa...",
    "status": "accepted",
    "partnerId": "66a9...",
    "partnerName": "Rahul Sharma",
    "phoneMasked": "******3210",
    "phone": null,
    "vehicleType": "motorcycle",
    "vehicleNumber": "DL01AB1234",
    "avgRating": 4.8,
    "isOnline": true,
    "dutyStatus": "on_delivery",
    "isFleetPartner": false,
    "assignedAt": "2026-08-09T06:40:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` / `PARTNER_NOT_FOUND` | No assignment |
| 403 | `FORBIDDEN` | Not this restaurant’s kitchen/owner |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` | Ownership check failed |

---

## Kitchen handover display

**API name:** Handover OTP for kitchen display  
**Method / path:** `GET /restaurant/orders/:orderId/handover`  
**Auth:** 🔑 Auth  
**Who:** Kitchen / owner / manager / cashier of **that** restaurant (`assertRestaurantKitchenAccess`). Admin allowed.

Only when delivery status is `arrived_at_restaurant`. Exposes pickup OTP to the kitchen so staff can show it to the rider (or enter it on confirm). OTP is `null` once `pickupVerified` is already true.

### Request

Path param: `orderId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Handover details",
  "data": {
    "otp": "4821",
    "partnerNameMasked": "Rahul S.",
    "status": "arrived_at_restaurant",
    "pickupVerified": false
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | No delivery for order |
| 400 | `ILLEGAL_TRANSITION` | Rider has not arrived at restaurant |
| 403 | `FORBIDDEN` | Not this restaurant’s kitchen |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` | Ownership check failed |

---

## Kitchen handover confirm

**API name:** Confirm kitchen → rider handover  
**Method / path:** `PUT /restaurant/orders/:orderId/handover`  
**Auth:** 🔑 Auth  
**Who:** Kitchen / owner / manager / cashier of **that** restaurant. Admin allowed.

Requires status `arrived_at_restaurant`. Idempotent if `pickupVerified` is already true.  
`method: "otp"` verifies delivery OTP (same as rider `pickup-verify`). `method: "tap"` confirms without OTP. Sets `pickupVerified`, `pickupVerifiedAt`, and `pickupOtpVerified` (true only for otp). Publishes `DELIVERY_STATUS_CHANGED` with `pickupVerified: true`.

### Request

```json
{ "method": "otp", "otp": "4821" }
```

or

```json
{ "method": "tap" }
```

`otp` required (4 chars) when `method` is `otp`.

### Success response `200`

```json
{
  "success": true,
  "message": "Handover confirmed",
  "data": {
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "status": "arrived_at_restaurant",
    "pickupVerified": true,
    "pickupVerifiedAt": "2026-08-11T06:40:00.000Z",
    "method": "otp"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | No delivery for order |
| 400 | `ILLEGAL_TRANSITION` | Not `arrived_at_restaurant` (and not already verified) |
| 400 | `INVALID_OTP` | OTP mismatch |
| 422 | — / `OTP_REQUIRED` | Invalid body or missing otp for method otp |
| 403 | `FORBIDDEN` | Not this restaurant’s kitchen |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` | Ownership check failed |

---

## Kitchen call customer

**API name:** Masked call restaurant → customer  
**Method / path:** `POST /restaurant/orders/:orderId/call-customer`  
**Auth:** 🔑 Auth  
**Who:** Kitchen / owner / manager / cashier of **that** restaurant. Admin allowed.

Bridges restaurant phone → customer via Exotel/Twilio. Never returns the full destination number. Works for **delivery** (rate-limited on `deliveryId`) and **takeaway / pre-assign** (rate-limited on `order:{orderId}` via order-service batch ownership). Max **8 calls / hour**. Persists `MaskedCall` with `target: "customer"` (`deliveryId` / `partnerId` optional). If telephony env is unset → `503 MASKED_CALL_UNAVAILABLE` (never fake connect).

### Request

No body. Path: `orderId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Masked call to customer started",
  "data": {
    "callId": "66e1...",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "target": "customer",
    "status": "initiated",
    "toMasked": "******3210",
    "virtualNumberMasked": "******1001",
    "provider": "exotel",
    "createdAt": "2026-08-11T06:40:00.000Z"
  }
}
```

`deliveryId` is `null` when no delivery row exists yet (pickup / pre-assign).

### Errors

| HTTP | code | When |
|---|---|---|
| 503 | `MASKED_CALL_UNAVAILABLE` | Exotel/Twilio not configured |
| 502 | `MASKED_CALL_FAILED` | Provider rejected the call |
| 409 | `PHONE_UNAVAILABLE` | Order missing customer or restaurant phone |
| 429 | `CALL_RATE_LIMITED` | > 8 / hour |
| 400 | `ILLEGAL_TRANSITION` | Delivery / order status not call-eligible |
| 404 | `ORDER_NOT_FOUND` | No order (when delivery also missing) |
| 403 | `FORBIDDEN` | Not this restaurant’s kitchen |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` / `ORDER_SERVICE_UNAVAILABLE` | Ownership / order lookup failed |

---

## Recalculate route

**API name:** Recalculate route using live traffic  
**Method / path:** `POST /tracking/recalculate-route`  
**Auth:** 🔒 Internal (`x-internal-key`)  
**Who:** Order / dispatch services — **not** mobile apps

### Request

One of `orderId` or `deliveryId` is required. `trafficFactor` (1–4) is used only if Google Maps fails.

```json
{
  "orderId": "66c2...",
  "deliveryId": "66b1...",
  "trafficFactor": 1.2
}
```

### Success response `200`

```json
{
  "success": true,
  "message": "Route recalculated",
  "data": {
    "orderId": "66c2...",
    "polyline": "...",
    "points": [{ "latitude": 28.615, "longitude": 77.208 }],
    "distanceMeters": 2380,
    "etaSeconds": 690,
    "destination": { "latitude": 28.61, "longitude": 77.20, "kind": "customer" },
    "recalculatedAt": "2026-08-08T14:31:00.000Z",
    "trafficFactor": 1.12,
    "provider": "google",
    "durationInTraffic": true
  }
}
```

Publishes Redis event → gateway socket `tracking:eta` on room `order:{orderId}`. Bypasses ~25s Maps cache.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | — | Missing / bad internal key |
| 409 | `TRACKING_COMPLETE` | Delivered |
| 409 | `LOCATION_REQUIRED` | No rider GPS |
| 409 | `TRACKING_INCOMPLETE` | Cannot build route |
| 422 | — | Neither `orderId` nor `deliveryId` |

---

## Geofence status

**API name:** Check restaurant / customer geofence  
**Method / path:** `GET /tracking/geofence-status/:deliveryId`  
**Auth:** 🔒 Internal  
**Who:** Dispatch / trip state machine

### Request

Path param: `deliveryId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Geofence status",
  "data": {
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "status": "accepted",
    "rider": { },
    "pickup": {
      "latitude": 28.62,
      "longitude": 77.21,
      "radiusMeters": 150,
      "distanceMeters": 42,
      "inside": true
    },
    "drop": {
      "latitude": 28.61,
      "longitude": 77.20,
      "radiusMeters": 100,
      "distanceMeters": 1800,
      "inside": false
    }
  }
}
```

`rider` is **PartnerLiveLocation** or `null`. Pickup radius 150m, drop 100m. `inside: true` at pickup → rider can mark Arrived; at drop → Deliver.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `TRACKING_INCOMPLETE` | Missing pins |

---

## Remaining distance

**API name:** Calculate remaining distance  
**Method / path:** `GET /tracking/distance/:deliveryId`  
**Auth:** 🔒 Internal  
**Who:** Dispatch / ETA jobs

### Request

Path param: `deliveryId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Remaining distance",
  "data": {
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "destination": "restaurant",
    "remainingMeters": 420,
    "remainingToPickupMeters": 420,
    "remainingToDropMeters": 3100,
    "etaSeconds": 180
  }
}
```

`destination`: `restaurant` | `customer` | `arrived`. Road distance when Google works.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `LOCATION_REQUIRED` | No GPS and not delivered |

---

## Tracking sockets (gateway)

Connect to `{GATEWAY}` path `/socket.io/`. Rider trip/duty events: [Rider WebSocket Events](#rider-websocket-events). Kitchen events: [Kitchen sockets](#kitchen-sockets--restaurant-app).

**Auth (required):** signed `_sid` cookie (credentials), or `auth: { sid }` / `{ sessionId }`, or `auth: { socketToken }` from `POST /api/v1/socket-token`. Raw `userId` alone is **rejected**.

```js
// Prefer cookie credentials, or:
auth: { sid: sessionId }           // or { socketToken }
socket.emit('track:order', orderId)           // customer / rider track screen
socket.emit('join:restaurant', restaurantId)  // kitchen

socket.on('partner:location', ({ latitude, longitude, speed }) => {})
socket.on('tracking:eta', ({ orderId, etaSeconds, distanceMeters, polyline, provider, durationInTraffic }) => {})
socket.on('delivery:assigned', (data) => {})  // customer room: rider assigned to order
socket.on('delivery:status', ({ orderId, status }) => {})
```

---

## Kitchen sockets — restaurant app

**API name:** Kitchen realtime board  
**Connect:** `{GATEWAY}/socket.io/` · session/`socketToken` auth (not raw `userId`)  
**Join:** `socket.emit('join:restaurant', restaurantId)` (string) → room `restaurant:{restaurantId}`  
**Ticket room (optional):** `socket.emit('track:order', orderId)` → room `order:{orderId}` (needed for `order:items-removed` and `payment:cod-paid`)  
**No kitchen chat REST** — send/receive `chat:new-message` and `typing` on this socket only.

| Dir | Event | When | Payload |
|---|---|---|---|
| C→S | `join:restaurant` | After connect | `restaurantId` string |
| C→S | `track:order` | Open a ticket | `orderId` string |
| S→C | `kitchen:order-new` | Order `placed` (not future-scheduled) or scheduled due | `orderId`, `orderNumber`, `status`, `deliveryType`, `paymentMethod`, `grandTotal`, `itemCount`, `acceptBy` |
| S→C | `kitchen:order-status` | Kitchen status transitions (`accepted`, `preparing`, `ready`, …) | same + `status` |
| S→C | `kitchen:order-cancelled` | `cancelled` / `rejected` (customer, SLA, reject) | + `reason` |
| S→C | `order:status` | Same Redis event (restaurant room + order room) | `orderId`, `status` |
| S→C | `order:items-removed` | Bill after kitchen 86 | `orderId`, `itemsRemoved`, `previousTotal`, `newTotal` — **order room** |
| S→C | `kitchen:rider-assigned` | Delivery offer / partner accept | `orderId`, `deliveryId`, `partnerId`, `partnerName`, `vehicleType`, `status` |
| S→C | `kitchen:rider-arrived` | Delivery `arrived_at_restaurant` | `orderId`, `deliveryId`, `status` |
| S→C | `kitchen:scheduled-due` | Scheduled prep window starts (60s job) | `orderId`, `scheduledFor`, … (+ also `kitchen:order-new`) |
| S→C | `delivery:status` | Trip status at outlet | `orderId`, `status` |
| S→C | `payment:cod-paid` | Doorstep COD collected | `orderId`, `method` — **order room** |
| S→C | `notification:new` | Inbox badge | notification DTO |
| Both | `chat:new-message` | In-trip chat | Kitchen send `{ orderId, text, to: "customer"\|"partner" }` + ack |
| Both | `typing` | Typing dots | Kitchen send `{ orderId, isTyping, to? }` |

Kitchen send ack errors: **409 `CHAT_CLOSED`**, **429 `CHAT_RATE_LIMITED`**, **404 `DELIVERY_NOT_FOUND`** (no rider/trip yet), **403 `FORBIDDEN`**. Kitchen `senderRole` is `restaurant`. Fan-out: `order:{orderId}` + `restaurant:{restaurantId}` + rider/customer user rooms.

Future-scheduled places skip `kitchen:order-new` until `kitchen:scheduled-due`. If socket is down, poll `GET /restaurants/:id/orders/kds`.

---

## Tracking error codes (quick list)

| code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Not logged in |
| `FORBIDDEN` | 403 | Wrong user / not your trip |
| `MOCK_LOCATION` | 403 | Fake GPS |
| `PARTNER_OFFLINE` | 409 | Go online first |
| `LOCATION_NOT_FOUND` | 404 | No GPS yet |
| `LOCATION_REQUIRED` | 400 / 409 | Need GPS or home |
| `DELIVERY_NOT_FOUND` | 404 | Bad order / delivery id |
| `PARTNER_NOT_FOUND` | 404 | Partner profile missing |
| `TRACKING_COMPLETE` | 409 | Already delivered |
| `TRACKING_INCOMPLETE` | 409 | Missing pins / route points |

---

# Assignment APIs

Rider offer → accept / reject → trip lifecycle → history.  
Service: **delivery-service**. Auth: 🔑 + 🚴 `delivery_partner`. CSRF on PUT/POST.

Shared **PartnerDeliveryDto** (`data` on active / detail / accept / reject / trip steps):

```json
{
  "deliveryId": "66b1...",
  "orderId": "66c2...",
  "restaurantId": "66a8...",
  "status": "assigned",
  "nextAction": "accept",
  "canReject": true,
  "canCancel": false,
  "canReportIssue": false,
  "canFail": false,
  "batchId": null,
  "restaurantLocation": { "latitude": 28.62, "longitude": 77.21 },
  "deliveryLocation": { "latitude": 28.61, "longitude": 77.20 },
  "deliveryAddress": "House 12, Dwarka",
  "deliveryFee": 40,
  "partnerEarnings": 32,
  "incentiveBonus": 0,
  "actualDistance": 3.2,
  "assignedAt": "2026-08-08T14:20:00.000Z",
  "acceptedAt": null,
  "arrivedAt": null,
  "pickedUpAt": null,
  "arrivedAtCustomer": null,
  "deliveredAt": null,
  "estimatedPickupTime": null,
  "estimatedDeliveryTime": null,
  "offerExpiresAt": "2026-08-08T14:20:30.000Z",
  "timeoutSeconds": 30,
  "cancelReason": null,
  "waitStartedAt": null,
  "waitEndedAt": null,
  "waitMinutes": null,
  "kitchenReadyAt": null,
  "orderNotReadyCount": 0,
  "pickupVerified": false,
  "pickupVerifiedAt": null,
  "otpVerified": false,
  "otpVerifiedAt": null,
  "outForDeliveryAt": null,
  "proofOfDelivery": null,
  "signatureUrl": null,
  "signatureCapturedAt": null,
  "failedAt": null,
  "failReasonCode": null,
  "failReason": null,
  "canFail": false,
  "contactAttemptCount": 0,
  "rtoTimerEndsAt": null,
  "rtoRemainingSeconds": null,
  "canStartRto": false,
  "canReturnToRestaurant": false,
  "issues": []
}
```

`nextAction`: `accept` | `accept_batch` | `arrive_restaurant` | `wait` | `confirm_ready` | `pickup` | `start_trip` | `arrive_customer` | `deliver` | `return_store` | `null`  
`batchId`: set when this trip is part of a live multi-order stack.  
`canReject`: `true` only while `status === "assigned"`.  
`canCancel` / `canReportIssue`: `true` after accept until delivered / cancelled / returned / failed.  
`canFail`: `true` after pickup (`picked_up` | `out_for_delivery` | `arrived_at_customer` | `returning_to_restaurant`).  
`offerExpiresAt` / `timeoutSeconds` only on an open offer.

**Trip machine:** `assigned` → `accepted` → `arrived_at_restaurant` → (wait / order-ready) → `pickup` → `out_for_delivery` → `arrived_at_customer` → (verify-otp / signature) → `delivered`  
Undeliverable: `customer-unavailable` (2 calls) → 5 min RTO timer → `returning_to_restaurant` → (`returned` or `failed`). Terminal `failed` syncs order to `cancelled`.  
Pickup geofence **150 m**, drop **100 m**. Live GPS in Redis is required for arrive / pickup / arrive-customer / deliver / signature / navigation.

---

## Active delivery

**API name:** Get current active delivery  
**Method / path:** `GET /partners/me/active-delivery`  
**Who:** Rider

### Request

None.

### Success response `200`

```json
{ "success": true, "message": "Active delivery found", "data": { } }
```

`data` is **PartnerDeliveryDto** or `null` (`message`: `"No active delivery"`). If several actives (batch), this is the oldest / current trip.

---

## Active deliveries (batch)

**API name:** Get all active assignments  
**Method / path:** `GET /partners/me/active-deliveries`  
**Who:** Rider (multi-order / stack, max 3)

### Request

None.

### Success response `200`

```json
{
  "success": true,
  "message": "Active deliveries",
  "data": {
    "count": 2,
    "deliveries": [ { } ]
  }
}
```

Each item is **PartnerDeliveryDto**. Empty list if idle.

---

## Delivery history

**API name:** Past delivery history  
**Method / path:** `GET /partners/me/deliveries`  
**Who:** Rider

### Request query

| Query | Required | Notes |
|---|---|---|
| `page` | no | default 1 |
| `limit` | no | default 20, max 100 |
| `status` | no | one of delivery statuses; default = past only (`delivered`, `cancelled`, `reassigned`) |
| `dateFrom` | no | ISO date |
| `dateTo` | no | ISO date |

### Success response `200`

```json
{
  "success": true,
  "data": [ { } ],
  "total": 40,
  "page": 1,
  "limit": 20,
  "totalPages": 2
}
```

Each `data[]` item is **PartnerDeliveryDto**. Invalid `status` → `422 INVALID_STATUS`.

---

## Delivery details

**API name:** Full details of a delivery  
**Method / path:** `GET /partners/me/deliveries/:deliveryId`  
**Who:** Rider (own deliveries only, including past)

### Request

Path: `deliveryId`.

### Success response `200`

```json
{ "success": true, "message": "Delivery details", "data": { } }
```

**PartnerDeliveryDto**. Errors: `404 DELIVERY_NOT_FOUND`, `403 FORBIDDEN`.

Also: `GET /deliveries/:deliveryId` (same handler).

---

# Delivery Lifecycle APIs

Rider trip steps after arrive-at-restaurant: wait → kitchen ready → pickup → on-the-way → reached-customer → verify OTP → POD. Canonical `/partners/me/deliveries/:deliveryId/...` and `/deliveries/:deliveryId/...` share handlers. `data` is **PartnerDeliveryDto** unless noted.

## Delivery timeline

**API name:** Get delivery timeline  
**Method / path:** `GET /partners/me/deliveries/:deliveryId/timeline` · `GET /deliveries/:deliveryId/timeline`  
**Who:** Rider (own trip).

### Success response `200`

```json
{
  "success": true,
  "message": "Delivery timeline",
  "data": {
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "status": "arrived_at_restaurant",
    "waitMinutes": null,
    "steps": [
      { "key": "assigned", "label": "Assigned", "at": "2026-08-08T14:20:00.000Z", "completed": true },
      { "key": "accepted", "label": "Accepted", "at": "2026-08-08T14:20:12.000Z", "completed": true },
      { "key": "arrived_restaurant", "label": "Arrived at restaurant", "at": "2026-08-08T14:28:00.000Z", "completed": true },
      { "key": "waiting", "label": "Waiting at restaurant", "at": null, "completed": false }
    ]
  }
}
```

---

## Delivery events

**API name:** View delivery event history  
**Method / path:** `GET /partners/me/deliveries/:deliveryId/events` · `GET /deliveries/:deliveryId/events`  
**Who:** Rider. Merges timeline stamps + issues + contact attempts + dispatch logs.

### Success response `200`

```json
{
  "success": true,
  "message": "Delivery events",
  "data": {
    "count": 4,
    "events": [
      {
        "kind": "timeline",
        "key": "accepted",
        "label": "Accepted",
        "at": "2026-08-08T14:20:12.000Z",
        "actor": "partner",
        "detail": null
      },
      {
        "kind": "dispatch",
        "key": "assign",
        "label": "Dispatch: assign",
        "at": "2026-08-08T14:20:00.000Z",
        "actor": "internal",
        "detail": null
      }
    ]
  }
}
```

`kind`: `timeline` | `issue` | `contact` | `dispatch`.

---

## Waiting at restaurant

**API name:** Mark rider waiting at restaurant  
**Method / path:** `PUT /partners/me/deliveries/:deliveryId/waiting` · `PUT /deliveries/:deliveryId/waiting`  
**Who:** Rider. After `arrived_at_restaurant`. Starts wait clock (does not increment `orderNotReadyCount`). Idempotent.

### Success response `200`

**PartnerDeliveryDto** with `waitStartedAt` set. `nextAction` → `confirm_ready`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Not at restaurant |
| 403 | `FORBIDDEN` | Not your trip |

---

## Kitchen ready

**API name:** Confirm restaurant has prepared the order  
**Method / path:** `PUT /partners/me/deliveries/:deliveryId/order-ready` · `PUT /deliveries/:deliveryId/order-ready`  
**Who:** Rider. Ends wait clock, sets `kitchenReadyAt`. Idempotent.

### Success response `200`

**PartnerDeliveryDto**. `nextAction` → `pickup`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Not at restaurant |

---

## On the way

**API name:** Start travelling to customer  
**Method / path:** `PUT /partners/me/deliveries/:deliveryId/on-the-way` · `PUT /deliveries/:deliveryId/on-the-way`  
**Who:** Rider. After pickup (`picked_up` → `out_for_delivery`). Pickup already jumps to OFD — this call is idempotent then. Syncs order OFD.

### Success response `200`

**PartnerDeliveryDto** with `status: "out_for_delivery"`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Pickup not done |

---

## Reached customer

**API name:** Mark arrival at customer  
**Method / path:** `PUT /deliveries/:deliveryId/reached-customer` · `PUT /partners/me/deliveries/:deliveryId/reached-customer` · `PUT .../arrived-customer`  
**Who:** Rider. Same as arrived-customer (100 m geofence + live GPS).

### Success response `200`

**PartnerDeliveryDto** `status: "arrived_at_customer"`.

---

## Verify drop OTP

**API name:** Verify customer OTP  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/verify-otp` · `POST /deliveries/:deliveryId/verify-otp`  
**Who:** Rider. Verifies OTP **without** completing delivery. Then call `deliver` with photo/signature or OTP again (idempotent if already verified).

### Request

```json
{ "otp": "4821" }
```

### Success response `200`

**PartnerDeliveryDto** with `otpVerified: true`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_OTP` | Wrong OTP |
| 400 | `ILLEGAL_TRANSITION` | Too early (before pickup) |

---

## Upload proof (alias)

**API name:** Upload proof of delivery  
**Method / path:** `POST /deliveries/:deliveryId/upload-proof`  
**Who:** Rider. Same as `POST /partners/me/deliveries/:deliveryId/proof-of-delivery` (`multipart` photo + signature → Cloudinary).

---

## Capture signature

**API name:** Capture customer signature  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/signature` · `POST /deliveries/:deliveryId/signature`  
**Who:** Rider. After pickup, at the drop pin (100 m geofence + live GPS). Does **not** complete the trip — call `/deliver` after. Idempotent if signature already stored and no new file/URL.

### Request

`multipart/form-data` (CSRF required) **or** JSON:

| Field | Required | Notes |
|---|---|---|
| `signature` | one of file / URL | JPEG / PNG / WEBP, max 5 MB |
| `signatureUrl` | one of file / URL | HTTPS URL already uploaded |

### Success response `200`

**PartnerDeliveryDto** with `signatureUrl` + `signatureCapturedAt`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `SIGNATURE_REQUIRED` | No file and no URL |
| 400 | `ILLEGAL_TRANSITION` | Not at customer / before pickup |
| 409 | `LOCATION_REQUIRED` | No live GPS |
| 409 | `GEOFENCE_NOT_MET` | Outside 100 m drop |
| 503 | `UPLOAD_FAILED` | Cloudinary down |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Customer unavailable

**API name:** Report customer unavailable  
**Method / path:** `POST /deliveries/:deliveryId/customer-unavailable` · `POST /partners/me/deliveries/:deliveryId/customer-unavailable` · `PUT .../customer-unreachable`  
**Who:** Rider. Same handler as customer-unreachable: logs a contact attempt; attempt **2** starts the **5 min** RTO timer.

### Request

```json
{ "channel": "call", "note": "No one at the gate" }
```

### Success response `200`

**PartnerDeliveryDto** with `contactAttemptCount`, `rtoTimerEndsAt`, `canReturnToRestaurant`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Not after pickup |
| 409 | `RTO_ATTEMPTS_MAX` | Already 8 attempts |

---

## Report issue (alias)

**API name:** Report delivery issue  
**Method / path:** `POST /deliveries/:deliveryId/report-issue` · `POST /partners/me/deliveries/:deliveryId/report-issue`  
**Who:** Rider. Append-only `issues[]`. Does **not** change status. Same contract as Report issue above.

---

## Return order

**API name:** Return undelivered order to restaurant  
**Method / path:** `POST /deliveries/:deliveryId/return-order` · `POST /partners/me/deliveries/:deliveryId/return-order` · `POST .../return-to-restaurant`  
**Who:** Rider. Same as return-to-restaurant: 2 unreachable attempts + RTO timer elapsed, unless `reasonCode` is `customer_refused`. Status → `returning_to_restaurant`.

### Request

```json
{ "reasonCode": "customer_unreachable", "reason": "Timer elapsed, still no answer" }
```

### Success response `200`

**PartnerDeliveryDto** `status: "returning_to_restaurant"`, `nextAction: "return_store"`.

---

## Mark delivery failed

**API name:** Mark delivery as failed  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/failed` · `POST /deliveries/:deliveryId/failed`  
**Who:** Rider. Terminal after pickup when the order cannot be delivered **and** cannot be returned (or restaurant closed on RTO). Pre-pickup → use `/cancel`. Idempotent if already `failed`. Syncs order-service to `cancelled`. Restores rider duty. `canFail` is true only on failable statuses.

### Request

```json
{ "reasonCode": "customer_unreachable", "reason": "Restaurant closed on return" }
```

`reasonCode` required: `customer_unreachable` | `customer_refused` | `wrong_address` | `item_damaged` | `payment_issue` | `restaurant_closed` | `unsafe` | `other`  
`reason` required when `reasonCode` is `other`.

### Success response `200`

**PartnerDeliveryDto** with `status: "failed"`, `failedAt`, `failReasonCode`, `failReason`, `nextAction: null`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Before pickup, already terminal, or `restaurant_closed` while not returning |
| 409 | `RTO_ATTEMPTS_REQUIRED` | `customer_unreachable` without 2 calls (unless already returning) |
| 409 | `RTO_TIMER_REQUIRED` | Timer not started |
| 409 | `RTO_TIMER_ACTIVE` | Timer still running |
| 422 | — | Invalid / missing `reasonCode` |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Accept delivery

**API name:** Accept assigned offer  
**Method / path:** `PUT /partners/me/deliveries/:deliveryId/accept`  
**Who:** Rider. Must be **online** + KYC **active**. Idempotent if already accepted.

### Request

No body. Path: `deliveryId`.

### Success response `200`

```json
{ "success": true, "message": "Delivery accepted", "data": { } }
```

`data.status` → `accepted`, `nextAction` → `arrive_restaurant`, `canReject` → `false`, `canCancel` → `true`. Duty → `on_delivery`.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `PARTNER_NOT_ACTIVE` | KYC not approved |
| 409 | `PARTNER_OFFLINE` | Not online |
| 409 | `OFFER_EXPIRED` | Timeout elapsed |
| 409 | `DELIVERY_CAPACITY_FULL` | Already 3 active trips |
| 400 | `ILLEGAL_TRANSITION` | Not in `assigned` (unless already `accepted`) |
| 403 | `FORBIDDEN` | Not your offer |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Reject delivery

**API name:** Reject offer with reason code  
**Method / path:** `PUT /partners/me/deliveries/:deliveryId/reject`  
**Who:** Rider. **Only** while `status === assigned` (not after accept). Triggers reassign to next rider.

### Request

```json
{
  "reasonCode": "too_far",
  "reason": "Pickup is 8 km out of zone"
}
```

`reasonCode` required: `too_far` | `restaurant_closed` | `vehicle_issue` | `personal_emergency` | `order_too_large` | `already_on_delivery` | `other`  
`reason` optional note (max 200).

### Success response `200`

```json
{ "success": true, "message": "Delivery rejected", "data": { } }
```

`data.status` → `reassigned`. Partner goes back **online** unless another active trip remains. New offer is created for another rider (logged if none available).

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Already accepted / not an open offer |
| 403 | `FORBIDDEN` | Not your offer |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |
| 422 | — | Missing / invalid `reasonCode` |

---

## Arrive at restaurant

**API name:** Mark arrived at restaurant  
**Method / path:** `PUT /partners/me/deliveries/:deliveryId/arrived`  
**Who:** Rider. From `accepted`. Idempotent if already `arrived_at_restaurant`. Must ping GPS and be within **150 m** of restaurant pin.

### Request

No body. Path: `deliveryId`.

### Success response `200`

```json
{ "success": true, "message": "Marked arrived at restaurant", "data": { } }
```

`data.status` → `arrived_at_restaurant`, `nextAction` → `pickup`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Not `accepted` |
| 409 | `LOCATION_REQUIRED` | No live GPS |
| 409 | `GEOFENCE_NOT_MET` | Farther than 150 m |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Order not ready

**API name:** Flag kitchen wait  
**Method / path:** `PUT /partners/me/deliveries/:deliveryId/order-not-ready`  
**Who:** Rider. Only while `arrived_at_restaurant`. Starts `waitStartedAt` on first call; increments `orderNotReadyCount`.

### Request

No body.

### Success response `200`

```json
{ "success": true, "message": "Waiting for restaurant to prepare the order", "data": { } }
```

`data.waitStartedAt` set, `data.orderNotReadyCount` ≥ 1. Status unchanged.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Not at restaurant |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Pickup verify

**API name:** Submit pickup verification  
**Method / path:** `PUT /partners/me/deliveries/:deliveryId/pickup-verify`  
**Who:** Rider. While `arrived_at_restaurant`. Idempotent if already verified.

### Request

```json
{
  "otp": "4821",
  "photoUrl": "https://cdn.example.com/pickup/66b1.jpg",
  "itemChecklistOk": true
}
```

At least one of `otp` (4 digits), `photoUrl`, or `itemChecklistOk: true`.

### Success response `200`

```json
{ "success": true, "message": "Pickup verified", "data": { } }
```

`data.pickupVerified` → `true`. Status still `arrived_at_restaurant`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Not at restaurant |
| 400 | `INVALID_OTP` | OTP mismatch |
| 422 | — | No otp / photo / checklist |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Pickup

**API name:** Mark order picked up  
**Method / path:** `PUT /partners/me/deliveries/:deliveryId/pickup`  
**Who:** Rider. From `arrived_at_restaurant`. Geofence 150 m. Requires prior `pickup-verify` **or** `otp`/`photoUrl` on this body. Syncs order → `out_for_delivery`. Idempotent if already OFD.

### Request

```json
{
  "otp": "4821",
  "photoUrl": "https://cdn.example.com/pickup/66b1.jpg"
}
```

Body optional if pickup already verified.

### Success response `200`

```json
{ "success": true, "message": "Order picked up", "data": { } }
```

`data.status` → `out_for_delivery`, `nextAction` → `arrive_customer`. If wait was running, `waitEndedAt` / `waitMinutes` are set.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Not at restaurant |
| 409 | `PICKUP_VERIFY_REQUIRED` | No verify and no otp/photo |
| 409 | `LOCATION_REQUIRED` | No live GPS |
| 409 | `GEOFENCE_NOT_MET` | Farther than 150 m |
| 400 | `INVALID_OTP` | OTP mismatch |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Arrive at customer

**API name:** Mark arrived at drop pin  
**Method / path:** `PUT /partners/me/deliveries/:deliveryId/arrived-customer`  
**Who:** Rider. From `out_for_delivery` (or `picked_up`). Geofence **100 m**. Idempotent if already `arrived_at_customer`.

### Request

No body.

### Success response `200`

```json
{ "success": true, "message": "Marked arrived at customer", "data": { } }
```

`data.status` → `arrived_at_customer`, `nextAction` → `deliver`. Customer tracking ETA → 0.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Not out for delivery |
| 409 | `LOCATION_REQUIRED` | No live GPS |
| 409 | `GEOFENCE_NOT_MET` | Farther than 100 m |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Deliver

**API name:** Mark order delivered  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/deliver`  
**Who:** Rider. From `arrived_at_customer` or `out_for_delivery`. Drop geofence 100 m. At least one proof. Syncs order → `delivered`. Credits earnings. Restores duty (`online` unless another active trip). Idempotent if already delivered.

### Request

```json
{
  "otp": "4821",
  "proofPhotoUrl": "https://cdn.example.com/pod/66b1.jpg",
  "signatureUrl": "https://cdn.example.com/pod/66b1-sign.png"
}
```

At least one of `otp` (4 digits), `proofPhotoUrl`, `signatureUrl`.

### Success response `200`

```json
{ "success": true, "message": "Order delivered successfully", "data": { } }
```

`data.status` → `delivered`, `nextAction` → `null`, `otpVerified` true if OTP used.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Wrong status |
| 400 | `INVALID_OTP` | OTP mismatch |
| 409 | `LOCATION_REQUIRED` | No live GPS |
| 409 | `GEOFENCE_NOT_MET` | Farther than 100 m |
| 422 | — | No proof fields |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Cancel delivery

**API name:** Cancel in-progress trip  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/cancel`  
**Who:** Rider. After accept only (not while `assigned` — use reject). Idempotent if already cancelled.

Pre-pickup (`accepted` / `arrived_at_restaurant`) + rider reason (`vehicle_breakdown`, `personal_emergency`, `unsafe`, `other`) → **reassign**.  
Kitchen/customer reasons (`restaurant_closed`, `order_wrong`, `customer_cancelled`) or **after pickup** → order `cancelled`, no auto-reassign.

### Request

```json
{
  "reasonCode": "vehicle_breakdown",
  "reason": "Puncture on the way to store"
}
```

`reasonCode` required: `vehicle_breakdown` | `personal_emergency` | `restaurant_closed` | `order_wrong` | `customer_cancelled` | `unsafe` | `other`  
`reason` optional (max 200).

### Success response `200`

```json
{ "success": true, "message": "Delivery cancelled", "data": { } }
```

`data.status` → `cancelled`. Duty restored unless another active trip.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Still `assigned`, already delivered, or terminal |
| 422 | — | Missing / invalid `reasonCode` |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Report issue

**API name:** Report mid-trip issue  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/report-issue`  
**Who:** Rider. Any post-accept active status. Does **not** change delivery status; appends to `issues[]`.

### Request

```json
{
  "issueCode": "customer_unreachable",
  "note": "Called twice, no answer"
}
```

`issueCode` required: `wrong_address` | `customer_unreachable` | `item_damaged` | `item_missing` | `customer_refused` | `payment_issue` | `other`  
`note` optional (max 300).

### Success response `200`

```json
{ "success": true, "message": "Issue reported", "data": { } }
```

`data.issues` includes the new row (`code`, `note`, `reportedAt`, `statusAt`).

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Offer not accepted / already terminal |
| 422 | — | Missing / invalid `issueCode` |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Trip navigation route

**API name:** Current-leg turn-by-turn route  
**Method / path:** `GET /partners/me/deliveries/:deliveryId/route`  
**Who:** Rider (assigned trip only). Origin = live GPS. Destination = restaurant (pickup / RTO) or customer (drop). Google Directions steps when key is set; otherwise haversine + one synthetic step (`provider: "haversine"`).

### Request

Path: `deliveryId`. No body.

### Success response `200`

```json
{
  "success": true,
  "message": "Navigation route",
  "data": {
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "status": "out_for_delivery",
    "leg": "drop",
    "destination": { "latitude": 28.61, "longitude": 77.20, "kind": "customer" },
    "origin": { "latitude": 28.62, "longitude": 77.21 },
    "polyline": "enc...",
    "points": [{ "latitude": 28.62, "longitude": 77.21 }],
    "steps": [
      { "instruction": "Turn right onto Ring Road", "distanceMeters": 120, "durationSeconds": 25, "maneuver": "turn-right" }
    ],
    "nextInstruction": "Turn right onto Ring Road",
    "distanceMeters": 2400,
    "etaSeconds": 420,
    "etaAt": "2026-08-08T15:40:00.000Z",
    "provider": "google",
    "durationInTraffic": true,
    "trafficFactor": 1.2
  }
}
```

`leg`: `pickup` | `drop` | `return`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `LOCATION_REQUIRED` | No live GPS |
| 409 | `TRACKING_COMPLETE` | Terminal status / no pin |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Proof of delivery upload

**API name:** Upload POD photo / signature  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/proof-of-delivery`  
**Who:** Rider. Status `out_for_delivery` | `arrived_at_customer` | `returning_to_restaurant`. Does **not** complete the trip — call `/deliver` after (OTP and/or this proof).

### Request

`multipart/form-data` (CSRF required):

| Field | Required | Notes |
|---|---|---|
| `photo` | one of photo/signature | JPEG / PNG / WEBP, max 5 MB |
| `signature` | one of photo/signature | JPEG / PNG / WEBP, max 5 MB |

### Success response `200`

```json
{ "success": true, "message": "Proof of delivery uploaded", "data": { } }
```

**PartnerDeliveryDto** with `proofOfDelivery` and/or `signatureUrl` (Cloudinary HTTPS).

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `PROOF_FILE_REQUIRED` | No file |
| 400 | `ILLEGAL_TRANSITION` | Wrong status |
| 413 | `FILE_TOO_LARGE` | > 5 MB |
| 422 | `INVALID_FILE_TYPE` | Not an image |
| 503 | `UPLOAD_FAILED` | Cloudinary down (not faked) |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Customer unreachable (RTO timer)

**API name:** Log failed customer contact  
**Method / path:** `PUT /partners/me/deliveries/:deliveryId/customer-unreachable`  
**Who:** Rider. After pickup (`out_for_delivery` or `arrived_at_customer`). Attempt 1–2 logged; on attempt **2** a **5 min** RTO timer starts. Max **8** attempts. First attempt also appends `issues[]` `customer_unreachable`. System chat message is written.

### Request

```json
{ "channel": "call", "note": "Rang twice, no answer" }
```

`channel` optional: `call` | `chat` (default `call`). `note` optional max 300.

### Success response `200`

```json
{ "success": true, "message": "Customer unreachable logged", "data": { } }
```

**PartnerDeliveryDto**: `contactAttemptCount`, `rtoTimerEndsAt`, `rtoRemainingSeconds`, `canReturnToRestaurant`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Not after pickup |
| 409 | `RTO_ATTEMPTS_MAX` | Already 8 attempts |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Return to restaurant

**API name:** Start return-to-store  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/return-to-restaurant`  
**Who:** Rider. After pickup. Requires **2** unreachable attempts **and** RTO timer elapsed, **unless** `reasonCode` is `customer_refused` (immediate RTO). Order stays `out_for_delivery` (order-service has no RTO status). Delivery → `returning_to_restaurant`. Idempotent if already returning. Navigation `GET .../route` switches to restaurant (`leg: return`).

### Request

```json
{ "reasonCode": "customer_unreachable", "reason": "No one at the gate after timer" }
```

`reasonCode` required: `customer_unreachable` | `customer_refused` | `wrong_address` | `item_damaged` | `payment_issue` | `other`.

### Success response `200`

```json
{ "success": true, "message": "Returning to restaurant", "data": { } }
```

`data.status` → `returning_to_restaurant`, `nextAction` → `return_store`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Not after pickup / already terminal |
| 409 | `RTO_ATTEMPTS_REQUIRED` | Fewer than 2 contact attempts |
| 409 | `RTO_TIMER_REQUIRED` | Timer not started |
| 409 | `RTO_TIMER_ACTIVE` | Timer still running |
| 422 | — | Invalid `reasonCode` |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Delivery chat thread

**API name:** Get in-trip chat  
**Method / path:** `GET /partners/me/deliveries/:deliveryId/chat`  
**Who:** Rider (own trip). Open after accept through RTO; also **2 hours** after `delivered` / `returned`.

### Request query

| Query | Required | Notes |
|---|---|---|
| `limit` | no | default 50, max 100 |

### Success response `200`

```json
{
  "success": true,
  "message": "Chat thread",
  "data": {
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "status": "out_for_delivery",
    "count": 2,
    "messages": [
      {
        "id": "66d1...",
        "deliveryId": "66b1...",
        "orderId": "66c2...",
        "senderRole": "partner",
        "senderUserId": "66a1...",
        "to": "customer",
        "text": "I am at the gate",
        "createdAt": "2026-08-08T15:30:00.000Z"
      }
    ]
  }
}
```

`senderRole`: `partner` | `customer` | `restaurant` | `system`. `to`: `customer` | `restaurant` | `partner` | `all`.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Send delivery chat

**API name:** Send in-trip chat message  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/chat`  
**Who:** Rider. Rate limit **30 messages / 5 min** per rider+delivery. Publishes `DELIVERY_CHAT_MESSAGE` and socket `chat:new-message`.

### Request

```json
{ "to": "customer", "text": "I am at the gate, please come down" }
```

`to` required: `customer` | `restaurant`. `text` required, 1–500 chars.

### Success response `201`

```json
{ "success": true, "message": "Message sent", "data": { } }
```

`data` is one **DeliveryChatMessageDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `CHAT_CLOSED` | Trip not in a chat-open status |
| 429 | `CHAT_RATE_LIMITED` | Too many messages |
| 422 | `INVALID_CHAT` / — | Empty or invalid body |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Masked call — customer

**API name:** Initiate masked call to customer  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/call/customer`  
**Who:** Rider. After accept until RTO. Bridges rider phone → customer via **Exotel** (preferred) or **Twilio**. Never returns the full destination number. Max **8 calls / hour** per target. If telephony env is unset → `503 MASKED_CALL_UNAVAILABLE` (use chat; not a fake connect).

### Request

No body. Path: `deliveryId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Masked call to customer started",
  "data": {
    "callId": "66e1...",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "target": "customer",
    "status": "initiated",
    "toMasked": "******3210",
    "virtualNumberMasked": "******1001",
    "provider": "exotel",
    "createdAt": "2026-08-08T16:10:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 503 | `MASKED_CALL_UNAVAILABLE` | Exotel/Twilio not configured |
| 502 | `MASKED_CALL_FAILED` | Provider rejected the call |
| 409 | `PHONE_UNAVAILABLE` | Order has no customer phone |
| 409 | `PARTNER_PHONE_MISSING` | Rider profile has no phone |
| 429 | `CALL_RATE_LIMITED` | > 8 calls / hour |
| 400 | `ILLEGAL_TRANSITION` | Too early / terminal status |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Masked call — restaurant

**API name:** Initiate masked call to restaurant  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/call/restaurant`  
**Who:** Rider. Same rules as customer call. Destination = `order.restaurantPhone` (masked).

### Request

No body.

### Success response `200`

Same DTO with `"target": "restaurant"`.

### Errors

Same codes as customer call (`PHONE_UNAVAILABLE` if restaurant phone missing).

---

# Batching APIs

Multi-order stack (2–3 nearby restaurants, same rider). Service: **delivery-service**. Auth: 🔑 + 🚴 for rider paths; 🔒 for build. CSRF on PUT/POST.

Auto-batch: when a second nearby `assigned` offer lands on the same rider (restaurants within **3 km**), a live batch is created. `PartnerDeliveryDto.batchId` + `nextAction: "accept_batch"`. Accepting one offer in a batch accepts **all**. Pickup-all then drop-all nearest-neighbor; pickup must precede drop for every order.

---

## Batch details

**API name:** Get batched assignment  
**Method / path:** `GET /partners/me/deliveries/batch/:batchId`  
**Who:** Rider (own batch).

### Request

Path: `batchId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Batch details",
  "data": {
    "batchId": "66e1...",
    "status": "offered",
    "partnerId": "66a9...",
    "deliveryIds": ["66b1...", "66b2..."],
    "deliveries": [
      {
        "deliveryId": "66b1...",
        "orderId": "66c2...",
        "restaurantId": "66a8...",
        "status": "assigned",
        "deliveryFee": 40,
        "partnerEarnings": 32,
        "restaurantLocation": { "latitude": 28.62, "longitude": 77.21 },
        "deliveryLocation": { "latitude": 28.61, "longitude": 77.20 },
        "deliveryAddress": "House 12, Dwarka"
      }
    ],
    "sequence": [
      {
        "seq": 1,
        "deliveryId": "66b1...",
        "orderId": "66c2...",
        "restaurantId": "66a8...",
        "leg": "pickup",
        "label": "Pickup",
        "latitude": 28.62,
        "longitude": 77.21,
        "address": null,
        "metersFromPrev": 0
      },
      {
        "seq": 2,
        "deliveryId": "66b2...",
        "orderId": "66c3...",
        "restaurantId": "66a7...",
        "leg": "pickup",
        "label": "Pickup",
        "latitude": 28.63,
        "longitude": 77.22,
        "address": null,
        "metersFromPrev": 420
      },
      {
        "seq": 3,
        "deliveryId": "66b1...",
        "orderId": "66c2...",
        "restaurantId": "66a8...",
        "leg": "drop",
        "label": "Drop",
        "latitude": 28.61,
        "longitude": 77.20,
        "address": "House 12, Dwarka",
        "metersFromPrev": 1800
      }
    ],
    "sequenceConfirmed": false,
    "sequenceConfirmedAt": null,
    "suggested": true,
    "estimatedDistanceKm": 4.2,
    "estimatedMinutes": 14,
    "offeredAt": "2026-08-08T15:40:00.000Z",
    "acceptedAt": null,
    "offerExpiresAt": "2026-08-08T15:40:30.000Z",
    "timeoutSeconds": 30,
    "canAccept": true,
    "canConfirmSequence": false,
    "nextAction": "accept_batch"
  }
}
```

`status`: `offered` | `accepted` | `in_progress` | `completed` | `dissolved` | `expired`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `BATCH_NOT_FOUND` | Bad id |
| 403 | `FORBIDDEN` | Not your batch |

---

## Accept batch

**API name:** Accept full batch  
**Method / path:** `PUT /partners/me/deliveries/batch/:batchId/accept`  
**Who:** Rider. Must be **online** + KYC **active**. Accepts every `assigned` trip in the batch. Idempotent if already accepted. Single `PUT .../deliveries/:id/accept` on a batched offer also accepts the whole batch.

### Request

No body. Path: `batchId`.

### Success response `200`

**PartnerBatchDto** with `status: "accepted"`, all member deliveries `accepted`, `nextAction: "confirm_sequence"`. Duty → `on_delivery`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `BATCH_EXPIRED` | Offer timeout |
| 409 | `BATCH_INCOMPLETE` | A member was reassigned / cancelled |
| 409 | `DELIVERY_CAPACITY_FULL` | Would exceed 3 active trips |
| 409 | `PARTNER_OFFLINE` | Not online |
| 403 | `PARTNER_NOT_ACTIVE` | KYC not live |
| 400 | `ILLEGAL_TRANSITION` | Wrong batch status |
| 403 | `FORBIDDEN` | Not your batch |
| 404 | `BATCH_NOT_FOUND` | Bad id |

---

## Batch sequence

**API name:** Get / confirm pickup-drop sequence  
**Method / path:** `PUT /partners/me/deliveries/batch/:batchId/sequence`  
**Who:** Rider. After accept. Empty body / `{ "confirm": false }` returns (and stores) suggested nearest-neighbor sequence. `{ "confirm": true }` locks suggestion. `{ "stops": [...] }` validates + confirms a custom order. Pickup must come before drop for every `deliveryId`.

### Request

```json
{ "confirm": true }
```

or custom:

```json
{
  "stops": [
    { "deliveryId": "66b1...", "leg": "pickup" },
    { "deliveryId": "66b2...", "leg": "pickup" },
    { "deliveryId": "66b1...", "leg": "drop" },
    { "deliveryId": "66b2...", "leg": "drop" }
  ]
}
```

### Success response `200`

**PartnerBatchDto**. Confirmed → `sequenceConfirmed: true`, `status: "in_progress"`, `nextAction: "follow_sequence"`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `BATCH_NOT_ACCEPTED` | Still an open offer |
| 422 | `SEQUENCE_INVALID` | Wrong stop count, duplicate leg, drop before pickup, unknown delivery |
| 400 | `ILLEGAL_TRANSITION` | Expired / dissolved / completed |
| 403 | `FORBIDDEN` | Not your batch |
| 404 | `BATCH_NOT_FOUND` | Bad id |

---

## Build batch (internal)

**API name:** Build a batch from existing offers  
**Method / path:** `POST /internal/batch/build` · `POST /dispatch/batch/build`  
**Who:** Internal / dispatch. Restaurants must be within **3 km**. 2–3 deliveries, same partner, status `assigned` or `accepted`.

### Request

```json
{ "deliveryIds": ["66b1...", "66b2..."], "partnerId": "66a9..." }
```

`partnerId` optional if all deliveries already share a partner.

### Success response `201`

**PartnerBatchDto** `status: "offered"`.

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `BATCH_SIZE_INVALID` | Not 2–3 ids |
| 409 | `BATCH_TOO_FAR` | Restaurants farther than 3 km |
| 409 | `ALREADY_IN_BATCH` | A delivery is already in a live batch |
| 409 | `BATCH_PARTNER_MISMATCH` | Mixed riders |
| 409 | `DELIVERY_CAPACITY_FULL` | Rider at max 3 |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

# Dispatch APIs

Assign / reassign / broadcast / cancel / partner lists.  
Service: **delivery-service**. Internal: `x-internal-key`. Admin manual-assign: 🔑 + 🔐.  
Scoring: distance + acceptance rate + rating − cancellation rate. Skip list, `on_break`, max **3** active trips. Offer timeout from `ASSIGNMENT_TIMEOUT_SECONDS` (default 30s), max **3** hops → `NO_PARTNER_AVAILABLE`.

`/dispatch/*` and `/internal/reassign|cancel|broadcast|nearby-partners|available-partners` share the same handlers. Order-service keeps calling `POST /internal/assign`. Assignment engine: `GET /internal/partners/available` + Redis lock/unlock + `POST /internal/earnings/calculate` (quote only — never credits wallet).

---

## Dispatch assign

**API name:** Assign best eligible rider  
**Method / path:** `POST /dispatch/assign` · `POST /internal/assign`  
**Who:** Internal (order-service on kitchen `ready`, assignment engine, ops).

Skips `on_break`, skip-list, COD over limit, max 3 active trips, and Redis assign locks (unless `lockToken` matches). Optional `partnerId` + `lockToken` = locked manual assign (409 `PARTNER_LOCKED` on mismatch). Successful assign auto-unlocks the rider.

### Request

```json
{
  "orderId": "66c2...",
  "restaurantId": "66a8...",
  "restaurantLat": 28.62,
  "restaurantLng": 77.21,
  "deliveryLat": 28.61,
  "deliveryLng": 77.20,
  "deliveryAddress": "House 12, Dwarka",
  "deliveryFee": 40,
  "estimatedDistance": 3.2,
  "paymentMethod": "cod",
  "codAmount": 420,
  "partnerId": "66a9...",
  "lockToken": "a1b2c3d4e5f67890"
}
```

`partnerId` / `lockToken` optional. COD fields optional (prepaid default).

### Success response `201`

```json
{
  "success": true,
  "message": "Delivery assigned",
  "data": {
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "partnerId": "66a9...",
    "partnerName": "Ravi Kumar",
    "status": "assigned",
    "mode": "single",
    "timeoutSeconds": 30,
    "offeredTo": [
      { "partnerId": "66a9...", "name": "Ravi Kumar", "score": 71.2, "distanceKm": 1.4, "vehicleType": "motorcycle" }
    ]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 503 | `NO_PARTNER_AVAILABLE` | No eligible rider / max hops |
| 409 | `PARTNER_LOCKED` | Target rider locked by another engine token |
| 409 | `COD_LIMIT_EXCEEDED` | Nearby riders over COD cash cap |
| 422 | — | Validation |

---

## Dispatch reassign

**API name:** Reassign after timeout / reject / fail / cancel  
**Method / path:** `POST /dispatch/reassign` · `POST /internal/reassign`  
**Who:** Internal. Pre-pickup live trip → skip current rider + new offer. Terminal `cancelled` / `failed` / `reassigned` (or no live trip) → retry assign using cached Redis/log pins or body pins. After pickup / delivered / returned → `409 ILLEGAL_TRANSITION`.

### Request

```json
{
  "orderId": "66c2...",
  "reason": "Rider timeout",
  "restaurantId": "66a8...",
  "restaurantLat": 28.62,
  "restaurantLng": 77.21,
  "deliveryLat": 28.61,
  "deliveryLng": 77.20,
  "deliveryAddress": "House 12, Dwarka",
  "deliveryFee": 40
}
```

Pins optional when Redis pending-assignment or last dispatch log still has them.

### Success response `200`

Same **DispatchAssignDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ILLEGAL_TRANSITION` | After pickup / delivered / returned |
| 409 | `ASSIGN_INPUT_MISSING` | No cached or body pins |
| 503 | `NO_PARTNER_AVAILABLE` | No next rider |

---

## Dispatch manual assign

**API name:** Force a rider onto an order  
**Method / path:** `POST /dispatch/manual-assign` · `POST /admin/dispatch/manual-assign`  
**Who:** Admin. Rider must be KYC active, online, not on break, under capacity.

### Request

Assign body **plus** `"partnerId": "66a9..."`.

### Success response `201`

**DispatchAssignDto** with `mode: "manual"`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `PARTNER_NOT_ACTIVE` / `PARTNER_OFFLINE` / `PARTNER_ON_BREAK` / `DELIVERY_CAPACITY_FULL` | Rider not eligible |
| 409 | `ILLEGAL_TRANSITION` | Live trip already past pickup |
| 404 | `PARTNER_NOT_FOUND` | Bad partnerId |

---

## Dispatch cancel

**API name:** Cancel active assignment  
**Method / path:** `POST /dispatch/cancel` · `POST /internal/cancel`  
**Who:** Internal (order cancelled, ops). Syncs order → `cancelled`. Does **not** auto-reassign.

### Request

```json
{ "orderId": "66c2...", "reason": "Customer cancelled" }
```

`orderId` or `deliveryId` required.

### Success response `200`

```json
{
  "success": true,
  "message": "Assignment cancelled",
  "data": { "deliveryId": "66b1...", "orderId": "66c2...", "status": "cancelled" }
}
```

---

## Dispatch broadcast

**API name:** Broadcast offer to nearby riders  
**Method / path:** `POST /dispatch/broadcast` · `POST /internal/broadcast`  
**Who:** Internal. Same assign body + optional `maxRiders` (2–8, default 5). First rider to **accept** claims the trip (broadcast set in Redis).

### Request

Assign body + `"maxRiders": 5`.

### Success response `201`

**DispatchAssignDto** with `mode: "broadcast"` and `offeredTo[]` (scored list).

---

## Nearby partners

**API name:** List online partners near a pin  
**Method / path:** `GET /dispatch/nearby-partners` · `GET /internal/nearby-partners`  
**Who:** Internal / ops map.

### Request query

| Query | Required | Notes |
|---|---|---|
| `lat` | yes | |
| `lng` | yes | |
| `radiusKm` | no | default assignment radius, max 50 |
| `limit` | no | default 20, max 50 |

### Success response `200`

```json
{
  "success": true,
  "message": "Nearby online partners",
  "data": {
    "count": 2,
    "partners": [
      {
        "partnerId": "66a9...",
        "name": "Ravi K.",
        "phoneMasked": "******3210",
        "vehicleType": "motorcycle",
        "dutyStatus": "online",
        "isAvailable": true,
        "isOnline": true,
        "avgRating": 4.7,
        "acceptanceRate": 92,
        "activeDeliveries": 0,
        "distanceKm": 1.4,
        "zoneId": "66z1..."
      }
    ]
  }
}
```

---

## Available partners

**API name:** List eligible available partners  
**Method / path:** `GET /dispatch/available-partners` · `GET /internal/available-partners`  
**Who:** Internal.

### Request query

| Query | Required | Notes |
|---|---|---|
| `zoneId` | no | filter hub |
| `limit` | no | default 20, max 50 |

### Success response `200`

Paginated `{ data, total, page, limit, totalPages }` of **DispatchPartnerDto** (`distanceKm` may be `null`).

---

## Busy partners

**API name:** List partners currently delivering  
**Method / path:** `GET /dispatch/busy-partners` · `GET /internal/busy-partners`  
**Who:** Internal / ops map. Riders with `dutyStatus=on_delivery` or online-but-unavailable (on offer / trip).

### Request query

| Query | Required | Notes |
|---|---|---|
| `zoneId` | no | filter hub |
| `limit` | no | default 50, max 50 |

### Success response `200`

```json
{
  "success": true,
  "message": "Busy partners",
  "data": {
    "count": 1,
    "partners": [
      {
        "partnerId": "66a9...",
        "name": "Ravi K.",
        "phoneMasked": "******3210",
        "vehicleType": "motorcycle",
        "dutyStatus": "on_delivery",
        "isAvailable": false,
        "isOnline": true,
        "avgRating": 4.7,
        "acceptanceRate": 92,
        "activeDeliveries": 1,
        "distanceKm": null,
        "zoneId": "66z1...",
        "currentDeliveries": [
          {
            "deliveryId": "66b1...",
            "orderId": "66c2...",
            "status": "out_for_delivery",
            "assignedAt": "2026-08-08T15:40:00.000Z"
          }
        ]
      }
    ]
  }
}
```

---

## Dispatch queue

**API name:** View pending dispatch queue  
**Method / path:** `GET /dispatch/queue` · `GET /internal/queue`  
**Who:** Internal / ops. Combines open offers (`assigned`), stuck expired offers, and `no_partner` failures from the last 6 hours that still have no live trip. Sorted: expired → no-partner → waiting offer.

### Request query

| Query | Required | Notes |
|---|---|---|
| `limit` | no | default 100, max 100 |

### Success response `200`

```json
{
  "success": true,
  "message": "Dispatch queue",
  "data": {
    "count": 2,
    "items": [
      {
        "kind": "offer_expired",
        "orderId": "66c2...",
        "deliveryId": "66b1...",
        "restaurantId": "66a8...",
        "partnerId": "66a9...",
        "partnerName": "Ravi K.",
        "status": "assigned",
        "mode": "single",
        "assignedAt": "2026-08-08T15:40:00.000Z",
        "expiresAt": "2026-08-08T15:40:30.000Z",
        "elapsedSeconds": 45,
        "hop": null,
        "reason": "Offer timed out — retry or wait for auto-reassign",
        "canRetry": true
      },
      {
        "kind": "no_partner",
        "orderId": "66c3...",
        "deliveryId": null,
        "restaurantId": "66a8...",
        "partnerId": null,
        "partnerName": null,
        "status": "unassigned",
        "mode": "single",
        "assignedAt": "2026-08-08T15:41:00.000Z",
        "expiresAt": null,
        "elapsedSeconds": 120,
        "hop": 3,
        "reason": "No eligible riders in radius",
        "canRetry": true
      }
    ]
  }
}
```

`kind`: `offer` | `offer_expired` | `no_partner`.

---

## Dispatch logs

**API name:** View dispatch activity history  
**Method / path:** `GET /dispatch/logs` · `GET /admin/dispatch/logs`  
**Who:** Admin. Append-only Mongo audit: assign, broadcast, manual_assign, reassign, cancel, retry, timeout, reject, accept, no_partner.

### Request query

| Query | Required | Notes |
|---|---|---|
| `orderId` | no | filter one order |
| `action` | no | one of the actions above |
| `from` / `to` | no | ISO timestamps |
| `page` / `limit` | no | default 20, max 100 |

### Success response `200`

```json
{
  "success": true,
  "message": "Dispatch logs",
  "data": {
    "data": [
      {
        "logId": "66e9...",
        "orderId": "66c2...",
        "deliveryId": "66b1...",
        "partnerId": "66a9...",
        "action": "timeout",
        "mode": "single",
        "reason": "Offer timed out",
        "actor": "system",
        "hop": 0,
        "createdAt": "2026-08-08T15:40:30.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

## Dispatch statistics

**API name:** View dispatch metrics  
**Method / path:** `GET /dispatch/statistics` · `GET /admin/dispatch/statistics`  
**Who:** Admin. Default window = today IST (`Asia/Kolkata`) → now.

### Request query

| Query | Required | Notes |
|---|---|---|
| `from` / `to` | no | ISO timestamps |

### Success response `200`

```json
{
  "success": true,
  "message": "Dispatch statistics",
  "data": {
    "timezone": "Asia/Kolkata",
    "from": "2026-08-07T18:30:00.000Z",
    "to": "2026-08-08T16:00:00.000Z",
    "partners": {
      "online": 12, "available": 7, "onDelivery": 4, "onBreak": 1, "offline": 20, "activeKyc": 32
    },
    "liveDeliveries": { "assigned": 3, "inTrip": 8, "returning": 1, "total": 12 },
    "window": {
      "assigned": 40, "accepted": 28, "delivered": 22, "cancelled": 3,
      "reassigned": 9, "returned": 1,
      "timeouts": 6, "rejects": 4, "noPartner": 2, "retries": 3,
      "manualAssigns": 1, "broadcasts": 2
    },
    "rates": { "acceptancePercent": 73.7, "timeoutPercent": 15.8, "cancelPercent": 11.5 },
    "avgAssignToAcceptSeconds": 18,
    "avgTripMinutes": 24.5
  }
}
```

---

## Dispatch retry

**API name:** Retry rider assignment  
**Method / path:** `POST /dispatch/retry` · `POST /internal/retry`  
**Who:** Internal / ops. After timeout, reject hop, or `NO_PARTNER_AVAILABLE`. Uses cached pins (Redis or last dispatch log). Live pre-pickup trip → reassign (skip current rider). No live trip → new assign. After pickup → `409 ILLEGAL_TRANSITION`.

### Request

```json
{ "orderId": "66c2...", "reason": "Ops retry after no partner" }
```

Optional full assign pins (same as assign) if cache expired.

### Success response `200`

Same **DispatchAssignDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ILLEGAL_TRANSITION` | After pickup |
| 409 | `ASSIGN_INPUT_MISSING` | No cached / body pins |
| 503 | `NO_PARTNER_AVAILABLE` | Still no eligible rider |
| 404 | `DELIVERY_NOT_FOUND` | Reassign with unknown live trip |

---

## Assignment error codes

| code | HTTP | Meaning |
|---|---|---|
| `PARTNER_NOT_ACTIVE` | 403 | KYC not live |
| `PARTNER_OFFLINE` | 409 | Go online first |
| `OFFER_EXPIRED` | 409 | Accept after timeout |
| `DELIVERY_CAPACITY_FULL` | 409 | Max 3 active deliveries |
| `ILLEGAL_TRANSITION` | 400 | Wrong status for this step |
| `LOCATION_REQUIRED` | 409 | Ping GPS before arrive/pickup/deliver |
| `GEOFENCE_NOT_MET` | 409 | Outside 150 m pickup / 100 m drop |
| `PICKUP_VERIFY_REQUIRED` | 409 | Verify OTP/photo before pickup |
| `INVALID_OTP` | 400 | Pickup or drop OTP mismatch |
| `INVALID_STATUS` | 422 | Bad history `?status=` |
| `FORBIDDEN` | 403 | Not your delivery |
| `DELIVERY_NOT_FOUND` | 404 | Unknown id |
| `PROOF_FILE_REQUIRED` | 400 | POD upload missing file |
| `PROOF_REQUIRED` | 422 | Deliver without OTP or POD |
| `UPLOAD_FAILED` | 503 | Cloudinary failed |
| `FILE_TOO_LARGE` | 413 | Upload > 5 MB |
| `INVALID_FILE_TYPE` | 422 | POD not JPEG/PNG/WEBP |
| `RTO_ATTEMPTS_REQUIRED` | 409 | Need 2 customer contact attempts |
| `RTO_ATTEMPTS_MAX` | 409 | Max unreachable attempts |
| `RTO_TIMER_REQUIRED` | 409 | Start unreachable timer first |
| `RTO_TIMER_ACTIVE` | 409 | Wait for RTO timer |
| `SIGNATURE_REQUIRED` | 400 | Signature capture missing file/URL |
| `CHAT_CLOSED` | 409 | Chat not allowed on this status |
| `CHAT_RATE_LIMITED` | 429 | Chat flood protection |
| `TRACKING_COMPLETE` | 409 | No navigation leg |
| `MASKED_CALL_UNAVAILABLE` | 503 | Exotel/Twilio not configured |
| `MASKED_CALL_FAILED` | 502 | Telephony provider error |
| `PHONE_UNAVAILABLE` | 409 | Order missing dest phone |
| `PARTNER_PHONE_MISSING` | 409 | Rider has no phone |
| `CALL_RATE_LIMITED` | 429 | Too many masked calls |
| `NO_PARTNER_AVAILABLE` | 503 | Dispatch found no rider |
| `BATCH_NOT_FOUND` | 404 | Unknown batch id |
| `BATCH_EXPIRED` | 409 | Batch offer timed out |
| `BATCH_INCOMPLETE` | 409 | A member left the batch |
| `BATCH_TOO_FAR` | 409 | Restaurants outside cluster |
| `BATCH_SIZE_INVALID` | 422 | Not 2–3 orders |
| `ALREADY_IN_BATCH` | 409 | Delivery already stacked |
| `BATCH_NOT_ACCEPTED` | 409 | Accept batch before confirming sequence |
| `SEQUENCE_INVALID` | 422 | Illegal stop order |
| `ASSIGN_INPUT_MISSING` | 409 | Reassign without cached pins |
| `PARTNER_ON_BREAK` | 409 | Manual assign while on break |
| `OFFER_TAKEN` | 409 | Another rider claimed a broadcast offer |
| `PARTNER_LOCKED` | 409 | Redis assign lock held by another token |
| `LOCK_TOKEN_MISMATCH` | 409 | Unlock token does not match |

---

# Internal Service APIs

Service-to-service (`x-internal-key`). Gateway: `/api/v1/delivery-service`.  
Used by order-service (kitchen ready → assign / create-delivery), assignment engine (available + lock + eligibility), finance (`calculate` then `credit`), cron weekly payouts, KYC/BG/bank webhooks, and notification dispatch.

Register `/internal/partners/*`, `/internal/earnings/*`, `/internal/complete`, `/internal/status-sync`, `/internal/payment-sync`, `/internal/location-sync`, `/internal/eta|distance|surge/calculate`, and `/internal/health` **before** `GET /internal/:orderId/location` so `:orderId` never captures those paths.

---

## Internal assign

See [Dispatch assign](#dispatch-assign) (`POST /internal/assign`).

---

## Internal reassign

See [Dispatch reassign](#dispatch-reassign) (`POST /internal/reassign`).

---

## Internal partner location

**API name:** Real-time partner GPS for an order  
**Method / path:** `GET /internal/:orderId/location`  
**Who:** Internal (order-service / tracking gateway). Assigned rider Redis GPS, or pending-assignment partner if offer not accepted yet.

### Request

Path `orderId`. No body.

### Success response `200`

```json
{
  "success": true,
  "message": "Partner location",
  "data": {
    "partnerId": "66a9...",
    "latitude": 28.6139,
    "longitude": 77.2090,
    "heading": 180,
    "speed": 22.5,
    "accuracy": 12,
    "updatedAt": "2026-08-09T09:30:00.120Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | — | No live delivery / pending assign, or rider not streaming GPS |

---

## Internal available partners

**API name:** Available / online partners for assignment engine  
**Method / path:** `GET /internal/partners/available`  
**Who:** Internal. Alias of nearby (pin) or available-partners (zone / all online).

### Request query

| Query | Required | Notes |
|---|---|---|
| `lat` + `lng` | no* | Together → nearby search |
| `radiusKm` | no | With pin; default `ASSIGNMENT_RADIUS_KM`, max 50 |
| `zoneId` | no | With pin: filter DTO zone. Without pin: hub available list |
| `limit` | no | default 20, max 50 |

\* If neither pin nor useful zone, returns online+available partners (same as `/internal/available-partners`).

### Success response `200` (pin)

```json
{
  "success": true,
  "message": "Available partners",
  "data": {
    "count": 1,
    "radiusKm": 5,
    "zoneId": null,
    "partners": [
      {
        "partnerId": "66a9...",
        "name": "Ravi K.",
        "phoneMasked": "******3210",
        "vehicleType": "motorcycle",
        "dutyStatus": "online",
        "isAvailable": true,
        "isOnline": true,
        "avgRating": 4.7,
        "acceptanceRate": 92,
        "activeDeliveries": 0,
        "distanceKm": 1.4,
        "zoneId": "66z1..."
      }
    ]
  }
}
```

Without pin: paginated `{ data, total, page, limit, totalPages }` of **DispatchPartnerDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Only one of lat/lng, bad radius |

---

## Internal lock partner

**API name:** Temporarily lock a rider from new auto-assigns  
**Method / path:** `POST /internal/partners/:partnerId/lock`  
**Who:** Internal assignment engine. Redis `SET NX` + TTL (default 30s, min 5, max 120). Same `token` refreshes TTL. Auto-assign skips locked riders. Manual/engine assign with matching `lockToken` is allowed; success auto-unlocks.

### Request

```json
{ "ttlSeconds": 30, "token": "a1b2c3d4e5f67890", "reason": "engine-hold" }
```

`token` optional — server generates 32-hex if omitted. Return the token; unlock needs it.

### Success response `200`

```json
{
  "success": true,
  "message": "Partner locked",
  "data": {
    "partnerId": "66a9...",
    "locked": true,
    "token": "a1b2c3d4e5f67890",
    "expiresInSeconds": 30,
    "expiresAt": "2026-08-09T09:30:30.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PARTNER_NOT_FOUND` | Unknown partner |
| 409 | `PARTNER_LOCKED` | Another token already holds the lock |
| 422 | `VALIDATION_ERROR` | ttl / token shape |

---

## Internal unlock partner

**API name:** Release assignment lock  
**Method / path:** `POST /internal/partners/:partnerId/unlock`  
**Who:** Internal. Matching token only. Idempotent if lock already expired.

### Request

```json
{ "token": "a1b2c3d4e5f67890" }
```

### Success response `200`

```json
{
  "success": true,
  "message": "Partner unlocked",
  "data": {
    "partnerId": "66a9...",
    "locked": false,
    "token": null,
    "expiresInSeconds": null,
    "expiresAt": null
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PARTNER_NOT_FOUND` | Unknown partner |
| 409 | `LOCK_TOKEN_MISMATCH` | Wrong token (lock stays) |
| 422 | `VALIDATION_ERROR` | Missing token |

---

## Internal calculate earnings

**API name:** Quote rider pay (fare + surge + wait + tip + incentive)  
**Method / path:** `POST /internal/earnings/calculate`  
**Who:** Internal (order/payment before credit). **Does not** increment wallet / IST daily ledger. `credited` is always `false`.

Formula: `(baseFare + distanceKm × per-km + waitMinutes × ₹1) × surgeMultiplier × 80% partner share + tip + incentive`. Base fare = `deliveryFee` or `PARTNER_BASE_DELIVERY_FEE`. Surge from body or drop-pin zone (`surgeMultiplier`, default 1). TDS shown, not withheld here.

### Request

```json
{
  "deliveryId": "66b1...",
  "orderId": "66c2...",
  "deliveryFee": 40,
  "distanceKm": 3.2,
  "waitMinutes": 8,
  "surgeMultiplier": 1.2,
  "tip": 20,
  "incentiveBonus": 15
}
```

Need **one of** `deliveryId`, `orderId`, or `deliveryFee`. Loaded delivery fills missing fee / distance / wait / incentive; zone surge if drop pin exists.

### Success response `200`

```json
{
  "success": true,
  "message": "Earnings calculated",
  "data": {
    "currency": "INR",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "deliveryFee": 40,
    "distanceKm": 3.2,
    "waitMinutes": 8,
    "surgeMultiplier": 1.2,
    "partnerSharePct": 80,
    "breakdown": {
      "baseFare": 40,
      "distanceFare": 25.6,
      "waitFare": 8,
      "surgedFare": 88.32,
      "tip": 20,
      "incentive": 15,
      "platformFee": 17.66,
      "tds": 1.06
    },
    "partnerEarnings": 70.66,
    "total": 105.66,
    "credited": false
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | Bad deliveryId / orderId |
| 422 | `VALIDATION_ERROR` | No fee and no delivery to load |

---

## Internal credit earnings

**API name:** Credit calculated earnings to wallet  
**Method / path:** `POST /internal/earnings/credit`  
**Who:** Internal (payment/order after deliver). Auth: `x-internal-key`.

Credits **delta only** vs `earningsCreditedAmount` (deliver already credits `partnerEarnings + incentiveBonus`). Use this for wait/surge/tip top-up. Never double-counts. Delivery must be `delivered`. `credited` is always true; `idempotent` true when delta is ₹0.

### Request

```json
{
  "partnerId": "66a9...",
  "deliveryId": "66b1...",
  "amount": 105.66,
  "tip": 20,
  "incentiveBonus": 15
}
```

`amount` optional — defaults to `/internal/earnings/calculate` total.

### Success response `200`

```json
{
  "success": true,
  "message": "Earnings credited",
  "data": {
    "currency": "INR",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "partnerId": "66a9...",
    "status": "delivered",
    "quotedTotal": 105.66,
    "alreadyCredited": 32,
    "deltaCredited": 73.66,
    "creditedAmount": 105.66,
    "walletBalance": 1840.66,
    "credited": true,
    "idempotent": false,
    "breakdown": {
      "baseFare": 40,
      "distanceFare": 25.6,
      "waitFare": 8,
      "surgedFare": 88.32,
      "tip": 20,
      "incentive": 15,
      "platformFee": 17.66,
      "tds": 1.06
    }
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` / `PARTNER_NOT_FOUND` | Bad ids |
| 409 | `DELIVERY_NOT_COMPLETE` | Not delivered yet |
| 409 | `PARTNER_MISMATCH` | partnerId ≠ delivery rider |
| 422 | `AMOUNT_TOO_LARGE` | amount > ₹50000 |

---

## Internal process weekly payouts

**API name:** Cron weekly payout batch  
**Method / path:** `POST /internal/payouts/process-batch`  
**Who:** Cron / ops. Auth: `x-internal-key`.

Scans KYC-active + penny-drop **verified** riders with unpaid wallet ≥ ₹1. Submits **weekly** transfers to payment-service. Never marks `paid` without gateway. Cap 50 per run. `dryRun: true` lists candidates only.

### Request

```json
{ "period": "2026-W32", "limit": 50, "dryRun": false, "partnerId": "66a9..." }
```

All fields optional. `partnerId` processes one rider.

### Success response `200`

```json
{
  "success": true,
  "message": "Weekly payout batch processed",
  "data": {
    "period": "2026-W32",
    "dryRun": false,
    "scanned": 12,
    "created": 8,
    "skipped": 3,
    "failed": 1,
    "items": [
      {
        "partnerId": "66a9...",
        "outcome": "created",
        "reason": null,
        "payout": {
          "payoutId": "66c1...",
          "kind": "weekly",
          "status": "pending",
          "period": "weekly:2026-08-09:weekly:66a9...:2026-W32",
          "grossAmount": 2400,
          "feeAmount": 0,
          "tdsAmount": 0,
          "netAmount": 2400
        }
      }
    ]
  }
}
```

`outcome`: `created` \| `skipped` \| `failed` \| `dry_run`. Skip reasons: `BANK_NOT_VERIFIED`, `BELOW_MINIMUM`, `PARTNER_NOT_ACTIVE`.

---

## Internal ratings submit

See [Internal: submit rating](#internal-submit-rating) (`POST /internal/ratings/submit`). Already live.

---

## Internal dispatch notification

**API name:** Dispatch notification to one rider  
**Method / path:** `POST /internal/notifications/dispatch`  
**Who:** Internal (order/payment/admin). Auth: `x-internal-key`.

Resolves partner → `userId`, then `POST notification-service /internal/notifications`. Never fakes delivered: `pushed: false` + `degradedReason: NOTIFICATION_SERVICE_UNAVAILABLE` if the service is down.

### Request

```json
{
  "partnerId": "66a9...",
  "title": "Payout sent",
  "message": "Your weekly payout of ₹2400 is processing.",
  "type": "payment",
  "data": { "payoutId": "66c1..." }
}
```

`type`: `order_update` \| `delivery_update` \| `payment` \| `system` (default).

### Success response `200`

```json
{
  "success": true,
  "message": "Notification dispatched",
  "data": {
    "partnerId": "66a9...",
    "userId": "66u1...",
    "pushed": true,
    "notificationId": "66n1...",
    "degradedReason": null
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PARTNER_NOT_FOUND` | Unknown partner |
| 422 | `VALIDATION_ERROR` | title/message too short |

---

## Notification-service: create for user

**API name:** Internal create notification  
**Method / path:** `POST /internal/notifications`  
**Who:** Servers that only need create (prefer `/internal/dispatch` for honest push counts). Auth: `x-internal-key`. Gateway: `/api/v1/notification-service`.

### Request

```json
{
  "userId": "66u1...",
  "type": "delivery_update",
  "title": "New delivery",
  "message": "Order #FD-1024 is ready for pickup.",
  "data": { "deliveryId": "66c2...", "orderId": "66b1..." },
  "targetRole": "delivery_partner"
}
```

`type`: `order_update` \| `delivery_update` \| `payment` \| `system` \| `broadcast`.

### Success `201`

Persisted notification document. Also publishes Redis `NOTIFICATION_CREATED` → gateway `notification:new`, and attempts FCM to registered devices (failures are logged; use `/internal/dispatch` for counts).

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Missing / invalid fields |
| 403 | — | Missing or bad `x-internal-key` |

---

# Notification devices + dispatch

Gateway prefix: `/api/v1/notification-service`. Auth for `/devices*`: 🔑 session. Internal: `x-internal-key`.

## Register device

**API name:** Register push device  
**Method / path:** `POST /devices/register`  
**Who:** customer / rider / kitchen apps (any logged-in user).

### Request

```json
{
  "token": "fcm-or-web-push-token...",
  "platform": "android",
  "app": "customer",
  "deviceId": "optional-client-id",
  "appVersion": "1.2.0",
  "city": "Bengaluru",
  "tier": "gold",
  "zoneId": "66z1..."
}
```

`platform`: `android` \| `ios` \| `web`. `app`: `customer` \| `rider` \| `kitchen`.  
Optional `city` / `tier` / `zoneId` used by broadcast segment filters (rider register syncs zone/tier from delivery-service).

### Success `201`

```json
{
  "success": true,
  "message": "Device registered",
  "data": {
    "deviceId": "66d1...",
    "platform": "android",
    "app": "customer",
    "tokenMasked": "abcd…wxyz",
    "clientDeviceId": "optional-client-id",
    "appVersion": "1.2.0",
    "city": "Bengaluru",
    "tier": "gold",
    "zoneId": "66z1...",
    "lastSeenAt": "2026-08-12T18:00:00.000Z",
    "registeredAt": "2026-08-12T18:00:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No session |
| 422 | `VALIDATION_ERROR` | Bad body |

---

## List devices

**API name:** List my devices  
**Method / path:** `GET /devices`  
**Who:** any authenticated user.

### Success `200`

```json
{
  "success": true,
  "data": {
    "devices": [
      {
        "deviceId": "66d1...",
        "platform": "android",
        "app": "customer",
        "tokenMasked": "abcd…wxyz",
        "clientDeviceId": null,
        "appVersion": "1.2.0",
        "lastSeenAt": "2026-08-12T18:00:00.000Z",
        "registeredAt": "2026-08-12T18:00:00.000Z"
      }
    ]
  }
}
```

---

## Unregister device

**API name:** Unregister device  
**Method / path:** `DELETE /devices/:deviceId`  
**Who:** device owner.

### Success `200`

```json
{ "success": true, "data": { "deleted": true } }
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DEVICE_NOT_FOUND` | Unknown id for this user |

---

## Internal device upsert

**API name:** Upsert device (proxy)  
**Method / path:** `POST /internal/devices/upsert`  
**Who:** delivery-service / restaurant-service after local device register. Auth: `x-internal-key`.

### Request

Same as register + `userId` (optional `city` / `tier` / `zoneId` for segment fan-out).

### Success `201`

Device DTO (same shape as register).

---

## Internal dispatch

**API name:** Dispatch inbox + push  
**Method / path:** `POST /internal/dispatch`  
**Who:** delivery / order / restaurant / review services; payment events via Redis subscriber. Auth: `x-internal-key`.

### Request

```json
{
  "userId": "66u1...",
  "type": "order_update",
  "title": "Out for delivery",
  "message": "Your order is on the way.",
  "data": { "orderId": "66b1..." },
  "targetRole": "customer",
  "channels": ["inbox", "push"],
  "idempotencyKey": "order:66b1:out_for_delivery"
}
```

`channels` defaults to `["inbox","push"]`. `idempotencyKey` optional — cached 24h.  
`targetRole: delivery_partner` merges live prefs from delivery-service when `DELIVERY_SERVICE_URL` is set.  
Per-user / per-template Redis rate caps (`RATE_LIMIT_*`) → **429** `RATE_LIMITED`. Failed push enqueues `DispatchJob` (background worker + admin retry).

### Success `201`

```json
{
  "success": true,
  "message": "Dispatched",
  "data": {
    "notificationId": "66n1...",
    "inbox": true,
    "push": { "attempted": 2, "delivered": 1, "failed": 1 },
    "degradedReason": null
  }
}
```

`degradedReason` examples: `NO_DEVICES` · `PUSH_UNAVAILABLE` (FCM unset / init fail) · `PUSH_FAILED` (all tokens failed) · `PREF_BLOCKED` · `QUIET_HOURS`. Inbox may still be `true`.

When `channels: ["push"]` only and FCM is unset → **503** `PUSH_UNAVAILABLE`.

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Bad body |
| 429 | `RATE_LIMITED` | Per-user or per-template cap exceeded |
| 503 | `PUSH_UNAVAILABLE` | Push-only + FCM not configured |
| 403 | — | Bad internal key |

---

# Notification multi-channel (SMS / email / WhatsApp)

Gateway: `/api/v1/notification-service`. Auth: `x-internal-key` for `/internal/*`. Webhooks: `CHANNEL_WEBHOOK_SECRET` via `x-webhook-secret`, `?secret=`, or `x-webhook-signature` HMAC-SHA256.

## Send SMS

**API name:** Internal SMS send  
**Method / path:** `POST /internal/channels/sms`  
**Who:** restaurant (staff invite), order/ops servers.

### Request

```json
{
  "to": "+919876543210",
  "templateKey": "staff_invite",
  "data": {
    "inviteeName": "Ravi",
    "role": "manager",
    "restaurantName": "Spice Hub",
    "inviteUrl": "https://app.example.com/invite?token=..."
  }
}
```

Or `{ "to": "+91...", "body": "Your OTP is 123456" }`.

### Success `201`

```json
{
  "success": true,
  "message": "SMS sent",
  "data": {
    "messageId": "66m1...",
    "channel": "sms",
    "status": "sent",
    "provider": "twilio",
    "providerMessageId": "SMxxxx",
    "toMasked": "******3210",
    "skipped": false,
    "skippedReason": null,
    "errorCode": null
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Bad body |
| 503 | `CHANNEL_UNAVAILABLE` | Twilio/MSG91 unset |
| 503 | `CHANNEL_SEND_FAILED` | Provider rejected (ledger still created; `data.messageId` present) |
| 429 | `RATE_LIMITED` | Per-user / per-template Redis cap |

---

## Send email

**API name:** Internal email send  
**Method / path:** `POST /internal/channels/email`  
**Who:** restaurant staff invite, receipts, ops.

### Request

```json
{
  "to": "chef@example.com",
  "templateKey": "staff_invite",
  "data": {
    "inviteeName": "Ravi",
    "role": "manager",
    "restaurantName": "Spice Hub",
    "inviteUrl": "https://app.example.com/invite?token=..."
  }
}
```

Or `{ "to": "...", "subject": "...", "html": "<p>...</p>", "text": "..." }`.

### Success `201`

Same channel DTO with `channel: "email"`, `provider: "smtp"`.

### Errors

Same as SMS (`CHANNEL_UNAVAILABLE` when SMTP unset).

---

## Send WhatsApp

**API name:** Internal WhatsApp send  
**Method / path:** `POST /internal/channels/whatsapp`  
**Who:** servers (opt-in only).

### Request

```json
{
  "to": "+919876543210",
  "body": "Your order is out for delivery.",
  "optIn": true
}
```

### Success `201`

Channel DTO (`provider: "twilio"`).

### Skip `200` (`optIn: false`)

```json
{
  "success": true,
  "message": "PREF_BLOCKED",
  "data": {
    "messageId": "66m2...",
    "channel": "whatsapp",
    "status": "skipped",
    "provider": "none",
    "providerMessageId": null,
    "toMasked": "******3210",
    "skipped": true,
    "skippedReason": "PREF_BLOCKED",
    "errorCode": null
  }
}
```

### Errors

`CHANNEL_UNAVAILABLE` when `TWILIO_WHATSAPP_FROM` / Twilio unset.

---

## Get channel message status

**API name:** Channel message status  
**Method / path:** `GET /internal/messages/:messageId`  
**Who:** servers / ops.

### Success `200`

```json
{
  "success": true,
  "data": {
    "messageId": "66m1...",
    "channel": "sms",
    "status": "delivered",
    "provider": "twilio",
    "providerMessageId": "SMxxxx",
    "toMasked": "******3210",
    "subject": null,
    "templateKey": "staff_invite",
    "skippedReason": null,
    "errorCode": null,
    "errorMessage": null,
    "createdAt": "2026-08-12T18:00:00.000Z",
    "updatedAt": "2026-08-12T18:00:05.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `MESSAGE_NOT_FOUND` | Unknown id |

---

## SMS webhook

**API name:** SMS delivery receipt  
**Method / path:** `POST /webhooks/sms`  
**Who:** Twilio (form-urlencoded). Auth: `CHANNEL_WEBHOOK_SECRET` as `?secret=` or `x-webhook-secret`.

### Request (Twilio)

`MessageSid=SMxxxx&MessageStatus=delivered`

### Success `200`

`{ "updated": true, "messageId": "66m1..." }`

---

## Email webhook

**API name:** Email bounce / complaint  
**Method / path:** `POST /webhooks/email`  
**Who:** email provider / relay. Auth: webhook secret.

### Request

```json
{
  "messageId": "66m1...",
  "event": "bounced",
  "reason": "mailbox full"
}
```

`event`: `delivered` \| `bounced` \| `complained` \| `failed`.

### Success `200`

`{ "updated": true, "messageId": "66m1..." }`

---

# Notification preferences + admin

Gateway: `/api/v1/notification-service`.

Customer prefs: Mongo + optional seed from user-service. Rider dispatch (`targetRole: delivery_partner`) merges live toggles from delivery-service. Channel sends are rate-limited (**429** `RATE_LIMITED`).

## Get preferences

**API name:** Get notification preferences  
**Method / path:** `GET /preferences`  
**Who:** customer (any authenticated user). Auth: 🔑

### Success `200`

```json
{
  "success": true,
  "data": {
    "ordersPush": true,
    "offersPush": true,
    "promoPush": true,
    "sms": true,
    "whatsapp": false,
    "email": true,
    "quietHours": {
      "enabled": false,
      "start": "22:00",
      "end": "07:00",
      "tz": "Asia/Kolkata"
    }
  }
}
```

---

## Update preferences

**API name:** Update notification preferences  
**Method / path:** `PUT /preferences`  
**Who:** customer. Auth: 🔑

### Request

```json
{
  "promoPush": false,
  "quietHours": { "enabled": true, "start": "22:00", "end": "07:00", "tz": "Asia/Kolkata" }
}
```

### Success `200`

Same DTO as GET.

---

## Internal get preferences

**API name:** Internal preferences  
**Method / path:** `GET /internal/preferences/:userId`  
**Who:** servers. Auth: `x-internal-key`.

### Success `200`

Same preference DTO. Used by dispatch/channels for `PREF_BLOCKED` / `QUIET_HOURS`.

---

## Admin templates

**List** `GET /admin/templates` · **Create** `POST /admin/templates` · **Update** `PUT /admin/templates/:templateId` · **Delete** `DELETE /admin/templates/:templateId`  
Auth: 🔑 🔐 admin.

### Create request

```json
{
  "key": "promo_weekend",
  "name": "Weekend promo",
  "locale": "en-IN",
  "channels": ["push", "sms", "email"],
  "title": "{{title}}",
  "body": "{{message}}",
  "smsBody": "{{message}}",
  "emailSubject": "{{title}}",
  "emailHtml": "<p>{{message}}</p>",
  "emailText": "{{message}}"
}
```

### Success create `201`

```json
{
  "success": true,
  "data": {
    "templateId": "66t1...",
    "key": "promo_weekend",
    "name": "Weekend promo",
    "locale": "en-IN",
    "channels": ["push", "sms", "email"],
    "title": "{{title}}",
    "body": "{{message}}",
    "smsBody": "{{message}}",
    "whatsappBody": null,
    "emailSubject": "{{title}}",
    "emailHtml": "<p>{{message}}</p>",
    "emailText": "{{message}}",
    "deletedAt": null,
    "createdAt": "2026-08-12T18:00:00.000Z",
    "updatedAt": "2026-08-12T18:00:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `TEMPLATE_EXISTS` | key+locale already active |
| 404 | `TEMPLATE_NOT_FOUND` | update/delete |

---

## Admin test notification

**Method / path:** `POST /admin/notifications/test` · Auth: 🔑 🔐

### Request

```json
{ "userId": "66u1...", "title": "Test", "message": "Hello" }
```

### Success `201`

Same shape as `/internal/dispatch` result.

---

## Admin notification stats

**Method / path:** `GET /admin/notifications/stats?from=&to=` · Auth: 🔑 🔐  
ISO datetime optional; default last 7 days.

### Success `200`

```json
{
  "success": true,
  "data": {
    "from": "...",
    "to": "...",
    "inboxCreated": 120,
    "dispatchJobs": 3,
    "channels": {
      "sms": { "sent": 10, "delivered": 8, "failed": 1, "bounced": 0, "skipped": 1, "complained": 0 },
      "email": { "sent": 5, "delivered": 4, "failed": 0, "bounced": 1, "skipped": 0, "complained": 0 },
      "whatsapp": { "sent": 0, "delivered": 0, "failed": 0, "bounced": 0, "skipped": 2, "complained": 0 }
    }
  }
}
```

---

## Admin dispatch jobs

**List** `GET /admin/jobs?status=&page=&limit=` · **Retry** `POST /admin/jobs/:jobId/retry` · Auth: 🔑 🔐  
Background `DispatchJobWorker` also auto-drains `pending`/`failed` jobs every 5s (max 5 attempts, exponential `nextRetryAt`).

### Retry success `200`

```json
{
  "success": true,
  "data": {
    "job": { "jobId": "66j1...", "status": "succeeded", "attempts": 2 },
    "result": { "notificationId": "...", "inbox": false, "push": { "attempted": 1, "delivered": 1, "failed": 0 }, "degradedReason": null }
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `JOB_NOT_FOUND` | Unknown job |
| 400 | `JOB_ALREADY_SUCCEEDED` | Already done |

---

## Admin broadcast (segment + push)

**Method / path:** `POST /notifications/broadcast` · Auth: 🔑 🔐

### Request

```json
{
  "targetRole": "customer",
  "type": "broadcast",
  "title": "Weekend deals",
  "message": "Flat 50% off",
  "segment": { "app": "customer", "city": "Bengaluru", "tier": "gold", "zoneId": "66z1..." },
  "channels": ["inbox", "push"]
}
```

`segment` filters `DeviceToken` by optional `app` (else derived from `targetRole`) + `city` (case-insensitive) + `tier` + `zoneId`. Omit filters → all devices for that app/role (cap 5000).

### Success `201`

```json
{
  "success": true,
  "data": {
    "notification": { "_id": "...", "isBroadcast": true, "targetRole": "customer" },
    "push": { "attempted": 120, "delivered": 110, "failed": 10, "degradedReason": null }
  }
}
```

---

## Partner notification preferences (internal)

**API name:** Rider prefs by userId  
**Method / path:** `GET /internal/partners/by-user/:userId/notification-preferences`  
**Who:** notification-service (prefs merge). Auth: `x-internal-key`. Gateway prefix: `/api/v1/delivery-service`.

### Success `200`

```json
{
  "success": true,
  "data": { "push": true, "sms": true, "email": true, "whatsapp": false }
}
```

---

## Partner notification context (internal)

**API name:** Partner notification context  
**Method / path:** `GET /internal/partners/:partnerId/notification-context`  
**Who:** notification-service (payout / segment). Auth: `x-internal-key`.

### Success `200`

```json
{
  "success": true,
  "data": {
    "userId": "66u1...",
    "partnerId": "66p1...",
    "preferences": { "push": true, "sms": true, "email": true, "whatsapp": false },
    "zoneId": "66z1...",
    "tier": "gold"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PARTNER_NOT_FOUND` | Unknown partner |

---

## Internal partner eligibility

**API name:** Check rider eligibility for an order  
**Method / path:** `GET /internal/partners/:partnerId/eligibility`  
**Who:** Assignment engine. Auth: `x-internal-key`.

### Request query

| Query | Notes |
|---|---|
| `paymentMethod` | `cod` \| `prepaid` |
| `codAmount` | Cash to collect (COD) |
| `vehicleType` | bicycle / motorcycle / scooter / electric_scooter / car |
| `zoneId` | Must match current or home zone |
| `lat` + `lng` | Zone closed check |
| `orderId` | Optional context |

### Success response `200`

```json
{
  "success": true,
  "message": "Partner eligibility",
  "data": {
    "partnerId": "66a9...",
    "eligible": false,
    "reasons": ["COD_LIMIT_EXCEEDED", "PARTNER_LOCKED"],
    "status": "active",
    "dutyStatus": "online",
    "isOnline": true,
    "vehicleType": "motorcycle",
    "zoneId": "66z1...",
    "cashInHand": 4800,
    "codLimit": 5000,
    "activeDeliveries": 1,
    "backgroundCheck": "clear",
    "locked": true
  }
}
```

Reasons include `PARTNER_NOT_ACTIVE` / `SUSPENDED` / `BLOCKED`, `PARTNER_OFFLINE`, `PARTNER_ON_BREAK`, `VEHICLE_MISMATCH`, `ZONE_MISMATCH`, `ZONE_CLOSED`, `COD_LIMIT_EXCEEDED`, `DELIVERY_CAPACITY_FULL`, `PARTNER_LOCKED`, `BACKGROUND_CHECK_FAILED`.

---

## Internal KYC verification webhook

**API name:** Third-party KYC callback  
**Method / path:** `POST /internal/webhooks/kyc-verification`  
**Who:** HyperVerge / OnGrid. Auth: `x-internal-key`.

Same rules as admin KYC: document must be uploaded to **verify**; core three verified → auto-activate + referral; reject core on active → `under_review` + offline. Never fakes activate.

### Request

```json
{
  "partnerId": "66a9...",
  "documentId": "aadhar",
  "status": "verified",
  "provider": "hyperverge",
  "reference": "hv_123"
}
```

`documentId` accepts aliases (`dl`, `rc`, `aadhaar`). Reject needs `reason` (min 8) or `reference`.

### Success response `200`

**AdminPartner360Dto** (same as admin KYC approve/reject).

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PARTNER_NOT_FOUND` / `DOCUMENT_NOT_FOUND` | Bad ids |
| 409 | `DOCUMENT_NOT_UPLOADED` | Verify without rider upload |
| 409 | `PARTNER_BLOCKED` | Deactivated rider |
| 422 | `REASON_REQUIRED` | Reject without reason |

---

## Internal bank verification webhook

See [Internal bank verification webhook](#internal-bank-verification-webhook) (`POST /internal/webhooks/bank-verification`). Already live.

---

## Internal background-check webhook

**API name:** Police / BG verify callback  
**Method / path:** `POST /internal/webhooks/background-check`  
**Who:** OnGrid / police vendor. Auth: `x-internal-key`.

Stores provider status only — never invents `clear`. `failed` on an active rider → `under_review` + offline. `clear` does **not** auto-activate (KYC still required).

### Request

```json
{
  "partnerId": "66a9...",
  "status": "clear",
  "provider": "ongrid",
  "reference": "og_88",
  "reason": null
}
```

`status`: `pending` \| `in_progress` \| `clear` \| `failed`.

### Success response `200`

```json
{
  "success": true,
  "message": "Background check webhook applied",
  "data": {
    "partnerId": "66a9...",
    "status": "clear",
    "reference": "og_88",
    "provider": "ongrid",
    "failure": null,
    "checkedAt": "2026-08-09T03:10:00.000Z",
    "partnerStatus": "under_review"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PARTNER_NOT_FOUND` | Unknown partner |
| 409 | `PARTNER_BLOCKED` | Deactivated |
| 422 | `INVALID_STATUS` | Bad status |

---

## Internal create delivery

**API name:** Create delivery from order-service  
**Method / path:** `POST /internal/create-delivery`  
**Who:** Order-service (kitchen ready). Auth: `x-internal-key`.

Same body as `/internal/assign`. If a live trip already exists for `orderId`, returns it (idempotent). Delivered/returned → `409 DELIVERY_ALREADY_COMPLETE`. Otherwise assigns nearest eligible rider (or `partnerId` + optional `lockToken`).

### Request

Same as [Dispatch assign](#dispatch-assign).

### Success response `201`

**DispatchAssignDto**.

### Errors

Same as assign, plus `409 DELIVERY_ALREADY_COMPLETE`.

---

## Internal complete

**API name:** Force-complete delivery (internal)  
**Method / path:** `POST /internal/complete`  
**Who:** Internal (order-service / ops / payment). Auth: `x-internal-key`.

After pickup only (`picked_up` / `out_for_delivery` / `arrived_at_customer` / `returning_to_restaurant`). Credits earnings like rider deliver. COD cash-in-hand increments only if still unpaid cash and **not** returning to restaurant / already UPI. Syncs order to `delivered` unless caller already owns order state.

### Request

```json
{ "orderId": "66b1...", "reason": "Customer confirmed via order-service" }
```

`orderId` or `deliveryId` required. `reason` optional (max 300).

### Success response `200`

**PartnerDeliveryDto** (`status: delivered`).

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | Unknown order/delivery |
| 409 | `ILLEGAL_TRANSITION` | Pre-pickup — cancel instead |

---

## Internal status sync

**API name:** Synchronize order status onto delivery  
**Method / path:** `POST /internal/status-sync`  
**Who:** Order-service. Auth: `x-internal-key`. Does **not** invent rider steps (`arrived`, `picked_up`, OTP).

| Incoming `status` | Action |
|---|---|
| `cancelled` / `canceled` | Cancel assignment; restore duty; **no** order callback |
| `delivered` | Internal complete after pickup (`skipOrderSync`); else `409 ILLEGAL_TRANSITION` |
| already terminal matching | `applied: true`, `action: already` |
| `placed` / `confirmed` / `preparing` / `ready` / other | Acknowledge only (`applied: false`) |

### Request

```json
{ "orderId": "66b1...", "status": "cancelled", "reason": "Customer cancelled" }
```

### Success response `200`

```json
{
  "success": true,
  "message": "Order status synced",
  "data": {
    "orderId": "66b1...",
    "deliveryId": "66c2...",
    "requestedStatus": "cancelled",
    "deliveryStatus": "cancelled",
    "applied": true,
    "action": "cancel"
  }
}
```

`action`: `none` \| `cancel` \| `complete` \| `already`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ILLEGAL_TRANSITION` | `delivered` requested before pickup |

---

## Internal payment sync

**API name:** Synchronize payment status  
**Method / path:** `POST /internal/payment-sync`  
**Who:** Order-service / payment-service. Auth: `x-internal-key`. Never fakes `paid` on the gateway and **never** increments `cashInHand`.

| `paymentStatus` | Effect |
|---|---|
| `pay_on_delivery` | `paymentMethod=cod` |
| `paid` + unpaid COD | Mark prepaid/UPI settled (`codSettledVia=upi`); no cash increment |
| `paid` + prepaid | Record `externalPaymentStatus` only |
| `failed` / `refunded` / `partial_refund` / `pending` | Record only |

### Request

```json
{ "orderId": "66b1...", "paymentStatus": "paid", "paymentMethod": "cod", "txnRef": "pay_abc" }
```

### Success response `200`

```json
{
  "success": true,
  "message": "Payment status synced",
  "data": {
    "orderId": "66b1...",
    "deliveryId": "66c2...",
    "paymentMethod": "prepaid",
    "paymentStatus": "paid",
    "codSettledVia": "upi",
    "cashIncremented": false,
    "txnRef": "pay_abc"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | No delivery for order |

---

## Internal location sync

**API name:** Update rider GPS internally  
**Method / path:** `POST /internal/location-sync`  
**Who:** Gateway / simulator / order-service. Auth: `x-internal-key`. By `partnerId` (no rider session). Skips online check; still rejects mock GPS and impossible speed.

### Request

```json
{ "partnerId": "66a9...", "latitude": 28.6139, "longitude": 77.2090, "heading": 90, "speed": 18, "accuracy": 12, "isMock": false }
```

### Success response `200`

**LocationPingResult** (`accepted`, `throttled`, `location`, `activeDeliveryId`, …).

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PARTNER_NOT_FOUND` | Unknown partner |
| 403 | `MOCK_LOCATION` | `isMock` or impossible jump |

---

## Internal nearby / available partners

See [Dispatch nearby partners](#dispatch-nearby-partners) (`GET /internal/nearby-partners`) and [Dispatch available partners](#dispatch-available-partners) (`GET /internal/available-partners`). Same handlers as `/dispatch/*`.

---

## Internal ETA calculate

**API name:** Calculate ETA  
**Method / path:** `POST /internal/eta/calculate`  
**Who:** Internal. Auth: `x-internal-key`. Google Directions / Distance Matrix with Redis cache; **haversine fallback** if Maps is down (`fallback: true`, `provider: haversine`).

### Request

Pins **or** `deliveryId` / `orderId` (origin = rider GPS or restaurant; dest = next stop).

```json
{ "originLat": 28.61, "originLng": 77.20, "destLat": 28.63, "destLng": 77.22, "vehicleType": "motorcycle", "trafficFactor": 1.2 }
```

### Success response `200`

```json
{
  "success": true,
  "message": "ETA calculated",
  "data": {
    "etaSeconds": 720,
    "etaAt": "2026-08-09T10:12:00.000Z",
    "distanceMeters": 4200,
    "distanceKm": 4.2,
    "trafficFactor": 1.2,
    "provider": "google",
    "durationInTraffic": true,
    "origin": { "latitude": 28.61, "longitude": 77.20 },
    "destination": { "latitude": 28.63, "longitude": 77.22 },
    "fallback": false
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | Unknown delivery/order |
| 422 | `ROUTE_PINS_MISSING` | Cannot resolve origin/dest |
| 422 | `VALIDATION_ERROR` | Missing pins and ids |

---

## Internal distance calculate

**API name:** Calculate travel distance  
**Method / path:** `POST /internal/distance/calculate`  
**Who:** Internal. Same body as ETA. Returns meters/km + etaSeconds from the same Maps route.

### Success response `200`

**InternalDistanceDto**: `distanceMeters`, `distanceKm`, `etaSeconds`, `provider`, `fallback`, `origin`, `destination`.

---

## Internal surge calculate

**API name:** Calculate surge multiplier  
**Method / path:** `POST /internal/surge/calculate`  
**Who:** Internal (pricing / assign). Auth: `x-internal-key`. Zone `surgeMultiplier` if active polygon/id; otherwise **1** (never invents surge). Inactive zone → 1.

### Request

```json
{ "lat": 28.6139, "lng": 77.2090 }
```

Or `{ "zoneId": "66z..." }` or `{ "orderId": "66b1..." }` (uses drop pin).

### Success response `200`

```json
{
  "success": true,
  "message": "Surge calculated",
  "data": {
    "surgeMultiplier": 1.4,
    "zoneId": "66z...",
    "zoneName": "CP",
    "city": "Delhi",
    "isActive": true,
    "source": "zone"
  }
}
```

`source`: `zone` \| `default`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `ZONE_NOT_FOUND` | Unknown `zoneId` |
| 404 | `DELIVERY_NOT_FOUND` | Unknown `orderId` |

---

## Serviceability check

**API name:** Can we deliver this drop pin?  
**Method / path:** `POST /internal/serviceability/check`  
**Who:** Internal (cart / checkout). Auth: `x-internal-key`. Zone + rain close + IST hours 06:00–23:30. Never invents surge.

### Request

```json
{
  "dropLat": 28.5921,
  "dropLng": 77.0460,
  "restaurantLat": 28.6139,
  "restaurantLng": 77.2090,
  "at": "2026-08-10T12:00:00.000Z"
}
```

Restaurant pins optional. `at` optional (default now).

### Success `200`

```json
{
  "success": true,
  "message": "Deliverable",
  "data": {
    "serviceable": true,
    "reason": { "code": "ok", "message": "Deliverable" },
    "dropZoneId": "66z1...",
    "dropZoneName": "Dwarka",
    "restaurantZoneId": "66z2...",
    "surgeMultiplier": 1.2,
    "rain": false,
    "withinHours": true,
    "timezone": "Asia/Kolkata",
    "evaluatedAt": "2026-08-10T12:00:00.000Z"
  }
}
```

`reason.code`: `ok` \| `out_of_zone` \| `zone_closed` \| `zone_rain` \| `restaurant_zone_closed` \| `outside_hours`.

---

## Serviceability batch

**API name:** Cart batch serviceability  
**Method / path:** `POST /internal/serviceability/batch`  
**Who:** Internal. Max 50 addresses.

### Request

```json
{ "addresses": [ { "dropLat": 28.59, "dropLng": 77.04 }, { "dropLat": 28.70, "dropLng": 77.10 } ] }
```

### Success `200`

`data.results[]` = **ServiceabilityDto** + `index`.

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `BATCH_TOO_LARGE` | More than 50 |

---

## Surge quote (checkout)

**API name:** Surge for restaurant + drop  
**Method / path:** `GET /internal/surge/quote`  
**Who:** Internal. Query: `dropLat` `dropLng` required; `restaurantLat` `restaurantLng` optional; `at` optional ISO.

### Success `200`

```json
{
  "success": true,
  "message": "Surge quote",
  "data": {
    "surgeMultiplier": 1.4,
    "dropZoneId": "66z1...",
    "dropZoneName": "Dwarka",
    "restaurantZoneId": "66z2...",
    "restaurantZoneName": "CP",
    "dropActive": true,
    "restaurantActive": true,
    "source": "zone",
    "evaluatedAt": "2026-08-10T12:00:00.000Z"
  }
}
```

Closed / missing zone → multiplier **1**, `source: "default"`. Never invents surge.

---

## Checkout ETA quote

**API name:** Promise time on restaurant/cart  
**Method / path:** `POST /internal/eta/quote-checkout`  
**Who:** Internal. Ride ETA (Google + haversine fallback) + 15 min prep + 3 min buffer.

### Request

```json
{
  "restaurantLat": 28.6139,
  "restaurantLng": 77.2090,
  "dropLat": 28.5921,
  "dropLng": 77.0460,
  "vehicleType": "motorcycle"
}
```

### Success `200`

```json
{
  "success": true,
  "message": "Checkout ETA",
  "data": {
    "serviceable": true,
    "reason": { "code": "ok", "message": "Deliverable" },
    "etaSeconds": 720,
    "prepSeconds": 900,
    "bufferSeconds": 180,
    "promiseSeconds": 1800,
    "promiseMinutes": 30,
    "promiseAt": "2026-08-10T12:30:00.000Z",
    "distanceMeters": 6400,
    "provider": "google",
    "fallback": false,
    "surgeMultiplier": 1.2
  }
}
```

If not serviceable, `promiseMinutes` / `etaSeconds` are `null` (never a fake promise).

---

## Internal health

**API name:** Delivery-service health (internal)  
**Method / path:** `GET /internal/health`  
**Who:** Gateway / k8s / peer services. Auth: `x-internal-key`. Same probe as `GET /ops/health`: mongo + redis + downstream `/health` (3s). **503 only if mongo or redis is down**; downstream outage → `200` + `status: degraded`.

### Success response `200` / `503`

**OpsHealthDto**: `status` (`healthy` \| `degraded` \| `unhealthy`), `service`, `uptimeSeconds`, `checks[]`.

---

# Earnings & Payouts APIs

Rider earnings + settlements. Service: **delivery-service**. Instant bank transfer is queued on **payment-service** (`POST /payments/internal/payouts/transfer`). Auth: 🔑 + 🚴. CSRF on POST. Dates are **Asia/Kolkata**.

Daily credit on `delivered`: `partnerEarnings + incentiveBonus` (IST `YYYY-MM-DD`). Per-trip breakdown is explanatory; wait-time ₹1/min is shown but **not** included in `net` until credited separately. Instant: min ₹200, fee 2.5% (min ₹5), daily cap ₹5000 / 3 requests. Weekly cycle: **Tuesday IST**. Status is never faked to `paid` without Razorpay keys — request stays `pending` if the gateway is down.

---

## Earnings overview

**API name:** Get earnings summary  
**Method / path:** `GET /partners/me/earnings`  
**Who:** Rider.

### Request

No query. Periods are IST today / ISO week (Mon–Sun) / calendar month.

### Success response `200`

```json
{
  "success": true,
  "message": "Earnings summary",
  "data": {
    "timezone": "Asia/Kolkata",
    "today": {
      "from": "2026-08-08",
      "to": "2026-08-08",
      "totalEarnings": 640,
      "baseEarnings": 560,
      "incentives": 80,
      "tips": 0,
      "totalDeliveries": 12,
      "onlineHours": 6.5
    },
    "week": {
      "from": "2026-08-03",
      "to": "2026-08-09",
      "totalEarnings": 4120,
      "baseEarnings": 3800,
      "incentives": 320,
      "tips": 0,
      "totalDeliveries": 78,
      "onlineHours": 41
    },
    "month": {
      "from": "2026-08-01",
      "to": "2026-08-31",
      "totalEarnings": 8120,
      "baseEarnings": 7400,
      "incentives": 720,
      "tips": 0,
      "totalDeliveries": 154,
      "onlineHours": 88
    },
    "lifetime": { "totalEarnings": 45210, "totalDeliveries": 910 }
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | — | Not logged in |
| 404 | — | No partner profile |

---

## Daily earnings

**API name:** Get daily earnings breakdown  
**Method / path:** `GET /partners/me/earnings/daily`  
**Who:** Rider.

### Request

Query: `days` (1–90, default 7) — IST calendar days ending today.

### Success response `200`

```json
{
  "success": true,
  "message": "Daily earnings",
  "data": [
    {
      "date": "2026-08-08",
      "deliveries": 12,
      "baseEarnings": 560,
      "incentives": 80,
      "tips": 0,
      "deductions": 0,
      "total": 640,
      "onlineHours": 6.5
    }
  ]
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | — | Not logged in |
| 404 | — | No partner profile |

---

## Per-delivery earnings

**API name:** Get earnings for one delivery  
**Method / path:** `GET /partners/me/earnings/:deliveryId`  
**Who:** Rider (own trip).

### Request

Path: `deliveryId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Delivery earnings",
  "data": {
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "status": "delivered",
    "deliveredAt": "2026-08-08T14:22:01.000Z",
    "actualDistanceKm": 4.2,
    "waitMinutes": 8,
    "currency": "INR",
    "breakdown": {
      "baseFare": 30,
      "distanceFare": 18,
      "surge": 0,
      "waitTime": 8,
      "tip": 0,
      "incentive": 10,
      "platformFee": 12,
      "tds": 0.58
    },
    "waitTimeIncludedInNet": false,
    "gross": 66,
    "net": 58
  }
}
```

`net` = credited `partnerEarnings + incentive`. `waitTime` / `tip` / `surge` are 0 unless stored on the delivery.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `FORBIDDEN` | Not your delivery |
| 404 | `DELIVERY_NOT_FOUND` | Unknown id |

---

## List payouts

**API name:** List payouts  
**Method / path:** `GET /partners/me/payouts`  
**Who:** Rider.

### Request

Query: `page` (default 1), `limit` (default 20, max 100).

### Success response `200`

```json
{
  "success": true,
  "data": [
    {
      "payoutId": "66f1...",
      "kind": "instant",
      "status": "processing",
      "period": "instant:2026-08-08:instant:66a9...:2026-08-08:500.00",
      "grossAmount": 500,
      "feeAmount": 12.5,
      "tdsAmount": 0,
      "netAmount": 487.5,
      "bankAccountMasked": "****4321",
      "ifscCode": "HDFC0001234",
      "gatewayPayoutId": null,
      "failureReason": null,
      "gatewayAvailable": true,
      "requestedAt": "2026-08-08T11:02:00.000Z",
      "paidAt": null
    }
  ],
  "total": 3,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

`status`: `pending` | `processing` | `paid` | `failed` | `on_hold`. Bank account is masked.

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | — | Not logged in |
| 404 | — | No partner profile |

---

## Instant payout eligibility

**API name:** Check instant payout eligibility  
**Method / path:** `GET /partners/me/payouts/instant/eligibility`  
**Who:** Rider.

### Request

None.

### Success response `200`

```json
{
  "success": true,
  "message": "Instant payout eligibility",
  "data": {
    "eligible": true,
    "reasons": [],
    "availableBalance": 1840,
    "minAmount": 200,
    "maxAmount": 1840,
    "feePercent": 2.5,
    "feeMin": 5,
    "estimatedFee": 46,
    "estimatedNet": 1794,
    "dailyRemainingAmount": 5000,
    "dailyRemainingCount": 3,
    "bankOnFile": true,
    "bankVerified": true,
    "kycActive": true,
    "nextWeeklyPayoutAt": "2026-08-11T18:30:00.000Z"
  }
}
```

`reasons` when ineligible: `PARTNER_NOT_ACTIVE` | `PARTNER_SUSPENDED` | `BANK_DETAILS_REQUIRED` | `BANK_NOT_VERIFIED` | `BELOW_MINIMUM` | `DAILY_CAP_REACHED` | `DAILY_COUNT_REACHED`.

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | — | Not logged in |
| 404 | — | No partner profile |

---

## Payout schedule

**API name:** Get payout schedule  
**Method / path:** `GET /partners/me/payouts/schedule`  
**Who:** Rider.

### Request

None.

### Success response `200`

```json
{
  "success": true,
  "message": "Payout schedule",
  "data": {
    "cycle": "weekly",
    "weekday": "Tuesday",
    "weekdayIndex": 2,
    "timezone": "Asia/Kolkata",
    "nextPayoutDate": "2026-08-11",
    "nextPayoutAt": "2026-08-10T18:30:00.000Z",
    "cutoff": "2026-08-09T18:29:00.000Z",
    "currentPeriod": { "label": "2026-W32", "from": "2026-08-03", "to": "2026-08-09" },
    "instant": {
      "minAmount": 200,
      "feePercent": 2.5,
      "feeMin": 5,
      "dailyCapAmount": 5000,
      "dailyCapCount": 3
    }
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | — | Not logged in |
| 404 | — | No partner profile |

---

## Request instant payout

**API name:** Request instant payout  
**Method / path:** `POST /partners/me/payouts/instant`  
**Who:** Rider.

### Request

Headers: `Idempotency-Key` (optional; also accepted in body). Same key / same day+amount is idempotent.

```json
{ "amount": 500 }
```

Omit `amount` to withdraw `maxAmount` from eligibility (capped by daily remaining).

### Success response `201`

Same **PartnerPayoutDto** as list item. Typical statuses:

- `processing` — payment-service accepted (Razorpay keys configured); not yet `paid`
- `pending` — gateway down or keys missing; ledger kept, retry with same idempotency key

Never returns `paid` unless payment-service later confirms.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `PARTNER_NOT_ACTIVE` | KYC not live |
| 409 | `PARTNER_SUSPENDED` | Suspended / deactivated |
| 409 | `BANK_DETAILS_REQUIRED` | Missing account + IFSC |
| 409 | `BANK_NOT_VERIFIED` | Penny-drop not completed |
| 409 | `BELOW_MINIMUM` | Under ₹200 |
| 409 | `INSUFFICIENT_BALANCE` | Amount > accrued − in-flight payouts |
| 409 | `DAILY_CAP_REACHED` | ₹5k IST day cap |
| 409 | `DAILY_COUNT_REACHED` | 3 instant payouts today |
| 409 | `FEE_EXCEEDS_AMOUNT` | Net after fee ≤ 0 |
| 409 | `IDEMPOTENCY_CONFLICT` | Key belongs to another rider |
| 422 | — | Invalid body |

---

## Payout detail

**API name:** Get payout details  
**Method / path:** `GET /partners/me/payouts/:payoutId`  
**Who:** Rider (own payout). Refreshes status from payment-service when `processing`.

### Request

Path: `payoutId`.

### Success response `200`

```json
{
  "success": true,
  "message": "Payout details",
  "data": {
    "payoutId": "66f1...",
    "kind": "instant",
    "status": "pending",
    "period": "instant:2026-08-08:abc-uuid",
    "grossAmount": 500,
    "feeAmount": 12.5,
    "tdsAmount": 0,
    "netAmount": 487.5,
    "bankAccountMasked": "****4321",
    "ifscCode": "HDFC0001234",
    "gatewayPayoutId": null,
    "failureReason": "Payout gateway unavailable — request kept pending",
    "gatewayAvailable": false,
    "requestedAt": "2026-08-08T11:02:00.000Z",
    "paidAt": null
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `FORBIDDEN` | Not your payout |
| 404 | `PAYOUT_NOT_FOUND` | Unknown id |

---

## Internal partner transfer (payment-service)

**API name:** Queue rider bank transfer  
**Method / path:** `POST /payments/internal/payouts/transfer`  
**Who:** delivery-service (🔒 `x-internal-key`). Not for apps.

### Request

Headers: `Idempotency-Key` optional.

```json
{
  "recipientId": "66a9...",
  "period": "instant:2026-08-08:abc-uuid",
  "kind": "instant",
  "grossAmount": 500,
  "feeAmount": 12.5,
  "tdsAmount": 0,
  "netAmount": 487.5,
  "bankAccountNo": "123456789012",
  "ifscCode": "HDFC0001234",
  "idempotencyKey": "instant:66a9...:2026-08-08:500.00"
}
```

### Success response `201`

```json
{
  "success": true,
  "message": "Partner transfer queued",
  "data": {
    "payoutId": "77a1...",
    "status": "processing",
    "kind": "instant",
    "period": "instant:2026-08-08:abc-uuid",
    "grossAmount": 500,
    "feeAmount": 12.5,
    "tdsAmount": 0,
    "netAmount": 487.5,
    "gatewayPayoutId": null,
    "gatewayAvailable": true,
    "failureReason": null,
    "paidAt": null
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 503 | `PAYOUT_GATEWAY_UNAVAILABLE` | Razorpay keys unset |
| 409 | `PAYOUT_DUPLICATE` | Same period already exists |
| 403 | — | Missing internal key |

**API name:** Get internal transfer  
**Method / path:** `GET /payments/internal/payouts/:payoutId`  
**Who:** delivery-service 🔒.

### Success response `200`

Same transfer DTO as above (`message`: `"Partner transfer"`).

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PAYOUT_NOT_FOUND` | Unknown id |

---

## Earnings & payout error codes

| code | HTTP | Meaning |
|---|---|---|
| `PARTNER_NOT_ACTIVE` | 409 | KYC not live |
| `PARTNER_SUSPENDED` | 409 | Suspended / deactivated |
| `BANK_DETAILS_REQUIRED` | 409 | No bank account + IFSC |
| `BANK_NOT_VERIFIED` | 409 | Penny-drop not completed |
| `BANK_VERIFY_UNAVAILABLE` | 503 | Cashfree keys unset |
| `INVALID_IFSC` | 422 | Bad / unknown IFSC |
| `OTP_REQUIRED` | 409 | Bank change without OTP |
| `OTP_EXPIRED` | 409 | OTP missing or TTL elapsed |
| `INVALID_OTP` | 400 | Wrong bank-change OTP |
| `OTP_LOCKED` | 429 | Too many wrong OTP attempts |
| `OTP_UNAVAILABLE` | 503 | Twilio / MSG91 not configured |
| `USE_BANK_API` | 409 | Profile PUT tried to change bank |
| `BELOW_MINIMUM` | 409 | Under ₹200 instant min |
| `INSUFFICIENT_BALANCE` | 409 | Amount > available |
| `DAILY_CAP_REACHED` | 409 | Instant ₹5k / IST day |
| `DAILY_COUNT_REACHED` | 409 | 3 instant payouts today |
| `FEE_EXCEEDS_AMOUNT` | 409 | Fee ≥ gross |
| `IDEMPOTENCY_CONFLICT` | 409 | Idempotency key reused by another rider |
| `PAYOUT_NOT_FOUND` | 404 | Unknown payout |
| `PAYOUT_GATEWAY_UNAVAILABLE` | 503 | Razorpay not configured (payment-service) |
| `FORBIDDEN` | 403 | Not your delivery/payout |
| `DELIVERY_NOT_FOUND` | 404 | Unknown delivery id |
| `COD_LIMIT_EXCEEDED` | 409 | Rider cash-in-hand at/over COD limit |
| `NO_COD_DUE` | 409 | Remit with zero cash-in-hand |
| `INSUFFICIENT_COD_CASH` | 409 | Remit amount > cash-in-hand |
| `NOT_COD` | 409 | UPI/collect on a prepaid delivery |
| `ALREADY_COLLECTED_CASH` | 409 | COD already taken as cash |
| `COD_ALREADY_SETTLED` | 409 | COD already settled via UPI |
| `UPI_QR_UNAVAILABLE` | 503 | No PLATFORM_UPI_VPA and no Razorpay QR |
| `INVALID_TXN_TYPE` | 422 | Bad `?type=` on transactions |
| `INCENTIVE_NOT_FOUND` | 404 | Unknown incentive id/code |
| `INCENTIVE_NOT_OPEN` | 409 | Program paused/ended |
| `OPT_IN_NOT_REQUIRED` | 409 | Auto-enrolled program |
| `INCENTIVE_NOT_ELIGIBLE` | 409 | Zone/vehicle/rating |
| `INSUFFICIENT_POINTS` | 409 | Not enough loyalty points |
| `OUT_OF_STOCK` | 409 | Catalog item sold out |
| `REWARD_NOT_FOUND` | 404 | Unknown catalog sku/id |
| `NO_ZONE` | 409 | Leaderboard needs home/current zone |
| `WARNING_NOT_FOUND` | 404 | Unknown warning id |
| `WARNING_NOT_OPEN` | 409 | Acknowledge only while open |
| `RATING_ALREADY_SUBMITTED` | 409 | Delivery already rated for that source |
| `DELIVERY_NOT_COMPLETE` | 409 | Rate only after delivered |
| `INVALID_MONTH` | 422 | Tax `?month=` not YYYY-MM |

---

# Finance APIs

Rider `/finance/*` aliases + wallet / COD cash / tax download. Service: **delivery-service**. Auth: 🔑 + 🚴. CSRF on POST. Dates **Asia/Kolkata**. Same Mongo ledger as `/partners/me/earnings*` and `/partners/me/payouts*`.

COD: on `deliver` with `paymentMethod=cod`, `cashInHand` increases by `codAmount` (order grand total). Default limit ₹5000. Assign/accept blocked with `COD_LIMIT_EXCEEDED` when cash + this order would exceed the limit. Remit APIs remain §13.

---

## Today / week / month earnings

**API name:** Get period earnings  
**Method / path:** `GET /finance/earnings/today` · `GET /finance/earnings/week` · `GET /finance/earnings/month`  
**Who:** Rider.

### Request

None.

### Success response `200`

Same **EarningsPeriodDto** as `GET /partners/me/earnings` → `today` / `week` / `month`.

```json
{
  "success": true,
  "message": "Today's earnings",
  "data": {
    "from": "2026-08-08",
    "to": "2026-08-08",
    "totalEarnings": 640,
    "baseEarnings": 560,
    "incentives": 80,
    "tips": 0,
    "totalDeliveries": 12,
    "onlineHours": 6.5
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | — | Not logged in |
| 404 | — | No partner profile |

---

## Finance transactions

**API name:** List earning transactions  
**Method / path:** `GET /finance/transactions`  
**Who:** Rider.

### Request

Query: `page`, `limit`, `type` (`delivery_credit` \| `payout_debit` \| `cod_collect` \| `cod_remit` \| `cod_adjust` \| `incentive_credit` \| `referral_credit`), `dateFrom`, `dateTo` (YYYY-MM-DD IST or ISO). Default last 30 IST days.

### Success response `200`

```json
{
  "success": true,
  "data": [
    {
      "txnId": "del:66b1...",
      "type": "delivery_credit",
      "direction": "credit",
      "amount": 58,
      "feeAmount": 12,
      "netAmount": 58,
      "status": "delivered",
      "occurredAt": "2026-08-08T14:22:01.000Z",
      "deliveryId": "66b1...",
      "orderId": "66c2...",
      "payoutId": null,
      "note": "Trip earnings credited"
    },
    {
      "txnId": "pay:66f1...",
      "type": "payout_debit",
      "direction": "debit",
      "amount": 500,
      "feeAmount": 12.5,
      "netAmount": 487.5,
      "status": "processing",
      "occurredAt": "2026-08-08T11:02:00.000Z",
      "deliveryId": null,
      "orderId": null,
      "payoutId": "66f1...",
      "note": "Instant payout"
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `INVALID_TXN_TYPE` | Unknown `type` |

---

## Finance wallet

**API name:** Get rider wallet  
**Method / path:** `GET /finance/wallet`  
**Who:** Rider.

### Request

None.

### Success response `200`

```json
{
  "success": true,
  "message": "Wallet balance",
  "data": {
    "currency": "INR",
    "earningsBalance": 1840,
    "pendingPayouts": 500,
    "lifetimeEarnings": 45210,
    "cashInHand": 650,
    "nextWeeklyPayoutAt": "2026-08-11T18:30:00.000Z",
    "instantEligible": true,
    "cod": {
      "cashInHand": 650,
      "limit": 5000,
      "remainingCapacity": 4350,
      "blocked": false,
      "remitDueToday": false
    }
  }
}
```

`earningsBalance` = lifetime earnings − in-flight/paid payouts (bankable). `cashInHand` is COD owed to the platform, not payable via instant payout.

---

## Finance payouts (aliases)

**API name:** List / get payouts  
**Method / path:** `GET /finance/payouts` · `GET /finance/payouts/:payoutId`  
**Who:** Rider.

Same DTOs and errors as `GET /partners/me/payouts` and `GET /partners/me/payouts/:payoutId`.

---

## Request bank payout

**API name:** Request payout to bank  
**Method / path:** `POST /finance/payout/request`  
**Who:** Rider.

### Request

Headers: `Idempotency-Key` optional. Body:

```json
{ "amount": 800, "mode": "weekly" }
```

`mode`: `weekly` (default, no instant fee, min ₹1) or `instant` (same rules as `POST /partners/me/payouts/instant`). Omit `amount` to withdraw max available.

### Success response `201`

Same **PartnerPayoutDto**. Never `paid` without Razorpay; stays `pending` if gateway down.

### Errors

Same as instant payout, plus weekly uses min ₹1 (`BELOW_MINIMUM`).

---

## COD cash collection

**API name:** COD cash summary  
**Method / path:** `GET /finance/cash-collection`  
**Who:** Rider.

### Request

None.

### Success response `200`

```json
{
  "success": true,
  "message": "COD cash collection",
  "data": {
    "currency": "INR",
    "cashInHand": 650,
    "limit": 5000,
    "remainingCapacity": 4350,
    "blocked": false,
    "remitDueToday": false,
    "remittedLifetime": 0,
    "today": { "date": "2026-08-08", "collected": 420, "count": 3 },
    "nextWeeklyPayoutAt": "2026-08-11T18:30:00.000Z"
  }
}
```

`remitDueToday` when cash ≥ 50% of limit. Remit deposit is §13 `POST /partners/me/cod/remit`.

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | — | Not logged in |
| 404 | — | No partner profile |

---

## Tax summary

**API name:** Tax and settlement summary  
**Method / path:** `GET /finance/tax-summary`  
**Who:** Rider.

### Request

Query: `month` (YYYY-MM, default current IST month), `format=csv` or `Accept: text/csv` for download.

### Success response `200` JSON

```json
{
  "success": true,
  "message": "Tax and settlement summary",
  "data": {
    "month": "2026-08",
    "timezone": "Asia/Kolkata",
    "from": "2026-08-01",
    "to": "2026-08-31",
    "currency": "INR",
    "deliveries": 154,
    "baseEarnings": 7400,
    "incentives": 720,
    "tips": 0,
    "grossEarnings": 8120,
    "platformFee": 2030,
    "tdsRate": 0.01,
    "tdsAmount": 81.2,
    "netEarnings": 8038.8,
    "payoutsPaid": { "count": 2, "gross": 4000, "fee": 0, "net": 4000 },
    "payoutsPending": { "count": 1, "gross": 500 }
  }
}
```

CSV: `Content-Disposition: attachment; filename="tax-summary-2026-08.csv"`.

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `INVALID_MONTH` | Bad `month` |

---

# Wallet & COD APIs

Canonical §13 rider wallet + cash remit. Service: **delivery-service**. Auth: 🔑 + 🚴. CSRF on POST. Same ledger as `/finance/wallet` and `/finance/transactions`.

COD collect on `deliver` (`paymentMethod=cod`) increments `cashInHand` **unless** already settled via UPI (`POST .../cod/mark-upi` or webhook `/internal/cod/collect` with `method=upi`). Remit atomically decrements cash. New COD offers are blocked with `COD_LIMIT_EXCEEDED` while `cashInHand >= limit` (default ₹5000). Remit SLA hint when cash ≥ 50% of limit.

---

## Wallet balance

**API name:** Get partner wallet  
**Method / path:** `GET /partners/me/wallet`  
**Who:** Rider. Same DTO as `GET /finance/wallet`.

### Success response `200`

```json
{
  "success": true,
  "message": "Wallet balance",
  "data": {
    "currency": "INR",
    "earningsBalance": 1840,
    "pendingPayouts": 500,
    "lifetimeEarnings": 45210,
    "cashInHand": 650,
    "nextWeeklyPayoutAt": "2026-08-11T18:30:00.000Z",
    "instantEligible": true,
    "cod": {
      "cashInHand": 650,
      "limit": 5000,
      "remainingCapacity": 4350,
      "blocked": false,
      "remitDueToday": false
    }
  }
}
```

`earningsBalance` is bankable. `cashInHand` is COD owed to the platform (not instant-payoutable).

---

## Wallet transactions

**API name:** Wallet transaction history  
**Method / path:** `GET /partners/me/wallet/transactions`  
**Who:** Rider. Same handler as `GET /finance/transactions`.

### Request

Query: `page`, `limit`, `type` (`delivery_credit` \| `payout_debit` \| `cod_collect` \| `cod_remit` \| `cod_adjust` \| `incentive_credit` \| `referral_credit`), `dateFrom`, `dateTo`. Default last 30 IST days.

### Success response `200`

Paginated **FinanceTransactionDto** (includes `remittanceId` for remits).

---

## COD pending

**API name:** Pending COD cash  
**Method / path:** `GET /partners/me/cod/pending`  
**Who:** Rider.

### Success response `200`

```json
{
  "success": true,
  "message": "COD pending remittance",
  "data": {
    "currency": "INR",
    "cashInHand": 650,
    "limit": 5000,
    "remainingCapacity": 4350,
    "blocked": false,
    "remitDueToday": false,
    "remittedLifetime": 1200,
    "minRemit": 1,
    "maxRemit": 650,
    "today": { "date": "2026-08-08", "collected": 420, "count": 3 }
  }
}
```

---

## Remit COD cash

**API name:** Remit COD  
**Method / path:** `POST /partners/me/cod/remit`  
**Who:** Rider.

### Request

Headers: `Idempotency-Key` optional.

```json
{ "amount": 650, "method": "hub_cash", "reference": "HUB-DWK-12", "note": "Evening drop" }
```

`method`: `hub_cash` (default) \| `upi` \| `bank_deposit`. Omit `amount` to remit all cash-in-hand.

### Success response `201`

```json
{
  "success": true,
  "message": "COD remittance recorded",
  "data": {
    "remittanceId": "66f9...",
    "amount": 650,
    "method": "hub_cash",
    "reference": "HUB-DWK-12",
    "note": "Evening drop",
    "status": "recorded",
    "cashBefore": 650,
    "cashAfter": 0,
    "remittedAt": "2026-08-08T16:40:00.000Z"
  }
}
```

After this, `cashInHand` is reduced so new COD orders can assign again if under limit.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `NO_COD_DUE` | cash-in-hand &lt; ₹1 |
| 409 | `BELOW_MINIMUM` | amount &lt; ₹1 |
| 409 | `INSUFFICIENT_COD_CASH` | amount &gt; cash-in-hand |
| 409 | `IDEMPOTENCY_CONFLICT` | key used by another rider |
| 422 | — | Invalid body |

---

## Remittance history

**API name:** COD remittance history  
**Method / path:** `GET /partners/me/cod/remittance-history`  
**Who:** Rider.

### Request

Query: `page`, `limit`.

### Success response `200`

```json
{
  "success": true,
  "data": [
    {
      "remittanceId": "66f9...",
      "amount": 650,
      "method": "hub_cash",
      "reference": "HUB-DWK-12",
      "note": "Evening drop",
      "status": "recorded",
      "cashBefore": 650,
      "cashAfter": 0,
      "remittedAt": "2026-08-08T16:40:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

---

## COD limit status

**API name:** COD limit status  
**Method / path:** `GET /partners/me/cod/limit-status`  
**Who:** Rider / dispatch UI.

### Success response `200`

```json
{
  "success": true,
  "message": "COD limit status",
  "data": {
    "cashInHand": 5000,
    "limit": 5000,
    "remainingCapacity": 0,
    "usedPercent": 100,
    "blocked": true,
    "remitDueToday": true,
    "blocksNewCodOrders": true,
    "code": "COD_LIMIT_EXCEEDED",
    "message": "COD limit reached (₹5000 / ₹5000). Remit cash to accept new COD orders."
  }
}
```

`blocksNewCodOrders` matches assign/accept: `COD_LIMIT_EXCEEDED` when `cashInHand >= limit`.

---

## Doorstep UPI QR

**API name:** Generate COD UPI QR  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/cod/upi-qr`  
**Who:** Rider, after pickup / at customer. Money goes to **platform** VPA or Razorpay QR — never the rider’s personal UPI.

### Request

No body. Allowed statuses: `picked_up`, `out_for_delivery`, `arrived_at_customer`.

### Success response `200`

```json
{
  "success": true,
  "message": "COD UPI QR ready",
  "data": {
    "deliveryId": "66f9...",
    "orderId": "66f8...",
    "amount": 420,
    "currency": "INR",
    "upiIntent": "upi://pay?pa=merchant@upi&pn=FoodDelivery&am=420.00&cu=INR&tn=COD-66f8&tr=66f9",
    "qrImageUrl": null,
    "qrId": null,
    "expiresAt": "2026-08-08T17:00:00.000Z",
    "source": "upi_intent",
    "settledVia": null
  }
}
```

`qrImageUrl` is set when Razorpay QR is created. Rider app renders `upiIntent` as QR if image is null. TTL 15 minutes; same unexpired QR is reused.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Too early (not picked up yet) |
| 409 | `NOT_COD` | Prepaid order |
| 409 | `ALREADY_COLLECTED_CASH` | Cash already recorded |
| 409 | `COD_ALREADY_SETTLED` | Already marked UPI |
| 503 | `UPI_QR_UNAVAILABLE` | No `PLATFORM_UPI_VPA` and Razorpay QR failed/unset |

---

## Mark COD as UPI

**API name:** Mark doorstep UPI paid  
**Method / path:** `POST /partners/me/deliveries/:deliveryId/cod/mark-upi`  
**Who:** Rider after customer shows UPI success (or after webhook). **Does not** increment `cashInHand`. Subsequent `deliver` will not add cash.

### Request

```json
{ "txnRef": "UTR123456", "note": "Paid on PhonePe" }
```

### Success response `200`

```json
{
  "success": true,
  "message": "COD marked as UPI",
  "data": {
    "deliveryId": "66f9...",
    "orderId": "66f8...",
    "amount": 420,
    "settledVia": "upi",
    "cashInHandDelta": 0,
    "cashInHand": 650,
    "txnRef": "UTR123456",
    "collectedAt": "2026-08-08T16:48:00.000Z"
  }
}
```

Idempotent if already `settledVia=upi`. Syncs payment-service `collect-cod` (`method=upi`) and order `paymentStatus=paid`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ALREADY_COLLECTED_CASH` | Delivered/collected as cash already — use `/internal/cod/adjust` |
| 409 | `NOT_COD` | Prepaid |
| 400 | `ILLEGAL_TRANSITION` | Wrong trip status |

---

## Internal COD collect

**API name:** Sync COD collected  
**Method / path:** `POST /internal/cod/collect`  
**Who:** payment-service (Razorpay QR webhook) or order-service. Auth: `x-internal-key`.

### Request

```json
{ "orderId": "66f8...", "method": "upi", "txnRef": "pay_xxx" }
```

`method`: `cash` \| `upi`. `deliveryId` may be used instead of `orderId`. Cash increments `cashInHand` once; UPI does not. Idempotent on same method; `409` if already settled the other way.

### Success response `200`

Same **CodSettlementDto** as mark-upi.

---

## Internal COD adjust

**API name:** Adjust rider cash-in-hand  
**Method / path:** `POST /internal/cod/adjust`  
**Who:** Ops / internal. Auth: `x-internal-key`. Optional `Idempotency-Key`.

### Request

```json
{ "partnerId": "66aa...", "amount": 50, "reason": "short_cash", "note": "₹50 short vs receipt", "deliveryId": "66f9..." }
```

`amount` signed: **+** rider owes more (short cash), **−** reduce due (overage / correction). Cannot take `cashInHand` below ₹0. Reasons: `short_cash` \| `overage` \| `mismatch` \| `write_off` \| `correction`.

### Success response `200`

```json
{
  "success": true,
  "message": "COD cash adjusted",
  "data": {
    "adjustmentId": "66fb...",
    "partnerId": "66aa...",
    "amount": 50,
    "reason": "short_cash",
    "note": "₹50 short vs receipt",
    "orderId": null,
    "deliveryId": "66f9...",
    "cashBefore": 650,
    "cashAfter": 700,
    "adjustedAt": "2026-08-08T17:10:00.000Z"
  }
}
```

Shows up on wallet transactions as `cod_adjust`.

---

# Bank & Tax APIs

Rider §6 bank + PAN/GST + tax PDFs. Service: **delivery-service**. Auth: 🔑 + 🚴. CSRF on PUT/POST. Account numbers and PAN/GSTIN are **masked** on GET. Instant/weekly payouts require penny-drop `verified`. Changing an existing account/IFSC requires SMS OTP to the rider’s registered phone (Twilio or MSG91). OTP is never returned in the API. First-time bank add does not need OTP. Profile `PUT /partners/me` with `bankAccountNo` / `ifscCode` is rejected (`USE_BANK_API`).

---

## Lookup IFSC (typeahead)

**API name:** Lookup IFSC  
**Method / path:** `GET /partners/me/bank/ifsc/:ifsc`  
**Who:** Rider. Call when IFSC is 11 characters (e.g. after each valid keystroke once length is 11).

`:ifsc` is 11-char Indian IFSC (`AAAA0XXXXXX`), case-insensitive. Result is cached in Redis 24h. Uses public `https://ifsc.razorpay.com/:IFSC` (no key).

### Success response `200`

```json
{
  "success": true,
  "message": "IFSC lookup",
  "data": {
    "ifsc": "HDFC0000123",
    "bank": "HDFC Bank",
    "branch": "Dwarka",
    "city": "Delhi"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `INVALID_IFSC` | Bad format or unknown IFSC |
| 503 | `IFSC_LOOKUP_UNAVAILABLE` | Directory down |

---

## Send bank-change OTP

**API name:** Send bank OTP  
**Method / path:** `POST /partners/me/bank/otp`  
**Who:** Rider. No body. SMS to registered `partner.phone` only.

Required before `PUT /partners/me/bank` when an account is already on file and account number or IFSC will change. 6-digit OTP, TTL 10 min, resend cooldown 60s, max 5 sends / hour, max 5 verify attempts. Twilio (`TWILIO_*`) preferred, else MSG91 (`MSG91_AUTH_KEY`). Never fake-sends; never returns the OTP.

### Success response `200`

```json
{
  "success": true,
  "message": "OTP sent",
  "data": {
    "sentTo": "******4321",
    "expiresInSeconds": 600,
    "resendAfterSeconds": 60
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `PHONE_REQUIRED` | Partner has no phone |
| 409 | `OTP_NOT_NEEDED` | No bank on file yet (first add) |
| 429 | `OTP_COOLDOWN` | Wait 60s before resend |
| 429 | `OTP_RATE_LIMITED` | > 5 sends in the last hour |
| 503 | `OTP_UNAVAILABLE` | Twilio + MSG91 unset, or SMS provider failed |

---

## Get bank (masked)

**API name:** Get partner bank  
**Method / path:** `GET /partners/me/bank`  
**Who:** Rider.

### Success response `200`

```json
{
  "success": true,
  "message": "Bank details",
  "data": {
    "accountMasked": "****1234",
    "ifsc": "HDFC0000123",
    "holderName": "RAHUL KUMAR",
    "bankName": "HDFC Bank",
    "branch": "Dwarka",
    "city": "Delhi",
    "verificationStatus": "unverified",
    "verifiedAt": null,
    "nameAtBank": null,
    "nameMatch": null,
    "payoutsEnabled": false,
    "lastVerifiedAt": null
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `BANK_DETAILS_REQUIRED` | Nothing saved yet |

---

## Save bank

**API name:** Update partner bank  
**Method / path:** `PUT /partners/me/bank`  
**Who:** Rider.

### Request

First-time add (no OTP):

```json
{ "accountNo": "50100123456789", "ifsc": "HDFC0000123", "holderName": "Rahul Kumar" }
```

Change existing account/IFSC (OTP required — request `POST /partners/me/bank/otp` first):

```json
{ "accountNo": "50100999988877", "ifsc": "SBIN0001234", "holderName": "Rahul Kumar", "otp": "482193" }
```

Holder-name-only update does **not** need OTP. Changing account/IFSC resets verification to `unverified`. OTP is consumed once; wrong OTP increments attempts (lock after 5).

### Success response `200`

Same **PartnerBankDto** as GET. `verificationStatus` is `unverified` until penny-drop succeeds.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `OTP_REQUIRED` | Changing existing account/IFSC without `otp` |
| 409 | `OTP_EXPIRED` | OTP not requested or TTL elapsed |
| 400 | `INVALID_OTP` | Wrong 6-digit code |
| 429 | `OTP_LOCKED` | Too many incorrect attempts |
| 503 | `OTP_UNAVAILABLE` | SMS not configured (change blocked) |
| 422 | `INVALID_IFSC` | Bad format or unknown IFSC |
| 422 | `INVALID_ACCOUNT` | Not 9–18 digits |
| 503 | `IFSC_LOOKUP_UNAVAILABLE` | IFSC directory down |

---

## Verify bank (penny-drop)

**API name:** Verify bank account  
**Method / path:** `POST /partners/me/bank/verify`  
**Who:** Rider. No body.

Cashfree Verification sync (`CASHFREE_CLIENT_ID` + `CASHFREE_CLIENT_SECRET`). Never marks `verified` without a provider response.

### Success response `200`

**PartnerBankDto** with `verificationStatus`: `verified` | `pending` | `failed`. `payoutsEnabled` is true only when `verified`. `nameAtBank` + `nameMatch` when Cashfree returns the name on the account.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `BANK_DETAILS_REQUIRED` | Save account first |
| 429 | `VERIFY_IN_PROGRESS` | Cooldown (120s) while pending |
| 503 | `BANK_VERIFY_UNAVAILABLE` | Cashfree keys unset / provider down |

---

## Tax details

**API name:** Get / update PAN & GSTIN  
**Method / path:** `GET /partners/me/tax-details` · `PUT /partners/me/tax-details`  
**Who:** Rider.

### PUT request

```json
{ "panNumber": "ABCDE1234F", "panName": "Rahul Kumar", "gstin": "07ABCDE1234F1Z5", "gstLegalName": "Rahul Kumar" }
```

PAN required (format `AAAAA9999A`). GSTIN optional (15-char). GET returns masked values only.

### Success response `200`

```json
{
  "success": true,
  "data": {
    "panMasked": "ABCDE****F",
    "panName": "Rahul Kumar",
    "gstinMasked": "07**********1Z5",
    "gstLegalName": "Rahul Kumar",
    "tdsRate": 0.01,
    "updatedAt": "2026-08-09T10:00:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `INVALID_PAN` / `INVALID_GSTIN` / `PAN_REQUIRED` | Bad or missing tax IDs |

---

## Tax documents

**API name:** List tax documents  
**Method / path:** `GET /partners/me/tax-documents`  
**Who:** Rider.

Lists FY annual statement + quarterly TDS certificate + Form 16A for periods with earnings (IST, Apr–Mar FY).

### Success response `200`

```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "documentId": "tds_certificate__FY2026-27_Q1",
        "kind": "tds_certificate",
        "title": "TDS certificate Q1 FY2026-27",
        "period": "FY2026-27_Q1",
        "periodLabel": "Apr-Jun 2026 (FY2026-27)",
        "from": "2026-04-01",
        "to": "2026-06-30",
        "grossEarnings": 18400,
        "tdsAmount": 184,
        "generatedAt": "2026-08-09T10:05:00.000Z",
        "downloadPath": "/partners/me/tax-documents/tds_certificate__FY2026-27_Q1/download"
      }
    ]
  }
}
```

---

## Download tax PDF

**API name:** Download tax document  
**Method / path:** `GET /partners/me/tax-documents/:documentId/download`  
**Who:** Rider.

### Success response `200`

`Content-Type: application/pdf` attachment. Numbers come from the same IST earnings ledger as `/finance/tax-summary`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `TAX_DOCUMENT_NOT_FOUND` | Unknown id or zero earnings in period |

---

## Internal bank verification webhook

**API name:** Penny-drop callback  
**Method / path:** `POST /internal/webhooks/bank-verification`  
**Who:** Cashfree / ops. Auth: `x-internal-key`.

### Request

```json
{ "partnerId": "66aa...", "status": "verified", "reference": "cf_123", "nameAtBank": "RAHUL KUMAR", "accountLast4": "6789" }
```

`status`: `verified` \| `failed`. Optional `accountLast4` / `ifsc` must match the account on file.

---

# Incentives & Rewards APIs

Rider §14 bonus programs + loyalty points. Service: **delivery-service**. Auth: 🔑 + 🚴. CSRF on POST. Dates **Asia/Kolkata**. Progress is computed from the same IST earnings / delivery ledger as `/partners/me/earnings*` — not stub numbers. Slab bonuses credit `partner.totalEarnings` + daily `incentives` idempotently (`partnerId+program+period+slab`). `:incentiveId` is Mongo id **or** `code` (`daily_10`, `weekly_40`, `streak_5`, `dinner_peak`, `weekly_earn_2k`).

Loyalty: **10 points** per `delivered` trip. Voucher / fuel redemptions return a one-time `voucherCode` (ops-honoured — no fake HP/Amazon API). Merchandise stays `pending` until hub fulfilment.

---

## List incentives

**API name:** List incentive programs  
**Method / path:** `GET /partners/me/incentives`  
**Who:** Rider.

Empty DB is seeded once with daily 10-trip, weekly guarantee (opt-in), 5-day streak, dinner peak, weekly ₹2k earn.

### Success response `200`

```json
{
  "success": true,
  "message": "Incentive programs",
  "data": {
    "timezone": "Asia/Kolkata",
    "items": [
      {
        "incentiveId": "66aa...",
        "code": "weekly_40",
        "title": "Weekly delivery guarantee",
        "description": "Hit Mon–Sun IST trip slabs. Opt in each week to earn the bonus.",
        "kind": "delivery_count",
        "window": "week",
        "requiresOptIn": true,
        "optedIn": false,
        "status": "active",
        "startAt": "2024-01-01T00:00:00.000Z",
        "endAt": null,
        "slabs": [
          { "target": 20, "bonusInr": 150, "label": "20 trips" },
          { "target": 40, "bonusInr": 400, "label": "40 trips" },
          { "target": 60, "bonusInr": 800, "label": "60 trips" }
        ],
        "progress": {
          "incentiveId": "66aa...",
          "code": "weekly_40",
          "title": "Weekly delivery guarantee",
          "kind": "delivery_count",
          "window": "week",
          "periodKey": "2026-W32",
          "periodFrom": "2026-08-03",
          "periodTo": "2026-08-09",
          "metric": 12,
          "metricLabel": "deliveries",
          "slabs": [
            { "target": 20, "bonusInr": 150, "label": "20 trips", "achieved": false, "credited": false }
          ],
          "currentSlab": null,
          "nextSlab": { "target": 20, "bonusInr": 150, "label": "20 trips", "achieved": false, "credited": false },
          "bonusEarnedInr": 0,
          "bonusPendingInr": 0,
          "optedIn": false,
          "requiresOptIn": true,
          "eligible": true,
          "ineligibilityReason": null,
          "endsAt": "2026-08-09T18:30:00.000Z"
        }
      }
    ]
  }
}
```

`kind`: `delivery_count` \| `streak` \| `earnings` \| `peak_hours`. `window`: `day` \| `week` \| `month`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PARTNER_NOT_FOUND` | No rider profile |

---

## Incentive detail

**API name:** Get incentive program  
**Method / path:** `GET /partners/me/incentives/:incentiveId`  
**Who:** Rider.

Same **IncentiveProgramDto** as one list item (includes `progress`). Listing/detail also backfills any uncredited slabs.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `INCENTIVE_NOT_FOUND` | Unknown id or code |

---

## Incentive progress

**API name:** Live incentive progress  
**Method / path:** `GET /partners/me/incentives/:incentiveId/progress`  
**Who:** Rider. Poll on the challenge screen.

### Success response `200`

**IncentiveProgressDto** only (same `progress` object as above). `metricLabel`: `deliveries` \| `streak_days` \| `earnings_inr` \| `peak_deliveries`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `INCENTIVE_NOT_FOUND` | Unknown id or code |

---

## Opt in

**API name:** Opt in to incentive  
**Method / path:** `POST /partners/me/incentives/:incentiveId/opt-in`  
**Who:** Rider. No body. CSRF. Idempotent for the current IST period.

Auto-enrolled programs (`requiresOptIn=false`) reject opt-in. Weekly guarantee / weekly earn require opt-in each period. Progress still counts from period start after join. If already at a slab, bonus credits immediately.

### Success response `200`

**IncentiveProgramDto** with `optedIn: true`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `INCENTIVE_NOT_FOUND` | Unknown id or code |
| 409 | `PARTNER_NOT_ACTIVE` | KYC not live |
| 409 | `INCENTIVE_NOT_OPEN` | Paused / ended / not started |
| 409 | `OPT_IN_NOT_REQUIRED` | Automatic program |
| 409 | `INCENTIVE_NOT_ELIGIBLE` | Zone, vehicle, or min rating |

---

## Current incentives

**API name:** Current incentive programs  
**Method / path:** `GET /partners/me/incentives/current`  
**Who:** Rider.

Same **IncentiveListDto** as `GET /partners/me/incentives`, filtered to `status=active` (paused schemes omitted). Live IST progress included.

---

## Incentive history

**API name:** Incentive credit history  
**Method / path:** `GET /partners/me/incentives/history`  
**Who:** Rider. Query: `page`, `limit`.

Credited slab bonuses from the incentive payout ledger (same rows as wallet `incentive_credit`).

### Success response `200`

```json
{
  "success": true,
  "message": "Incentive history",
  "data": {
    "timezone": "Asia/Kolkata",
    "totalBonusInr": 550,
    "data": [
      {
        "historyId": "66aa...",
        "incentiveId": "66bb...",
        "code": "weekly_40",
        "title": "Weekly delivery guarantee",
        "periodKey": "2026-W31",
        "slabTarget": 20,
        "bonusInr": 150,
        "creditedAt": "2026-08-02T18:40:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

## Quests

**API name:** Delivery quests  
**Method / path:** `GET /partners/me/quests`  
**Who:** Rider.

Active **trip-count + streak** programs (`daily_10`, `weekly_40`, `streak_5`) with the same live progress DTO as incentives. Not a separate fake quest table.

### Success response `200`

**IncentiveListDto** (`message`: `"Quests"`).

---

## Challenges

**API name:** Incentive challenges  
**Method / path:** `GET /partners/me/challenges`  
**Who:** Rider.

Active **peak-hour + earnings** programs (`dinner_peak`, `weekly_earn_2k`) with live progress. Opt-in still required where `requiresOptIn=true`.

### Success response `200`

**IncentiveListDto** (`message`: `"Challenges"`).

---

## Reward points balance

**API name:** Get reward points  
**Method / path:** `GET /partners/me/rewards`  
**Who:** Rider.

### Success response `200`

```json
{
  "success": true,
  "message": "Reward points",
  "data": {
    "points": 120,
    "lifetimeEarned": 400,
    "redeemed": 280,
    "pointsPerDelivery": 10,
    "currency": "POINTS"
  }
}
```

---

## Rewards catalog

**API name:** Browse rewards catalog  
**Method / path:** `GET /partners/me/rewards/catalog`  
**Who:** Rider.

Seeded: `FOOD100`, `AMZN100` (voucher), `FUEL200` (fuel credit), `TEE01` (merchandise, stock 50).

### Success response `200`

```json
{
  "success": true,
  "message": "Rewards catalog",
  "data": {
    "timezone": "Asia/Kolkata",
    "points": 120,
    "items": [
      {
        "itemId": "66bb...",
        "sku": "FOOD100",
        "title": "Food voucher ₹100",
        "description": "₹100 platform food voucher. Show the code at checkout / hub.",
        "kind": "voucher",
        "pointsCost": 400,
        "valueInr": 100,
        "stock": null,
        "inStock": true,
        "imageUrl": null,
        "terms": "Valid 90 days. One-time use. Not cash.",
        "canRedeem": false
      }
    ]
  }
}
```

`stock: null` = unlimited. `canRedeem` is true only when in stock and `points >= pointsCost`.

---

## Redeem reward

**API name:** Redeem reward points  
**Method / path:** `POST /partners/me/rewards/redeem`  
**Who:** Rider. CSRF. Points are deducted atomically; stock decremented after.

### Request

```json
{ "sku": "FOOD100", "idempotencyKey": "redeem-food-2026-08-09-1" }
```

`itemId` **or** `sku`. Repeat `idempotencyKey` returns the same redemption.

### Success response `201`

```json
{
  "success": true,
  "message": "Reward redeemed",
  "data": {
    "redemptionId": "66cc...",
    "itemId": "66bb...",
    "sku": "FOOD100",
    "title": "Food voucher ₹100",
    "kind": "voucher",
    "pointsSpent": 400,
    "status": "fulfilled",
    "voucherCode": "FD-FOOD10-A1B2C3D4",
    "valueInr": 100,
    "pointsBalanceAfter": 0,
    "redeemedAt": "2026-08-09T06:15:00.000Z"
  }
}
```

Voucher / fuel: `status=fulfilled` + `voucherCode` (show once). Merchandise: `status=pending`, `voucherCode=null` (hub ships later — not marked shipped here).

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `REWARD_NOT_FOUND` | Unknown / inactive item |
| 409 | `PARTNER_NOT_ACTIVE` | KYC not live |
| 409 | `INSUFFICIENT_POINTS` | Balance too low |
| 409 | `OUT_OF_STOCK` | Finite stock exhausted |
| 422 | — | Missing `itemId` and `sku` |

---

# Admin Partner APIs

Admin KYC queue, 360° rider view, suspend/block, and tier override. Service: **delivery-service**. Gateway: `/api/v1/delivery-service`. Auth: 🔑 + 🔐 `admin` / `super_admin`. CSRF on PUT. Dates **Asia/Kolkata** for earnings windows. Timed suspends auto-expire (`suspendUntil`); go-online and assign refuse `PARTNER_SUSPENDED` / `PARTNER_BLOCKED`. Bank account and PAN are **masked**. Core KYC = `aadhar` + `drivingLicense` + `vehicleRC`.

---

## Admin list partners

**API name:** Search delivery partners  
**Method / path:** `GET /admin/partners`  
**Who:** Admin.

### Request

Query: `page`, `limit`, `status` (`pending` \| `under_review` \| `active` \| `suspended` \| `deactivated`), `city`, `zoneId`, `tier` (`bronze` \| `silver` \| `gold` \| `platinum`), `isOnline=true|false`, `search` (name / phone / partnerCode).

### Success response `200`

Paginated **AdminPartnerListDto**: `partnerId`, `partnerCode`, name, phone, vehicle, `status`, `dutyStatus`, online flags, `city`, `zoneId`, `tier`, `tierOverridden`, ratings, `totalDeliveries`, `totalEarnings`, `createdAt`. Empty page if `city` matches no zones.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_STATUS` / `INVALID_TIER` | Bad filter enum |

---

## Admin partner 360°

**API name:** Partner 360°  
**Method / path:** `GET /admin/partners/:partnerId`  
**Who:** Admin.

### Success response `200`

**AdminPartner360Dto**: profile + vehicle + `documents[]` (`documentId`, `status`, `url`, `rejectionReason`, `reviewedAt`) + `kyc.coreVerified` + masked bank/tax + performance + effective `tier` + IST month/week **EarningsSummary** + `cashInHand` + last 20 **ComplaintDto** + `activeDelivery` + suspend/block audit fields.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PARTNER_NOT_FOUND` | Unknown id |

---

## Approve KYC document

**API name:** Approve KYC document  
**Method / path:** `PUT /admin/partners/:partnerId/kyc/:documentId/approve`  
**Who:** Admin. CSRF. `documentId`: `aadhar` \| `pan` \| `drivingLicense` \| `vehicleRC` \| `insurance` \| `bankPassbook` (aliases: `aadhaar`, `dl`, `rc`).

### Request

```json
{ "note": "Clear scan" }
```

Body optional. Rider must have uploaded a URL. Idempotent if already verified. After core three are verified, partner `pending`/`under_review` → `active` + referral KYC bonus.

### Success response `200`

**AdminPartner360Dto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DOCUMENT_NOT_FOUND` / `PARTNER_NOT_FOUND` | Unknown doc or rider |
| 409 | `DOCUMENT_NOT_UPLOADED` | No file yet |
| 409 | `PARTNER_BLOCKED` | Account deactivated |

---

## Reject KYC document

**API name:** Reject KYC document  
**Method / path:** `PUT /admin/partners/:partnerId/kyc/:documentId/reject`  
**Who:** Admin. CSRF.

### Request

```json
{ "reason": "Photo blurry, re-upload Aadhaar" }
```

`reason` min 8 chars. If a **core** doc of an **active** rider is rejected → status `under_review` and forced offline.

### Success response `200`

**AdminPartner360Dto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `REASON_REQUIRED` | Missing / short reason |
| 404 | `DOCUMENT_NOT_FOUND` | Unknown documentId |
| 409 | `PARTNER_BLOCKED` | Account deactivated |

Legacy alias: `PUT /admin/partners/:partnerId/verify` body `{ "docType", "status": "verified"|"rejected", "rejectionReason?" }`.

---

## Suspend partner

**API name:** Suspend partner  
**Method / path:** `PUT /admin/partners/:partnerId/suspend`  
**Who:** Admin. CSRF.

### Request

```json
{ "reason": "Multiple customer safety complaints", "durationHours": 72 }
```

`reason` min 8. Optional `durationHours` (1–720) **or** `until` (future ISO). Omit both → indefinite. Forces offline. Timed suspend auto-expires back to `active`.

### Success response `200`

**AdminPartner360Dto** (`status: "suspended"`, `moderation.suspendUntil`).

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `PARTNER_BLOCKED` | Already deactivated |
| 409 | `PARTNER_KYC_PENDING` | Still pending / under_review |
| 422 | `INVALID_UNTIL` | `until` not in the future |

---

## Reinstate partner

**API name:** Reinstate suspended partner  
**Method / path:** `PUT /admin/partners/:partnerId/reinstate`  
**Who:** Admin. CSRF. Also `PUT /admin/partners/:partnerId/activate` when status is `suspended`.

Does **not** un-block. Activate from `pending`/`under_review` requires core KYC (`KYC_INCOMPLETE`).

### Success response `200`

**AdminPartner360Dto** (`status: "active"`).

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `PARTNER_BLOCKED` | Permanently blocked |
| 409 | `ILLEGAL_TRANSITION` | Not suspended |
| 409 | `KYC_INCOMPLETE` | Activate without core docs |

---

## Block partner

**API name:** Permanently block partner  
**Method / path:** `PUT /admin/partners/:partnerId/block`  
**Who:** Admin. CSRF.

### Request

```json
{ "reason": "Fake Aadhaar / identity fraud", "reasonCode": "fake_kyc" }
```

`reasonCode`: `fraud` \| `safety_violation` \| `criminal` \| `fake_kyc` \| `other` (default `other`). Status → `deactivated`. Idempotent if already blocked. Go-online → `403 PARTNER_BLOCKED`.

### Success response `200`

**AdminPartner360Dto**.

---

## Override partner tier

**API name:** Override partner tier  
**Method / path:** `PUT /admin/partners/:partnerId/tier/override`  
**Who:** Admin. CSRF.

### Request

```json
{ "tier": "gold", "reason": "City launch exception Q3" }
```

`tier`: `bronze` \| `silver` \| `gold` \| `platinum`, or `null` to clear override (computed tier returns). `reason` min 8. Rider `GET /partners/me/tier` shows `overridden: true`.

### Success response `200`

**AdminPartner360Dto** (`tier.overridden`, `tier.overrideReason`).

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `PARTNER_BLOCKED` | Cannot override a blocked rider |
| 404 | `PARTNER_NOT_FOUND` | Unknown id |

---

## Admin earnings adjustment

**API name:** Manual earnings adjustment  
**Method / path:** `POST /admin/partners/:partnerId/payouts/adjustment`  
**Who:** Admin. CSRF. Idempotent via `idempotencyKey`.

### Request

```json
{
  "kind": "penalty",
  "amount": 150,
  "reason": "COD short cash after hub count",
  "note": "Hub receipt #H-8821",
  "deliveryId": "66dd...",
  "idempotencyKey": "adj-cod-short-66dd-2026-08-09"
}
```

`kind`: `correction` \| `penalty` \| `goodwill`. `amount` > 0 INR, max ₹50,000. `direction` `credit` \| `debit` — required for `correction`; penalty defaults debit, goodwill defaults credit. Credits/debits `partner.totalEarnings` + IST daily ledger (`incentives` / `deductions`). Debit cannot exceed unpaid wallet (`totalEarnings − settled − pending`). Shows on rider wallet as `earnings_adjust`. **Never** marks a bank payout paid.

### Success response `201`

**AdminEarningsAdjustmentDto**: `adjustmentId`, `kind`, `direction`, `amount`, `reason`, `lifetimeAfter`, `earningsBalance`, `createdBy`, `createdAt`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `INSUFFICIENT_EARNINGS_BALANCE` | Penalty larger than unpaid earnings |
| 409 | `IDEMPOTENCY_CONFLICT` | Same key used on another rider |
| 404 | `PARTNER_NOT_FOUND` / `DELIVERY_NOT_FOUND` | Unknown rider or trip |
| 422 | `DIRECTION_REQUIRED` / `INVALID_AMOUNT` | Bad body |

---

## Admin list partner complaints

**API name:** List rider complaints  
**Method / path:** `GET /admin/partners/:partnerId/complaints`  
**Who:** Admin. Query `?status=open\|under_review\|resolved\|dismissed&page=&limit=`.

These are complaints **filed by the rider** against customer/restaurant (same `PartnerComplaint` ledger). Customer→rider reviews live on `/partners/me/ratings`, not here.

### Success response `200`

Paginated **ComplaintDto** (`complaintId`, `deliveryId`, `orderId`, `target`, `reasonCode`, `status`, `resolution`, `resolvedBy`, timestamps).

---

## Admin resolve complaint

**API name:** Resolve partner complaint  
**Method / path:** `PUT /admin/complaints/:complaintId/resolve`  
**Who:** Admin. CSRF.

### Request

```json
{ "resolution": "Customer unreachable confirmed on call logs. No action on rider.", "outcome": "resolved" }
```

`outcome`: `resolved` (default) \| `dismissed`. `resolution` min 8. Idempotent if already in that outcome.

### Success response `200`

**ComplaintDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `COMPLAINT_NOT_FOUND` | Unknown id |
| 409 | `COMPLAINT_ALREADY_RESOLVED` | Closed with a different outcome |
| 422 | `REASON_REQUIRED` | Missing resolution |

---

## Admin support ticket queue

**API name:** List partner support tickets  
**Method / path:** `GET /admin/support/tickets`  
**Who:** Admin.

### Request

Query: `page`, `limit`, `status`, `category`, `priority`, `partnerId`, `assignedTo` (admin user id or `unassigned`), `search` (ticketNo / subject).

### Success response `200`

Paginated **AdminSupportTicketListItemDto**: ticket fields + `partnerId`, `partnerName`, `partnerCode`, `assignedTo`, `assignedAt`.

---

## Admin assign support ticket

**API name:** Assign support ticket  
**Method / path:** `PUT /admin/support/tickets/:ticketId/assign`  
**Who:** Admin. CSRF. `ticketId` = Mongo id or `PT-YYYYMMDD-XXXX`.

### Request

```json
{ "agentId": "66admin...", "note": "Taking this payout dispute" }
```

`agentId` optional (defaults to caller). `open` / `waiting_partner` → `in_progress`. Appends an agent message. Cannot assign `closed`.

### Success response `200`

**SupportTicketDetailDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `TICKET_NOT_FOUND` | Unknown ticket |
| 409 | `TICKET_CLOSED` | Already closed |

---

## Admin resolve support ticket

**API name:** Resolve/close support ticket  
**Method / path:** `PUT /admin/support/tickets/:ticketId/resolve`  
**Who:** Admin. CSRF.

### Request

```json
{ "resolution": "Re-ran weekly payout; missing ₹80 credited via adjustment adj:...", "close": true }
```

`resolution` min 8. `close` default **true** → `status=closed`; `false` → `resolved` (still open for partner follow-up).

### Success response `200`

**SupportTicketDetailDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `TICKET_NOT_FOUND` | Unknown ticket |
| 409 | `TICKET_ALREADY_CLOSED` | Already closed |
| 422 | `REASON_REQUIRED` | Missing resolution |

`POST /admin/incentives` and `PUT /admin/incentives/:incentiveId` are already live (same `IncentiveProgram` ledger riders use). See below.

---

## Admin list incentives

**API name:** Admin list incentive schemes  
**Method / path:** `GET /admin/incentives`  
**Who:** Admin. Query: `status` = `draft` \| `active` \| `paused` \| `ended` (optional).

Includes draft/ended programs riders never see. Same Mongo `IncentiveProgram` collection.

### Success response `200`

```json
{
  "success": true,
  "message": "Admin incentives",
  "data": {
    "timezone": "Asia/Kolkata",
    "items": [
      {
        "incentiveId": "66aa...",
        "code": "weekly_40",
        "title": "Weekly delivery guarantee",
        "description": "Hit Mon–Sun IST trip slabs. Opt in each week to earn the bonus.",
        "kind": "delivery_count",
        "window": "week",
        "requiresOptIn": true,
        "vehicleTypes": null,
        "zoneIds": null,
        "minRating": null,
        "peakStartHour": null,
        "peakEndHour": null,
        "slabs": [
          { "target": 20, "bonusInr": 150, "label": "20 trips" },
          { "target": 40, "bonusInr": 400, "label": "40 trips" }
        ],
        "status": "active",
        "startAt": "2024-01-01T00:00:00.000Z",
        "endAt": null,
        "createdAt": "2026-08-09T05:00:00.000Z",
        "updatedAt": "2026-08-09T05:00:00.000Z"
      }
    ]
  }
}
```

---

## Admin get incentive

**API name:** Admin incentive detail  
**Method / path:** `GET /admin/incentives/:incentiveId`  
**Who:** Admin. `:incentiveId` is Mongo id **or** `code`.

### Success response `200`

**AdminIncentiveProgramDto** (`message`: `"Admin incentive"`).

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `INCENTIVE_NOT_FOUND` | Unknown id or code |

---

## Admin create incentive

**API name:** Create incentive scheme  
**Method / path:** `POST /admin/incentives`  
**Who:** Admin. CSRF.

Default `status=active` so riders see it immediately. Use `draft` to stage. `kind=peak_hours` requires `peakStartHour` + `peakEndHour` (0–23 IST). `zoneIds` must exist. `code` unique, lowercase `[a-z0-9_]`.

### Request

```json
{
  "code": "lunch_peak",
  "title": "Lunch peak bonus",
  "description": "Complete 6 deliveries between 12–3 PM IST today.",
  "kind": "peak_hours",
  "window": "day",
  "requiresOptIn": false,
  "peakStartHour": 12,
  "peakEndHour": 15,
  "slabs": [{ "target": 6, "bonusInr": 90, "label": "6 lunch trips" }],
  "status": "active"
}
```

Optional: `vehicleTypes`, `zoneIds`, `minRating`, `startAt`, `endAt`.

### Success response `201`

**AdminIncentiveProgramDto** (`message`: `"Incentive created"`).

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `PEAK_HOURS_REQUIRED` | Peak scheme missing hours |
| 400 | `ZONE_NOT_FOUND` | Unknown `zoneIds` |
| 400 | `INVALID_SLABS` / `INVALID_WINDOW` | Bad slabs or dates |
| 409 | `INCENTIVE_CODE_EXISTS` | Duplicate `code` |
| 422 | — | Validation |

---

## Admin update incentive

**API name:** Update / pause / end incentive  
**Method / path:** `PUT /admin/incentives/:incentiveId`  
**Who:** Admin. CSRF. `:incentiveId` is Mongo id **or** `code`.

`code` / `kind` / `window` cannot change. Pause: `{ "status": "paused" }` — riders still see the card but opt-in and slab credit stop. End: `{ "status": "ended" }` sets `endAt` to now if missing. Reactivate requires `endAt` in the future or `endAt: null`. Slab changes rejected after any credited bonus.

### Request (pause)

```json
{ "status": "paused" }
```

### Success response `200`

**AdminIncentiveProgramDto** (`message`: `"Incentive updated"`).

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `INCENTIVE_NOT_FOUND` | Unknown id or code |
| 409 | `INCENTIVE_HAS_PAYOUTS` | Slab edit after credits |
| 409 | `INCENTIVE_ENDED` | Activate with past `endAt` |
| 400 | `INVALID_SLABS` / `INVALID_WINDOW` / `PEAK_HOURS_REQUIRED` / `ZONE_NOT_FOUND` | Bad patch |
| 422 | — | Empty body / validation |

---

# Referral APIs

Rider-to-rider referral. Service: **delivery-service**. Auth: 🔑 + 🚴. Dates **Asia/Kolkata**. Each partner gets a unique 6-char `referralCode` (lazy-issued for old profiles). New riders pass `referralCode` on `POST /partners/register`. Referrer earns **₹100** when the referee becomes `active` (KYC) and **₹250** after **10** delivered trips — idempotent `ReferralPayout` rows, credited to `totalEarnings` + daily incentives + wallet `referral_credit`. Never fake paid.

---

## Referral code

**API name:** Get referral code  
**Method / path:** `GET /partners/me/referrals/code`  
**Who:** Rider.

`shareUrl` uses `RIDER_APP_BASE_URL` or `https://partner.fooddelivery.app/join?ref=CODE`.

### Success response `200`

```json
{
  "success": true,
  "message": "Referral code",
  "data": {
    "code": "ANSHU7",
    "shareUrl": "https://partner.fooddelivery.app/join?ref=ANSHU7",
    "shareText": "Join as a delivery partner with my code ANSHU7 and complete KYC + 10 trips — I earn a bonus when you do.",
    "referredCount": 2,
    "timezone": "Asia/Kolkata",
    "policy": {
      "kycActivateInr": 100,
      "firstTripsInr": 250,
      "firstTripsTarget": 10
    }
  }
}
```

---

## Referral list

**API name:** List referred partners  
**Method / path:** `GET /partners/me/referrals`  
**Who:** Rider. Query: `page`, `limit`.

`onboarding`: `registered` \| `under_review` \| `active` \| `suspended` \| `deactivated`.  
`earningStatus`: `pending_kyc` \| `kyc_earned` \| `trips_in_progress` \| `trips_earned`.

### Success response `200`

```json
{
  "success": true,
  "message": "Referrals",
  "data": {
    "timezone": "Asia/Kolkata",
    "referredCount": 2,
    "data": [
      {
        "refereeId": "66bb...",
        "name": "Priya S.",
        "phoneMasked": "******3210",
        "onboarding": "active",
        "earningStatus": "trips_in_progress",
        "deliveries": 4,
        "tripsTarget": 10,
        "kycBonusInr": 100,
        "tripsBonusInr": 0,
        "totalBonusInr": 100,
        "referredAt": "2026-08-01T08:00:00.000Z",
        "activatedAt": "2026-08-02T11:20:00.000Z"
      }
    ],
    "total": 2,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

## Referral earnings

**API name:** Referral earnings summary  
**Method / path:** `GET /partners/me/referrals/earnings`  
**Who:** Rider.

Also evaluates pending KYC/trip bonuses before returning (same as after activate/deliver).

### Success response `200`

```json
{
  "success": true,
  "message": "Referral earnings",
  "data": {
    "timezone": "Asia/Kolkata",
    "currency": "INR",
    "totalBonusInr": 100,
    "kycBonusInr": 100,
    "tripsBonusInr": 0,
    "pendingBonusInr": 400,
    "referredCount": 2,
    "activeCount": 1,
    "kycCreditedCount": 1,
    "tripsCreditedCount": 0,
    "policy": {
      "kycActivateInr": 100,
      "firstTripsInr": 250,
      "firstTripsTarget": 10
    },
    "recent": [
      {
        "refereeId": "66bb...",
        "name": "Priya S.",
        "kind": "kyc_activate",
        "bonusInr": 100,
        "creditedAt": "2026-08-02T11:20:00.000Z"
      }
    ]
  }
}
```

Register with a code (existing endpoint): `POST /partners/register` body may include `"referralCode": "ANSHU7"`. Invalid code → `400 INVALID_REFERRAL_CODE` (profile is not created).

---

# Communication APIs

In-trip chat + masked calling for the rider app. Service: **delivery-service**. Auth: 🔑 + 🚴. CSRF on POST. Gateway: `/api/v1/delivery-service`.

`POST /communication/chat` and `GET /communication/messages/:deliveryId` use the same `DeliveryChatMessage` ledger as `GET|POST /partners/me/deliveries/:deliveryId/chat` (30 messages / 5 min, `CHAT_CLOSED` after trip except 2 h post `delivered`/`returned`/`failed`). Masked calls use the same `MaskedCall` + Exotel/Twilio path as `/partners/me/deliveries/:deliveryId/call/*` — never fake a connect (`503 MASKED_CALL_UNAVAILABLE` if telephony env is unset). Destination numbers are always masked. Quick replies persist as real chat rows. Abuse reports persist as `CommunicationAbuseReport` (`open`).

---

## Send communication chat

**API name:** Send chat (communication alias)  
**Method / path:** `POST /communication/chat`  
**Who:** Rider (assigned trip).

### Request

```json
{ "deliveryId": "66b1...", "to": "customer", "text": "I am at the gate, please come down" }
```

`to`: `customer` \| `restaurant`. `text`: 1–500 chars.

### Success response `201`

```json
{
  "success": true,
  "message": "Message sent",
  "data": {
    "id": "66d1...",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "senderRole": "partner",
    "senderUserId": "66a1...",
    "to": "customer",
    "text": "I am at the gate, please come down",
    "createdAt": "2026-08-08T15:30:00.000Z"
  }
}
```

Publishes `DELIVERY_CHAT_MESSAGE` and socket `chat:new-message`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `CHAT_CLOSED` | Trip not in a chat-open status |
| 429 | `CHAT_RATE_LIMITED` | > 30 messages / 5 min |
| 422 | `INVALID_CHAT` / — | Empty or invalid body |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Get communication messages

**API name:** Chat history (communication alias)  
**Method / path:** `GET /communication/messages/:deliveryId`  
**Who:** Rider (own trip). Query: `limit` (default 50, max 100).

### Success response `200`

Same **DeliveryChatThreadDto** as `GET /partners/me/deliveries/:deliveryId/chat`.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |

---

## Masked call customer (communication)

**API name:** Initiate masked call to customer  
**Method / path:** `POST /communication/call/customer`  
**Who:** Rider. After accept until RTO. Max **8 calls / hour** per delivery+target.

### Request

```json
{ "deliveryId": "66b1..." }
```

### Success response `200`

**MaskedCallDto** — same as `POST /partners/me/deliveries/:deliveryId/call/customer` (`toMasked`, `virtualNumberMasked`, never full dest phone).

### Errors

| HTTP | code | When |
|---|---|---|
| 503 | `MASKED_CALL_UNAVAILABLE` | Exotel/Twilio not configured |
| 502 | `MASKED_CALL_FAILED` | Provider rejected the call |
| 409 | `PHONE_UNAVAILABLE` | Order has no customer phone |
| 409 | `PARTNER_PHONE_MISSING` | Rider profile has no phone |
| 429 | `CALL_RATE_LIMITED` | > 8 calls / hour |
| 400 | `ILLEGAL_TRANSITION` | Too early / terminal status |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad id |
| 422 | — | Missing `deliveryId` |

---

## Masked call restaurant (communication)

**API name:** Initiate masked call to restaurant  
**Method / path:** `POST /communication/call/restaurant`  
**Who:** Rider. Same rules; dest = restaurant phone (masked).

### Request

```json
{ "deliveryId": "66b1..." }
```

### Success response `200`

Same DTO with `"target": "restaurant"`.

### Errors

Same codes as customer call (`PHONE_UNAVAILABLE` if restaurant phone missing).

---

## Chat templates

**API name:** List quick-reply templates  
**Method / path:** `GET /communication/templates`  
**Who:** Rider. Query: `audience` = `customer` \| `restaurant` (optional).

### Success response `200`

```json
{
  "success": true,
  "message": "Chat templates",
  "data": {
    "items": [
      { "templateId": "at_gate", "audience": "customer", "text": "I am at the gate, please come down." },
      { "templateId": "food_ready", "audience": "restaurant", "text": "I have arrived. Is the order ready?" }
    ]
  }
}
```

`templateId`: `at_gate` \| `running_late` \| `cannot_find` \| `please_call` \| `otp_ready` \| `food_ready` \| `waiting_pickup` \| `bag_check`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_AUDIENCE` | `audience` not customer/restaurant |

---

## Quick reply

**API name:** Send predefined quick reply  
**Method / path:** `POST /communication/quick-reply`  
**Who:** Rider. Sends template text through the chat ledger (same rate + `CHAT_CLOSED` rules).

### Request

```json
{ "deliveryId": "66b1...", "templateId": "at_gate", "to": "customer" }
```

`to` optional — defaults to the template’s `audience`. Mismatch → `400 TEMPLATE_AUDIENCE_MISMATCH`.

### Success response `201`

```json
{
  "success": true,
  "message": "Quick reply sent",
  "data": {
    "id": "66d1...",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "senderRole": "partner",
    "senderUserId": "66a1...",
    "to": "customer",
    "text": "I am at the gate, please come down.",
    "templateId": "at_gate",
    "createdAt": "2026-08-08T15:30:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `TEMPLATE_NOT_FOUND` | Unknown `templateId` |
| 400 | `TEMPLATE_AUDIENCE_MISMATCH` | `to` ≠ template audience |
| 409 | `CHAT_CLOSED` | Chat closed |
| 429 | `CHAT_RATE_LIMITED` | Chat rate |
| 403 | `FORBIDDEN` | Not your trip |
| 404 | `DELIVERY_NOT_FOUND` | Bad delivery |

---

## Call history

**API name:** Masked call history  
**Method / path:** `GET /communication/call-history`  
**Who:** Rider. Query: `page`, `limit`, `deliveryId` (optional filter).

### Success response `200`

```json
{
  "success": true,
  "message": "Call history",
  "data": {
    "data": [
      {
        "callId": "66e1...",
        "deliveryId": "66b1...",
        "orderId": "66c2...",
        "target": "customer",
        "status": "initiated",
        "toMasked": "******3210",
        "virtualNumberMasked": "******1001",
        "provider": "exotel",
        "createdAt": "2026-08-08T16:10:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

Never returns full destination numbers.

---

## Report abuse

**API name:** Report abusive communication  
**Method / path:** `POST /communication/report-abuse`  
**Who:** Rider (own trip). Max **10 reports / hour**.

### Request

```json
{
  "deliveryId": "66b1...",
  "target": "customer",
  "channel": "chat",
  "reasonCode": "abusive_language",
  "note": "Customer used abusive language in chat",
  "messageId": "66d1..."
}
```

`target`: `customer` \| `restaurant`. `channel`: `chat` \| `call`. `reasonCode`: `abusive_language` \| `harassment` \| `threat` \| `fake_otp` \| `spam` \| `other` (`note` required when `other`). Optional `messageId` / `callId` must belong to this delivery.

### Success response `201`

```json
{
  "success": true,
  "message": "Abuse reported",
  "data": {
    "reportId": "66f1...",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "target": "customer",
    "channel": "chat",
    "reasonCode": "abusive_language",
    "note": "Customer used abusive language in chat",
    "messageId": "66d1...",
    "callId": null,
    "status": "open",
    "createdAt": "2026-08-08T16:20:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | Bad delivery |
| 404 | `MESSAGE_NOT_FOUND` | `messageId` not on this trip |
| 404 | `CALL_NOT_FOUND` | `callId` not on this trip |
| 403 | `FORBIDDEN` | Not your trip |
| 422 | `INVALID_ABUSE` / — | `other` without `note` |
| 429 | `ABUSE_RATE_LIMITED` | > 10 / hour |

---

# Support & Complaints APIs

Rider complaints against a customer/restaurant and in-app support tickets. Service: **delivery-service**. Auth: 🔑 + 🚴. CSRF on POST/PUT. Gateway: `/api/v1/delivery-service`.

Complaints persist as `PartnerComplaint` — one **open** complaint per delivery + target, max **10 / hour**. Tickets persist as `PartnerSupportTicket` with a human `ticketNo` (`PT-YYYYMMDD-XXXX`, IST date) and an embedded thread. Earnings/payout categories require `deliveryId` or `payoutId` on the rider’s own ledger. Attachments: HTTPS URLs (max 5) and/or multipart field `attachment` (JPEG/PNG/WEBP/PDF ≤ 5 MB → Cloudinary). Admin assign/resolve is a later §23 API; riders can close their own tickets.

---

## File complaint

**API name:** File partner complaint  
**Method / path:** `POST /partners/me/complaints`  
**Who:** Rider (own delivery). Optional multipart `attachment`.

### Request

```json
{
  "deliveryId": "66b1...",
  "target": "customer",
  "reasonCode": "abusive_language",
  "note": "Customer shouted and refused to share OTP",
  "attachments": ["https://res.cloudinary.com/.../shot.jpg"]
}
```

`target`: `customer` \| `restaurant`.  
`reasonCode`: `abusive_language` \| `harassment` \| `unsafe_location` \| `non_payment` \| `wrong_pin` \| `fake_order` \| `rude_staff` \| `long_wait` \| `other` (`note` required when `other`).

### Success response `201`

```json
{
  "success": true,
  "message": "Complaint filed",
  "data": {
    "complaintId": "66f1...",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "target": "customer",
    "reasonCode": "abusive_language",
    "note": "Customer shouted and refused to share OTP",
    "attachments": ["https://res.cloudinary.com/.../shot.jpg"],
    "status": "open",
    "resolution": null,
    "resolvedAt": null,
    "createdAt": "2026-08-08T16:20:00.000Z",
    "updatedAt": "2026-08-08T16:20:00.000Z"
  }
}
```

`status`: `open` \| `under_review` \| `resolved` \| `dismissed`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | Bad delivery |
| 403 | `FORBIDDEN` | Not your trip |
| 409 | `COMPLAINT_ALREADY_OPEN` | Open complaint already exists for this delivery+target |
| 422 | `INVALID_COMPLAINT` / — | `other` without `note` |
| 429 | `COMPLAINT_RATE_LIMITED` | > 10 / hour |

---

## List complaints

**API name:** List partner complaints  
**Method / path:** `GET /partners/me/complaints`  
**Who:** Rider. Query: `page`, `limit`, `status` (optional).

### Success response `200`

```json
{
  "success": true,
  "message": "Complaints",
  "data": {
    "data": [{ "complaintId": "66f1...", "status": "open" }],
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

Items are full **ComplaintDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_STATUS` | Unknown `status` |

---

## Create support ticket

**API name:** Raise support ticket  
**Method / path:** `POST /partners/me/support/tickets`  
**Who:** Rider. Optional multipart `attachment`.

### Request

```json
{
  "category": "earnings_dispute",
  "subject": "Missing payout for 8 Aug week",
  "description": "Weekly payout shows ₹0 but I completed 12 trips.",
  "deliveryId": "66b1...",
  "payoutId": "66e9...",
  "attachments": ["https://res.cloudinary.com/.../screenshot.png"]
}
```

`category`: `earnings_dispute` \| `payout_issue` \| `cod_issue` \| `app_bug` \| `account_issue` \| `kyc_issue` \| `incentive_issue` \| `other`.  
`earnings_dispute` / `payout_issue` require `deliveryId` or `payoutId` (must belong to the rider). `subject` 5–200, `description` 10–2000. Priority is auto: high for earnings/payout/COD, medium for account/KYC, else low.

### Success response `201`

```json
{
  "success": true,
  "message": "Support ticket created",
  "data": {
    "ticketId": "66aa...",
    "ticketNo": "PT-20260809-K7M2",
    "category": "earnings_dispute",
    "subject": "Missing payout for 8 Aug week",
    "description": "Weekly payout shows ₹0 but I completed 12 trips.",
    "status": "open",
    "priority": "high",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "payoutId": "66e9...",
    "attachments": ["https://res.cloudinary.com/.../screenshot.png"],
    "messageCount": 2,
    "lastMessageAt": "2026-08-09T06:00:00.000Z",
    "messages": [
      {
        "messageId": "66m1...",
        "senderRole": "partner",
        "senderUserId": "66a1...",
        "text": "Weekly payout shows ₹0 but I completed 12 trips.",
        "attachments": ["https://res.cloudinary.com/.../screenshot.png"],
        "createdAt": "2026-08-09T06:00:00.000Z"
      },
      {
        "messageId": "66m2...",
        "senderRole": "system",
        "senderUserId": null,
        "text": "Ticket PT-20260809-K7M2 opened.",
        "attachments": [],
        "createdAt": "2026-08-09T06:00:00.000Z"
      }
    ],
    "resolution": null,
    "resolvedAt": null,
    "closedAt": null,
    "createdAt": "2026-08-09T06:00:00.000Z",
    "updatedAt": "2026-08-09T06:00:00.000Z"
  }
}
```

`status`: `open` \| `in_progress` \| `waiting_partner` \| `resolved` \| `closed`. `senderRole`: `partner` \| `agent` \| `system`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | Bad delivery/order |
| 404 | `PAYOUT_NOT_FOUND` | Bad payout |
| 403 | `FORBIDDEN` | Not your delivery |
| 422 | `EARNINGS_REF_REQUIRED` | Dispute without delivery/payout |
| 422 | `INVALID_TICKET` / — | Subject/description too short |
| 429 | `TICKET_RATE_LIMITED` | > 10 tickets / hour |

---

## List support tickets

**API name:** List own support tickets  
**Method / path:** `GET /partners/me/support/tickets`  
**Who:** Rider. Query: `page`, `limit`, `status` (optional).

### Success response `200`

```json
{
  "success": true,
  "message": "Support tickets",
  "data": {
    "data": [
      {
        "ticketId": "66aa...",
        "ticketNo": "PT-20260809-K7M2",
        "category": "earnings_dispute",
        "subject": "Missing payout for 8 Aug week",
        "status": "open",
        "priority": "high",
        "deliveryId": "66b1...",
        "orderId": "66c2...",
        "payoutId": "66e9...",
        "messageCount": 2,
        "lastMessageAt": "2026-08-09T06:00:00.000Z",
        "createdAt": "2026-08-09T06:00:00.000Z",
        "updatedAt": "2026-08-09T06:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

List items omit the full `messages` thread.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_STATUS` | Unknown `status` |

---

## Get support ticket

**API name:** Ticket detail + thread  
**Method / path:** `GET /partners/me/support/tickets/:ticketId`  
**Who:** Rider (own ticket). `ticketId` may be Mongo id **or** `ticketNo` (`PT-20260809-K7M2`).

### Success response `200`

**SupportTicketDetailDto** (same shape as create).

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `TICKET_NOT_FOUND` | Unknown id / number |
| 403 | `FORBIDDEN` | Not your ticket |

---

## Add ticket message

**API name:** Add message to support ticket  
**Method / path:** `POST /partners/me/support/tickets/:ticketId/messages`  
**Who:** Rider. Open / in_progress / waiting_partner only. Max **30 messages / 5 min** per ticket. Optional multipart `attachment`.

### Request

```json
{ "text": "Adding the weekly earnings screenshot", "attachments": [] }
```

`text` or at least one attachment required. If status is `waiting_partner`, posting a reply reopens to `open`.

### Success response `201`

**SupportTicketDetailDto** with the new message appended.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `TICKET_NOT_FOUND` | Unknown ticket |
| 403 | `FORBIDDEN` | Not your ticket |
| 409 | `TICKET_CLOSED` | Resolved or closed |
| 422 | `INVALID_TICKET_MESSAGE` | Empty text and no attachment |
| 429 | `TICKET_MESSAGE_RATE_LIMITED` | > 30 / 5 min |

---

## Close support ticket

**API name:** Close own support ticket  
**Method / path:** `PUT /partners/me/support/tickets/:ticketId/close`  
**Who:** Rider. CSRF. No body. Allowed from `open` \| `in_progress` \| `waiting_partner` \| `resolved`.

### Success response `200`

**SupportTicketDetailDto** with `status: "closed"`, `closedAt` set, and a system message.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `TICKET_NOT_FOUND` | Unknown ticket |
| 403 | `FORBIDDEN` | Not your ticket |
| 409 | `TICKET_ALREADY_CLOSED` | Already closed |

---

## Help centre FAQ

**API name:** Rider FAQ  
**Method / path:** `GET /partners/me/support/faq`  
**Who:** Public (no auth). Query: `category` = `payouts` \| `cod` \| `kyc` \| `trip` \| `safety` \| `insurance` \| `account` \| `app`; `q` optional search.

### Success response `200`

```json
{
  "success": true,
  "message": "Help centre",
  "data": {
    "items": [
      {
        "id": "payout-weekly",
        "category": "payouts",
        "title": "When do I get paid?",
        "body": "Weekly payouts are processed every Tuesday (IST)..."
      }
    ]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_FAQ_CATEGORY` | Unknown category |

---

## Request callback

**API name:** Request support callback  
**Method / path:** `POST /partners/me/support/call-request`  
**Who:** Rider. CSRF. Queues a callback for ops — does **not** place a phone call.

### Request

```json
{ "reasonCode": "earnings", "preferredWindow": "asap", "note": "Weekly payout missing", "ticketId": "66aa..." }
```

`reasonCode`: `earnings` \| `kyc` \| `app_issue` \| `sos_followup` \| `other`.  
`preferredWindow`: `asap` \| `morning` \| `afternoon` \| `evening` (default `asap`). Optional `ticketId`.

### Success response `201`

```json
{
  "success": true,
  "message": "Callback requested",
  "data": {
    "requestId": "66c1...",
    "reasonCode": "earnings",
    "note": "Weekly payout missing",
    "preferredWindow": "asap",
    "status": "pending",
    "phoneMasked": "******3210",
    "ticketId": "66aa...",
    "createdAt": "2026-08-09T06:10:00.000Z"
  }
}
```

Publishes `PARTNER_CALLBACK_REQUESTED`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `PARTNER_PHONE_MISSING` | No phone on profile |
| 409 | `CALLBACK_ALREADY_OPEN` | Pending request in last 2 h |
| 404 | `TICKET_NOT_FOUND` | Bad `ticketId` |
| 429 | `CALLBACK_RATE_LIMITED` | > 5 / hour |

---

## Earnings dispute

**API name:** Dispute trip earning / payout  
**Method / path:** `POST /partners/me/earnings/disputes`  
**Who:** Rider. CSRF. Opens a real **earnings_dispute** or **payout_issue** support ticket (same ledger as `/support/tickets`). Optional multipart `attachment`.

### Request

```json
{
  "deliveryId": "66b1...",
  "payoutId": "66e9...",
  "reasonCode": "wrong_amount",
  "note": "Trip shows ₹42 but offer card was ₹68",
  "expectedAmount": 68
}
```

`deliveryId` **or** `payoutId` required (must belong to the rider). `reasonCode`: `missing_payout` \| `wrong_amount` \| `wait_time` \| `incentive_missing` \| `cod_adjust` \| `other`. `note` 10–2000 chars.

### Success response `201`

**EarningsDisputeDto** = **SupportTicketDetailDto** + `disputeId` (same as `ticketId`). Status starts `open`.

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `EARNINGS_REF_REQUIRED` | No delivery/payout id |
| 404 | `DELIVERY_NOT_FOUND` / `PAYOUT_NOT_FOUND` | Bad ref |
| 409 | `DISPUTE_ALREADY_OPEN` | Open dispute already on this ref |
| 429 | `TICKET_RATE_LIMITED` | Same 10 tickets / hour cap |

---

## Trigger SOS

**API name:** Panic SOS  
**Method / path:** `POST /partners/me/sos`  
**Who:** Rider. CSRF. Attaches active trip if any. Updates Redis live location. Alerts ops via Redis event + socket `sos:triggered`. Does **not** fake a police call.

### Request

```json
{ "latitude": 28.6139, "longitude": 77.2090, "accuracy": 12, "note": "Followed by unknown bike" }
```

### Success response `201`

```json
{
  "success": true,
  "message": "SOS triggered",
  "data": {
    "sosId": "66s1...",
    "status": "active",
    "deliveryId": "66b1...",
    "orderId": "66c2...",
    "latitude": 28.6139,
    "longitude": 77.2090,
    "accuracy": 12,
    "note": "Followed by unknown bike",
    "phoneMasked": "******3210",
    "resolveReason": null,
    "triggeredAt": "2026-08-09T06:15:00.000Z",
    "resolvedAt": null,
    "createdAt": "2026-08-09T06:15:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `SOS_ALREADY_ACTIVE` | Unresolved SOS already open |
| 409 | `PARTNER_PHONE_MISSING` | No phone |
| 422 | `LOCATION_REQUIRED` | No coords and no last GPS |
| 429 | `SOS_RATE_LIMITED` | > 10 / hour |

---

## Resolve SOS

**API name:** Resolve / false-alarm SOS  
**Method / path:** `PUT /partners/me/sos/:sosId/resolve`  
**Who:** Rider (own SOS). CSRF.

### Request

```json
{ "reason": "false_alarm", "note": "Reached a safe area" }
```

`reason`: `false_alarm` \| `safe_now` \| `ops_assisted`. `false_alarm` → status `false_alarm`; otherwise `resolved`.

### Success response `200`

**SosIncidentDto** with `resolvedAt` set. Socket `sos:resolved`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `SOS_NOT_FOUND` | Bad id |
| 403 | `FORBIDDEN` | Not your SOS |
| 409 | `SOS_NOT_ACTIVE` | Already resolved |

---

## SOS history

**API name:** SOS history  
**Method / path:** `GET /partners/me/sos/history`  
**Who:** Rider. Query: `page`, `limit`, `status` = `active` \| `acknowledged` \| `resolved` \| `false_alarm`.

### Success response `200`

Paginated `{ data, total, page, limit, totalPages }` of **SosIncidentDto**. Phone always masked.

---

## Safety incident report

**API name:** Non-emergency incident  
**Method / path:** `POST /partners/me/safety/incident-report`  
**Who:** Rider. CSRF. Optional multipart `attachment`.

### Request

```json
{
  "kind": "harassment",
  "note": "Customer used abusive language at drop",
  "deliveryId": "66b1...",
  "latitude": 28.61,
  "longitude": 77.21
}
```

`kind`: `harassment` \| `accident` \| `unsafe_location` \| `theft` \| `vehicle_issue` \| `medical` \| `other`. `note` 10–2000.

### Success response `201`

**SafetyIncidentDto** with `status: "open"`. Event `PARTNER_SAFETY_INCIDENT`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | Bad delivery |
| 403 | `FORBIDDEN` | Not your trip |
| 429 | `INCIDENT_RATE_LIMITED` | > 10 / hour |

---

## Insurance cover

**API name:** Platform on-duty cover  
**Method / path:** `GET /partners/me/safety/insurance-cover`  
**Who:** Rider. Group policy (not a fake per-rider LIC policy). `eligible` is true only when partner status is `active`.

### Success response `200`

```json
{
  "success": true,
  "message": "Insurance cover",
  "data": {
    "productName": "On-duty accident & hospitalisation cover",
    "provider": "Platform group policy",
    "currency": "INR",
    "accidentSumInsuredInr": 1000000,
    "hospitalisationSumInsuredInr": 100000,
    "whileOnDuty": true,
    "claimSlaDays": 15,
    "helpline": "1800-202-FOOD",
    "timezone": "Asia/Kolkata",
    "policyRef": "FD-INS-A1B2C3",
    "eligible": true,
    "eligibilityReason": null,
    "covered": ["Accident while online or on an active delivery"],
    "exclusions": ["Off-duty incidents (offline and not on a trip)"]
  }
}
```

---

## File insurance claim

**API name:** Submit insurance claim  
**Method / path:** `POST /partners/me/safety/insurance-claim`  
**Who:** Rider (KYC `active`). CSRF. Optional multipart `attachment`. Accident / hospitalisation **require** at least one attachment. Status stays **`submitted`** until ops/insurer — never fake `paid`.

### Request

```json
{
  "kind": "accident",
  "incidentAt": "2026-08-09T06:12:00.000Z",
  "description": "Two-wheeler collision near drop pin. Rider ok, bike damaged.",
  "deliveryId": "66b1...",
  "sosId": "66s1...",
  "attachments": ["https://res.cloudinary.com/.../scene.jpg"]
}
```

`kind`: `accident` \| `hospitalisation` \| `vehicle_damage` \| `third_party` \| `other`. `description` ≥ 20 chars.

### Success response `201`

**InsuranceClaimDto** (`claimNo` like `IC-20260809-K7M2`, `status: "submitted"`, `amountInr: null`).

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `KYC_NOT_ACTIVE` | Profile not active |
| 422 | `CLAIM_EVIDENCE_REQUIRED` | Accident/hospitalisation without file |
| 422 | `INVALID_CLAIM` | Bad `incidentAt` / short description |
| 404 | `SOS_NOT_FOUND` / `INCIDENT_NOT_FOUND` / `DELIVERY_NOT_FOUND` | Bad link |
| 429 | `CLAIM_RATE_LIMITED` | > 5 / day |

---

## Get insurance claim

**API name:** Track insurance claim  
**Method / path:** `GET /partners/me/safety/insurance-claim/:claimId`  
**Who:** Rider. `claimId` may be Mongo id or `claimNo`.

### Success response `200`

**InsuranceClaimDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `CLAIM_NOT_FOUND` | Unknown claim |
| 403 | `FORBIDDEN` | Not your claim |

---

## Support path aliases

**API name:** `/support/*` aliases  
**Who:** Rider (🔑 + 🚴). CSRF on POST. Same DTOs and error codes as the canonical `/partners/me/...` routes.

| Alias | Canonical |
|---|---|
| `POST /support/tickets` | `POST /partners/me/support/tickets` |
| `GET /support/tickets` | `GET /partners/me/support/tickets` |
| `GET /support/tickets/:ticketId` | `GET /partners/me/support/tickets/:ticketId` |
| `POST /support/sos` | `POST /partners/me/sos` |
| `GET /support/help-center` | `GET /partners/me/support/faq` (partner auth on alias) |

---

## Report accident

**API name:** Report accident (alias)  
**Method / path:** `POST /support/report-accident`  
**Who:** Rider. CSRF. Writes a **SafetyIncident** with `kind: "accident"`. If `deliveryId` is omitted, the active trip is attached when one exists.

### Request

```json
{ "note": "Two-wheeler slip near drop pin", "latitude": 28.61, "longitude": 77.21 }
```

Same fields as incident report minus `kind`. Optional multipart `attachment`.

### Success response `201`

**SafetyIncidentDto** with `"kind": "accident"`.

### Errors

Same as incident report (`INVALID_INCIDENT`, `DELIVERY_NOT_FOUND`, `INCIDENT_RATE_LIMITED`).

---

## Report fraud

**API name:** Report suspicious activity  
**Method / path:** `POST /support/report-fraud`  
**Who:** Rider. CSRF. Writes a **SafetyIncident** with `kind: "fraud"`.

### Request

```json
{ "note": "Customer asked me to complete OTP without handing over food", "deliveryId": "66b1..." }
```

### Success response `201`

**SafetyIncidentDto** with `"kind": "fraud"`.

### Errors

Same as incident report.

---

## Submit feedback

**API name:** Rider service feedback  
**Method / path:** `POST /support/feedback`  
**Who:** Rider. CSRF. Persists `PartnerFeedback` (not a stub). Optional multipart `attachment`. Max **10 / hour**.

### Request

```json
{
  "category": "app",
  "message": "Offer sheet sometimes freezes after reject",
  "rating": 3,
  "deliveryId": "66b1..."
}
```

`category`: `app` \| `delivery` \| `support` \| `payout` \| `safety` \| `other`. `message` 10–2000. `rating` optional 1–5. Optional `ticketId`.

### Success response `201`

```json
{
  "success": true,
  "message": "Feedback submitted",
  "data": {
    "feedbackId": "66fb...",
    "category": "app",
    "message": "Offer sheet sometimes freezes after reject",
    "rating": 3,
    "deliveryId": "66b1...",
    "ticketId": null,
    "attachments": [],
    "createdAt": "2026-08-09T06:40:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `INVALID_FEEDBACK` / — | Short message |
| 404 | `DELIVERY_NOT_FOUND` / `TICKET_NOT_FOUND` | Bad link |
| 429 | `FEEDBACK_RATE_LIMITED` | > 10 / hour |

---

# Internal restaurant snapshot / cart validate — restaurant-service

Gateway: `/api/v1/restaurant-service`. **Who:** cart / order / delivery / search services only. Header `x-internal-key`. Never expose raw kitchen phone on customer or rider public DTOs — use `GET .../phone` only for masked-call providers.

## Internal restaurant snapshot

**API name:** Restaurant internal snapshot  
**Method / path:** `GET /internal/restaurants/:restaurantId`  
**Auth:** 🔒 `x-internal-key`

### Success `200`

```json
{
  "success": true,
  "message": "Restaurant snapshot",
  "data": {
    "restaurantId": "66r1...",
    "name": "Pizza Hut Dwarka",
    "slug": "pizza-hut-dwarka-1234",
    "status": "active",
    "isOnline": true,
    "isAcceptingOrders": true,
    "isPaused": false,
    "pausedUntil": null,
    "latitude": 28.5921,
    "longitude": 77.0460,
    "phone": "+919876543210",
    "zoneId": "66z1...",
    "avgPrepTime": 30,
    "address": { "street": "...", "city": "Delhi", "state": "DL", "pincode": "110075", "country": "IN" },
    "logo": null,
    "coverImage": null,
    "avgRating": 4.2,
    "ownerId": "66u1...",
    "settings": {
      "taxRate": 5,
      "packagingCharge": 10,
      "minimumOrderValue": 99,
      "avgPrepTime": 30,
      "isPureVeg": false,
      "isCashOnDelivery": true,
      "isOnlinePayment": true,
      "acceptScheduledOrders": false,
      "autoAcceptOrders": false,
      "sellsAlcohol": false,
      "maxDeliveryRadius": 10
    }
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `RESTAURANT_NOT_FOUND` | Missing or soft-deleted |
| 403 | — | Bad / missing `x-internal-key` |

## Internal kitchen phone

**API name:** Kitchen phone (masked-call)  
**Method / path:** `GET /internal/restaurants/:restaurantId/phone`  
**Auth:** 🔒

### Success `200`

```json
{
  "success": true,
  "message": "Kitchen phone",
  "data": { "restaurantId": "66r1...", "phone": "+919876543210", "hasPhone": true }
}
```

## Internal force online / offline

**API name:** Force restaurant duty  
**Method / path:** `PUT /internal/restaurants/:restaurantId/online`  
**Auth:** 🔒

### Request

```json
{ "isOnline": false, "reason": "zone_rain" }
```

Force online only when listing `status=active` (`409 ILLEGAL_TRANSITION` otherwise).

## Internal sync ratings from reviews

**API name:** Sync browse histogram from review-service  
**Method / path:** `POST /internal/restaurants/:restaurantId/ratings/sync`  
**Auth:** 🔒 `x-internal-key` · **Who:** review-rating-service after create/delete review

### Request

```json
{
  "avgRating": 4.3,
  "totalRatings": 820,
  "breakdown": { "1": 30, "2": 40, "3": 100, "4": 250, "5": 400 }
}
```

### Success `200`

```json
{
  "success": true,
  "message": "Restaurant ratings synced",
  "data": { "restaurantId": "66r1...", "synced": true }
}
```

Invalidates restaurant Redis cache. If sync fails, review-service queues Mongo retry jobs.

## Internal menu item (cart)

**API name:** Live menu item  
**Method / path:** `GET /internal/restaurants/:restaurantId/items/:itemId`  
**Auth:** 🔒

### Success `200`

```json
{
  "success": true,
  "message": "Menu item snapshot",
  "data": {
    "itemId": "66i1...",
    "restaurantId": "66r1...",
    "categoryId": "66c1...",
    "name": "Margherita",
    "price": 299,
    "discountedPrice": 249,
    "effectivePrice": 249,
    "isAvailable": true,
    "unavailableUntil": null,
    "unavailableReason": null,
    "isAgeRestricted": false,
    "isVeg": true,
    "prepMinutes": 15,
    "image": null,
    "taxRate": 5,
    "packagingCharge": 10,
    "modifierGroups": []
  }
}
```

## Internal items batch (cart validate)

**API name:** Menu items batch  
**Method / path:** `POST /internal/restaurants/:restaurantId/items/batch`  
**Auth:** 🔒

### Request

```json
{ "itemIds": ["66i1...", "66i2..."] }
```

Max 50 ids. Missing ids listed in `missingIds` (not 404 for partial).

### Success `200`

```json
{
  "success": true,
  "message": "Menu items batch",
  "data": {
    "restaurantId": "66r1...",
    "restaurant": { "restaurantId": "66r1...", "isAcceptingOrders": true, "settings": { "taxRate": 5 } },
    "items": [{ "itemId": "66i1...", "effectivePrice": 249, "isAvailable": true }],
    "missingIds": []
  }
}
```

See **Cart validate** below. This endpoint + restaurant snapshot are the menu half of that flow.

# Cart core CRUD — cart-service

**Gateway:** `/api/v1/cart-service` · **Auth:** 👤 OptAuth (guest: `x-session-id` or `session_id` cookie)

**Response note:** `GET /cart` returns enriched **`CartViewDto`** (`cartId`, `ageGate`, `group`, …). Mutating routes below return persisted Mongo **`ICart`** (`_id`, ObjectIds) unless noted.

## Health liveness

**GET** `/health` · 🔓 · `{ "status": "ok", "service": "cart-service", "uptime": 123.4 }` (no `{ success }` envelope)

## Add cart item

**POST** `/cart/items` · 👤

```json
{
  "restaurantId": "66r1...",
  "restaurantName": "Spice Hub",
  "menuItemId": "66mi1...",
  "name": "Paneer Roll",
  "price": 180,
  "quantity": 1,
  "modifiers": [{ "groupId": "g1", "groupName": "Size", "optionId": "o1", "optionName": "Regular", "price": 0 }]
}
```

**201** `{ success, message, data: ICart }` · Errors: `409 AGE_VERIFICATION_REQUIRED` · `400 ALCOHOL_NOT_ALLOWED_IN_CITY` · `409 GROUP_LOCKED` · `409 RESTAURANT_MISMATCH`

## Update / remove item

**PUT** `/cart/items/:itemId` · `{ "quantity": 2 }` (0 removes) → **200** `ICart`  
**DELETE** `/cart/items/:itemId` → **200** `ICart`

## Clear cart

**DELETE** `/cart` → **200** `{ success, message }` (no `data`)

## Coupon / tip / delivery

**POST** `/cart/coupon` · 🔑 · `{ "code": "SAVE50" }` → **200** `ICart`  
**DELETE** `/cart/coupon` · 🔑 → **200** `ICart`  
**PUT** `/cart/tip` · 🔑 · `{ "tipAmount": 20 }` → **200** `ICart`  
**PUT** `/cart/delivery-address` · 🔑 · `{ "addressId": "66a1..." }` → **200** `ICart`  
**PUT** `/cart/delivery-type` · 🔑 · `{ "deliveryType": "delivery" | "pickup" }` → **200** `ICart`

## Merge guest cart

**POST** `/cart/merge` · 🔑 · requires guest `x-session-id` / `session_id` → **200** `ICart`

## Saved carts

**GET** `/cart/saved` · 🔑 → **200** `ISavedCart[]`  
**POST** `/cart/save` · 🔑 · optional `{ "name": "Later" }` → **201** `ISavedCart`  
**POST** `/cart/saved/:savedCartId/restore` · 🔑 → **200** `ICart`  
**DELETE** `/cart/saved/:savedCartId` · 🔑 → **200** message only

---

## Cart validate — cart-service

**API name:** Validate cart (checkout gate)  
**Method / path:** `POST /cart/validate`  
**Gateway:** `/api/v1/cart-service`  
**Auth:** 👤 OptAuth (cookie `_sid` or guest session)  
**Who:** Customer app before place-order

### Request

Optional body for pickup; **required** for `deliveryType: delivery`:

```json
{ "dropLat": 28.5921, "dropLng": 77.0460 }
```

`dropLat` + `dropLng` must both be numbers or both omitted.

### Behaviour

1. Restaurant `GET /internal/restaurants/:id` + `POST .../items/batch` — live prices, stock, closed flag. Soft issues → `warnings[]` (`PRICE_CHANGED`, `ITEM_UNAVAILABLE`, `RESTAURANT_CLOSED`, …).  
2. **Pickup:** skips zone/surge; `serviceable: true`, `reasonCode: "pickup"`, `deliveryFee: 0`.  
3. **Delivery:** drop pin required. Calls delivery `POST /internal/serviceability/check` + `POST /internal/eta/quote-checkout` + `GET /internal/surge/quote` when multiplier missing.  
4. On serviceable: `deliveryFee = BASE_DELIVERY_FEE × surgeMultiplier` (**never invents surge**).  
5. Missing pin / unserviceable / surge down → **HTTP error** (menu repricing is still persisted first).

### Success `200`

```json
{
  "success": true,
  "message": "Cart validated",
  "data": {
    "restaurantId": "66r1...",
    "items": [],
    "subtotal": 498,
    "deliveryFee": 48,
    "taxAmount": 25,
    "discount": 0,
    "grandTotal": 571,
    "warnings": ["PRICE_CHANGED:66i1..."],
    "valid": true,
    "serviceable": true,
    "surgeMultiplier": 1.2,
    "promiseMinutes": 38,
    "reasonCode": null
  }
}
```

### Errors

| Status | Code |
|---|---|
| 400 | `DROP_PIN_REQUIRED` · `ZONE_RAIN` · `ZONE_CLOSED` · `OUTSIDE_HOURS` · `OUT_OF_ZONE` |
| 422 | `VALIDATION_ERROR` (drop pin pair invalid) |
| 404 | `RESTAURANT_NOT_FOUND` / `CART_NOT_FOUND` |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` · `DELIVERY_SERVICE_UNAVAILABLE` · `SURGE_UNAVAILABLE` |

---

## Get cart — cart-service

**API name:** Get active cart  
**Method / path:** `GET /cart`  
**Gateway:** `/api/v1/cart-service`  
**Auth:** 👤 OptAuth · **Who:** Customer app cart screen  
**Guest:** header `x-session-id` or cookie `session_id`. No identity → `data: null`. Empty/missing cart → `data: null` (not 404).

### Success `200`

```json
{
  "success": true,
  "message": "Cart retrieved",
  "data": {
    "cartId": "66c1...",
    "restaurantId": "66r1...",
    "restaurantName": "Spice Hub",
    "restaurantSlug": "spice-hub",
    "items": [
      {
        "itemId": "66li1...",
        "menuItemId": "66mi1...",
        "name": "Paneer Roll",
        "price": 180,
        "originalPrice": 200,
        "image": null,
        "isVeg": true,
        "quantity": 2,
        "modifiers": [],
        "itemTotal": 360,
        "instructions": null,
        "isAgeRestricted": false,
        "addedByUserId": "66u1...",
        "addedByNameMasked": "You"
      }
    ],
    "coupon": null,
    "instructions": { "cooking": "Less spicy", "cutlery": true, "leaveAtDoor": false },
    "scheduledFor": null,
    "isScheduled": false,
    "hasAgeRestrictedItems": false,
    "ageGate": { "verified18": true, "blocked": false },
    "group": null,
    "tipAmount": 20,
    "walletApplied": 0,
    "deliveryType": "delivery",
    "deliveryAddressId": "66a1...",
    "subtotal": 360,
    "packagingCharge": 10,
    "deliveryFee": 40,
    "taxAmount": 18.5,
    "taxRate": 5,
    "discount": 0,
    "grandTotal": 448.5,
    "currency": "INR",
    "updatedAt": "2026-08-11T06:00:00.000Z"
  }
}
```

`ageGate` is `null` when no 18+ lines and guest/logged-in without need. Bill breakdown → `GET /cart/bill`.

---

# Cart bill / schedule / wallet / share — cart-service

## Get bill

**API name:** Cart bill breakdown  
**Method / path:** `GET /cart/bill?dropLat=&dropLng=`  
**Auth:** 👤 OptAuth · **Who:** Customer checkout screen

Reuses validate WIRE (restaurant + delivery). Delivery carts must pass drop pin. Unserviceable → hard `400` with `ZONE_*`.

### Success `200`

```json
{
  "success": true,
  "message": "Bill",
  "data": {
    "itemsSubtotal": 958,
    "packagingCharge": 10,
    "deliveryFeeBase": 40,
    "surgeMultiplier": 1.2,
    "deliveryFee": 48,
    "rainFee": 15,
    "taxAmount": 48,
    "taxRate": 5,
    "discount": 50,
    "couponCode": "SAVE50",
    "tipAmount": 20,
    "walletApplied": 0,
    "loyaltyPointsApplied": 0,
    "loyaltyDiscount": 0,
    "superFreeDelivery": false,
    "superPlanKey": null,
    "freeDeliveryMinOrder": 199,
    "grandTotal": 1034,
    "serviceable": true,
    "reason": { "code": "ok", "message": "Deliverable" },
    "promiseMinutes": 30,
    "promiseAt": "2026-08-10T12:30:00.000Z",
    "currency": "INR",
    "group": null
  }
}
```

### Errors

| HTTP | code |
|---|---|
| 400 | `DROP_PIN_REQUIRED` · `ZONE_RAIN` · `ZONE_CLOSED` · `OUTSIDE_HOURS` · `OUT_OF_ZONE` |
| 404 | `CART_NOT_FOUND` |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` · `DELIVERY_SERVICE_UNAVAILABLE` |

## Update instructions

**API name:** Cart cooking / delivery notes  
**Method / path:** `PUT /cart/instructions`  
**Auth:** 👤 · CSRF

```json
{ "cooking": "less spicy", "cutlery": false, "leaveAtDoor": true }
```

All optional. `cooking` max 200. Persisted on cart `instructions`.

## Schedule slots + set schedule

**GET** `/cart/slots?date=2026-08-11` · 🔑 → `{ date, timezone: "Asia/Kolkata", slots: [{ start, end, available }] }`  
Slots come from the cart restaurant’s weekly timings + holidays + special hours (IST). Closed day → `slots: []`. Lead time 45 min. Restaurant snapshot down → `503 RESTAURANT_SERVICE_UNAVAILABLE`.  
**PUT** `/cart/schedule` · 🔑 · `{ "scheduledFor": "ISO" | null }` · past → `400 SLOT_UNAVAILABLE`

## Cart summary

**GET** `/cart/summary` · 👤 → `{ itemCount, restaurantId, grandTotal, currency }` (empty cart → zeros / null restaurant)

## Wallet apply / remove

**PUT** `/cart/wallet` · 🔑 · `{ "amount": 100 }` — balance from user-service `GET /internal/users/:id`  
**DELETE** `/cart/wallet` · 🔑  

Errors: `WALLET_INSUFFICIENT` · `WALLET_LOCKED` · `USER_SERVICE_UNAVAILABLE`

Ledger debit happens at order place (COD / full wallet) or payment verify (split). Apply on cart is a snapshot only.

## Loyalty apply / remove

**PUT** `/cart/loyalty` · 🔑 · `{ "points": 200 }` — 10 points = ₹1; balance from customer `GET /internal/loyalty/:userId`  
**DELETE** `/cart/loyalty` · 🔑  

Errors: `LOYALTY_INSUFFICIENT` · `CUSTOMER_SERVICE_UNAVAILABLE` · `422 VALIDATION_ERROR` (min 10 points)

Burn happens at place/verify via `POST /internal/loyalty/redeem` (idempotent). Super free delivery is applied automatically on validate/bill when membership is active and subtotal ≥ `freeDeliveryMinOrder`.

## Create share (group host)

**POST** `/cart/share` · 🔑 · `{ "ttlHours": 4 }` optional 1–12  
**Success `201`:** `{ groupId, cartId, shareToken, shareUrl, role: "host", locked, expiresAt, members[] }`  
Idempotent while open group exists for host.

## Share preview (public deep link)

**API name:** Group share preview  
**Method / path:** `GET /cart/share/:shareToken`  
**Auth:** 🔓 · Who: guest / deep-link before join

### Success `200`

```json
{
  "restaurantId": "66r1...",
  "restaurantName": "Pizza Hut",
  "hostNameMasked": "An***",
  "itemCount": 3,
  "memberCount": 2,
  "locked": false,
  "expiresAt": "2026-08-10T16:00:00.000Z"
}
```

No full PII, no line prices.  
**Errors:** `404 SHARE_NOT_FOUND` · `404 SHARE_EXPIRED`

## Join group cart

**API name:** Join group share  
**Method / path:** `POST /cart/share/:shareToken/join`  
**Auth:** 🔑 customer · optional `x-user-name` header for display name

### Request

Empty body (or `{}`). Guest’s own same-restaurant cart lines are merged into the host cart, then the guest cart is deleted.

### Success `200`

```json
{
  "group": {
    "groupId": "66cg...",
    "cartId": "66ca...",
    "shareToken": "base64url…",
    "shareUrl": "https://app…/c/…",
    "role": "guest",
    "locked": false,
    "expiresAt": "2026-08-10T16:00:00.000Z",
    "hostUserId": "66aa...",
    "members": [
      { "userId": "66aa...", "displayName": "Anshu", "role": "host", "itemCount": 2, "subtotal": 420 },
      { "userId": "66bb...", "displayName": "Guest", "role": "guest", "itemCount": 1, "subtotal": 180 }
    ],
    "items": [
      {
        "itemId": "66li...",
        "name": "Margherita",
        "quantity": 1,
        "itemTotal": 299,
        "addedByUserId": "66aa...",
        "addedByNameMasked": "An***"
      }
    ]
  },
  "cart": { "_id": "66ca...", "items": [], "totals": {} }
}
```

Idempotent if already a member. Max **8** members.  
**Errors:** `404 SHARE_NOT_FOUND` · `404 SHARE_EXPIRED` · `409 GROUP_LOCKED` · `409 GROUP_FULL` · `409 RESTAURANT_MISMATCH`

## Get current group

**API name:** Get group cart  
**Method / path:** `GET /cart/group`  
**Auth:** 🔑 customer

### Success `200`

`data` = `CartGroupDto` (same shape as join `group`) or `null` when not in an open group.

## Lock / unlock group (host)

**API name:** Lock group cart  
**Method / path:** `PUT /cart/group/lock`  
**Auth:** 🔑 host

### Request

```json
{ "locked": true }
```

### Success `200`

`CartGroupDto`. Guests cannot add/update/remove while locked → `409 GROUP_LOCKED`.  
**Errors:** `404 SHARE_NOT_FOUND` · `403 FORBIDDEN` (non-host)

## Leave group (guest)

**API name:** Leave group cart  
**Method / path:** `DELETE /cart/group/leave`  
**Auth:** 🔑 guest

### Request

```json
{ "removeMyItems": true }
```

`removeMyItems` optional (default false — lines stay on host cart).

### Success `200`

```json
{ "left": true }
```

Host cannot leave → `403 FORBIDDEN` (use `DELETE /cart/group`).  
**Errors:** `404 SHARE_NOT_FOUND` · `403 FORBIDDEN`

## Kick member (host)

**API name:** Kick group member  
**Method / path:** `DELETE /cart/group/members/:userId`  
**Auth:** 🔑 host

### Request

```json
{ "removeItems": true }
```

`removeItems` optional (default false).

### Success `200`

`CartGroupDto` after kick.  
**Errors:** `404 SHARE_NOT_FOUND` · `403 FORBIDDEN` · `400 VALIDATION_ERROR` (kick self)

## Dissolve group (host)

**API name:** Dissolve group cart  
**Method / path:** `DELETE /cart/group`  
**Auth:** 🔑 host

### Success `200`

```json
{ "dissolved": true }
```

Share token revoked; guests lose membership; all lines stay on host cart.  
**Errors:** `404 SHARE_NOT_FOUND` · `403 FORBIDDEN`

## Repeat order into cart

**API name:** Repeat past order  
**Method / path:** `POST /cart/repeat/:orderId`  
**Auth:** 🔑 customer

Fetches order via order-service internal batch (ownership checked), rehydrates live menu prices/stock from restaurant-service. Unavailable lines skipped with `warnings[]`.

### Success `200`

```json
{
  "cart": { "_id": "66ca...", "items": [], "grandTotal": 520 },
  "warnings": ["UNAVAILABLE:Garlic Bread"],
  "addedCount": 2,
  "skippedCount": 1
}
```

**Errors:** `404 ORDER_NOT_FOUND` · `403 FORBIDDEN` · `400 CART_EMPTY` · `503 ORDER_SERVICE_UNAVAILABLE` · `503 RESTAURANT_SERVICE_UNAVAILABLE`

## Discover coupons

**API name:** Discover coupons  
**Method / path:** `GET /coupons?lat=&lng=&restaurantId=`  
**Auth:** 🔑 customer

### Success `200`

```json
[
  {
    "code": "SAVE50",
    "title": "Flat ₹50 off",
    "description": "On orders above ₹299",
    "type": "flat",
    "value": 50,
    "minOrderValue": 299,
    "maxDiscount": null,
    "endsAt": "2026-12-31T23:59:59.000Z"
  }
]
```

Empty array when none match. Catalog is Mongo `coupons` (admin CMS §5 still NEW for CRUD).

## Preview coupon

**API name:** Preview coupon  
**Method / path:** `GET /coupons/:code/preview?restaurantId=&subtotal=`  
**Auth:** 🔑 customer

Uses active cart when present; otherwise pass `restaurantId` + `subtotal`.

### Success `200`

```json
{
  "valid": true,
  "code": "SAVE50",
  "discount": 50,
  "type": "flat",
  "minOrder": 299,
  "message": "Coupon applicable"
}
```

`valid: false` returns same shape with `message` (does not 404 for soft preview). Apply still uses `POST /cart/coupon` with typed errors.

Revealed scratch codes (`POST /customers/scratch-cards/:id/reveal` → `couponCode`) apply on `POST /cart/coupon` after cart looks up the catalog coupon (and confirms reveal via customer `GET /internal/scratch/coupon?userId=&code=`). Missing catalog row → `404 COUPON_NOT_FOUND`. Unrevealed / expired scratch → not applied.

## Cart readiness

**API name:** Cart service readiness  
**Method / path:** `GET /health/ready`  
**Auth:** 🔓

### Success `200`

```json
{
  "status": "ok",
  "service": "cart-service",
  "uptime": 12.3,
  "checks": { "mongo": "up", "redis": "up" }
}
```

### Not ready `503`

```json
{
  "status": "not_ready",
  "service": "cart-service",
  "uptime": 12.3,
  "checks": { "mongo": "up", "redis": "down" }
}
```

## Admin list coupons

**API name:** Admin list coupons  
**Method / path:** `GET /admin/coupons?active=&code=&city=&restaurantId=&page=&limit=`  
**Auth:** 🔑 admin / super_admin · Who: admin panel

### Success `200`

```json
{
  "success": true,
  "message": "Coupons fetched",
  "data": [
    {
      "couponId": "66cp...",
      "code": "SAVE50",
      "title": "Flat ₹50 off",
      "description": "On orders above ₹299",
      "type": "flat",
      "value": 50,
      "minOrderValue": 299,
      "maxDiscount": null,
      "startAt": "2026-01-01T00:00:00.000Z",
      "endAt": "2026-12-31T23:59:59.000Z",
      "usageLimit": 10000,
      "usageCount": 12,
      "perUserLimit": 1,
      "restaurantIds": [],
      "cityIds": [],
      "isActive": true,
      "remainingUses": 9988,
      "createdAt": "2026-08-01T10:00:00.000Z",
      "updatedAt": "2026-08-11T10:00:00.000Z"
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 20, "totalPages": 1, "hasNext": false }
}
```

## Admin get coupon

**API name:** Admin get coupon  
**Method / path:** `GET /admin/coupons/:couponId`  
**Auth:** 🔑 admin / super_admin  

**Errors:** `404 COUPON_NOT_FOUND`

## Admin create coupon

**API name:** Admin create coupon  
**Method / path:** `POST /admin/coupons`  
**Auth:** 🔑 admin / super_admin · CSRF

### Request

```json
{
  "code": "SAVE50",
  "title": "Flat ₹50 off",
  "description": "On orders above ₹299",
  "type": "flat",
  "value": 50,
  "minOrderValue": 299,
  "maxDiscount": null,
  "startAt": "2026-01-01T00:00:00.000Z",
  "endAt": "2026-12-31T23:59:59.000Z",
  "usageLimit": 10000,
  "perUserLimit": 1,
  "restaurantIds": [],
  "cityIds": [],
  "isActive": true
}
```

`type`: `flat` · `percentage` · `free_delivery` · `bogo`. Empty `restaurantIds` / `cityIds` = platform-wide.

### Success `201`

Same `AdminCouponDto` as list item.

**Errors:** `409 COUPON_CODE_EXISTS` · `422 VALIDATION_ERROR`

## Admin update coupon

**API name:** Admin update coupon  
**Method / path:** `PUT /admin/coupons/:couponId`  
**Auth:** 🔑 admin / super_admin · CSRF

Partial body (at least one field). Pause: `{ "isActive": false }`.

**Errors:** `404 COUPON_NOT_FOUND` · `409 COUPON_CODE_EXISTS` · `422 VALIDATION_ERROR`

## Admin deactivate coupon

**API name:** Admin soft-deactivate coupon  
**Method / path:** `DELETE /admin/coupons/:couponId`  
**Auth:** 🔑 admin / super_admin · CSRF  

Sets `isActive: false` (keeps row). Returns updated DTO.  
**Errors:** `404 COUPON_NOT_FOUND`

## Internal get cart

**API name:** Internal get cart  
**Method / path:** `GET /internal/cart?userId=`  
**Auth:** 🔒 `x-internal-key` · Who: order-service  

`data` = cart or `null`.

## Internal clear cart

**API name:** Internal clear cart  
**Method / path:** `DELETE /internal/cart?userId=&orderId=`  
**Auth:** 🔒 · Who: order-service after successful place  

Optional `orderId` (query or body) records coupon redemption + increments `usageCount` before delete.

### Success `200`

```json
{ "cleared": true }
```

## Internal validate for order

**API name:** Internal validate cart for place  
**Method / path:** `POST /internal/cart/validate-for-order`  
**Auth:** 🔒  

### Request

```json
{
  "userId": "66aa...",
  "dropLat": 28.61,
  "dropLng": 77.20,
  "addresses": [
    {
      "dropLat": 28.61,
      "dropLng": 77.20,
      "restaurantLat": 28.59,
      "restaurantLng": 77.04
    }
  ]
}
```

Same delivery/restaurant WIREs as `POST /cart/validate` (hard `400 ZONE_*` / `DROP_PIN_REQUIRED` / menu). Optional `addresses[]` → delivery `/internal/serviceability/batch`; result returned as `addressBatch`.  
**Place gate:** throws `400 RESTAURANT_CLOSED` · `ITEM_UNAVAILABLE` · `CART_NOT_VALID` · `AGE_RESTRICTED_CART` · `403 FORBIDDEN` (group guest). **order-service `POST /orders` calls this before create.**

### Errors

| Status | Code |
|---|---|
| 400 | `DROP_PIN_REQUIRED` · `ZONE_*` · `RESTAURANT_CLOSED` · `ITEM_UNAVAILABLE` · `CART_NOT_VALID` · `AGE_RESTRICTED_CART` · `CART_EMPTY` |
| 403 | `FORBIDDEN` |
| 404 | `CART_NOT_FOUND` · `RESTAURANT_NOT_FOUND` |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` · `DELIVERY_SERVICE_UNAVAILABLE` · `SURGE_UNAVAILABLE` |

## Internal cart from order

**API name:** Internal cart from order  
**Method / path:** `POST /internal/cart/from-order`  
**Auth:** 🔒  

```json
{ "userId": "66aa...", "orderId": "66o1..." }
```

Same as `POST /cart/repeat/:orderId` (real `cartId`, `warnings[]`).

## User age gate

**API name:** Get age gate  
**Method / path:** `GET /users/me/age-gate` · also `GET /internal/users/:userId/age-gate`  
**Auth:** 🔑 customer · or 🔒 internal  

```json
{ "verified18": false, "dateOfBirth": null, "verifiedAt": null, "method": null }
```

**API name:** Verify age  
**Method / path:** `POST /users/me/age/verify`  
**Auth:** 🔑  

```json
{ "dateOfBirth": "1998-05-01" }
```

Under 18 IST → `403`. Success sets `verified18: true`, `method: "dob"`.

## Cart group socket

**API name:** Group cart live update  
**Event:** `cart:group-updated`  
**Auth:** Socket.IO `{GATEWAY}/socket.io/` · `auth: { userId }` → room `user:{userId}`  
**Who:** customer app members of an open group cart

Published by cart-service via Redis `CART_GROUP_UPDATED` after join / leave / add / lock / dissolve (and item add/update/remove in a group).

### Payload

```json
{
  "cartId": "66ca...",
  "groupId": "66cg...",
  "action": "join",
  "memberCount": 3,
  "locked": false
}
```

`action`: `join` · `leave` · `add` · `lock` · `dissolve`.

## Cart error envelope

**Shape (all cart HTTP errors):**

```json
{ "success": false, "message": "Outside delivery zone", "code": "OUT_OF_ZONE" }
```

Canonical codes: [CART_SERVICE_APIS.md §9](CART_SERVICE_APIS.md#9-error-codes--live). `POST /cart/validate`, bill, and internal validate-for-order throw `ZONE_*` · `DROP_PIN_REQUIRED` · `SURGE_UNAVAILABLE`. Menu soft-issues remain in validate `warnings[]`.

## Internal restaurants batch (home rails)

**API name:** Restaurants hydrate batch  
**Method / path:** `POST /internal/restaurants/batch`  
**Auth:** 🔒

### Request

```json
{ "ids": ["66r1...", "66r2..."] }
```

Max 100. Returns name/logo/rating/`isOnline`/`isAcceptingOrders` cards + `missingIds`.

## Internal zone force restaurants offline

**API name:** Force zone restaurants offline  
**Method / path:** `PUT /internal/zones/:zoneId/restaurants-offline`  
**Auth:** 🔒

Called by delivery-service on admin zone close (rain / incident). Sets `isOnline=false` for all `active` restaurants mapped to that `zoneId`.

### Request

```json
{ "reason": "zone_rain" }
```

### Success `200`

```json
{
  "success": true,
  "message": "Zone restaurants forced offline",
  "data": { "zoneId": "66z1...", "forced": 12, "reason": "zone_rain" }
}
```

---

# Addresses — address-service

Gateway: `/api/v1/address-service`. Mount `/addresses`. Customer contracts also in [CUSTOMER_APP_REQUEST_RESPONSE.md §4](CUSTOMER_APP_REQUEST_RESPONSE.md#4-addresses--address-service--live). Inventory: [ADDRESS_SERVICE_APIS.md](ADDRESS_SERVICE_APIS.md).

## Address service readiness

**API name:** Address service readiness  
**Method / path:** `GET /health/ready`  
**Auth:** 🔓  
**Who:** Load balancer / k8s / compose.

### Success `200`

```json
{
  "status": "ok",
  "service": "address-service",
  "uptime": 12.3,
  "checks": { "mongo": "up", "redis": "up" }
}
```

Unwrapped (not `{ success, data }`) for probe compatibility.

### Not ready `503`

```json
{
  "status": "not_ready",
  "service": "address-service",
  "uptime": 12.3,
  "checks": { "mongo": "up", "redis": "down" }
}
```

## Check drop pin serviceability

**API name:** Check drop pin serviceability  
**Method / path:** `GET /addresses/serviceability?lat=&lng=`  
**Auth:** 👤 optional (guest OK)  
**Who:** Customer location picker. Checkout still uses cart/order → delivery.

Proxies delivery `POST /internal/serviceability/check` with `{ dropLat, dropLng }`. Does **not** copy zone polygons onto address-service.

### Request

Query: `lat` (−90..90), `lng` (−180..180). Required.

### Success `200`

```json
{
  "success": true,
  "message": "Deliverable",
  "data": {
    "serviceable": true,
    "reason": { "code": "ok", "message": "Deliverable" },
    "dropZoneId": "66z1...",
    "dropZoneName": "Dwarka",
    "city": "Delhi",
    "restaurantZoneId": null,
    "surgeMultiplier": 1,
    "rain": false,
    "withinHours": true,
    "timezone": "Asia/Kolkata",
    "evaluatedAt": "2026-08-12T11:00:00.000Z"
  }
}
```

`serviceable: false` is still `200` (`message`: `"Not serviceable"`). `reason.code`: `ok` · `out_of_zone` · `zone_closed` · `zone_rain` · `restaurant_zone_closed` · `outside_hours`.

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Missing / invalid `lat` or `lng` |
| 503 | `DELIVERY_SERVICE_UNAVAILABLE` | Delivery down or non-OK — never invent `serviceable: true` |

## Set address label

**API name:** Set address label  
**Method / path:** `POST /addresses/:addressId/label`  
**Auth:** 🔑 customer  
**Who:** Customer saved-address Home / Work / Other chips.

### Request

```json
{ "tag": "home" }
```

`tag`: `home` · `work` · `other`. Same write as `tag` on `PUT /addresses/:addressId`.

### Success `200`

```json
{
  "success": true,
  "message": "Address label updated",
  "data": {
    "_id": "66ad...",
    "userId": "66aa...",
    "tag": "home",
    "city": "Delhi",
    "state": "Delhi",
    "pinCode": "110075",
    "location": { "type": "Point", "coordinates": [77.0460, 28.5921] },
    "isDefault": true,
    "isVerified": false,
    "createdAt": "2026-08-10T08:00:00.000Z",
    "updatedAt": "2026-08-12T11:00:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing `x-user-id` |
| 404 | `ADDRESS_NOT_FOUND` | Unknown or not owned |
| 422 | `VALIDATION_ERROR` | Missing / invalid `tag` |

## Admin search addresses

**API name:** Admin search customer addresses  
**Method / path:** `GET /admin/addresses`  
**Auth:** 🔑 `admin` / `super_admin`  
**Who:** Admin panel support / ops. Customer app never calls this.

### Request

Query (at least one of `userId`, `city`, `pin`/`pinCode`):

| Param | Notes |
|---|---|
| `userId` | 24-char ObjectId |
| `city` | Case-insensitive exact match |
| `pin` / `pinCode` | 6-digit Indian PIN |
| `page` | Default 1 |
| `limit` | Default 20, max 100 |

### Success `200`

```json
{
  "success": true,
  "message": "Addresses retrieved",
  "data": [
    {
      "_id": "66ad...",
      "userId": "66aa...",
      "tag": "home",
      "city": "Delhi",
      "state": "Delhi",
      "pinCode": "110075",
      "location": { "type": "Point", "coordinates": [77.0460, 28.5921] },
      "contactName": "Anshu",
      "contactPhone": "9876543210",
      "isDefault": true,
      "isVerified": false,
      "createdAt": "2026-08-10T08:00:00.000Z",
      "updatedAt": "2026-08-12T11:00:00.000Z"
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 20, "totalPages": 1, "hasNext": false }
}
```

No matches → `data: []` and `meta.total: 0`. Never a hardcoded list.

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing session |
| 403 | `FORBIDDEN` | Not admin / super_admin |
| 422 | `VALIDATION_ERROR` | No filter, bad ObjectId, or invalid PIN |

## Admin get address

**API name:** Admin get address by id  
**Method / path:** `GET /admin/addresses/:addressId`  
**Auth:** 🔑 `admin` / `super_admin`  
**Who:** Admin panel support ticket.

### Success `200`

Full address DTO (`message`: `"Address retrieved"`). Same shape as a row in the search list.

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing session |
| 403 | `FORBIDDEN` | Not admin / super_admin |
| 400 | `VALIDATION_ERROR` | Invalid `addressId` |
| 404 | `ADDRESS_NOT_FOUND` | Unknown id |

## Internal get address snapshot

**API name:** Internal get saved address  
**Method / path:** `GET /addresses/internal/:addressId?userId=`  
**Auth:** 🔒 `x-internal-key`  
**Who:** cart-service `PUT /cart/delivery-address`. Customer app never calls this. Order-service uses the cart snapshot, not this path.

### Request

Query `userId` (24-char ObjectId) required. Header `x-internal-key`.

### Success `200`

Full address DTO (`message`: `"Address retrieved"`), including `location.coordinates` `[lng, lat]`, `pinCode`, `contactPhone`.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `FORBIDDEN` | Missing / wrong internal key |
| 400 | `VALIDATION_ERROR` | Invalid `addressId` or `userId` |
| 422 | `VALIDATION_ERROR` | Missing `userId` |
| 404 | `ADDRESS_NOT_FOUND` | Unknown or not owned by `userId` |

## Internal Haversine delivery fee

**API name:** Internal Haversine delivery fee  
**Method / path:** `POST /addresses/internal/delivery-fee`  
**Auth:** 🔒 `x-internal-key`  
**Who:** Optional internal callers. **Not** checkout. Cart/order use delivery-service surge + ETA.

### Request

```json
{ "fromLat": 28.5921, "fromLng": 77.0460, "toLat": 28.61, "toLng": 77.20 }
```

### Success `200`

```json
{
  "success": true,
  "message": "Delivery fee calculated",
  "data": { "distanceKm": 4.2, "fee": 50, "source": "haversine" }
}
```

Formula: ₹30 + ₹5 per rounded km, cap ₹100. `source` is always `"haversine"` — never rain/zone/surge.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `FORBIDDEN` | Missing / wrong internal key |
| 422 | `VALIDATION_ERROR` | Missing / out-of-range lat/lng |

---

# Search — search-service

> **Production search + discovery: complete.**

Gateway: `/api/v1/search-service`. Mount `/`. 🔓 Public GETs; 🔑 `/recent`; admin `/admin/search/*`. Customer contracts also in [CUSTOMER_APP_REQUEST_RESPONSE.md §5](CUSTOMER_APP_REQUEST_RESPONSE.md#5-search--search-service--live). Inventory: [SEARCH_SERVICE_APIS.md](SEARCH_SERVICE_APIS.md).

Read-only on restaurant-service collections (`restaurants`, `menuitems` in `restaurants-db`). **Never writes** restaurant Mongo. Redis: recent searches, query log, trending cache. Kitchen / rider / internal `/internal/*`: none. Cuisine chips: restaurant-service `GET /cuisines`. Nearby browse: restaurant-service `GET /restaurants/nearby`. Sockets: **none**.

`radius` is **meters** (default 50000). Restaurant nearby uses **km** — do not mix. GeoJSON `location.coordinates` = `[lng, lat]`.

## Search health

**API name:** Search health  
**Method / path:** `GET /health`  
**Auth:** 🔓  
**Who:** Probe / compose.

### Success `200`

```json
{ "success": true, "service": "search-service" }
```

Unwrapped (no `{ data }`). Does **not** ping Mongo.

## Search readiness

**API name:** Search service readiness  
**Method / path:** `GET /health/ready`  
**Auth:** 🔓  
**Who:** Load balancer / k8s / compose.

### Success `200`

```json
{
  "status": "ok",
  "service": "search-service",
  "uptime": 12.3,
  "checks": { "mongo": "up", "redis": "up" }
}
```

### Not ready `503`

```json
{
  "status": "not_ready",
  "service": "search-service",
  "uptime": 12.3,
  "checks": { "mongo": "down", "redis": "down" }
}
```

## Search restaurants

**API name:** Search restaurants  
**Method / path:** `GET /restaurants`  
**Auth:** 🔓  
**Who:** Customer app search.

Need **`q` or `cuisine` or `lat`+`lng`**. Else `400` `"Provide q, cuisine, or lat+lng to search"`. Filter `status: active` only.

### Request

Query:

| Param | Notes |
|---|---|
| `q` | Full-text on name / description / tags |
| `cuisine` | Case-insensitive regex on `cuisines` |
| `lat` `lng` | `$nearSphere`; with `q`, two-step active id filter (no combined `$text`+`$near`) |
| `radius` | Meters, default `50000` |
| `veg` | `true` → `settings.isPureVeg` |
| `openNow` | `true` → IST hours + kitchen online (not paused). Response may include `filters: { openNow: "ist_and_duty" }` |
| `rating` | `avgRating >=` |
| `sort` | `relevance` (needs `q`) · `rating` · `cost` · else featured/promoted |
| `page` `limit` | Default 20, max 100 |

### Success `200`

```json
{
  "success": true,
  "data": {
    "restaurants": [{
      "_id": "66r1...",
      "name": "Pizza Hut",
      "cuisines": ["italian"],
      "coverImage": "https://…",
      "logo": "https://…",
      "avgRating": 4.2,
      "totalRatings": 1200,
      "isOnline": true,
      "isOpenNow": true,
      "nextOpenAt": null,
      "costForTwo": 600,
      "address": {},
      "location": { "type": "Point", "coordinates": [77.20, 28.61] }
    }],
    "total": 40,
    "page": 1,
    "limit": 20,
    "totalPages": 2
  }
}
```

Public projection only (no `ownerId` / GST). Empty `restaurants: []` when nothing matches.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing `q`, `cuisine`, and `lat`+`lng` |

## Search dishes

**API name:** Search dishes  
**Method / path:** `GET /dishes`  
**Auth:** 🔓  
**Who:** Customer app.

Need `q` **or** `restaurantId`. Else `400` `"Provide q or restaurantId to search dishes"`. `isAvailable: true`. Optional `lat`+`lng` restricts to nearby **active + online** restaurants first.

### Request

Query: `q`, `restaurantId`, `lat`, `lng`, `radius` (meters), `veg=true`, `page`, `limit`.

### Success `200`

```json
{
  "success": true,
  "data": {
    "dishes": [{
      "_id": "66mi...",
      "name": "Paneer Tikka",
      "price": 249,
      "discountedPrice": 199,
      "isVeg": true,
      "restaurantId": "66r1...",
      "isBestSeller": true
    }],
    "total": 12,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing `q` and `restaurantId`; invalid `restaurantId` |

## Combined search

**API name:** Combined search  
**Method / path:** `GET /combined`  
**Auth:** 🔓  
**Who:** Customer header dropdown.

`q` required. Else `400` `"q is required for combined search"`. Top N restaurants + dishes (default 5, max 10).

### Request

Query: `q` (required), optional `lat`, `lng`, `radius`, `limit`.

### Success `200`

```json
{
  "success": true,
  "data": {
    "query": "piz",
    "restaurants": [{
      "_id": "66r1...",
      "name": "Pizza Hut",
      "cuisines": ["italian"],
      "avgRating": 4.2,
      "isOnline": true
    }],
    "dishes": [{
      "_id": "66mi...",
      "name": "Farmhouse",
      "price": 399,
      "isVeg": true,
      "restaurantId": "66r1..."
    }]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing `q` |

## Search suggestions

**API name:** Search suggestions  
**Method / path:** `GET /suggestions`  
**Auth:** 🔓  
**Who:** Customer type-ahead.

`q` length &lt; 2 → `{ suggestions: [] }` (not an error). Prefix regex on names.

### Request

Query: `q`, optional `lat`, `lng`, `radius`.

### Success `200`

```json
{
  "success": true,
  "data": {
    "query": "pi",
    "suggestions": [
      { "type": "restaurant", "id": "66r1...", "name": "Pizza Hut", "category": "italian" },
      { "type": "dish", "id": "66mi...", "name": "Farmhouse Pizza", "restaurantId": "66r1..." }
    ]
  }
}
```

---

## Trending near pin

**API name:** Trending restaurants  
**Method / path:** `GET /trending?lat=&lng=&limit=&radius=`  
**Auth:** 👤 optional  
**Who:** Customer “trending near you”.

Need `lat`+`lng`. Else `400` `"lat and lng are required for trending"`. **Active listing only** (approved) — offline / outside hours still returned with `isOpenNow` + `nextOpenAt`. Sort `totalOrders` → `avgRating` → `totalRatings`. Redis cache (default TTL 300s). Use `openNow=true` on `/restaurants` to hide closed.

### Success `200`

```json
{
  "success": true,
  "data": {
    "restaurants": [{
      "_id": "66r1...",
      "name": "Pizza Hut",
      "cuisines": ["italian"],
      "avgRating": 4.2,
      "isOnline": true,
      "isOpenNow": true,
      "nextOpenAt": null
    }],
    "total": 12
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing `lat` or `lng` |

## Recent searches

**API name:** List recent searches  
**Method / path:** `GET /recent`  
**Auth:** 🔑  
**Who:** Customer search history.

### Success `200`

```json
{
  "success": true,
  "data": {
    "queries": [{ "q": "pizza", "at": "2026-08-10T11:00:00.000Z" }]
  }
}
```

Max 20 (Redis). Persist `q` when logged-in user hits `GET /restaurants` or `GET /combined`.

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Not logged in |

**API name:** Clear recent searches  
**Method / path:** `DELETE /recent`  
**Auth:** 🔑 + CSRF (gateway)  
**Who:** Customer.

### Success `200`

```json
{ "success": true, "data": { "cleared": true } }
```

## Filter catalog

**API name:** Search filter catalog  
**Method / path:** `GET /filters`  
**Auth:** 🔓  
**Who:** Customer search UI chips.

### Success `200`

```json
{
  "success": true,
  "data": {
    "sort": ["relevance", "rating", "delivery_time", "cost"],
    "rating": [3, 4, 4.5],
    "cost": ["budget", "moderate", "expensive"],
    "toggles": ["veg", "offers", "openNow"]
  }
}
```

## Admin search ops

**API name:** Search query stats  
**Method / path:** `GET /admin/search/queries?limit=20`  
**Auth:** 🔑 Admin  
**Who:** Admin panel.

### Success `200`

```json
{
  "success": true,
  "data": {
    "popular": [{ "q": "pizza", "count": 142 }],
    "zeroResults": [{ "q": "xyzabc", "at": "2026-08-10T11:00:00.000Z", "path": "/restaurants" }]
  }
}
```

**API name:** Search reindex  
**Method / path:** `POST /admin/search/reindex`  
**Auth:** 🔑 Admin + CSRF  
**Who:** Admin panel.

### Success `200`

```json
{
  "success": true,
  "data": {
    "reindexed": false,
    "reason": "live_mongo_read",
    "message": "Search reads restaurant-service Mongo directly; no separate index to rebuild."
  }
}
```

**SKIP:** `GET /cuisines` → restaurant-service.

---

# Restaurant health — restaurant-service

Gateway: `/api/v1/restaurant-service`.

## Liveness

**API name:** Restaurant service liveness  
**Method / path:** `GET /health`  
**Auth:** 🔓  

```json
{ "status": "ok", "service": "restaurant-service", "uptime": 12.3 }
```

## Readiness

**API name:** Restaurant service readiness  
**Method / path:** `GET /health/ready`  
**Auth:** 🔓  

Pings Mongo (`readyState === 1`) + Redis `PING`. Either down → **503** `status: not_ready`.

### Success `200`

```json
{
  "status": "ok",
  "service": "restaurant-service",
  "uptime": 12.3,
  "checks": { "mongo": "up", "redis": "up" }
}
```

### Not ready `503`

```json
{
  "status": "not_ready",
  "service": "restaurant-service",
  "uptime": 12.3,
  "checks": { "mongo": "up", "redis": "down" }
}
```

---

# Admin restaurant listing / KYC — restaurant-service

Gateway: `/api/v1/restaurant-service`. **Who:** admin panel · 🔑 `_sid` + role `admin` | `super_admin` · CSRF on PUT. **Not** legacy `admin-service`. Listing approve makes the outlet visible on customer nearby (`status: active`). Document verify never fakes success — requires `KYC_PROVIDER_URL` + `KYC_PROVIDER_API_KEY` or returns `503 KYC_UNAVAILABLE`.

## Admin list restaurants

**API name:** Admin restaurant queue  
**Method / path:** `GET /admin/restaurants`  
**Auth:** 🔑 🔐 admin / super_admin

### Request

| | |
|---|---|
| Query | `status` optional `pending\|active\|rejected\|suspended\|closed` |
| Query | `city` optional (exact city, case-insensitive) |
| Query | `search` optional (Mongo text on name/description/tags) |
| Query | `page` default 1 · `limit` default page size |

### Success `200`

```json
{
  "success": true,
  "message": "Restaurants",
  "data": [
    {
      "_id": "66r1...",
      "name": "Pizza Hut Dwarka",
      "status": "pending",
      "fssaiLicense": "12345678901234",
      "city": "Delhi",
      "ownerId": "66u1...",
      "isOnline": false,
      "kycStatus": "submitted",
      "createdAt": "2026-08-09T10:00:00.000Z"
    }
  ],
  "meta": { "total": 12, "page": 1, "limit": 20, "totalPages": 1, "hasNext": false }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | — | Missing session |
| 403 | — | Not admin |
| 422 | `VALIDATION_ERROR` | Bad `status` |

## Admin restaurant 360°

**API name:** Admin restaurant detail  
**Method / path:** `GET /admin/restaurants/:restaurantId`  
**Auth:** 🔑 🔐 admin / super_admin

### Success `200`

```json
{
  "success": true,
  "message": "Restaurant detail",
  "data": {
    "profile": {
      "_id": "66r1...",
      "name": "Pizza Hut Dwarka",
      "slug": "pizza-hut-dwarka-1234",
      "status": "pending",
      "isOnline": false,
      "fssaiLicense": "12345678901234",
      "gstin": null,
      "panNumber": null,
      "address": { "street": "...", "city": "Delhi", "state": "DL", "pincode": "110075", "country": "IN" },
      "location": { "type": "Point", "coordinates": [77.04, 28.59] },
      "zoneId": null,
      "avgRating": 0,
      "hygieneScore": 0,
      "createdAt": "2026-08-09T10:00:00.000Z",
      "updatedAt": "2026-08-09T10:00:00.000Z"
    },
    "documents": [
      {
        "id": "66d1...",
        "type": "fssai",
        "url": "https://cdn.../fssai.pdf",
        "status": "uploaded",
        "rejectReason": null,
        "uploadedBy": "66u1...",
        "verifiedAt": null,
        "verifiedBy": null,
        "createdAt": "2026-08-09T11:00:00.000Z"
      }
    ],
    "fssai": {
      "license": "12345678901234",
      "formatOk": true,
      "document": { "id": "66d1...", "type": "fssai", "status": "uploaded", "url": "https://cdn..." }
    },
    "ordersSnapshot": {
      "totalOrders": 0,
      "totalRevenue": 0,
      "ordersToday": null,
      "revenueToday": null,
      "currentOrderCount": 0,
      "source": "degraded"
    },
    "complaints": [],
    "adminMeta": {
      "verifiedAt": null,
      "verifiedBy": null,
      "listingRejectReason": null,
      "rejectedAt": null,
      "rejectedBy": null,
      "suspendReason": null,
      "suspendUntil": null,
      "suspendedAt": null,
      "suspendedBy": null,
      "forceOfflineReason": null,
      "forceOfflineAt": null,
      "forceOfflineBy": null,
      "kycStatus": "submitted"
    }
  }
}
```

`ordersSnapshot.source`: `order-service` when analytics overview succeeds; else `restaurant` / `degraded` (never fails the 360). `complaints` = outlet support tickets (honest empty if none).

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_ID` | Bad ObjectId |
| 404 | `RESTAURANT_NOT_FOUND` | Missing / deleted |

## Admin list KYC documents

**API name:** Admin KYC documents  
**Method / path:** `GET /admin/restaurants/:restaurantId/documents`  
**Auth:** 🔑 🔐 admin / super_admin

### Success `200`

```json
{
  "success": true,
  "message": "KYC documents",
  "data": [
    {
      "id": "66d1...",
      "type": "fssai",
      "url": "https://cdn.../fssai.pdf",
      "status": "uploaded",
      "rejectReason": null,
      "uploadedBy": "66u1...",
      "verifiedAt": null,
      "verifiedBy": null,
      "createdAt": "2026-08-09T11:00:00.000Z"
    }
  ]
}
```

## Admin approve restaurant

**API name:** Approve listing  
**Method / path:** `PUT /admin/restaurants/:restaurantId/approve`  
**Auth:** 🔑 🔐 admin / super_admin · CSRF

### Request body

```json
{ "note": "FSSAI number + certificate reviewed" }
```

`note` optional, max 300.

### Success `200`

```json
{
  "success": true,
  "message": "Restaurant live",
  "data": {
    "restaurantId": "66r1...",
    "status": "active",
    "verifiedAt": "2026-08-10T12:00:00.000Z",
    "verifiedBy": "66admin..."
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `RESTAURANT_NOT_FOUND` | Bad id |
| 409 | `ILLEGAL_TRANSITION` | Not `pending` (e.g. already `active`) |
| 409 | `KYC_INCOMPLETE` | Missing FSSAI number or non-rejected FSSAI cert |

## Admin reject restaurant

**API name:** Reject listing  
**Method / path:** `PUT /admin/restaurants/:restaurantId/reject`  
**Auth:** 🔑 🔐 admin / super_admin · CSRF

### Request body

```json
{ "reason": "Invalid FSSAI number" }
```

`reason` min 5 max 500 required. Only from `pending`.

### Success `200`

```json
{
  "success": true,
  "message": "Restaurant rejected",
  "data": {
    "restaurantId": "66r1...",
    "status": "rejected",
    "rejectedAt": "2026-08-10T12:05:00.000Z",
    "reason": "Invalid FSSAI number"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ILLEGAL_TRANSITION` | Not `pending` (active must suspend first) |
| 422 | `REASON_REQUIRED` / `VALIDATION_ERROR` | Short/missing reason |

## Admin suspend restaurant

**API name:** Suspend restaurant  
**Method / path:** `PUT /admin/restaurants/:restaurantId/suspend`  
**Auth:** 🔑 🔐 admin / super_admin · CSRF

### Request body

```json
{ "reason": "Hygiene complaint", "durationHours": 48 }
```

`durationHours` optional 1–2160. From `active` (or re-suspend while `suspended`). Forces `isOnline=false`. Timed suspends auto-expire back to `active`.

### Success `200`

```json
{
  "success": true,
  "message": "Restaurant suspended",
  "data": {
    "restaurantId": "66r1...",
    "status": "suspended",
    "reason": "Hygiene complaint",
    "suspendUntil": "2026-08-12T12:00:00.000Z",
    "suspendedAt": "2026-08-10T12:00:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ILLEGAL_TRANSITION` | `pending` / `rejected` / `closed` |
| 422 | `REASON_REQUIRED` / `INVALID_DURATION` | Bad body |

## Admin unsuspend restaurant

**API name:** Unsuspend restaurant  
**Method / path:** `PUT /admin/restaurants/:restaurantId/unsuspend`  
**Auth:** 🔑 🔐 admin / super_admin · CSRF

### Success `200`

```json
{
  "success": true,
  "message": "Restaurant unsuspended",
  "data": { "restaurantId": "66r1...", "status": "active" }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ILLEGAL_TRANSITION` | From `rejected` (must re-approve) or non-`suspended` |

## Admin force offline

**API name:** Force restaurant offline  
**Method / path:** `PUT /admin/restaurants/:restaurantId/force-offline`  
**Auth:** 🔑 🔐 admin / super_admin · CSRF

### Request body

```json
{ "reason": "Hygiene incident — ops closed until audit" }
```

Listing `status` unchanged; `isOnline` forced false (hidden from “open now” filters).

### Success `200`

```json
{
  "success": true,
  "message": "Restaurant forced offline",
  "data": {
    "restaurantId": "66r1...",
    "status": "active",
    "isOnline": false,
    "reason": "Hygiene incident — ops closed until audit",
    "forcedAt": "2026-08-10T13:00:00.000Z"
  }
}
```

## Admin verify KYC document

**API name:** Verify KYC document  
**Method / path:** `PUT /admin/restaurants/:restaurantId/documents/:docId/verify`  
**Auth:** 🔑 🔐 admin / super_admin · CSRF

Calls external KYC registry when `KYC_PROVIDER_URL` + `KYC_PROVIDER_API_KEY` are set. Format-checks FSSAI (14 digits) / GSTIN / PAN against restaurant profile numbers. Never marks `verified` without a real provider OK.

### Success `200`

```json
{
  "success": true,
  "message": "Document verified",
  "data": {
    "id": "66d1...",
    "type": "fssai",
    "url": "https://cdn.../fssai.pdf",
    "status": "verified",
    "rejectReason": null,
    "uploadedBy": "66u1...",
    "verifiedAt": "2026-08-10T14:00:00.000Z",
    "verifiedBy": "66admin...",
    "createdAt": "2026-08-09T11:00:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DOCUMENT_NOT_FOUND` | Bad doc |
| 409 | `DOCUMENT_REJECTED` | Already rejected — re-upload |
| 422 | `INVALID_FSSAI` / `INVALID_GSTIN` / `INVALID_PAN` / `UNSUPPORTED_KYC_TYPE` | Format / type |
| 503 | `KYC_UNAVAILABLE` | Provider unset or down |

## Admin reject KYC document

**API name:** Reject KYC document  
**Method / path:** `PUT /admin/restaurants/:restaurantId/documents/:docId/reject`  
**Auth:** 🔑 🔐 admin / super_admin · CSRF

### Request body

```json
{ "reason": "Blurry FSSAI scan — re-upload" }
```

### Success `200`

```json
{
  "success": true,
  "message": "Document rejected",
  "data": {
    "id": "66d1...",
    "type": "fssai",
    "status": "rejected",
    "rejectReason": "Blurry FSSAI scan — re-upload",
    "verifiedAt": "2026-08-10T14:05:00.000Z",
    "verifiedBy": "66admin..."
  }
}
```

## Admin set hygiene

**API name:** Set hygiene score  
**Method / path:** `PUT /admin/restaurants/:restaurantId/hygiene`  
**Auth:** 🔑 🔐 admin · CSRF

### Request

```json
{ "hygieneScore": 4.5, "note": "Passed surprise audit" }
```

`hygieneScore` 0–5 required. `note` optional max 500.

### Success `200`

```json
{
  "success": true,
  "message": "Hygiene updated",
  "data": {
    "restaurantId": "66r1...",
    "hygieneScore": 4.5,
    "lastHygieneAuditAt": "2026-08-10T15:00:00.000Z",
    "note": "Passed surprise audit"
  }
}
```

## Admin set featured

**API name:** Feature restaurant on home  
**Method / path:** `PUT /admin/restaurants/:restaurantId/featured`  
**Auth:** 🔑 🔐 admin · CSRF

### Request

```json
{ "isFeatured": true, "featuredRank": 10 }
```

Only `active` can be featured (`409 ILLEGAL_TRANSITION` otherwise).

### Success `200`

```json
{
  "success": true,
  "message": "Featured updated",
  "data": { "restaurantId": "66r1...", "isFeatured": true, "featuredRank": 10 }
}
```

## Admin promote

**API name:** Paid promote boost  
**Method / path:** `PUT /admin/restaurants/:restaurantId/promote`  
**Auth:** 🔑 🔐 admin · CSRF

### Request

```json
{ "isPromoted": true, "until": "2026-08-17T00:00:00.000Z" }
```

`until` optional future ISO. Expired boosts auto-clear; public DTO treats expired as `isPromoted: false`.

## Admin set commission

**API name:** Override commission  
**Method / path:** `PUT /admin/restaurants/:restaurantId/commission`  
**Auth:** 🔑 🔐 admin · CSRF

### Request

```json
{ "percent": 18, "effectiveFrom": "2026-08-11T00:00:00.000Z" }
```

`percent` 0–40. Stored as `settings.commissionRate` (0–1). Owner `GET .../commission` reads this override.

### Success `200`

```json
{
  "success": true,
  "message": "Commission updated",
  "data": {
    "restaurantId": "66r1...",
    "commissionRate": 0.18,
    "commissionPercent": 18,
    "effectiveFrom": "2026-08-11T00:00:00.000Z",
    "source": "restaurant_override"
  }
}
```

## Admin set zone

**API name:** Map restaurant to delivery zone  
**Method / path:** `PUT /admin/restaurants/:restaurantId/zone`  
**Auth:** 🔑 🔐 admin · CSRF

### Request

```json
{ "zoneId": "66z1..." }
```

or `{ "zoneId": null }` to clear. Validates zone via delivery-service `GET /zones/:zoneId` — `404 ZONE_NOT_FOUND` / `503 DELIVERY_SERVICE_UNAVAILABLE`.

## Admin soft-delete restaurant

**API name:** Soft-delete restaurant  
**Method / path:** `DELETE /admin/restaurants/:restaurantId`  
**Auth:** 🔑 🔐 admin · CSRF

Optional body `{ "reason": "Duplicate listing" }`. Sets `isDeleted`, `status=closed`, `isOnline=false`. Hidden from customer nearby.

### Success `200`

```json
{
  "success": true,
  "message": "Restaurant soft-deleted",
  "data": {
    "restaurantId": "66r1...",
    "isDeleted": true,
    "status": "closed",
    "deletedAt": "2026-08-10T16:00:00.000Z"
  }
}
```

## Admin audit logs

**API name:** Restaurant audit trail  
**Method / path:** `GET /admin/restaurants/:restaurantId/audit-logs?page=1&limit=20`  
**Auth:** 🔑 🔐 admin

### Success `200`

```json
{
  "success": true,
  "message": "Audit logs",
  "data": [
    {
      "id": "66a1...",
      "action": "commission",
      "actorId": "66admin...",
      "actorRole": "admin",
      "before": { "commissionRate": 0.2 },
      "after": { "commissionRate": 0.18, "percent": 18 },
      "note": null,
      "createdAt": "2026-08-10T15:30:00.000Z"
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 20, "totalPages": 1, "hasNext": false }
}
```

## Admin ops notes

**API name:** Add / list ops notes  
**Method / path:** `POST /admin/restaurants/:restaurantId/notes` · `GET /admin/restaurants/:restaurantId/notes`  
**Auth:** 🔑 🔐 admin · CSRF on POST

### POST body

```json
{ "text": "Called owner — FSSAI re-upload promised by Friday" }
```

### Success `201` (POST)

```json
{
  "success": true,
  "message": "Note added",
  "data": {
    "id": "66n1...",
    "restaurantId": "66r1...",
    "text": "Called owner — FSSAI re-upload promised by Friday",
    "authorId": "66admin...",
    "authorRole": "admin",
    "createdAt": "2026-08-10T16:10:00.000Z"
  }
}
```

## Admin cuisine catalog

**API name:** Cuisine catalog CRUD  
**Auth:** 🔑 🔐 admin · CSRF on mutating

| Method | Path | Body |
|---|---|---|
| `GET` | `/admin/cuisines?includeInactive=` | — |
| `POST` | `/admin/cuisines` | `{ slug, name, imageUrl?, sortOrder? }` |
| `PUT` | `/admin/cuisines/:slug` | `{ name?, imageUrl?, sortOrder?, isActive? }` |
| `DELETE` | `/admin/cuisines/:slug` | Deactivate (soft) |

Public `GET /cuisines` prefers active catalog rows + live restaurant counts; falls back to aggregation when catalog empty.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `CUISINE_EXISTS` | Duplicate slug |
| 404 | `CUISINE_NOT_FOUND` | Bad slug |

---

# Restaurant onboarding / KYC — restaurant-service (owner)

Gateway: `/api/v1/restaurant-service`. **Who:** restaurant / kitchen app · 🔑 `_sid` + role `restaurant_owner` (or admin) · CSRF on POST/PUT. Owner cannot self-activate.

**Three tracks (do not mix):**

1. **Listing** `listingStatus` / restaurant `status`: `pending` until **admin** `PUT /admin/restaurants/:id/approve` → `active`. That is the only “listing live”. Owner go-online is `409 PARTNER_NOT_ACTIVE` until then. Owner `PUT /status` with `active` is `403 LISTING_STATUS_ADMIN_ONLY`.
2. **KYC** `kycStatus`: owner submit → `submitted`; listing stays `pending`. Document files stay `uploaded` until admin document verify.
3. **Bank** `verificationStatus`: PUT always `unverified`; `payoutsEnabled` only after ops verify. Saving bank is not listing live.

Documents stay `uploaded` until **admin §5** verify/approve. Never fake `verified` or `payoutsEnabled`.

## Onboarding status

**API name:** Onboarding checklist  
**Method / path:** `GET /restaurants/:restaurantId/onboarding`  
**Auth:** 🔑 🏪 owner / admin

### Success `200`

```json
{
  "success": true,
  "message": "Onboarding status",
  "data": {
    "restaurantId": "66r1...",
    "listingStatus": "pending",
    "kycStatus": "draft",
    "submittedAt": null,
    "rejectReason": null,
    "steps": [
      { "key": "profile", "label": "Outlet profile", "required": true, "done": true, "detail": "Pizza Hut Dwarka" },
      { "key": "address", "label": "Address & pin", "required": true, "done": true, "detail": "Delhi" },
      { "key": "fssai", "label": "FSSAI", "required": true, "done": false, "detail": null },
      { "key": "gst", "label": "GSTIN", "required": false, "done": false, "detail": null },
      { "key": "pan", "label": "PAN", "required": false, "done": false, "detail": null },
      { "key": "bank", "label": "Settlement bank", "required": false, "done": false, "detail": null },
      { "key": "photos", "label": "Outlet photos", "required": false, "done": false },
      { "key": "menu", "label": "Menu", "required": false, "done": false, "detail": null }
    ],
    "percent": 25,
    "canSubmit": false,
    "blockers": ["FSSAI license number and certificate are required"]
  }
}
```

`canSubmit` requires FSSAI **number (14 digits) + certificate file** and listing not already `active` / submitted. `kycStatus`: `draft` · `submitted` · `under_review` · `rejected`.

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No `_sid` |
| 403 | `FORBIDDEN` | Not owner / admin |
| 404 | `RESTAURANT_NOT_FOUND` | Bad id |

---

## Upload KYC documents

**API name:** Upload KYC documents  
**Method / path:** `POST /restaurants/:restaurantId/onboarding/documents`  
**Auth:** 🔑 🏪 owner · `multipart/form-data`  
**Who:** Restaurant app onboarding.

### Request

Fields (any subset): files `fssai`, `gst`, `pan`, `cancelledCheque` (1 each, JPEG/PNG/WebP/PDF, max 8 MB) · `outletPhotos` (up to 8 total) · text `fssaiLicense` (14 digits) · `gstin` · `panNumber`. At least one file or number required.

Singleton types **replace** the previous file and reset status to `uploaded` (never `verified`). After `kycStatus=submitted` while listing `pending` → `409 KYC_LOCKED`.

### Success `201`

```json
{
  "success": true,
  "message": "KYC documents uploaded",
  "data": {
    "restaurantId": "66r1...",
    "kycStatus": "draft",
    "fssaiMasked": "**********5678",
    "gstinMasked": "07*****1Z5",
    "panMasked": "ABCDE****F",
    "documents": [{
      "_id": "66kd1...",
      "type": "fssai",
      "status": "uploaded",
      "url": "https://res.cloudinary.com/…/fssai.pdf",
      "numberMasked": "**********5678",
      "rejectReason": null,
      "uploadedAt": "2026-08-10T12:00:00.000Z",
      "verifiedAt": null
    }]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `KYC_LOCKED` | Already submitted — wait for admin |
| 409 | `OUTLET_PHOTOS_LIMIT` | More than 8 outlet photos |
| 422 | `VALIDATION_ERROR` / `INVALID_FSSAI` / `INVALID_GSTIN` / `INVALID_PAN` | No payload or bad number |
| 400 | `INVALID_FILE_TYPE` | Not image/PDF |

---

## List KYC documents

**API name:** List KYC documents  
**Method / path:** `GET /restaurants/:restaurantId/onboarding/documents`  
**Auth:** 🔑 🏪 owner / admin

Same `data` shape as upload success. Numbers always **masked**. `verified` only after admin §5 — never invented here.

---

## Submit KYC for review

**API name:** Submit onboarding  
**Method / path:** `POST /restaurants/:restaurantId/onboarding/submit`  
**Auth:** 🔑 🏪 owner · empty body · CSRF

Idempotent if already `submitted` + `pending`. Does **not** set `status: active` or `verifiedAt`.

### Success `200`

```json
{
  "success": true,
  "message": "KYC submitted for review",
  "data": {
    "restaurantId": "66r1...",
    "listingStatus": "pending",
    "kycStatus": "submitted",
    "submittedAt": "2026-08-10T12:05:00.000Z",
    "canSubmit": false
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `KYC_INCOMPLETE` | Missing FSSAI number or FSSAI certificate (or cert `rejected`) |
| 409 | `ILLEGAL_TRANSITION` | Listing already `active` / `suspended` / `closed` |

---

## Lookup IFSC

**API name:** Lookup IFSC  
**Method / path:** `GET /restaurants/:restaurantId/bank/ifsc/:ifsc`  
**Auth:** 🔑 🏪 owner  
**Who:** Restaurant app bank form typeahead.

`:ifsc` is 11-char Indian IFSC. Cached 24h. Uses public `https://ifsc.razorpay.com/:IFSC` (no key). Never invents a bank name.

### Success `200`

```json
{
  "success": true,
  "message": "IFSC lookup",
  "data": { "ifsc": "HDFC0001234", "bank": "HDFC Bank", "branch": "Dwarka", "city": "Delhi" }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `INVALID_IFSC` | Bad format or unknown IFSC |
| 503 | `IFSC_LOOKUP_UNAVAILABLE` | Directory down |

---

## Get / save settlement bank

**API name:** Get restaurant bank  
**Method / path:** `GET /restaurants/:restaurantId/bank`  
**Auth:** 🔑 🏪 owner

**API name:** Save restaurant bank  
**Method / path:** `PUT /restaurants/:restaurantId/bank`  
**Auth:** 🔑 🏪 owner · CSRF

### Request (PUT)

```json
{ "accountNo": "123456789012", "ifsc": "HDFC0001234", "holderName": "Pizza Hut Dwarka" }
```

IFSC is validated live. `verificationStatus` is always reset to **`unverified`**. `payoutsEnabled` is `true` only after a real penny-drop/admin verify (not this slice).

### Success `200`

```json
{
  "success": true,
  "message": "Bank details saved",
  "data": {
    "accountMasked": "****9012",
    "ifsc": "HDFC0001234",
    "holderName": "Pizza Hut Dwarka",
    "bankName": "HDFC Bank",
    "branch": "Dwarka",
    "city": "Delhi",
    "verificationStatus": "unverified",
    "verifiedAt": null,
    "payoutsEnabled": false
  }
}
```

GET with no bank on file returns the same shape with nulls + `unverified` (app can render the form).

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `INVALID_ACCOUNT` / `INVALID_HOLDER_NAME` / `INVALID_IFSC` | Bad account / name / IFSC |
| 503 | `IFSC_LOOKUP_UNAVAILABLE` | Cannot validate IFSC |

---

# Kitchen duty — restaurant-service (owner / kitchen)

Gateway: `/api/v1/restaurant-service`. **Who:** restaurant / kitchen app · 🔑 `_sid` · owner, manager, kitchen_staff, or admin · CSRF on PUT. Listing `status` (admin KYC) is separate from kitchen `isOnline`. Pause keeps `isOnline: true` but customers see the store as not accepting. Expired pause is cleared lazily. Online/offline clears pause (early resume). Active orders continue while offline/paused.

Shared **RestaurantDutyDto** (`data`):

```json
{
  "restaurantId": "66r1...",
  "status": "active",
  "isOnline": true,
  "duty": "online",
  "pausedUntil": null,
  "pauseReason": null,
  "acceptScheduled": false,
  "autoAccept": false,
  "openNow": true
}
```

`duty`: `offline` · `online` · `paused`. `openNow` is IST timings only (not pause). `acceptScheduled` / `autoAccept` come from settings.

## Go online

**API name:** Kitchen go online  
**Method / path:** `PUT /restaurants/:restaurantId/online`  
**Auth:** 🔑 🏪 owner / manager / kitchen_staff / admin · empty body · CSRF  
**Who:** Kitchen app duty toggle.

Idempotent if already online. Also available as `PUT /restaurants/:restaurantId/status` `{ "status": "online" }`. Owner sending listing `active` on that path is `403 LISTING_STATUS_ADMIN_ONLY`.

### Success `200`

```json
{
  "success": true,
  "message": "Kitchen is online",
  "data": {
    "restaurantId": "66r1...",
    "status": "active",
    "isOnline": true,
    "duty": "online",
    "pausedUntil": null,
    "pauseReason": null,
    "acceptScheduled": false,
    "autoAccept": false,
    "openNow": true
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No `_sid` |
| 403 | `FORBIDDEN` | Not owner / manager / kitchen_staff / admin |
| 404 | `RESTAURANT_NOT_FOUND` | Bad id |
| 409 | `PARTNER_NOT_ACTIVE` | Listing not `active` (admin must approve first) |

---

## Go offline

**API name:** Kitchen go offline  
**Method / path:** `PUT /restaurants/:restaurantId/offline`  
**Auth:** 🔑 🏪 owner / manager / kitchen_staff / admin · empty body · CSRF  
**Who:** Kitchen app. Closes for **new** orders; in-flight orders continue.

Idempotent if already offline. Also `PUT /restaurants/:restaurantId/status` `{ "status": "offline" }`.

### Success `200`

```json
{
  "success": true,
  "message": "Kitchen is offline",
  "data": {
    "restaurantId": "66r1...",
    "status": "active",
    "isOnline": false,
    "duty": "offline",
    "pausedUntil": null,
    "pauseReason": null,
    "acceptScheduled": false,
    "autoAccept": false,
    "openNow": true
  }
}
```

Same errors as go online (`PARTNER_NOT_ACTIVE` if listing not live).

---

## Pause kitchen

**API name:** Pause kitchen (too busy)  
**Method / path:** `PUT /restaurants/:restaurantId/pause`  
**Auth:** 🔑 🏪 owner / manager / kitchen_staff / admin · CSRF  
**Who:** Kitchen app temp busy. Auto-unpause after `minutes`. Customer nearby/detail `isOnline` / `isOpenNow` are false while pause is active.

### Request

```json
{ "minutes": 30, "reason": "too_busy" }
```

`minutes` 1–120. `reason`: `too_busy` · `staffing` · `packaging` · `closing_soon` · `other`.

### Success `200`

```json
{
  "success": true,
  "message": "Kitchen paused",
  "data": {
    "restaurantId": "66r1...",
    "status": "active",
    "isOnline": true,
    "duty": "paused",
    "pausedUntil": "2026-08-10T13:30:00.000Z",
    "pauseReason": "too_busy",
    "acceptScheduled": false,
    "autoAccept": false,
    "openNow": true
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `PARTNER_NOT_ACTIVE` | Listing not `active` |
| 409 | `ALREADY_OFFLINE` | Kitchen is offline — go online before pausing |
| 422 | `VALIDATION_ERROR` | Bad minutes / reason |

---

## Get duty

**API name:** Kitchen duty status  
**Method / path:** `GET /restaurants/:restaurantId/duty`  
**Auth:** 🔑 🏪 owner / manager / kitchen_staff / admin  
**Who:** Kitchen app header / poll.

`data.status` is **listing** lifecycle (`pending` until ops approve → `active`). It is not kitchen duty. `duty` is `online` / `offline` / `paused`. Do not show “listing live” unless `status === "active"`.

### Success `200`

```json
{
  "success": true,
  "message": "Kitchen duty",
  "data": {
    "restaurantId": "66r1...",
    "status": "active",
    "isOnline": true,
    "duty": "online",
    "pausedUntil": null,
    "pauseReason": null,
    "acceptScheduled": false,
    "autoAccept": false,
    "openNow": false
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No `_sid` |
| 403 | `FORBIDDEN` | Not this outlet’s kitchen staff |
| 404 | `RESTAURANT_NOT_FOUND` | Bad id |

---

# Customer orders — order-service

Gateway: `/api/v1/order-service`. Auth: 🔑 customer session (`x-user-id`). Ownership enforced on every `:orderId` route.

## Place order (idempotency)

**API name:** Place order  
**Method / path:** `POST /orders`  
**Auth:** 🔑 customer  

### Request

Headers: **`Idempotency-Key`** (required, 8–64 chars). Body: standard place payload (cart-validated restaurant/items/address/payment).

### Success `201`

Returns `OrderView` for the created order. Replay with the same key + body returns the **same** order (not a duplicate).

Checkout math is taken from cart validate (coupon → loyalty → wallet, Super free delivery when membership is active and subtotal ≥ `freeDeliveryMinOrder`). Snapshots persist as `walletUsed`, `loyaltyPointsUsed`, `loyaltyRedemption`, `deliveryFee`.

- **COD / full-wallet / zero due:** wallet debit + loyalty burn run immediately via user `POST /internal/wallet/debit` and customer `POST /internal/loyalty/redeem` (idempotent `order_place:{orderId}` / `order_payment:{orderId}`). Settle failure **cancels** the order and returns `503` / downstream code — never fake placed.
- **UPI/card / split:** order stays `pending_payment`; debit/burn run on `POST /payments/verify` or Razorpay `payment.captured` webhook.

`paymentMethod: "wallet"` with `grandTotal > 0` → `400 WALLET_INSUFFICIENT` (use split).

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Missing or invalid `Idempotency-Key` |
| 409 | `IDEMPOTENCY_CONFLICT` | Same key, different body |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | Concurrent duplicate in flight — retry |

## Cancellation quote

**API name:** Cancellation refund quote  
**Method / path:** `GET /orders/:orderId/cancellation-quote`  
**Auth:** 🔑 customer  
**Who:** Customer app cancel confirmation sheet.

### Request

Headers: session cookie / gateway auth. Path: `orderId`.

### Success `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "eligible": true,
    "refundAmount": 1026,
    "refundMethod": "original_payment",
    "fee": 0,
    "reason": "before_accept",
    "windowEndsAt": "2026-08-10T12:05:00.000Z"
  }
}
```

`reason`: `before_accept` · `after_accept_fee` · `not_eligible`.  
When `eligible: false`: `refundAmount: 0`, `refundMethod: null`.  
Eligible only while status is `placed` | `accepted` | `pending_payment`.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `FORBIDDEN` | Not your order |
| 404 | — | Order not found |

## Order timeline

**API name:** Customer order timeline  
**Method / path:** `GET /orders/:orderId/timeline`  
**Auth:** 🔑 customer  

### Success `200`

```json
{
  "success": true,
  "data": {
    "orderId": "66c2...",
    "status": "out_for_delivery",
    "steps": [
      { "key": "placed", "label": "Order placed", "at": "2026-08-10T12:00:00.000Z", "state": "done" },
      { "key": "accepted", "label": "Restaurant accepted", "at": "2026-08-10T12:03:00.000Z", "state": "done" },
      { "key": "preparing", "label": "Preparing", "at": "2026-08-10T12:04:00.000Z", "state": "done" },
      { "key": "ready", "label": "Ready", "at": null, "state": "current" },
      { "key": "out_for_delivery", "label": "On the way", "at": null, "state": "pending" },
      { "key": "delivered", "label": "Delivered", "at": null, "state": "pending" }
    ]
  }
}
```

`state`: `done` · `current` · `pending` · `skipped` (cancelled/rejected). Pickup orders omit `out_for_delivery`.

## Partial item cancel

**API name:** Customer partial line cancel  
**Method / path:** `PUT /orders/:orderId/items/cancel`  
**Auth:** 🔑 customer  

### Request

```json
{ "itemIds": ["66oi..."], "reason": "Don't want garlic bread" }
```

Only while status is `placed` | `accepted` | `preparing`. Removing all items → `400 CANCEL_INSTEAD`.

### Success `200`

```json
{
  "success": true,
  "message": "Items removed and refund started",
  "data": {
    "order": { /* OrderView */ },
    "refundAmount": 149,
    "refundIssued": true,
    "refundId": "rfnd_...",
    "refundError": null,
    "removedItems": [{ "itemId": "66oi...", "name": "Garlic bread", "quantity": 1, "itemTotal": 149 }],
    "previousTotal": 1026,
    "newTotal": 877,
    "codAmountSynced": false
  }
}
```

Prepaid: calls payment-service `POST /payments/internal/refunds`. COD delivery: syncs lower collect amount to delivery-service.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `CANCEL_INSTEAD` | Would remove every line |
| 404 | `ORDER_ITEM_NOT_FOUND` | Bad `itemId` |
| 409 | `ILLEGAL_TRANSITION` | After pickup (`ready` / `out_for_delivery` / …) |

## Order help ticket

**API name:** Open order help ticket  
**Method / path:** `POST /orders/:orderId/help`  
**Auth:** 🔑 customer  

### Request

```json
{ "category": "missing_item", "description": "Paneer tikka missing from bag" }
```

`category`: `missing_item` · `wrong_item` · `quality_issue` · `late_delivery` · `payment` · `delivery` · `other`.

### Success `201`

```json
{
  "success": true,
  "message": "Support ticket created",
  "data": { "ticketId": "66tkt...", "ticketNo": "TKT-20260810-A3F2" }
}
```

Proxies customer-service `POST /internal/support/tickets` with `orderId` + mapped category.

### Errors

| HTTP | code | When |
|---|---|---|
| 503 | `SUPPORT_SERVICE_UNAVAILABLE` | customer-service down or invalid response |
| 422 | — | Validation (description min 10 chars) |

## Order history (customer)

**API name:** Customer order history  
**Method / path:** `GET /orders`  
**Auth:** 🔑 customer  

### Request

Query: `status` · `page` · `limit` (max 50) · `sortBy=createdAt` · `sortOrder=asc|desc` · date range via **`startDate`/`endDate`** or aliases **`dateFrom`/`dateTo`** (ISO date strings).

### Success `200`

Paginated: `{ success, message, data: [ OrderView, ... ], meta: { total, page, limit, totalPages, hasNext } }`.

## Order invoice (PDF)

**API name:** Download order invoice  
**Method / path:** `GET /orders/:orderId/invoice`  
**Auth:** 🔑 customer (owner only)  

### Success `200`

```json
{
  "success": true,
  "message": "Success",
  "data": { "url": "https://res.cloudinary.com/.../invoice-66c2....pdf" }
}
```

Generates GST PDF on first request (Cloudinary upload), then returns cached `invoiceUrl`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | — | Order not yet `delivered` |
| 403 | `FORBIDDEN` | Not your order |
| 404 | — | Order not found |
| 503 | `INVOICE_UNAVAILABLE` | Cloudinary env not configured |

## Order service readiness

**API name:** Order service readiness  
**Method / path:** `GET /health/ready`  
**Auth:** 🔓  

### Success `200`

```json
{
  "status": "ok",
  "service": "order-service",
  "checks": { "mongo": "up", "redis": "up" }
}
```

### Not ready `503`

```json
{
  "status": "not_ready",
  "service": "order-service",
  "checks": { "mongo": "up", "redis": "down" }
}
```

---

# Admin orders — order-service

Gateway: `/api/v1/order-service/admin`. Auth: 🔑 `admin` / `super_admin`.

## Admin search orders

**API name:** Admin order search  
**Method / path:** `GET /admin/orders`  
**Auth:** 🔑 admin / super_admin  

### Request

Query: `userId` · `restaurantId` · `status` · `orderNumber` · `page` · `limit` (max 100) · date range via `startDate`/`endDate` or `dateFrom`/`dateTo`.

### Success `200`

Paginated `OrderView` list (same envelope as customer history).

## Admin force cancel

**API name:** Admin force cancel order  
**Method / path:** `POST /admin/orders/:orderId/cancel`  
**Auth:** 🔑 admin / super_admin  

### Request

```json
{ "reason": "Customer unreachable — ops cancel", "issueRefund": true }
```

`issueRefund` defaults `true` for prepaid paid orders.

### Success `200`

Returns updated `OrderView` with status `cancelled`. Refund via payment-service when applicable; delivery cancel attempted for delivery orders.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ILLEGAL_TRANSITION` | Already terminal |
| 404 | `ORDER_NOT_FOUND` | Bad id |

## Admin refund

**API name:** Admin ops refund  
**Method / path:** `POST /admin/orders/:orderId/refund`  
**Auth:** 🔑 admin / super_admin  

### Request

```json
{ "amount": 420, "reason": "Partial goodwill refund" }
```

Omit `amount` to refund full remaining prepaid balance.

### Success `200`

```json
{
  "success": true,
  "message": "Refund initiated",
  "data": {
    "orderId": "66c2...",
    "refundAmount": 420,
    "refundIssued": true,
    "refundId": "rfnd_...",
    "refundError": null
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `REFUND_NOT_APPLICABLE` | COD or nothing prepaid |
| 400 | `REFUND_AMOUNT_EXCEEDS` | Amount above refundable balance |
| 404 | `ORDER_NOT_FOUND` | Bad id |

---

# Kitchen board — restaurant-service (owner / kitchen)

Gateway: `/api/v1/restaurant-service`. Auth: 🔑 `isLoggedIn`; ownership gated in service (`ownerId` or admin). Orders live in **order-service**; rider / handover / call in **delivery-service**. Reject catalog is local. Downstream non-OK responses are rethrown as `AppError` with status + `code` when present (never invent rider/handover success).

## KDS board

**API name:** Kitchen display system  
**Method / path:** `GET /restaurants/:restaurantId/orders/kds`  
**Auth:** 🔑 owner / admin  
**Who:** Kitchen app board poll.

Proxies `GET {ORDER_SERVICE_URL}/orders/restaurant/:restaurantId/kds`.

### Success `200`

```json
{
  "success": true,
  "message": "KDS board fetched",
  "data": {
    "new": [{
      "orderId": "66o1...",
      "orderNumber": "FD-240811-0012",
      "status": "placed",
      "deliveryType": "delivery",
      "paymentMethod": "upi",
      "placedAt": "2026-08-11T07:30:00.000Z",
      "acceptBy": "2026-08-11T07:35:00.000Z",
      "promisedReadyAt": null,
      "estimatedPrepTime": null,
      "delayMinutes": 0,
      "delayReason": null,
      "isDelayed": false,
      "itemCount": 3,
      "grandTotal": 420,
      "specialInstructions": "Less spicy"
    }],
    "preparing": [],
    "ready": [],
    "delayed": []
  }
}
```

### Errors

| HTTP | code | When |
|------|------|------|
| 401 | — | Missing auth |
| 403 | `FORBIDDEN` | Not owner |
| 404 | `RESTAURANT_NOT_FOUND` | Admin + unknown restaurant |
| 503 | `DOWNSTREAM_UNAVAILABLE` | Order-service unreachable |

## Reject reasons catalog

**API name:** Reject reason catalog  
**Method / path:** `GET /restaurants/:restaurantId/reject-reasons`  
**Auth:** 🔑 owner / admin  
**Who:** Kitchen reject sheet.

Local catalog (same codes as order-service).

### Success `200`

```json
{
  "success": true,
  "message": "Reject reasons fetched",
  "data": [
    { "code": "item_unavailable", "label": "Item unavailable" },
    { "code": "store_busy", "label": "Store too busy" },
    { "code": "closing", "label": "Closing soon" },
    { "code": "address_far", "label": "Delivery address too far" },
    { "code": "kitchen_closed", "label": "Kitchen closed" },
    { "code": "out_of_stock", "label": "Out of stock" },
    { "code": "other", "label": "Other" }
  ]
}
```

## Accept order (FIX)

**API name:** Accept incoming order  
**Method / path:** `PUT /restaurants/:restaurantId/orders/:orderId/accept`  
**Auth:** 🔑 owner / admin  
**Who:** Kitchen.

### Request

```json
{ "prepTime": 25 }
```

Maps `prepTime` → order-service `estimatedPrepTime` (default 20).

### Success `200`

`{ "success": true, "message": "Order accepted", "data": { /* order */ } }`

## Reject order (FIX)

**API name:** Reject incoming order  
**Method / path:** `PUT /restaurants/:restaurantId/orders/:orderId/reject`  
**Auth:** 🔑 owner / admin  
**Who:** Kitchen.

### Request

```json
{ "reasonCode": "item_unavailable", "note": "Paneer out" }
```

Forwards `rejectReasonCode` + `note` to order-service status update.

### Errors

| HTTP | code | When |
|------|------|------|
| 422 | `VALIDATION_ERROR` | Missing / invalid `reasonCode` |

## Prep time

**API name:** Override prep time  
**Method / path:** `PUT /restaurants/:restaurantId/orders/:orderId/prep-time`  
**Auth:** 🔑 owner / admin  

### Request

```json
{ "prepMinutes": 25 }
```

Proxies order-service. Errors include `ILLEGAL_TRANSITION` when not accepted/preparing.

## Delay order

**API name:** Mark order delayed  
**Method / path:** `PUT /restaurants/:restaurantId/orders/:orderId/delay`  
**Auth:** 🔑 owner / admin  

### Request

```json
{ "extraMinutes": 10, "reason": "Rush hour" }
```

## Cancel after accept

**API name:** Kitchen cancel (post-accept)  
**Method / path:** `POST /restaurants/:restaurantId/orders/:orderId/cancel`  
**Auth:** 🔑 owner / staff / admin — called by the **restaurant app**

Reject only works while the order is `placed`. This is the exit once the kitchen has already
accepted (`accepted` or `preparing`) — a fire, a gas cut, everything 86'd. Proxies order-service
`POST /orders/restaurant/:restaurantId/orders/:orderId/cancel`, which refunds prepaid orders,
cancels the delivery if a rider was assigned, and pushes to the customer.

### Request

```json
{ "reasonCode": "kitchen_closed", "note": "Gas line failure, cannot cook" }
```

| Field | Type | Notes |
|---|---|---|
| `reasonCode` | enum | `item_unavailable` \| `store_busy` \| `closing` \| `address_far` \| `kitchen_closed` \| `out_of_stock` \| `other` |
| `note` | string ≤300 | optional free text appended to the reason |

### Success `200`

```json
{
  "success": true,
  "message": "Order cancelled",
  "data": {
    "order": { "orderId": "66or...", "status": "cancelled", "grandTotal": 648 },
    "refundAmount": 648,
    "refundIssued": true,
    "refundId": "66rf...",
    "refundError": null,
    "deliveryCancelled": true,
    "customerNotified": true
  }
}
```

`refundIssued: false` with a non-null `refundError` means payment-service rejected or was
unreachable — the order is still cancelled and the amount is recorded on `refundAmount` for
support to retry. The app must not tell the customer money is on the way in that case.
COD orders return `refundAmount: 0` (nothing was ever charged).

### Errors

| code | HTTP | When |
|---|---|---|
| `USE_REJECT_INSTEAD` | 400 | Order is still `placed` — use the reject endpoint |
| `ILLEGAL_TRANSITION` | 400 | Order is `ready`, `out_for_delivery`, or already terminal |
| `VALIDATION_ERROR` | 422 | Unknown `reasonCode` |
| `FORBIDDEN` | 403 | Not this outlet's order |
| `ORDER_NOT_FOUND` | 404 | Unknown order |

## Items unavailable (partial)

**API name:** Remove unavailable items from a live order  
**Method / path:** `POST /restaurants/:restaurantId/orders/:orderId/items-unavailable`  
**Auth:** 🔑 owner / staff / admin — called by the **restaurant app**

The kitchen ran out of one dish but can still send the rest. Line items are removed, the bill is
recomputed with the same formula used at checkout, and the difference is refunded (prepaid) or
deducted from the doorstep collectible (COD). Order status is unchanged.

### Request

```json
{ "itemIds": ["66it1...", "66it2..."], "note": "Paneer finished" }
```

| Field | Type | Notes |
|---|---|---|
| `itemIds` | string[] 1–50 | order **line item** `_id`s, not menu item ids |
| `note` | string ≤300 | optional |

### Success `200`

```json
{
  "success": true,
  "message": "Items removed from order",
  "data": {
    "order": { "orderId": "66or...", "status": "preparing", "grandTotal": 421 },
    "removedItems": [
      { "itemId": "66it1...", "name": "Paneer Tikka", "quantity": 1, "itemTotal": 249 }
    ],
    "previousTotal": 670,
    "newTotal": 421,
    "refundAmount": 249,
    "refundIssued": true,
    "refundId": "66rf...",
    "refundError": null,
    "codAmountSynced": false,
    "customerNotified": true
  }
}
```

For COD the response has `refundAmount: 0` and `codAmountSynced: true` — delivery-service was told
the new collectible so the rider does not ask for the old amount. `codAmountSynced: false` on a COD
order means the sync failed and ops must correct the rider's cash sheet.

The customer app also receives socket `order:items-removed` on `user:{userId}` and `order:{orderId}`
with `{ orderId, status, itemsRemoved, previousTotal, newTotal }`, since the order status itself
does not change.

### Errors

| code | HTTP | When |
|---|---|---|
| `CANCEL_INSTEAD` | 400 | Every item was selected — use the cancel endpoint |
| `ILLEGAL_TRANSITION` | 400 | Order is not `accepted` or `preparing` |
| `ORDER_ITEM_NOT_FOUND` | 404 | An id is not a line item on this order |
| `VALIDATION_ERROR` | 422 | Empty or >50 `itemIds` |
| `FORBIDDEN` | 403 | Not this outlet's order |

## Handover display

**API name:** Pickup OTP / handover panel  
**Method / path:** `GET /restaurants/:restaurantId/orders/:orderId/handover`  
**Auth:** 🔑 owner / admin  

Proxies `GET {DELIVERY_SERVICE_URL}/restaurant/orders/:orderId/handover`. Available when rider status is `arrived_at_restaurant`. Never invents OTP.

## Handover

**API name:** Confirm rider handover  
**Method / path:** `PUT /restaurants/:restaurantId/orders/:orderId/handover`  
**Auth:** 🔑 owner / admin  

### Request

```json
{ "method": "otp", "otp": "4829" }
```

`method`: `otp` \| `tap`. Proxies `PUT {DELIVERY_SERVICE_URL}/restaurant/orders/:orderId/handover`. Never invents success.

## Assigned rider

**API name:** Order rider snippet  
**Method / path:** `GET /restaurants/:restaurantId/orders/:orderId/rider`  
**Auth:** 🔑 owner / admin  

Proxies `GET {DELIVERY_SERVICE_URL}/restaurant/orders/:orderId/partner`. Same DTO as delivery kitchen partner API.

## Self-fleet — restaurant-service gateway

Gateway: `/api/v1/restaurant-service`. Ownership gated locally, then proxies delivery `/restaurant/:restaurantId/*` (same DTOs / errors as [Restaurant Fleet APIs](#restaurant-fleet-apis)).

| Method | Path | Proxies |
|---|---|---|
| `POST` | `/restaurants/:restaurantId/fleet/invitations` | `POST /restaurant/:id/invitations` |
| `GET` | `/restaurants/:restaurantId/fleet/invitations` | `GET .../invitations` |
| `DELETE` | `/restaurants/:restaurantId/fleet/invitations/:invitationId` | `DELETE .../invitations/:id` |
| `GET` | `/restaurants/:restaurantId/fleet/partners` | `GET .../partners` |
| `GET` | `/restaurants/:restaurantId/fleet/partners/:partnerId` | `GET .../partners/:id` |
| `PUT` | `/restaurants/:restaurantId/fleet/partners/:partnerId/status` | `PUT .../status` |
| `GET` | `/restaurants/:restaurantId/fleet/available-partners` | `GET .../available-partners` |
| `POST` | `/restaurants/:restaurantId/orders/:orderId/manual-assign` | `POST .../manual-assign` |
| `POST` | `/restaurants/:restaurantId/orders/:orderId/rate-partner` | `POST .../rate-partner` |

`503 DOWNSTREAM_UNAVAILABLE` when delivery-service is down — never fake invite/assign success.

## Print KOT

**API name:** Print / reprint KOT  
**Method / path:** `POST /restaurants/:restaurantId/orders/:orderId/print-kot`  
**Auth:** 🔑 owner / admin  

### Success `200`

```json
{
  "success": true,
  "message": "KOT printed",
  "data": {
    "orderId": "66o1...",
    "orderNumber": "FD-240811-0012",
    "reprint": false,
    "printCount": 1,
    "printedAt": "2026-08-11T07:40:00.000Z",
    "ticket": {
      "restaurantName": "Pizza Hut",
      "items": [{ "name": "Margherita", "quantity": 1, "instructions": null, "modifiers": ["Size: Large"] }],
      "specialInstructions": null,
      "deliveryType": "delivery"
    }
  }
}
```

## Order history

**API name:** Kitchen order history  
**Method / path:** `GET /restaurants/:restaurantId/orders/history`  
**Auth:** 🔑 owner / admin  

### Request

Query: `from` / `to` (`YYYY-MM-DD` IST) · `page` · `limit` · `status`.

### Success `200`

Paginated: `{ success, message, data: [...], meta: { total, page, limit, totalPages, hasNext } }`.

## Scheduled orders

**API name:** Scheduled kitchen orders  
**Method / path:** `GET /restaurants/:restaurantId/orders/scheduled`  
**Auth:** 🔑 owner / admin  

### Success `200`

`{ "success": true, "message": "Scheduled orders fetched", "data": [ /* orders */ ] }`

## Pickup ready (takeaway)

**API name:** Takeaway pickup ready  
**Method / path:** `PUT /restaurants/:restaurantId/orders/:orderId/pickup-ready`  
**Auth:** 🔑 owner / admin  

Proxies order-service. `400 ILLEGAL_TRANSITION` if not pickup / wrong status.

## Complete takeaway

**API name:** Complete takeaway  
**Method / path:** `PUT /restaurants/:restaurantId/orders/:orderId/complete-takeaway`  
**Auth:** 🔑 owner / admin  

## Call customer

**API name:** Masked call customer  
**Method / path:** `POST /restaurants/:restaurantId/orders/:orderId/call-customer`  
**Auth:** 🔑 owner / admin  

Proxies `POST {DELIVERY_SERVICE_URL}/restaurant/orders/:orderId/call-customer`. Supports takeaway / pre-assign (`deliveryId: null`). Forwards `503 MASKED_CALL_UNAVAILABLE` when telephony is down — never fakes a connect.

## Order SLA

**API name:** Order SLA timers  
**Method / path:** `GET /restaurants/:restaurantId/orders/:orderId/sla`  
**Auth:** 🔑 owner / admin  

### Success `200`

```json
{
  "success": true,
  "message": "Order SLA fetched",
  "data": {
    "orderId": "66o1...",
    "status": "placed",
    "acceptBy": "2026-08-11T07:35:00.000Z",
    "prepBy": null,
    "acceptRemainingSec": 180,
    "prepRemainingSec": null,
    "isAcceptOverdue": false,
    "isPrepOverdue": false
  }
}
```

---

# Staff roles & invites — restaurant-service

Gateway: `/api/v1/restaurant-service`. **Who:** owner, or active `manager` with `manage_staff` (admin always). Roles: `manager` \| `kitchen` \| `cashier` (`kitchen_staff` accepted as alias → stored as `kitchen`). Promoting to `owner` is rejected (`400 OWNERSHIP_TRANSFER_NOT_SUPPORTED`).

## Staff roster

**API name:** List staff roster  
**Method / path:** `GET /restaurants/:restaurantId/staff`  
**Auth:** 🔑 owner / manager(`manage_staff`) / admin  

### Success `200`

```json
{
  "success": true,
  "message": "Staff roster fetched",
  "data": {
    "members": [
      {
        "staffId": null,
        "userId": "66u0...",
        "role": "owner",
        "permissions": ["view_orders", "update_orders", "manage_menu", "view_reports", "manage_staff"],
        "isActive": true,
        "lastSeenAt": null,
        "name": "Pizza Hut",
        "phoneMasked": null,
        "emailMasked": null,
        "joinedAt": "2026-01-01T00:00:00.000Z"
      },
      {
        "staffId": "66s1...",
        "userId": "66u2...",
        "role": "kitchen",
        "permissions": ["view_orders", "update_orders"],
        "isActive": true,
        "lastSeenAt": "2026-08-11T07:40:00.000Z",
        "name": "Ravi",
        "phoneMasked": "******3210",
        "emailMasked": "ra***@mail.com",
        "joinedAt": "2026-08-01T10:00:00.000Z"
      }
    ],
    "pendingInvites": [
      {
        "inviteId": "66i1...",
        "name": "Priya",
        "phoneMasked": "******9988",
        "emailMasked": null,
        "role": "cashier",
        "permissions": ["view_orders", "update_orders"],
        "status": "pending",
        "expiresAt": "2026-08-14T07:00:00.000Z",
        "inviteUrl": "https://partner.fooddelivery.app/staff/invite?token=abc&restaurantId=66r1...",
        "deliveredVia": ["invite_url"],
        "createdAt": "2026-08-11T07:00:00.000Z"
      }
    ]
  }
}
```

`lastSeenAt` updates when staff hits internal access / kitchen flows (`checkAccess`).

## Invite staff

**API name:** Invite staff by phone/email  
**Method / path:** `POST /restaurants/:restaurantId/staff/invite`  
**Auth:** 🔑 owner / manager(`manage_staff`) / admin · CSRF  

### Request

```json
{
  "name": "Priya",
  "phone": "9876543210",
  "email": "priya@example.com",
  "role": "kitchen",
  "permissions": ["view_orders", "update_orders"]
}
```

`phone` or `email` required. Default permissions by role if omitted. Persists `StaffInvitation` (72h TTL). Rate limit 20/hour/restaurant.

### Success `201`

Returns `StaffInviteDto`. `deliveredVia` always includes `invite_url`; adds `sms` / `email` only when Twilio/MSG91 / notification-service actually succeed — never fakes delivery.

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` / `INVALID_PHONE` | Bad body |
| 409 | `INVITE_ALREADY_PENDING` | Same phone/email pending |
| 429 | `INVITE_RATE_LIMITED` | > 20 / hour |
| 403 | `FORBIDDEN` | Not owner / manage_staff manager |
| 400 | `OWNERSHIP_TRANSFER_NOT_SUPPORTED` | `role: owner` |

## Accept staff invite

**API name:** Accept staff invitation  
**Method / path:** `POST /restaurants/:restaurantId/staff/accept`  
**Auth:** 🔑 any logged-in user (invitee)  

### Request

```json
{ "token": "hex-token-from-invite" }
```

### Success `200`

Returns `StaffMemberDto` for the activated membership. Reactivates soft-deleted rows for the same `(restaurantId, userId)`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `INVITE_NOT_FOUND` | Bad token / wrong restaurant |
| 410 | `INVITE_EXPIRED` / `INVITE_CANCELLED` | Past TTL or cancelled |
| 409 | `STAFF_ALREADY_EXISTS` / `ALREADY_OWNER` / `INVITE_ALREADY_ACCEPTED` | Conflict |

## Update staff

**API name:** Update staff role / permissions  
**Method / path:** `PUT /restaurants/:restaurantId/staff/:staffId`  
**Auth:** 🔑 owner / manager(`manage_staff`) / admin · CSRF  

### Request

```json
{ "role": "manager", "permissions": ["view_orders", "update_orders", "manage_menu", "view_reports", "manage_staff"], "isActive": true }
```

### Success `200`

`StaffMemberDto`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `STAFF_NOT_FOUND` | Unknown staffId |
| 400 | `OWNERSHIP_TRANSFER_NOT_SUPPORTED` | `role: owner` |
| 403 | `FORBIDDEN` | Not allowed |

## Direct-add / remove staff

**API name:** Add staff by userId  
**Method / path:** `POST /restaurants/:restaurantId/staff`  
**Auth:** 🔑 owner / manager(`manage_staff`) / admin  

Body: `{ userId, role, permissions?, name?, phone?, email? }`. Reactivates inactive memberships.

**API name:** Remove staff  
**Method / path:** `DELETE /restaurants/:restaurantId/staff/:staffId`  
**Auth:** 🔑 owner / manager(`manage_staff`) / admin  

Soft-deactivate (`isActive: false`).

---

# Review Service APIs

Gateway: `/api/v1/review-service`. **Who:** customer (primary), restaurant owner/admin (reply/moderate). Full inventory: [REVIEW_SERVICE_APIS.md](REVIEW_SERVICE_APIS.md).

## Global error envelope

All review-service failures (except unhandled crashes) return:

```json
{ "success": false, "message": "Human-readable detail", "code": "SCREAMING_SNAKE" }
```

| code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 / 413 / 422 | Bad input, images, admin reason, state conflicts |
| `UNAUTHORIZED` | 401 | No session |
| `FORBIDDEN` | 403 | Wrong role or not review owner |
| `ORDER_NOT_ELIGIBLE` | 403 | POST review — order not delivered or wrong owner/restaurant |
| `EDIT_WINDOW_EXPIRED` | 403 | PUT edit after 24h |
| `ORDER_NOT_FOUND` | 404 | Unknown `orderId` at proof time |
| `REVIEW_NOT_FOUND` | 404 | Unknown review or wrong restaurant |
| `NOT_FOUND` | 404 | Unknown route |
| `RATING_ALREADY_SUBMITTED` | 409 | One review per order (or dish ratings already exist) |
| `ALREADY_REPORTED` | 409 | Duplicate open report flag |
| `DOWNSTREAM_UNAVAILABLE` | 503 | order-service or Cloudinary down during required step |
| `INTERNAL_ERROR` | 500 | Unexpected failure |

Full list: [REVIEW_SERVICE_APIS.md §9](REVIEW_SERVICE_APIS.md#9-error-codes).

## Health / ready

**Method / path:** `GET /health` · 🔓  
**Success `200`:** `{ "success": true, "service": "review-rating-service" }`

**Method / path:** `GET /health/ready` · 🔓  
**Success `200`:** `{ "success": true, "status": "ok", "checks": { "mongo": "ok", "pendingSyncJobs": 0 } }` — `pendingSyncJobs` counts Mongo `ratingsyncjobs` awaiting histogram sync.  
**Error `503`:** Mongo not connected.

## List reviews

**Method / path:** `GET /restaurants/:restaurantId/reviews?page=&limit=&rating=&unanswered=1`  
**Auth:** 🔓 public

### Success `200`

```json
{
  "success": true,
  "data": {
    "reviews": [{ "_id": "66rv...", "restaurantId": "66r1...", "orderId": "66o1...", "userId": "66u1...", "customerName": "Anshu", "rating": 5, "comment": "Great food", "reply": null, "repliedAt": null, "isVisible": true, "createdAt": "2026-08-10T12:00:00.000Z" }],
    "total": 143, "page": 1, "limit": 20, "totalPages": 8,
    "stats": { "avgRating": 4.3, "totalReviews": 820, "distribution": [{ "stars": 5, "count": 400, "percentage": 49 }] }
  }
}
```

## Review stats

**Method / path:** `GET /restaurants/:restaurantId/reviews/stats` · 🔓  
**Success `200`:** `{ "success": true, "data": { "avgRating": 4.3, "totalReviews": 820, "distribution": [...] } }`

## Submit review

**Method / path:** `POST /restaurants/:restaurantId/reviews`  
**Auth:** 🔑 customer · CSRF on gateway

### Request (JSON)

```json
{ "orderId": "66o1...", "rating": 5, "comment": "Great food", "customerName": "Anshu", "imageUrls": [] }
```

Optional **`imageUrls`**: max 5 HTTPS Cloudinary URLs for this platform account.

Optional **multipart:** `Content-Type: multipart/form-data` with text fields above + file field **`images`** (max 5, JPEG/PNG/WEBP, 5 MB each) — uploaded to Cloudinary `review-images/`.

Server validates via order-service `GET /orders/internal/batch?ids=` — order must be `delivered`, `order.userId === caller`, `order.restaurantId === :restaurantId`. On success, syncs histogram to restaurant-service and dispatches customer + owner notifications via notification-service (fire-and-forget; review still `201` if notification-service is down or unset).

### Success `201`

Created review object including `images: string[]`.

### Errors

| code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Bad rating; missing `orderId`; invalid/too many `imageUrls` or images |
| `UNAUTHORIZED` | 401 | No session |
| `ORDER_NOT_ELIGIBLE` | 403 | Order not delivered or wrong user/restaurant |
| `ORDER_NOT_FOUND` | 404 | Unknown `orderId` |
| `RATING_ALREADY_SUBMITTED` | 409 | Duplicate review for order |
| `DOWNSTREAM_UNAVAILABLE` | 503 | order-service unreachable during proof |

After `201`, review-service asynchronously calls notification-service (`POST /internal/notifications`) for customer thanks + owner new-review alert. Failures are logged only — response is never rolled back.

## Outbound WIRE (server-only)

Review-service has no inbound `/internal/*`. After mutations it calls:

| Target | Path | When |
|---|---|---|
| order-service | `GET /orders/internal/batch?ids=` | POST review — order proof |
| restaurant-service | `POST /internal/restaurants/:restaurantId/ratings/sync` | After create / delete / admin hide / restore |
| restaurant-service | `GET /internal/restaurants/:restaurantId` | Resolve `ownerId` for owner notification |
| notification-service | `POST /internal/notifications` | After create — customer + owner pushes |

Rating sync uses Mongo `ratingsyncjobs` retry worker if restaurant-service is temporarily down.

## Order review status

**Method / path:** `GET /orders/:orderId/review` · 🔑 customer  
**Success `200`:** review object (includes `dishRatings: []` when present) or `{ "success": true, "data": null }` if not reviewed / not caller's order.

## Edit review

**Method / path:** `PUT /restaurants/:restaurantId/reviews/:reviewId`  
**Auth:** 🔑 author only · CSRF · optional multipart `images`

### Request

```json
{ "rating": 4, "comment": "Updated — still good", "imageUrls": [] }
```

At least one of `rating`, `comment`, `imageUrls`/files required. Sets `editedAt`. Re-syncs histogram only if `rating` changed.

### Errors

| code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Empty body / bad rating / images |
| `FORBIDDEN` | 403 | Not the author |
| `EDIT_WINDOW_EXPIRED` | 403 | More than 24h after `createdAt` |
| `REVIEW_NOT_FOUND` | 404 | Unknown / wrong restaurant / hidden |

## Combined order review

**Method / path:** `POST /orders/:orderId/reviews`  
**Auth:** 🔑 customer · CSRF · optional multipart `images`

### Request

```json
{
  "restaurantRating": 5,
  "packagingRating": 4,
  "comment": "Great food, arrived warm",
  "customerName": "Anshu",
  "imageUrls": [],
  "dishes": [{ "itemId": "66mi...", "rating": 5 }]
}
```

`itemId` must match an order line `menuItemId`. Creates `Review` + `DishRating[]`.

### Success `201`

```json
{ "success": true, "data": { "review": { "_id": "66rv...", "rating": 5, "packagingRating": 4, "images": [] }, "dishRatings": [{ "itemId": "66mi...", "rating": 5 }] } }
```

### Errors

Same as submit review + `VALIDATION_ERROR` if dish `itemId` not on order.

## Per-dish ratings only

**Method / path:** `POST /orders/:orderId/reviews/dishes` · 🔑 customer · CSRF

```json
{ "dishes": [{ "itemId": "66mi...", "rating": 5 }] }
```

Does not create a restaurant `Review`. `409 RATING_ALREADY_SUBMITTED` if dish ratings already exist for the order.

## Delete review

**Method / path:** `DELETE /restaurants/:restaurantId/reviews/:reviewId` · 🔑  
**Auth:** customer (own review), `restaurant_owner`, `admin`, `super_admin`

**Success `200`:** `{ "success": true, "data": { "deleted": true } }` — soft delete; re-syncs restaurant histogram.

## Owner reply

**Method / path:** `POST /restaurants/:restaurantId/reviews/:reviewId/reply` · 🔑 owner/admin

```json
{ "reply": "Thank you for dining with us!" }
```

### Errors

| code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Empty reply |
| `REVIEW_NOT_FOUND` | 404 | Unknown review or wrong restaurant |
| `FORBIDDEN` | 403 | Not owner/admin |

---

## Report review (customer → moderation queue)

**Method / path:** `POST /restaurants/:restaurantId/reviews/:reviewId/report`  
**Auth:** 🔑 customer · CSRF on gateway

### Request

```json
{ "reason": "Offensive language" }
```

Creates an open flag in Mongo `reviewflags` for admin `GET /admin/reviews/flagged`. One open flag per user per review.

### Success `201`

```json
{ "success": true, "message": "Review reported", "data": { "reviewId": "66rv...", "reportedAt": "2026-08-12T14:30:00.000Z" } }
```

### Errors

| code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Short/missing reason; review already hidden |
| `UNAUTHORIZED` | 401 | No session |
| `REVIEW_NOT_FOUND` | 404 | Unknown review or wrong restaurant |
| `ALREADY_REPORTED` | 409 | Caller already has an open flag on this review |

---

## Admin moderation queue

Gateway: `/api/v1/review-service/admin/reviews/*`. **Who:** admin panel (`admin` / `super_admin`). Service enforces `requireAdmin`.

### List flagged reviews

**Method / path:** `GET /admin/reviews/flagged?page=&limit=`  
**Auth:** 🔑 admin

#### Success `200`

```json
{
  "success": true,
  "data": {
    "flags": [
      { "reviewId": "66rv...", "restaurantId": "66r1...", "reason": "Spam", "reportedAt": "2026-08-12T14:30:00.000Z", "reportedBy": "66u2..." }
    ],
    "total": 12, "page": 1, "limit": 20, "totalPages": 1
  }
}
```

### Search reviews (ops)

**Method / path:** `GET /admin/reviews/queries?restaurantId=&userId=&orderId=&from=&to=&page=&limit=`  
**Auth:** 🔑 admin

`from` / `to` are ISO-8601 datetimes. Returns all reviews (visible and hidden).

#### Success `200`

```json
{
  "success": true,
  "data": {
    "reviews": [{ "_id": "66rv...", "restaurantId": "66r1...", "orderId": "66o1...", "userId": "66u1...", "rating": 2, "comment": "...", "isVisible": false, "createdAt": "..." }],
    "total": 1, "page": 1, "limit": 20, "totalPages": 1
  }
}
```

### Hide review

**Method / path:** `PUT /admin/reviews/:reviewId/hide`  
**Auth:** 🔑 admin

```json
{ "reason": "Violates community guidelines" }
```

Sets `isVisible: false`, resolves open flags, writes audit log (`action: hide`), re-syncs restaurant histogram.

#### Errors

| code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Already hidden; bad reason |
| `FORBIDDEN` | 403 | Not admin |
| `REVIEW_NOT_FOUND` | 404 | Unknown review |

### Restore review

**Method / path:** `PUT /admin/reviews/:reviewId/restore`  
**Auth:** 🔑 admin

Optional body `{ "reason": "False report" }`. Sets `isVisible: true`, audit `action: restore`, re-syncs histogram.

### Admin force delete

**Method / path:** `DELETE /admin/reviews/:reviewId`  
**Auth:** 🔑 admin

```json
{ "reason": "Permanent removal — policy violation" }
```

Soft-deletes review, resolves flags, audit `action: delete`, re-syncs histogram.

#### Success `200`

```json
{ "success": true, "data": { "deleted": true } }
```

---

# Restaurant outlet ops — ratings reply, payouts, support, devices

Gateway: `/api/v1/restaurant-service`. **Who:** owner, active staff, or admin (unless noted). Payout/invoice/commission proxy payment-service with `x-internal-key` after ownership check — never invent settlement rows.

## List reviews (owner inbox)

**API name:** Restaurant review inbox  
**Method / path:** `GET /restaurants/:restaurantId/reviews?page=&limit=&rating=&unanswered=1`  
**Auth:** 🔑 owner / staff / admin — called by the **restaurant app** (reply screen)

### Request

| Query | Type | Notes |
|---|---|---|
| `page` | int | default `1` |
| `limit` | int | default `20`, max `100` |
| `rating` | 1–5 | filter one star bucket |
| `unanswered` | `1` \| `true` | only reviews with no reply yet |

Proxies review-rating-service `GET /restaurants/:restaurantId/reviews` after the ownership check.

### Success `200`

```json
{
  "success": true,
  "message": "Reviews fetched",
  "data": [
    {
      "reviewId": "66rv...",
      "orderId": "66or...",
      "customerName": "Aditi S.",
      "rating": 2,
      "comment": "Biryani was cold on arrival.",
      "images": ["https://res.cloudinary.com/.../review1.jpg"],
      "reply": null,
      "repliedAt": null,
      "hasReply": false,
      "createdAt": "2026-08-10T14:02:11.000Z"
    }
  ],
  "meta": {
    "total": 143,
    "page": 1,
    "limit": 20,
    "totalPages": 8,
    "hasNext": true,
    "stats": {
      "avgRating": 4.2,
      "totalReviews": 143,
      "distribution": [
        { "stars": 5, "count": 88, "percentage": 62 },
        { "stars": 4, "count": 30, "percentage": 21 },
        { "stars": 3, "count": 12, "percentage": 8 },
        { "stars": 2, "count": 8, "percentage": 6 },
        { "stars": 1, "count": 5, "percentage": 3 }
      ]
    }
  }
}
```

### Errors

| code | HTTP | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | No `_sid` |
| `FORBIDDEN` | 403 | Not this outlet's owner/staff |
| `RESTAURANT_NOT_FOUND` | 404 | Unknown outlet |
| `DOWNSTREAM_UNAVAILABLE` | 503 | review-service down — never returns an empty list as if there were no reviews |

## Reply to review

**API name:** Owner reply to review  
**Method / path:** `POST /restaurants/:restaurantId/reviews/:reviewId/reply`  
**Auth:** 🔑 owner / staff / admin  

### Request

```json
{ "reply": "Thank you — glad you enjoyed it!" }
```

Proxies review-service; review must belong to this `restaurantId`.

## Delete review (kitchen proxy)

**API name:** Soft-delete review (kitchen)  
**Method / path:** `DELETE /restaurants/:restaurantId/reviews/:reviewId`  
**Auth:** 🔑 owner / staff / admin  

Proxies review-service DELETE after `assertKitchenAccess`. Success `{ deleted: true }`.

## Payouts / invoices / commission

Restaurant-service proxies payment-service after `assertKitchenAccess`. Never invents settlement rows. `503 PAYMENT_SERVICE_UNAVAILABLE` when payment-service is down (commission falls back to a local default that is honestly labeled).

### List payouts

**API name:** Outlet settlements  
**Method / path:** `GET /restaurants/:restaurantId/payouts?page=&limit=`  
**Auth:** 🔑 owner / staff / admin  

### Success `200`

`data` is the payment-service page object:

```json
{
  "success": true,
  "message": "Payouts fetched",
  "data": {
    "data": [{
      "_id": "66p1...",
      "recipientType": "restaurant",
      "recipientId": "66r1...",
      "period": "2026-W33",
      "kind": "weekly",
      "ordersCount": 42,
      "grossAmount": 81200.5,
      "commissionRate": 0.18,
      "commissionAmount": 14616.09,
      "tdsAmount": 812,
      "feeAmount": 0,
      "netAmount": 65772.41,
      "status": "paid",
      "bankAccountNo": "XXXXXXXX1234",
      "ifscCode": "HDFC0001234",
      "paidAt": "2026-08-12T06:10:00.000Z",
      "failureReason": null,
      "createdAt": "2026-08-11T18:00:00.000Z"
    }],
    "total": 8,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

`status`: `pending` | `processing` | `paid` | `failed` | `on_hold`.

### Get payout

**API name:** One settlement  
**Method / path:** `GET /restaurants/:restaurantId/payouts/:payoutId`  
**Auth:** 🔑 owner / staff / admin  

Same payout document as a list row. `404 PAYOUT_NOT_FOUND` if the id is not this outlet’s.

### List invoices

**API name:** GST / settlement invoices  
**Method / path:** `GET /restaurants/:restaurantId/invoices?page=&limit=`  
**Auth:** 🔑 owner / staff / admin  

Derived from payouts (one invoice per settlement). `gstOnCommission` = 18% of `commissionAmount`.

### Success `200`

```json
{
  "success": true,
  "message": "Invoices fetched",
  "data": {
    "data": [{
      "invoiceId": "INV-A1B2C3D4",
      "payoutId": "66p1...",
      "restaurantId": "66r1...",
      "period": "2026-W33",
      "invoiceType": "settlement",
      "currency": "INR",
      "grossAmount": 81200.5,
      "commissionAmount": 14616.09,
      "tdsAmount": 812,
      "netAmount": 65772.41,
      "gstOnCommission": 2630.9,
      "status": "paid",
      "issuedAt": "2026-08-11T18:00:00.000Z",
      "paidAt": "2026-08-12T06:10:00.000Z"
    }],
    "total": 8,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

### Commission

**API name:** Current commission schedule  
**Method / path:** `GET /restaurants/:restaurantId/commission`

```json
{
  "success": true,
  "message": "Commission schedule fetched",
  "data": {
    "restaurantId": "66r1...",
    "commissionRate": 0.18,
    "commissionPercent": 18,
    "tdsRate": 0.01,
    "tdsPercent": 1,
    "currency": "INR",
    "effectiveFrom": null,
    "feeSchedule": [
      { "id": "platform_commission", "label": "Platform commission", "type": "percent", "value": 18, "description": "Charged on order gross before TDS" }
    ],
    "source": "platform_default"
  }
}
```

`503 PAYMENT_SERVICE_UNAVAILABLE` when payment-service is down (commission falls back to local default honestly labeled).

## Support tickets

**Create:** `POST /restaurants/:restaurantId/support/tickets`  
**Auth:** 🔑 owner / staff / admin · CSRF  

Body: `{ category: orders|payout|menu|kyc|app|other, subject (min 5), description (min 10), priority?: low|medium|high|urgent, orderId?, payoutId?, attachments?: url[] }` → Mongo `RestaurantSupportTicket`.

### Success `201`

```json
{
  "success": true,
  "message": "Support ticket created",
  "data": {
    "ticketId": "66t1...",
    "ticketNo": "RST-XXXX-AB12",
    "restaurantId": "66r1...",
    "category": "orders",
    "subject": "Rider never arrived",
    "description": "Order 142 sat on Ready for 40 minutes.",
    "status": "open",
    "priority": "high",
    "orderId": "66o1...",
    "payoutId": null,
    "createdAt": "2026-08-16T10:00:00.000Z",
    "updatedAt": "2026-08-16T10:00:00.000Z"
  }
}
```

Errors: `422 VALIDATION_ERROR` / `INVALID_TICKET_CATEGORY`.

**List:** `GET /restaurants/:restaurantId/support/tickets?page=&limit=&status=`  
`status`: `open` | `in_progress` | `waiting_on_restaurant` | `resolved` | `closed`. Paginated `{ data: tickets[], meta }`.

## Devices

**Register:** `POST /restaurants/:restaurantId/devices` `{ platform: ios|android|web, token, deviceId?, appVersion? }` — Mongo `RestaurantDevice`, token masked in response. Upserts by token. Best-effort sync to notification-service `app: kitchen`. CSRF.

### Success `201`

```json
{
  "success": true,
  "message": "Device registered",
  "data": {
    "deviceId": "66d1...",
    "platform": "android",
    "tokenMasked": "abcd…wxyz",
    "appVersion": "1.0.0",
    "lastSeenAt": "2026-08-16T10:00:00.000Z",
    "createdAt": "2026-08-16T10:00:00.000Z"
  }
}
```

**Unregister:** `DELETE /restaurants/:restaurantId/devices/:deviceId` → `{ deleted: true }`. `404 DEVICE_NOT_FOUND`.

## Notifications inbox

**API name:** Kitchen notification inbox  
**Method / path:** `GET /restaurants/:restaurantId/notifications?page=&limit=&unread=`  
**Auth:** 🔑 owner / staff / admin  

**List only** — mark-read / clear live on notification-service §7. Proxies `GET {NOTIFICATION_SERVICE_URL}/internal/notifications?userId=&role=restaurant`. `503 NOTIFICATION_SERVICE_UNAVAILABLE` if unset.

### Success `200`

```json
{
  "success": true,
  "message": "Notifications fetched",
  "data": {
    "notifications": [{
      "id": "66n1...",
      "type": "order",
      "title": "New order",
      "message": "Order #142 is waiting for accept.",
      "data": { "orderId": "66o1..." },
      "isRead": false,
      "createdAt": "2026-08-16T10:00:00.000Z"
    }],
    "total": 12,
    "page": 1,
    "limit": 20,
    "totalPages": 1,
    "unreadCount": 3
  }
}
```

## Kitchen config

**API name:** Kitchen app config  
**Method / path:** `GET /restaurants/:restaurantId/config?appVersion=`  
**Auth:** 🔑  

### Success `200`

```json
{
  "success": true,
  "message": "Kitchen config fetched",
  "data": {
    "restaurantId": "66r1...",
    "minSupportedAppVersion": "1.0.0",
    "latestAppVersion": "1.0.0",
    "forceUpdate": false,
    "updateAvailable": false,
    "timezone": "Asia/Kolkata",
    "featureFlags": { "kds_enabled": true, "masked_calls": true, "takeaway_flow": true, "staff_invites": true, "push_new_orders": true },
    "rejectReasons": [{ "code": "item_unavailable", "label": "Item unavailable" }]
  }
}
```

## Outlet surge status

**API name:** Zone surge chip  
**Method / path:** `GET /restaurants/:restaurantId/surge-status`  
**Auth:** 🔑 owner / kitchen staff / admin  
**Who:** Restaurant app header chip

Uses outlet `zoneId` → delivery `GET /zones/:zoneId/surge-status`. Never invents surge. Missing `zoneId` → `400 ZONE_NOT_ASSIGNED`. Delivery down → `503 DOWNSTREAM_UNAVAILABLE`.

### Success `200`

```json
{
  "success": true,
  "message": "Surge status fetched",
  "data": {
    "restaurantId": "66r1...",
    "zoneId": "66z1...",
    "name": "Koramangala",
    "city": "Bengaluru",
    "surgeMultiplier": 1.4,
    "isActive": true,
    "surgeActive": true,
    "reason": "zone_surge"
  }
}
```

`reason`: `zone_surge` \| `no_surge` \| `zone_inactive`.

---

# Restaurant analytics extras

Gateway: `/api/v1/restaurant-service`. **Who:** owner / admin. Proxies order-service Mongo aggregations (IST). Default range for `from`/`to` = last 7 IST days. Max range = **90 days**. Excludes `pending_payment` / `payment_failed`. Restaurant app uses these paths only — do not dual-wire `/api/v1/order-service/orders/restaurant/:id/analytics/*`.

Errors (all JSON except CSV): `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 RESTAURANT_NOT_FOUND`, `422 DATE_RANGE_TOO_LARGE` / `VALIDATION_ERROR`, `503 ORDER_SERVICE_UNAVAILABLE`.

## Analytics overview

**API name:** Outlet insights overview  
**Method / path:** `GET /restaurants/:restaurantId/analytics`  
**Auth:** 🔑 owner / admin  

No query params (today + all-time). `ordersToday` / `revenueToday` are IST calendar today from order-service; `totalOrders` / `totalRevenue` are all-time; `avgRating` / `totalRatings` / `activeItems` / `totalCategories` come from the restaurant + menu collections.

### Success `200`

```json
{
  "success": true,
  "message": "Analytics overview fetched",
  "data": {
    "ordersToday": 12,
    "revenueToday": 4820.5,
    "totalOrders": 840,
    "totalRevenue": 412300,
    "avgRating": 4.3,
    "totalRatings": 210,
    "activeItems": 48,
    "totalCategories": 6
  }
}
```

## Revenue time-series

**API name:** Revenue analytics  
**Method / path:** `GET /restaurants/:restaurantId/analytics/revenue?period=day|week|month`  
**Auth:** 🔑 owner / admin  

`period` default `week`. `day` = last 24h by hour; `week` = last 7d by day; `month` = last 30d by day. Response `data` is the **points array** (not wrapped in `{ points }`).

### Success `200`

```json
{
  "success": true,
  "message": "Revenue analytics fetched",
  "data": [
    { "date": "2026-08-10", "revenue": 6120.5, "orders": 14 }
  ]
}
```

## Top selling items

**API name:** Top SKUs  
**Method / path:** `GET /restaurants/:restaurantId/analytics/top-items?limit=`  
**Auth:** 🔑 owner / admin  

`limit` default 10, max 50. All-time from menu `totalOrdered` (not date-filtered). `revenue` = `totalOrdered * price`.

### Success `200`

```json
{
  "success": true,
  "message": "Top items fetched",
  "data": [
    {
      "itemId": "66m1...",
      "name": "Butter chicken",
      "totalOrdered": 320,
      "revenue": 89600,
      "image": "https://cdn.example/item.jpg"
    }
  ]
}
```

## Orders by hour / status

**API name:** Orders analytics  
**Method / path:** `GET /restaurants/:restaurantId/analytics/orders?from=&to=`  
**Auth:** 🔑 owner / admin  

**Request:** query `from`, `to` as `YYYY-MM-DD` IST (default last 7 days, max 90). `byHour` is 24 IST hours (`0`–`23`).

### Success `200`

```json
{
  "success": true,
  "message": "Orders analytics fetched",
  "data": {
    "restaurantId": "66r1...",
    "from": "2026-08-05",
    "to": "2026-08-11",
    "timezone": "Asia/Kolkata",
    "byHour": [{ "hour": 12, "count": 8, "revenue": 4200 }],
    "byStatus": [{ "status": "delivered", "count": 40, "revenue": 22000 }],
    "totals": { "orders": 55, "revenue": 30120.5 }
  }
}
```

## Cancellations analytics

**API name:** Reject + cancel rates  
**Method / path:** `GET /restaurants/:restaurantId/analytics/cancellations?from=&to=`  
**Auth:** 🔑 owner / admin  

Query: `from`, `to` as `YYYY-MM-DD` IST (default last 7 days, max 90). Rates are **percent 0–100**.

### Success `200`

```json
{
  "success": true,
  "message": "Cancellations analytics fetched",
  "data": {
    "restaurantId": "66r1...",
    "from": "2026-08-05",
    "to": "2026-08-11",
    "timezone": "Asia/Kolkata",
    "totals": {
      "orders": 55,
      "rejected": 3,
      "cancelled": 4,
      "cancelledByCustomer": 3,
      "cancelledByRestaurant": 1,
      "cancelledBySystem": 0,
      "rejectRate": 5.45,
      "customerCancelRate": 5.45,
      "cancelRate": 7.27
    },
    "byRejectReason": [{ "code": "too_busy", "count": 2 }],
    "byCancelledBy": [{ "by": "customer", "count": 3 }],
    "daily": [{ "date": "2026-08-05", "orders": 8, "rejected": 1, "cancelled": 0 }]
  }
}
```

## CSV export

**API name:** Orders CSV export  
**Method / path:** `GET /restaurants/:restaurantId/analytics/export?from=&to=`  
**Auth:** 🔑 owner / admin  

**Request:** query `from`, `to` (`YYYY-MM-DD` IST). Same 90-day cap.

**Success `200`:** raw `text/csv; charset=utf-8` (not a JSON envelope). Headers: `Content-Disposition: attachment; filename="…"`, `X-Row-Count`. Columns: orderId, orderNumber, createdAt, status, deliveryType, grandTotal, paymentMethod, paymentStatus, cancelledBy, rejectReasonCode, cancellationReason. Cap 10 000 rows.

**Errors:** JSON `422 DATE_RANGE_TOO_LARGE`, `503 ORDER_SERVICE_UNAVAILABLE`.

Overview + revenue use live order aggregates (no stub zeros).

---

# Restaurant browse (customer) — restaurant-service

Gateway: `/api/v1/restaurant-service`. Customer never calls `/admin/*`, `/internal/*`, or kitchen accept/reject. Public list/nearby/detail only return **`status: active`**. Guest FSSAI is **masked**. Errors: `{ success: false, message, code }` (`VALIDATION_ERROR` 422, `RESTAURANT_NOT_FOUND` 404, `RESTAURANT_NOT_ACTIVE` 400).

## Nearby restaurants

**API name:** Nearby restaurants  
**Method / path:** `GET /restaurants/nearby`  
**Auth:** 👤 OptAuth · customer app

### Request

Query: `lat` (required, -90..90) · `lng` (required, -180..180) · `radius` km (default 5, max 30) · `page` · `limit` · `veg=true|1` (`settings.isPureVeg`) · `minRating` or `rating` · `priceRange` or `cost` (`budget|moderate|expensive|fine_dining`) · `sort=relevance|delivery_time|rating|cost` · `offers=1` (active Offer docs) · `hygiene=1` (`hygieneScore ≥ 4`) · `isOnline` · `cuisines` comma list · `zoneId`.

`sort=delivery_time` uses `settings.avgPrepTime` only — never fake Maps traffic. Card `deliveryTimeLabel` / `promiseMinutes` = prep + haversine travel @ 22 km/h + 3 min buffer (listing only; checkout still uses delivery-service Maps quote).

### Success response `200`

```json
{
  "success": true,
  "message": "Nearby restaurants fetched",
  "data": [{
    "_id": "66aa...",
    "name": "Pizza Hut",
    "slug": "pizza-hut-dwarka-1234",
    "cuisines": ["pizza", "italian"],
    "avgRating": 4.2,
    "totalRatings": 1200,
    "costForTwo": 600,
    "priceRange": "moderate",
    "coverImage": "https://…",
    "logo": "https://…",
    "isOnline": true,
    "hygieneScore": 4,
    "fssaiMasked": "**********5678",
    "isOpenNow": true,
    "nextOpenAt": null,
    "timezone": "Asia/Kolkata",
    "avgPrepTime": 25,
    "isPureVeg": false,
    "isCashOnDelivery": true,
    "distanceMeters": 842.3,
    "promiseMinutes": 32,
    "promiseMinMinutes": 27,
    "promiseMaxMinutes": 37,
    "deliveryTimeLabel": "27–37 mins",
    "travelIncluded": true,
    "hasOffers": true,
    "offers": [{
      "_id": "66of...",
      "code": "FLAT100",
      "title": "Flat ₹100 off",
      "type": "flat",
      "value": 100,
      "minOrderValue": 299,
      "maxDiscount": null,
      "label": "₹100 OFF"
    }],
    "address": { "street": "Sector 12", "city": "Delhi", "state": "DL", "pincode": "110075", "country": "India" },
    "location": { "type": "Point", "coordinates": [77.04, 28.59] },
    "status": "active"
  }],
  "meta": { "total": 40, "page": 1, "limit": 20, "totalPages": 2, "hasNext": true }
}
```

Pending / rejected / suspended never appear. Full FSSAI, GST, `ownerId`, `bankAccountId` are not on this DTO. Up to **2** active offer badges (`label` like `20% OFF` / `₹100 OFF` / `FREE DELIVERY` / `BOGO`). `travelIncluded: false` when distance is unknown (list without `lat`+`lng`).

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Missing/invalid `lat`/`lng` or bad filter |

---

## List restaurants

**API name:** List restaurants  
**Method / path:** `GET /restaurants`  
**Auth:** 👤 OptAuth · customer; 🔐 admin may pass `status=`

Same filters as nearby. Optional `lat`+`lng` so cards include travel in ETA. Non-admin always `status=active` + public DTO (rating, offers, `deliveryTimeLabel`). Admin without `status` still defaults to `active`.

---

## Cuisines

**API name:** Cuisine chips  
**Method / path:** `GET /cuisines`  
**Auth:** 🔓 Public · customer home / search chips  
**Who:** Customer app. **Canonical on restaurant-service** (not search-service).

### Success response `200`

```json
{
  "success": true,
  "message": "Cuisines fetched",
  "data": [
    { "slug": "north-indian", "name": "North Indian", "restaurantCount": 42 },
    { "slug": "biryani", "name": "Biryani", "restaurantCount": 18 }
  ]
}
```

Aggregated from **active** restaurants only.

---

## Restaurant by slug

**API name:** Restaurant deep link  
**Method / path:** `GET /restaurants/slug/:slug`  
**Auth:** 👤 OptAuth · customer share URL

Same `data` as `GET /restaurants/:restaurantId` (public DTO unless owner/admin). Optional `?lat=&lng=` for ETA. `404 RESTAURANT_NOT_FOUND` if missing or not active (and viewer is not owner/admin).

---

## Restaurant detail (public)

**API name:** Restaurant detail  
**Method / path:** `GET /restaurants/:restaurantId`  
**Auth:** 👤 OptAuth

Customer / guest → **PublicRestaurantDto** (FSSAI masked, `avgRating`, `totalRatings`, `offers[]`, `deliveryTimeLabel`, `isOpenNow`, no PII). Optional `?lat=&lng=` for travel in ETA. Owner or admin → full restaurant document. Non-active + not owner/admin → `404 RESTAURANT_NOT_FOUND` (do not leak pending listings).

---

## Restaurant ratings (histogram)

**API name:** Restaurant ratings  
**Method / path:** `GET /restaurants/:restaurantId/ratings`  
**Auth:** 🔓 Public · customer app star row / filter sheet  
**Who:** Customer app. Written review list is **review-service** `GET /restaurants/:id/reviews`.

### Success response `200`

```json
{
  "success": true,
  "message": "Ratings fetched",
  "data": {
    "restaurantId": "66aa...",
    "avgRating": 4.2,
    "totalRatings": 1200,
    "breakdown": { "1": 20, "2": 40, "3": 140, "4": 400, "5": 600 }
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `RESTAURANT_NOT_FOUND` | Unknown or not `active` |

---

## Restaurant offers (customer)

**API name:** List restaurant offers  
**Method / path:** `GET /restaurants/:restaurantId/offers`  
**Auth:** 👤 OptAuth · customer app offer sheet / card chips  
**Who:** Customer / guest → **active** window only (`isActive` + `startDate`–`endDate`). Owner/admin see all unless `?active=true`.

**API name:** Offer detail  
**Method / path:** `GET /restaurants/:restaurantId/offers/:offerId`  
**Auth:** 👤 OptAuth. Guests: expired/inactive → `404 OFFER_NOT_FOUND`.

---

## Restaurant offers (owner)

Owner CRUD on restaurant-service. Gateway prefix `/api/v1/restaurant-service`. CSRF on POST/PUT/DELETE. `type`: `percentage` · `flat` · `free_delivery` · `bogo`. Duplicate `code` per restaurant → `409`.

**RestaurantOfferDto**

```json
{
  "_id": "66of...",
  "restaurantId": "66r1...",
  "code": "SAVE20",
  "title": "Weekend special",
  "description": "On orders above ₹299",
  "type": "percentage",
  "value": 20,
  "minOrderValue": 299,
  "maxDiscount": 100,
  "startDate": "2026-08-16T00:00:00.000Z",
  "endDate": "2026-08-31T18:29:59.999Z",
  "usageLimit": 0,
  "usageCount": 12,
  "perUserLimit": 1,
  "isActive": true,
  "applicableItems": [],
  "applicableCategories": []
}
```

`usageLimit` `0` = unlimited. Owner list is **all** offers (live, upcoming, paused). Guests still get the customer active-only list on the same GET.

### List owner offers

**API name:** List restaurant offers (owner)  
**Method / path:** `GET /restaurants/:restaurantId/offers`  
**Who:** restaurant_owner / admin. Cookie `_sid`.

### Success `200`

`{ "success": true, "message": "Offers fetched", "data": [ /* RestaurantOfferDto */ ] }`

Empty array when none exist.

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Not logged in |
| 404 | `RESTAURANT_NOT_FOUND` | Unknown outlet |

### Get owner offer

**API name:** Offer detail (owner)  
**Method / path:** `GET /restaurants/:restaurantId/offers/:offerId`  
**Who:** restaurant_owner / admin.

### Success `200`

`{ "success": true, "message": "Offer fetched", "data": { /* RestaurantOfferDto */ } }`

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `OFFER_NOT_FOUND` | Unknown id or not this restaurant |

### Create offer

**API name:** Create restaurant offer  
**Method / path:** `POST /restaurants/:restaurantId/offers`  
**Who:** restaurant_owner of this outlet / admin. CSRF.

### Request

```json
{
  "code": "SAVE20",
  "title": "Weekend special",
  "description": "On orders above ₹299",
  "type": "percentage",
  "value": 20,
  "minOrderValue": 299,
  "maxDiscount": 100,
  "startDate": "2026-08-16T00:00:00.000Z",
  "endDate": "2026-08-31T18:29:59.999Z",
  "usageLimit": 500,
  "perUserLimit": 1
}
```

`code` alphanumeric + `_` `-`, 2–30 chars. `startDate` / `endDate` required. `isActive` is **not** on create (defaults true); pause with PUT.

### Success `201`

`{ "success": true, "message": "Offer created", "data": { /* RestaurantOfferDto */ } }`

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | — | Code already exists on this restaurant |
| 400 | — | End date not after start |
| 422 | `VALIDATION_ERROR` | Missing/invalid body |
| 403 | — | Not owner of this outlet |

### Update offer

**API name:** Update restaurant offer  
**Method / path:** `PUT /restaurants/:restaurantId/offers/:offerId`  
**Who:** restaurant_owner / admin. CSRF. Partial body. Pause: `{ "isActive": false }`.

### Success `200`

`{ "success": true, "message": "Offer updated", "data": { /* RestaurantOfferDto */ } }`

### Errors

Same as create, plus `404` unknown id.

### Delete offer

**API name:** Delete restaurant offer  
**Method / path:** `DELETE /restaurants/:restaurantId/offers/:offerId`  
**Who:** restaurant_owner / admin. CSRF. Hard delete.

### Success `200`

`{ "success": true, "message": "Offer deleted", "data": null }`

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | — | Unknown id or not this restaurant |
| 403 | — | Not owner |

---

## Timings (IST)

**API name:** Restaurant timings  
**Method / path:** `GET /restaurants/:restaurantId/timings`  
**Auth:** 🔓 Public · customer + kitchen read  
**Who:** Customer app (open now banner), restaurant app (same read).

### Success response `200`

```json
{
  "success": true,
  "message": "Timings fetched",
  "data": {
    "timezone": "Asia/Kolkata",
    "isOpenNow": false,
    "nextOpenAt": "2026-08-11T05:30:00.000Z",
    "week": {
      "monday": { "isOpen": true, "slots": [{ "open": "11:00", "close": "23:00" }] },
      "tuesday": { "isOpen": true, "slots": [{ "open": "11:00", "close": "23:00" }] },
      "wednesday": { "isOpen": true, "slots": [{ "open": "11:00", "close": "23:00" }] },
      "thursday": { "isOpen": true, "slots": [{ "open": "11:00", "close": "23:00" }] },
      "friday": { "isOpen": true, "slots": [{ "open": "11:00", "close": "23:30" }] },
      "saturday": { "isOpen": true, "slots": [{ "open": "11:00", "close": "23:30" }] },
      "sunday": { "isOpen": true, "slots": [{ "open": "12:00", "close": "23:00" }] }
    },
    "holidayToday": null,
    "specialHoursToday": null,
    "holidays": [{ "date": "2026-08-15", "reason": "Independence Day" }],
    "specialHours": [{ "date": "2026-08-16", "isOpen": true, "slots": [{ "open": "11:00", "close": "15:00" }], "reason": "Festival lunch" }]
  }
}
```

`nextOpenAt` is UTC ISO for the next IST wall-clock open (skips holidays, uses special hours). `null` when `isOpenNow` or none within 60 days. `holidays` / `specialHours` are **today + upcoming** only. Priority: holiday (closed all day) > special hours > weekly `week`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `RESTAURANT_NOT_FOUND` | Unknown or not `active` |

---

## Holidays (IST)

**API name:** List restaurant holidays  
**Method / path:** `GET /restaurants/:restaurantId/holidays`  
**Auth:** 👤 OptAuth · customer sees today+upcoming; owner/admin see full list  
**Who:** Customer closed-date banner · restaurant app calendar.

### Success `200`

```json
{
  "success": true,
  "message": "Holidays fetched",
  "data": {
    "restaurantId": "66r1...",
    "timezone": "Asia/Kolkata",
    "holidays": [{ "date": "2026-08-15", "reason": "Independence Day" }]
  }
}
```

**API name:** Replace restaurant holidays  
**Method / path:** `PUT /restaurants/:restaurantId/holidays`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app hours settings. Replaces the full closed-date list **in Mongo** (`Restaurant.holidays`). Empty `dates` / `holidays` clears. Special hours on those dates are removed.

### Request

```json
{ "dates": ["2026-08-15", "2026-10-20"], "reason": "Independence Day" }
```

Per-date reasons (same replace-all):

```json
{
  "holidays": [
    { "date": "2026-08-15", "reason": "Independence Day" },
    { "date": "2026-10-20", "reason": "Diwali" }
  ]
}
```

IST `YYYY-MM-DD`, max 90, within 30 days past … 366 days ahead. Spec `{ dates, reason }` applies one reason to every date.

### Success `200`

```json
{
  "success": true,
  "message": "Holidays updated",
  "data": {
    "restaurantId": "66r1...",
    "timezone": "Asia/Kolkata",
    "holidays": [
      { "date": "2026-08-15", "reason": "Independence Day" },
      { "date": "2026-10-20", "reason": "Independence Day" }
    ]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No `_sid` |
| 403 | `FORBIDDEN` | Not owner / admin |
| 404 | `RESTAURANT_NOT_FOUND` | Bad id |
| 409 | `HOLIDAY_LIMIT` | More than 90 dates |
| 422 | `INVALID_DATE` / `VALIDATION_ERROR` | Bad or out-of-window date |

---

## Special hours (IST)

**API name:** List special hours  
**Method / path:** `GET /restaurants/:restaurantId/special-hours`  
**Auth:** 👤 OptAuth · customer: today+upcoming · owner/admin: full list from Mongo  
**Who:** Kitchen calendar editor + customer banner.

### Success `200`

```json
{
  "success": true,
  "message": "Special hours fetched",
  "data": {
    "restaurantId": "66r1...",
    "timezone": "Asia/Kolkata",
    "days": [
      {
        "date": "2026-08-16",
        "isOpen": true,
        "slots": [{ "open": "11:00", "close": "15:00" }],
        "reason": "Festival lunch"
      }
    ]
  }
}
```

**API name:** Upsert one-day special hours  
**Method / path:** `PUT /restaurants/:restaurantId/special-hours`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. Persists on `Restaurant.specialHours`. One IST calendar day override. `{ "date", "remove": true }` reverts to weekly timings. Setting special hours removes a holiday on that date.

### Request (open)

```json
{
  "date": "2026-08-16",
  "isOpen": true,
  "slots": [{ "open": "11:00", "close": "15:00" }],
  "reason": "Festival lunch"
}
```

### Request (closed that day / remove)

```json
{ "date": "2026-08-16", "isOpen": false, "slots": [] }
```

```json
{ "date": "2026-08-16", "remove": true }
```

`isOpen: true` requires at least one slot (max 3). Max 60 special-hour days.

### Success `200`

```json
{
  "success": true,
  "message": "Special hours updated",
  "data": {
    "restaurantId": "66r1...",
    "timezone": "Asia/Kolkata",
    "days": [
      {
        "date": "2026-08-16",
        "isOpen": true,
        "slots": [{ "open": "11:00", "close": "15:00" }],
        "reason": "Festival lunch"
      }
    ]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No `_sid` |
| 403 | `FORBIDDEN` | Not owner / admin |
| 404 | `RESTAURANT_NOT_FOUND` | Bad id |
| 409 | `SPECIAL_HOURS_LIMIT` | More than 60 override days |
| 422 | `INVALID_DATE` / `VALIDATION_ERROR` | Bad date / slots required when open |

---

## Hygiene / FSSAI

**API name:** Restaurant hygiene  
**Method / path:** `GET /restaurants/:restaurantId/hygiene`  
**Auth:** 🔓 Public · customer app

### Success response `200`

```json
{
  "success": true,
  "message": "Hygiene fetched",
  "data": {
    "fssaiMasked": "**********5678",
    "hygieneScore": 4.2,
    "lastAuditAt": "2026-07-01T00:00:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `RESTAURANT_NOT_FOUND` | Unknown or not `active` |

---

## Ratings histogram

**API name:** Restaurant ratings  
**Method / path:** `GET /restaurants/:restaurantId/ratings`  
**Auth:** 🔓 Public · customer + kitchen star histogram  
**Who:** Restaurant app dashboard / reviews. Listing must be `active` or `404 RESTAURANT_NOT_FOUND`.

### Success `200`

```json
{
  "success": true,
  "message": "Ratings fetched",
  "data": {
    "restaurantId": "66r1...",
    "avgRating": 4.3,
    "totalRatings": 128,
    "breakdown": { "1": 2, "2": 4, "3": 10, "4": 36, "5": 76 }
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `RESTAURANT_NOT_FOUND` | Unknown or not `active` |

---

## Unavailable items (86)

**API name:** Unavailable menu items  
**Method / path:** `GET /restaurants/:restaurantId/unavailable`  
**Auth:** 🔓 Public · customer menu grey-out

### Success response `200`

```json
{
  "success": true,
  "message": "Unavailable items fetched",
  "data": { "restaurantId": "66aa...", "itemIds": ["66mi01...", "66mi02..."] }
}
```

---

## Item customizations

**API name:** Item modifier groups  
**Method / path:** `GET /restaurants/:restaurantId/items/:itemId/customizations`  
**Auth:** 👤 OptAuth · customer customize sheet

### Success response `200`

```json
{
  "success": true,
  "message": "Customizations fetched",
  "data": {
    "itemId": "66mi...",
    "modifierGroups": [{
      "name": "Size",
      "minSelect": 1,
      "maxSelect": 1,
      "isRequired": true,
      "options": [{ "name": "Regular", "price": 0, "isDefault": true, "isAvailable": true }]
    }]
  }
}
```

`GET /restaurants/:id/items` also honours `veg`/`isVeg`, `q`/`search`, `categoryId`, `recommended`, `isBestSeller`. Non-active restaurant → `404` unless owner/admin. Guest responses hydrate `modifierGroups` from the outlet library + per-item overrides. Age-restricted SKUs are omitted unless `settings.sellsAlcohol` and the city is on the alcohol allowlist.

---

# Menu extras — modifiers, timed 86, alcohol

Gateway: `/api/v1/restaurant-service`. Owner/kitchen mutating routes: 🔑 + CSRF. Modifier library is Mongo `ModifierGroup` (max **50**/outlet, **20** options/group, **10** attached/item). `PUT …/items/:itemId/modifiers` copies a denormalized snapshot onto the item so customer `GET /menu` stays join-free. Library `PUT`/`DELETE` refreshes or detaches those snapshots.

## List modifier groups

**API name:** List modifier groups  
**Method / path:** `GET /restaurants/:restaurantId/modifier-groups`  
**Auth:** 🔑 🏪 owner / admin  
**Who:** Restaurant app variant editor.

### Success `200`

```json
{
  "success": true,
  "message": "Modifier groups fetched",
  "data": [{
    "_id": "66mg...",
    "restaurantId": "66r1...",
    "name": "Size",
    "description": null,
    "minSelect": 1,
    "maxSelect": 1,
    "isRequired": true,
    "sortOrder": 0,
    "options": [
      { "_id": "66opt1...", "name": "Regular", "price": 0, "isDefault": true, "isAvailable": true },
      { "_id": "66opt2...", "name": "Large", "price": 40, "isDefault": false, "isAvailable": true }
    ]
  }]
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No `_sid` |
| 403 | `FORBIDDEN` | Not owner / admin |
| 404 | `RESTAURANT_NOT_FOUND` | Bad id |

---

## Create modifier group

**API name:** Create modifier group  
**Method / path:** `POST /restaurants/:restaurantId/modifier-groups`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app.

### Request

```json
{
  "name": "Crust",
  "description": "Base style",
  "minSelect": 1,
  "maxSelect": 1,
  "isRequired": true,
  "sortOrder": 1,
  "options": [
    { "name": "Thin", "price": 0, "isDefault": true },
    { "name": "Cheese burst", "price": 60 }
  ]
}
```

`isRequired: true` forces `minSelect >= 1`. Max **50** groups per outlet.

### Success `201`

Same DTO as list (single object). Message: `Modifier group created`.

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No `_sid` |
| 403 | `FORBIDDEN` | Not owner / admin |
| 409 | `MODIFIER_LIMIT` | More than 50 groups |
| 422 | `VALIDATION_ERROR` | Bad options / `maxSelect < minSelect` |

---

## Update modifier group

**API name:** Update modifier group  
**Method / path:** `PUT /restaurants/:restaurantId/modifier-groups/:groupId`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. Replaces fields; if `options` is sent, include existing `_id`s to keep item price overrides.

### Success `200`

Message: `Modifier group updated`. Attached item snapshots are refreshed.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `MODIFIER_GROUP_NOT_FOUND` | Unknown / other outlet |
| 403 | `FORBIDDEN` | Not owner / admin |
| 422 | `VALIDATION_ERROR` | Zod |

---

## Delete modifier group

**API name:** Delete modifier group  
**Method / path:** `DELETE /restaurants/:restaurantId/modifier-groups/:groupId`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. Detaches the group from all items then deletes the library row.

### Success `200`

```json
{ "success": true, "message": "Modifier group deleted" }
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `MODIFIER_GROUP_NOT_FOUND` | Unknown / other outlet |
| 403 | `FORBIDDEN` | Not owner / admin |

---

## Attach item modifiers

**API name:** Attach modifiers to item  
**Method / path:** `PUT /restaurants/:restaurantId/items/:itemId/modifiers`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. Max **10** groups per item. Unknown `groupId` → `404 MODIFIER_GROUP_NOT_FOUND`.

### Request

```json
{
  "attachments": [
    {
      "groupId": "66mg...",
      "options": [
        { "optionId": "66opt2...", "price": 50, "isAvailable": true }
      ]
    }
  ]
}
```

Empty `attachments: []` clears all groups on the item.

### Success `200`

```json
{
  "success": true,
  "message": "Item modifiers updated",
  "data": {
    "itemId": "66mi...",
    "modifierGroups": [{
      "_id": "66mg...",
      "name": "Size",
      "description": null,
      "minSelect": 1,
      "maxSelect": 1,
      "isRequired": true,
      "sortOrder": 0,
      "options": [
        { "_id": "66opt1...", "name": "Regular", "price": 0, "isDefault": true, "isAvailable": true },
        { "_id": "66opt2...", "name": "Large", "price": 50, "isDefault": false, "isAvailable": true }
      ]
    }]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `MENU_ITEM_NOT_FOUND` / `MODIFIER_GROUP_NOT_FOUND` | Bad item or group |
| 409 | `MODIFIER_LIMIT` | More than 10 attached groups |
| 403 | `FORBIDDEN` | Not owner / admin |

---

## Timed 86 (availability)

**API name:** Toggle item availability  
**Method / path:** `PUT /restaurants/:restaurantId/items/:itemId/availability`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Kitchen 86 board. `isAvailable` **or** `available`. Timed 86: `unavailableUntil` (ISO / parseable future instant) + optional `reason` (max 120). When `isAvailable: true`, until/reason are cleared and notify-stock fires. Expired timed 86 is lazy-cleared on menu/item/unavailable/search reads.

### Request (until closing)

```json
{
  "isAvailable": false,
  "unavailableUntil": "2026-08-10T18:30:00.000Z",
  "reason": "sold_out"
}
```

### Request (indefinite 86 / back in stock)

```json
{ "isAvailable": false, "reason": "86 until tomorrow" }
```

```json
{ "isAvailable": true }
```

### Success `200`

Message: `Item marked as available` / `Item marked as unavailable`. Item DTO includes `isAvailable`, `unavailableUntil`, `unavailableReason`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `MENU_ITEM_NOT_FOUND` | Bad item |
| 422 | `VALIDATION_ERROR` | Missing flag, or `unavailableUntil` not in the future |
| 403 | `FORBIDDEN` | Not owner / admin |

---

## Update menu item (dietary / age / prep)

**API name:** Update menu item  
**Method / path:** `PUT /restaurants/:restaurantId/items/:itemId`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. Extends existing item PATCH with:

| Field | Type | Notes |
|---|---|---|
| `isAgeRestricted` | boolean | 18+ / alcohol SKU. Hidden from guests unless outlet `sellsAlcohol` + city allowlist |
| `dietaryFlags` | `("vegan"\|"jain"\|"gluten_free"\|"nut_free"\|"dairy_free"\|"eggless"\|"halal"\|"keto")[]` | Also sets `isVegan` / `isJain` / `isGlutenFree` when those flags are present |
| `spiceLevel` | `none` \| `mild` \| `medium` \| `hot` \| `extra_hot` | |
| `prepMinutes` | 1–180 | Item-level prep hint |

### Request

```json
{
  "isAgeRestricted": true,
  "dietaryFlags": ["gluten_free"],
  "spiceLevel": "hot",
  "prepMinutes": 18
}
```

### Success `200`

Message: `Menu item updated`. Hydrated `modifierGroups` included.

---

## Update settings — sellsAlcohol

**API name:** Update restaurant settings  
**Method / path:** `PUT /restaurants/:restaurantId/settings`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. `sellsAlcohol: true` only if outlet city is on the platform allowlist (dry states excluded). Guest nearby cards expose `sellsAlcohol`.

### Request

```json
{ "sellsAlcohol": true }
```

### Success `200`

Message: `Settings updated`. Restaurant doc with `settings.sellsAlcohol`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `ALCOHOL_NOT_ALLOWED_IN_CITY` | City not on allowlist |
| 403 | `FORBIDDEN` | Not owner / admin |
| 404 | `RESTAURANT_NOT_FOUND` | Bad id |

---

# Restaurant photos — cover & gallery

Gateway: `/api/v1/restaurant-service`. **Who:** restaurant app Photos tab · 🔑 `_sid` owner / admin · CSRF. JPEG / PNG / WebP only, **5 MB** each. Cover and logo use multer field **`photo`**. Gallery uses **`photos`** (max 10 files). Gallery is stored as URL strings on the restaurant doc.

## Upload cover

**API name:** Upload restaurant cover  
**Method / path:** `POST /restaurants/:restaurantId/cover`  
**Auth:** 🔑 owner / admin · CSRF · `multipart/form-data`  
**Who:** Kitchen app — customer search / restaurant-page banner.

### Request

Field **`photo`** (single file). Replaces the previous cover in Cloudinary.

### Success `200`

```json
{
  "success": true,
  "message": "Cover image uploaded",
  "data": {
    "_id": "66r1...",
    "name": "Pizza Hut Dwarka",
    "coverImage": "https://res.cloudinary.com/.../cover.jpg",
    "logo": "https://res.cloudinary.com/.../logo.jpg",
    "images": ["https://res.cloudinary.com/.../1.jpg"]
  }
}
```

`data` is the restaurant document. App maps `coverImage` → `coverUrl`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | — | No file, or not JPEG/PNG/WebP |
| 401 | `UNAUTHORIZED` | No `_sid` |
| 403 | `FORBIDDEN` | Not owner / admin |
| 404 | `RESTAURANT_NOT_FOUND` | Bad id |
| 413 | — | File over 5 MB |

---

## Upload gallery photos

**API name:** Upload restaurant gallery  
**Method / path:** `POST /restaurants/:restaurantId/images`  
**Auth:** 🔑 owner / admin · CSRF · `multipart/form-data`  
**Who:** Kitchen app outlet photo grid.

### Request

Field **`photos`** (1–10 files). Optional query `type=gallery` (default). Each file is pushed onto `images[]`.

### Success `200`

```json
{
  "success": true,
  "message": "Images uploaded",
  "data": {
    "_id": "66r1...",
    "images": [
      "https://res.cloudinary.com/.../1.jpg",
      "https://res.cloudinary.com/.../2.jpg"
    ]
  }
}
```

### Errors

Same as cover (`400` no files / bad type, `413` over 5 MB).

---

## Remove gallery photo

**API name:** Remove restaurant gallery image  
**Method / path:** `DELETE /restaurants/:restaurantId/images/:imageId`  
**Auth:** 🔑 owner / admin · CSRF  
**Who:** Kitchen app delete on a gallery tile.

`:imageId` is a path token (Cloudinary filename is fine). Removal uses the JSON body URL — gallery rows are strings, not subdocuments.

### Request

```json
{ "imageUrl": "https://res.cloudinary.com/.../1.jpg" }
```

### Success `200`

```json
{
  "success": true,
  "message": "Image removed",
  "data": {
    "_id": "66r1...",
    "images": ["https://res.cloudinary.com/.../2.jpg"]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No `_sid` |
| 403 | `FORBIDDEN` | Not owner / admin |
| 404 | `RESTAURANT_NOT_FOUND` | Bad id |
| 422 | `VALIDATION_ERROR` | Missing or invalid `imageUrl` |

---

## Kitchen menu search

**API name:** Search own SKUs  
**Method / path:** `GET /restaurants/:restaurantId/menu/search?q=`  
**Auth:** 🔑 🏪 owner / admin  
**Who:** Kitchen 86 search. `q` required, 1–100 chars. Matches name / description / tags (max 50). Expires timed 86 first.

### Success `200`

```json
{
  "success": true,
  "message": "Menu search results",
  "data": [{ "_id": "66mi...", "name": "Paneer tikka", "isAvailable": false, "unavailableUntil": "2026-08-10T18:30:00.000Z" }]
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Missing / empty `q` |
| 403 | `FORBIDDEN` | Not owner / admin |

---

## Bulk price update

**API name:** Bulk update item prices  
**Method / path:** `POST /restaurants/:restaurantId/items/bulk-price`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. Max 200 rows. `discountedPrice: null` unsets discount.

### Request

```json
{
  "updates": [
    { "itemId": "66mi01...", "price": 249, "discountedPrice": 199 },
    { "itemId": "66mi02...", "price": 99, "discountedPrice": null }
  ]
}
```

### Success `200`

```json
{ "success": true, "message": "2 prices updated", "data": { "updated": 2 } }
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `MENU_ITEM_NOT_FOUND` | Any `itemId` not on this outlet |
| 422 | `VALIDATION_ERROR` | Discount ≥ price / empty list |

---

# Chain / multi-outlet APIs

Same `ownerId` = chain. SKUs matched by name (optional category). No Brand Mongo collection — per-outlet docs with remapped IDs. Max **20** targets. Redis menu/restaurant cache invalidated per affected outlet.

## List chain siblings

**API name:** List sibling outlets  
**Method / path:** `GET /restaurants/:restaurantId/chain/siblings`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app outlet picker before bulk sync.

### Success `200`

```json
{
  "success": true,
  "message": "Chain siblings fetched",
  "data": [
    {
      "restaurantId": "66r1...",
      "name": "Burger Hub — Koramangala",
      "status": "active",
      "isOnline": true,
      "city": "Bengaluru",
      "isSource": true
    },
    {
      "restaurantId": "66r2...",
      "name": "Burger Hub — Indiranagar",
      "status": "active",
      "isOnline": false,
      "city": "Bengaluru",
      "isSource": false
    }
  ]
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `RESTAURANT_NOT_FOUND` | Source missing |
| 403 | `FORBIDDEN` | Not owner / admin |

---

## Clone menu to outlets

**API name:** Clone menu across chain  
**Method / path:** `POST /restaurants/:restaurantId/chain/clone-menu`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. `merge` skips same name+category; `replace` clears target categories/items/modifier groups first. Optional `itemIds` subset (max 500). Remaps modifier group + option IDs.

### Request

```json
{
  "targetRestaurantIds": ["66r2...", "66r3..."],
  "mode": "merge",
  "itemIds": ["66mi01..."]
}
```

### Success `200`

```json
{
  "success": true,
  "message": "Menu cloned to outlets",
  "data": {
    "sourceRestaurantId": "66r1...",
    "targets": [
      {
        "restaurantId": "66r2...",
        "name": "Burger Hub — Indiranagar",
        "categoriesCreated": 4,
        "categoriesReused": 1,
        "groupsCreated": 2,
        "itemsCreated": 48,
        "itemsSkipped": 3,
        "cleared": false
      }
    ]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `RESTAURANT_NOT_FOUND` | Source or target missing |
| 403 | `CHAIN_OWNER_MISMATCH` | Target not same owner |
| 403 | `FORBIDDEN` | Not owner / admin |
| 422 | `CHAIN_TARGET_LIMIT` / `CHAIN_ITEM_LIMIT` / `VALIDATION_ERROR` | Caps / empty targets |

---

## Apply prices across outlets

**API name:** Apply prices to chain siblings  
**Method / path:** `POST /restaurants/:restaurantId/chain/apply-prices`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. Match SKUs with `matchBy: name | name_and_category` (default `name_and_category`). Optional `itemIds` (max 200).

### Request

```json
{
  "targetRestaurantIds": ["66r2..."],
  "matchBy": "name_and_category",
  "itemIds": ["66mi01...", "66mi02..."]
}
```

### Success `200`

```json
{
  "success": true,
  "message": "Prices applied to outlets",
  "data": {
    "sourceRestaurantId": "66r1...",
    "matchBy": "name_and_category",
    "targets": [
      {
        "restaurantId": "66r2...",
        "name": "Burger Hub — Indiranagar",
        "matched": 2,
        "updated": 2,
        "unmatched": [{ "name": "Seasonal Wrap", "categoryName": "Wraps" }]
      }
    ]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `RESTAURANT_NOT_FOUND` | Source / target |
| 403 | `CHAIN_OWNER_MISMATCH` / `FORBIDDEN` | Ownership |
| 422 | `CHAIN_TARGET_LIMIT` / `CHAIN_ITEM_LIMIT` | Caps |

---

## Apply availability (86) across outlets

**API name:** Apply availability to chain siblings  
**Method / path:** `POST /restaurants/:restaurantId/chain/apply-availability`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app — 86 a dish at all branches. Source item list defines which names to match; `isAvailable` + optional timed 86 applied to hits.

### Request

```json
{
  "targetRestaurantIds": ["66r2...", "66r3..."],
  "matchBy": "name",
  "itemIds": ["66mi01..."],
  "isAvailable": false,
  "unavailableUntil": "2026-08-11T18:30:00.000Z",
  "reason": "sold_out"
}
```

### Success `200`

```json
{
  "success": true,
  "message": "Availability applied to outlets",
  "data": {
    "sourceRestaurantId": "66r1...",
    "matchBy": "name",
    "isAvailable": false,
    "targets": [
      {
        "restaurantId": "66r2...",
        "name": "Burger Hub — Indiranagar",
        "matched": 1,
        "updated": 1,
        "unmatched": []
      }
    ]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `RESTAURANT_NOT_FOUND` | Source / target |
| 403 | `CHAIN_OWNER_MISMATCH` / `FORBIDDEN` | Ownership |
| 422 | `VALIDATION_ERROR` | `unavailableUntil` not in the future |
| 422 | `CHAIN_TARGET_LIMIT` / `CHAIN_ITEM_LIMIT` | Caps |

---

## Apply settings across outlets

**API name:** Apply settings to chain siblings  
**Method / path:** `PUT /restaurants/:restaurantId/chain/apply-settings`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. Syncable keys only: `taxRate`, `packagingCharge`, `minimumOrderValue`, `freeDeliveryThreshold`, `maxDeliveryRadius`, `avgPrepTime`, `autoAcceptOrders`, `acceptScheduledOrders`, `isPureVeg`, `isCashOnDelivery`, `isOnlinePayment`, `acceptsPreOrders`, `sellsAlcohol`. Never commission. `sellsAlcohol: true` re-validated per target city.

### Request

```json
{
  "targetRestaurantIds": ["66r2..."],
  "copyFromSource": true
}
```

Or patch:

```json
{
  "targetRestaurantIds": ["66r2..."],
  "settings": { "minimumOrderValue": 149, "isCashOnDelivery": true }
}
```

### Success `200`

```json
{
  "success": true,
  "message": "Settings applied to outlets",
  "data": {
    "sourceRestaurantId": "66r1...",
    "appliedKeys": ["minimumOrderValue", "isCashOnDelivery"],
    "targets": [
      { "restaurantId": "66r2...", "name": "Burger Hub — Indiranagar", "applied": true }
    ]
  }
}
```

Per-target soft failure example: `{ "applied": false, "error": "ALCOHOL_NOT_ALLOWED_IN_CITY" }`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `RESTAURANT_NOT_FOUND` | Source / target |
| 403 | `CHAIN_OWNER_MISMATCH` / `FORBIDDEN` | Ownership |
| 422 | `VALIDATION_ERROR` | Neither `copyFromSource` nor `settings` |

---

## Reorder items

**API name:** Reorder items in category  
**Method / path:** `PUT /restaurants/:restaurantId/items/reorder`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app drag-and-drop. All ids must share one category (`categoryId` optional if inferred).

### Request

```json
{ "itemIds": ["66mi03...", "66mi01...", "66mi02..."], "categoryId": "66cat..." }
```

### Success `200`

```json
{ "success": true, "message": "Items reordered" }
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `MENU_ITEM_NOT_FOUND` | Unknown id |
| 422 | `VALIDATION_ERROR` | Mixed categories / empty list |

---

## Duplicate item

**API name:** Clone menu item  
**Method / path:** `POST /restaurants/:restaurantId/items/:itemId/duplicate`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. Copies modifiers, dietary flags, image URL, prep. Name becomes `{name} (copy)`. `isNew: true`, recommended/bestseller off. Sort order = last in category + 1.

### Success `201`

Message: `Item duplicated`. Full item DTO.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `MENU_ITEM_NOT_FOUND` | Bad item |
| 403 | `FORBIDDEN` | Not owner / admin |

---

## Delete item image

**API name:** Remove item photo  
**Method / path:** `DELETE /restaurants/:restaurantId/items/:itemId/image`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. Deletes Cloudinary asset when present and `$unset`s `image`.

### Success `200`

Message: `Item image removed`. Item DTO without `image`.

---

## Category meal schedule

**API name:** Set category schedule  
**Method / path:** `PUT /restaurants/:restaurantId/categories/:categoryId/schedule`  
**Auth:** 🔑 🏪 owner / admin · CSRF  
**Who:** Restaurant app. IST `HH:MM` windows (overnight OK). Optional `days` (`monday`…`sunday`). Empty `periods: []` clears schedule (category always visible if active). Guest `GET /menu` and `GET /categories` hide off-window categories. First period is also copied to legacy `availableFrom` / `availableTo`.

### Request

```json
{
  "periods": [
    { "meal": "breakfast", "from": "07:00", "to": "11:00", "days": ["monday", "tuesday", "wednesday", "thursday", "friday"] },
    { "meal": "lunch", "from": "12:00", "to": "16:00" },
    { "meal": "dinner", "from": "19:00", "to": "23:30" },
    { "meal": "late_night", "from": "23:30", "to": "02:00" }
  ]
}
```

### Success `200`

Message: `Category schedule updated`. Category DTO includes `schedule`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `CATEGORY_NOT_FOUND` | Bad category |
| 422 | `VALIDATION_ERROR` | Bad `HH:MM` / meal / weekday |
| 403 | `FORBIDDEN` | Not owner / admin |

---

# Notify me — reopen / back in stock

Gateway: `/api/v1/restaurant-service` (subscribe) · `/api/v1/customer-service` (list). Auth: 🔑 + CSRF on POST/DELETE. One-shot: when kitchen goes online or item is available again, restaurant-service creates a real notification-service inbox row (`type: system`, `targetRole: customer`) then deactivates the subscription. If notification-service is down, `pushed` stays false and the subscription **remains active** for retry — never fake `pushed: true`. Rate: **30 subscribe attempts / user / hour**.

## Subscribe reopen

**API name:** Notify when kitchen reopens  
**Method / path:** `POST /restaurants/:restaurantId/notify-open`  
**Who:** Customer app. Empty body.

Subscribe only when the outlet is **not** already taking orders (`isOnline` + IST open now). Already open → `404 ALERT_NOT_NEEDED`. Already subscribed → `200` idempotent.

### Success `201` (new) / `200` (idempotent)

```json
{
  "success": true,
  "message": "Alert subscribed",
  "data": {
    "restaurantId": "66aa...",
    "kind": "reopen",
    "active": true,
    "createdAt": "2026-08-10T12:00:00.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No `_sid` |
| 404 | `RESTAURANT_NOT_FOUND` | Unknown / not active |
| 404 | `ALERT_NOT_NEEDED` | Already online + open now |
| 429 | `ALERT_RATE_LIMITED` | > 30 / hour |

---

## Unsubscribe reopen

**API name:** Unsubscribe reopen  
**Method / path:** `DELETE /restaurants/:restaurantId/notify-open`  
**Who:** Customer app. Idempotent `200` even if none existed.

```json
{ "success": true, "message": "Alert unsubscribed", "data": { "restaurantId": "66aa...", "kind": "reopen", "active": false, "createdAt": "…" } }
```

---

## Subscribe back in stock

**API name:** Notify when item is back  
**Method / path:** `POST /restaurants/:restaurantId/items/:itemId/notify-stock`  
**Who:** Customer app. Item must currently be 86’d (incl. active timed 86). In stock / expired until → `404 ALERT_NOT_NEEDED`.

### Success `201` / `200`

```json
{
  "success": true,
  "message": "Alert subscribed",
  "data": {
    "restaurantId": "66aa...",
    "itemId": "66mi...",
    "kind": "back_in_stock",
    "active": true,
    "createdAt": "2026-08-10T12:00:00.000Z"
  }
}
```

---

## Unsubscribe back in stock

**API name:** Unsubscribe stock  
**Method / path:** `DELETE /restaurants/:restaurantId/items/:itemId/notify-stock`  
**Who:** Customer app. Idempotent.

---

## My alerts

**API name:** List notify-me subscriptions  
**Method / path:** `GET /customers/me/alerts` (customer-service) · also `GET /alerts/me` (restaurant-service)  
**Who:** Customer app. Customer-service proxies `GET restaurant-service /internal/alerts?userId=` (`x-internal-key`). If restaurant-service is down → `503 RESTAURANT_SERVICE_UNAVAILABLE` (never fake `[]`).

### Success `200`

```json
{
  "success": true,
  "message": "Alerts fetched",
  "data": {
    "restaurants": [{ "restaurantId": "66aa...", "kind": "reopen", "createdAt": "2026-08-10T12:00:00.000Z" }],
    "items": [{ "restaurantId": "66aa...", "itemId": "66mi...", "kind": "back_in_stock", "createdAt": "2026-08-10T12:05:00.000Z" }]
  }
}
```

---

## Internal: fire subscribers

**API name:** Fire notify-me pushes  
**Method / path:** `POST /internal/notify-subscribers`  
**Who:** Internal / cron. Also invoked automatically when owner goes **online** or marks an item **available**. Auth: `x-internal-key`.

### Request

```json
{ "restaurantId": "66aa...", "kind": "reopen" }
```

```json
{ "restaurantId": "66aa...", "itemId": "66mi...", "kind": "back_in_stock" }
```

### Success `200`

```json
{
  "success": true,
  "message": "Subscribers notified",
  "data": {
    "kind": "reopen",
    "restaurantId": "66aa...",
    "attempted": 12,
    "pushed": 11,
    "failed": 1,
    "degradedReason": "NOTIFICATION_SERVICE_UNAVAILABLE"
  }
}
```

`pushed` counts only notification-service `201`. Failed users stay subscribed.

---

# Restaurant Fleet APIs

Restaurant-owned rider fleet (invite → register-with-invite → roster). Service: **delivery-service**. Gateway: `/api/v1/delivery-service`. Auth: 🔑 + 🏪 `restaurant_owner` (or admin). **Owner/manager only** — verified against restaurant-service `GET /internal/restaurants/:id/access?userId=` (cached 60s). Never fake allow if restaurant-service is down (`503 RESTAURANT_SERVICE_UNAVAILABLE`). Kitchen staff may use assigned-partner tracking, not fleet invite/roster.

Invites persist as `PartnerInvitation` (72h, max **20 / hour** per restaurant). Duplicate pending phone → `409 INVITE_ALREADY_PENDING`. Share `inviteUrl` (token is not listed separately). Fleet partner DTOs omit bank, PAN, KYC, and cash-in-hand.

---

## Create invitation

**API name:** Invite fleet rider  
**Method / path:** `POST /restaurant/:restaurantId/invitations`  
**Who:** Owner / manager. CSRF.

### Request

```json
{ "name": "Amit Kumar", "phone": "9876543210", "email": "amit@example.com" }
```

### Success response `201`

```json
{
  "success": true,
  "message": "Invitation created",
  "data": {
    "invitationId": "66fd...",
    "restaurantId": "66aa...",
    "name": "Amit Kumar",
    "phone": "9876543210",
    "email": "amit@example.com",
    "status": "pending",
    "inviteUrl": "https://partner.fooddelivery.app/invite?token=a1b2...",
    "expiresAt": "2026-08-12T06:40:00.000Z",
    "acceptedAt": null,
    "partnerId": null,
    "createdAt": "2026-08-09T06:40:00.000Z"
  }
}
```

Rider opens `inviteUrl` → `GET /partners/invite/validate?token=` → `POST /partners/register-with-invite`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `RESTAURANT_NOT_FOUND` | Unknown restaurant |
| 403 | `FORBIDDEN` | Not owner/manager |
| 409 | `INVITE_ALREADY_PENDING` | Same phone already pending |
| 429 | `INVITE_RATE_LIMITED` | > 20 / hour |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` | Ownership check failed |

---

## List invitations

**API name:** List fleet invitations  
**Method / path:** `GET /restaurant/:restaurantId/invitations`  
**Who:** Owner / manager. Query `?status=pending|accepted|expired|cancelled`.

### Success response `200`

Array of **RestaurantInvitationDto**. Stale pending rows are marked `expired` on read. `inviteUrl` is set only while `pending`.

### Errors

Same ownership errors as create.

---

## Cancel invitation

**API name:** Cancel pending invite  
**Method / path:** `DELETE /restaurant/:restaurantId/invitations/:invitationId`  
**Who:** Owner / manager. CSRF.

### Success response `200`

**RestaurantInvitationDto** with `"status": "cancelled"`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `INVITE_NOT_FOUND` | Missing or already accepted/cancelled |
| 403 | `FORBIDDEN` | Not owner/manager |

---

## List restaurant partners

**API name:** Fleet roster  
**Method / path:** `GET /restaurant/:restaurantId/partners`  
**Who:** Owner / manager. Query `?status=&isOnline=&search=`.

### Success response `200`

Array of **RestaurantFleetPartnerDto**: `partnerId`, `partnerCode`, name, phone, vehicle, `status`, `dutyStatus`, online/available, ratings, delivery counts, `profilePhoto`. **No** bank / KYC / cash-in-hand.

### Errors

Same ownership errors as create.

---

## Get restaurant partner

**API name:** Fleet partner detail  
**Method / path:** `GET /restaurant/:restaurantId/partners/:partnerId`  
**Who:** Owner / manager.

### Success response `200`

**RestaurantFleetPartnerDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PARTNER_NOT_FOUND` | Unknown id |
| 403 | `FORBIDDEN` | Not this restaurant’s fleet / not owner |

---

## Toggle fleet partner status

**API name:** Toggle fleet partner status  
**Method / path:** `PUT /restaurant/:restaurantId/partners/:partnerId/status`  
**Who:** Owner / manager. CSRF.

### Request

```json
{ "action": "suspend", "reason": "Repeated late pickups this week" }
```

`action`: `activate` | `deactivate` | `suspend`. `reason` (min 8 chars) required for deactivate/suspend. Activate only from `deactivated`/`suspended` after KYC — never stamps `verifiedAt`. Deactivate/suspend forces offline. Idempotent if already in the target status.

### Success response `200`

**RestaurantFleetPartnerDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `PARTNER_KYC_PENDING` | Still `pending` / `under_review` |
| 409 | `PARTNER_ON_DELIVERY` | Rider is on a live trip |
| 409 | `ILLEGAL_TRANSITION` | Status cannot move this way |
| 422 | `REASON_REQUIRED` | Missing reason on deactivate/suspend |
| 403 | `FORBIDDEN` | Not this restaurant’s fleet / not owner |

---

## Available fleet partners nearby

**API name:** Nearby available fleet  
**Method / path:** `GET /restaurant/:restaurantId/available-partners`  
**Who:** Owner / manager.

### Request

Query `?lat=&lng=&radiusKm=` (all optional). Missing lat/lng → restaurant pin from restaurant-service. Default radius **5 km**, max **15 km**. Fleet only: `active` + online + available with live GPS.

### Success response `200`

Array of **RestaurantAvailablePartnerDto** (fleet DTO + `distanceKm`). Empty list if no GPS pings — never fake riders.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_LOCATION` | No query pin and restaurant pin unavailable |
| 403 | `FORBIDDEN` | Not owner/manager |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` | Ownership check failed |

---

## Manual assign fleet partner

**API name:** Restaurant manual assign  
**Method / path:** `POST /restaurant/:restaurantId/orders/:orderId/manual-assign`  
**Who:** Owner / manager. CSRF.

### Request

```json
{ "partnerId": "66aa..." }
```

Order must belong to this restaurant, `deliveryType` ≠ pickup, status `accepted` | `preparing` | `ready`. Partner must be this restaurant’s fleet, `active`, online, not on break. Fetches drop pin + fee + COD from order-service `GET /orders/internal/batch`. Creates a real **Delivery** + rider offer via dispatch (pre-pickup reassign allowed; post-pickup → `409 ILLEGAL_TRANSITION`). Never fake `assigned`.

### Success response `201`

**DispatchAssignDto** (`deliveryId`, `orderId`, `partnerId`, `partnerName`, `status`, `mode: "manual"`, `timeoutSeconds`, `offeredTo`).

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `ORDER_NOT_FOUND` / `PARTNER_NOT_FOUND` | Unknown order or rider |
| 409 | `ORDER_NOT_DELIVERY` | Pickup order |
| 409 | `ORDER_NOT_ASSIGNABLE` | Wrong order status |
| 409 | `ORDER_PIN_MISSING` / `RESTAURANT_PIN_MISSING` | Missing coordinates |
| 409 | `PARTNER_NOT_ACTIVE` / `PARTNER_OFFLINE` / `PARTNER_ON_BREAK` / `PARTNER_NOT_AVAILABLE` | Rider not eligible |
| 409 | `DELIVERY_CAPACITY_FULL` / `COD_LIMIT_EXCEEDED` | Same as platform assign |
| 409 | `ILLEGAL_TRANSITION` | Already picked up |
| 403 | `FORBIDDEN` | Order or rider not this restaurant |
| 503 | `ORDER_SERVICE_UNAVAILABLE` | Order fetch failed |

---

## Rate partner pickup

**API name:** Rate pickup experience  
**Method / path:** `POST /restaurant/:restaurantId/orders/:orderId/rate-partner`  
**Who:** Owner / manager / kitchen / cashier of that store. CSRF. Max **30 / hour** per restaurant.

### Request

```json
{ "stars": 5, "comment": "Arrived quickly, handled bags well", "partnerId": "66aa..." }
```

`partnerId` optional (must match assigned rider if sent). Allowed after rider `arrived_at_restaurant` (pickup experience) — not only after `delivered`. Unique `deliveryId` + `source=restaurant`. Same stars again → 201 idempotent.

### Success response `201`

**PartnerRatingDto** (`ratingId`, `deliveryId`, `orderId`, `stars`, `comment`, `source: "restaurant"`, `reviewerMasked`, `createdAt`). Recalculates partner `avgRating` / `ratingCount`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | No delivery for this order |
| 409 | `DELIVERY_NOT_RATEABLE` | Rider has not reached the store yet |
| 409 | `RATING_ALREADY_SUBMITTED` | Already rated this pickup |
| 409 | `PARTNER_MISMATCH` | `partnerId` ≠ assigned rider |
| 429 | `RATING_RATE_LIMITED` | > 30 / hour |
| 403 | `FORBIDDEN` | Not kitchen access for this store |

---

# Rider Notification APIs

Rider inbox, channel prefs, device tokens, and admin test push. Service: **delivery-service**. Inbox rows live in **notification-service** (never a stub ledger). **503 `NOTIFICATION_SERVICE_UNAVAILABLE`** if that service is down. Device tokens persist as `PartnerDevice` (token masked in responses). Prefs persist on the partner. Gateway: `/api/v1/delivery-service`. Auth: 🔑 + 🚴 (test is admin). CSRF on mutating.

Aliases under `/notifications/*` share the same handlers.

---

## List notifications

**API name:** Rider inbox  
**Method / path:** `GET /partners/me/notifications` · alias `GET /notifications`  
**Who:** Rider.

Query: `page`, `limit`, `unread=true`.

### Success `200`

**PartnerNotificationListDto**: `notifications[]` (`notificationId`, `type`, `title`, `message`, `data`, `isRead`, `isBroadcast`, `createdAt`), `total`, `page`, `limit`, `totalPages`, `unreadCount`.

---

## Mark read / read-all / delete / unread-count

| Method / path | Alias | Success |
|---|---|---|
| `PUT /partners/me/notifications/:notificationId/read` | `PUT /notifications/read/:notificationId` | **PartnerNotificationDto** |
| `PUT /partners/me/notifications/read-all` | `PUT /notifications/read-all` | `{ modified }` |
| `DELETE /notifications/:notificationId` | — | `{ deleted: true }` |
| `GET /notifications/unread-count` | — | `{ count }` |

Errors: `404 NOTIFICATION_NOT_FOUND`, `503 NOTIFICATION_SERVICE_UNAVAILABLE`.

---

## Notification preferences

**Method / path:** `GET` / `PUT /partners/me/notifications/preferences` · alias `PUT /notifications/settings`  
**Who:** Rider.

```json
{ "push": true, "sms": true, "email": true, "whatsapp": false }
```

PUT accepts any subset. Defaults: push/sms/email on, WhatsApp off.

---

## Register / remove device

**Method / path:** `POST /partners/me/devices/register` · alias `POST /notifications/device-token`  
**Who:** Rider. CSRF.

```json
{ "platform": "android", "token": "fcm-or-apns-token", "deviceId": "client-uuid", "appVersion": "1.4.0" }
```

`platform`: `ios` \| `android` \| `web`. Upserts by `deviceId` or token.

### Success `201`

**PartnerDeviceDto**: `deviceId`, `platform`, `tokenMasked`, `clientDeviceId`, `appVersion`, `lastSeenAt`, `createdAt`.

`DELETE /partners/me/devices/:deviceId` → `{ deleted: true }` or `404 DEVICE_NOT_FOUND`.

---

## Admin test notification

**Method / path:** `POST /notifications/test`  
**Who:** Admin. CSRF. Max **10 / hour**.

```json
{ "partnerId": "66a9...", "title": "Test", "message": "Inbox check" }
```

Creates a real notification-service row + emits `notification:new`. `pushed: false` + `degradedReason` if notification-service is down — **never fake delivered**.

---

# Training APIs

Mandatory/optional rider training with quiz + certificates. Service: **delivery-service**. Auth: 🔑 + 🚴. CSRF on complete. Modules seed into Mongo on first read (safety, app usage, hygiene, food handling). GET never returns quiz answer keys. Complete without every answer → `422 QUIZ_INCOMPLETE`. Score below passing → status `failed` (retry, max 10). Pass issues `TC-YYYYMMDD-XXXX`. Already passed → idempotent 200 with existing certificate.

---

## List / get modules

**Method / path:** `GET /partners/me/training/modules` · `GET /partners/me/training/modules/:moduleId`  
**Who:** Rider. `:moduleId` is Mongo id or `code`.

List item: `moduleId`, `code`, `title`, `category`, `summary`, `durationMinutes`, `passingScore`, `mandatory`, `lessonCount`, `quizCount`, `status` (`assigned` \| `in_progress` \| `completed` \| `failed`), `score`, `attempts`, `completedAt`, `certificateId`.

Detail adds `lessons[]` and `quiz[]` (`id`, `question`, `options` only).

---

## Complete module

**Method / path:** `POST /partners/me/training/modules/:moduleId/complete`  
**Who:** Rider. CSRF.

```json
{ "answers": [{ "questionId": "s1", "optionIndex": 1 }, { "questionId": "s2", "optionIndex": 1 }] }
```

### Success `200`

**CompleteTrainingDto**: `passed`, `score`, `passingScore`, `attempts`, `status`, `certificate` (or null), `incorrect[]` (`questionId`, `correctIndex` only when failed).

| HTTP | code | When |
|---|---|---|
| 404 | `MODULE_NOT_FOUND` | Unknown module |
| 422 | `QUIZ_INCOMPLETE` | Missing / invalid answers |
| 429 | `TRAINING_ATTEMPTS_EXCEEDED` | > 10 attempts |

---

## Certificates

**Method / path:** `GET /partners/me/training/certificates`  
**Who:** Rider.

**PartnerCertificateDto[]**: `certificateId`, `certificateNo`, `moduleId`, `moduleCode`, `moduleTitle`, `category`, `score`, `issuedAt`.

---

# Public Zone Surge

## Launch cities

**API name:** Public launch cities  
**Method / path:** `GET /public/cities`  
**Auth:** 🔓  
**Who:** Customer splash / city picker. Not address-service.

Distinct `city` values from delivery **Zone** documents. Hours match serviceability IST policy (`06:00`–`23:30` Asia/Kolkata). Includes each zone polygon + `rainFee` (₹ extra while zone stays open in rain).

### Success `200`

```json
{
  "success": true,
  "message": "Launch cities",
  "data": {
    "cities": [
      {
        "id": "delhi",
        "name": "Delhi",
        "isLive": true,
        "hours": { "open": "06:00", "close": "23:30", "tz": "Asia/Kolkata" },
        "polygon": [[[77.1, 28.5], [77.3, 28.5], [77.3, 28.8], [77.1, 28.8], [77.1, 28.5]]],
        "zones": [
          {
            "zoneId": "66z1...",
            "name": "South Delhi",
            "isActive": true,
            "rainFee": 15,
            "surgeMultiplier": 1,
            "polygon": [[[77.1, 28.5], [77.3, 28.5], [77.3, 28.8], [77.1, 28.8], [77.1, 28.5]]]
          }
        ]
      }
    ]
  }
}
```

No zones in Mongo → `cities: []`. Never a hardcoded city list.

## Zone surge badge  
**Method / path:** `GET /zones/:zoneId/surge-status`  
**Who:** Public (no cookie). Live `Zone.surgeMultiplier` only — never invents surge.

### Success `200`

```json
{
  "zoneId": "66z1...",
  "name": "Koramangala",
  "city": "Bengaluru",
  "surgeMultiplier": 1.4,
  "isActive": true,
  "surgeActive": true,
  "reason": "zone_surge"
}
```

`reason`: `zone_surge` (active + multiplier > 1) \| `no_surge` (active + 1) \| `zone_inactive` (multiplier forced to 1). `404 ZONE_NOT_FOUND`.

---

## Admin close zone

**API name:** Close zone (rain / incident)  
**Method / path:** `PUT /admin/zones/:zoneId/close`  
**Who:** Admin. CSRF.

### Request

```json
{ "reason": "rain", "note": "IMD warning" }
```

`reason`: `rain` \| `incident` \| `ops` \| `maintenance`.

### Success `200`

`data` is **ZoneDto** (`isActive: false`, `closedReason`). Checkout serviceability then returns `zone_rain` or `zone_closed`.

---

## Admin open zone

**API name:** Reopen zone  
**Method / path:** `PUT /admin/zones/:zoneId/open`  
**Who:** Admin. CSRF.

### Success `200`

`data` is **ZoneDto** (`isActive: true`, `closedReason: null`).

---

## Admin set surge

**API name:** Set or clear zone surge  
**Method / path:** `PUT /admin/zones/:zoneId/surge`  
**Who:** Admin. CSRF. Multiplier 1–5; `1` clears surge. Never invents a value the zone does not store.

### Request

```json
{ "surgeMultiplier": 1.5, "reason": "dinner peak" }
```

### Success `200`

`data` is **ZoneDto**. Public `/zones/:zoneId/surge-status` reads the same field.

---

## Admin zone heatmap

**API name:** Demand vs supply heatmap  
**Method / path:** `GET /admin/zones/:zoneId/heatmap`  
**Who:** Admin.

### Success `200`

```json
{
  "success": true,
  "message": "Zone heatmap",
  "data": {
    "zoneId": "66z1...",
    "name": "Dwarka",
    "city": "Delhi",
    "isActive": true,
    "closedReason": null,
    "surgeMultiplier": 1.4,
    "online": 18,
    "available": 11,
    "onDelivery": 6,
    "onBreak": 1,
    "activeTrips": 9,
    "demandScore": 52,
    "coverageRatio": 2.0,
    "intensity": "high"
  }
}
```

Live duty snapshot + active trips inside the polygon. Surge shown as 1 if zone is closed.

---

## Admin create hub

**API name:** Create hub / cash-drop  
**Method / path:** `POST /admin/hubs`  
**Who:** Admin. CSRF. Required so rider hub check-in is not a dead end.

### Request

```json
{
  "name": "Dwarka Hub",
  "city": "Delhi",
  "kind": "hub",
  "latitude": 28.592,
  "longitude": 77.046,
  "address": "Sector 12",
  "radiusMeters": 150
}
```

### Success `201`

`data` is **HubDto**. `GET /admin/hubs?city=` lists active hubs.

---

# App Configuration APIs

Rider remote config, fare rules, app feedback, and crash reports. Service: **delivery-service**. Auth: 🔑 + 🚴. CSRF on POST. Gateway: `/api/v1/delivery-service`. Dates / payout weekday **Asia/Kolkata**.

Feature flags persist as `FeatureFlag` (seeded on first read) with optional per-city overrides. Capability overlay turns a flag **off** when the downstream is not configured (`maskedCalling`, `googleMapsRouting`, `bankVerify`, `smsOtp`, `doorstepUpi`) — never advertise a dead feature. Pricing numbers come from env + `EARNINGS_POLICY` / `PAYOUT_POLICY` / `COD_POLICY` + live active incentive programs for the rider’s zone/vehicle — not stubs. App feedback reuses `PartnerFeedback` (shared 10/hour with `/support/feedback`). Crash reports persist as `CrashReport` (30/hour, same-stack fingerprint deduped for 1 hour).

---

## Get partner app config

**API name:** Partner remote config  
**Method / path:** `GET /partners/me/config`  
**Who:** Rider.

### Request

Query `?appVersion=1.2.0` **or** header `x-app-version: 1.2.0` (used for `forceUpdate` / `updateAvailable`).

### Success response `200`

```json
{
  "success": true,
  "message": "App config",
  "data": {
    "minSupportedAppVersion": "1.0.0",
    "latestAppVersion": "1.0.0",
    "forceUpdate": false,
    "updateAvailable": false,
    "timezone": "Asia/Kolkata",
    "featureFlags": {
      "instantPayout": true,
      "doorstepUpi": false,
      "maskedCalling": false,
      "batching": true,
      "incentives": true,
      "referrals": true,
      "sos": true,
      "insuranceClaims": true,
      "chat": true,
      "googleMapsRouting": false,
      "bankVerify": false,
      "smsOtp": false,
      "leaderboard": true,
      "weeklyGuarantee": true,
      "contactlessDelivery": true
    },
    "cityRules": {
      "city": "Delhi",
      "zoneId": "66aa...",
      "zoneName": "South Delhi",
      "zoneActive": true,
      "surgeMultiplier": 1.2,
      "assignmentOpen": true,
      "assignmentRadiusKm": 5,
      "offerTimeoutSeconds": 30,
      "maxActiveDeliveries": 3,
      "geofencePickupM": 150,
      "geofenceDropM": 100,
      "breakMaxMinutesPerDay": 60,
      "breakMaxSingleMinutes": 30,
      "locationPingMs": 4000,
      "heartbeatIdleMs": 15000
    }
  }
}
```

Min / latest versions: env `RIDER_MIN_APP_VERSION` / `RIDER_LATEST_APP_VERSION`, else `1.0.0`. Zone comes from `currentZoneId` / `homeZoneId` or GPS point-in-polygon. Inactive zone → `assignmentOpen: false`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PARTNER_NOT_FOUND` | No partner profile |

---

## Get pricing rules

**API name:** Partner fare / incentive rules  
**Method / path:** `GET /partners/me/config/pricing-rules`  
**Who:** Rider. Same numbers the earnings + payout + COD ledgers use.

### Success response `200`

```json
{
  "success": true,
  "message": "Pricing rules",
  "data": {
    "currency": "INR",
    "timezone": "Asia/Kolkata",
    "fare": {
      "baseDeliveryFeeInr": 30,
      "perKmInr": 8,
      "waitInrPerMinute": 1,
      "partnerSharePct": 80,
      "tdsRate": 0.01
    },
    "surge": {
      "multiplier": 1.2,
      "zoneId": "66aa...",
      "zoneName": "South Delhi",
      "city": "Delhi"
    },
    "payout": {
      "weeklyWeekday": "Tuesday",
      "weeklyMinInr": 1,
      "instantMinInr": 200,
      "instantFeePercent": 2.5,
      "instantFeeMinInr": 5,
      "instantDailyCapInr": 5000,
      "instantDailyMaxCount": 3,
      "bankMustBeVerified": true
    },
    "cod": {
      "limitInr": 5000,
      "remitSlaRatio": 0.5,
      "minRemitInr": 1
    },
    "batch": { "minOrders": 2, "maxOrders": 3, "maxClusterKm": 3 },
    "incentives": {
      "pointsPerDelivery": 10,
      "activePrograms": [
        {
          "incentiveId": "66c1...",
          "code": "daily_10",
          "title": "10 deliveries today",
          "kind": "delivery_count",
          "window": "day",
          "requiresOptIn": false,
          "slabs": [{ "target": 10, "bonusInr": 80, "label": "Hit 10" }]
        }
      ]
    },
    "referrals": { "kycBonusInr": 100, "tripsTarget": 10, "tripsBonusInr": 250 }
  }
}
```

`activePrograms` only includes **active** schemes the rider’s vehicle/zone is eligible for. Instant payout still requires a verified bank and payment-service — this payload is the published rule sheet, not a guarantee of transfer.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `PARTNER_NOT_FOUND` | No partner profile |

---

## Submit app feedback

**API name:** App / feature-request feedback  
**Method / path:** `POST /partners/me/app/feedback`  
**Who:** Rider. CSRF. Same `PartnerFeedback` collection as `POST /support/feedback` (shared **10 / hour**). Optional multipart `attachment`.

### Request

```json
{
  "category": "feature_request",
  "message": "Please add dark mode on the offer sheet",
  "rating": 4
}
```

`category` optional, defaults to `app`. Allowed: `app` \| `feature_request` \| `delivery` \| `support` \| `payout` \| `safety` \| `other`. `message` 10–2000.

### Success response `201`

**PartnerFeedbackDto** (`deliveryId` / `ticketId` null on this path).

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `INVALID_FEEDBACK` | Short message |
| 429 | `FEEDBACK_RATE_LIMITED` | > 10 / hour (shared with `/support/feedback`) |

---

## Submit crash report

**API name:** Client crash / diagnostic report  
**Method / path:** `POST /partners/me/app/crash-report`  
**Who:** Rider. CSRF. Persists `CrashReport` — never fake success. Same stack fingerprint within 1 hour returns the existing `reportId` (`deduped: true`, HTTP 200). Max **30 / hour**.

### Request

```json
{
  "stackTrace": "TypeError: Cannot read property 'eta' of null\n    at TrackingScreen.js:42",
  "appVersion": "1.2.0",
  "osVersion": "Android 14",
  "platform": "android",
  "deviceModel": "Pixel 7",
  "message": "NPE on tracking screen after reject",
  "breadcrumbs": ["offer_shown", "offer_rejected", "tracking_open"],
  "occurredAt": "2026-08-09T06:40:00.000Z"
}
```

`stackTrace` required (10–32000). `platform`: `android` \| `ios` \| `other`.

### Success response `201` (or `200` if deduped)

```json
{
  "success": true,
  "message": "Crash report received",
  "data": {
    "reportId": "66fc...",
    "status": "received",
    "deduped": false,
    "createdAt": "2026-08-09T06:40:01.000Z"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `INVALID_CRASH_REPORT` | Missing/short stack or bad `occurredAt` |
| 429 | `CRASH_RATE_LIMITED` | > 30 / hour |
| 404 | `PARTNER_NOT_FOUND` | No partner profile |

---

# Performance, Ratings & Tier APIs

Rider §14 leaderboard, KPIs, ratings, Bronze→Platinum, warnings. Service: **delivery-service**. Auth: 🔑 + 🚴 (internal key on submit/issue). Dates **Asia/Kolkata**. Metrics come from the partner document + IST earnings ledger + stored ratings — not stubs. Names on the leaderboard are masked (`Rahul K.`). Customer names on reviews are masked.

---

## Leaderboard

**API name:** Zone / city leaderboard  
**Method / path:** `GET /partners/leaderboard`  
**Who:** Rider.

Query: `metric` = `deliveries` \| `rating` \| `streak` (default `deliveries`); `scope` = `zone` \| `city` (default `zone`); `period` = `today` \| `week` \| `month` (default `week`, used for deliveries); `limit` 1–50 (default 20).

Requires `currentZoneId` or `homeZoneId`. Rating board scores 0 until the rider has **5** ratings.

### Success response `200`

```json
{
  "success": true,
  "message": "Leaderboard",
  "data": {
    "metric": "deliveries",
    "scope": "zone",
    "period": "week",
    "timezone": "Asia/Kolkata",
    "zoneId": "66aa...",
    "city": "Delhi",
    "periodFrom": "2026-08-03",
    "periodTo": "2026-08-09",
    "me": { "rank": 4, "score": 28, "totalRiders": 42 },
    "items": [
      {
        "rank": 1,
        "partnerId": "66b1...",
        "nameMasked": "Amit S.",
        "score": 51,
        "avgRating": 4.8,
        "streak": 12,
        "deliveries": 51,
        "isMe": false
      }
    ]
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `NO_ZONE` | Rider has no home/current zone |
| 404 | `ZONE_NOT_FOUND` | Zone id missing in DB |

---

## Performance

**API name:** Partner performance  
**Method / path:** `GET /partners/me/performance`  
**Who:** Rider.

Also syncs auto warnings for this IST week (low acceptance / high cancel / low rating).

### Success response `200`

```json
{
  "success": true,
  "message": "Performance metrics",
  "data": {
    "avgRating": 4.6,
    "ratingCount": 32,
    "completionRate": 96,
    "acceptanceRate": 88,
    "cancellationRate": 4,
    "onTimeRate": 92,
    "totalDeliveries": 210,
    "currentStreak": 6,
    "tier": { "code": "gold", "label": "Gold" },
    "zoneRank": { "metric": "deliveries", "period": "week", "rank": 4, "total": 42 },
    "openWarnings": 0,
    "atRisk": false,
    "periods": {
      "today": { "from": "2026-08-09", "to": "2026-08-09", "deliveries": 6, "earnings": 420 },
      "week":  { "from": "2026-08-03", "to": "2026-08-09", "deliveries": 28, "earnings": 2100 },
      "month": { "from": "2026-08-01", "to": "2026-08-31", "deliveries": 90, "earnings": 6800 }
    }
  }
}
```

---

## Acceptance rate

**API name:** Acceptance rate  
**Method / path:** `GET /partners/me/acceptance-rate`  
**Who:** Rider.

Running rate on the partner profile (same field as performance). `atRisk` when below 70%.

### Success response `200`

```json
{
  "success": true,
  "message": "Acceptance rate",
  "data": {
    "metric": "acceptance",
    "rate": 88,
    "threshold": 70,
    "atRisk": false,
    "direction": "higher_is_better",
    "timezone": "Asia/Kolkata",
    "note": "Running acceptance rate. Below 70% triggers a weekly warning."
  }
}
```

---

## Cancellation rate

**API name:** Cancellation rate  
**Method / path:** `GET /partners/me/cancellation-rate`  
**Who:** Rider.

`atRisk` when above 15%.

### Success response `200`

```json
{
  "success": true,
  "message": "Cancellation rate",
  "data": {
    "metric": "cancellation",
    "rate": 4,
    "threshold": 15,
    "atRisk": false,
    "direction": "lower_is_better",
    "timezone": "Asia/Kolkata",
    "note": "Running cancellation rate. Above 15% triggers a weekly warning."
  }
}
```

---

## Ratings history

**API name:** List partner ratings  
**Method / path:** `GET /partners/me/ratings`  
**Who:** Rider. Query: `page`, `limit`.

### Success response `200`

Paginated (`data`, `total`, `page`, `limit`, `totalPages`). Each item:

```json
{
  "ratingId": "66cc...",
  "deliveryId": "66dd...",
  "orderId": "66ee...",
  "stars": 5,
  "comment": "Fast and polite",
  "source": "customer",
  "reviewerMasked": "Priya S.",
  "createdAt": "2026-08-08T14:02:00.000Z"
}
```

---

## Customer reviews

**API name:** Customer reviews  
**Method / path:** `GET /partners/me/reviews`  
**Who:** Rider. Query: `page`, `limit`.

Same paginated **PartnerRatingDto** as `/partners/me/ratings`, filtered to `source=customer` (restaurant pickup ratings omitted).

---

## Ratings summary

**API name:** Rating summary  
**Method / path:** `GET /partners/me/ratings/summary`  
**Who:** Rider.

`trend` is `up` / `down` / `flat` when both last-30 and previous-30 have ≥ 3 ratings; else `insufficient`.

### Success response `200`

```json
{
  "success": true,
  "message": "Rating summary",
  "data": {
    "avgRating": 4.6,
    "ratingCount": 32,
    "distribution": { "1": 0, "2": 1, "3": 2, "4": 9, "5": 20 },
    "last30Days": { "count": 12, "avg": 4.7 },
    "previous30Days": { "count": 10, "avg": 4.5 },
    "trend": "up"
  }
}
```

---

## Tier

**API name:** Get partner tier  
**Method / path:** `GET /partners/me/tier`  
**Who:** Rider.

Computed live: Bronze → Silver (50 trips, 4.3★ / 10 ratings, 80% accept, 90% complete) → Gold (150 / 4.6★ / 25 / 85 / 95 / 90% on-time) → Platinum (400 / 4.8★ / 50 / 90 / 97 / 95). Admin `tierOverride` on the partner document wins and sets `overridden: true`. Perks are display-only (payout fees unchanged).

### Success response `200`

```json
{
  "success": true,
  "message": "Partner tier",
  "data": {
    "code": "gold",
    "label": "Gold",
    "perks": ["Higher peak-slot priority", "Faster KYC re-review"],
    "overridden": false,
    "ratingCount": 32,
    "totalDeliveries": 210
  }
}
```

---

## Tier criteria

**API name:** Next-tier criteria  
**Method / path:** `GET /partners/me/tier/criteria`  
**Who:** Rider.

### Success response `200`

```json
{
  "success": true,
  "message": "Tier criteria",
  "data": {
    "timezone": "Asia/Kolkata",
    "current": { "code": "gold", "label": "Gold", "perks": ["Higher peak-slot priority", "Faster KYC re-review"], "overridden": false, "ratingCount": 32, "totalDeliveries": 210 },
    "next": { "code": "platinum", "label": "Platinum", "perks": ["Top dispatch priority", "Dedicated rider support"] },
    "requirements": [
      { "key": "deliveries", "label": "Deliveries", "current": 210, "required": 400, "met": false },
      { "key": "rating", "label": "Average rating", "current": 4.6, "required": 4.8, "met": false }
    ],
    "progressPercent": 50
  }
}
```

`next` is `null` at Platinum.

---

## Warnings

**API name:** List warnings  
**Method / path:** `GET /partners/me/warnings`  
**Who:** Rider. Query: `page`, `limit`, `status` = `open` \| `acknowledged` \| `expired` \| `resolved`.

Auto-issued each IST week when acceptance &lt; 70%, cancellation &gt; 15%, or rating &lt; 4.0 with ≥10 reviews. Recovered metrics expire the open auto warning.

### Success response `200`

Paginated. Item:

```json
{
  "warningId": "66ff...",
  "code": "LOW_ACCEPTANCE",
  "severity": "medium",
  "status": "open",
  "title": "Low acceptance rate",
  "message": "Acceptance is 62% (below 70%). Accept more offers this week.",
  "strikePoints": 1,
  "autoIssued": true,
  "issuedAt": "2026-08-09T04:00:00.000Z",
  "expiresAt": null,
  "acknowledgedAt": null
}
```

---

## Acknowledge warning

**API name:** Acknowledge warning  
**Method / path:** `POST /partners/me/warnings/:warningId/acknowledge`  
**Who:** Rider. CSRF. No body.

### Success response `200`

Same warning DTO with `status: "acknowledged"` and `acknowledgedAt` set.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `WARNING_NOT_FOUND` | Unknown id |
| 403 | `FORBIDDEN` | Not your warning |
| 409 | `WARNING_NOT_OPEN` | Already acknowledged / expired |

---

## Internal: submit rating

**API name:** Submit partner rating  
**Method / path:** `POST /internal/ratings/submit`  
**Who:** order/customer/restaurant services. Auth: `x-internal-key`.

### Request

```json
{
  "deliveryId": "66dd...",
  "orderId": "66ee...",
  "stars": 5,
  "comment": "Fast and polite",
  "source": "customer",
  "reviewerName": "Priya Sharma",
  "customerId": "66aa..."
}
```

`deliveryId` **or** `orderId`. Customer source requires `delivered`. Restaurant pickup ratings go through `POST /restaurant/:restaurantId/orders/:orderId/rate-partner` (allowed from `arrived_at_restaurant`). Unique per `deliveryId` + `source` (`customer` \| `restaurant`). Recalculates `avgRating` + `ratingCount` on the partner. Reviewer name is stored then masked on rider GET.

### Success response `201`

**PartnerRatingDto**. Same stars again → 201 idempotent. Different stars → `409 RATING_ALREADY_SUBMITTED`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | Unknown delivery/order |
| 409 | `DELIVERY_NOT_COMPLETE` | Not delivered yet |
| 409 | `RATING_ALREADY_SUBMITTED` | Already rated this source |
| 409 | `PARTNER_MISMATCH` | `partnerId` ≠ delivery rider |
| 422 | `INVALID_RATING` | stars not 1–5 |

---

## Internal: issue warning

**API name:** Issue warning  
**Method / path:** `POST /internal/warnings`  
**Who:** ops / other services. Auth: `x-internal-key`.

### Request

```json
{
  "partnerId": "66b1...",
  "code": "CUSTOMER_COMPLAINT",
  "severity": "high",
  "title": "Customer complaint",
  "message": "Rude behaviour reported on order #FD-1024.",
  "strikePoints": 2
}
```

`code`: `LOW_ACCEPTANCE` \| `HIGH_CANCELLATION` \| `LOW_RATING` \| `CUSTOMER_COMPLAINT` \| `GEOFENCE_VIOLATION` \| `COD_SHORT` \| `UNSAFE_CONDUCT` \| `DOCUMENT_EXPIRED` \| `OTHER`.

### Success response `201`

**PartnerWarningDto** with `autoIssued: false`.

---

# Admin Ops APIs

Zones, SOS dispatch, partner-supply, broadcast, and admin delivery control. Service: **delivery-service**. Gateway: `/api/v1/delivery-service`. Auth: 🔑 + 🔐 `admin` / `super_admin`. CSRF on POST/PUT. SOS dispatch is ops acknowledge/handling — **never** fake a police call. Broadcast persists even if notification-service is down (`pushed: false`). Admin delivery detail never returns drop OTP. Reassign is pre-pickup only. Force complete is post-pickup only and syncs order + earnings.

---

## Create delivery zone

**API name:** Create zone  
**Method / path:** `POST /admin/zones`  
**Who:** Admin. CSRF.

### Request

```json
{
  "name": "Koramangala 5th Block",
  "city": "Bengaluru",
  "coordinates": [[[77.62, 12.93], [77.64, 12.93], [77.64, 12.95], [77.62, 12.95], [77.62, 12.93]]],
  "surgeMultiplier": 1.2
}
```

`coordinates`: GeoJSON Polygon (outer ring closed, ≥4 points, `[lng, lat]`). `surgeMultiplier` optional, 1–5 (default 1).

### Success response `201`

**ZoneDto**: `zoneId`, `name`, `city`, `coordinates`, `surgeMultiplier`, `isActive`, `activePartners`, `createdAt`, `updatedAt`.

### Errors

| HTTP | code | When |
|---|---|---|
| 409 | `ZONE_EXISTS` | Same name already in this city |
| 422 | `INVALID_POLYGON` / `POLYGON_NOT_CLOSED` / `INVALID_SURGE` | Bad geofence or surge |

---

## Update delivery zone

**API name:** Update zone  
**Method / path:** `PUT /admin/zones/:zoneId`  
**Who:** Admin. CSRF.

### Request

Any of: `name`, `coordinates`, `surgeMultiplier` (1–5), `isActive`.

### Success response `200`

**ZoneDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `ZONE_NOT_FOUND` | Unknown id |
| 409 | `ZONE_EXISTS` | Rename collides |
| 422 | `INVALID_POLYGON` / `POLYGON_NOT_CLOSED` / `INVALID_SURGE` | Bad geofence or surge |

---

## Active SOS feed

**API name:** Live SOS feed  
**Method / path:** `GET /admin/sos/active`  
**Who:** Admin.

### Request

Query: `city` (optional — filter by partner zone city).

### Success response `200`

```json
{
  "count": 1,
  "data": [{
    "sosId": "66s1...",
    "status": "active",
    "partnerId": "66p1...",
    "partnerName": "Ravi Kumar",
    "partnerCode": "FD-1024",
    "phone": "9876543210",
    "phoneMasked": "******3210",
    "city": "Bengaluru",
    "zoneId": "66z1...",
    "deliveryId": "66d1...",
    "orderId": "66o1...",
    "latitude": 12.935,
    "longitude": 77.624,
    "liveLatitude": 12.936,
    "liveLongitude": 77.625,
    "accuracy": 12,
    "note": "Hit by scooter",
    "dispatchedAt": null,
    "dispatchedBy": null,
    "dispatchNote": null,
    "resolveReason": null,
    "triggeredAt": "2026-08-09T08:01:00.000Z",
    "resolvedAt": null,
    "createdAt": "2026-08-09T08:01:00.000Z"
  }]
}
```

`status`: `active` \| `acknowledged`. `phone` is unmasked for ops; rider APIs still mask. `liveLatitude`/`liveLongitude` from Redis GPS when newer than trigger pin. Socket: join `ops:sos` via `ops:join`.

---

## Dispatch SOS

**API name:** Dispatch SOS  
**Method / path:** `PUT /admin/sos/:sosId/dispatch`  
**Who:** Admin. CSRF. Marks the alert as being handled (`acknowledged`). Does **not** call police.

### Request

```json
{ "note": "Field team en route, ETA 8 min" }
```

`note` optional.

### Success response `200`

**AdminSosDto** with `status: "acknowledged"`, `dispatchedAt`, `dispatchedBy`, `dispatchNote`. Idempotent if already acknowledged.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `SOS_NOT_FOUND` | Unknown id |
| 409 | `SOS_NOT_ACTIVE` | Already resolved / false alarm |

---

## Partner supply analytics

**API name:** Partner supply by zone  
**Method / path:** `GET /admin/analytics/partner-supply`  
**Who:** Admin.

### Request

Query: `city` (optional — only zones in that city).

### Success response `200`

**PartnerSupplyDto**: `timezone` (`Asia/Kolkata`), `city`, `totals` (`online`, `available`, `onDelivery`, `onBreak`, `offline`, `activeKyc`, `activeTrips`), `zones[]` (**PartnerSupplyZoneDto**: same counts + `surgeMultiplier`, `coverageRatio` = available/online). Counts come from live `dutyStatus` / `isOnline`, not stubs.

---

## Partner broadcast

**API name:** Broadcast to partners  
**Method / path:** `POST /admin/broadcast`  
**Who:** Admin. CSRF.

### Request

```json
{
  "title": "Heavy rain — ride safe",
  "body": "Koramangala surge is live. Take extra care at junctions.",
  "city": "Bengaluru",
  "zoneId": "66z1...",
  "segment": "online"
}
```

`title` min 5, `body` min 10. `city` and `zoneId` optional (omit both → all active partners). `segment`: `all_active` \| `online` \| `on_delivery` (default `all_active`). If `zoneId` set it wins over `city`.

### Success response `201`

**AdminBroadcastDto**: `broadcastId`, `title`, `body`, `city`, `zoneId`, `segment`, `audienceCount`, `pushed`, `degradedReason`, `createdBy`, `createdAt`.

`pushed: true` only after notification-service accepted the in-app broadcast. If notification-service is down/unset → still `201` with `pushed: false` and `degradedReason: "NOTIFICATION_SERVICE_UNAVAILABLE"` (Redis `PARTNER_BROADCAST` event still published; never fake delivered).

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `ZONE_NOT_FOUND` | Unknown `zoneId` or no zones in `city` |
| 400 | `INVALID_ZONE` | Malformed `zoneId` |

---

## Admin list deliveries

**API name:** List deliveries  
**Method / path:** `GET /admin/deliveries`  
**Who:** Admin.

### Request

Query: `page`, `limit`, `status`, `partnerId`, `restaurantId`, `orderId`, `dateFrom`, `dateTo` (ISO).

### Success response `200`

Paginated **AdminDeliveryListDto**: `deliveryId`, `orderId`, `restaurantId`, `partnerId`, `partnerName`, `status`, `paymentMethod`, `deliveryFee`, `assignedAt`, `createdAt`. Drop OTP is never included.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_STATUS` / `INVALID_DATE` | Bad filter |

---

## Admin delivery detail

**API name:** Delivery detail  
**Method / path:** `GET /admin/deliveries/:deliveryId`  
**Who:** Admin.

### Success response `200`

**AdminDeliveryDetailDto**: list fields + pins, timestamps, earnings, `codAmount`, `cancelReason`, `failReason`, `adminCompleteReason`, `issues[]`. No OTP.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | Unknown id |

---

## Admin reassign delivery

**API name:** Force reassign delivery  
**Method / path:** `PUT /admin/deliveries/:deliveryId/reassign`  
**Who:** Admin. CSRF. Pre-pickup only (`assigned` / `accepted` / `arrived_at_restaurant`).

### Request

```json
{ "reason": "Rider not moving", "partnerId": "66p2..." }
```

`partnerId` optional — omit for auto reassign (skips previous rider). Pins rebuilt from the delivery document if Redis assign cache expired.

### Success response `200`

**DispatchAssignDto** (new offer).

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | Unknown id |
| 409 | `ILLEGAL_TRANSITION` | Already picked up |
| 409 | `ASSIGN_INPUT_MISSING` | No restaurant/drop pins |

---

## Admin cancel delivery

**API name:** Cancel delivery  
**Method / path:** `PUT /admin/deliveries/:deliveryId/cancel`  
**Who:** Admin. CSRF. Restores rider duty + syncs order `cancelled`.

### Request

```json
{ "reason": "Restaurant closed after accept" }
```

`reason` min 8.

### Success response `200`

```json
{ "deliveryId": "66d1...", "orderId": "66o1...", "status": "cancelled" }
```

Idempotent if already cancelled / reassigned / delivered / returned / failed.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | Unknown id |

---

## Admin force-complete delivery

**API name:** Force complete delivery  
**Method / path:** `PUT /admin/deliveries/:deliveryId/complete`  
**Who:** Admin. CSRF. After pickup only (`picked_up` / `out_for_delivery` / `arrived_at_customer` / `returning_to_restaurant`). Credits IST earnings + loyalty like rider deliver; syncs order `delivered`. Skips drop OTP/geofence. COD cash-in-hand increments unless already UPI or trip is returning-to-restaurant.

### Request

```json
{ "reason": "Customer received order, OTP screen frozen" }
```

`reason` min 8.

### Success response `200`

**AdminDeliveryDetailDto** with `status: "delivered"` and `adminCompleteReason`. Idempotent if already delivered.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `DELIVERY_NOT_FOUND` | Unknown id |
| 409 | `ILLEGAL_TRANSITION` | Not yet picked up (reassign/cancel instead) |

---

## Admin online partners

**API name:** List online partners  
**Method / path:** `GET /admin/partners/online`  
**Who:** Admin. Must be registered before `/admin/partners/:partnerId`.

### Request

Query: `page`, `limit`, `city`, `zoneId`, `search`, `status` (default `active`).

### Success response `200`

Paginated **AdminPartnerListDto** where `isOnline=true`.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_STATUS` | Bad status enum |

---

## Admin offline partners

**API name:** List offline partners  
**Method / path:** `GET /admin/partners/offline`  
**Who:** Admin.

Same query as online. Returns active (default) partners with `isOnline=false`.

---

## Live dispatch monitor

**API name:** Live dispatch queue  
**Method / path:** `GET /admin/dispatch/live`  
**Who:** Admin.

### Request

Query: `limit` (default dispatch queue cap).

### Success response `200`

**AdminDispatchLiveDto**: `generatedAt`, `timezone`, `queue[]` (**DispatchQueueItemDto**: offer / offer_expired / no_partner), `counts`, live `partners` duty snapshot, `sosActive`. Same queue as `/dispatch/queue`, plus ops snapshot.

---

## Delivery analytics dashboard

**API name:** Delivery analytics  
**Method / path:** `GET /admin/analytics`  
**Who:** Admin.

### Request

Query: `from`, `to` (ISO, default today IST → now). Same window as `/admin/dispatch/statistics`.

### Success response `200`

**AdminAnalyticsDto**: `dispatch` (**DispatchStatisticsDto**), `earningsToday` (platform IST day totals from PartnerEarnings, not zeros), `sosActive`, `partnerSupply` totals.

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | `from` ≥ `to` or bad ISO |

---

## Delivery audit logs

**API name:** Delivery audit logs  
**Method / path:** `GET /admin/audit-logs`  
**Who:** Admin. Same ledger as `/admin/dispatch/logs` (DispatchLog).

### Request

Query: `page`, `limit`, `orderId`, `partnerId`, `action` (`assign` \| `broadcast` \| `manual_assign` \| `reassign` \| `cancel` \| `retry` \| `timeout` \| `reject` \| `accept` \| `no_partner` \| `fail`), `from`, `to`.

### Success response `200`

Paginated **DispatchLogDto**.

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Bad `action` / ISO date |

---

# Rider WebSocket Events

Real-time rider channel. Connect:

- **Gateway (production):** `{GATEWAY}/socket.io/` with session auth — signed `_sid` cookie, `auth: { sid }`, or `auth: { socketToken }` from `POST /api/v1/socket-token`. Room `user:{userId}` (userId comes from the verified session, never from client claim alone).
- **Delivery-service (direct):** `:4008/socket.io/` with the same session/`socketToken` rules. Room `partner_user:{userId}`. Set `SESSION_COOKIE_SECRET` to the gateway `SECRET_KEY` if relying on cookies.

Raw `auth: { userId }` **without** a valid session/token is rejected.

Offers used to fire `delivery:assigned` before accept — that was wrong. **`delivery:new` = offer**, **`delivery:assigned` = accepted trip**. Gateway also still emits customer-room `delivery:assigned` / `delivery:status` for tracking (different payload).

Inbound events run the **same services as REST** (never fake success). Gateway proxies every inbound event via `POST /internal/socket/action` (`x-internal-key`, 12s timeout). `POST /internal/duty/online` remains as a go-online-only alias. Disconnect does **not** auto-offline. `delivery:completed` still requires OTP or existing POD (`PROOF_REQUIRED`). Chat + typing also fan-out to `order:{orderId}` and `restaurant:{restaurantId}` so customer and kitchen see them.

---

## delivery:new (S→R)

Fired when an offer is created (`assign` / broadcast / retry). Payload:

```json
{
  "deliveryId": "66c2...",
  "orderId": "66b1...",
  "restaurantId": "66a1...",
  "restaurantLat": 28.61,
  "restaurantLng": 77.20,
  "deliveryFee": 45,
  "estimatedKm": 3.2,
  "timeoutSeconds": 30,
  "expiresAt": "2026-08-09T05:40:30.000Z",
  "broadcast": false
}
```

---

## delivery:assigned (S→R)

Fired after the rider **accepts** (REST or later socket accept). `{ deliveryId, orderId, status: "accepted" }`.

---

## delivery:assignment-expiring (S→R)

~10s before offer timeout (or ⅓ of timeout, min 3s). `{ deliveryId, orderId, secondsLeft, expiresAt }`. Not sent if already accepted/cancelled.

---

## delivery:cancelled (S→R)

Timeout, dispatch/order cancel, reassign, or broadcast loser (`reason: "OFFER_TAKEN"` | `"OFFER_TIMEOUT"` | human reason). `{ deliveryId, orderId?, reason? }`.

---

## delivery:updated (S→R)

Trip status after accept (`arrived_at_restaurant`, `picked_up`, `delivered`, …). `{ deliveryId, orderId, status, … }`.

---

## notification:new (S→R)

After `POST /internal/notifications/dispatch`. `{ notificationId, title, message, type, data, pushed }`. `pushed: false` if notification-service is down — still emitted so the rider app can show in-session copy.

---

## earnings:updated / wallet:credited (S→R)

Only after a **real** wallet increment (deliver, internal credit, incentive slab, referral bonus, admin credit). Never on quote-only calculate. Debit adjustments do not fire `wallet:credited`.

```json
{ "partnerId": "66a9...", "date": "2026-08-09", "delta": 48, "source": "delivery", "deliveryId": "66c2..." }
```

```json
{ "partnerId": "66a9...", "amount": 48, "walletBalance": 4120, "source": "delivery", "deliveryId": "66c2..." }
```

`source`: `delivery` \| `credit` \| `incentive` \| `referral` \| `adjustment`.

---

## partner:online (R→S)

```js
socket.emit('partner:online', { latitude: 28.61, longitude: 77.20, zoneId? }, (ack) => {
  // ack.ok === true → PartnerDutyStatus
  // ack.ok === false → { code, message }  PARTNER_NOT_ACTIVE | PARTNER_SUSPENDED | ACTIVE_DELIVERY | VALIDATION_ERROR | DUTY_UNAVAILABLE
});
```

Same rules as `PUT /partners/me/go-online`. Does **not** invent online if mongo is down.

---

## partner:offline (R→S)

```js
socket.emit('partner:offline', {}, (ack) => {
  // ack.ok → PartnerDutyStatus  dutyStatus: "offline"
  // ack.ok === false → ACTIVE_DELIVERY | PARTNER_NOT_FOUND | DUTY_UNAVAILABLE
});
```

Same as `PUT /partners/me/go-offline`. Active trip → **409 `ACTIVE_DELIVERY`**. Socket disconnect does **not** call this.

---

## partner:heartbeat (R→S)

```js
socket.emit('partner:heartbeat', { latitude?, longitude?, heading?, speed?, accuracy?, isMock?, timestamp? }, ack);
```

Same as `POST /partners/me/gps-heartbeat`. Coords optional; if sent, both lat+lng required. Offline rider → **409 `PARTNER_OFFLINE`**. Mock / impossible speed rejected like REST ping.

---

## partner:location (R→S)

```js
socket.emit('partner:location', {
  latitude: 28.61, longitude: 77.20, heading?, speed?, accuracy?, isMock?, timestamp?
}, ack);
```

Same as `POST /partners/me/location`. Must be online. Mock GPS / impossible speed → **422**. Redis live GPS + Mongo history batch unchanged.

---

## delivery:accept / reject / arrived / picked-up / reached-customer / completed (R→S)

Same DTOs and errors as the matching REST trip APIs. Ack `data` is **PartnerDeliveryDto**.

```js
socket.emit('delivery:accept', { deliveryId }, ack);
socket.emit('delivery:reject', { deliveryId, reasonCode: 'too_far', reason? }, ack);
socket.emit('delivery:arrived', { deliveryId }, ack);
socket.emit('delivery:picked-up', { deliveryId, otp?, photoUrl? }, ack);
socket.emit('delivery:reached-customer', { deliveryId }, ack);
socket.emit('delivery:completed', { deliveryId, otp?, proofPhotoUrl?, signatureUrl? }, ack);
```

| Event | REST equivalent | Notable errors |
|---|---|---|
| `delivery:accept` | `PUT .../accept` | `OFFER_EXPIRED`, `OFFER_TAKEN`, `DELIVERY_CAPACITY_FULL`, `COD_LIMIT_EXCEEDED` |
| `delivery:reject` | `PUT .../reject` | `VALIDATION_ERROR` (invalid `reasonCode`), `ILLEGAL_TRANSITION` |
| `delivery:arrived` | `PUT .../arrived` | `OUTSIDE_GEOFENCE`, `ILLEGAL_TRANSITION` |
| `delivery:picked-up` | `PUT .../pickup` | `INVALID_OTP`, `PROOF_REQUIRED`, `OUTSIDE_GEOFENCE` |
| `delivery:reached-customer` | `PUT .../arrived-customer` | `OUTSIDE_GEOFENCE`, `ILLEGAL_TRANSITION` |
| `delivery:completed` | `PUT .../deliver` | `PROOF_REQUIRED`, `INVALID_OTP`, `ILLEGAL_TRANSITION` |

`reasonCode`: `too_far` \| `restaurant_closed` \| `vehicle_issue` \| `personal_emergency` \| `order_too_large` \| `already_on_delivery` \| `other`. Complete never succeeds without OTP or existing POD.

---

## chat:new-message (both)

Rider: `deliveryId` + `to` (`customer` \| `restaurant`) + `text`. Customer: `orderId` + `text` (`to` defaults to `partner`). Kitchen: `orderId` + `text` + `to` (`customer` \| `partner`) — no chat REST. Persisted Mongo (`senderRole`: `partner` \| `customer` \| `restaurant`). Rate **30 / 5 min** → **429 `CHAT_RATE_LIMITED`**. After trip → **409 `CHAT_CLOSED`** (2h window after delivered/returned/failed). Kitchen access via restaurant-service `/internal/restaurants/:id/access`. Customer ownership via order-service batch; down → **503 `ORDER_SERVICE_UNAVAILABLE`** (never fake allow). No delivery yet → **404 `DELIVERY_NOT_FOUND`**.

```js
socket.emit('chat:new-message', { deliveryId, to: 'customer', text: 'At the gate' }, ack);
socket.emit('chat:new-message', { orderId, text: 'Please wait 2 min' }, ack);
socket.emit('chat:new-message', { orderId, text: 'Running 5 min late', to: 'customer' }, ack); // kitchen
```

Ack `data` is **DeliveryChatMessageDto**. Also emitted to rider room + `order:{orderId}` + `restaurant:{restaurantId}`.

---

## typing (both)

Ephemeral. Redis NX throttle **2s** on start; **stop (`isTyping: false`) always emitted**. Same ownership as chat.

```js
socket.emit('typing', { deliveryId, to: 'customer', isTyping: true }, ack);
socket.emit('typing', { orderId, isTyping: false }, ack);
```

Ack / broadcast:

```json
{
  "deliveryId": "66c2...",
  "orderId": "66b1...",
  "senderUserId": "66u1...",
  "senderRole": "partner",
  "to": "customer",
  "isTyping": true
}
```

---

## Internal duty online

**API name:** Socket go-online bridge  
**Method / path:** `POST /internal/duty/online`  
**Who:** API gateway only. Auth: `x-internal-key`.

### Request

```json
{ "userId": "66u1...", "latitude": 28.6139, "longitude": 77.2090, "zoneId": "66z..." }
```

### Success `200`

**PartnerDutyStatus** (same as `PUT /partners/me/go-online`).

### Errors

Same as go-online (`403 PARTNER_NOT_ACTIVE`, `409 ACTIVE_DELIVERY`, …).

---

## Internal socket action

**API name:** Socket inbound bridge  
**Method / path:** `POST /internal/socket/action`  
**Who:** API gateway. Auth: `x-internal-key`.

Forwards any §26 inbound event to `RiderSocketService` (same rules as connecting to delivery `:4008/socket.io/`).

### Request

```json
{
  "userId": "66u1...",
  "event": "delivery:accept",
  "payload": { "deliveryId": "66c2..." },
  "role": "restaurant_owner"
}
```

`event` enum: `partner:online` \| `partner:offline` \| `partner:heartbeat` \| `partner:location` \| `delivery:accept` \| `delivery:reject` \| `delivery:arrived` \| `delivery:picked-up` \| `delivery:reached-customer` \| `delivery:completed` \| `chat:new-message` \| `typing`. Optional `role` is the verified session role (kitchen chat uses it with restaurant access).

### Success `200`

`{ "success": true, "data": <event DTO>, "message": "<event>" }`

Examples: **PartnerDutyStatus**, **LocationPingResult**, **GpsHeartbeatResult**, **PartnerDeliveryDto**, **DeliveryChatMessageDto**, **ChatTypingDto**.

### Errors

| `code` | HTTP | When |
|---|---|---|
| `UNKNOWN_SOCKET_EVENT` | 422 | `event` not in enum |
| `VALIDATION_ERROR` | 422 | Missing `deliveryId` / GPS / `reasonCode` / `text` |
| `DUTY_UNAVAILABLE` | 503 | Delivery service unreachable (gateway ack) |
| `PARTNER_NOT_ACTIVE` / `PARTNER_SUSPENDED` / `ACTIVE_DELIVERY` / `PARTNER_OFFLINE` | 403/409 | Duty |
| `OFFER_EXPIRED` / `OFFER_TAKEN` / `DELIVERY_CAPACITY_FULL` / `COD_LIMIT_EXCEEDED` | 409 | Accept |
| `OUTSIDE_GEOFENCE` / `PROOF_REQUIRED` / `INVALID_OTP` / `ILLEGAL_TRANSITION` | 409/422 | Trip |
| `CHAT_CLOSED` / `CHAT_RATE_LIMITED` / `FORBIDDEN` / `ORDER_SERVICE_UNAVAILABLE` | 409/429/403/503 | Chat |

---

# Health & Service Metadata APIs

Service: **delivery-service**. Gateway: `/api/v1/delivery-service`.  
`GET /health`, `GET /health/ready`, and `GET /version` are public (no cookie). `GET /metrics` requires `x-internal-key`.  
Public health **only** pings mongo + redis (fast for k8s/compose). Downstream probes: `GET /ops/health` (admin) and `GET /internal/health` (internal). Metrics are live gauges — never invented request counters.

---

## Public health

**API name:** Service liveness  
**Method / path:** `GET /health`  
**Who:** Load balancer / Docker / k8s / anyone. No auth.

Pings MongoDB `admin().ping()` and Redis `PING`. **503** only if either fails. Keeps `status: "ok"` when ready so existing probes keep working. Does **not** call order/payment/restaurant (those can be down without restarting delivery).

### Request

No headers, query, or body.

### Success response `200`

```json
{
  "status": "ok",
  "ready": true,
  "service": "delivery-service",
  "uptime": 1842.12,
  "uptimeSeconds": 1842,
  "checks": {
    "mongo": { "ok": true, "latencyMs": 4 },
    "redis": { "ok": true, "latencyMs": 1 }
  },
  "pendingOrderSyncJobs": 0
}
```

Unwrapped (not `{ success, data }`) for probe compatibility.

### Errors

| HTTP | code | When |
|---|---|---|
| 503 | — | Mongo or Redis ping failed (`status: "unhealthy"`, `ready: false`, same body shape) |

---

## Public readiness

**API name:** Service readiness  
**Method / path:** `GET /health/ready`  
**Who:** k8s readinessProbe / gateway. No auth.

Same mongo + redis ping body as `GET /health` (identical response shape and `503` rules). Prefer this path when probes expect a dedicated ready URL.

### Request

No headers, query, or body.

### Success / errors

Same as [Public health](#public-health).

---

## Public version

**API name:** Service version / build info  
**Method / path:** `GET /version`  
**Who:** Public. Apps/ops to show API version. `gitSha` / `builtAt` only if CI set `GIT_SHA` / `BUILD_TIME` — never invented.

### Request

No body.

### Success response `200`

```json
{
  "success": true,
  "message": "Service version",
  "data": {
    "service": "delivery-service",
    "version": "1.0.0",
    "apiVersion": "v1",
    "env": "development",
    "node": "v20.19.0",
    "pid": 33,
    "startedAt": "2026-08-08T21:50:00.000Z",
    "uptimeSeconds": 1842,
    "gitSha": null,
    "builtAt": null
  }
}
```

`version` = `APP_VERSION` env, else `package.json` `version`, else `1.0.0`.

---

## Prometheus metrics

**API name:** Prometheus scrape  
**Method / path:** `GET /metrics`  
**Who:** Prometheus / Grafana. Auth: `x-internal-key`. Content-Type: `text/plain; version=0.0.4; charset=utf-8`.

Live snapshot from the same duty/queue/SOS ledgers as `GET /ops/metrics`. `delivery_up` is mongo+redis. If the snapshot query fails, process + `delivery_up` still emit and `delivery_metrics_scrape_success 0` — partner/queue gauges are omitted (not faked as zero).

### Request

Header `x-internal-key`.

### Success response `200` (excerpt)

```
# HELP delivery_up 1 if mongo and redis respond to ping
# TYPE delivery_up gauge
delivery_up 1
# HELP delivery_partners Partners by live duty snapshot
# TYPE delivery_partners gauge
delivery_partners{duty="online"} 12
delivery_partners{duty="available"} 8
delivery_partners{duty="onDelivery"} 3
delivery_live_deliveries{status="picked_up"} 2
delivery_dispatch_queue{kind="offer"} 1
delivery_sos_active 0
delivery_metrics_scrape_success 1
```

Also: `delivery_uptime_seconds`, `delivery_process_resident_memory_bytes`, `delivery_process_heap_used_bytes`, `delivery_process_cpu_seconds_total{mode="user|system"}`, `delivery_dependency_up{name="mongo|redis"}`, `delivery_assignment_timers`.

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | — | Missing/invalid internal key |

Admin JSON dashboard remains `GET /ops/metrics`.

---

# Ops APIs

Platform ops for delivery-service. Gateway: `/api/v1/delivery-service`. Auth: 🔑 + 🔐 `admin` / `super_admin`. CSRF on POST. Never FLUSHALL Redis (shared). Job retry never reports fake success — each assignment retry is real `DispatchService.retry`.

---

## Ops health

**API name:** Ops health  
**Method / path:** `GET /ops/health`  
**Who:** Admin. Public `GET /health` is mongo+redis liveness only (no downstream). This endpoint adds order/payment/restaurant/notification probes.

### Success response `200` or `503`

**OpsHealthDto**: `status` `healthy` \| `degraded` \| `unhealthy`, `uptimeSeconds`, `checks[]` (`mongo`, `redis`, `order-service`, `payment-service`, `restaurant-service`, `notification-service`) with `ok`, `latencyMs`, `detail`. HTTP **503** only if mongo or redis is down. Downstream fail → `degraded` + 200.

---

## Ops metrics

**API name:** Ops metrics  
**Method / path:** `GET /ops/metrics`  
**Who:** Admin.

### Success response `200`

**OpsMetricsDto**: memory, duty snapshot, `liveDeliveries` by status, dispatch queue counts, `sosActive`, in-process `assignmentTimers`.

---

## List background jobs

**API name:** Background jobs  
**Method / path:** `GET /ops/background-jobs`  
**Who:** Admin.

### Success response `200`

```json
{
  "count": 3,
  "jobs": [
    {
      "job": "expire_timed_suspends",
      "kind": "on_demand",
      "retryable": true,
      "lastRunAt": null,
      "lastResult": null,
      "pendingHint": null,
      "note": "Expires timed partner suspends. Also runs on partner list/get/go-online/assign."
    },
    {
      "job": "retry_failed_assignments",
      "kind": "on_demand",
      "retryable": true,
      "lastRunAt": null,
      "lastResult": null,
      "pendingHint": 4,
      "note": "Retries expired offers and no-partner queue items with cached pins."
    },
    {
      "job": "assignment_timeouts",
      "kind": "in_process",
      "retryable": false,
      "lastRunAt": null,
      "lastResult": { "activeTimers": 2 },
      "pendingHint": 2,
      "note": "In-process offer timers. Use retry_failed_assignments for stuck queue items."
    }
  ]
}
```

There is no fake cron. `pendingHint` for retry job = current dispatch queue items with `canRetry`.

---

## Retry background job

**API name:** Retry background job  
**Method / path:** `POST /ops/background-jobs/retry`  
**Who:** Admin. CSRF.

### Request

```json
{ "job": "retry_failed_assignments", "reason": "ops after rain outage" }
```

`job`: `expire_timed_suspends` \| `retry_failed_assignments`. Assignment retry cap 20 per call. Failed items listed with real error codes (`ASSIGN_INPUT_MISSING`, `ILLEGAL_TRANSITION`, …).

### Success response `200`

**OpsJobRetryDto**: `job`, `ranAt`, `result` (`expired` or `attempted/succeeded/failed/errors[]`).

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_OPS_JOB` | Unknown job |

---

## Outbound webhook status

**API name:** Webhook status  
**Method / path:** `GET /ops/webhooks`  
**Who:** Admin.

### Success response `200`

**OpsWebhooksDto**: `endpoints[]` for `order_status` (outbound order-service sync), `notification_broadcast`, `bank_verify_inbound`. Each has IST-day ok/fail counters, last attempt, optional live `/health` probe. Counters only increment when those calls actually run.

---

## Clear delivery cache

**API name:** Clear cache  
**Method / path:** `POST /ops/cache/clear`  
**Who:** Admin. CSRF. **Never** `FLUSHALL` (Redis is shared).

### Request

```json
{ "scope": "maps" }
```

`scope`: `maps` \| `locations` \| `assignments` \| `rate_limits` \| `all_delivery`.

### Success response `200`

**OpsCacheClearDto**: `scope`, `deletedKeys`, `patterns[]` scanned.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_CACHE_SCOPE` | Unknown scope |


---

# Customer home / deals / recommended — customer-service

Gateway: `/api/v1/customer-service`. Downstream: restaurant-service nearby + `GET /internal/feed/deals`; search-service `GET /trending`. Empty rails only when nothing nearby — never stubs while upstream is up. Downstream down → `503` with typed code.

## Home feed

**API name:** Home feed  
**Method / path:** `GET /customers/home?lat=&lng=`  
**Who:** Customer app (guest or logged-in). Auth: optional. `lat` + `lng` required.

### Success response `200`

```json
{
  "success": true,
  "message": "Home feed fetched",
  "data": {
    "banners": [
      {
        "id": "deal_66o1...",
        "title": "50% off",
        "imageUrl": "https://cdn.example/banner.jpg",
        "deepLink": "/restaurants/66r1...",
        "expiresAt": "2026-12-31T18:29:59.000Z"
      }
    ],
    "collections": [
      { "slug": "biryani", "title": "Biryani", "imageUrl": "https://cdn.example/col.jpg", "restaurantCount": 12 }
    ],
    "vegOnly": false,
    "trending": [
      {
        "_id": "66r1...",
        "restaurantId": "66r1...",
        "name": "Biryani House",
        "image": "https://cdn.example/logo.jpg",
        "avgRating": 4.2,
        "promiseMinutes": 32,
        "deliveryTimeLabel": "30-35 mins",
        "isPureVeg": false,
        "isOnline": true,
        "isOpenNow": true,
        "nextOpenAt": null,
        "closedReason": null,
        "availabilityLabel": null,
        "cuisines": ["Biryani"],
        "slug": "biryani-house",
        "hasOffers": true
      },
      {
        "_id": "66r2...",
        "restaurantId": "66r2...",
        "name": "Night Kitchen",
        "image": "https://cdn.example/logo2.jpg",
        "avgRating": 4.0,
        "isPureVeg": false,
        "isOnline": false,
        "isOpenNow": false,
        "nextOpenAt": "2026-08-14T05:30:00.000Z",
        "closedReason": null,
        "availabilityLabel": "Opens at 11:00 AM",
        "cuisines": ["North Indian"],
        "slug": "night-kitchen",
        "hasOffers": false
      }
    ],
    "forYou": [],
    "newlyAdded": []
  }
}
```

Guest: `forYou: []`, `vegOnly: false`. Logged-in: favourites + recent + nearby/trending; `vegOnly` from profile prefs filters pure-veg rails. Rails list **approved (`status=active`)** kitchens including offline / outside hours — open first, then closed. Closed cards: `isOpenNow: false`, `availabilityLabel` (`Closed` / `Opens at 11:00 AM` / `Currently not accepting orders` / holiday `closedReason`). `isOnline` = accepting orders now. `banners` = active CMS banners first, then live deal banners. `collections` from CMS. Favourite/pref mutations invalidate Redis `customer:home_feed:{userId}*` and `customer:recommendations:{userId}*`.

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Missing/invalid `lat`/`lng` |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` | Nearby / deals / hydrate down |
| 503 | `SEARCH_SERVICE_UNAVAILABLE` | Trending down |

## Deals near pin

**API name:** Deals  
**Method / path:** `GET /customers/deals?lat=&lng=`  
**Who:** Customer app (guest OK). Auth: optional. Pin required.

### Success response `200`

```json
{
  "success": true,
  "message": "Deals fetched",
  "data": [
    {
      "id": "66o1...",
      "title": "50% off",
      "description": "On orders above Rs 199",
      "imageUrl": "https://cdn.example/deal.jpg",
      "code": "SAVE50",
      "expiresAt": "2026-12-31T18:29:59.000Z",
      "type": "percentage",
      "value": 50,
      "restaurantId": "66r1...",
      "restaurantName": "Biryani House",
      "deepLink": "/restaurants/66r1..."
    }
  ]
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Missing/invalid pin |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` | `/internal/feed/deals` down |

## Recommended

**API name:** Recommended restaurants  
**Method / path:** `GET /customers/recommended?lat=&lng=`  
**Who:** Customer. Auth: required. `lat`/`lng` optional (used for trending/nearby fill when favourites/recent are thin).

### Success response `200`

`data`: `FeedRestaurantCard[]` — favourites first, then recent, then trending/nearby near pin. Gold/platinum up to 20 cards; else 12. Empty only when no personal signal and no pin (or nothing nearby).

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Not logged in |
| 422 | `VALIDATION_ERROR` | Only one of `lat`/`lng` sent |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` | Batch hydrate / nearby down |
| 503 | `SEARCH_SERVICE_UNAVAILABLE` | Trending fallback down and no personal cards |

## Internal deals near pin — restaurant-service

**API name:** Feed deals near pin  
**Method / path:** `GET /internal/feed/deals?lat=&lng=&radius=&limit=`  
**Who:** customer-service. Auth: `x-internal-key`.

### Success response `200`

`data`: `DealNearPinDto[]` — active offers on **online** restaurants within radius.


---

# Customer splash / CMS / prefs / FAQ / callback — customer-service

Gateway: `/api/v1/customer-service`. §3 LIVE.

## Ready probe

**API name:** Ready  
**Method / path:** `GET /health/ready`  
**Who:** Probe. Auth: public.

### Success `200` / not ready `503`

`{ status: "ok"|"not_ready", service: "customer-service", uptime, checks: { mongo, redis } }`

## Splash config

**API name:** App config  
**Method / path:** `GET /customers/config?platform=&appVersion=`  
**Who:** Customer splash. Auth: public. Cities from delivery `GET /public/cities` (polygons + rainFee) — never invented.

### Success `200`

`data`: `minAppVersion`, `latestAppVersion`, `forceUpdate`, `softUpdate`, `maintenance`, `storeUrl`, `cities[]` (`id`, `name`, `isLive`, `hours`, `flags`, `polygon`, `zones[]`), `featureFlags` (+ alias `flags`).

Default flags (no admin PUT required): `codEnabled`, `subscription`, `scheduledOrder`, `scratchCards` = **true**; `groupOrder` = false until `PUT /admin/config`. Admin can still turn any flag off. Missing `DELIVERY_SERVICE_URL` → `503 DELIVERY_SERVICE_UNAVAILABLE` (never invents cities).

### Errors

| HTTP | code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Bad platform |
| 503 | `DELIVERY_SERVICE_UNAVAILABLE` | Cities aggregate down |

## Banners / collections

**API name:** Banners · Collections list · Collection by slug  
**Paths:** `GET /customers/banners?city=` · `GET /customers/collections` · `GET /customers/collections/:slug?page=&limit=`  
**Who:** Customer. Auth: optional.

Empty arrays/lists when CMS empty — not stubs. Collection restaurants hydrated via restaurant batch. Unknown slug → `404 NOT_FOUND`.

## Preferences + dish favourites

**API name:** Update preferences  
**Method / path:** `PUT /customers/me`  
**Body:** `{ vegOnly?: boolean, cuisinePrefs?: string[] }` (at least one field). Invalidates home/recommendations Redis.

**API name:** Dish favourites  
**Paths:** `GET/POST/DELETE /customers/me/favorites/dishes[/:itemId]`  
**POST body:** `{ restaurantId }`. Store key `restaurantId:itemId`. Hydrate via restaurant `POST /internal/restaurants/:id/items/batch`. Favourite add/remove also invalidates home/recommendations Redis.

### Errors

| HTTP | code | When |
|---|---|---|
| 400 | `FAVORITE_LIMIT` | Cap exceeded |
| 404 | `MENU_ITEM_NOT_FOUND` | Item missing upstream |
| 503 | `RESTAURANT_SERVICE_UNAVAILABLE` | Hydrate down |

## FAQ

**Paths:** `GET /customers/support/faq?category=&q=` · `GET /customers/support/faq/:faqId`  
List: `[{ id, category, question, answerPreview }]`. Article: `{ id, category, question, answer, relatedIds[] }`.

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_FAQ_CATEGORY` | Unknown category |
| 404 | `NOT_FOUND` | Missing article |

## Close ticket + callback

**API name:** Close ticket  
**Method / path:** `POST /customers/support/tickets/:ticketId/close`  
Owner only → `status: closed`. Already closed → `409 CONFLICT`.

**API name:** Request callback  
**Method / path:** `POST /customers/support/callback`  
**Body:** `{ reason, window: 10_12|12_14|14_18|18_21, phone?, orderId? }`  
**Success `201`:** `{ requestId, status: "queued", window }` — never fakes a live call.

| HTTP | code | When |
|---|---|---|
| 409 | `CALLBACK_ALREADY_OPEN` | Open request within 2h |
| 429 | `CALLBACK_RATE_LIMITED` | >5 / hour |

---

# Customer loyalty / Super / scratch / telemetry — customer-service

Gateway: `/api/v1/customer-service`. §3 P2 LIVE. Earn: 1 pt / ₹10 on delivered orders via `POST /internal/loyalty/credit` (idempotent). Subscribe purchase stays on **payment-service**; this service catalogs + cancels + activates after paid webhook. Scratch issued only after deliver (`POST /internal/scratch/issue`); one card per `orderId`.

## Loyalty summary

**API name:** Loyalty summary  
**Method / path:** `GET /customers/loyalty`  
**Who:** Customer app. Auth: required.

### Success `200`

```json
{
  "success": true,
  "message": "Loyalty summary",
  "data": {
    "points": 1240,
    "tier": "gold",
    "nextThreshold": 20000,
    "nextTier": "platinum",
    "pointsToNextTier": 260,
    "rupeeValue": 124
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Not logged in |

## Loyalty history

**API name:** Loyalty history  
**Method / path:** `GET /customers/loyalty/history?page=1&limit=20`  
**Who:** Customer. Auth: required.

### Success `200`

`data`: `[{ id, type: "earn"|"burn", points, orderId, note, createdAt }]` + pagination `meta`.

## Subscription plans

**API name:** Subscription plans  
**Method / path:** `GET /customers/subscriptions/plans`  
**Who:** Customer splash / Super screen. Auth: public.

### Success `200`

```json
{
  "success": true,
  "message": "Subscription plans",
  "data": {
    "plans": [
      {
        "id": "super_monthly",
        "name": "Super",
        "period": "month",
        "price": 199,
        "benefits": ["free_delivery", "extra_discounts"],
        "freeDeliveryMinOrder": 199
      }
    ]
  }
}
```

## My subscription

**API name:** My subscription  
**Method / path:** `GET /customers/subscriptions/me`  
**Who:** Customer. Auth: required.  
**Success `200`:** `data` is `{ active, planId, expiresAt, autoRenew, status }` or `null`.

## Cancel subscription

**API name:** Cancel subscription at period end  
**Method / path:** `POST /customers/subscriptions/cancel`  
**Who:** Customer. Auth: required.  
Keeps `status: active` until `expiresAt`; sets `autoRenew: false`. Never fakes immediate revoke.

### Success `200`

```json
{
  "success": true,
  "message": "Subscription cancelled at period end",
  "data": {
    "active": true,
    "planId": "super_monthly",
    "expiresAt": "2026-09-13T00:00:00.000Z",
    "autoRenew": false,
    "status": "active",
    "message": "Cancelled at period end — access continues until expiresAt"
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `NOT_FOUND` | No active renewing subscription |

## Scratch cards

**API name:** List scratch cards  
**Method / path:** `GET /customers/scratch-cards`  
**Who:** Customer. Auth: required.  
**Success `200`:** `{ cards: [{ id, orderId, status, rewardType, expiresAt, revealedAt, points?, couponCode? }] }` — reward fields only when `revealed`.

**API name:** Reveal scratch card  
**Method / path:** `POST /customers/scratch-cards/:cardId/reveal`  
**Who:** Customer. Auth: required. Idempotent.

### Success `200`

```json
{
  "success": true,
  "message": "Scratch card revealed",
  "data": {
    "id": "66sc...",
    "status": "revealed",
    "rewardType": "points",
    "points": 50,
    "couponCode": null
  }
}
```

### Errors

| HTTP | code | When |
|---|---|---|
| 403 | `FORBIDDEN` | Not owner |
| 404 | `NOT_FOUND` | Missing card |
| 409 | `SCRATCH_EXPIRED` | Past `expiresAt` |

**API name:** Validate revealed scratch coupon (internal)  
**Method / path:** `GET /internal/scratch/coupon?userId=&code=`  
**Who:** cart-service. Auth: `x-internal-key`.

**Success `200`:** `{ valid: true, code, scratchCardId, campaignId, expiresAt, rewardType }`  
**Errors:** `404 SCRATCH_COUPON_INVALID` · `409 SCRATCH_EXPIRED` · `422 VALIDATION_ERROR`

## Crash report

**API name:** Crash report  
**Method / path:** `POST /customers/app/crash-report`  
**Who:** Customer app (guest OK). Auth: optional.  
**Body:** `{ platform: ios|android|web, appVersion, fingerprint, stack, deviceModel? }`  
**Success `201`:** `{ accepted: true, duplicate: boolean, reportId }`  
| HTTP | code | When |
|---|---|---|
| 429 | `CRASH_RATE_LIMITED` | >30 / hour |

## App feedback

**API name:** App feedback  
**Method / path:** `POST /customers/app/feedback`  
**Who:** Customer. Auth: required.  
**Body:** `{ rating: 1-5, comment? }`  
**Success `201`:** `{ id, rating, stored: true }`

## Internal loyalty credit

**API name:** Credit loyalty  
**Method / path:** `POST /internal/loyalty/credit`  
**Who:** order/payment. Auth: `x-internal-key`.  
**Body:** `{ userId, orderId, orderValue, idempotencyKey, note? }`  
**Success `200`:** `{ credited, duplicate, points, ledgerId }`

## Internal order stats

**API name:** Bump order stats  
**Method / path:** `POST /internal/profile/order-stats`  
**Who:** order. Auth: `x-internal-key`.  
**Body:** `{ userId, orderValue }`

## Internal scratch issue

**API name:** Issue scratch card  
**Method / path:** `POST /internal/scratch/issue`  
**Who:** order after deliver. Auth: `x-internal-key`.  
**Body:** `{ userId, orderId, orderValue, city? }`  
**Success:** `{ issued, duplicate, cardId, reason? }` (`201` when issued)

## Internal subscription activate

**API name:** Activate subscription  
**Method / path:** `POST /internal/subscriptions/activate`  
**Who:** payment-service after Super paid (webhook / verify). Auth: `x-internal-key`.  
**Body:** `{ userId, planKey, paymentRef, periodDays? }`  
Never mark active without `paymentRef`.

## Internal subscription for checkout

**API name:** Read Super for bill  
**Method / path:** `GET /internal/subscriptions/:userId`  
**Who:** cart-service. Auth: `x-internal-key`.  
**Success `200`:** `{ active, planKey, planId, expiresAt, autoRenew, status, freeDeliveryMinOrder }` — `active: false` when none (never invent).

## Internal loyalty for checkout

**API name:** Read loyalty for bill  
**Method / path:** `GET /internal/loyalty/:userId`  
**Who:** cart-service. Auth: `x-internal-key`.  
**Success `200`:** same DTO as `GET /customers/loyalty`.

**API name:** Redeem loyalty at checkout  
**Method / path:** `POST /internal/loyalty/redeem`  
**Who:** order-service. Auth: `x-internal-key`.  
**Body:** `{ userId, points, orderId?, idempotencyKey, note? }`  
**Success `200`:** `{ redeemed, duplicate, points, rupeeValue, ledgerId }`  
**Errors:** `400 LOYALTY_INSUFFICIENT`, `422 VALIDATION_ERROR`.

---

# Split pay — payment-service

Gateway: `/api/v1/payment-service`.

## Split wallet + UPI/card

**API name:** Split checkout  
**Method / full path:** `POST /api/v1/payment-service/payments/split`  
**Auth / caller:** 🔑 customer; checkout after `POST /orders` with `walletUsed > 0` and `grandTotal > 0`  
**Headers:** optional `Idempotency-Key`  
**Body:** `{ "orderId": "66…", "walletAmount": 120, "method": "upi" }` (`method` = `upi|card|netbanking`)

`walletAmount` must match the order snapshot. Razorpay is created for **remainder** (`order.grandTotal`) only. Wallet is **not** debited here — debit + loyalty redeem run on `POST /payments/verify` or Razorpay `payment.captured` (idempotent).

**Success `201`:** same shape as initiate (`payment` + `gatewaySession` with `key_id`, Razorpay `id`, `amount` in paise).

**Errors:** `400 WALLET_REQUIRED_FOR_SPLIT` · `WALLET_AMOUNT_MISMATCH` · `WALLET_INSUFFICIENT` · `NOTHING_TO_CHARGE` · `NOT_SPLITTABLE` · `409 ILLEGAL_TRANSITION` · `403 WALLET_LOCKED` · `404 ORDER_NOT_FOUND` · `503 ORDER_SERVICE_UNAVAILABLE` · `USER_SERVICE_UNAVAILABLE` · `GATEWAY_UNAVAILABLE`

## Save payment method (Razorpay token)

**API name:** Save card / UPI  
**Method / full path:** `POST /api/v1/payment-service/payments/methods`  
**Auth / caller:** 🔑 customer  
**Body:** `{ "type": "card"|"upi"|"netbanking"|"wallet_linked", "razorpayPaymentId"?: "pay_…", "razorpayTokenId"?: "token_…", "gatewayToken"?: "…", "upiId"?: "user@okicici", "last4"?: "4242", "brand"?: "Visa", "expiryMonth"?: 12, "expiryYear"?: 2028, "isDefault"?: false }`

Cards: Razorpay `payments.fetch` after checkout `save=1` (preferred) or verify `razorpayTokenId` on the Razorpay customer. Creates Razorpay customer if needed. Keys missing → `503 GATEWAY_UNAVAILABLE`. Never stores PAN.

**Success `201`:** saved method (`gatewayToken`, `last4`, `brand`, `razorpayCustomerId`, …).  
**Errors:** `422 TOKEN_REQUIRED` · `400 PAYMENT_NOT_TOKENIZABLE` · `TOKEN_NOT_ISSUED` · `404 TOKEN_NOT_FOUND` · `503 GATEWAY_UNAVAILABLE`

`DELETE /payments/methods/:methodId` revokes the Razorpay token when `razorpayCustomerId` is present.

## UPI collect intent

**API name:** UPI collect intent  
**Method / full path:** `GET /api/v1/payment-service/payments/methods/upi/collect?orderId=`  
**Auth / caller:** 🔑 customer  
Without `orderId`: `{ configured, available }` (Razorpay keys present). With `orderId`: last collect status + amount. Ownership enforced via order internal batch.

## UPI collect request

**API name:** Create UPI collect  
**Method / full path:** `POST /api/v1/payment-service/payments/methods/upi/collect`  
**Auth / caller:** 🔑 customer; pending_payment non-COD order  
**Headers:** optional `Idempotency-Key`  
**Body:** `{ "orderId": "66…", "vpa": "user@okicici" }`

Razorpay `payments/create/json` collect to customer VPA. Never rider UPI. Pending collect for the same order is replayed (no second collect). Capture still via `POST /payments/verify` / `payment.captured`.

**Success `201`:** `{ paymentId, orderId, amount, vpaMasked, status, collectStatus: "pending", expiresAt, gatewayOrderId }`

**Errors:** `422 INVALID_VPA` · `400 NOT_COLLECTABLE` · `NOTHING_TO_CHARGE` · `409 ILLEGAL_TRANSITION` · `403 FORBIDDEN` · `404 ORDER_NOT_FOUND` · `503 UPI_COLLECT_UNAVAILABLE` · `ORDER_SERVICE_UNAVAILABLE`

## Customer doorstep UPI QR

**API name:** Customer doorstep QR  
**Method / full path:** `POST /api/v1/payment-service/payments/doorstep/upi-qr`  
**Auth / caller:** 🔑 customer; COD / pay_on_delivery order  
**Body:** `{ "orderId": "66…", "amount": 1026 }` (`amount` optional → order `grandTotal`)

Platform VPA (`PLATFORM_UPI_VPA`) and/or Razorpay QR — **never** rider personal UPI. Same DTO as rider internal QR.

**Success `200`:** `{ orderId, amount, upiIntent, qrImageUrl, qrId, expiresAt, source: "razorpay"|"upi_intent" }`

**Errors:** `400 NOT_COD` · `409 ILLEGAL_TRANSITION` · `COD_ALREADY_SETTLED` · `503 UPI_QR_UNAVAILABLE`

## Admin refunds queue

**API name:** List refunds (ops)  
**Method / full path:** `GET /api/v1/payment-service/admin/refunds?status=&orderId=&page=&limit=`  
**Auth / caller:** 🔐 `admin` / `super_admin`  
**Success `200`:** paginated refund rows (`initiated` = awaiting ops).

**API name:** Approve refund  
**Method / full path:** `PUT /api/v1/payment-service/admin/refunds/:refundId/approve`  
**Auth / caller:** 🔐 admin  
`original_payment` → Razorpay refund (never fake success). `wallet` → user `POST /internal/wallet/credit` `source=refund` (idempotent). Already-success replays.

**API name:** Reject refund  
**Method / full path:** `PUT /api/v1/payment-service/admin/refunds/:refundId/reject`  
**Body:** `{ "reason": "…" }` → status `rejected`.

Customer `POST /payments/refunds/request` **queues** (`initiated`) and does not call the gateway. Kitchen/internal cancel still refunds immediately.

**Errors:** `404 REFUND_NOT_FOUND` · `409 ILLEGAL_TRANSITION` · `REFUND_PENDING` · `ALREADY_REFUNDED` · `502 GATEWAY_UNAVAILABLE` · `503 USER_SERVICE_UNAVAILABLE`

## Verify online / split payment

**API name:** Verify gateway payment  
**Method / full path:** `POST /api/v1/payment-service/payments/verify`  
**Auth / caller:** 🔑 customer  
**Body:** `{ "paymentId", "gatewayPaymentId", "gatewayOrderId", "gatewaySignature" }`

HMAC-verified Razorpay capture. Then fail-closed: order `pending_payment` → `placed` (settles wallet debit + loyalty burn) → `paymentStatus: paid`. Same `source+referenceId` / loyalty idempotency key replays without a second debit.

Already-success payments **re-settle then return 200** (do not 409) so a flaky first verify can retry after `503 ORDER_SETTLE_FAILED`.

Razorpay `payment.captured` uses the same settle path; settle failure → webhook `500` so Razorpay retries.

**Success `200`:** payment DTO (`status: success`).

**Errors:** `400` invalid signature · `404` payment not found · `503 ORDER_SERVICE_UNAVAILABLE` · `ORDER_SETTLE_FAILED` · `USER_SERVICE_UNAVAILABLE` · `CUSTOMER_SERVICE_UNAVAILABLE` · `400 WALLET_INSUFFICIENT` · `400 LOYALTY_INSUFFICIENT` · `403 WALLET_LOCKED`

---

# Customer admin CMS cities + support queue — customer-service

Gateway: `/api/v1/customer-service`. §5 LIVE. Auth: `admin` / `super_admin`.

## Launch cities

**API name:** List launch cities  
**Method / path:** `GET /admin/cities`  
**Who:** Admin panel.  
Merges delivery `GET /public/cities` with Mongo `LaunchCity` overrides. Never invents cities.

**API name:** Update launch city flags  
**Method / path:** `PUT /admin/cities/:cityId`  
**Body:** `{ isLive?, hours?: { open, close, tz }, flags?: { codEnabled, alcoholEnabled }, name? }`  
**404** if `cityId` not in delivery catalog (create zone on delivery-service first).  
**503** `DELIVERY_SERVICE_UNAVAILABLE` if delivery down.

### Success `200`

```json
{
  "success": true,
  "message": "Launch city updated",
  "data": {
    "id": "delhi",
    "name": "Delhi NCR",
    "isLive": true,
    "hours": { "open": "09:00", "close": "23:00", "tz": "Asia/Kolkata" },
    "flags": { "codEnabled": true, "alcoholEnabled": false }
  }
}
```

## Support ticket queue

**API name:** Admin ticket queue  
**Method / path:** `GET /admin/support/tickets?status=&category=&priority=&assignedTo=unassigned&search=&page=&limit=`  
**Success `200`:** paginated `TicketDto[]`.

**API name:** Admin get ticket  
**Method / path:** `GET /admin/support/tickets/:ticketId`  
Marks customer messages read for agent.

**API name:** Assign ticket  
**Method / path:** `PUT /admin/support/tickets/:ticketId/assign`  
**Body:** `{ "agentId": "66…" }` (optional — defaults to authenticated admin). Sets `status: in_progress`.

**API name:** Agent reply  
**Method / path:** `POST /admin/support/tickets/:ticketId/messages`  
**Body:** `{ "content": "…", "attachments?": [] }` · sender `agent`.  
Persists message then calls notification `POST /internal/dispatch`. Response includes `pushed` + `degradedReason` — never fakes push success. Env: `NOTIFICATION_SERVICE_URL`.

**API name:** Resolve ticket  
**Method / path:** `PUT /admin/support/tickets/:ticketId/resolve`  
**Body:** `{ "resolution": "…", "close": true }` → `resolved` or `closed`.

### Errors

| HTTP | code | When |
|---|---|---|
| 404 | `NOT_FOUND` | Ticket / city missing |
| 409 | `TICKET_CLOSED` | Assign/reply on resolved/closed |
| 409 | `CONFLICT` | Already resolved/closed |
| 422 | `VALIDATION_ERROR` | Bad filters/body |
| 503 | `DELIVERY_SERVICE_UNAVAILABLE` | Cities aggregate down |

## Admin subscription plans (P2)

**API name:** Admin subscription plans CRUD  
**Paths:** `GET/POST /admin/subscriptions/plans` · `PUT/DELETE /admin/subscriptions/plans/:id`  
**Who:** Admin. Auth: admin/super_admin.

**POST body:** `{ planKey, name, period: "month"|"year", price, benefits?, freeDeliveryMinOrder?, isActive?, sortOrder? }`  
**DELETE:** soft-deactivates (`isActive: false`) — keeps planKey for existing subscriptions. Customer catalog only lists active plans.

### Success `201` create

```json
{
  "success": true,
  "message": "Plan created",
  "data": {
    "id": "66pl...",
    "planKey": "super_monthly",
    "name": "Super",
    "period": "month",
    "price": 199,
    "benefits": ["free_delivery"],
    "freeDeliveryMinOrder": 199,
    "isActive": true,
    "sortOrder": 0,
    "createdAt": "2026-08-13T00:00:00.000Z",
    "updatedAt": "2026-08-13T00:00:00.000Z"
  }
}
```

| HTTP | code | When |
|---|---|---|
| 409 | `CONFLICT` | Duplicate `planKey` |
| 404 | `NOT_FOUND` | Unknown plan id |
| 422 | `VALIDATION_ERROR` | Bad body |

## Admin scratch campaigns (P2)

**API name:** Admin scratch campaigns CRUD  
**Paths:** `GET/POST /admin/scratch-campaigns` · `PUT/DELETE /admin/scratch-campaigns/:id`  
**Who:** Admin.

**POST body:** `{ name, rewardType: "points"|"coupon"|"none", orderMin?, points?, couponCode?, city?, expiresInDays?, isActive? }`  
`points` required when `rewardType=points`; `couponCode` required when `coupon`.  
**DELETE:** soft-deactivates. Active campaigns drive `POST /internal/scratch/issue` after deliver.

### Success `201` create

```json
{
  "success": true,
  "message": "Scratch campaign created",
  "data": {
    "id": "66sc...",
    "name": "Post-order points",
    "orderMin": 199,
    "rewardType": "points",
    "points": 50,
    "couponCode": null,
    "city": null,
    "expiresInDays": 7,
    "isActive": true,
    "createdAt": "2026-08-13T00:00:00.000Z",
    "updatedAt": "2026-08-13T00:00:00.000Z"
  }
}
```

| HTTP | code | When |
|---|---|---|
| 404 | `NOT_FOUND` | Unknown campaign id |
| 422 | `VALIDATION_ERROR` | Missing points/coupon for reward type |

## Internal recent restaurant / search

**API name:** Push recent restaurant  
**Method / path:** `POST /internal/recent/restaurant`  
**Who:** order-service on deliver. Auth: `x-internal-key`.  
**Body:** `{ userId, restaurantId }`  
**Success `200`:** `{ userId, restaurantId, pushed: true }` — find-or-create profile, dedupe, capped list.

**API name:** Push recent search  
**Method / path:** `POST /internal/recent/search`  
**Who:** search-service after logged-in search. Auth: `x-internal-key`.  
**Body:** `{ userId, query }` (1–120 chars)  
**Success `200`:** `{ userId, query, pushed: true }`

Read path: `GET /customers/me/recent` hydrates restaurants via restaurant batch.

### Callers

| Caller | When |
|---|---|
| order-service | On `delivered` also calls loyalty credit + order-stats + scratch issue (logged degrade, never blocks deliver) |
| search-service | After Redis recent push — requires `CUSTOMER_SERVICE_URL` + `INTERNAL_API_KEY` |
| payment-service | After Super paid (Razorpay webhook / verify) → `POST /internal/subscriptions/activate` |

---

# Super subscribe — payment-service

Gateway: `/api/v1/payment-service`. Auth: customer JWT + CSRF. Env: `CUSTOMER_SERVICE_URL`, `INTERNAL_API_KEY`, Razorpay keys.

## Subscribe (initiate)

**API name:** Subscribe Super  
**Method / path:** `POST /payments/subscriptions/subscribe`  
**Who:** Customer app.  
**Body:** `{ "planId": "super_monthly", "method": "upi", "gateway?": "razorpay", "idempotencyKey?" }`  
Amount is loaded from customer-service `GET /customers/subscriptions/plans` — never trust client price. COD rejected by schema. Status stays `pending` until paid; never returns `active`.

### Success `201`

```json
{
  "success": true,
  "message": "Subscription payment initiated",
  "data": {
    "paymentId": "66…",
    "planKey": "super_monthly",
    "amount": 149,
    "status": "pending",
    "gatewaySession": {
      "id": "order_…",
      "amount": 14900,
      "currency": "INR",
      "key_id": "rzp_…",
      "requiresGateway": true,
      "kind": "subscription",
      "planKey": "super_monthly"
    }
  }
}
```

| HTTP | code | When |
|---|---|---|
| 404 | `PLAN_NOT_FOUND` | Unknown / inactive plan |
| 503 | `CUSTOMER_SERVICE_UNAVAILABLE` | Plan catalog unreachable |
| 422 | `VALIDATION_ERROR` | Bad body (incl. COD) |

## Verify / activate

**API name:** Verify Super payment  
**Method / path:** `POST /payments/subscriptions/verify` (also `POST /payments/verify` if order payment id missing)  
**Body:** `{ paymentId, gatewayPaymentId, gatewayOrderId, gatewaySignature }`  
Marks `SubscriptionPayment` success, then calls customer `POST /internal/subscriptions/activate` with `{ userId, planKey, paymentRef, periodDays }`. If activate fails, payment stays `success` with `customerActivated: false` (honest degrade; retry verify).

Razorpay `payment.captured` webhook uses the same activate path when `notes.kind=subscription` or gateway order matches a subscription payment.

### Success `200`

```json
{
  "success": true,
  "message": "Subscription payment verified and activated",
  "data": {
    "paymentId": "66…",
    "planKey": "super_monthly",
    "status": "success",
    "customerActivated": true,
    "paymentRef": "pay_…"
  }
}
```

