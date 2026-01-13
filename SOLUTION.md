# Incident Resolution: ECONNREFUSED on /api/auth/*

## Problem
Frontend (Vite) was showing ECONNREFUSED errors on `/api/auth/login` and `/api/auth/me` endpoints, preventing authentication from working.

## Root Cause
Backend server failed to start due to a JavaScript syntax error in `server/selling.mjs`. Specifically, there was a missing closing brace `}` for an Express route handler function, causing the ES module parser to fail with "Unexpected token 'export'" error.

## Solution Applied

### 1. Fixed Syntax Error
- Located the missing closing brace in the `router.patch('/presales/:id/used', ...)` route handler in `server/selling.mjs`
- Added the proper closing brace to complete the function syntax
- Verified all route handlers are properly closed with matching braces

### 2. Added Protection Against Future Issues
Created `check-syntax.js` script to validate all server-side JavaScript files:
```bash
npm run check-syntax
```

### 3. Updated Package Scripts
Added syntax checking script to `package.json`:
```json
{
  "scripts": {
    "check-syntax": "node check-syntax.js"
  }
}
```

## Verification Results

✅ **Server startup**: Backend now starts successfully on port 3001  
✅ **API connectivity**: No more ECONNREFUSED errors  
✅ **Auth endpoints accessible**: 
- `/api/auth/login` returns proper responses (401 for invalid creds, 200 for valid)
- `/api/auth/me` validates tokens and returns appropriate responses  
✅ **Response format**: All endpoints return proper JSON (not HTML errors)  
✅ **Syntax validation**: Added automated syntax checking to prevent recurrence

## Commands Available

```bash
# Check syntax of all server files
npm run check-syntax

# Start backend server
npm run dev:server

# Start full development environment
npm run dev
```

## Prevention
The `npm run check-syntax` command should be run before deploying changes to catch syntax errors early.