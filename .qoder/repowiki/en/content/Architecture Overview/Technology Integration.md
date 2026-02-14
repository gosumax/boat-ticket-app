# Technology Integration

<cite>
**Referenced Files in This Document**
- [package.json](file://package.json)
- [vite.config.js](file://vite.config.js)
- [server/index.js](file://server/index.js)
- [server/db.js](file://server/db.js)
- [server/auth.js](file://server/auth.js)
- [server/selling.mjs](file://server/selling.mjs)
- [server/admin.mjs](file://server/admin.mjs)
- [server/owner.mjs](file://server/owner.mjs)
- [src/main.jsx](file://src/main.jsx)
- [src/App.jsx](file://src/App.jsx)
- [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx)
- [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx)
- [src/utils/apiClient.js](file://src/utils/apiClient.js)
- [src/views/SellerView.jsx](file://src/views/SellerView.jsx)
- [src/utils/dateUtils.js](file://src/utils/dateUtils.js)
- [src/utils/currency.js](file://src/utils/currency.js)
- [tailwind.config.js](file://tailwind.config.js)
- [README.md](file://README.md)
- [init_db.js](file://init_db.js)
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
This document explains how the boat ticket application integrates React, Express, SQLite, and supporting technologies into a cohesive system. It covers:
- Vite’s development and build pipeline and how it connects to React
- Tailwind CSS integration with React components
- Frontend API client and backend route alignment
- Database integration with better-sqlite3, including initialization, migrations, and data access patterns
- Third-party dependency management and version compatibility
- How the pieces fit together to deliver the application’s features

## Project Structure
The project follows a clear separation of concerns:
- Frontend: React SPA bootstrapped via Vite, styled with Tailwind CSS, and routed with React Router
- Backend: Node.js + Express REST API with modular route handlers
- Database: SQLite file-backed via better-sqlite3, with robust initialization and migration logic
- Utilities: Shared helpers for dates, currency, and API communication

```mermaid
graph TB
subgraph "Frontend (Vite + React)"
A_main["src/main.jsx"]
A_app["src/App.jsx"]
A_login["src/views/LoginPage.jsx"]
A_auth["src/contexts/AuthContext.jsx"]
A_api["src/utils/apiClient.js"]
A_tailwind["tailwind.config.js"]
end
subgraph "Backend (Express)"
B_index["server/index.js"]
B_auth["server/auth.js"]
B_selling["server/selling.mjs"]
B_admin["server/admin.mjs"]
B_owner["server/owner.mjs"]
B_db["server/db.js"]
end
subgraph "Database"
D_sqlite["SQLite file<br/>database.sqlite"]
end
A_main --> A_app
A_app --> A_login
A_app --> A_auth
A_auth --> A_api
A_api --> B_index
B_index --> B_auth
B_index --> B_selling
B_index --> B_admin
B_index --> B_owner
B_auth --> B_db
B_selling --> B_db
B_admin --> B_db
B_owner --> B_db
B_db --> D_sqlite
```

**Diagram sources**
- [src/main.jsx](file://src/main.jsx#L1-L26)
- [src/App.jsx](file://src/App.jsx#L1-L139)
- [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx#L1-L159)
- [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx#L1-L79)
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L1-L360)
- [server/index.js](file://server/index.js#L1-L45)
- [server/auth.js](file://server/auth.js#L1-L154)
- [server/selling.mjs](file://server/selling.mjs#L1-L200)
- [server/admin.mjs](file://server/admin.mjs#L1-L200)
- [server/owner.mjs](file://server/owner.mjs#L1-L200)
- [server/db.js](file://server/db.js#L1-L1269)
- [tailwind.config.js](file://tailwind.config.js#L1-L12)

**Section sources**
- [README.md](file://README.md#L1-L150)
- [package.json](file://package.json#L1-L41)
- [vite.config.js](file://vite.config.js#L1-L25)
- [tailwind.config.js](file://tailwind.config.js#L1-L12)

## Core Components
- React + Vite: SPA bootstrap, routing, and development server with hot reload
- Tailwind CSS: Utility-first styling integrated via Vite and configured for content paths
- Express: Modular route handlers for authentication, selling, administration, and owner dashboards
- better-sqlite3: SQLite driver with initialization, pragmas, and extensive migrations
- API client: Centralized HTTP client with token propagation and structured logging

**Section sources**
- [src/main.jsx](file://src/main.jsx#L1-L26)
- [src/App.jsx](file://src/App.jsx#L1-L139)
- [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx#L1-L159)
- [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx#L1-L79)
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L1-L360)
- [server/index.js](file://server/index.js#L1-L45)
- [server/db.js](file://server/db.js#L1-L1269)

## Architecture Overview
The system uses a thin-client architecture:
- Frontend (React) communicates with backend (Express) via REST endpoints under /api
- Authentication is JWT-based; tokens are stored in localStorage and forwarded automatically
- Database operations are encapsulated in the backend with careful SQL and migrations
- Vite proxies /api requests to the backend during development

```mermaid
sequenceDiagram
participant Browser as "Browser"
participant Vite as "Vite Dev Server"
participant API as "Express Server"
participant Auth as "Auth Router"
participant DB as "better-sqlite3"
Browser->>Vite : "GET /"
Vite-->>Browser : "Serve React app"
Browser->>Vite : "POST /api/auth/login"
Vite->>API : "Proxy /api/* to backend"
API->>Auth : "POST /api/auth/login"
Auth->>DB : "Lookup user"
DB-->>Auth : "User record"
Auth-->>API : "JWT token"
API-->>Vite : "Response with token"
Vite-->>Browser : "200 OK with token"
Browser->>Vite : "GET /api/selling/boats"
Vite->>API : "Forward with Authorization header"
API->>DB : "Query boats"
DB-->>API : "Rows"
API-->>Vite : "200 OK with data"
Vite-->>Browser : "Render UI"
```

**Diagram sources**
- [vite.config.js](file://vite.config.js#L1-L25)
- [server/index.js](file://server/index.js#L1-L45)
- [server/auth.js](file://server/auth.js#L1-L154)
- [server/db.js](file://server/db.js#L1-L1269)
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L1-L360)

## Detailed Component Analysis

### Vite Build System and React Development Workflow
- Vite plugin chain includes React fast-refresh and JSX transforms
- Development server runs on localhost:5173 with strict port enforcement
- Proxy configuration forwards /api requests to the backend (localhost:3001) and preserves Authorization headers
- Scripts orchestrate concurrent frontend and backend startup for development

```mermaid
flowchart TD
Start(["Developer runs 'npm run dev'"]) --> StartFE["Start Vite dev server (port 5173)"]
StartFE --> StartBE["Start Express server (port 3001)"]
StartBE --> Ready["Servers ready"]
Ready --> DevLoop["Edit React components<br/>Hot reload enabled"]
DevLoop --> Proxy["Vite proxy '/api' to backend"]
Proxy --> Backend["Express routes handle requests"]
Backend --> DB["better-sqlite3 queries"]
DB --> Backend
Backend --> FEUpdate["Frontend receives updates"]
FEUpdate --> DevLoop
```

**Diagram sources**
- [vite.config.js](file://vite.config.js#L1-L25)
- [package.json](file://package.json#L1-L41)

**Section sources**
- [vite.config.js](file://vite.config.js#L1-L25)
- [package.json](file://package.json#L1-L41)

### Tailwind CSS Integration with React
- Tailwind is configured to scan HTML and all JS/TSX files under src/**
- Utility classes are applied directly in React components (e.g., LoginPage)
- The approach keeps styling close to components while enabling global design tokens

**Section sources**
- [tailwind.config.js](file://tailwind.config.js#L1-L12)
- [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx#L80-L159)

### Frontend API Client and Backend Route Alignment
- The API client centralizes base URL (/api), token propagation, and response parsing
- Routes are mounted under /api in Express and aligned with client method names (e.g., /api/selling/*, /api/auth/*)
- Authentication middleware enforces protected endpoints and decodes JWTs

```mermaid
sequenceDiagram
participant UI as "React Component"
participant API as "ApiClient"
participant Proxy as "Vite Proxy"
participant Router as "Express Router"
participant DB as "better-sqlite3"
UI->>API : "login(username, password)"
API->>Proxy : "POST /api/auth/login"
Proxy->>Router : "Forward to /api/auth/login"
Router->>DB : "Verify credentials"
DB-->>Router : "User record"
Router-->>Proxy : "JWT token"
Proxy-->>API : "Response"
API-->>UI : "Set token and user"
```

**Diagram sources**
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L1-L360)
- [server/index.js](file://server/index.js#L1-L45)
- [server/auth.js](file://server/auth.js#L1-L154)
- [server/db.js](file://server/db.js#L1-L1269)
- [vite.config.js](file://vite.config.js#L1-L25)

**Section sources**
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L1-L360)
- [server/index.js](file://server/index.js#L1-L45)
- [server/auth.js](file://server/auth.js#L1-L154)

### Database Integration with better-sqlite3
- Initialization sets journal mode WAL and a busy timeout for concurrency
- Robust schema initialization and one-time/per-run migrations ensure schema stability
- Migration logic handles column additions, data normalization, and unique constraints
- Data access patterns use prepared statements and helper functions for seat availability and capacity checks

```mermaid
flowchart TD
Init(["Process start"]) --> NewDB["Create better-sqlite3 instance"]
NewDB --> Pragmas["Set WAL and busy_timeout"]
Pragmas --> Tables["Create core tables if missing"]
Tables --> OneTime["Run one-time migrations"]
OneTime --> PerRun["Run per-start migrations"]
PerRun --> Ready["DB ready for use"]
```

**Diagram sources**
- [server/db.js](file://server/db.js#L1-L1269)

**Section sources**
- [server/db.js](file://server/db.js#L1-L1269)
- [init_db.js](file://init_db.js#L1-L8)

### Authentication and Authorization
- JWT-based login validates credentials against the database and returns a signed token
- Middleware verifies tokens and attaches user info to requests
- Role-based guards restrict access to admin and owner endpoints

```mermaid
sequenceDiagram
participant Client as "React UI"
participant Auth as "Auth Router"
participant DB as "better-sqlite3"
Client->>Auth : "POST /api/auth/login"
Auth->>DB : "SELECT user by username"
DB-->>Auth : "User record"
Auth->>Auth : "Verify password hash"
Auth-->>Client : "JWT token"
Client->>Auth : "GET /api/auth/me"
Auth->>DB : "SELECT user by decoded id"
DB-->>Auth : "User record"
Auth-->>Client : "User info"
```

**Diagram sources**
- [server/auth.js](file://server/auth.js#L1-L154)
- [server/db.js](file://server/db.js#L1-L1269)

**Section sources**
- [server/auth.js](file://server/auth.js#L1-L154)
- [server/db.js](file://server/db.js#L1-L1269)

### Selling and Slot Management
- Seat availability and capacity checks are enforced with precise SQL queries
- For generated slots, occupancy is computed from presales to avoid cache drift
- Endpoints expose slots, boats, presales, and ticket operations

```mermaid
flowchart TD
Start(["Client requests slots"]) --> Fetch["Fetch from /api/selling/slots"]
Fetch --> Count["Count occupied seats by status"]
Count --> Capacity["Read capacity from boat_slots or generated_slots"]
Capacity --> Compare{"Requested seats ≤ free?"}
Compare --> |Yes| Allow["Allow booking"]
Compare --> |No| Deny["Reject with error"]
```

**Diagram sources**
- [server/selling.mjs](file://server/selling.mjs#L1-L200)
- [server/db.js](file://server/db.js#L1-L1269)

**Section sources**
- [server/selling.mjs](file://server/selling.mjs#L1-L200)
- [server/db.js](file://server/db.js#L1-L1269)

### Owner Dashboard and Reporting
- Owner endpoints compute revenue, cash/card totals, and pending amounts using SQL aggregates
- Flexible date ranges and “last nonzero day” presets enable dynamic reporting

**Section sources**
- [server/owner.mjs](file://server/owner.mjs#L1-L200)

### Admin Management
- Admin endpoints manage boats, slots, and user-related operations with validation and soft/hard deletes

**Section sources**
- [server/admin.mjs](file://server/admin.mjs#L1-L200)

### React Routing and Protected Views
- ProtectedRoute wraps views by role, redirecting unauthenticated or unauthorized users
- AuthProvider initializes token-based session and normalizes user roles

**Section sources**
- [src/App.jsx](file://src/App.jsx#L1-L139)
- [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx#L1-L79)
- [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx#L1-L159)

### Utilities and Helpers
- Date utilities normalize and format dates consistently
- Currency formatter renders amounts in RUB
- Seller view composes UI steps and coordinates with the API client

**Section sources**
- [src/utils/dateUtils.js](file://src/utils/dateUtils.js#L1-L74)
- [src/utils/currency.js](file://src/utils/currency.js#L1-L15)
- [src/views/SellerView.jsx](file://src/views/SellerView.jsx#L1-L200)

## Dependency Analysis
The application relies on a focused set of libraries:
- Frontend: React, React Router DOM, Tailwind CSS, Vite, and React fast-refresh
- Backend: Express, better-sqlite3, bcrypt, jsonwebtoken, node-cron
- Development: concurrently for dev orchestration

```mermaid
graph LR
Pkg["package.json"] --> FE["Frontend deps"]
Pkg --> BE["Backend deps"]
FE --> React["react, react-dom"]
FE --> Router["react-router-dom"]
FE --> Tailwind["tailwindcss"]
FE --> Vite["vite, @vitejs/plugin-react"]
BE --> Express["express"]
BE --> DB["better-sqlite3"]
BE --> JWT["jsonwebtoken"]
BE --> BCrypt["bcrypt"]
BE --> Cron["node-cron"]
```

**Diagram sources**
- [package.json](file://package.json#L1-L41)

**Section sources**
- [package.json](file://package.json#L1-L41)

## Performance Considerations
- SQLite WAL mode improves concurrency and write performance
- Prepared statements and parameterized queries reduce overhead and risk
- Seat availability recomputation uses targeted counts to minimize scans
- Vite’s development server and React fast-refresh provide efficient iteration cycles
- Tailwind’s JIT scanning is scoped to minimize rebuild times

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and remedies:
- Database initialization failures: Verify the SQLite file path and permissions; the initializer logs the resolved path
- Migration inconsistencies: The database module runs one-time and per-run migrations; re-run initialization if schema diverges
- Proxy not forwarding Authorization: Ensure Vite proxy configuration passes headers and targets the correct backend port
- Token errors: Confirm JWT_SECRET is set and consistent; verify token presence in localStorage and Authorization header propagation
- Capacity exceeded errors: Review seat accounting logic and ensure generated slot caches are synchronized

**Section sources**
- [server/db.js](file://server/db.js#L1-L1269)
- [vite.config.js](file://vite.config.js#L1-L25)
- [server/auth.js](file://server/auth.js#L1-L154)
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L1-L360)

## Conclusion
The application integrates React, Express, and SQLite with a clean separation of concerns. Vite streamlines development and build workflows, Tailwind enables rapid UI iteration, and the API client provides a unified interface to backend routes. The backend’s database layer is resilient, with careful initialization and migration handling. Together, these technologies deliver a maintainable, extensible system for managing boat ticket sales.