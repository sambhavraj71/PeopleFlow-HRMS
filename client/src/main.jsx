
import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';import{LayoutDashboard,Users,Clock,CalendarDays,Wallet,LogOut,Menu,CheckCircle2,Plus,Download,ShieldCheck,MapPin}from'lucide-react';import './style.css';
const BASE=import.meta.env.VITE_API_URL||'http://localhost:5000/api';const fmt=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
function App(){const [token,setToken]=useState(localStorage.getItem('pf_token')||'');const [user,setUser]=useState(JSON.parse(localStorage.getItem('pf_user')||'null'));const [page,setPage]=useState('Dashboard');const [data,setData]=useState([]);const [stats,setStats]=useState(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [sidebar,setSidebar]=useState(false);const [month,setMonth]=useState(new Date().toISOString().slice(0,7));const [gpsConfig,setGpsConfig]=useState(null);const [gpsStatus,setGpsStatus]=useState('');
const api=async(path,options={})=>{const response=await fetch(BASE+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(options.headers||{})}});const body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.message||'Request failed');return body};
const notify=(text)=>{setMessage(text);setTimeout(()=>setMessage(''),4500)};
const refresh=async(target=page)=>{try{const p=target==='Dashboard'?'/dashboard':target==='Employees'?'/employees':target==='Attendance'?'/attendance?month='+month:target==='Leaves'?'/leaves':'/payroll?month='+month;const result=await api(p);if(target==='Dashboard')setStats(result);else setData(result)}catch(e){notify(e.message)}};
useEffect(()=>{if(token)refresh()},[page,token,month]);
 useEffect(()=>{if(!token||page!=='Attendance')return;api('/attendance/config').then(setGpsConfig).catch(e=>notify(e.message))},[page,token]);
const login=async(e)=>{e.preventDefault();setBusy(true);try{const f=new FormData(e.currentTarget);const result=await api('/auth/login',{method:'POST',body:JSON.stringify({email:f.get('email'),password:f.get('password')})});localStorage.setItem('pf_token',result.token);localStorage.setItem('pf_user',JSON.stringify(result.user));setToken(result.token);setUser(result.user);notify('Welcome back!')}catch(e){notify(e.message)}finally{setBusy(false)}};
const logout=()=>{localStorage.removeItem('pf_token');localStorage.removeItem('pf_user');setToken('');setUser(null);setPage('Dashboard')};
const act=async(path,body,method='POST')=>{setBusy(true);try{await api(path,{method,body:body?JSON.stringify(body):undefined});notify('Saved successfully');await refresh()}catch(e){notify(e.message)}finally{setBusy(false)}};


const getCurrentLocation = () => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Your browser does not support GPS location."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: position.timestamp
        });
      },
      (error) => {
        if (error.code === 1) {
          reject(new Error("Please allow location permission."));
        } else if (error.code === 2) {
          reject(new Error("Location unavailable. Enable location services."));
        } else {
          reject(new Error("Location request timed out. Try again."));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    );
  });
};

const gpsAttendance = async (action) => {
  setBusy(true);

  try {
    const location = await getCurrentLocation();

    const result = await api(`/attendance/${action}`, {
      method: "POST",
      body: JSON.stringify(location)
    });

    notify(
      action === "check-in"
        ? "GPS verified! Checked in successfully."
        : "GPS verified! Checked out successfully."
    );

    await refresh("Attendance");

    return result;
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(false);
  }
};

const addEmployee=async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);await act('/employees',{name:f.get('name'),email:f.get('email'),password:f.get('password'),role:f.get('role'),department:f.get('department'),designation:f.get('designation'),baseSalary:Number(f.get('baseSalary'))});e.currentTarget.reset()};
const addLeave=async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);await act('/leaves',{type:f.get('type'),from:f.get('from'),to:f.get('to'),reason:f.get('reason')});e.currentTarget.reset()};
const generate=async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);await act('/payroll/generate',{month,allowances:Number(f.get('allowances')||0),bonus:Number(f.get('bonus')||0),deductions:Number(f.get('deductions')||0)})};
const payslip=async(id)=>{try{const r=await fetch(BASE+'/payroll/'+id+'/payslip',{headers:{Authorization:'Bearer '+token}});if(!r.ok){const b=await r.json();throw Error(b.message)}const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download='payslip.pdf';a.click();URL.revokeObjectURL(url)}catch(e){notify(e.message)}};
const manager=user?.role!=='employee';const nav=[['Dashboard',LayoutDashboard],...(manager?[['Employees',Users]]:[]),['Attendance',Clock],['Leaves',CalendarDays],['Payroll',Wallet]];
if(!token)return <div className="login-bg"><div className="login-card"><div className="brand"><div className="brand-mark">P</div><span>PeopleFlow</span></div><h1>Welcome back</h1><p className="muted">Sign in to your HR workspace</p><form onSubmit={login} className="stack"><label>Email<input name="email" type="email" placeholder="admin@example.com" required/></label><label>Password<input name="password" type="password" placeholder="Your password" required/></label><button disabled={busy} className="primary">{busy?'Signing in...':'Sign in'}</button></form><p className="hint">First time? Run the server seed command to create your admin account.</p>{message&&<div className="toast">{message}</div>}</div></div>;
return <div className="app"><aside className={'sidebar '+(sidebar?'show':'')}><div className="brand"><div className="brand-mark">P</div><span>PeopleFlow</span></div><p className="side-label">WORKSPACE</p><nav>{nav.map(([label,Icon])=><button key={label} className={'nav-item '+(page===label?'active':'')} onClick={()=>{setPage(label);setSidebar(false)}}><Icon size={18}/>{label}</button>)}</nav><div className="sidebar-bottom"><div className="profile"><div className="avatar">{user?.name?.[0]}</div><div><strong>{user?.name}</strong><small>{user?.role}</small></div></div><button className="nav-item" onClick={logout}><LogOut size={18}/> Sign out</button></div></aside><main className="main"><header><button className="menu-btn" onClick={()=>setSidebar(!sidebar)}><Menu size={22}/></button><div><div className="eyebrow">HR MANAGEMENT</div><h1>{page}</h1></div><div className="header-right"><span className="role-pill"><ShieldCheck size={14}/>{user?.role}</span><div className="avatar">{user?.name?.[0]}</div></div></header><div className="content">{message&&<div className="notice">{message}</div>}
{page==='Dashboard'&&<><div className="welcome"><div><p>WORKFORCE OVERVIEW</p><h2>Hello, {user?.name?.split(' ')[0]} 👋</h2><span>Here's what's happening across your workspace today.</span></div><div className="welcome-art">✦</div></div><div className="metrics"><Metric title={manager?'Active employees':'Your profile'} value={stats?.employees||0} icon={<Users/>}/><Metric title="Pending leave requests" value={stats?.pendingLeaves||0} icon={<CalendarDays/>}/><Metric title={manager?'Checked in today':'Your check-ins today'} value={stats?.attendanceToday||0} icon={<Clock/>}/></div><section className="panel"><h3>Recent payroll</h3><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Month</th><th>Net salary</th><th>Status</th></tr></thead><tbody>{stats?.latestPayroll?.map(p=><tr key={p._id}><td>{p.employee?.name}</td><td>{p.month}</td><td>{fmt(p.net)}</td><td><Status value={p.status}/></td></tr>)}</tbody></table></div>{!stats?.latestPayroll?.length&&<Empty/>}</section></>}
{page==='Employees'&&manager&&<><section className="panel"><h3><Plus size={19}/> Add employee</h3><form className="form-grid" onSubmit={addEmployee}><input name="name" placeholder="Full name" required minLength="2"/><input name="email" type="email" placeholder="Email address" required/><input name="password" type="password" placeholder="Initial password (8+ chars)" required minLength="8"/><select name="role"><option value="employee">Employee</option><option value="hr">HR</option>{user.role==='admin'&&<option value="admin">Admin</option>}</select><input name="department" placeholder="Department" defaultValue="General"/><input name="designation" placeholder="Designation" defaultValue="Staff"/><input name="baseSalary" type="number" min="0" step="0.01" placeholder="Monthly basic salary" required/><button className="primary" disabled={busy}>Create employee</button></form></section><section className="panel"><h3>Employee directory <span className="count">{data.length}</span></h3><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th>Basic salary</th><th>Status</th></tr></thead><tbody>{data.map(u=><tr key={u.id}><td><strong>{u.name}</strong><small className="subtext">{u.designation}</small></td><td>{u.email}</td><td>{u.department}</td><td>{u.role}</td><td>{fmt(u.baseSalary)}</td><td><Status value={u.active?'active':'inactive'}/></td></tr>)}</tbody></table></div>{!data.length&&<Empty/>}</section></>}
{page==='Attendance'&&<><section className="panel action-bar"><div><h3>Attendance tracker</h3><p className="muted">Check in and out to record your workday.</p><p className="muted"><MapPin size={14} style={{verticalAlign:"middle",marginRight:5}}/>{gpsConfig?gpsConfig.gpsEnabled?`GPS required • Office radius ${gpsConfig.officeRadiusMeters} m • Maximum accuracy ${gpsConfig.maxAccuracyMeters} m` : "GPS verification disabled":"Loading GPS policy..."}</p>{gpsStatus&&<p className="muted" role="status">{gpsStatus}</p>}</div><div className="actions"><button className="primary" disabled={busy} onClick={()=>gpsAttendance('check-in')}>Check in</button><button className="secondary" disabled={busy} onClick={()=>gpsAttendance('check-out')}>Check out</button></div></section><section className="panel"><div className="section-heading"><h3>Attendance records</h3><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Date</th><th>Check in</th><th>Check out</th><th>GPS</th><th>Status</th></tr></thead><tbody>{data.map(a=><tr key={a._id}><td>{a.employee?.name}</td><td>{a.date}</td><td>{new Date(a.checkIn).toLocaleTimeString()}</td><td>{a.checkOut?new Date(a.checkOut).toLocaleTimeString():'—'}</td><td>{a.checkInLocation?`Verified (${a.checkInLocation.distanceMeters} m)`:'Not recorded'}</td><td><Status value={a.checkOut?'completed':'checked in'}/></td></tr>)}</tbody></table></div>{!data.length&&<Empty/>}</section></>}
{page==='Leaves'&&<><section className="panel"><h3><Plus size={19}/> Request leave</h3><form className="form-grid" onSubmit={addLeave}><select name="type"><option value="annual">Annual</option><option value="sick">Sick</option><option value="casual">Casual</option><option value="unpaid">Unpaid</option></select><input name="from" type="date" required/><input name="to" type="date" required/><input name="reason" placeholder="Reason for leave" minLength="3" required/><button className="primary" disabled={busy}>Submit request</button></form></section><section className="panel"><h3>Leave requests</h3><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th>{manager&&<th>Review</th>}</tr></thead><tbody>{data.map(l=><tr key={l._id}><td>{l.employee?.name}</td><td className="capitalize">{l.type}</td><td>{l.from} → {l.to}</td><td>{l.days}</td><td><Status value={l.status}/></td>{manager&&<td>{l.status==='pending'&&l.employee?._id!==user.id?<div className="actions"><button className="small green" disabled={busy} onClick={()=>act('/leaves/'+l._id+'/status',{status:'approved'},'PATCH')}>Approve</button><button className="small" disabled={busy} onClick={()=>act('/leaves/'+l._id+'/status',{status:'rejected'},'PATCH')}>Reject</button></div>:'—'}</td>}</tr>)}</tbody></table></div>{!data.length&&<Empty/>}</section></>}
{page==='Payroll'&&<>{manager&&<section className="panel"><h3><Plus size={19}/> Generate monthly payroll</h3><p className="muted">Generates draft payroll for active employees; approved unpaid leave reduces pay. Review before approving.</p><form className="form-grid" onSubmit={generate}><input type="month" value={month} onChange={e=>setMonth(e.target.value)} required/><input type="number" name="allowances" placeholder="Allowances (₹)" min="0" step="0.01" defaultValue="0"/><input type="number" name="bonus" placeholder="Bonus (₹)" min="0" step="0.01" defaultValue="0"/><input type="number" name="deductions" placeholder="Other deductions (₹)" min="0" step="0.01" defaultValue="0"/><button className="primary" disabled={busy}>Generate drafts</button></form></section>}<section className="panel"><div className="section-heading"><h3>Payroll records</h3><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Month</th><th>Gross</th><th>Deductions</th><th>Net pay</th><th>Status</th><th>Action</th></tr></thead><tbody>{data.map(p=><tr key={p._id}><td>{p.employee?.name}</td><td>{p.month}</td><td>{fmt(p.gross)}</td><td>{fmt(p.deductions+p.unpaidLeaveDeduction)}</td><td><strong>{fmt(p.net)}</strong></td><td><Status value={p.status}/></td><td>{p.status==='approved'?<button className="small" onClick={()=>payslip(p._id)}><Download size={14}/> Payslip</button>:manager?<button className="small green" disabled={busy} onClick={()=>act('/payroll/'+p._id+'/approve')}>Approve</button>:'—'}</td></tr>)}</tbody></table></div>{!data.length&&<Empty/>}</section></>}
</div></main></div>}
function Metric({title,value,icon}){return <div className="metric"><div className="metric-icon">{icon}</div><div><p>{title}</p><strong>{value}</strong></div></div>}
function Status({value}){return <span className={'status '+(value==='approved'||value==='active'||value==='completed'?'good':value==='rejected'||value==='inactive'?'bad':'pending')}>{value}</span>}
function Empty(){return <div className="empty"><CheckCircle2 size={24}/><p>No records to show yet.</p></div>}
createRoot(document.getElementById('root')).render(<App/>);

