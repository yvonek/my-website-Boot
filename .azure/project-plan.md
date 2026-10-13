# Project Plan

**Status**: Integration Blocked
**Created**: 2026-09-28
**Mode**: NEW
**Execution Mode**: auto

---

## 1. Project Overview

**Goal**: Build a responsive, mobile-first demo business dashboard for Rwandan franc income tracking, rewards, plans, referrals, and profile actions using representative data only. The project is designed so that every module is independently testable.

**App Type**: Static + API

**API Login**: No

**Mode**: NEW

**Deployment Plan**: No deployment plan found

---

## 2. Frontend — Web App

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Framework** | React + Vite |
| **Package Manager** | npm |
| **Test Runner** | vitest |
| **Mocking Library** | vi.mock |
| **Test Command** | npm test |

---

## 3. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) | Classification |
|---------------|------------|---------------------|----------------------|----------------|
| None | Frontend demo data is held in typed local fixtures; no persistence or Azure service is required. | — | — | Enhancement |

---

## 4. Prerequisites

### Run

| Tool | Service(s) | Installed | Version |
|------|------------|-----------|---------|
| Node.js | * | ✅ | 24.19.0 |
| npm | * | ✅ | Bundled with Node.js |
| Vite | * | ❓ | Installed through project dependencies |

### Debug

| Tool | Service(s) | Installed | Version |
|------|------------|-----------|---------|
| VS Code JavaScript debugger (`ms-vscode.js-debug`) | frontend | ❓ | Verify in VS Code |

Double-check all ❓ tools are available before proceeding.

---

## 5. Design System & UI

**Component Library**: Fluent UI v9
**Style Direction**: A compact, high-contrast mobile finance console with a visible photographic lifestyle backdrop, dark glass surfaces, cyan-teal interaction states, and warm gold reward accents. The interface should feel energetic and trustworthy without implying real financial transactions.
**Typography**: Segoe UI Variable

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#23D6C7` | Cyan-teal actions, active navigation, balance emphasis |
| `accent` | `#F4C95D` | Reward highlights, plan badges, bonus and spin accents |
| `surface` | `#101A22` | Dark page and dashboard surfaces over the photo backdrop |
| `text` | `#F5FAFA` | Primary dashboard content and readable values |
| `muted` | `#9BB0B4` | Supporting labels, timestamps, and secondary metrics |
| `border` | `#2B4348` | Glass panel edges, dividers, and input outlines |

### Pages

| Page | Route | Purpose | Layout |
|------|-------|---------|--------|
| Home Dashboard | `/` | Summarize balance, daily income, rewards, quick actions, and active plans. | `header, nav, hero, main, grid, card-list, actions, footer` |
| Plans | `/plans` | Compare active earning plans and their daily return summaries. | `header, nav, main, tabs, card-list, actions, footer` |
| Invite | `/invite` | Show referral progress, commission totals, and invite actions. | `header, nav, main, hero, grid, card-list, actions, footer` |
| Me | `/me` | Show profile-level preferences, support, and account-adjacent demo tools. | `header, nav, main, list, actions, footer` |

### Sample Content

Home Dashboard — earning snapshot:
| Metric | Value | Detail | Status |
|--------|-------|--------|--------|
| Available balance | RWF 184,500 | Ready demo balance | Available |
| Daily income | RWF 3,250 | +8.4% from yesterday | Growing |
| Task rewards | RWF 12,800 | 4 tasks completed | Earned |
| Commission | RWF 46,200 | 6 active referrals | Growing |
| Bonus | RWF 8,500 | Welcome campaign | Pending |

Plans — active plan:
| Plan | Deposited | Income / day | Term | Status |
|------|-----------|--------------|------|--------|
| Umutekano Starter | RWF 50,000 | RWF 1,100 | 30 days | Active |
| Imboni Plus | RWF 100,000 | RWF 2,150 | 60 days | Active |
| Amahoro Boost | RWF 25,000 | RWF 480 | 14 days | Ending soon |

Invite — referral record:
| Person | Joined | Contribution | Commission | Status |
|------|--------|--------------|------------|--------|
| Jeanette M. | 18 Sep 2026 | RWF 100,000 | RWF 12,000 | Active |
| Patrick N. | 22 Sep 2026 | RWF 50,000 | RWF 6,000 | Active |
| Aline K. | 26 Sep 2026 | RWF 25,000 | RWF 3,000 | Pending |

Me — support tools:
| Tool | Value | State |
|------|-------|-------|
| Daily Earning | 09:00 check-in | Ready |
| Gift code | RW-START-26 | Available |
| Spin & Win | Next spin in 04:12:36 | Locked |
| Support | In-app help desk | Online |

---

## 6. Project Structure

```
project-root/
├── .azure/
│   └── project-plan.md
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── App.tsx
    ├── main.tsx
    ├── styles/
    │   └── theme.css
    ├── data/
    │   └── demoData.ts
    ├── components/
    │   ├── AppShell.tsx
    │   ├── BottomNavigation.tsx
    │   ├── MetricCard.tsx
    │   └── PlanCard.tsx
    ├── pages/
    │   ├── HomeDashboard.tsx
    │   ├── PlansPage.tsx
    │   ├── InvitePage.tsx
    │   └── MePage.tsx
    └── test/
        └── dashboard.test.tsx
```

---

## 7. Route Definitions

| # | Method | Path | Description | Request Body | Response Body | Status Codes |
|---|--------|------|-------------|-------------|--------------|-------------|
| 1 | GET | `/` | Render the Home Dashboard with local demo data. | — | React view with balance, metrics, actions, and plans | 200 |
| 2 | GET | `/plans` | Render active and ending-soon demo plans. | — | React view with plan cards | 200 |
| 3 | GET | `/invite` | Render referral and commission demo records. | — | React view with referral summary and rows | 200 |
| 4 | GET | `/me` | Render demo support and profile tools. | — | React view with tool states and support action | 200 |

---

## 8. Next Steps

1. Run **azure-project-scaffold** to execute this plan
2. Run **azure-project-integrate** to wire the frontend to live data, smoke-test the backend, and create the migrations
3. Run **azure-debug-plan** → **azure-debug-generate** for Docker emulators and VS Code debugging
4. Run the **azure-deploy** agent when ready; it uses **azure-app-onboard** for architecture, cost estimation, IaC generation, provisioning, and health verification
