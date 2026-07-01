import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { logger } from "../../infrastructure/logging/logger.js";
import { AppError } from "../errors/app-error.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (isHttpParserError(err)) {
    const isUnsupportedType = err.status === 415;
    const isTooLarge = err.status === 413;

    return res.status(err.status).json({
      success: false,
      data: null,
      error: {
        code: isUnsupportedType
          ? "unsupported_content_type"
          : isTooLarge
            ? "request_body_too_large"
            : "invalid_request_body",
        message: isUnsupportedType
          ? "Unsupported content type. JSON endpoints expect Content-Type: application/json; raw binary files should use a signed upload URL."
          : isTooLarge
            ? "Request body is larger than the configured upload limit."
            : "Request body could not be parsed.",
        details: {
          type: err.type ?? null
        }
      },
      meta: {
        requestId: res.locals.requestId
      }
    });
  }

  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      data: null,
      error: {
        code: "validation_failed",
        message: "Request validation failed.",
        details: err.flatten()
      },
      meta: {
        requestId: res.locals.requestId
      }
    });
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId: res.locals.requestId }, "Application error");
    }

    return res.status(err.statusCode).json({
      success: false,
      data: null,
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null
      },
      meta: {
        requestId: res.locals.requestId
      }
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      return res.status(404).json({
        success: false,
        data: null,
        error: {
          code: "not_found",
          message: "Resource not found.",
          details: null
        },
        meta: {
          requestId: res.locals.requestId
        }
      });
    }

    if (err.code === "P2002") {
      return res.status(409).json({
        success: false,
        data: null,
        error: {
          code: "unique_constraint_failed",
          message: "A resource with this value already exists.",
          details: {
            target: err.meta?.target
          }
        },
        meta: {
          requestId: res.locals.requestId
        }
      });
    }

    if (err.code === "P2003") {
      return res.status(409).json({
        success: false,
        data: null,
        error: {
          code: "relation_constraint_failed",
          message: "Related resource constraint failed.",
          details: {
            field: err.meta?.field_name
          }
        },
        meta: {
          requestId: res.locals.requestId
        }
      });
    }
  }

  logger.error({ err, path: req.path, requestId: res.locals.requestId }, "Unhandled error");

  return res.status(500).json({
    success: false,
    data: null,
    error: {
      code: "internal_server_error",
      message: "An unexpected error occurred.",
      details: null
    },
    meta: {
      requestId: res.locals.requestId
    }
  });
};

function isHttpParserError(error: unknown): error is { status: number; type?: string } {
  return Boolean(
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    "type" in error
  );
}
