// ---------------------------------------------------------------------------
// MOCK DATA ONLY. Nothing here comes from QuickBooks or a real bank feed yet.
// This file is what gets replaced in Phase 2 (QuickBooks) and Phase 3 (bank).
// Sample organizations are churches and nonprofits, since that's this
// bookkeeping practice's primary client base.
// ---------------------------------------------------------------------------

const CLIENTS = [
  {
    id: "grace-community",
    name: "Grace Community Church",
    orgType: "Church",
    // Billing tier. Premium unlocks the Daily Report; the gate lives in the
    // route/page loader in app.jsx, never inside the DailyClose component.
    plan: "premium",
    // Who at this organization can log in, and what each of them may see.
    // Configured by MyGoodBooks only — never editable by the client.
    users: [
      {
        id: "john",
        name: "Pastor John Whitfield",
        role: "Lead Pastor",
        email: "john@gracecommunity.org",
        access: "full",
      },
      {
        id: "rachel",
        name: "Rachel Delgado",
        role: "Kids Ministry Director",
        email: "rachel@gracecommunity.org",
        access: "scoped",
        tabs: ["dashboard", "budget", "documents", "messages"],
        categories: ["Kids Ministry"],
        funds: ["Kids Ministry Fund"],
      },
      {
        id: "tom",
        name: "Tom Reyes",
        role: "Board Treasurer",
        email: "treasurer@gracecommunity.org",
        access: "scoped",
        tabs: ["dashboard", "budget", "reports", "receivables", "messages"],
        categories: null, // all categories — restricted by tab only
        funds: null,
      },
    ],
    monthly: [
      { month: "Mar", income: 52000, expenses: 47800 },
      { month: "Apr", income: 54200, expenses: 48900 },
      { month: "May", income: 58900, expenses: 51200 },
      { month: "Jun", income: 61200, expenses: 53800 },
      { month: "Jul", income: 59800, expenses: 52900 },
      { month: "Aug", income: 63500, expenses: 55100 },
    ],
    budget: [
      { category: "Staff & Pastoral Salaries", budgeted: 28000, actual: 28650 },
      { category: "Facilities & Utilities", budgeted: 8200, actual: 8890 },
      { category: "Kids Ministry", budgeted: 3200, actual: 3540 },
      { category: "Ministry Programs", budgeted: 4500, actual: 3980 },
      { category: "Missions & Outreach", budgeted: 6000, actual: 6000 },
      { category: "Worship & Media", budgeted: 2200, actual: 2410 },
      { category: "Insurance", budgeted: 1800, actual: 1800 },
    ],
    bankAccounts: [
      {
        id: "operating",
        accountName: "General Operating",
        accountMask: "1204",
        type: "Checking",
        balance: 68420.55,
        transactions: [
          { date: "2026-08-24", description: "Weekly Giving Deposit", category: "Giving", amount: 8420.00 },
          { date: "2026-08-22", description: "Payroll - Gusto", category: "Payroll", amount: -14200.00 },
          { date: "2026-08-20", description: "City Water & Power", category: "Utilities", amount: -1120.40 },
          { date: "2026-08-18", description: "Weekly Giving Deposit", category: "Giving", amount: 9180.00 },
          { date: "2026-08-15", description: "LifeWay Curriculum Order", category: "Ministry Programs", amount: -340.20 },
          { date: "2026-08-14", description: "Kids Church Supplies - Oriental Trading", category: "Kids Ministry", amount: -418.60 },
          { date: "2026-08-12", description: "Denominational Assessment", category: "Missions & Outreach", amount: -1500.00 },
          { date: "2026-08-11", description: "Weekly Giving Deposit", category: "Giving", amount: 7960.00 },
          { date: "2026-08-09", description: "VBS Snacks & Craft Materials", category: "Kids Ministry", amount: -612.35 },
          { date: "2026-08-08", description: "Guardian Insurance", category: "Insurance", amount: -1800.00 },
          { date: "2026-08-06", description: "Kids Ministry Volunteer Background Checks", category: "Kids Ministry", amount: -245.00 },
          { date: "2026-08-03", description: "Nursery Equipment Replacement", category: "Kids Ministry", amount: -389.99 },
        ],
      },
      {
        id: "building-fund",
        accountName: "Building Fund Savings",
        accountMask: "5588",
        type: "Savings",
        balance: 142300.00,
        transactions: [
          { date: "2026-08-18", description: "Transfer from Operating - Monthly Set-Aside", category: "Transfer In", amount: 4000.00 },
          { date: "2026-08-04", description: "Johnson Family - Building Pledge Payment", category: "Giving", amount: 500.00 },
          { date: "2026-07-21", description: "Roof Repair - Phase 1 Deposit", category: "Facilities & Utilities", amount: -6200.00 },
          { date: "2026-07-18", description: "Transfer from Operating - Monthly Set-Aside", category: "Transfer In", amount: 4000.00 },
        ],
      },
    ],
    // INVARIANT: fund balances must sum to net assets (total bank balances
    // minus payables). Restricted funds are carved OUT of the cash already in
    // the accounts, never added on top of it, so the unrestricted General Fund
    // is the balancing figure. Here: 208,500.55 net assets − 172,650 restricted.
    funds: [
      { name: "General Fund", restricted: false, balance: 35850.55 },
      { name: "Building Fund", restricted: true, balance: 142300.00 },
      { name: "Missions Fund", restricted: true, balance: 18750.00 },
      { name: "Kids Ministry Fund", restricted: true, balance: 5180.00 },
      { name: "Benevolence Fund", restricted: true, balance: 6420.00 },
    ],
    contributions: [
      { date: "2026-08-24", donor: "The Whitfield Family", fund: "General Fund", method: "Online", amount: 500.00 },
      { date: "2026-08-24", donor: "Anonymous", fund: "General Fund", method: "Cash", amount: 150.00 },
      { date: "2026-08-18", donor: "Robert & Linda Chen", fund: "General Fund", method: "Check", amount: 300.00 },
      { date: "2026-08-18", donor: "Johnson Family", fund: "Building Fund", method: "Check", amount: 500.00 },
      { date: "2026-08-11", donor: "Marcus Reed", fund: "Missions Fund", method: "Online", amount: 200.00 },
      { date: "2026-08-11", donor: "The Alvarez Family", fund: "General Fund", method: "Online", amount: 250.00 },
      { date: "2026-08-09", donor: "The Delgado Family", fund: "Kids Ministry Fund", method: "Online", amount: 300.00 },
      { date: "2026-08-06", donor: "Anonymous", fund: "Kids Ministry Fund", method: "Cash", amount: 75.00 },
      { date: "2026-08-04", donor: "Anonymous", fund: "Benevolence Fund", method: "Cash", amount: 100.00 },
      { date: "2026-08-04", donor: "Susan Patterson", fund: "General Fund", method: "ACH", amount: 400.00 },
    ],
    receivables: [
      { description: "Building Campaign Pledge Balance - Johnson Family", amount: 5000.00, dueDate: "2026-09-15" },
      { description: "Matching Grant - Community Foundation", amount: 10000.00, dueDate: "2026-09-30" },
    ],
    payables: [
      { vendor: "Regional Fellowship Assessment", description: "Annual denominational dues", amount: 1200.00, dueDate: "2026-09-05" },
      { vendor: "ServiceMaster HVAC", description: "Quarterly service contract", amount: 640.00, dueDate: "2026-09-10" },
      { vendor: "LifeWay Christian Resources", description: "Fall curriculum order balance", amount: 380.00, dueDate: "2026-09-12" },
    ],
    // visibility: "all" = everyone at the org with the Documents tab;
    // "full" = full-access users only. Set by MyGoodBooks, never by the client.
    documents: [
      { name: "August Bank Statement - Operating.pdf", category: "Bank Statement", uploadedBy: "MyGoodBooks", date: "2026-08-25", size: "412 KB", visibility: "full" },
      { name: "Property Insurance Policy 2026.pdf", category: "Insurance", uploadedBy: "Grace Community Church", date: "2026-07-02", size: "1.1 MB", visibility: "all" },
      { name: "July Financial Statements.pdf", category: "Financial Statement", uploadedBy: "MyGoodBooks", date: "2026-08-03", size: "268 KB", visibility: "full" },
      { name: "Building Campaign Pledge Log.xlsx", category: "Giving", uploadedBy: "Grace Community Church", date: "2026-08-10", size: "58 KB", visibility: "full" },
    ],
    // One private thread per person, keyed by user id. A staff member only ever
    // sees their own conversation with MyGoodBooks — the treasurer's questions
    // aren't the kids ministry director's business.
    threads: {
      john: [
        { from: "client", author: "Pastor John Whitfield", date: "2026-08-20", text: "Hi! Do we have enough in the building fund to cover the second phase of the roof repair, or should we hold off until next quarter?" },
        { from: "bookkeeper", author: "MyGoodBooks", date: "2026-08-20", text: "Looking at it now — Building Fund is sitting at $142,300 after this month's set-aside, and Phase 1 only used $6,200. You're in good shape to move ahead on Phase 2 whenever the contractor is ready." },
        { from: "client", author: "Pastor John Whitfield", date: "2026-08-21", text: "Perfect, that's what I was hoping to hear. Thank you!" },
      ],
      rachel: [
        { from: "client", author: "Rachel Delgado", date: "2026-08-14", text: "I went a little over on VBS craft supplies this year. Do I need to do anything about that, or will it wash out?" },
        { from: "bookkeeper", author: "MyGoodBooks", date: "2026-08-14", text: "No action needed on your end — I've coded it to Kids Ministry. You're about $340 over for the month, which I'll flag in the summary for Pastor John. Just send me the receipts when you get a chance." },
      ],
      tom: [
        { from: "client", author: "Tom Reyes", date: "2026-08-23", text: "For the board packet — can you confirm the receivables number I should be quoting for the building campaign?" },
      ],
    },
  },

  {
    id: "new-hope",
    name: "New Hope Fellowship",
    orgType: "Church Plant",
    plan: "standard",
    users: [
      {
        id: "mia",
        name: "Pastor Mia Ortiz",
        role: "Lead Pastor",
        email: "mia@newhopefellowship.org",
        access: "full",
      },
      {
        id: "kevin",
        name: "Kevin Nakamura",
        role: "Worship Lead",
        email: "kevin@newhopefellowship.org",
        access: "scoped",
        tabs: ["dashboard", "budget", "messages"],
        categories: ["Worship & Media"],
        funds: null,
      },
    ],
    monthly: [
      { month: "Mar", income: 9200, expenses: 9800 },
      { month: "Apr", income: 8900, expenses: 10100 },
      { month: "May", income: 11200, expenses: 10500 },
      { month: "Jun", income: 10100, expenses: 10800 },
      { month: "Jul", income: 9800, expenses: 10950 },
      { month: "Aug", income: 9500, expenses: 11200 },
    ],
    budget: [
      { category: "Pastoral Salary", budgeted: 4200, actual: 4200 },
      { category: "Rent (Shared Facility)", budgeted: 2200, actual: 2200 },
      { category: "Worship & Media", budgeted: 800, actual: 1120 },
      { category: "Outreach & Events", budgeted: 900, actual: 1350 },
      { category: "Office & Admin", budgeted: 400, actual: 380 },
      { category: "Insurance", budgeted: 350, actual: 350 },
    ],
    bankAccounts: [
      {
        id: "operating",
        accountName: "Operating Checking",
        accountMask: "3391",
        type: "Checking",
        balance: 4820.30,
        transactions: [
          { date: "2026-08-23", description: "Sunday Giving Deposit", category: "Giving", amount: 2140.00 },
          { date: "2026-08-21", description: "Pastoral Salary", category: "Pastoral Salary", amount: -4200.00 },
          { date: "2026-08-18", description: "Community Center - Rent", category: "Rent", amount: -2200.00 },
          { date: "2026-08-16", description: "Sunday Giving Deposit", category: "Giving", amount: 1980.00 },
          { date: "2026-08-14", description: "Portable Sound Co. - Speaker Repair", category: "Worship & Media", amount: -310.00 },
          { date: "2026-08-09", description: "Sunday Giving Deposit", category: "Giving", amount: 1740.00 },
          { date: "2026-08-06", description: "Fall Launch Event - Supplies", category: "Outreach & Events", amount: -480.00 },
        ],
      },
    ],
    // Sums to net assets: 4,450.30 = 4,820.30 cash − 370 payables.
    funds: [
      { name: "General Fund", restricted: false, balance: 3810.30 },
      { name: "Benevolence Fund", restricted: true, balance: 640.00 },
    ],
    contributions: [
      { date: "2026-08-23", donor: "The Ortiz Family", fund: "General Fund", method: "Online", amount: 200.00 },
      { date: "2026-08-23", donor: "Anonymous", fund: "General Fund", method: "Cash", amount: 60.00 },
      { date: "2026-08-16", donor: "Kevin Nakamura", fund: "General Fund", method: "Online", amount: 150.00 },
      { date: "2026-08-16", donor: "Anonymous", fund: "Benevolence Fund", method: "Cash", amount: 40.00 },
      { date: "2026-08-09", donor: "The Boyd Family", fund: "General Fund", method: "Check", amount: 125.00 },
      { date: "2026-08-09", donor: "Sarah Whitman", fund: "General Fund", method: "Online", amount: 75.00 },
    ],
    receivables: [
      { description: "Launch Team Founding Pledge Balance", amount: 800.00, dueDate: "2026-09-20" },
    ],
    payables: [
      { vendor: "Portable Sound Co.", description: "Equipment lease, monthly", amount: 220.00, dueDate: "2026-09-01" },
      { vendor: "Regional Fellowship Assessment", description: "Church plant assessment", amount: 150.00, dueDate: "2026-09-05" },
    ],
    documents: [
      { name: "August Bank Statement.pdf", category: "Bank Statement", uploadedBy: "MyGoodBooks", date: "2026-08-25", size: "204 KB", visibility: "full" },
      { name: "Facility Use Agreement.pdf", category: "Facilities", uploadedBy: "New Hope Fellowship", date: "2026-06-15", size: "340 KB", visibility: "all" },
      { name: "July Financial Statements.pdf", category: "Financial Statement", uploadedBy: "MyGoodBooks", date: "2026-08-03", size: "198 KB", visibility: "full" },
    ],
    threads: {
      mia: [
        { from: "client", author: "Pastor Mia Ortiz", date: "2026-08-22", text: "Our checking balance looked lower than usual this week - is that something to worry about?" },
        { from: "bookkeeper", author: "MyGoodBooks", date: "2026-08-22", text: "Good catch, and good instinct to ask. You've run a small deficit the last few months mostly from one-time launch expenses. Nothing alarming yet, but let's talk this week about tightening the outreach budget so it doesn't become a pattern." },
        { from: "client", author: "Pastor Mia Ortiz", date: "2026-08-22", text: "Sounds good, I'll call you tomorrow." },
      ],
      kevin: [
        { from: "client", author: "Kevin Nakamura", date: "2026-08-16", text: "We need to replace a monitor for the sound booth. Is there anything left in the worship & media line this month?" },
        { from: "bookkeeper", author: "MyGoodBooks", date: "2026-08-16", text: "You're already about $210 over budget for the month, so I'd hold off if it can wait until September. If it can't, check with Pastor Mia first." },
      ],
    },
  },

  {
    id: "riverside-pantry",
    name: "Riverside Food Pantry",
    orgType: "Nonprofit",
    plan: "premium",
    users: [
      {
        id: "dana",
        name: "Dana Petrakis",
        role: "Executive Director",
        email: "dana@riversidepantry.org",
        access: "full",
      },
      {
        id: "luis",
        name: "Luis Moreno",
        role: "Warehouse Manager",
        email: "luis@riversidepantry.org",
        access: "scoped",
        tabs: ["dashboard", "budget", "documents"],
        categories: ["Food & Supplies Procurement", "Warehouse & Facilities", "Transportation & Fleet"],
        funds: null,
      },
    ],
    monthly: [
      { month: "Mar", income: 24500, expenses: 22100 },
      { month: "Apr", income: 26800, expenses: 23400 },
      { month: "May", income: 22100, expenses: 24800 },
      { month: "Jun", income: 31200, expenses: 25100 },
      { month: "Jul", income: 28900, expenses: 26200 },
      { month: "Aug", income: 27400, expenses: 26800 },
    ],
    budget: [
      { category: "Program Staff", budgeted: 11000, actual: 11400 },
      { category: "Food & Supplies Procurement", budgeted: 8500, actual: 8700 },
      { category: "Warehouse & Facilities", budgeted: 2800, actual: 2800 },
      { category: "Transportation & Fleet", budgeted: 1400, actual: 1350 },
      { category: "Fundraising & Development", budgeted: 1200, actual: 890 },
      { category: "Insurance", budgeted: 900, actual: 900 },
    ],
    bankAccounts: [
      {
        id: "operating",
        accountName: "Operations Checking",
        accountMask: "7742",
        type: "Checking",
        balance: 31200.60,
        transactions: [
          { date: "2026-08-24", description: "Community Foundation Grant Disbursement", category: "Grants", amount: 10000.00 },
          { date: "2026-08-22", description: "Payroll - ADP", category: "Program Staff", amount: -8900.00 },
          { date: "2026-08-20", description: "US Foods - Supply Order", category: "Food & Supplies", amount: -3400.00 },
          { date: "2026-08-19", description: "Riverside Auto - Van Repair", category: "Transportation & Fleet", amount: -780.00 },
          { date: "2026-08-15", description: "Individual Donations - Batch Deposit", category: "Giving", amount: 2140.00 },
          { date: "2026-08-10", description: "Warehouse Lease", category: "Warehouse & Facilities", amount: -2800.00 },
          { date: "2026-08-05", description: "State Farm Insurance", category: "Insurance", amount: -900.00 },
        ],
      },
      {
        id: "reserve",
        accountName: "Reserve Savings",
        accountMask: "9012",
        type: "Savings",
        balance: 52000.00,
        transactions: [
          { date: "2026-07-01", description: "Quarterly Reserve Transfer", category: "Transfer In", amount: 5000.00 },
          { date: "2026-04-01", description: "Quarterly Reserve Transfer", category: "Transfer In", amount: 5000.00 },
        ],
      },
    ],
    // Sums to net assets: 79,020.60 = 83,200.60 cash − 4,180 payables.
    funds: [
      { name: "General Fund", restricted: false, balance: 4420.60 },
      { name: "Capital Reserve", restricted: false, balance: 52000.00 },
      { name: "USDA Commodity Program Fund", restricted: true, balance: 18400.00 },
      { name: "Holiday Meal Drive Fund", restricted: true, balance: 4200.00 },
    ],
    contributions: [
      { date: "2026-08-24", donor: "Community Foundation", fund: "General Fund", method: "Grant", amount: 10000.00 },
      { date: "2026-08-15", donor: "The Petrakis Family", fund: "General Fund", method: "Check", amount: 500.00 },
      { date: "2026-08-15", donor: "Anonymous", fund: "Holiday Meal Drive Fund", method: "Online", amount: 250.00 },
      { date: "2026-08-12", donor: "Riverside Rotary Club", fund: "General Fund", method: "Check", amount: 750.00 },
      { date: "2026-08-08", donor: "Lena Fitzgerald", fund: "Holiday Meal Drive Fund", method: "Online", amount: 100.00 },
    ],
    receivables: [
      { description: "USDA Reimbursement - Q3 Commodity Program", amount: 8200.00, dueDate: "2026-09-20" },
      { description: "County Grant - Pending Disbursement", amount: 12000.00, dueDate: "2026-10-01" },
    ],
    payables: [
      { vendor: "US Foods", description: "September supply order", amount: 3400.00, dueDate: "2026-09-08" },
      { vendor: "Riverside Auto Service", description: "Fleet maintenance balance", amount: 780.00, dueDate: "2026-09-05" },
    ],
    documents: [
      { name: "USDA Commodity Compliance Report.pdf", category: "Grant Compliance", uploadedBy: "Riverside Food Pantry", date: "2026-08-14", size: "620 KB", visibility: "all" },
      { name: "August Bank Statements.pdf", category: "Bank Statement", uploadedBy: "MyGoodBooks", date: "2026-08-25", size: "388 KB", visibility: "full" },
      { name: "General Liability Insurance.pdf", category: "Insurance", uploadedBy: "Riverside Food Pantry", date: "2026-05-20", size: "890 KB", visibility: "all" },
      { name: "July Financial Statements.pdf", category: "Financial Statement", uploadedBy: "MyGoodBooks", date: "2026-08-03", size: "241 KB", visibility: "full" },
    ],
    threads: {
      dana: [
        { from: "client", author: "Dana Petrakis", date: "2026-08-19", text: "Can you pull together a quick summary of what we've received from the Community Foundation this year so far? Board meeting is Thursday." },
        { from: "bookkeeper", author: "MyGoodBooks", date: "2026-08-19", text: "On it - I'll have a giving summary by fund ready for you by Wednesday afternoon." },
        { from: "client", author: "Dana Petrakis", date: "2026-08-19", text: "Perfect, thank you!" },
      ],
      luis: [
        { from: "client", author: "Luis Moreno", date: "2026-08-20", text: "Heads up, the refrigerated truck needed an unplanned repair. Invoice is coming your way this week." },
        { from: "bookkeeper", author: "MyGoodBooks", date: "2026-08-20", text: "Thanks for the warning — send it over and I'll code it to Transportation & Fleet. Good to know before month end." },
        { from: "client", author: "Luis Moreno", date: "2026-08-20", text: "Will do, thanks!" },
      ],
    },
  },

  {
    id: "open-arms",
    name: "Open Arms Family Services",
    orgType: "Nonprofit",
    plan: "standard",
    users: [
      {
        id: "marcus",
        name: "Marcus Bell",
        role: "Finance Committee Chair",
        email: "marcus@openarmsfs.org",
        access: "full",
      },
      {
        id: "priya",
        name: "Priya Raman",
        role: "Program Director",
        email: "priya@openarmsfs.org",
        access: "scoped",
        tabs: ["dashboard", "budget", "documents", "messages"],
        categories: ["Program Staff & Case Managers", "Client Services & Assistance"],
        funds: ["Housing Assistance Fund"],
      },
    ],
    monthly: [
      { month: "Mar", income: 41200, expenses: 38900 },
      { month: "Apr", income: 43800, expenses: 40200 },
      { month: "May", income: 45100, expenses: 41800 },
      { month: "Jun", income: 47900, expenses: 43200 },
      { month: "Jul", income: 46200, expenses: 44100 },
      { month: "Aug", income: 48500, expenses: 45900 },
    ],
    budget: [
      { category: "Program Staff & Case Managers", budgeted: 24000, actual: 24800 },
      { category: "Client Services & Assistance", budgeted: 9500, actual: 10200 },
      { category: "Facilities", budgeted: 3200, actual: 3200 },
      { category: "Fundraising & Development", budgeted: 2400, actual: 1980 },
      { category: "Administrative", budgeted: 1800, actual: 2050 },
      { category: "Insurance", budgeted: 1100, actual: 1100 },
    ],
    bankAccounts: [
      {
        id: "operating",
        accountName: "General Operating",
        accountMask: "4470",
        type: "Checking",
        balance: 58900.25,
        transactions: [
          { date: "2026-08-24", description: "State DHS Contract - Reimbursement", category: "Grants", amount: 18500.00 },
          { date: "2026-08-22", description: "Payroll - ADP", category: "Program Staff", amount: -19200.00 },
          { date: "2026-08-20", description: "Client Emergency Assistance - Batch", category: "Client Services", amount: -2400.00 },
          { date: "2026-08-18", description: "United Way Allocation", category: "Grants", amount: 6000.00 },
          { date: "2026-08-15", description: "Landlord - Facility Lease", category: "Facilities", amount: -3200.00 },
          { date: "2026-08-10", description: "Case Management Software - License Renewal", category: "Administrative", amount: -1450.00 },
          { date: "2026-08-05", description: "Individual Donations - Batch Deposit", category: "Giving", amount: 1840.00 },
        ],
      },
      {
        id: "grant-restricted",
        accountName: "Grant Restricted Account",
        accountMask: "6621",
        type: "Checking",
        balance: 24800.00,
        transactions: [
          { date: "2026-08-12", description: "Housing Assistance Grant Draw", category: "Grants", amount: 9600.00 },
          { date: "2026-08-01", description: "Rental Assistance Disbursements - Batch", category: "Client Services", amount: -6200.00 },
        ],
      },
    ],
    // Sums to net assets: 79,050.25 = 83,700.25 cash − 4,650 payables.
    funds: [
      { name: "General Fund", restricted: false, balance: 29650.25 },
      { name: "Board Designated Reserve", restricted: false, balance: 15000.00 },
      { name: "State Contract Fund", restricted: true, balance: 24800.00 },
      { name: "Housing Assistance Fund", restricted: true, balance: 9600.00 },
    ],
    contributions: [
      { date: "2026-08-18", donor: "United Way of the Region", fund: "General Fund", method: "Grant", amount: 6000.00 },
      { date: "2026-08-05", donor: "The Kowalski Family", fund: "General Fund", method: "Online", amount: 300.00 },
      { date: "2026-08-05", donor: "Anonymous", fund: "General Fund", method: "Cash", amount: 150.00 },
      { date: "2026-08-01", donor: "Regional Employers Council", fund: "General Fund", method: "Check", amount: 1000.00 },
    ],
    receivables: [
      { description: "State DHS Contract - Reimbursement Request #8", amount: 18500.00, dueDate: "2026-09-25" },
      { description: "United Way Allocation - Q4", amount: 6000.00, dueDate: "2026-09-30" },
    ],
    payables: [
      { vendor: "Riverbend Properties", description: "Facility lease", amount: 3200.00, dueDate: "2026-09-01" },
      { vendor: "CaseWorthy Software", description: "Case management license renewal", amount: 1450.00, dueDate: "2026-09-15" },
    ],
    documents: [
      { name: "State DHS Contract - FY26.pdf", category: "Grant Compliance", uploadedBy: "Open Arms Family Services", date: "2026-07-10", size: "1.4 MB", visibility: "all" },
      { name: "August Bank Statements.pdf", category: "Bank Statement", uploadedBy: "MyGoodBooks", date: "2026-08-25", size: "455 KB", visibility: "full" },
      { name: "D&O Insurance Policy.pdf", category: "Insurance", uploadedBy: "Open Arms Family Services", date: "2026-03-18", size: "780 KB", visibility: "full" },
      { name: "July Financial Statements.pdf", category: "Financial Statement", uploadedBy: "MyGoodBooks", date: "2026-08-03", size: "277 KB", visibility: "full" },
    ],
    threads: {
      marcus: [
        { from: "client", author: "Marcus Bell", date: "2026-08-21", text: "The board is asking how much of our cash is actually unrestricted vs tied up in the state contract. Can you clarify before Thursday's meeting?" },
        { from: "bookkeeper", author: "MyGoodBooks", date: "2026-08-21", text: "Of the $83.7K total across both accounts, about $44.7K is unrestricted (General Fund + Board Designated Reserve). The rest is the State Contract and Housing Assistance funds plus $4.7K of payables, which can only be spent on those programs." },
      ],
      priya: [
        { from: "client", author: "Priya Raman", date: "2026-08-24", text: "We're over on client assistance again this month. Is there room in the Housing Assistance Fund to cover a few more families before the end of the quarter?" },
      ],
    },
  },
];
