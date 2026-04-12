# 💰 TRIKA SAVINGS & INVESTMENT MANAGEMENT SYSTEM

> A complete Progressive Web App (PWA) for group savings and investment tracking.
> Built for Collins K. Towett, Gilbert K. Lang'at, and Amos K. Korir.

---

## 📋 TABLE OF CONTENTS

1. [System Overview](#overview)
2. [Features](#features)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Step-by-Step Deployment Guide](#deployment)
   - [Step 1: Supabase Setup](#step-1-supabase-setup)
   - [Step 2: Clone & Configure](#step-2-configure)
   - [Step 3: Deploy to Vercel](#step-3-vercel)
   - [Step 4: Create Member Accounts](#step-4-members)
6. [Usage Guide](#usage)
7. [Security](#security)
8. [Maintenance](#maintenance)

---

## 🎯 Overview <a name="overview"></a>

Trika is a **financial intelligence and tracking layer** built on top of your existing bank account. It is NOT a banking platform — it mirrors transactions you record, tracks individual contributions, calculates dynamic ownership percentages, and provides tools for investment management and profit distribution.

---

## ✅ Features <a name="features"></a>

| Feature | Description |
|---|---|
| 🔐 Secure Authentication | Email/password login per member |
| 📊 Live Dashboard | Pool balance, ownership %, recent activity |
| 💳 Transaction Management | Deposit / Withdrawal / Adjustment tracking |
| ✅ Withdrawal Approvals | 2-of-3 member approval system |
| 👥 Member Ownership | Dynamic % calculated from contributions |
| 📈 Investment Tracking | Portfolio management with ROI |
| 💸 Dividend Distribution | Profit split by ownership % |
| 🎯 Savings Goals | Target tracking with progress bars |
| 📑 Reports & Exports | PDF and Excel financial reports |
| 🔔 Notifications | Real-time alerts for all members |
| 🛡️ Audit Log | Complete activity trail (Admin only) |
| 📱 PWA | Installable on mobile and desktop |
| 🌙 Dark Theme | Professional navy/gold design |

---

## 🛠 Tech Stack <a name="tech-stack"></a>

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Styling | Custom CSS (no Tailwind dependency) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Real-time | Supabase Realtime |
| Charts | Chart.js + react-chartjs-2 |
| PDF Export | jsPDF + jsPDF-AutoTable |
| Excel Export | SheetJS (xlsx) |
| PWA | vite-plugin-pwa + Workbox |
| Hosting | Vercel |

---

## 📁 Project Structure <a name="project-structure"></a>

```
trika-savings/
├── public/                   # Static assets (PWA icons)
├── scripts/
│   └── setup-members.js      # One-time member creation script
├── src/
│   ├── components/
│   │   ├── AppShell.jsx       # Layout with sidebar + topbar
│   │   └── transactions/
│   │       └── AddTransactionModal.jsx
│   ├── hooks/
│   │   └── useAuth.jsx        # Auth context provider
│   ├── lib/
│   │   ├── supabase.js        # Supabase client
│   │   └── utils.js           # Formatting helpers
│   ├── pages/
│   │   ├── LoginPage.jsx
│   │   ├── DashboardPage.jsx
│   │   ├── TransactionsPage.jsx
│   │   ├── MembersPage.jsx
│   │   ├── InvestmentsPage.jsx
│   │   ├── GoalsPage.jsx
│   │   ├── ReportsPage.jsx
│   │   ├── AuditPage.jsx
│   │   └── SettingsPage.jsx
│   ├── styles/
│   │   └── main.css
│   ├── App.jsx
│   └── main.jsx
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql   # Full DB schema
│       └── 002_seed_members.sql     # Member setup guide
├── index.html
├── vite.config.js
├── vercel.json
├── package.json
└── .env.example
```

---

## 🚀 Step-by-Step Deployment Guide <a name="deployment"></a>

### Step 1: Supabase Setup <a name="step-1-supabase-setup"></a>

1. **Create a Supabase project**
   - Go to [https://supabase.com](https://supabase.com)
   - Click "New Project"
   - Name it `trika-savings`
   - Choose a strong database password (save it!)
   - Select region closest to Kenya: `eu-west-1` (Europe) or `ap-southeast-1` (Asia)
   - Click "Create new project" and wait ~2 minutes

2. **Run the database schema**
   - In your Supabase dashboard, go to **SQL Editor**
   - Click "New Query"
   - Open `supabase/migrations/001_initial_schema.sql`
   - Copy ALL the contents and paste into the editor
   - Click **Run** (green button)
   - You should see "Success. No rows returned"

3. **Get your API keys**
   - Go to **Settings → API**
   - Copy your:
     - `Project URL` → this is `VITE_SUPABASE_URL`
     - `anon public` key → this is `VITE_SUPABASE_ANON_KEY`
     - `service_role` key → this is `SUPABASE_SERVICE_ROLE_KEY` (for setup script only, keep secret!)

---

### Step 2: Configure the Project <a name="step-2-configure"></a>

1. **Install Node.js** (if not installed)
   - Download from [https://nodejs.org](https://nodejs.org) — use LTS version

2. **Download the project files**
   - Place all files in a folder called `trika-savings`

3. **Create environment file**
   ```bash
   # In the project folder, create .env.local
   VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGci...your-anon-key...
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...your-service-role-key...
   ```

4. **Install dependencies**
   ```bash
   npm install
   ```

5. **Test locally** (optional but recommended)
   ```bash
   npm run dev
   # Open http://localhost:5173
   ```

---

### Step 3: Deploy to Vercel <a name="step-3-vercel"></a>

#### Option A: Via Vercel CLI (Recommended)

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy (run from project folder)
vercel

# Follow prompts:
# - Set up and deploy? Y
# - Which scope? (your account)
# - Link to existing project? N
# - Project name: trika-savings
# - In which directory is your code? ./
# - Override settings? N
```

After first deploy, add environment variables:
```bash
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY

# Then redeploy
vercel --prod
```

#### Option B: Via GitHub + Vercel Dashboard

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial Trika Savings setup"
   git remote add origin https://github.com/YOUR_USERNAME/trika-savings.git
   git push -u origin main
   ```

2. **Connect to Vercel**
   - Go to [https://vercel.com](https://vercel.com)
   - Click "Add New → Project"
   - Import your GitHub repository
   - Framework Preset: **Vite**
   - Add Environment Variables:
     - `VITE_SUPABASE_URL` = your Supabase URL
     - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
   - Click **Deploy**

3. **Your app will be live at:** `https://trika-savings.vercel.app`

---

### Step 4: Create Member Accounts <a name="step-4-members"></a>

#### Option A: Using the Setup Script (Easiest)

```bash
# Add SUPABASE_SERVICE_ROLE_KEY to .env.local first, then:
node scripts/setup-members.js
```

This creates all 3 accounts automatically. **Change the passwords in the script before running!**

#### Option B: Via Supabase Dashboard (Manual)

1. Go to **Supabase Dashboard → Authentication → Users**
2. Click **"Add User"** → **"Create new user"**
3. Create these three users:

   | Name | Email | Password | Role |
   |---|---|---|---|
   | Collins K. Towett | collins.towett@trika.app | (strong password) | admin |
   | Gilbert K. Lang'at | gilbert.langat@trika.app | (strong password) | member |
   | Amos K. Korir | amos.korir@trika.app | (strong password) | member |

4. After creating, go to **SQL Editor** and run:
   ```sql
   UPDATE profiles SET name = 'Collins K. Towett', role = 'admin'
   WHERE email = 'collins.towett@trika.app';
   
   UPDATE profiles SET name = 'Gilbert K. Lang''at', role = 'member'
   WHERE email = 'gilbert.langat@trika.app';
   
   UPDATE profiles SET name = 'Amos K. Korir', role = 'member'
   WHERE email = 'amos.korir@trika.app';
   ```

5. Verify:
   ```sql
   SELECT name, email, role FROM profiles ORDER BY created_at;
   ```

#### Option C: Use any email addresses you prefer

The emails above are suggestions. Use any valid emails (Gmail, etc.):
- `collinstowett@gmail.com`
- `gilbertlangat@gmail.com`  
- `amoskorir@gmail.com`

Just make sure to run the SQL update to set names and roles correctly.

---

## 📱 Installing as a PWA

Once deployed, members can install the app on their phones:

**Android:**
1. Open the app URL in Chrome
2. Tap the "Add to Home Screen" banner OR tap ⋮ menu → "Add to Home Screen"

**iPhone:**
1. Open the app URL in Safari
2. Tap the Share button (□ with arrow)
3. Scroll down and tap "Add to Home Screen"

**Desktop (Chrome/Edge):**
1. Open the app URL
2. Click the install icon in the address bar

---

## 📖 Usage Guide <a name="usage"></a>

### Recording a Transaction
1. Click **"Record Transaction"** button (Dashboard or Transactions page)
2. Select the member who made the transaction
3. Choose type: Deposit / Withdrawal / Adjustment
4. Enter amount, date, and optional bank reference
5. Click "Record Transaction"

**Note:** Withdrawals go into "pending" status and require 2-of-3 member approval.

### Approving a Withdrawal
1. When a withdrawal is requested, the other two members receive notifications
2. Go to **Transactions** page
3. Find the pending withdrawal (shown in amber)
4. Click **"Approve"** or **"Reject"**
5. Once 2 members approve, it's automatically marked as approved

### Adding an Investment
1. Go to **Investments** page (Admin only to add)
2. Click "Add Investment"
3. Fill in: title, type, amount, dates
4. Once returns are realized, click "Distribute" to split profits by ownership %

### Distributing Dividends
1. Go to **Investments** page
2. Find the investment with returns
3. Click **"Distribute"** button
4. Enter the total profit amount
5. System shows each member's share based on their current ownership %
6. Click "Distribute" — all members are notified automatically

### Generating Reports
1. Go to **Reports** page
2. Optionally filter by date range
3. Click **"Export PDF"** or **"Export Excel"**
4. Report includes: summary, contributions, all transactions, investments, dividends

---

## 🔐 Security <a name="security"></a>

- **Row Level Security (RLS)** is enabled on all tables — users can only access their own data
- **Role-Based Access** — only admins can see Audit Log and Settings management
- **Withdrawal Approvals** — prevents unauthorized withdrawals
- **Audit Trail** — all actions are logged with user ID and timestamp
- **JWT Authentication** — Supabase handles secure token management
- **HTTPS** — Vercel enforces HTTPS on all deployments

### Important Security Notes:
- Never share your `SUPABASE_SERVICE_ROLE_KEY` — it bypasses all security
- Only the `VITE_SUPABASE_ANON_KEY` should be in the frontend
- Encourage all members to use strong passwords
- The admin (Collins) can view audit logs to track all system activity

---

## 🔧 Maintenance <a name="maintenance"></a>

### Backing Up Data
In Supabase Dashboard:
- Go to **Settings → Database**
- Click **"Download backup"** for a full SQL dump

### Monitoring
- Supabase Dashboard shows database usage, API calls, and storage
- Free tier: 500MB database, 2GB bandwidth/month
- Upgrade to Pro ($25/month) if you exceed limits

### Adding a New Member
1. Create auth user in Supabase
2. Run SQL to update their profile with name and role
3. Their ownership % will automatically be calculated from their contributions

### Common Issues

**Problem:** "Missing Supabase environment variables"
**Fix:** Make sure `.env.local` exists with correct keys and redeploy on Vercel

**Problem:** Profiles not created after signup
**Fix:** Run the trigger manually or use the seed script

**Problem:** "Permission denied" errors
**Fix:** Ensure RLS policies were applied correctly in the migration

---

## 📞 Support

Built for: Trika Savings Group, Nairobi, Kenya  
Stack: React + Supabase + Vercel  
Version: 1.0.0

---

*"Individually we are one drop. Together we are an ocean." — Ryūnosuke Akutagawa*
