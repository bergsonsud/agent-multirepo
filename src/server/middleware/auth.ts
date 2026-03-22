import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../env.js';

const COOKIE_NAME = 'agent_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function hashCredentials(user: string, pass: string): string {
  return crypto.createHmac('sha256', 'agent-multirepo').update(`${user}:${pass}`).digest('hex');
}

// API auth — Bearer token header
export async function bearerAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice(7);
  if (token !== env.API_BEARER_TOKEN) {
    reply.code(403).send({ error: 'Invalid token' });
    return;
  }
}

// Dashboard auth — cookie-based
export function isAuthenticated(request: FastifyRequest): boolean {
  const cookie = (request.cookies as Record<string, string | undefined>)?.[COOKIE_NAME];
  if (!cookie) return false;
  return cookie === hashCredentials(env.DASHBOARD_USER, env.DASHBOARD_PASS);
}

export function validateCredentials(user: string, pass: string): boolean {
  return user === env.DASHBOARD_USER && pass === env.DASHBOARD_PASS;
}

export function setAuthCookie(reply: FastifyReply): void {
  reply.setCookie(COOKIE_NAME, hashCredentials(env.DASHBOARD_USER, env.DASHBOARD_PASS), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearAuthCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

export async function dashboardAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAuthenticated(request)) {
    const returnTo = encodeURIComponent(request.url);
    reply.redirect(`/login?r=${returnTo}`);
  }
}
