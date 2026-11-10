
PeopleFlow HRMS
A full-stack Human Resource Management System built with the MERN stack.

PeopleFlow HRMS brings employee administration, shift scheduling, GPS-based attendance, leave management, payroll, employee documents, HR analytics, and internal announcements into one role-based workspace.

Project status: Core modules implemented. Production deployment and end-to-end verification are in progress.

Tech Stack
Layer	Technology
Frontend	React, Vite, JavaScript, CSS, Lucide React
Backend	Node.js, Express.js
Database	MongoDB, Mongoose
Authentication	JWT-based authentication and role-based authorization
Reports	HR analytics, CSV exports, PDF payslips
Hosting (planned)	Render (frontend and backend), MongoDB Atlas
Features
Authentication and Access Control
Sign in using JWT-based authentication.
Role-based access for Admin, HR, and Employee accounts.
Protected backend routes and role-specific screens.
Employee Management
Create and view employee records.
Maintain employee details including department, designation, salary, and account status.
Shift Management
Create and edit shifts with start/end times, grace periods, and break durations.
Enable or disable overtime for shifts.
Activate/deactivate shifts and assign shifts to employees.
GPS-Based Attendance
Employee check-in and check-out with location verification when enabled.
Attendance records with shift details, late minutes, early exits, working time, and overtime.
Configurable GPS attendance policy on the backend.
Leave Management
Request annual, sick, casual, and unpaid leave.
HR/Admin review and approval/rejection workflow.
Payroll
Generate monthly payroll drafts.
Calculate allowances, bonuses, deductions, and approved unpaid-leave deductions.
View payroll records and download PDF payslips.
Employee Document Management
Upload PDF, JPG, or PNG documents (up to 5 MB per file in the current frontend).
HR/Admin verification and rejection workflow.
Download documents and manage document records.
HR Analytics and Reports
Employee, attendance, leave, and payroll analytics.
Dashboard summaries and CSV report exports.
Company Announcements and Notifications
HR/Admin create drafts, publish announcements, and archive announcements.
Target announcements to all employees or specific departments.
In-app notification bell, unread count, and read/unread management.
Periodic notification refresh; email delivery and real-time push are not currently implemented.
Project Structure
The repository is organized into separate frontend and backend applications. The following is a high-level overview; individual modules may be grouped differently in the current source tree.

peopleflow-hrms/
├── client/                    # React + Vite frontend
│   ├── src/
│   │   ├── main.jsx
│   │   ├── HRAnalytics.jsx
│   │   ├── Announcements.jsx
│   │   ├── NotificationBell.jsx
│   │   └── style.css
│   └── package.json
├── server/                    # Node.js + Express backend
│   ├── src/
│   │   ├── index.js
│   │   ├── models.js
│   │   ├── analyticsRoutes.js
│   │   └── announcementRoutes.js
│   └── package.json
└── README.md
Getting Started
Prerequisites
Node.js and npm
MongoDB (local installation or MongoDB Atlas connection)
Git
1. Clone the repository
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd peopleflow-hrms
2. Install backend dependencies
cd server
npm install
Create a server/.env file with the environment variables required by your backend configuration. For example, use the exact variable names your code reads:

# Illustrative only: verify these names against server/src/index.js
MONGO_URI=<your-mongodb-connection-string>
JWT_SECRET=<a-long-random-secret>
PORT=5000
Start the backend using the script defined in server/package.json (commonly npm run dev or npm start).

3. Install frontend dependencies
Open a second terminal:

cd client
npm install
For local development, the frontend uses this API base URL unless overridden:

# client/.env
VITE_API_URL=http://localhost:5000/api
Run the frontend:

npm run dev
Open the local address displayed by Vite.

Security: Never commit .env files, JWT secrets, database credentials, or private employee documents to GitHub. Add the relevant paths to .gitignore.

API Overview
The backend exposes REST APIs under /api. Examples of implemented API areas:

Module	Example endpoint
Authentication	POST /api/auth/login
Current user	GET /api/auth/me
Employees	GET /api/employees
Shifts	GET /api/shifts
Attendance	GET /api/attendance?month=YYYY-MM
Leave requests	GET /api/leaves
Payroll	GET /api/payroll?month=YYYY-MM
Documents	GET /api/documents
Analytics	GET /api/analytics/overview?month=YYYY-MM
CSV exports	GET /api/reports/export?type=employees&month=YYYY-MM
Announcements	GET /api/announcements
Notifications	GET /api/notifications
Unread count	GET /api/notifications/unread-count
Most endpoints require a valid JWT bearer token; some operations are restricted to Admin/HR roles.

Deployment Plan
The project is intended to be deployed with Render and MongoDB Atlas:

Push the latest reviewed source code to GitHub.
Configure a MongoDB Atlas database and secure credentials.
Deploy the backend as a Render Web Service with root directory server.
Configure backend environment variables and CORS for the frontend domain.
Deploy the Vite frontend as a Render Static Site with root directory client and publish directory dist.
Set the frontend's VITE_API_URL to the public backend URL ending in /api.
Verify authentication, role permissions, GPS attendance, payroll, document handling, analytics, and notifications in the deployed environment.
Production consideration: Employee document uploads must use durable private storage. Render's default local filesystem is not a suitable permanent storage solution across deployments/restarts.

Before Production Use
Verify all environment variable names and package scripts against the actual repository.
Run full end-to-end and security tests, including role and ownership checks.
Validate payroll calculations and attendance edge cases.
Set up durable, access-controlled document storage.
Configure CORS, secure secrets, request validation, logging, and backups.
Avoid uploading real employee personal documents while testing.
Future Improvements
Automated tests and CI/CD workflows.
Advanced salary structure and tax management.
Onboarding and offboarding workflows.
Email notifications and real-time push updates (optional).
Production monitoring and audit logging.
License
No license is declared in this README. Add a LICENSE file if you decide to publish the source under an open-source license.

₹0
⋮⋮⋮⋮