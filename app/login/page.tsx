export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="login-wrap">
      <div className="login-art">
        <div className="logo">
          <span className="logo-mark">A</span>
          <span className="logo-text">Aangan<small>Studio · Pune</small></span>
        </div>
        <div>
          <h2>Every enquiry answered, qualified and handed to you.</h2>
          <p>Leads, briefs, transcripts and bookings from the AI phone assistant — in one place for the design team.</p>
        </div>
        <span className="small" style={{ color: "#a99f93" }}>Designer dashboard</span>
      </div>
      <div className="login-panel">
        <form className="login-card" method="post" action="/api/auth/login">
          <h1>Welcome back</h1>
          <p className="muted">Enter the shared studio password to continue.</p>
          <input type="password" name="password" placeholder="Password" autoFocus required />
          <button type="submit" className="accent">Sign in</button>
          {error && <p className="error">That password didn't match. Try again.</p>}
        </form>
      </div>
    </div>
  );
}
