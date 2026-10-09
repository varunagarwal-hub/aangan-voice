export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main>
      <form className="panel login" method="post" action="/api/auth/login">
        <h1>Aangan Studio</h1>
        <p className="muted">Designer dashboard</p>
        <div className="row">
          <input type="password" name="password" placeholder="Shared password" autoFocus required style={{ flex: 1 }} />
          <button type="submit">Sign in</button>
        </div>
        {error && <p className="bad">Wrong password.</p>}
      </form>
    </main>
  );
}
