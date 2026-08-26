# Restaurant App — complete API list (all services)

> **Who:** Restaurant / kitchen iOS · Android · web (owner + staff).  
> **Source:** actual routes in code (not customer browse, rider, or admin panel).  
> **Gateway:** `{BASE}/api/v1/{service-prefix}{path}` except gateway host paths.  
> **Auth:** cookie `_sid` (role `restaurant_owner` or outlet staff). Mutating methods: CSRF `GET /api/csrf-token` → header `x-csrf-token`.  
> **Contracts:** [API_REQUEST_RESPONSE.md](API_REQUEST_RESPONSE.md) · service inventories [RESTAURANT_SERVICE_APIS.md](RESTAURANT_SERVICE_APIS.md) · [ORDER_SERVICE_APIS.md](ORDER_SERVICE_APIS.md)  
> **Platform table:** [API_ROUTES_REFERENCE.md](API_ROUTES_REFERENCE.md)

Implement **every LIVE row** below. Prefer **restaurant-service** kitchen paths — they already proxy order / delivery / payment / review / notification. Do **not** call `/admin/*`, `/internal/*`, `/partners/me/*`, customer home/cart/checkout, or legacy `admin-service`.

**Audit vs code (this file is complete for the restaurant app):** every LIVE kitchen/owner route in `restaurant-service/src/routes/restaurant.routes.ts` + `index.ts` (`/cuisines`, `/health*`) is listed below. Customer-only (`GET /`, `/nearby`, `/slug`, `notify-open`, `notify-stock`, `/alerts/me`), admin `DELETE /restaurants/:id`, and all `/admin/*` + `/internal/*` are **intentionally omitted**. Order / delivery / payment / review kitchen jobs are listed as **ALIAS** — implement the restaurant-service path, not both.

| Legend | Meaning |
|---|---|
| 🔓 | Public (no login) |
| 🔑 | Logged-in `_sid` (owner or staff of that outlet) |
| 🏪 | `restaurant_owner` (create outlet / KYC / bank) |
| **LIVE** | Wired in code — call it |
| **PROXY** | Restaurant-service calls another service; app still uses this path |
| **ALIAS** | Same job exists on another service — **do not duplicate** in the app |

---

## 0. Implement order (screens)

1. Splash → `GET /restaurants/:id/config` (min kitchen app version)  
2. Login → user-service (`role=restaurant_owner` on register)  
3. Outlets → `GET /restaurants/my` (or staff accept invite)  
4. Onboarding → KYC docs → submit (stays `pending` until **admin** approves)  
5. Bank → IFSC lookup → save account  
6. Duty → `GET /duty` → `PUT /online` (needs listing `active`) / `offline` / `pause`  
7. Menu → categories + items + modifiers + 86  
8. KDS → `GET /orders/kds` + sockets `join:restaurant`  
9. Order → accept → preparing → ready → handover OTP. If rider returns the bag: `kind: "return"` OTP / tap receive → trip `returned`  
10. Payouts / reviews / staff / analytics / fleet  

**Go-live gate:** admin `PUT /admin/restaurants/:id/approve` (admin panel, not this app). Until then `PUT /online` returns `409 PARTNER_NOT_ACTIVE`.

---

## 1. Gateway

**Prefix:** none (gateway host)

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/health` | 🔓 | Liveness |
| LIVE | `GET` | `/health/ready` | 🔓 | Downstream ready |
| LIVE | `GET` | `/api/csrf-token` | 🔓 | CSRF for POST/PUT/PATCH/DELETE |
| LIVE | `POST` | `/api/v1/socket-token` | 🔑 | Short-lived Socket.IO token (`auth.socketToken`) |
| LIVE | WS | `{GATEWAY}/socket.io/` | 🔑 `auth.socketToken` / `_sid` | Realtime kitchen |

After connect, emit **`join:restaurant`** with the outlet id **string** (same pattern as customer `track:order`) to join room `restaurant:{id}`.

### Sockets (kitchen)

| Status | Dir | Event | Use |
|---|---|---|---|
| LIVE | C→S | `join:restaurant` | Join outlet room |
| LIVE | C→S | `track:order` | Optional: join `order:{orderId}` for one ticket |
| LIVE | S→C | `kitchen:order-new` | Incoming order (KDS ping) |
| LIVE | S→C | `kitchen:order-status` | Status after accept/prep/ready |
| LIVE | S→C | `kitchen:order-cancelled` | Customer / ops cancel |
| LIVE | S→C | `order:status` | Same order status (restaurant room + order room) |
| LIVE | S→C | `order:items-removed` | Bill after kitchen 86 (order room; emit `track:order`) |
| LIVE | S→C | `kitchen:rider-assigned` | Rider assigned |
| LIVE | S→C | `kitchen:rider-arrived` | Rider at store |
| LIVE | S→C | `kitchen:scheduled-due` | Scheduled slot due |
| LIVE | S→C | `delivery:status` | Trip status at outlet |
| LIVE | S→C | `payment:cod-paid` | Doorstep COD collected (order room) |
| LIVE | S→C | `notification:new` | Inbox badge |
| LIVE | Both | `chat:new-message` | In-trip chat (restaurant room) |
| LIVE | Both | `typing` | Typing dots |

Kitchen send: `join:restaurant` `restaurantId` (string), optional `track:order` `orderId` (string), `chat:new-message` `{ orderId, text, to: "customer"|"partner" }`, `typing` `{ orderId, isTyping }`. No kitchen chat REST — sockets only.

---

## 2. user-service — auth + account

**Prefix:** `/api/v1/user-service`

Register with `"role": "restaurant_owner"`. Staff log in as normal users after `POST .../staff/accept`.

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/health` | 🔓 | Liveness |
| LIVE | `POST` | `/auth/register` | 🔓 | Sign up (`role=restaurant_owner`) |
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
| LIVE | `GET` | `/users/me` | 🔑 | Profile |
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

Do **not** wire customer-only account APIs in the kitchen UI: wallet, referral, age-gate, dietary prefs.

---

## 3. restaurant-service — outlet, menu, KDS (canonical)

**Prefix:** `/api/v1/restaurant-service`

Staff must have access to `:restaurantId` (owner or roster). Else `403`.

### 3.1 Outlets + listing

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/health` | 🔓 | Liveness |
| LIVE | `GET` | `/health/ready` | 🔓 | Mongo + Redis |
| LIVE | `GET` | `/cuisines` | 🔓 | Cuisine catalog (create/edit outlet chips) |
| LIVE | `GET` | `/restaurants/my` | 🔑🏪 | Outlets I own |
| LIVE | `POST` | `/restaurants` | 🔑🏪 | Create outlet (`pending`) |
| LIVE | `GET` | `/restaurants/:restaurantId` | 🔑 | Outlet detail (owner sees full doc) |
| LIVE | `PUT` | `/restaurants/:restaurantId` | 🔑 | Edit name, pin, phone, cuisines |
| LIVE | `GET` | `/restaurants/:restaurantId/config` | 🔑 | Min app version, flags, reject reasons |
| LIVE | `GET` | `/restaurants/:restaurantId/duty` | 🔑 | Online / pause / hours snapshot |
| LIVE | `PUT` | `/restaurants/:restaurantId/online` | 🔑 | Go online (`409 PARTNER_NOT_ACTIVE` if not approved) |
| LIVE | `PUT` | `/restaurants/:restaurantId/offline` | 🔑 | Stop new orders; in-flight continue |
| LIVE | `PUT` | `/restaurants/:restaurantId/pause` | 🔑 | Busy `{ minutes, reason }` 1–120 |
| LIVE | `PUT` | `/restaurants/:restaurantId/status` | 🔑 | Duty `online`/`offline` only — **never** self-set `active` (admin approve) |
| LIVE | `GET` | `/restaurants/:restaurantId/surge-status` | 🔑 | Zone rain/surge chip |
| LIVE | `GET` | `/restaurants/:restaurantId/timings` | 🔑 | Week hours + `isOpenNow` |
| LIVE | `PUT` | `/restaurants/:restaurantId/timings` | 🔑 | Set weekly IST hours |
| LIVE | `GET` | `/restaurants/:restaurantId/holidays` | 🔑 | Closed dates |
| LIVE | `PUT` | `/restaurants/:restaurantId/holidays` | 🔑 | Replace holidays |
| LIVE | `GET` | `/restaurants/:restaurantId/special-hours` | 🔑 | One-day overrides |
| LIVE | `PUT` | `/restaurants/:restaurantId/special-hours` | 🔑 | Set / remove special hours |
| LIVE | `PUT` | `/restaurants/:restaurantId/settings` | 🔑 | Prep time, COD, alcohol (`ALCOHOL_NOT_ALLOWED_IN_CITY`) |
| LIVE | `GET` | `/restaurants/:restaurantId/hygiene` | 🔑 | FSSAI masked + score |
| LIVE | `GET` | `/restaurants/:restaurantId/ratings` | 🔑 | Star histogram |
| LIVE | `POST` | `/restaurants/:restaurantId/logo` | 🔑 | Logo upload |
| LIVE | `POST` | `/restaurants/:restaurantId/cover` | 🔑 | Cover upload |
| LIVE | `POST` | `/restaurants/:restaurantId/images` | 🔑 | Gallery |
| LIVE | `DELETE` | `/restaurants/:restaurantId/images/:imageId` | 🔑 | Remove gallery image |

### 3.2 Onboarding + bank

Three separate tracks — do **not** treat them as the same “live” flag:

| Track | Field | Who flips it | Owner app |
|---|---|---|---|
| **Listing** | `listingStatus` (`pending` → `active`) | **Ops only** `PUT /admin/restaurants/:id/approve` | “Listing live” + go-online. Create/submit/bank never set `active`. `409 PARTNER_NOT_ACTIVE` until then. |
| **KYC** | `kycStatus` (`draft` → `submitted`) | Owner `POST .../onboarding/submit` | “Under review”. Listing stays `pending`. Docs stay `uploaded` until ops verify each file. |
| **Bank** | `verificationStatus` | Owner PUT saves `unverified`; ops/penny-drop later | Payouts off until `verified`. Saving an account is not listing live. |

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/restaurants/:restaurantId/onboarding` | 🔑🏪 | Checklist %, `canSubmit` |
| LIVE | `GET` | `/restaurants/:restaurantId/onboarding/documents` | 🔑🏪 | KYC docs |
| LIVE | `POST` | `/restaurants/:restaurantId/onboarding/documents` | 🔑🏪 | Multipart FSSAI/GST/PAN/cheque/photos |
| LIVE | `POST` | `/restaurants/:restaurantId/onboarding/submit` | 🔑🏪 | Submit review (`409 KYC_INCOMPLETE`) |
| LIVE | `GET` | `/restaurants/:restaurantId/bank/ifsc/:ifsc` | 🔑🏪 | IFSC lookup |
| LIVE | `GET` | `/restaurants/:restaurantId/bank` | 🔑🏪 | Masked account |
| LIVE | `PUT` | `/restaurants/:restaurantId/bank` | 🔑🏪 | Save account (stays `unverified` until ops verify) |

### 3.3 Menu — categories, items, modifiers

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/restaurants/:restaurantId/menu` | 🔑 | Full menu (kitchen sees 86 + schedules) |
| LIVE | `GET` | `/restaurants/:restaurantId/menu/search` | 🔑 | SKU search `?q=` for 86 |
| LIVE | `GET` | `/restaurants/:restaurantId/unavailable` | 🔑 | Currently 86’d item ids |
| LIVE | `GET` | `/restaurants/:restaurantId/categories` | 🔑 | Categories |
| LIVE | `POST` | `/restaurants/:restaurantId/categories` | 🔑 | Create category |
| LIVE | `PUT` | `/restaurants/:restaurantId/categories/reorder` | 🔑 | Drag order |
| LIVE | `PUT` | `/restaurants/:restaurantId/categories/:categoryId` | 🔑 | Edit category |
| LIVE | `PUT` | `/restaurants/:restaurantId/categories/:categoryId/schedule` | 🔑 | Breakfast/lunch/dinner windows |
| LIVE | `DELETE` | `/restaurants/:restaurantId/categories/:categoryId` | 🔑 | Delete category |
| LIVE | `GET` | `/restaurants/:restaurantId/modifier-groups` | 🔑 | Size / crust library |
| LIVE | `POST` | `/restaurants/:restaurantId/modifier-groups` | 🔑 | Create group + options |
| LIVE | `PUT` | `/restaurants/:restaurantId/modifier-groups/:groupId` | 🔑 | Update group |
| LIVE | `DELETE` | `/restaurants/:restaurantId/modifier-groups/:groupId` | 🔑 | Delete group |
| LIVE | `GET` | `/restaurants/:restaurantId/items` | 🔑 | List items |
| LIVE | `GET` | `/restaurants/:restaurantId/items/:itemId` | 🔑 | Item + modifiers |
| LIVE | `GET` | `/restaurants/:restaurantId/items/:itemId/customizations` | 🔑 | Addon groups only |
| LIVE | `POST` | `/restaurants/:restaurantId/categories/:categoryId/items` | 🔑 | Create item |
| LIVE | `PUT` | `/restaurants/:restaurantId/items/:itemId` | 🔑 | Edit item |
| LIVE | `PUT` | `/restaurants/:restaurantId/items/:itemId/modifiers` | 🔑 | Attach groups + price overrides |
| LIVE | `PUT` | `/restaurants/:restaurantId/items/:itemId/availability` | 🔑 | 86 / un-86 `{ isAvailable, unavailableUntil?, reason? }` |
| LIVE | `POST` | `/restaurants/:restaurantId/items/:itemId/image` | 🔑 | Item photo |
| LIVE | `DELETE` | `/restaurants/:restaurantId/items/:itemId/image` | 🔑 | Remove photo |
| LIVE | `POST` | `/restaurants/:restaurantId/items/:itemId/duplicate` | 🔑 | Clone SKU |
| LIVE | `DELETE` | `/restaurants/:restaurantId/items/:itemId` | 🔑 | Delete item |
| LIVE | `POST` | `/restaurants/:restaurantId/items/bulk-price` | 🔑 | Bulk prices |
| LIVE | `PUT` | `/restaurants/:restaurantId/items/reorder` | 🔑 | `{ itemIds }` |
| LIVE | `POST` | `/restaurants/:restaurantId/items/bulk-availability` | 🔑 | Bulk 86 |
| LIVE | `POST` | `/restaurants/:restaurantId/items/bulk-import` | 🔑 | JSON import |

### 3.4 Chain / multi-outlet

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/restaurants/:restaurantId/chain/siblings` | 🔑 | Sibling outlets |
| LIVE | `POST` | `/restaurants/:restaurantId/chain/clone-menu` | 🔑 | Clone menu (`merge`\|`replace`) |
| LIVE | `POST` | `/restaurants/:restaurantId/chain/apply-prices` | 🔑 | Push prices |
| LIVE | `POST` | `/restaurants/:restaurantId/chain/apply-availability` | 🔑 | Push 86 state |
| LIVE | `PUT` | `/restaurants/:restaurantId/chain/apply-settings` | 🔑 | Sync settings (not commission) |

### 3.5 Kitchen board + orders (PROXY → order-service)

Use **these** paths in the restaurant app (not `/api/v1/order-service/orders/restaurant*`).

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/restaurants/:restaurantId/orders/kds` | 🔑 | Board: new / preparing / ready / delayed |
| LIVE | `GET` | `/restaurants/:restaurantId/orders` | 🔑 | Incoming list |
| LIVE | `GET` | `/restaurants/:restaurantId/orders/history` | 🔑 | Past `?from=&to=&page=&limit=` |
| LIVE | `GET` | `/restaurants/:restaurantId/orders/scheduled` | 🔑 | Upcoming scheduled |
| LIVE | `GET` | `/restaurants/:restaurantId/reject-reasons` | 🔑 | Reject catalog |
| LIVE | `GET` | `/restaurants/:restaurantId/orders/:orderId` | 🔑 | Ticket detail |
| LIVE | `PUT` | `/restaurants/:restaurantId/orders/:orderId/accept` | 🔑 | Accept |
| LIVE | `PUT` | `/restaurants/:restaurantId/orders/:orderId/reject` | 🔑 | Reject `{ reasonCode, note? }` |
| LIVE | `PUT` | `/restaurants/:restaurantId/orders/:orderId/preparing` | 🔑 | Start cook |
| LIVE | `PUT` | `/restaurants/:restaurantId/orders/:orderId/ready` | 🔑 | Ready → dispatch assign |
| LIVE | `PUT` | `/restaurants/:restaurantId/orders/:orderId/out-for-delivery` | 🔑 | Out for delivery |
| LIVE | `PUT` | `/restaurants/:restaurantId/orders/:orderId/prep-time` | 🔑 | Override prep minutes |
| LIVE | `PUT` | `/restaurants/:restaurantId/orders/:orderId/delay` | 🔑 | Running late |
| LIVE | `POST` | `/restaurants/:restaurantId/orders/:orderId/cancel` | 🔑 | Abort accepted/preparing |
| LIVE | `POST` | `/restaurants/:restaurantId/orders/:orderId/items-unavailable` | 🔑 | Drop 86’d lines + reprice |
| LIVE | `GET` | `/restaurants/:restaurantId/orders/:orderId/sla` | 🔑 | Accept-by / prep-by |
| LIVE | `POST` | `/restaurants/:restaurantId/orders/:orderId/print-kot` | 🔑 | KOT print |
| LIVE | `PUT` | `/restaurants/:restaurantId/orders/:orderId/pickup-ready` | 🔑 | Takeaway ready |
| LIVE | `PUT` | `/restaurants/:restaurantId/orders/:orderId/complete-takeaway` | 🔑 | Takeaway handed over |
| LIVE | `GET` | `/restaurants/:restaurantId/orders/:orderId/handover` | 🔑 PROXY | Pickup **or return** OTP (`kind`) |
| LIVE | `PUT` | `/restaurants/:restaurantId/orders/:orderId/handover` | 🔑 PROXY | Confirm `{ otp }` or `{ tap }` — pickup or receive returned bag |
| LIVE | `GET` | `/restaurants/:restaurantId/orders/:orderId/rider` | 🔑 PROXY | Assigned rider snippet |
| LIVE | `POST` | `/restaurants/:restaurantId/orders/:orderId/call-customer` | 🔑 PROXY | Masked call (`503 MASKED_CALL_UNAVAILABLE`) |
| LIVE | `POST` | `/restaurants/:restaurantId/orders/:orderId/manual-assign` | 🔑 PROXY | Assign self-fleet rider |
| LIVE | `POST` | `/restaurants/:restaurantId/orders/:orderId/rate-partner` | 🔑 PROXY | Rate pickup rider |

### 3.6 Self-fleet (PROXY → delivery-service)

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `POST` | `/restaurants/:restaurantId/fleet/invitations` | 🔑 | Invite rider |  
| LIVE | `GET` | `/restaurants/:restaurantId/fleet/invitations` | 🔑 | List invites |
| LIVE | `DELETE` | `/restaurants/:restaurantId/fleet/invitations/:invitationId` | 🔑 | Cancel invite |
| LIVE | `GET` | `/restaurants/:restaurantId/fleet/partners` | 🔑 | Roster |
| LIVE | `GET` | `/restaurants/:restaurantId/fleet/partners/:partnerId` | 🔑 | Rider detail |
| LIVE | `PUT` | `/restaurants/:restaurantId/fleet/partners/:partnerId/status` | 🔑 | Activate / suspend |
| LIVE | `GET` | `/restaurants/:restaurantId/fleet/available-partners` | 🔑 | Nearby online `?lat=&lng=` |

### 3.7 Offers

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/restaurants/:restaurantId/offers` | 🔑 | All offers (owner) |
| LIVE | `GET` | `/restaurants/:restaurantId/offers/:offerId` | 🔑 | Offer detail |
| LIVE | `POST` | `/restaurants/:restaurantId/offers` | 🔑 | Create |
| LIVE | `PUT` | `/restaurants/:restaurantId/offers/:offerId` | 🔑 | Update |
| LIVE | `DELETE` | `/restaurants/:restaurantId/offers/:offerId` | 🔑 | Delete |

### 3.8 Staff

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/restaurants/:restaurantId/staff` | 🔑 | Roster + pending invites |
| LIVE | `POST` | `/restaurants/:restaurantId/staff` | 🔑 | Direct-add `{ userId }` |
| LIVE | `POST` | `/restaurants/:restaurantId/staff/invite` | 🔑 | Invite phone/email |
| LIVE | `POST` | `/restaurants/:restaurantId/staff/accept` | 🔑 | Accept `{ token }` (new staff user) |
| LIVE | `PUT` | `/restaurants/:restaurantId/staff/:staffId` | 🔑 | Role / permissions / active |
| LIVE | `DELETE` | `/restaurants/:restaurantId/staff/:staffId` | 🔑 | Deactivate |

### 3.9 Analytics (PROXY → order-service)

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/restaurants/:restaurantId/analytics` | 🔑 | Overview |
| LIVE | `GET` | `/restaurants/:restaurantId/analytics/revenue` | 🔑 | `?period=day\|week\|month` |
| LIVE | `GET` | `/restaurants/:restaurantId/analytics/top-items` | 🔑 | Top SKUs |
| LIVE | `GET` | `/restaurants/:restaurantId/analytics/orders` | 🔑 | By hour / status |
| LIVE | `GET` | `/restaurants/:restaurantId/analytics/cancellations` | 🔑 | Reject/cancel rates |
| LIVE | `GET` | `/restaurants/:restaurantId/analytics/export` | 🔑 | CSV `?from=&to=` (max 90d) |

### 3.10 Reviews, payouts, support, devices, inbox (PROXY)

| Status | Method | Path | Auth | Downstream |
|---|---|---|---|---|
| LIVE | `GET` | `/restaurants/:restaurantId/reviews` | 🔑 | Inbox `?page=&limit=&rating=&unanswered=1` (includes `images[]`) |
| LIVE | `POST` | `/restaurants/:restaurantId/reviews/:reviewId/reply` | 🔑 | Owner reply |
| LIVE | `DELETE` | `/restaurants/:restaurantId/reviews/:reviewId` | 🔑 | Soft-delete |
| LIVE | `GET` | `/restaurants/:restaurantId/payouts` | 🔑 | payment-service |
| LIVE | `GET` | `/restaurants/:restaurantId/payouts/:payoutId` | 🔑 | One settlement |
| LIVE | `GET` | `/restaurants/:restaurantId/invoices` | 🔑 | GST invoices |
| LIVE | `GET` | `/restaurants/:restaurantId/commission` | 🔑 | Current % |
| LIVE | `POST` | `/restaurants/:restaurantId/support/tickets` | 🔑 | Kitchen ticket |
| LIVE | `GET` | `/restaurants/:restaurantId/support/tickets` | 🔑 | Ticket list |
| LIVE | `POST` | `/restaurants/:restaurantId/devices` | 🔑 | Outlet FCM/APNs |
| LIVE | `DELETE` | `/restaurants/:restaurantId/devices/:deviceId` | 🔑 | Unregister |
| LIVE | `GET` | `/restaurants/:restaurantId/notifications` | 🔑 | Inbox list + unread (`?page=&limit=&unread=`) — **list only**; mark-read is §7 |

---

## 4. order-service — ALIAS only (do not dual-wire)

**Prefix:** `/api/v1/order-service`

These are **LIVE** for kitchen/admin. The restaurant app must use **§3.5–3.9**. Calling both causes double accept / double ready.

| Status | Method | Path | Use restaurant-service instead |
|---|---|---|---|
| ALIAS | `GET` | `/orders/restaurant?restaurantId=` | `GET .../restaurants/:id/orders` |
| ALIAS | `GET` | `/orders/restaurant/:restaurantId/kds` | `.../orders/kds` |
| ALIAS | `GET` | `/orders/restaurant/:restaurantId/history` | `.../orders/history` |
| ALIAS | `GET` | `/orders/restaurant/:restaurantId/scheduled` | `.../orders/scheduled` |
| ALIAS | `GET` | `/orders/restaurant/:restaurantId/analytics/overview` | `.../analytics` |
| ALIAS | `GET` | `/orders/restaurant/:restaurantId/analytics/revenue` | `.../analytics/revenue` |
| ALIAS | `GET` | `/orders/restaurant/:restaurantId/analytics/orders` | `.../analytics/orders` |
| ALIAS | `GET` | `/orders/restaurant/:restaurantId/analytics/cancellations` | `.../analytics/cancellations` |
| ALIAS | `GET` | `/orders/restaurant/:restaurantId/analytics/export` | `.../analytics/export` |
| ALIAS | `PUT` | `/orders/restaurant/:orderId/status?restaurantId=` | accept / reject / preparing / ready |
| ALIAS | `PUT` | `/orders/restaurant/:restaurantId/orders/:orderId/prep-time` | `.../prep-time` |
| ALIAS | `PUT` | `/orders/restaurant/:restaurantId/orders/:orderId/delay` | `.../delay` |
| ALIAS | `POST` | `/orders/restaurant/:restaurantId/orders/:orderId/cancel` | `.../cancel` |
| ALIAS | `POST` | `/orders/restaurant/:restaurantId/orders/:orderId/items-unavailable` | `.../items-unavailable` |
| ALIAS | `PUT` | `/orders/restaurant/:restaurantId/orders/:orderId/pickup-ready` | `.../pickup-ready` |
| ALIAS | `PUT` | `/orders/restaurant/:restaurantId/orders/:orderId/complete-takeaway` | `.../complete-takeaway` |
| ALIAS | `POST` | `/orders/restaurant/:restaurantId/orders/:orderId/print-kot` | `.../print-kot` |
| ALIAS | `GET` | `/orders/restaurant/:restaurantId/orders/:orderId/sla` | `.../sla` |
| ALIAS | `GET` | `/orders/:orderId` | `GET .../orders/:orderId` (ownership-gated) |

Do **not** call customer order paths (`POST /orders`, cancel-quote, reorder, tip, issues).

---

## 5. delivery-service — ALIAS (fleet / handover)

**Prefix:** `/api/v1/delivery-service`

Prefer §3.5–3.6. Direct kitchen routes (same LIVE backend):

| Status | Method | Path | Note |
|---|---|---|---|
| ALIAS | `GET` | `/restaurant/orders/:orderId/partner` | Use `.../orders/:orderId/rider` |
| ALIAS | `GET`/`PUT` | `/restaurant/orders/:orderId/handover` | Use restaurant-service handover |
| ALIAS | `POST` | `/restaurant/orders/:orderId/call-customer` | Use restaurant-service call |
| ALIAS | `POST/GET/DELETE` | `/restaurant/:restaurantId/invitations` | Use `/fleet/invitations` |
| ALIAS | `GET`/`PUT` | `/restaurant/:restaurantId/partners*` | Use `/fleet/partners*` |
| ALIAS | `GET` | `/restaurant/:restaurantId/available-partners` | Use `/fleet/available-partners` |
| ALIAS | `POST` | `/restaurant/:restaurantId/orders/:orderId/manual-assign` | Use restaurant-service |
| ALIAS | `POST` | `/restaurant/:restaurantId/orders/:orderId/rate-partner` | Use restaurant-service |

---

## 6. payment-service — INTERNAL (app cannot call)

**Prefix:** `/api/v1/payment-service`

These routes are `requireInternal`. Kitchen reads settlements via **§3.10** only.

| Status | Method | Path | Use restaurant-service instead |
|---|---|---|---|
| INTERNAL | `GET` | `/payments/restaurants/:restaurantId/payouts` | `.../payouts` |
| INTERNAL | `GET` | `/payments/restaurants/:restaurantId/payouts/:payoutId` | `.../payouts/:payoutId` |
| INTERNAL | `GET` | `/payments/restaurants/:restaurantId/invoices` | `.../invoices` |
| INTERNAL | `GET` | `/payments/restaurants/:restaurantId/commission` | `.../commission` |

---

## 6b. review-service — ALIAS (do not dual-wire)

**Prefix:** `/api/v1/review-service`

Prefer §3.10. Same LIVE backend:

| Status | Method | Path | Use restaurant-service instead |
|---|---|---|---|
| ALIAS | `GET` | `/restaurants/:restaurantId/reviews` | `GET .../reviews` (`?page=&limit=&rating=&unanswered=1`) |
| ALIAS | `GET` | `/restaurants/:restaurantId/reviews/stats` | Stats are on the inbox payload; histogram is `GET .../ratings` |
| ALIAS | `POST` | `/restaurants/:restaurantId/reviews/:reviewId/reply` | `POST .../reviews/:reviewId/reply` |
| ALIAS | `DELETE` | `/restaurants/:restaurantId/reviews/:reviewId` | `DELETE .../reviews/:reviewId` |

Do **not** `POST /restaurants/:id/reviews` (customer write) or `/admin/reviews*`.

---

## 7. notification-service — inbox + devices

**Prefix:** `/api/v1/notification-service`

Restaurant-service `GET .../notifications` is **list-only**. Mark read, badge, clear, and kitchen FCM (`app: "kitchen"`) use this service (same as the customer app).

| Status | Method | Path | Auth | Use |
|---|---|---|---|---|
| LIVE | `GET` | `/health` | 🔓 | Probe |
| LIVE | `GET` | `/health/ready` | 🔓 | Ready |
| LIVE | `GET` | `/notifications` | 🔑 | Inbox `?unread=&page=` |
| LIVE | `GET` | `/notifications/unread-count` | 🔑 | Badge |
| LIVE | `PUT` | `/notifications/read-all` | 🔑 | Mark all read |
| LIVE | `PUT` | `/notifications/:id/read` | 🔑 | Mark one |
| LIVE | `DELETE` | `/notifications/:id` | 🔑 | Delete one |
| LIVE | `DELETE` | `/notifications/clear-all` | 🔑 | Clear inbox |
| LIVE | `GET` | `/devices` | 🔑 | Push devices |
| LIVE | `POST` | `/devices/register` | 🔑 | Register FCM/APNs (`app: "kitchen"`) |
| LIVE | `DELETE` | `/devices/:deviceId` | 🔑 | Unregister |
| LIVE | `GET` | `/preferences` | 🔑 | Channel prefs |
| LIVE | `PUT` | `/preferences` | 🔑 | Update prefs |

User-service `PUT /users/me/preferences/notifications` also exists. Dispatch respects both.

Exact contracts: [NOTIFICATION_SERVICE_APIS.md](NOTIFICATION_SERVICE_APIS.md).

---

## 8. Never call from restaurant app

| Pattern | Who |
|---|---|
| `/api/v1/admin-service/*` | Legacy |
| `*/admin/*` | Admin panel (KYC **approve** is here — ops, not kitchen) |
| `*/internal/*` | Services only |
| `/api/v1/delivery-service/partners/me/*` | Rider app |
| `/api/v1/customer-service/*` | Customer app |
| `/api/v1/cart-service/*` | Customer cart |
| `/api/v1/search-service/*` | Customer search |
| `/api/v1/address-service/*` | Customer addresses (outlet pin = `PUT /restaurants/:id`) |
| `GET /restaurants` · `/nearby` · `/slug/:slug` | Customer discovery (not kitchen) |
| `POST/DELETE .../notify-open` · `.../notify-stock` · `GET /alerts/me` | Customer alerts |
| `DELETE /restaurants/:id` | Admin only |
| Dual-wire order-service **and** restaurant-service for the same accept/ready | Double state |

---

## 9. Count (restaurant-app LIVE — implement these)

| Service | Approx. kitchen APIs |
|---|---|
| Gateway (+ sockets) | 4 HTTP + 15 events |
| user-service | 31 |
| restaurant-service (kitchen) | 128 |
| notification-service | 13 |

Restaurant-service split: health + cuisines (3) · outlet / duty / media (24) · KYC / bank (7) · menu (28) · chain (5) · KDS / orders (25) · fleet (7) · offers (5) · staff (6) · analytics (6) · reviews / payouts / support / devices / inbox (12).

**Code coverage:** `restaurant.routes.ts` kitchen/owner routes = **all in §3**. Excluded on purpose: `GET /restaurants`, `/nearby`, `/slug/:slug`, `notify-open`, `notify-stock`, `DELETE /restaurants/:id`, `/alerts/me`, `/admin/*`, `/internal/*`. Order (19), delivery (8), payment (4 INTERNAL), review (4) kitchen jobs are **proxied** — listed as ALIAS/INTERNAL so none look missing.

**All of these are LIVE in code.** Empty KDS = no customer orders. Cannot go online = listing still `pending` (admin must approve). Empty payouts = no settled orders. Masked call / IFSC verify need provider keys — APIs return typed `503`, they are not missing.

---

## 10. Related docs

| Doc | Use |
|---|---|
| [CUSTOMER_APP_ALL_APIS.md](CUSTOMER_APP_ALL_APIS.md) | Same layout for customer app |
| [DELIVERY_APP_ALL_APIS.md](DELIVERY_APP_ALL_APIS.md) | Same layout for rider app |
| [RESTAURANT_SERVICE_APIS.md](RESTAURANT_SERVICE_APIS.md) | Full restaurant-service (4 clients) |
| [ORDER_SERVICE_APIS.md](ORDER_SERVICE_APIS.md) | Order aliases + kitchen jobs |
| [REVIEW_SERVICE_APIS.md](REVIEW_SERVICE_APIS.md) | Review inbox / reply aliases |
| [API_ROUTES_REFERENCE.md](API_ROUTES_REFERENCE.md) | Full platform inventory |
| [API_REQUEST_RESPONSE.md](API_REQUEST_RESPONSE.md) | Request/response bodies |
