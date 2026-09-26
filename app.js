(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value = "") => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const titleCase = (value = "") => String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, ch => ch.toUpperCase());
  const initials = (value = "?") => String(value).trim().split(/\s+/).slice(0,2).map(part => part[0] || "").join("").toUpperCase();
  const icons = {dashboard:"◫",leads:"♧",properties:"⌂",followups:"◷",visits:"⌖",deals:"⇄",reports:"▥",settings:"⚙"};
  const navItems = [
    ["dashboard","Dashboard"],["leads","Leads & inquiries"],["properties","Property inventory"],
    ["followups","Follow-ups"],["visits","Site visits"],["deals","Deals & bookings"],["reports","Reports & analytics"]
  ];
  const collections = {leads:"leads",properties:"properties",followups:"followups",visits:"visits",deals:"deals"};
  const names = {leads:"Lead",properties:"Property",followups:"Follow-up",visits:"Site visit",deals:"Deal"};
  const state = {user:null,settings:null,modules:{},data:{leads:[],properties:[],followups:[],visits:[],deals:[]},page:"dashboard",search:"",filters:{stage:"all"},adminUsers:[]};

  async function api(path, options = {}) {
    const response = await fetch(path, {credentials:"same-origin", ...options, headers:{"Content-Type":"application/json",...(options.headers || {})}});
    let body = {};
    try { body = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
    return body;
  }
  const post = (path, body) => api(path, {method:"POST",body:JSON.stringify(body)});
  const put = (path, body) => api(path, {method:"PUT",body:JSON.stringify(body)});
  const del = path => api(path, {method:"DELETE"});
  const moduleOn = key => Boolean(state.modules[key]);
  const formatMoney = amount => {
    const number = Number(amount || 0);
    if (number >= 10_000_000) return `Rs ${(number / 10_000_000).toFixed(number >= 100_000_000 ? 1 : 2).replace(/\.0+$/, "")} Cr`;
    if (number >= 100_000) return `Rs ${(number / 100_000).toFixed(number >= 1_000_000 ? 0 : 1)} Lac`;
    return `Rs ${number.toLocaleString("en-PK")}`;
  };
  const formatDate = value => {
    if (!value) return "—";
    const day = String(value).split("T")[0].split("-").map(Number);
    if (day.length !== 3 || !day[0]) return esc(value);
    return new Date(day[0], day[1]-1, day[2]).toLocaleDateString("en-GB", {day:"2-digit",month:"short",year:"numeric"});
  };
  const shortDate = value => {
    if (!value) return {day:"—",month:""};
    const parts = String(value).split("T")[0].split("-").map(Number);
    const date = new Date(parts[0], parts[1]-1, parts[2]);
    return {day:String(parts[2]).padStart(2,"0"),month:date.toLocaleDateString("en",{month:"short"})};
  };
  const niceDate = new Date().toLocaleDateString("en",{weekday:"long",day:"numeric",month:"long"});
  const statusTone = status => {
    const s = String(status || "").toLowerCase();
    if (["new","qualified","available","open","scheduled","booked","won","completed"].includes(s)) return "";
    if (["viewing","reserved","negotiation","pending"].includes(s)) return "amber";
    if (["overdue","lost","cancelled","dispute"].includes(s)) return "rose";
    if (["contacted","proposal","in progress"].includes(s)) return "blue";
    return "gray";
  };
  const pill = (value, tone) => `<span class="status-pill ${tone || statusTone(value)}">${esc(value || "—")}</span>`;
  const setBusy = (button, busy) => { if (button) { button.dataset.originalLabel ||= button.innerHTML; button.disabled = busy; button.innerHTML = busy ? "Saving…" : button.dataset.originalLabel; } };

  async function start() {
    try {
      const publicSettings = await api("/api/public-settings");
      if (publicSettings.login_notice) $("#login-notice").textContent = publicSettings.login_notice;
    } catch (_) {}
    const session = await api("/api/session");
    if (session.user) await enterApp(); else showLogin();
  }
  function showLogin(message = "") {
    $("#app-shell").hidden = true;
    $("#login-screen").hidden = false;
    const err = $("#login-error");
    err.hidden = !message;
    err.textContent = message;
    $("#login-form").elements.username.focus();
  }
  async function enterApp() {
    const payload = await api("/api/bootstrap");
    state.user = payload.user;
    state.settings = payload.settings;
    state.modules = payload.modules;
    state.data = payload.data;
    $("#login-screen").hidden = true;
    $("#app-shell").hidden = false;
    state.page = location.hash.slice(1) || "dashboard";
    if (!moduleOn(state.page) && state.page !== "settings") state.page = "dashboard";
    if (state.page === "settings" && state.user.role !== "admin") state.page = "dashboard";
    if (!location.hash) history.replaceState(null,"","#dashboard");
    updateIdentity();
    renderNav();
    renderPage();
  }
  function updateIdentity() {
    const name = state.user?.name || "Workspace user";
    const role = state.user?.role || "user";
    $("#side-name").textContent = name;
    $("#side-role").textContent = role === "admin" ? "Administrator" : "User access";
    $("#side-avatar").textContent = initials(name);
    $("#top-avatar").textContent = initials(name);
  }
  function renderNav() {
    const visibleItems = navItems.filter(([key]) => moduleOn(key));
    if (state.user.role === "admin") visibleItems.push(["settings","Admin settings"]);
    $("#navigation").innerHTML = visibleItems.map(([key,label]) => `<a href="#${key}" class="nav-item ${state.page===key?"active":""}" data-page="${key}"><span class="nav-icon" aria-hidden="true">${icons[key] || "·"}</span><span>${esc(label)}</span>${key === "followups" && state.data.followups?.length ? `<span class="nav-item-count">${state.data.followups.filter(x=>x.status!=="Done").length}</span>` : ""}</a>`).join("");
    const active = visibleItems.find(([key])=>key===state.page);
    $("#crumb-current").textContent = active?.[1] || "Dashboard";
  }
  function renderPage() {
    const root = $("#main-content");
    const renderers = {dashboard:renderDashboard,leads:renderLeads,properties:renderProperties,followups:renderFollowups,visits:renderVisits,deals:renderDeals,reports:renderReports,settings:renderSettings};
    root.innerHTML = (renderers[state.page] || renderDashboard)();
    renderNav();
    root.focus({preventScroll:true});
  }
  function pageHeader(title, subtitle, action = "", eyebrow = "YOUR WORKSPACE") {
    return `<div class="page-header"><div class="page-heading"><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="header-actions">${action}</div></div>`;
  }
  function sectionHeading(title, subtitle, action = "") {
    return `<div class="section-title-row"><div><h2 class="section-title">${esc(title)}</h2>${subtitle?`<p class="section-subtitle">${esc(subtitle)}</p>`:""}</div>${action}</div>`;
  }
  function dashboardAction() { return `<span class="date-chip"><span>◷</span>${esc(niceDate)}</span>${moduleOn("leads")?`<button class="button button-primary" data-action="create" data-kind="leads"><span class="plus">+</span> Add a lead</button>`:`<button class="button button-primary" data-action="quick-add"><span class="plus">+</span> Quick add</button>`}`; }
  function renderDashboard() {
    const first = (state.user.name || "there").split(" ")[0];
    const leads = state.data.leads || [], props = state.data.properties || [], deals = state.data.deals || [], tasks = state.data.followups || [];
    const activeLeads = leads.filter(x => !["Won","Lost"].includes(x.stage)).length;
    const available = props.filter(x => x.status === "Available").length;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    const due = tasks.filter(x => x.status !== "Done" && x.due_date <= today).length;
    const pipelineValue = deals.filter(x => !["Won","Lost"].includes(x.stage)).reduce((sum,x)=>sum+Number(x.value||0),0);
    const metricItems = [
      ["leads","Active leads", activeLeads, `${leads.length} total in your workspace`, "♧", ""],
      ["properties","Available properties", available, `${props.length} listings in inventory`, "⌂", "blue"],
      ["followups","Follow-ups due", due, due ? "Needs your attention" : "You're all caught up", "◷", due ? "amber" : ""],
      ["deals","Open pipeline", formatMoney(pipelineValue), `${deals.length} deals in progress`, "⇄", "rose"],
    ];
    const widgets = state.settings?.widgets || {};
    const metrics = widgets.metrics ? `<section class="metric-grid">${metricItems.filter(([feature])=>moduleOn(feature)).map(([,label,value,detail,icon,tone])=>`<article class="metric-card ${tone}"><div class="metric-head"><span>${esc(label)}</span><span class="metric-icon">${icon}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-detail">${esc(detail)}</div></article>`).join("")}</section>` : "";
    const stages = ["New","Contacted","Qualified","Viewing","Negotiation","Booked"];
    const maxCount = Math.max(1,...stages.map(stage=>deals.filter(d=>d.stage===stage).length));
    const pipeline = widgets.pipeline && moduleOn("deals") ? `<section class="panel panel-pad"><div class="panel-head"><div><h2>Deal pipeline</h2><p>Current opportunities by stage</p></div><button class="text-link" data-action="navigate" data-page="deals">View all deals ↗</button></div><div class="pipeline-rows">${stages.map(stage=>{const rows=deals.filter(d=>d.stage===stage);return `<div class="pipeline-line"><span>${esc(stage)}</span><div class="pipeline-track"><div class="pipeline-fill" style="width:${Math.max(rows.length?7:0,Math.round(rows.length/maxCount*100))}%"></div></div><span>${rows.length}</span></div>`}).join("")}</div></section>` : "";
    const filteredLeads = filtered(state.data.leads || []).slice(0,5);
    const recent = widgets.recentLeads && moduleOn("leads") ? `<section class="panel panel-pad">${sectionHeading("Recent leads","The latest people added to your workspace",`<button class="text-link" data-action="navigate" data-page="leads">All leads ↗</button>`)}${filteredLeads.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Lead</th><th>Interest</th><th>Stage</th><th>Next follow-up</th></tr></thead><tbody>${filteredLeads.map(lead=>`<tr><td><div class="lead-name-cell"><span class="mini-avatar">${esc(initials(lead.name))}</span><span><span class="table-primary">${esc(lead.name)}</span><span class="table-secondary">${esc(lead.phone || lead.email || "No contact details")}</span></span></div></td><td>${esc(lead.interest || "—")}</td><td>${pill(lead.stage)}</td><td>${formatDate(lead.next_followup)}</td></tr>`).join("")}</tbody></table></div>` : emptyState("No leads match your search.","Add a lead to start building your pipeline.","leads")}</section>` : "";
    const agenda = widgets.followups && moduleOn("followups") ? `<section class="panel panel-pad"><div class="panel-head"><div><h2>Follow-up agenda</h2><p>Next steps to keep your deals moving</p></div><button class="text-link" data-action="navigate" data-page="followups">Open agenda ↗</button></div><div class="agenda-list">${tasks.filter(x=>x.status!=="Done").sort((a,b)=>a.due_date.localeCompare(b.due_date)).slice(0,5).map(task=>{const date=shortDate(task.due_date);return `<div class="agenda-item"><div class="agenda-date"><b>${esc(date.day)}</b><span>${esc(date.month)}</span></div><div class="agenda-copy"><b>${esc(task.title)}</b><span>${esc(task.lead_name || "No lead linked")} · ${esc(task.channel)}</span></div><span class="agenda-time">${task.due_date < today ? "Overdue" : task.due_date===today ? "Today" : formatDate(task.due_date)}</span></div>`}).join("") || `<div class="empty-state"><b>You're all caught up</b><p>No open follow-ups yet.</p><button class="button button-quiet button-small" data-action="create" data-kind="followups">Add a follow-up</button></div>`}</div></section>` : "";
    return `${pageHeader(`Welcome back, ${first}`,"A clear view of your people, properties, and next steps.",dashboardAction(),"PERSONAL REAL ESTATE WORKSPACE")}${metrics}<div class="dashboard-grid">${pipeline || `<section class="panel panel-pad"><div class="panel-head"><div><h2>Make your next move</h2><p>Keep the momentum going in your workspace.</p></div></div><button class="button button-quiet button-small" data-action="quick-add">＋ Add a record</button></section>`}${agenda}</div><div class="dashboard-bottom">${recent}${!recent && widgets.followups && moduleOn("followups") ? agenda : ""}${widgets.recentLeads && moduleOn("leads") && !recent ? "" : ""}</div>`;
  }
  function emptyState(title, desc, kind) {
    return `<div class="empty-state"><b>${esc(title)}</b><p>${esc(desc)}</p>${kind?`<button class="button button-quiet button-small" data-action="create" data-kind="${kind}">＋ Add ${esc(names[kind]?.toLowerCase() || "record")}</button>`:""}</div>`;
  }
  function filtered(items) {
    const q = state.search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(item=>Object.values(item).some(value=>String(value??"").toLowerCase().includes(q)));
  }
  function tableAction(kind, record) { return `<div class="row-actions"><button class="row-action" title="Edit" data-action="edit" data-kind="${kind}" data-id="${record.id}">Edit</button><button class="row-action" title="Delete" data-action="delete" data-kind="${kind}" data-id="${record.id}">Delete</button></div>`; }
  function renderLeads() {
    const leads=filtered(state.data.leads||[]).filter(x=>state.filters.stage==="all"||x.stage===state.filters.stage);
    const actions=`<button class="button button-quiet" data-action="export" data-kind="leads">↓ Export CSV</button><button class="button button-primary" data-action="create" data-kind="leads"><span class="plus">+</span> Add lead</button>`;
    const options=[...new Set((state.data.leads||[]).map(x=>x.stage))].sort().map(s=>`<option ${state.filters.stage===s?"selected":""}>${esc(s)}</option>`).join("");
    return `${pageHeader("Leads & inquiries","Keep every conversation, budget, and next step together.",actions,"PEOPLE & RELATIONSHIPS")}<section class="panel panel-pad"><div class="filter-bar"><select id="stage-filter" class="field-select"><option value="all">All stages</option>${options}</select><span class="filter-spacer"></span><span class="result-count">${leads.length} ${leads.length===1?"lead":"leads"}</span></div>${leads.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Lead</th><th>Interest</th><th>Budget</th><th>Source</th><th>Stage</th><th>Next follow-up</th><th></th></tr></thead><tbody>${leads.map(x=>`<tr><td><div class="lead-name-cell"><span class="mini-avatar">${esc(initials(x.name))}</span><span><span class="table-primary">${esc(x.name)}</span><span class="table-secondary">${esc(x.phone||x.email||"No contact details")}</span></span></div></td><td>${esc(x.interest||"—")}<div class="table-secondary">${esc(x.location||"")}</div></td><td>${formatMoney(x.budget)}</td><td>${esc(x.source||"—")}</td><td>${pill(x.stage)}</td><td>${formatDate(x.next_followup)}</td><td>${tableAction("leads",x)}</td></tr>`).join("")}</tbody></table></div>`:emptyState("No leads yet","Add your first lead to start tracking inquiries.","leads")}</section>`;
  }
  function renderProperties() {
    const items=filtered(state.data.properties||[]);
    const action=`<button class="button button-primary" data-action="create" data-kind="properties"><span class="plus">+</span> Add property</button>`;
    return `${pageHeader("Property inventory","A tidy view of the listings you can match with clients.",action,"YOUR PORTFOLIO")}<div class="filter-bar"><span class="page-kicker">${items.length} ${items.length===1?"listing":"listings"} in your portfolio</span><span class="filter-spacer"></span><select id="property-filter" class="field-select"><option value="all">All availability</option><option>Available</option><option>Reserved</option><option>Sold</option></select></div>${items.length?`<div class="property-grid">${items.map(x=>`<article class="property-card"><div class="property-photo" style="background-image:url('/assets/${encodeURIComponent(x.image||"")}')">${pill(x.status)}</div><div class="property-body"><h2 class="property-title">${esc(x.title)}</h2><div class="property-place">⌖ ${esc(x.location||"Location not set")}</div><div class="property-meta"><span>${esc(x.type)} · ${esc(x.size)}</span><span class="property-price">${formatMoney(x.price)}</span></div><div class="property-actions"><span class="muted" style="font-size:9px">${esc(x.notes||"")}</span>${tableAction("properties",x)}</div></div></article>`).join("")}</div>`:emptyState("No properties yet","Add a property to build your personal inventory.","properties")}`;
  }
  function renderFollowups() {
    const items=filtered(state.data.followups||[]);
    const actions=`<button class="button button-primary" data-action="create" data-kind="followups"><span class="plus">+</span> Add follow-up</button>`;
    return `${pageHeader("Follow-ups","A simple agenda for the conversations that move things forward.",actions,"STAY IN TOUCH")}<section class="panel panel-pad"><div class="filter-bar"><span class="page-kicker">${items.filter(x=>x.status!=="Done").length} open · ${items.filter(x=>x.status==="Done").length} completed</span><span class="filter-spacer"></span><select id="followup-filter" class="field-select"><option value="all">All follow-ups</option><option>Open</option><option>Done</option></select></div>${items.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Next step</th><th>Lead</th><th>Due date</th><th>Channel</th><th>Status</th><th></th></tr></thead><tbody>${items.map(x=>`<tr><td><span class="table-primary">${esc(x.title)}</span><div class="table-secondary">${esc(x.notes||"")}</div></td><td>${esc(x.lead_name||"—")}</td><td>${formatDate(x.due_date)}</td><td>${esc(x.channel)}</td><td>${pill(x.status)}</td><td><div class="row-actions">${x.status!=="Done"?`<button class="row-action" data-action="complete" data-id="${x.id}">Mark done</button>`:""}${tableAction("followups",x)}</div></td></tr>`).join("")}</tbody></table></div>`:emptyState("No follow-ups yet","Add a reminder so the next conversation does not slip.","followups")}</section>`;
  }
  function renderVisits() {
    const items=filtered(state.data.visits||[]);
    const actions=`<button class="button button-primary" data-action="create" data-kind="visits"><span class="plus">+</span> Schedule visit</button>`;
    return `${pageHeader("Site visits","Plan property viewings and keep the details close at hand.",actions,"ON THE GROUND")}<section class="panel panel-pad">${sectionHeading("Upcoming and recent visits","Your scheduled property viewings",`<span class="panel-tag">${items.length} visits</span>`)}${items.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Visit</th><th>Lead</th><th>Property</th><th>Date & time</th><th>Status</th><th></th></tr></thead><tbody>${items.map(x=>`<tr><td><span class="table-primary">${esc(x.property_title||"Property visit")}</span><div class="table-secondary">${esc(x.notes||"")}</div></td><td>${esc(x.lead_name||"—")}</td><td>${esc(x.property_title||"—")}</td><td>${formatDate(x.visit_date)}${x.visit_date?.includes("T")?` · ${esc(x.visit_date.split("T")[1].slice(0,5))}`:""}</td><td>${pill(x.status)}</td><td>${tableAction("visits",x)}</td></tr>`).join("")}</tbody></table></div>`:emptyState("No visits scheduled","Schedule a site visit with a lead and property.","visits")}</section>`;
  }
  function renderDeals() {
    const deals=filtered(state.data.deals||[]);
    const stages=["Qualified","Viewing","Negotiation","Booked"];
    const action=`<button class="button button-primary" data-action="create" data-kind="deals"><span class="plus">+</span> Add deal</button>`;
    return `${pageHeader("Deals & bookings","See where each opportunity stands and what may close next.",action,"MOVE THE PIPELINE")}<div class="kanban">${stages.map(stage=>{const group=deals.filter(x=>x.stage===stage);return `<section class="kanban-column"><div class="kanban-head"><b>${esc(stage)}</b><span>${group.length}</span></div>${group.map(x=>`<article class="deal-card"><b>${esc(x.lead_name||"Unlinked lead")}</b><p>${esc(x.property_title||"Property not selected")}</p><div class="deal-card-foot"><span>${formatDate(x.close_date)}</span><span>${formatMoney(x.value)}</span></div><div class="row-actions" style="margin-top:7px">${tableAction("deals",x)}</div></article>`).join("")||`<div class="empty-column">No deals in this stage</div>`}</section>`}).join("")}</div>`;
  }
  function renderReports() {
    const deals=state.data.deals||[], leads=state.data.leads||[];
    const stageLabels=["Qualified","Viewing","Negotiation","Booked"];
    const totals=stageLabels.map(stage=>deals.filter(x=>x.stage===stage).reduce((n,x)=>n+Number(x.value||0),0));
    const max=Math.max(1,...totals);
    const sources=[...new Set(leads.map(x=>x.source||"Other"))].map(source=>({source,count:leads.filter(x=>(x.source||"Other")===source).length})).sort((a,b)=>b.count-a.count).slice(0,6);
    return `${pageHeader("Reports & analytics","A quick read on your current lead and deal mix.",moduleOn("leads")?`<button class="button button-quiet" data-action="export" data-kind="leads">↓ Export leads</button>`:"","PORTFOLIO SNAPSHOT")}<div class="metric-grid"><article class="metric-card"><div class="metric-head">Total leads<span class="metric-icon">♧</span></div><div class="metric-value">${leads.length}</div><div class="metric-detail">Across all lead stages</div></article><article class="metric-card blue"><div class="metric-head">Active listings<span class="metric-icon">⌂</span></div><div class="metric-value">${(state.data.properties||[]).filter(x=>x.status==="Available").length}</div><div class="metric-detail">Ready to be matched</div></article><article class="metric-card amber"><div class="metric-head">Pipeline value<span class="metric-icon">⇄</span></div><div class="metric-value" style="font-size:18px">${formatMoney(deals.filter(x=>x.stage!=="Booked").reduce((s,x)=>s+Number(x.value||0),0))}</div><div class="metric-detail">Open deal opportunities</div></article><article class="metric-card rose"><div class="metric-head">Due follow-ups<span class="metric-icon">◷</span></div><div class="metric-value">${(state.data.followups||[]).filter(x=>x.status!=="Done").length}</div><div class="metric-detail">Open reminders</div></article></div><div class="report-grid"><section class="panel panel-pad"><div class="panel-head"><div><h2>Pipeline value by stage</h2><p>Current deal value in each stage</p></div></div><div class="chart-bars">${stageLabels.map((stage,i)=>`<div class="chart-month"><b>${formatMoney(totals[i])}</b><div class="chart-bar" style="--height:${Math.max(8,Math.round(totals[i]/max*100))}%"></div><span>${esc(stage)}</span></div>`).join("")}</div></section><section class="panel panel-pad"><div class="panel-head"><div><h2>Lead sources</h2><p>Where your inquiries come from</p></div></div><div class="source-list">${sources.map(x=>`<div class="source-row"><span>${esc(x.source)}</span><div class="source-meter"><i style="width:${Math.max(8,Math.round(x.count/Math.max(1,leads.length)*100))}%"></i></div><span>${x.count}</span></div>`).join("")||`<div class="empty-state"><b>No lead sources yet</b><p>Add leads to see a source breakdown.</p></div>`}</div></section></div>`;
  }
  function toggleRow(id, label, desc, checked, disabled = false) {
    return `<label class="access-row"><span class="access-row-copy"><b>${esc(label)}</b><span>${esc(desc)}</span></span><span class="toggle"><input type="checkbox" name="${esc(id)}" ${checked?"checked":""} ${disabled?"disabled":""}><span class="toggle-track"></span></span></label>`;
  }
  function renderSettings() {
    const modules=state.settings?.modules||{}, widgets=state.settings?.widgets||{};
    const moduleDescriptions={dashboard:"The user's starting page and workspace overview.",leads:"Lead list, lead details, and add or edit access.",properties:"Property listings and inventory details.",followups:"Follow-up agenda and reminders.",visits:"Property viewing schedule and visit details.",deals:"Deal pipeline and booking records.",reports:"Portfolio and lead-source summaries."};
    const widgetDescriptions={metrics:"The four portfolio overview cards at the top of the dashboard.",pipeline:"Deal stage progress on the dashboard.",followups:"Upcoming actions and reminders on the dashboard.",recentLeads:"Recently added leads on the dashboard."};
    const users=state.adminUsers||[];
    return `${pageHeader("Admin settings","Choose what user accounts can open and what they see after sign-in.",`<button class="button button-primary" form="settings-form" type="submit">Save changes</button>`,"ACCESS & WORKSPACE")}
      <form id="settings-form" class="settings-stack"><div class="settings-layout"><div class="settings-stack"><section class="panel setting-section"><h2>User access</h2><p>These controls apply to every account with the User role. Admin accounts always have full access.</p><div class="access-list">${Object.entries(state.user ? {dashboard:"Dashboard",...Object.fromEntries(navItems.slice(1).map(([key,name])=>[key,name]))} : {}).map(([key,name])=>toggleRow(`module_${key}`,name,moduleDescriptions[key]||"Allow this section for user accounts.",modules[key]??true,key==="dashboard")).join("")}</div></section>
      <section class="panel setting-section"><h2>User dashboard</h2><p>Choose which dashboard sections appear for user accounts.</p><div class="access-list">${Object.entries({metrics:"Overview cards",pipeline:"Deal pipeline",followups:"Follow-up agenda",recentLeads:"Recent leads"}).map(([key,name])=>toggleRow(`widget_${key}`,name,widgetDescriptions[key],widgets[key]??true)).join("")}</div></section></div>
      <div class="settings-stack"><section class="panel setting-section"><h2>Sign-in welcome</h2><p>Set the short note shown under the login heading for both access levels.</p><label class="notice-field">Welcome note<textarea class="field-textarea login-notice-input" name="login_notice" maxlength="180" placeholder="Your private workspace...">${esc(state.settings?.login_notice||"")}</textarea></label><div class="login-preview"><b>LOGIN PAGE PREVIEW</b><span>${esc(state.settings?.login_notice||"")}</span></div></section>
      <section class="panel setting-section"><h2>Local data</h2><p>Your CRM records are stored in a SQLite database beside this app on this device.</p><div class="access-row"><span class="access-row-copy"><b>Personal-use mode</b><span>Only reachable from this computer.</span></span><span class="status-pill">Active</span></div><div class="access-row"><span class="access-row-copy"><b>Session timeout</b><span>Sign-in expires after 12 hours.</span></span><span class="panel-tag">12 hours</span></div></section></div></div>
      <div class="panel settings-save"><p>Changes apply the next time a user signs in or refreshes their workspace.</p><button class="button button-primary" type="submit">Save access settings</button></div></form>
      <section class="panel setting-section" style="margin-top:13px"><div class="section-title-row"><div><h2>Accounts</h2><p class="section-subtitle">Create user or admin sign-ins for this private workspace.</p></div><button class="button button-quiet button-small" data-action="create-user">＋ Add account</button></div>${users.length?`<div class="table-wrap"><table class="account-table"><thead><tr><th>Account</th><th>Access</th><th>Status</th><th></th></tr></thead><tbody>${users.map(u=>`<tr><td><span class="account-title">${esc(u.name)}</span><small>@${esc(u.username)}</small></td><td>${u.role==="admin"?pill("Admin"):pill("User","blue")}</td><td>${u.active?pill("Active"):pill("Disabled","gray")}</td><td><div class="row-actions"><button class="row-action" data-action="edit-user" data-id="${u.id}">Manage</button></div></td></tr>`).join("")}</tbody></table></div>`:`<div class="empty-state">No accounts found.</div>`}</section>`;
  }

  const field = (key,label,type="text",options=[],full=false,placeholder="") => ({key,label,type,options,full,placeholder});
  const formSchemas = {
    leads:[field("name","Full name","text",[],false,"Client name"),field("phone","Phone","tel",[],false,"03xx xxx xxxx"),field("email","Email","email",[],false,"name@example.com"),field("source","Lead source","select",["Website","Referral","WhatsApp","Facebook","Instagram","Walk-in","Other"]),field("budget","Budget (PKR)","number",[],false,"e.g. 25000000"),field("interest","Looking for","text",[],false,"10 marla house"),field("stage","Stage","select",["New","Contacted","Qualified","Viewing","Negotiation","Booked","Lost"]),field("location","Preferred location","text",[],false,"Area, city"),field("next_followup","Next follow-up","date"),field("notes","Notes","textarea",[],true,"Add a helpful detail")],
    properties:[field("title","Property title","text",[],true,"Property or plot name"),field("location","Location","text",[],true,"Area, city"),field("type","Property type","select",["House","Plot","Apartment","Commercial","Other"]),field("size","Size","text",[],false,"10 Marla"),field("price","Asking price (PKR)","number",[],false,"e.g. 38500000"),field("status","Availability","select",["Available","Reserved","Sold"]),field("image","Image","select",["login-villa.png","bahria-villa.png","gulberg-home.png","dha-home.png",""],false,""),field("notes","Notes","textarea",[],true,"Details to remember")],
    followups:[field("title","Next step","text",[],true,"Call back, send details…"),field("lead_id","Related lead","relation-lead"),field("due_date","Due date","date"),field("channel","Channel","select",["Call","WhatsApp","Email","Meeting","Other"]),field("status","Status","select",["Open","Done"]),field("notes","Notes","textarea",[],true,"What should happen next?")],
    visits:[field("lead_id","Lead","relation-lead"),field("property_id","Property","relation-property"),field("visit_date","Date & time","datetime-local"),field("status","Status","select",["Scheduled","Completed","Cancelled"]),field("notes","Visit notes","textarea",[],true,"Meeting point, attendees, or other details")],
    deals:[field("lead_id","Lead","relation-lead"),field("property_id","Property","relation-property"),field("value","Deal value (PKR)","number"),field("stage","Stage","select",["Qualified","Viewing","Negotiation","Booked","Lost"]),field("close_date","Expected close","date"),field("notes","Notes","textarea",[],true,"Current status or next step")]
  };
  function relationOptions(type, current) {
    const rows=type==="relation-lead"?state.data.leads:state.data.properties;
    const value=type==="relation-lead"?"id":"id";
    const label=type==="relation-lead"?"name":"title";
    return `<option value="">No selection</option>${(rows||[]).map(x=>`<option value="${x[value]}" ${String(current??"")===String(x[value])?"selected":""}>${esc(x[label])}</option>`).join("")}`;
  }
  function modalForm(kind, record = null) {
    const schema=formSchemas[kind];
    const fields=schema.map(f=>{
      const value=record?.[f.key] ?? "";
      const full=f.full?" full":"";
      let control="";
      if (f.type==="textarea") control=`<textarea class="field-textarea" name="${f.key}" placeholder="${esc(f.placeholder)}">${esc(value)}</textarea>`;
      else if (f.type==="select") control=`<select class="field-select" name="${f.key}">${f.options.map(opt=>`<option value="${esc(opt)}" ${String(value)===String(opt)?"selected":""}>${esc(opt||"No image")}</option>`).join("")}</select>`;
      else if (f.type.startsWith("relation-")) control=`<select class="field-select" name="${f.key}">${relationOptions(f.type,value)}</select>`;
      else control=`<input class="field-input" name="${f.key}" type="${f.type}" value="${esc(value)}" placeholder="${esc(f.placeholder)}" ${f.type==="number"?"min=\"0\" step=\"1\"":""}>`;
      return `<div class="field${full}"><label for="field-${f.key}">${esc(f.label)}</label>${control}</div>`;
    }).join("");
    return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 id="modal-title">${record?"Edit":"Add"} ${esc(names[kind].toLowerCase())}</h2><p>Keep the details you need close to the conversation.</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Close">×</button></div><form id="record-form" data-kind="${kind}" data-id="${record?.id||""}"><div class="modal-body"><div class="form-grid">${fields}</div></div><div class="modal-footer">${record?`<button type="button" class="button button-danger button-small" data-action="delete" data-kind="${kind}" data-id="${record.id}">Delete</button>`:"<span></span>"}<div class="modal-footer-right"><button type="button" class="button button-ghost" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">${record?"Save changes":"Save record"}</button></div></div></form></section></div>`;
  }
  function createUserModal(record = null) {
    return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 id="modal-title">${record?"Manage account":"Add an account"}</h2><p>Accounts can sign in as an admin or a user.</p></div><button type="button" class="icon-button" data-action="close-modal">×</button></div><form id="account-form" data-id="${record?.id||""}"><div class="modal-body"><div class="form-grid"><div class="field"><label>Full name</label><input class="field-input" name="name" required maxlength="80" value="${esc(record?.name||"")}" placeholder="Name shown in the CRM"></div>${record?"":`<div class="field"><label>Username</label><input class="field-input" name="username" required maxlength="40" autocomplete="off" placeholder="Choose a username"></div>`}<div class="field"><label>Access level</label><select class="field-select" name="role"><option value="user" ${record?.role==="user"?"selected":""}>User</option><option value="admin" ${record?.role==="admin"?"selected":""}>Admin</option></select></div><div class="field"><label>${record?"New password (optional)":"Password"}</label><input class="field-input" name="password" type="password" minlength="10" autocomplete="new-password" ${record?"":"required"} placeholder="At least 10 characters"></div>${record?`<div class="field full"><label class="inline-switch"><input type="checkbox" name="active" ${record.active?"checked":""} ${record.id===state.user.id?"disabled":""}> Account is active</label></div>`:""}</div></div><div class="modal-footer"><span></span><div class="modal-footer-right"><button type="button" class="button button-ghost" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">${record?"Save account":"Create account"}</button></div></div></form></section></div>`;
  }
  function passwordModal() {
    return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 id="modal-title">Change your password</h2><p>Use at least 10 characters for the new password.</p></div><button type="button" class="icon-button" data-action="close-modal">×</button></div><form id="password-form"><div class="modal-body"><div class="form-grid"><div class="field full"><label>Current password</label><input class="field-input" type="password" name="current_password" required autocomplete="current-password"></div><div class="field full"><label>New password</label><input class="field-input" type="password" name="new_password" required minlength="10" autocomplete="new-password"></div></div></div><div class="modal-footer"><span></span><div class="modal-footer-right"><button type="button" class="button button-ghost" data-action="close-modal">Cancel</button><button class="button button-primary">Update password</button></div></div></form></section></div>`;
  }
  function quickAddModal() {
    const kinds=["leads","properties","followups","visits","deals"].filter(kind=>moduleOn(kind));
    return `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 id="modal-title">What would you like to add?</h2><p>Choose a record type to continue.</p></div><button class="icon-button" data-action="close-modal">×</button></div><div class="modal-body"><div class="access-list">${kinds.map(kind=>`<button class="access-row" type="button" style="width:100%;text-align:left;background:transparent;border-left:0;border-right:0;border-bottom:0;cursor:pointer" data-action="create-from-quick" data-kind="${kind}"><span class="access-row-copy"><b>${esc(names[kind])}</b><span>${kind==="leads"?"Save a new client inquiry.":kind==="properties"?"Add a listing to your portfolio.":kind==="followups"?"Set the next follow-up.":kind==="visits"?"Schedule a site visit.":"Track a deal opportunity."}</span></span><span class="text-link">＋</span></button>`).join("")}</div></div></section></div>`;
  }
  function openModal(html) { $("#modal-root").innerHTML=html; const first=$("input,select,textarea,button",$("#modal-root")); first?.focus(); }
  function closeModal() { $("#modal-root").innerHTML=""; }
  function toast(message, type="success") { const node=document.createElement("div");node.className=`toast ${type}`;node.textContent=message;$("#toast-region").append(node);setTimeout(()=>node.remove(),3500); }
  async function refresh() { const payload=await api("/api/bootstrap");state.settings=payload.settings;state.modules=payload.modules;state.data=payload.data;renderNav();renderPage(); }
  async function loadUsers() { if(state.user?.role!=="admin") return;const result=await api("/api/admin/users");state.adminUsers=result.users; }
  function navigate(page) { if(page==="settings"&&state.user.role!=="admin") page="dashboard";if(!moduleOn(page)&&page!=="settings") {toast("This section is not enabled for your account.","error");page="dashboard"}state.page=page;location.hash=page;$("#profile-menu").hidden=true;$("#sidebar").classList.remove("open");$(".sidebar-backdrop")?.remove();renderPage(); }
  function formObject(form) {
    const data=Object.fromEntries(new FormData(form).entries());
    for(const key of ["budget","price","lead_id","property_id","value"]) if(key in data) data[key]=data[key]===""?(key.endsWith("_id")?null:0):Number(data[key]);
    return data;
  }
  function exportCsv(kind) {
    const items=state.data[kind]||[];
    if(!items.length){toast("There are no records to export yet.","error");return}
    const keys=kind==="leads"?["name","phone","email","source","budget","interest","stage","location","next_followup","notes"]:Object.keys(items[0]).filter(k=>!k.endsWith("_name")&&!k.endsWith("_title"));
    const csv=[keys.join(","),...items.map(item=>keys.map(key=>`"${String(item[key]??"").replace(/"/g,'""')}"`).join(","))].join("\r\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`zameeniq-${kind}-${new Date().toISOString().slice(0,10)}.csv`;link.click();URL.revokeObjectURL(link.href);toast("CSV export downloaded.");
  }
  function csvCell(value) { return `"${String(value??"").replace(/"/g,'""')}"`; }
  function saveSettings(form) {
    const data=new FormData(form), modules={},widgets={};
    for(const key of Object.keys(state.settings.modules)) modules[key]=data.has(`module_${key}`) || key==="dashboard";
    for(const key of Object.keys(state.settings.widgets)) widgets[key]=data.has(`widget_${key}`);
    return post("/api/admin/settings",{modules,widgets,login_notice:data.get("login_notice")||""});
  }

  document.addEventListener("submit", async event=>{
    const form=event.target;
    if(form.id==="login-form") {
      event.preventDefault();const btn=$("button[type=submit]",form);setBusy(btn,true);
      try { await post("/api/login",Object.fromEntries(new FormData(form).entries()));await enterApp(); }
      catch(error){const err=$("#login-error");err.hidden=false;err.textContent=error.message;form.elements.password.value="";form.elements.password.focus();}
      finally{if(btn){btn.disabled=false;btn.innerHTML="Sign in <span aria-hidden=\"true\">→</span>";}}
      return;
    }
    if(form.id==="record-form") {
      event.preventDefault();const kind=form.dataset.kind,id=form.dataset.id,payload=formObject(form),button=$("button[type=submit]",form);setBusy(button,true);
      try { if(id) await put(`/api/${kind}/${id}`,payload);else await post(`/api/${kind}`,payload);closeModal();state.search="";$("#global-search").value="";await refresh();toast(`${names[kind]} ${id?"updated":"saved"}.`); }
      catch(error){toast(error.message,"error");setBusy(button,false);}
      return;
    }
    if(form.id==="settings-form") {
      event.preventDefault();const btn=$('button[type="submit"]',form);setBusy(btn,true);
      try{await saveSettings(form);await refresh();$("#login-notice").textContent=state.settings.login_notice;toast("User access settings saved.");}
      catch(error){toast(error.message,"error");setBusy(btn,false);}
      return;
    }
    if(form.id==="account-form") {
      event.preventDefault();const id=form.dataset.id,payload=formObject(form),btn=$("button[type=submit]",form);if(id)payload.active=$("[name=active]",form).checked;setBusy(btn,true);
      try{if(id)await put(`/api/admin/users/${id}`,payload);else await post("/api/admin/users",payload);closeModal();await loadUsers();renderPage();toast(id?"Account updated.":"Account created.");}
      catch(error){toast(error.message,"error");setBusy(btn,false);}
      return;
    }
    if(form.id==="password-form") {
      event.preventDefault();const btn=$("button[type=submit]",form);setBusy(btn,true);
      try{await post("/api/password",formObject(form));closeModal();toast("Your password has been changed.");}
      catch(error){toast(error.message,"error");setBusy(btn,false);}
    }
  });
  document.addEventListener("click", async event=>{
    const button=event.target.closest("[data-action]");
    if(!button)return;
    const action=button.dataset.action,kind=button.dataset.kind,id=button.dataset.id;
    if(action==="navigate"){
      if(button.dataset.page==="settings"&&state.user?.role==="admin") { try { await loadUsers(); navigate("settings"); } catch(error) { toast(error.message,"error"); } }
      else navigate(button.dataset.page);
      return;
    }
    if(action==="create"){openModal(modalForm(kind));return}
    if(action==="edit"){const record=(state.data[kind]||[]).find(x=>String(x.id)===id);if(record)openModal(modalForm(kind,record));return}
    if(action==="delete"){
      if(!confirm(`Delete this ${names[kind].toLowerCase()}? This cannot be undone.`))return;
      try{await del(`/api/${kind}/${id}`);closeModal();await refresh();toast(`${names[kind]} deleted.`)}catch(error){toast(error.message,"error")}return;
    }
    if(action==="complete"){
      const record=(state.data.followups||[]).find(x=>String(x.id)===id);if(!record)return;
      try{await put(`/api/followups/${id}`,{status:"Done"});await refresh();toast("Follow-up marked done.")}catch(error){toast(error.message,"error")}return;
    }
    if(action==="quick-add"){openModal(quickAddModal());return}
    if(action==="create-from-quick"){closeModal();openModal(modalForm(kind));return}
    if(action==="close-modal"){closeModal();return}
    if(action==="backdrop-close"&&event.target===button){closeModal();return}
    if(action==="profile"){
      const menu=$("#profile-menu"), closing=!menu.hidden;
      menu.innerHTML=`<div class="menu-user"><b>${esc(state.user.name)}</b><span>${state.user.role==="admin"?"Administrator":"User access"}</span></div><button data-action="change-password">Change password</button>${state.user.role==="admin"?`<button data-action="navigate" data-page="settings">Admin settings</button>`:""}<button data-action="logout">Sign out</button>`;
      menu.hidden=closing;
      return;
    }
    if(action==="change-password"){ $("#profile-menu").hidden=true;openModal(passwordModal());return}
    if(action==="logout"){
      try{await post("/api/logout",{});}catch(_){}
      state.user=null;state.settings=null;state.adminUsers=[];state.search="";$("#global-search").value="";state.data={leads:[],properties:[],followups:[],visits:[],deals:[]};$("#app-shell").hidden=true;$("#profile-menu").hidden=true;showLogin();return;
    }
    if(action==="export"){exportCsv(kind);return}
    if(action==="create-user"){openModal(createUserModal());return}
    if(action==="edit-user"){
      try{if(!state.adminUsers.length)await loadUsers();const record=state.adminUsers.find(x=>String(x.id)===id);if(record)openModal(createUserModal(record));}catch(error){toast(error.message,"error")}return;
    }
  });
  document.addEventListener("change",event=>{
    if(event.target.id==="stage-filter"){state.filters.stage=event.target.value;renderPage()}
    if(event.target.id==="followup-filter"){const value=event.target.value;$$('.data-table tbody tr',$("#main-content")).forEach(row=>{row.hidden=value!=="all"&&!row.textContent.includes(value)})}
    if(event.target.id==="property-filter"){const value=event.target.value;$$('.property-card',$("#main-content")).forEach(card=>{card.hidden=value!=="all"&&!card.textContent.includes(value)})}
  });
  $("#global-search").addEventListener("input",event=>{state.search=event.target.value;renderPage()});
  window.addEventListener("hashchange",()=>{const page=location.hash.slice(1)||"dashboard";if(page!==state.page)navigate(page)});
  $("#menu-toggle").addEventListener("click",()=>{
    $("#sidebar").classList.add("open");if(!$(".sidebar-backdrop")){const backdrop=document.createElement("div");backdrop.className="sidebar-backdrop";backdrop.addEventListener("click",()=>{$("#sidebar").classList.remove("open");backdrop.remove()});document.body.append(backdrop)}
  });
  $("#sidebar-close").addEventListener("click",()=>{$("#sidebar").classList.remove("open");$(".sidebar-backdrop")?.remove()});
  window.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();$("#global-search").focus()}if(event.key==="Escape")closeModal()});
  $("#login-form").addEventListener("input",()=>{$("#login-error").hidden=true});

  // Account controls and admin account list load only when opened.
  document.addEventListener("click",event=>{
    const settings=event.target.closest('a[data-page="settings"]');
    if(settings){event.preventDefault();loadUsers().then(()=>navigate("settings")).catch(err=>toast(err.message,"error"));}
  });
  start().catch(error=>{console.error(error);showLogin("The CRM could not start. Check that the local server is running, then refresh.")});
})();
