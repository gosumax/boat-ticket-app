# Getting Started

<cite>
**Referenced Files in This Document**
- [README.md](file://README.md)
- [package.json](file://package.json)
- [.env](file://.env)
- [vite.config.js](file://vite.config.js)
- [server/index.js](file://server/index.js)
- [server/db.js](file://server/db.js)
- [server/auth.js](file://server/auth.js)
- [init_db.js](file://init_db.js)
- [start-dev.ps1](file://start-dev.ps1)
- [start-dev.bat](file://start-dev.bat)
- [minimal-server.js](file://minimal-server.js)
- [test-db.js](file://test-db.js)
- [test-server.js](file://test-server.js)
- [test-api.js](file://test-api.js)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Environment Variables](#environment-variables)
5. [Database Initialization](#database-initialization)
6. [Development Server Startup](#development-server-startup)
7. [First-Time Setup](#first-time-setup)
8. [Initial Application Walkthrough](#initial-application-walkthrough)
9. [Verification Steps](#verification-steps)
10. [Troubleshooting Guide](#troubleshooting-guide)
11. [Conclusion](#conclusion)

## Introduction
This guide helps you set up and run the boat ticket application locally. It covers prerequisites, installation, environment configuration, database initialization, development server startup, first-time setup, walkthrough, verification, and troubleshooting.

## Prerequisites
- Node.js: The project uses ES modules and modern Node.js features. Use a recent LTS version compatible with the repository’s dependencies.
- npm: Ensure you have a recent npm version included with your Node.js installation.
- Operating system: Windows PowerShell and Command Prompt scripts are provided for convenience.

Key technical details:
- Frontend framework: React + Vite
- Backend framework: Node.js + Express
- Database: SQLite via better-sqlite3
- Authentication: JWT tokens with bcrypt password hashing

**Section sources**
- [README.md](file://README.md#L66-L77)
- [package.json](file://package.json#L15-L39)

## Installation
Follow these steps to install dependencies and prepare the project:

1. Install dependencies
   - Run: npm install

2. Verify installation
   - After installation completes, proceed to database initialization.

Notes:
- The project uses ES modules (type: module in package.json).
- Scripts rely on concurrently to run frontend and backend in development.

**Section sources**
- [README.md](file://README.md#L104-L117)
- [package.json](file://package.json#L6-L14)

## Environment Variables
Configure environment variables for local development:

- VITE_DEV_MODE: Set to true to enable development mode in the frontend.
- JWT_SECRET: Used by the backend for signing JWT tokens. If not set, the backend uses a default secret (not recommended for production).
- PORT: Controls the backend server port (defaults to 3001 if unset).

Recommended setup:
- Create a .env file at the project root with VITE_DEV_MODE=true.
- Optionally set JWT_SECRET to a strong secret value for local development.

**Section sources**
- [.env](file://.env#L1-L1)
- [server/auth.js](file://server/auth.js#L5-L5)
- [server/index.js](file://server/index.js#L21-L21)

## Database Initialization
The application uses a SQLite database file named database.sqlite located at the project root. On first run, the backend initializes tables and seeds data automatically. You can also trigger initialization manually:

- Manual initialization script: init_db.js
  - Run: node init_db.js
  - This script imports the database module and logs success or failure.

What happens during initialization:
- Creates core tables (users, boats, boat_slots, settings, presales, tickets, schedule templates, etc.).
- Applies migrations to add missing columns and tables.
- Seeds initial data (including an owner user and default admin credentials if no users exist).

**Section sources**
- [server/db.js](file://server/db.js#L11-L26)
- [server/db.js](file://server/db.js#L39-L84)
- [server/db.js](file://server/db.js#L795-L800)
- [init_db.js](file://init_db.js#L1-L8)

## Development Server Startup
You can start both the frontend and backend servers in development mode using either of these approaches:

Option A: Use npm scripts
- Run: npm run dev
- This starts:
  - Frontend: Vite on http://localhost:5173 (or 5174 if 5173 is busy)
  - Backend: Express on http://localhost:3001

Option B: Platform-specific scripts
- Windows PowerShell:
  - Run: ./start-dev.ps1
- Windows Command Prompt:
  - Run: start-dev.bat

How ports are configured:
- Vite frontend: port 5173 (strictPort enabled) with proxy to backend
- Express backend: port 3001 (controlled by PORT environment variable)

Proxy behavior:
- Vite proxies /api requests to http://localhost:3001
- Authorization headers are forwarded to the backend

**Section sources**
- [package.json](file://package.json#L6-L14)
- [vite.config.js](file://vite.config.js#L6-L24)
- [server/index.js](file://server/index.js#L21-L21)
- [start-dev.ps1](file://start-dev.ps1#L1-L9)
- [start-dev.bat](file://start-dev.bat#L1-L11)

## First-Time Setup
Complete these steps for a fresh checkout:

1. Install dependencies
   - npm install

2. Initialize the database
   - node init_db.js

3. Start development servers
   - npm run dev (or platform-specific scripts)

4. Access the application
   - Frontend: http://localhost:5173
   - Backend health: http://localhost:3001/api/health

Default admin credentials:
- Username: admin
- Password: admin123
- Important: Change this password immediately after first login.

**Section sources**
- [README.md](file://README.md#L118-L143)
- [init_db.js](file://init_db.js#L1-L8)
- [minimal-server.js](file://minimal-server.js#L7-L9)

## Initial Application Walkthrough
After logging in as admin:

- Role-based navigation appears on the landing page.
- Admin features include dashboard statistics, seller performance, and user management.
- Seller view allows ticket sales with boat type selection, trip selection, seat selection, confirmation, and earnings summary.
- Dispatcher view lists trips, manages passenger lists, and marks passengers as used/refunded.

Note: The frontend runs on port 5173, and the backend on port 3001. Ensure both are running before navigating the app.

**Section sources**
- [README.md](file://README.md#L30-L64)
- [README.md](file://README.md#L104-L117)

## Verification Steps
Confirm your installation and basic functionality:

1. Backend health check
   - Visit: http://localhost:3001/api/health
   - Expect: { "ok": true }

2. Database connectivity
   - Run: node test-db.js
   - Expect: successful queries against users, boats, and boat_slots tables

3. API request simulation
   - Run: node test-api.js
   - Expect: a successful simulated response for adding a boat (201 with expected marker)

4. Frontend availability
   - Open: http://localhost:5173
   - Expect: the application loads and displays the login page

5. Minimal server test
   - Run: node minimal-server.js
   - Expect: server listens on localhost:3001 with /api/health endpoint

**Section sources**
- [test-server.js](file://test-server.js#L7-L9)
- [test-db.js](file://test-db.js#L1-L99)
- [test-api.js](file://test-api.js#L1-L86)
- [minimal-server.js](file://minimal-server.js#L1-L14)

## Troubleshooting Guide
Common setup issues and resolutions:

- Port conflicts
  - Symptom: Ports 5173 or 3001 already in use.
  - Resolution: Stop conflicting processes or change ports.
    - Frontend port: Modify Vite config (port and strictPort).
    - Backend port: Set PORT environment variable before starting.

- Dependency installation problems
  - Symptom: npm install fails or hangs.
  - Resolution:
    - Ensure Node.js and npm are up to date.
    - Clear npm cache if needed.
    - Retry installation after network stability.

- Database connection errors
  - Symptom: Backend fails to start or database initialization errors.
  - Resolution:
    - Verify write permissions for the project root (database.sqlite location).
    - Run node init_db.js to reinitialize the database.
    - Check database file integrity and remove corrupted files if necessary.

- Authentication failures
  - Symptom: Login errors or token-related issues.
  - Resolution:
    - Ensure JWT_SECRET is set in environment variables.
    - Confirm the default admin credentials were not changed or reset.

- Proxy or CORS issues
  - Symptom: API calls fail from the frontend.
  - Resolution:
    - Confirm Vite proxy targets http://localhost:3001.
    - Ensure Authorization headers are present in requests.

**Section sources**
- [vite.config.js](file://vite.config.js#L6-L24)
- [server/index.js](file://server/index.js#L21-L21)
- [server/auth.js](file://server/auth.js#L5-L5)
- [server/db.js](file://server/db.js#L17-L26)
- [init_db.js](file://init_db.js#L5-L7)
- [test-db.js](file://test-db.js#L97-L99)

## Conclusion
You now have the complete workflow to clone, install, configure, and run the boat ticket application locally. Use the provided scripts and verification steps to ensure everything is working correctly. For ongoing development, keep the frontend and backend servers running concurrently and use the verification steps to confirm functionality after changes.