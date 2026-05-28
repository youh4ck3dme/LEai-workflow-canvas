import { NextResponse } from "next/server";

export type ErrorPayload = {
  errorCode: string;
  message: string;
  status: number;
  requestId: string;
};

export function jsonWithRequestId<T>(payload: T, status: number, requestId: string) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "x-request-id": requestId,
    },
  });
}

export function normalizedError(
  status: number,
  errorCode: string,
  message: string,
  requestId: string
) {
  const payload: ErrorPayload = {
    errorCode,
    message,
    status,
    requestId,
  };

  return jsonWithRequestId(payload, status, requestId);
}

