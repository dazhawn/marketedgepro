// Myfxbook API client (read-only account tracking) — ported from the MT5
// Optimizer Studio's Python client. Cloud-friendly: the Myfxbook API is
// outbound HTTPS, so it works from Railway (which can't reach the VPS/PC).
//
// Flow: login -> get-my-accounts -> logout. Credentials come from env
// (MYFXBOOK_EMAIL / MYFXBOOK_PASSWORD) and are never logged.
//
// Docs: https://www.myfxbook.com/api

const BASE = "https://www.myfxbook.com/api";

export class MyfxbookError extends Error {}

export interface MyfxbookAccount {
  id: number | string;
  name?: string;
  balance?: number;
  equity?: number;
  drawdown?: number;   // NOTE: Myfxbook "drawdown" is MAX historical DD, not current
  gain?: number;       // percent
  profit?: number;
  currency?: string;
  demo?: boolean;
}

async function apiGet(path: string, params: Record<string, string>): Promise<any> {
  const url = `${BASE}/${path}?${new URLSearchParams(params).toString()}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const data = await resp.json().catch(() => {
    throw new MyfxbookError(`${path}: non-JSON response (http ${resp.status})`);
  });
  if (data?.error) throw new MyfxbookError(data.message || `${path} failed`);
  return data;
}

export async function login(email: string, password: string): Promise<string> {
  const data = await apiGet("login.json", { email, password });
  const session = data?.session;
  if (!session) throw new MyfxbookError("login returned no session");
  // Myfxbook returns the token URL-encoded (base64 "=" as "%3D"). Decode once so
  // URLSearchParams re-encodes it correctly instead of double-encoding it.
  return decodeURIComponent(session);
}

export async function getAccounts(session: string): Promise<MyfxbookAccount[]> {
  const data = await apiGet("get-my-accounts.json", { session });
  return (data?.accounts ?? []) as MyfxbookAccount[];
}

export async function logout(session: string): Promise<void> {
  try {
    await apiGet("logout.json", { session });
  } catch {
    /* best-effort */
  }
}
