*Disclaimer: The following text was written by AI. I have proofread everything and edited some small things and can now guarantee that it does not contain any false information.*

# 📦 Madfut Private Server – Trading Backend


**index.js** - Works for Modded client and the normal client aswell!

**standalone.js** - Fully without the real madfut database, only modded client to modded client trading

# Showcase

https://github.com/user-attachments/assets/a648ee95-c944-4ec8-adfb-11e28a6d0e70

## ⚠️ Important Notice

The `standalone.js` version works **completely without the real Madfut backend**.

This means:

* ✅ Everything runs on your **private Firebase server**
* ✅ All matchmaking, invites, and trades are handled locally
* ❌ **No connection to official Madfut servers**
* ❌ **No trading with real (vanilla) players**

👉 Result:
Only **modded clients can trade with other modded clients**.
There is **no cross-compatibility** with the official ecosystem.

---

## 🧠 Project Overview

This project simulates (and partially bridges) the Madfut online trading system by:

* Recreating Firestore-based matchmaking
* Emulating Realtime Database trade sessions
* Optionally bridging to the real Madfut backend (`index.js`)
* Handling authentication via Firebase Admin SDK
* Synchronizing two completely different backend systems in real time

---

# 🧩 Architecture

There are **two main modes**:

## 1. `standalone.js` → Fully Private Mode

* No dependency on real Madfut
* Fully controlled environment
* Simpler, but isolated

## 2. `index.js` → Bridge Mode (Advanced)

* Connects to **real Madfut backend**
* Syncs data between:

  * Your private Firebase
  * Official Madfut Firestore + RTDB
* Requires:

  * `refreshToken` from real accounts
  * Custom claims setup
* Extremely complex synchronization layer

---

# 🔌 standalone.js Explained

This file recreates core Madfut backend logic:

## 🔤 Username System

* Users enter a `usernamesQueue`
* Backend:

  * Validates username (`a-zA-Z0-9`, 4–12 chars)
  * Creates:

    * `/users/{uid}`
    * `/usernames/{username}` → UID mapping
* Ensures:

  * Case-insensitive uniqueness
  * Fast lookup for invites

---

## 🎮 Matchmaking System

### 1. Random Trading

* Users without `invitedUsername` go into `randomQueue`
* First two users get matched:

  * Shared `roomId`
  * Host/Guest roles assigned
* Temporary in-memory queue (`Map`) used

👉 Challenge:

* No persistence → restart = queue loss
* Race conditions possible if many users join simultaneously

---

### 2. Direct Invites

Flow:

1. Player A invites username
2. Backend resolves username → UID
3. Invite stored in:

   ```
   onlineInvites/{invitedUid}/invites/{inviterUid}
   ```
4. Player B accepts → triggers trade creation

👉 Challenge:

* Requires strict consistency between:

  * usernames collection
  * users collection
* Any mismatch breaks invites

---

## 🔁 Trade Creation

When invite is accepted:

* New `roomId` generated
* Both players updated in `onlineQueue`
* Trade session created in RTDB:

  ```
  r/{roomId}
  ```

👉 Challenge:

* Must ensure:

  * Both users receive identical room state
  * Host logic is consistent
  * No duplicate trades

---

## 🤖 Bot System (Optional)

* Can simulate:

  * Random trades
  * Accepting invites
* Useful for testing without real players

👉 Challenge:

* Needs fake RTDB state initialization
* Must mimic real client behavior

---

# 🌉 index.js – The Real Complexity

This is where things get **seriously complicated**.

## 🔑 Core Idea

You are **bridging two completely different systems**:

| Private Server | Real Madfut |
| -------------- | ----------- |
| Firestore      | Firestore   |
| RTDB (A)       | RTDB (B)    |
| Custom Auth    | Real Auth   |

---

## 🔐 Authentication Layer

* Uses `refreshToken` stored as **custom claim**
* Exchanges it for:

  * `idToken` (via Google SecureToken API)
* Decodes token to get:

  * Real Madfut UID

👉 Challenge:

* Token expiry handling
* Caching (`tokenCache`)
* Revoking tokens safely

---

## 🔄 Firestore Sync (Matchmaking Bridge)

When a user searches for a trade:

1. Private server detects `onlineQueue` entry
2. Converts user → real Madfut identity
3. Sends request to:

   ```
   projects/trivela-madfut/databases/(default)
   ```
4. Waits for match result
5. Syncs back:

   * roomId
   * opponent
   * host status

👉 Challenge:

* Polling loop (`setInterval`)
* Handling failures silently
* Avoiding duplicate listeners (`activeBListeners`)

---

## 🔗 RTDB Trade Bridge (Hardest Part)

Once a trade starts:

You create a **bi-directional real-time sync system**:

### A → B (Private → Real)

* Actions (`H` / `G`)
* Profiles (`h` / `g`)

### B → A (Real → Private)

* Opponent actions
* Opponent profile
* Trade metadata (`i` node)

---

### ⚙️ Synchronization Logic

* Multiple listeners:

  * `onValue` (RTDB)
  * Firestore polling
* Mapping:

  * Host ↔ Guest inversion
  * Field transformations
* Cleanup system:

  * Stops listeners when trade ends

👉 Challenge:

* Prevent infinite loops
* Avoid double updates
* Handle race conditions between A and B
* Memory leaks if listeners aren’t cleaned properly

---

## 🧨 Trade Lifecycle Complexity

A trade involves:

1. Matchmaking (Firestore A ↔ Firestore B)
2. Trade initialization (RTDB)
3. Continuous sync (RTDB A ↔ RTDB B)
4. Metadata injection (`i` node)
5. Trade termination detection
6. Cleanup across both systems

👉 Each step can fail independently.

---

# 🧪 Additional Systems

## 📥 Firestore Import Tool

* Copies data from real Madfut:

  * configs
  * SBCs
  * objectives
* Converts Firestore types manually

👉 Challenge:

* Firestore REST format is verbose and inconsistent
* Requires custom parser (`firestoreValueToJs`)

---

## 👑 VIP System

* Users need:

  * `isVip: true`
  * `refreshToken`
* Set via API endpoints:

  * `/adminClaims`
  * `/giveUserVip`

👉 Challenge:

* Secure handling of tokens
* Prevent abuse
* Sync with Firebase Auth

---

# ⚠️ Key Challenges

This project is **far from trivial**. Major difficulties include:

## 1. 🔄 Real-Time Synchronization

* Two databases
* Two backends
* Different data formats
* Latency issues

## 2. 🧠 State Consistency

* Firestore vs RTDB mismatch
* Partial updates
* Missing nodes

## 3. ⚡ Race Conditions

* Simultaneous matchmaking
* Invite acceptance conflicts
* Queue desync

## 4. 🧹 Listener Management

* Memory leaks
* Duplicate listeners
* Proper cleanup on disconnect

## 5. 🔐 Authentication Complexity

* Token refresh cycles
* Custom claims
* Identity mapping

## 6. 🔁 Infinite Loop Risks

* A → B → A feedback loops
* Requires careful directional control

## 7. 🌐 External Dependency

* Real Madfut API is not controlled
* Any change can break everything

---

# 🧾 Final Thoughts

This system is essentially:

> A **reverse-engineered multiplayer backend** with a **live synchronization bridge** between two independent infrastructures.

It may look simple on the surface (just trading), but internally it involves:

* Distributed systems concepts
* Real-time event propagation
* Authentication bridging
* Data transformation pipelines
* Fault-tolerant listener orchestration

---

If you run this successfully, you're not just hosting a private server —
you're maintaining a **live protocol translation layer between two ecosystems**.

---
