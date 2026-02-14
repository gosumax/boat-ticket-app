# Admin Portal

<cite>
**Referenced Files in This Document**
- [AdminView.jsx](file://src/views/AdminView.jsx)
- [BoatManagement.jsx](file://src/components/admin/BoatManagement.jsx)
- [WorkingZoneMap.jsx](file://src/components/admin/WorkingZoneMap.jsx)
- [apiClient.js](file://src/utils/apiClient.js)
- [admin.mjs](file://server/admin.mjs)
- [auth.js](file://server/auth.js)
- [db.js](file://server/db.js)
- [dispatcher-shift-ledger.mjs](file://server/dispatcher-shift-ledger.mjs)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document describes the Admin Portal functionality for managing administrative operations and system management. It covers:
- Dashboard statistics: total revenue, tickets sold, and speed/cruise sales comparison
- Seller performance tracking: sales amounts, commission calculations, and payment summaries
- User management: creation, role assignment, enabling/disabling accounts, and password resets
- Boat management: adding, updating, and configuring vessel information
- Working zone management and map integration for operational areas
- Administrative workflows, permission enforcement, and system configuration
- Security considerations, maintenance procedures, and reporting/export capabilities

## Project Structure
The Admin Portal spans React frontend components and Express backend routes:
- Frontend: AdminView, BoatManagement, WorkingZoneMap, and apiClient
- Backend: admin routes, authentication middleware, and database initialization

```mermaid
graph TB
subgraph "Frontend"
AV["AdminView.jsx"]
BM["BoatManagement.jsx"]
WZ["WorkingZoneMap.jsx"]
AC["apiClient.js"]
end
subgraph "Backend"
ADM["admin.mjs"]
AUTH["auth.js"]
DB["db.js"]
DSL["dispatcher-shift-ledger.mjs"]
end
AV --> AC
BM --> AC
WZ --> AC
AC --> ADM
ADM --> AUTH
ADM --> DB
DSL --> DB
```

**Diagram sources**
- [AdminView.jsx](file://src/views/AdminView.jsx#L1-L382)
- [BoatManagement.jsx](file://src/components/admin/BoatManagement.jsx#L1-L784)
- [WorkingZoneMap.jsx](file://src/components/admin/WorkingZoneMap.jsx#L1-L117)
- [apiClient.js](file://src/utils/apiClient.js#L1-L360)
- [admin.mjs](file://server/admin.mjs#L1-L549)
- [auth.js](file://server/auth.js#L1-L154)
- [db.js](file://server/db.js#L1-L1269)
- [dispatcher-shift-ledger.mjs](file://server/dispatcher-shift-ledger.mjs#L263-L303)

**Section sources**
- [AdminView.jsx](file://src/views/AdminView.jsx#L1-L382)
- [BoatManagement.jsx](file://src/components/admin/BoatManagement.jsx#L1-L784)
- [WorkingZoneMap.jsx](file://src/components/admin/WorkingZoneMap.jsx#L1-L117)
- [apiClient.js](file://src/utils/apiClient.js#L1-L360)
- [admin.mjs](file://server/admin.mjs#L1-L549)
- [auth.js](file://server/auth.js#L1-L154)
- [db.js](file://server/db.js#L1-L1269)

## Core Components
- AdminView: Hosts dashboard, user management, and navigation tabs; fetches stats and manages users
- BoatManagement: Manages boats and their slots; supports CRUD operations and batch actions
- WorkingZoneMap: Placeholder for map-based working zone configuration with save/load
- apiClient: Centralized HTTP client with token handling and network logging
- admin routes: Boat and user management, stats, and working zone endpoints
- auth middleware: Token verification and role checks
- db initialization: Schema migrations, seeding, and canonical sales transaction layer

**Section sources**
- [AdminView.jsx](file://src/views/AdminView.jsx#L1-L382)
- [BoatManagement.jsx](file://src/components/admin/BoatManagement.jsx#L1-L784)
- [WorkingZoneMap.jsx](file://src/components/admin/WorkingZoneMap.jsx#L1-L117)
- [apiClient.js](file://src/utils/apiClient.js#L1-L360)
- [admin.mjs](file://server/admin.mjs#L1-L549)
- [auth.js](file://server/auth.js#L1-L154)
- [db.js](file://server/db.js#L1-L1269)

## Architecture Overview
The Admin Portal enforces role-based access and delegates administrative tasks to backend endpoints. The frontend communicates via apiClient, which attaches JWT tokens and logs requests.

```mermaid
sequenceDiagram
participant Admin as "AdminView.jsx"
participant API as "apiClient.js"
participant AdminAPI as "/api/admin/* (admin.mjs)"
participant Auth as "auth.js"
participant DB as "db.js"
Admin->>API : fetchDashboardStats()
API->>AdminAPI : GET /admin/stats
AdminAPI->>Auth : authenticateToken()
Auth->>DB : verify token and user
AdminAPI->>DB : compute stats (revenue, tickets, trips)
DB-->>AdminAPI : aggregated data
AdminAPI-->>API : {totalRevenue, totalTicketsSold, speedTrips, cruiseTrips}
API-->>Admin : stats data
```

**Diagram sources**
- [AdminView.jsx](file://src/views/AdminView.jsx#L50-L77)
- [apiClient.js](file://src/utils/apiClient.js#L23-L88)
- [admin.mjs](file://server/admin.mjs#L418-L472)
- [auth.js](file://server/auth.js#L10-L40)
- [db.js](file://server/db.js#L1-L1269)

## Detailed Component Analysis

### Dashboard Statistics
The dashboard displays:
- Today’s revenue
- Total tickets sold
- Speed vs cruise trip counts
- Seller performance table with sales, commission, and payable amounts

```mermaid
flowchart TD
Start(["Open Admin Dashboard"]) --> FetchStats["Fetch /api/admin/stats"]
FetchStats --> Compute["Compute revenue, tickets, speed/cruise counts"]
Compute --> Render["Render cards and seller table"]
Render --> End(["Ready"])
```

**Diagram sources**
- [AdminView.jsx](file://src/views/AdminView.jsx#L44-L77)
- [admin.mjs](file://server/admin.mjs#L418-L472)

**Section sources**
- [AdminView.jsx](file://src/views/AdminView.jsx#L215-L262)
- [admin.mjs](file://server/admin.mjs#L418-L472)

### Seller Performance Tracking
Seller performance is computed from backend sales data and displayed as:
- Sales amount (₽)
- Commission (₽)
- Amount to pay (₽)

```mermaid
sequenceDiagram
participant Admin as "AdminView.jsx"
participant API as "apiClient.js"
participant Ledger as "dispatcher-shift-ledger.mjs"
participant DB as "db.js"
Admin->>API : getSellers()
API->>Ledger : GET /api/dispatcher/shift-ledger
Ledger->>DB : aggregate sales and balances
DB-->>Ledger : {sellers, totals}
Ledger-->>API : {sellers, totals}
API-->>Admin : seller stats
```

**Diagram sources**
- [AdminView.jsx](file://src/views/AdminView.jsx#L62-L63)
- [dispatcher-shift-ledger.mjs](file://server/dispatcher-shift-ledger.mjs#L263-L303)
- [db.js](file://server/db.js#L1-L1269)

**Section sources**
- [AdminView.jsx](file://src/views/AdminView.jsx#L235-L261)
- [dispatcher-shift-ledger.mjs](file://server/dispatcher-shift-ledger.mjs#L263-L303)

### User Management
Admins can:
- Create users with role and password
- Enable/disable users
- Reset passwords
- Delete users (soft-delete by deactivating)

```mermaid
sequenceDiagram
participant Admin as "AdminView.jsx"
participant API as "apiClient.js"
participant AdminAPI as "/api/admin/users* (admin.mjs)"
participant Auth as "auth.js"
participant DB as "db.js"
Admin->>API : createUser({username,password,role})
API->>AdminAPI : POST /users
AdminAPI->>Auth : authenticateToken()
Auth->>DB : verify token
AdminAPI->>DB : insert user with hashed password
DB-->>AdminAPI : new user record
AdminAPI-->>API : user data
API-->>Admin : user created
Admin->>API : updateUser(id,{is_active})
API->>AdminAPI : PATCH /users/ : id
AdminAPI->>DB : update is_active
DB-->>AdminAPI : updated user
AdminAPI-->>API : user
API-->>Admin : status updated
Admin->>API : resetPassword(id,newPassword)
API->>AdminAPI : POST /users/ : id/reset-password
AdminAPI->>DB : update password_hash
DB-->>AdminAPI : ok
AdminAPI-->>API : ok
API-->>Admin : password reset
```

**Diagram sources**
- [AdminView.jsx](file://src/views/AdminView.jsx#L107-L159)
- [apiClient.js](file://src/utils/apiClient.js#L1-L360)
- [admin.mjs](file://server/admin.mjs#L290-L415)
- [auth.js](file://server/auth.js#L10-L40)
- [db.js](file://server/db.js#L1-L1269)

**Section sources**
- [AdminView.jsx](file://src/views/AdminView.jsx#L79-L159)
- [admin.mjs](file://server/admin.mjs#L266-L415)

### Boat Management
Admins can manage boats and their slots:
- Add/update/delete boats
- Toggle active status
- Create/update/delete slots
- View and manage schedules per boat
- Archive boats with dependencies

```mermaid
sequenceDiagram
participant Admin as "BoatManagement.jsx"
participant API as "apiClient.js"
participant AdminAPI as "/api/admin/boats* (admin.mjs)"
participant DB as "db.js"
Admin->>API : getBoats()
API->>AdminAPI : GET /admin/boats
AdminAPI->>DB : SELECT boats
DB-->>AdminAPI : boats[]
AdminAPI-->>API : boats[]
API-->>Admin : boats
Admin->>API : createBoat({name,type})
API->>AdminAPI : POST /admin/boats
AdminAPI->>DB : INSERT boat
DB-->>AdminAPI : boat
AdminAPI-->>API : boat
API-->>Admin : created
Admin->>API : getBoatSlots(boatId)
API->>AdminAPI : GET /admin/boats/ : id/slots
AdminAPI->>DB : SELECT slots
DB-->>AdminAPI : slots[]
AdminAPI-->>API : slots[]
API-->>Admin : slots
```

**Diagram sources**
- [BoatManagement.jsx](file://src/components/admin/BoatManagement.jsx#L52-L74)
- [apiClient.js](file://src/utils/apiClient.js#L1-L360)
- [admin.mjs](file://server/admin.mjs#L17-L216)
- [db.js](file://server/db.js#L1-L1269)

**Section sources**
- [BoatManagement.jsx](file://src/components/admin/BoatManagement.jsx#L36-L211)
- [admin.mjs](file://server/admin.mjs#L17-L216)

### Working Zone Management and Map Integration
Admins configure operational areas via a working zone setting persisted in the database. The UI provides a placeholder map area for editing polygons.

```mermaid
sequenceDiagram
participant Admin as "WorkingZoneMap.jsx"
participant API as "apiClient.js"
participant AdminAPI as "/api/admin/settings/working-zone (admin.mjs)"
participant DB as "db.js"
Admin->>API : getWorkingZone()
API->>AdminAPI : GET /admin/work-zone
AdminAPI->>DB : SELECT settings.key='work_zone'
DB-->>AdminAPI : JSON geometry
AdminAPI-->>API : geometry
API-->>Admin : zoneData
Admin->>API : saveWorkingZone(geometry)
API->>AdminAPI : PUT /settings/working-zone
AdminAPI->>DB : INSERT/UPDATE settings
DB-->>AdminAPI : ok
AdminAPI-->>API : ok
API-->>Admin : saved
```

**Diagram sources**
- [WorkingZoneMap.jsx](file://src/components/admin/WorkingZoneMap.jsx#L24-L45)
- [apiClient.js](file://src/utils/apiClient.js#L1-L360)
- [admin.mjs](file://server/admin.mjs#L474-L547)
- [db.js](file://server/db.js#L1-L1269)

**Section sources**
- [WorkingZoneMap.jsx](file://src/components/admin/WorkingZoneMap.jsx#L1-L117)
- [admin.mjs](file://server/admin.mjs#L474-L547)

### Administrative Workflows and Permission Enforcement
- Authentication: JWT verification middleware ensures valid sessions
- Authorization: requireAdminRole restricts endpoints to admin/owner
- Role checks: canOwnerOrAdmin, canOwnerAccess, canDispatchManageSlots, isAdmin
- Token lifecycle: login generates JWT; logout clears token

```mermaid
flowchart TD
Login["POST /api/auth/login"] --> Verify["Verify credentials"]
Verify --> Token["Generate JWT"]
Token --> Save["Store token (client)"]
Save --> Access["Access protected endpoints"]
Access --> Auth["authenticateToken()"]
Auth --> Role["requireAdminRole() / isAdmin()"]
Role --> Allow["Proceed to admin.mjs routes"]
```

**Diagram sources**
- [auth.js](file://server/auth.js#L10-L75)
- [admin.mjs](file://server/admin.mjs#L7-L15)
- [auth.js](file://server/auth.js#L42-L71)

**Section sources**
- [auth.js](file://server/auth.js#L1-L154)
- [admin.mjs](file://server/admin.mjs#L7-L15)

### System Configuration and Maintenance
- Database initialization and migrations: schema creation, column additions, indexes, and seeding
- Canonical sales transactions: append-only ledger with triggers to synchronize with tickets
- Owner audit log: append-only audit trail for owner actions

```mermaid
graph LR
DB["db.js"] --> Init["Initialize schema and migrations"]
Init --> Tables["Create tables and indexes"]
Init --> Seed["Seed initial data"]
DB --> ST["sales_transactions triggers"]
DB --> Audit["owner_audit_log"]
```

**Diagram sources**
- [db.js](file://server/db.js#L39-L1269)

**Section sources**
- [db.js](file://server/db.js#L39-L1269)

## Dependency Analysis
Administrative operations depend on:
- Authentication middleware for session validation
- Role-based authorization for sensitive endpoints
- Database for persistent storage and computed aggregates
- API client for standardized HTTP communication

```mermaid
graph TB
AdminView["AdminView.jsx"] --> apiClient["apiClient.js"]
apiClient --> adminRoutes["admin.mjs"]
adminRoutes --> auth["auth.js"]
adminRoutes --> db["db.js"]
BoatMgmt["BoatManagement.jsx"] --> apiClient
WorkingZone["WorkingZoneMap.jsx"] --> apiClient
dispatcherShift["dispatcher-shift-ledger.mjs"] --> db
```

**Diagram sources**
- [AdminView.jsx](file://src/views/AdminView.jsx#L1-L382)
- [BoatManagement.jsx](file://src/components/admin/BoatManagement.jsx#L1-L784)
- [WorkingZoneMap.jsx](file://src/components/admin/WorkingZoneMap.jsx#L1-L117)
- [apiClient.js](file://src/utils/apiClient.js#L1-L360)
- [admin.mjs](file://server/admin.mjs#L1-L549)
- [auth.js](file://server/auth.js#L1-L154)
- [db.js](file://server/db.js#L1-L1269)
- [dispatcher-shift-ledger.mjs](file://server/dispatcher-shift-ledger.mjs#L263-L303)

**Section sources**
- [AdminView.jsx](file://src/views/AdminView.jsx#L1-L382)
- [BoatManagement.jsx](file://src/components/admin/BoatManagement.jsx#L1-L784)
- [WorkingZoneMap.jsx](file://src/components/admin/WorkingZoneMap.jsx#L1-L117)
- [apiClient.js](file://src/utils/apiClient.js#L1-L360)
- [admin.mjs](file://server/admin.mjs#L1-L549)
- [auth.js](file://server/auth.js#L1-L154)
- [db.js](file://server/db.js#L1-L1269)
- [dispatcher-shift-ledger.mjs](file://server/dispatcher-shift-ledger.mjs#L263-L303)

## Performance Considerations
- Use pagination and filtering for large datasets (users, boats, slots)
- Batch operations for bulk updates (e.g., toggle multiple slots)
- Debounce frequent UI actions (e.g., search/filter)
- Indexes on frequently queried columns (e.g., business_day, status)
- Minimize redundant fetches by caching data where appropriate

## Troubleshooting Guide
Common issues and resolutions:
- Authentication failures: verify JWT presence and expiration; ensure login succeeds
- Authorization errors: confirm user role is admin or owner; check requireAdminRole middleware
- Boat deletion conflicts: soft-archive when dependencies exist; hard-delete only when safe
- Password reset validation: ensure new password meets length requirements
- Network errors: inspect apiClient logs for request/response details

**Section sources**
- [auth.js](file://server/auth.js#L10-L40)
- [admin.mjs](file://server/admin.mjs#L141-L180)
- [admin.mjs](file://server/admin.mjs#L355-L387)
- [apiClient.js](file://src/utils/apiClient.js#L23-L88)

## Conclusion
The Admin Portal provides a comprehensive interface for system administration, including dashboard analytics, user and boat management, and operational configuration. Robust authentication and authorization ensure secure access, while backend migrations and canonical sales transactions support reliable operations and future reporting integrations.