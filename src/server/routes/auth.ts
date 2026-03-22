import type { FastifyInstance } from 'fastify';
import { isAuthenticated, validateCredentials, setAuthCookie, clearAuthCookie } from '../middleware/auth.js';

const PAGE_STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  .login-card { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); padding: 32px; width: 360px; }
  .login-card h1 { font-size: 20px; margin-bottom: 24px; text-align: center; }
  .login-card input { width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; margin-bottom: 12px; }
  .login-card input:focus { outline: none; border-color: #3498db; }
  .login-card button { width: 100%; padding: 10px; background: #3498db; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; margin-top: 4px; }
  .login-card button:hover { background: #2980b9; }
  .error { color: #e74c3c; font-size: 13px; margin-bottom: 12px; text-align: center; }
`;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/login', async (request, reply) => {
    if (isAuthenticated(request)) {
      const query = request.query as { r?: string };
      return reply.redirect(query.r ? decodeURIComponent(query.r) : '/jobs');
    }

    const query = request.query as { r?: string; error?: string };
    const returnTo = query.r ?? '';
    const error = query.error === '1' ? '<p class="error">Usuario ou senha invalidos</p>' : '';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login — Agent Multirepo</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="login-card">
    <h1>Agent Multirepo</h1>
    ${error}
    <form method="post" action="/login">
      <input type="hidden" name="returnTo" value="${returnTo.replace(/"/g, '&quot;')}">
      <input type="text" name="user" placeholder="Usuario" autocomplete="username" autofocus required>
      <input type="password" name="pass" placeholder="Senha" autocomplete="current-password" required>
      <button type="submit">Entrar</button>
    </form>
  </div>
</body>
</html>`;

    return reply.type('text/html').send(html);
  });

  app.post('/login', async (request, reply) => {
    const body = request.body as { user?: string; pass?: string; returnTo?: string };
    const user = body?.user ?? '';
    const pass = body?.pass ?? '';
    const returnTo = body?.returnTo ?? '/jobs';

    if (!validateCredentials(user, pass)) {
      const r = encodeURIComponent(returnTo);
      return reply.redirect(`/login?error=1&r=${r}`);
    }

    setAuthCookie(reply);
    return reply.redirect(returnTo || '/jobs');
  });

  app.get('/logout', async (_request, reply) => {
    clearAuthCookie(reply);
    return reply.redirect('/login');
  });
}
