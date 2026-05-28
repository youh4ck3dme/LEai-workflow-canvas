type ApiLogInput = {
  route: string;
  method: string;
  requestId: string;
  durationMs: number;
  status: number;
  tokenIdentity: string;
  ip: string;
  bodyBytes?: number;
  extra?: Record<string, unknown>;
};

export function logApiRequest(input: ApiLogInput) {
  const payload = {
    event: "api_request",
    route: input.route,
    method: input.method,
    requestId: input.requestId,
    durationMs: input.durationMs,
    status: input.status,
    tokenIdentity: input.tokenIdentity,
    ip: input.ip,
    bodyBytes: input.bodyBytes ?? null,
    ...input.extra,
  };

  console.info(JSON.stringify(payload));
}

