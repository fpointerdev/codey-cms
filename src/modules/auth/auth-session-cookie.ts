import type { Request, Response } from "express";
import type { AppConfig } from "../../config/index.js";
import type { TokenPair } from "./auth.types.js";

export const refreshTokenCookieName = "codey_refresh_token";

function durationMilliseconds(value: string) {
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid auth duration: ${value}.`);

  const amount = Number(match[1]);
  const unitMilliseconds: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000
  };

  return amount * unitMilliseconds[match[2]];
}

function cookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "strict" as const,
    path: `${config.api.prefix.replace(/\/$/, "")}/auth`
  };
}

export function refreshTokenFromRequest(req: Pick<Request, "body" | "cookies">) {
  const cookieToken = req.cookies?.[refreshTokenCookieName];
  if (typeof cookieToken === "string" && cookieToken) return cookieToken;

  const bodyToken = req.body?.refreshToken;
  return typeof bodyToken === "string" && bodyToken ? bodyToken : null;
}

export function setRefreshTokenCookie(
  res: Pick<Response, "cookie">,
  refreshToken: string,
  config: AppConfig
) {
  res.cookie(refreshTokenCookieName, refreshToken, {
    ...cookieOptions(config),
    maxAge: durationMilliseconds(config.auth.refreshTokenTtl)
  });
}

export function clearRefreshTokenCookie(
  res: Pick<Response, "clearCookie">,
  config: AppConfig
) {
  res.clearCookie(refreshTokenCookieName, cookieOptions(config));
}

export function exposeAccessToken(
  res: Pick<Response, "cookie">,
  tokens: TokenPair,
  config: AppConfig
) {
  setRefreshTokenCookie(res, tokens.refreshToken, config);
  const { refreshToken: _refreshToken, ...accessToken } = tokens;

  return accessToken;
}
