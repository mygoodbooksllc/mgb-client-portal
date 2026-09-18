// ---------------------------------------------------------------------------
// ARCHIVED SAMPLE CLIENTS — not loaded by the app (not in index.html's
// __SOURCE_ORDER or build.py's payload). These three (New Hope Fellowship,
// Riverside Food Pantry, Open Arms Family Services) were removed from
// data.js on 2026-09-18 to declutter the client list now that the app has
// a real Grace Community Church test profile and is heading toward real
// clients. Kept here verbatim so they can be pasted back into CLIENTS in
// data.js if sample data is needed again later (demos, testing multiple
// clients, etc). Each object below is a full CLIENTS array entry — to
// restore one, copy its `{ ... },` block back into data.js's CLIENTS array.
// ---------------------------------------------------------------------------

  {
    id: "new-hope",
    name: "New Hope Fellowship",
    orgType: "Church Plant",
    plan: "standard",
    assignedBookkeeper: { name: "Marcus Webb", role: "Bookkeeper", initials: "MW" },
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
    // Trailing 12 months — see grace-community's monthly comment for why
    // Sep-through-Aug (not Jan-Dec) is the right window here.
    monthly: [
      { month: "Sep", income: 8600, expenses: 9200 },
      { month: "Oct", income: 8400, expenses: 9400 },
      { month: "Nov", income: 8800, expenses: 9500 },
      { month: "Dec", income: 12500, expenses: 10200 },
      { month: "Jan", income: 8200, expenses: 9600 },
      { month: "Feb", income: 8700, expenses: 9700 },
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
    assignedBookkeeper: { name: "Priya Anand", role: "Senior Bookkeeper", initials: "PA" },
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
    // Trailing 12 months — see grace-community's monthly comment for why
    // Sep-through-Aug (not Jan-Dec) is the right window here. December's
    // spike lines up with the Holiday Meal Drive Fund already in this
    // client's funds/contributions data below.
    monthly: [
      { month: "Sep", income: 21000, expenses: 20500 },
      { month: "Oct", income: 23500, expenses: 21200 },
      { month: "Nov", income: 26800, expenses: 21800 },
      { month: "Dec", income: 32000, expenses: 23500 },
      { month: "Jan", income: 20500, expenses: 21000 },
      { month: "Feb", income: 22800, expenses: 21600 },
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
        // Reconciliation Pro only — see the same fields on grace-community's
        // operating account for what these mean and the invariant they hold.
        statementBalance: 30100.60,
        statementDate: "2026-08-21",
        transactions: [
          { date: "2026-08-24", description: "Community Foundation Grant Disbursement", category: "Grants", amount: 10000.00, cleared: false },
          { date: "2026-08-22", description: "Payroll - ADP", category: "Program Staff", amount: -8900.00, cleared: false },
          { date: "2026-08-20", description: "US Foods - Supply Order", category: "Food & Supplies", amount: -3400.00, cleared: true },
          { date: "2026-08-19", description: "Riverside Auto - Van Repair", category: "Transportation & Fleet", amount: -780.00, cleared: true },
          { date: "2026-08-15", description: "Individual Donations - Batch Deposit", category: "Giving", amount: 2140.00, cleared: true },
          { date: "2026-08-10", description: "Warehouse Lease", category: "Warehouse & Facilities", amount: -2800.00, cleared: true },
          { date: "2026-08-05", description: "State Farm Insurance", category: "Insurance", amount: -900.00, cleared: true },
        ],
      },
      {
        id: "reserve",
        accountName: "Reserve Savings",
        accountMask: "9012",
        type: "Savings",
        balance: 52000.00,
        // Fully reconciled — no outstanding items, statement balance equals
        // the book balance.
        statementBalance: 52000.00,
        statementDate: "2026-08-01",
        transactions: [
          { date: "2026-07-01", description: "Quarterly Reserve Transfer", category: "Transfer In", amount: 5000.00, cleared: true },
          { date: "2026-04-01", description: "Quarterly Reserve Transfer", category: "Transfer In", amount: 5000.00, cleared: true },
        ],
      },
    ],
    bankReconciliations: [
      { accountId: "operating", period: "July 2026", closedDate: "2026-08-04", closedBy: "MyGoodBooks" },
      { accountId: "reserve", period: "June 2026", closedDate: "2026-07-02", closedBy: "MyGoodBooks" },
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
    // Fund Accounting Pro only — see grace-community's donors/fundTransfers/
    // pledges for what these mean.
    donors: [
      { name: "Community Foundation", email: "giving@communityfoundation-example.org" },
      { name: "The Petrakis Family", email: "petrakis@riversidepantry-member.org" },
      { name: "Riverside Rotary Club", email: "treasurer@riversiderotary-example.org" },
      { name: "Lena Fitzgerald", email: "lfitzgerald@riversidepantry-member.org" },
    ],
    fundTransfers: [
      { date: "2026-07-01", fromFund: "General Fund", toFund: "Capital Reserve", amount: 5000.00, reason: "Quarterly reserve transfer" },
      { date: "2026-04-01", fromFund: "General Fund", toFund: "Capital Reserve", amount: 5000.00, reason: "Quarterly reserve transfer" },
    ],
    pledges: [
      { donor: "Community Foundation", fund: "Holiday Meal Drive Fund", committed: 5000.00, received: 250.00, dueDate: "2026-11-15" },
      { donor: "Riverside Rotary Club", fund: "General Fund", committed: 1500.00, received: 750.00, dueDate: "2026-09-30" },
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
    assignedBookkeeper: { name: "Marcus Webb", role: "Bookkeeper", initials: "MW" },
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
    // Trailing 12 months — see grace-community's monthly comment for why
    // Sep-through-Aug (not Jan-Dec) is the right window here.
    monthly: [
      { month: "Sep", income: 38500, expenses: 36200 },
      { month: "Oct", income: 39800, expenses: 37100 },
      { month: "Nov", income: 40200, expenses: 37800 },
      { month: "Dec", income: 44500, expenses: 39800 },
      { month: "Jan", income: 38900, expenses: 38100 },
      { month: "Feb", income: 40100, expenses: 38500 },
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
    // Payroll add-on, same as grace-community — deliberately given to a
    // Standard-plan client too, to prove the add-on is orthogonal to plan
    // tier. See the comment on grace-community's own payroll block.
    payrollAddOn: true,
    payroll: {
      provider: "Gusto",
      nextRun: { date: "2026-09-18", employeeCount: 4, gross: 8120.00, taxes: 1340.00, net: 6780.00 },
      lastRun: { date: "2026-09-04", net: 6540.00 },
      ytdCost: 101350.00,
      employees: [
        { name: "Danielle Osei", role: "Executive Director", payType: "Salary", status: "active", directDeposit: "enrolled",
          ytdGross: 44200.00, ytdFederalWithholding: 6200.00, ytdStateWithholding: 1680.00, ytdFica: 3381.00, ytdNet: 32939.00 },
        { name: "Carlos Fuentes", role: "Case Manager", payType: "Salary", status: "active", directDeposit: "enrolled",
          ytdGross: 33150.00, ytdFederalWithholding: 3720.00, ytdStateWithholding: 1194.00, ytdFica: 2536.00, ytdNet: 25700.00 },
        { name: "Wanda Price", role: "Case Manager", payType: "Hourly", status: "active", directDeposit: "enrolled",
          ytdGross: 19800.00, ytdFederalWithholding: 1782.00, ytdStateWithholding: 792.00, ytdFica: 1515.00, ytdNet: 15711.00 },
        { name: "Leah Whitcombe", role: "Administrative Assistant", payType: "Hourly", status: "onboarding", directDeposit: "pending",
          ytdGross: 4200.00, ytdFederalWithholding: 336.00, ytdStateWithholding: 168.00, ytdFica: 321.00, ytdNet: 3375.00 },
      ],
      taxDeposits: [
        { type: "Federal 941 (income + FICA)", period: "Q3 2026", amount: 4120.00, dueDate: "2026-10-15", status: "upcoming" },
        { type: "State withholding", period: "Sep 2026", amount: 540.00, dueDate: "2026-10-05", status: "upcoming" },
        { type: "FUTA", period: "Q3 2026", amount: 84.00, dueDate: "2026-10-31", status: "upcoming" },
        { type: "Federal 941 (income + FICA)", period: "Q2 2026", amount: 3960.00, dueDate: "2026-07-15", status: "filed" },
      ],
    },
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
