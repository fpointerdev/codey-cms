import express, { type Request, type RequestHandler } from "express";
import type { ModuleContext } from "../types/module.js";
import { requireAuth } from "../../modules/auth/auth.middleware.js";

export function createRequestBodyParser(context: ModuleContext): RequestHandler {
  const authenticate = requireAuth(context);
  const ordinary = express.json({ limit: "256kb", inflate: false });
  const authentication = express.json({ limit: "16kb", inflate: false });
  const content = express.json({ limit: context.config.storage.requestBodyLimit, inflate: false });
  const webhook = express.json({
    limit: "1mb",
    inflate: false,
    verify: (req, _res, buffer) => { (req as Request).rawBody = buffer; }
  });
  const formOptions = {
    extended: true, limit: "16kb", parameterLimit: 100, depth: 5, inflate: false
  };
  const form = express.urlencoded(formOptions);

  return (req, res, next) => {
    if (/^\/payments\/webhooks\/(stripe|paypal)\/?$/i.test(req.path) && req.method === "POST") {
      webhook(req, res, next);
      return;
    }
    const largeContent = ["POST", "PUT", "PATCH"].includes(req.method) && (
      /^\/cms\/(pages|posts|templates|collections)(\/|$)/i.test(req.path) ||
      /^\/products(\/|$)/i.test(req.path) ||
      /^\/cms\/media\/upload\/?$/i.test(req.path) ||
      /^\/config\/generation\/(apply|validate)\/?$/i.test(req.path)
    );
    if (largeContent) {
      authenticate(req, res, (error) => {
        if (error) next(error);
        else content(req, res, next);
      });
      return;
    }
    const json = /^\/(auth|install)(\/|$)/i.test(req.path) ? authentication : ordinary;
    json(req, res, (error) => {
      if (error) next(error);
      else form(req, res, next);
    });
  };
}
