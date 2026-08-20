import { getSession } from '../database.js';

export async function requireAuth(req, res, next) {
  const sessionId = req.cookies?.session_id;
  if (!sessionId) {
    console.log('[Auth Debug] No session id found in req.cookies:', req.cookies);
    return res.status(401).json({ error: 'Unauthorized: No session id found in cookies', cookies: req.cookies });
  }

  const session = await getSession(sessionId);
  if (!session) {
    console.log('[Auth Debug] Invalid session id in database:', sessionId);
    return res.status(401).json({ error: 'Unauthorized: Invalid session' });
  }

  req.user = { open_id: session.open_id };
  next();
}
