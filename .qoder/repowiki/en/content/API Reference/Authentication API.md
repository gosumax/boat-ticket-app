# Authentication API

<cite>
**Referenced Files in This Document**
- [server/auth.js](file://server/auth.js)
- [server/index.js](file://server/index.js)
- [src/utils/apiClient.js](file://src/utils/apiClient.js)
- [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx)
- [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx)
- [server/db.js](file://server/db.js)
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
This document provides comprehensive API documentation for the authentication endpoints in the system. It covers:
- POST /api/auth/login for user authentication
- GET /api/auth/me for retrieving authenticated user information
- JWT token structure, expiration policy, and security considerations
- Practical cURL examples for login requests and response payloads
- Error handling patterns and integration guidance for client applications

## Project Structure
The authentication system spans both the backend server and the frontend client:
- Backend: Express routes and middleware for login and protected routes
- Frontend: API client that manages Authorization headers and token storage
- Database: User records with roles and activation status

```mermaid
graph TB
subgraph "Frontend"
UI["React Views<br/>LoginPage.jsx"]
Ctx["AuthContext.jsx"]
API["ApiClient.js"]
end
subgraph "Backend"
IDX["Express Server<br/>index.js"]
AUTH["Auth Router<br/>auth.js"]
DB["Database<br/>db.js"]
end
UI --> Ctx
Ctx --> API
API --> IDX
IDX --> AUTH
AUTH --> DB
```

**Diagram sources**
- [server/index.js](file://server/index.js#L25-L40)
- [server/auth.js](file://server/auth.js#L118-L153)
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L23-L28)
- [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx#L19-L78)
- [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx#L8-L80)
- [server/db.js](file://server/db.js#L41-L49)

**Section sources**
- [server/index.js](file://server/index.js#L25-L40)
- [server/auth.js](file://server/auth.js#L118-L153)
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L23-L28)
- [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx#L19-L78)
- [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx#L8-L80)
- [server/db.js](file://server/db.js#L41-L49)

## Core Components
- Authentication Router: Implements login and protected profile endpoints
- Token Middleware: Validates Authorization headers and verifies JWT tokens
- API Client: Manages Authorization headers and token persistence
- Auth Context: Centralizes authentication state and lifecycle in the UI
- Database Schema: Defines user table with roles and activation flag

Key implementation references:
- Login route and token generation: [server/auth.js](file://server/auth.js#L120-L142)
- Protected profile route: [server/auth.js](file://server/auth.js#L144-L151)
- Token verification middleware: [server/auth.js](file://server/auth.js#L10-L40)
- API client Authorization header injection: [src/utils/apiClient.js](file://src/utils/apiClient.js#L27-L28)
- Token storage and retrieval: [src/utils/apiClient.js](file://src/utils/apiClient.js#L15-L21)
- Auth context token handling: [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx#L26-L48)
- User table schema: [server/db.js](file://server/db.js#L41-L49)

**Section sources**
- [server/auth.js](file://server/auth.js#L10-L40)
- [server/auth.js](file://server/auth.js#L120-L151)
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L15-L28)
- [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx#L26-L48)
- [server/db.js](file://server/db.js#L41-L49)

## Architecture Overview
The authentication flow connects frontend and backend components:

```mermaid
sequenceDiagram
participant Client as "Client App"
participant API as "ApiClient"
participant Server as "Express Server"
participant Auth as "Auth Router"
participant DB as "Database"
Client->>API : "login(username, password)"
API->>Server : "POST /api/auth/login"
Server->>Auth : "route handler"
Auth->>DB : "lookup user by username"
DB-->>Auth : "user record"
Auth->>Auth : "verify password hash"
Auth->>Auth : "generate JWT token"
Auth-->>Server : "{ token, user }"
Server-->>API : "{ token, user }"
API->>API : "store token in memory/localStorage"
API-->>Client : "{ token, user }"
Client->>API : "getCurrentUser()"
API->>Server : "GET /api/auth/me"
Server->>Auth : "authenticateToken middleware"
Auth->>DB : "lookup user by decoded id"
DB-->>Auth : "user record"
Auth-->>Server : "{ id, username, role }"
Server-->>API : "{ id, username, role }"
API-->>Client : "{ id, username, role }"
```

**Diagram sources**
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L91-L98)
- [server/auth.js](file://server/auth.js#L120-L151)
- [server/auth.js](file://server/auth.js#L10-L40)
- [server/db.js](file://server/db.js#L41-L49)

## Detailed Component Analysis

### POST /api/auth/login
Purpose: Authenticate a user and issue a JWT token.

- Request
  - Method: POST
  - URL: /api/auth/login
  - Headers: Content-Type: application/json
  - Body (JSON):
    - username: string (required)
    - password: string (required)
- Successful Response (200 OK)
  - Body (JSON):
    - token: string (JWT)
    - user: object
      - id: integer
      - username: string
      - role: string ("seller", "dispatcher", "admin", "owner")
- Error Responses
  - 400 Bad Request: Missing username or password
  - 401 Unauthorized: Invalid credentials or disabled account
  - 403 Forbidden: Internal verification failure (fallback)
  - 500 Internal Server Error: Unhandled server error (not returned for login)

Security and validation:
- Validates presence of username and password
- Looks up user by username
- Checks account activation status
- Compares password hash using bcrypt or plaintext fallback
- Generates JWT with 24-hour expiration

Practical cURL example:
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

Expected response payload:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin"
  }
}
```

Common error scenarios:
- Missing fields: 400
- Wrong credentials: 401
- Disabled account: 401
- Server errors: 500 (not returned for login; treated as invalid credentials)

**Section sources**
- [server/auth.js](file://server/auth.js#L120-L142)
- [server/db.js](file://server/db.js#L41-L49)

### GET /api/auth/me
Purpose: Retrieve currently authenticated user information.

- Request
  - Method: GET
  - URL: /api/auth/me
  - Headers: Authorization: Bearer <token>
- Successful Response (200 OK)
  - Body (JSON):
    - id: integer
    - username: string
    - role: string ("seller", "dispatcher", "admin", "owner")
- Error Responses
  - 401 Unauthorized: Missing Authorization header
  - 403 Forbidden: Invalid/expired token or disabled account
  - 500 Internal Server Error: Unexpected server error

Security and validation:
- Extracts token from Authorization header
- Verifies JWT signature and expiration
- Confirms user exists and is active
- Populates req.user for downstream handlers

Practical cURL example:
```bash
curl -X GET http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

Expected response payload:
```json
{
  "id": 1,
  "username": "admin",
  "role": "admin"
}
```

**Section sources**
- [server/auth.js](file://server/auth.js#L144-L151)
- [server/auth.js](file://server/auth.js#L10-L40)

### JWT Token Structure and Expiration
- Issuer: Application (JWT_SECRET configured in environment)
- Expiration: 24 hours
- Payload fields:
  - id: user identifier
  - username: user identifier
  - role: user role
- Verification: Signature validation against JWT_SECRET

Expiration policy:
- Tokens expire after 24 hours
- Clients should refresh or re-authenticate after expiry

Security considerations:
- Store tokens securely (memory and localStorage)
- Use HTTPS in production
- Rotate JWT_SECRET in production environments
- Avoid storing sensitive data in JWT payloads

**Section sources**
- [server/auth.js](file://server/auth.js#L73-L75)
- [server/auth.js](file://server/auth.js#L17-L18)

### Client Integration Examples
Frontend components integrate with the authentication system:

- API Client
  - Automatically adds Authorization header when a token is present
  - Stores token in memory and local storage keys
  - Provides login and logout helpers

- Auth Context
  - Initializes from stored token
  - Normalizes user role to lowercase
  - Exposes login/logout and current user state

- Login Page
  - Captures username/password
  - Submits credentials via API client
  - Handles errors and redirects on success

Integration references:
- API client login and token storage: [src/utils/apiClient.js](file://src/utils/apiClient.js#L91-L98)
- API client Authorization header: [src/utils/apiClient.js](file://src/utils/apiClient.js#L27-L28)
- Auth context token initialization: [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx#L26-L48)
- Login form submission: [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx#L56-L79)

**Section sources**
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L27-L28)
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L91-L98)
- [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx#L26-L48)
- [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx#L56-L79)

## Architecture Overview

```mermaid
graph LR
subgraph "Client"
A["LoginPage.jsx"]
B["AuthContext.jsx"]
C["ApiClient.js"]
end
subgraph "Server"
D["index.js"]
E["auth.js"]
F["db.js"]
end
A --> B
B --> C
C --> D
D --> E
E --> F
```

**Diagram sources**
- [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx#L8-L80)
- [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx#L19-L78)
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L23-L28)
- [server/index.js](file://server/index.js#L25-L40)
- [server/auth.js](file://server/auth.js#L118-L153)
- [server/db.js](file://server/db.js#L41-L49)

## Detailed Component Analysis

### Authentication Flow Details

#### Login Flow
```mermaid
flowchart TD
Start(["POST /api/auth/login"]) --> Validate["Validate request body"]
Validate --> Valid{"Username and password present?"}
Valid --> |No| Resp400["Return 400"]
Valid --> |Yes| Lookup["Lookup user by username"]
Lookup --> Found{"User found?"}
Found --> |No| Resp401a["Return 401 (invalid credentials)"]
Found --> |Yes| Active{"User is active?"}
Active --> |No| Resp401b["Return 401 (disabled account)"]
Active --> |Yes| Verify["Verify password hash"]
Verify --> Match{"Password matches?"}
Match --> |No| Resp401c["Return 401 (invalid credentials)"]
Match --> |Yes| Issue["Generate JWT token"]
Issue --> Resp200["Return { token, user }"]
```

**Diagram sources**
- [server/auth.js](file://server/auth.js#L120-L142)
- [server/db.js](file://server/db.js#L41-L49)

#### Profile Retrieval Flow
```mermaid
flowchart TD
Start(["GET /api/auth/me"]) --> Header["Extract Authorization header"]
Header --> HasToken{"Token present?"}
HasToken --> |No| Resp401["Return 401"]
HasToken --> |Yes| Verify["Verify JWT signature and claims"]
Verify --> Valid{"Valid and unexpired?"}
Valid --> |No| Resp403a["Return 403 (invalid/expired token)"]
Valid --> |Yes| LoadUser["Load user from DB by id"]
LoadUser --> Active{"User active?"}
Active --> |No| Resp403b["Return 403 (disabled account)"]
Active --> |Yes| Resp200["Return { id, username, role }"]
```

**Diagram sources**
- [server/auth.js](file://server/auth.js#L144-L151)
- [server/auth.js](file://server/auth.js#L10-L40)
- [server/db.js](file://server/db.js#L41-L49)

### Data Model: Users
```mermaid
erDiagram
USERS {
integer id PK
string username UK
string password_hash
string role
integer is_active
datetime created_at
}
```

- Roles: "seller", "dispatcher", "admin", "owner"
- Activation: is_active flag controls account status
- Password storage: bcrypt hash or plaintext fallback

**Diagram sources**
- [server/db.js](file://server/db.js#L41-L49)

## Dependency Analysis

```mermaid
graph TB
A["src/utils/apiClient.js"] --> B["server/auth.js"]
C["src/contexts/AuthContext.jsx"] --> A
D["src/views/LoginPage.jsx"] --> C
B --> E["server/db.js"]
F["server/index.js"] --> B
```

- API client depends on auth router for login/profile endpoints
- Auth context depends on API client for network operations
- Index mounts auth router under /api/auth
- Auth router depends on database for user lookups

**Diagram sources**
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L91-L98)
- [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx#L55-L63)
- [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx#L56-L63)
- [server/index.js](file://server/index.js#L26-L26)
- [server/auth.js](file://server/auth.js#L118-L153)
- [server/db.js](file://server/db.js#L41-L49)

**Section sources**
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L91-L98)
- [src/contexts/AuthContext.jsx](file://src/contexts/AuthContext.jsx#L55-L63)
- [src/views/LoginPage.jsx](file://src/views/LoginPage.jsx#L56-L63)
- [server/index.js](file://server/index.js#L26-L26)
- [server/auth.js](file://server/auth.js#L118-L153)
- [server/db.js](file://server/db.js#L41-L49)

## Performance Considerations
- Token verification is O(1) with constant-time checks
- Password comparison uses bcrypt when available; falls back to plaintext comparison for development
- Database queries use prepared statements to prevent SQL injection
- JWT secret is loaded once and reused for signing/verification

## Troubleshooting Guide
Common issues and resolutions:
- 400 Bad Request on login: Ensure both username and password are provided
- 401 Unauthorized on login: Verify credentials and account activation status
- 401 Unauthorized on /api/auth/me: Missing Authorization header
- 403 Forbidden on /api/auth/me: Invalid/expired token or disabled account
- Token not persisted: Check browser localStorage for token keys and API client token storage

Debugging tips:
- Inspect Authorization header in requests
- Verify JWT_SECRET environment variable in production
- Confirm user.is_active flag in database
- Review server logs for authentication errors

**Section sources**
- [server/auth.js](file://server/auth.js#L120-L151)
- [src/utils/apiClient.js](file://src/utils/apiClient.js#L27-L28)
- [server/db.js](file://server/db.js#L41-L49)

## Conclusion
The authentication system provides secure, stateless user authentication using JWT tokens with 24-hour expiration. The backend enforces token validation and user activation checks, while the frontend integrates seamlessly through the API client and AuthContext. Proper error handling ensures robust client experiences, and the design supports easy integration for client applications.