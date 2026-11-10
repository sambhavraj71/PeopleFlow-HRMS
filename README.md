# PeopleFlow HRMS — MERN Stack

A functional intermediate-level HR management and payroll application. No AI features.

## Included
- Admin/HR/employee login with JWT and bcrypt password hashing
- Employee directory and employee creation
- Employee check-in and check-out with one record per day
- Leave requests, overlap checks, and HR approval/rejection
- Monthly payroll draft generation, approved unpaid-leave deduction, payroll approval/locking
- Approved PDF payslips, dashboard metrics, responsive React UI
- API validation, access controls, rate limiting, MongoDB unique indexes

## Requirements
Node.js 20+, npm, MongoDB 7+ running locally (or MongoDB Atlas).

## Quick start (Windows PowerShell)

**Terminal 1 — backend**
```powershell
cd server
Copy-Item .env.example .env
npm install
npm run seed
npm run dev
```

**Terminal 2 — frontend**
```powershell
cd client
Copy-Item .env.example .env
npm install
npm run dev
```

Open http://localhost:5173 and sign in with the seed credentials from `server/.env` (default `admin@example.com` / `Admin@12345`). **Change the seed password and JWT secret before using with any real data.**

### Docker (MongoDB only)
```bash
docker compose up -d
```
Then run the backend/frontend commands above.

## Usage
1. Sign in as admin and create employees (their initial passwords are set during creation).
2. Employees sign in and check in/out and request leave.
3. HR or admin reviews leave requests. Self-approval is blocked.
4. HR generates monthly payroll drafts; duplicate drafts are skipped.
5. HR reviews and approves each draft. Approved records cannot be edited.
6. Employees download their approved payslips.

## Notes and limitations
- This is a **demo / portfolio MVP**, not legally certified payroll software.
- Salary model: basic + optional allowances + bonus - fixed deductions - approved unpaid-leave deduction. Unpaid leave is calculated by overlapping calendar days and calendar-month day count, not a configurable working-day policy.
- No statutory Indian PF/ESI/TDS/PT calculations, leave balance accrual, holiday/weekend policies, overtime pay, bank transfers, salary disbursement, audit logs, multi-tenancy, MFA, or refresh-token rotation. Add these before production use.
- The frontend is optimized for the demo flows; backend includes payroll draft editing API but the UI does not expose it.
- Check-in dates are based on UTC server date; configure an organization timezone for production.
- API runs at http://localhost:5000/api and frontend at http://localhost:5173.
- Do not store real employee PII until security, backups, privacy policy, retention controls and compliance are reviewed.

## Key API routes
- POST `/api/auth/login`, GET `/api/auth/me`, PATCH `/api/auth/password`
- GET/POST `/api/employees`, PATCH `/api/employees/:id`
- GET `/api/attendance`, POST `/api/attendance/check-in`, POST `/api/attendance/check-out`
- GET/POST `/api/leaves`, PATCH `/api/leaves/:id/status`
- GET `/api/payroll`, POST `/api/payroll/generate`, PATCH `/api/payroll/:id`, POST `/api/payroll/:id/approve`, GET `/api/payroll/:id/payslip`
- GET `/api/dashboard`, GET `/api/health`

Protected routes require `Authorization: Bearer <JWT>`.
