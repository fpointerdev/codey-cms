import type { RequestHandler } from "express";

export const notFoundHandler: RequestHandler = (_req, res) => {
  return res.status(404).json({
    success: false,
    data: null,
    error: {
      code: "not_found",
      message: "Route not found.",
      details: null
    },
    meta: {
      requestId: res.locals.requestId
    }
  });
};
