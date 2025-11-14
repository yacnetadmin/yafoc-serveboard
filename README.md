YAC ServeBoard

A hybrid volunteer sign-up and task management tool built for the York Alliance Family of Churches.
ServeBoard provides a simple staff-facing management portal and a clean volunteer-facing sign-up experience — all powered by GitHub Pages for the UI and Azure Functions for the backend.

✨ Overview

ServeBoard allows ministry staff to create projects, define task “slots,” and provide public pages where volunteers can sign up quickly and easily. It is designed for:
-Church events and ministries (outreach, meals, serving opportunities)
-Recurring volunteer roles
-One-off tasks with limited or unlimited slots
-Multi-campus usage across York, Spring Grove, and Stewartstown

ServeBoard combines a static web front-end (lightweight, fast, zero maintenance) with a secure Azure API backend.

🏗 Architecture
The project is intentionally simple and lightweight:

GitHub Pages (UI) → Azure Functions API → Azure Table Storage

UI (Static Web App) hosted from /docs/
-Staff portal (manage projects + slots)
-Public volunteer sign-up pages
-Mobile-optimized

Backend (Azure Functions / Node.js)
-Project CRUD
-Slot creation + updates
-Volunteer sign-ups
-Auth (Microsoft Entra for staff)

Storage (Azure Table Storage)
-Projects table
-Slots table
-Sign-ups table

📂 Repository Structure
/api/        → Azure Functions (Node.js)
/docs/       → Web front-end served by GitHub Pages
│   index.html          → Volunteer-facing UI entry
│   manage.html         → Staff project management
│   create-slot.html    → Staff slot creation
│   signup.html         → Public volunteer sign-up
│   css/                → Stylesheets
│   js/                 → Front-end logic

🚀 Deployment
Frontend
The site is deployed automatically using GitHub Pages from the /docs folder.
Public URL: https://serve.yorkalliance.org/

Backend
Azure Functions deployed to: https://<function-app-name>.azurewebsites.net/api/

Environment variables (Function App):
-MICROSOFT_CLIENT_ID
-MICROSOFT_TENANT_ID
-STORAGE_CONNECTION_STRING (for local dev)
-Key Vault references in production

🔑 Authentication
-Staff authenticate via Microsoft Entra ID
(Used for project + slot management pages)
-Volunteers do not require accounts — sign-ups are simple and instant

📱 Mobile UX
ServeBoard uses a dual-layout approach:
-Desktop → full table views
-Mobile → stacked “card” list views for readability
 (Handled via responsive CSS)

🧪 Local Development
Run the API locally:
-cd api
-func start

Serve the UI locally:
Use any lightweight local server:
-cd docs
-python3 -m http.server 8000

Then open:
-http://localhost:8000

Make sure local.settings.json contains your storage connection string for API testing.

🛠 Technology Stack
Frontend: HTML, CSS, vanilla JS (no frameworks)
Backend: Azure Functions (Node.js)
Auth: MSAL (Microsoft Entra ID)
Data: Azure Table Storage
Hosting: GitHub Pages + Azure Functions

🌱 Vision
ServeBoard is designed to grow into a reusable, lightweight volunteer platform for:
-Multi-campus churches
-Nonprofits
-Event teams
-Anyone who needs a simple way to publish tasks and record sign-ups without complex systems
