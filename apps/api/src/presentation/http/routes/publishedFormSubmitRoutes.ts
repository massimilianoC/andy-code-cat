import express, { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import {
    FORM_SUBMISSION_MAX_BYTES,
    formSubmissionRequestSchema,
    type FormSubmissionErrorCode,
    type FormSubmissionErrorResponse,
    type FormSubmissionIssue,
} from "@andy-code-cat/contracts";
import type { SubmitPublishedForm } from "../../../application/forms/SubmitPublishedForm";

/**
 * POST /p/{publishId}/_pf/forms/{formId}/submit — the public, anonymous write path of the capture
 * form runtime (docs/specs/FORMS_CAPTURE.md).
 *
 * Same origin as the site on purpose: a sites origin's proxy forwards `/p/`, slug paths and
 * `/health` only (never `/v1`), and a same-origin request needs no CORS. Mounted ahead of the
 * global 8 MB JSON parser so this route's own 16 KB limit is the one that applies.
 *
 * Order: rate limits (cheap, before any work) → content type → host → Origin/Referer → body
 * (16 KB) → envelope → honeypot → server-side resolution and validation (SubmitPublishedForm).
 *
 * Nothing here echoes or logs a submitted value: refusals carry a code and, for validation, the
 * manifest field ids at fault; logs carry publishId, formId and the code.
 */

export interface PublishedFormSubmitLimits {
    /** Requests per window from one client IP, across every site. */
    perIp: number;
    /** Requests per window addressed to one publishId, from any IP. */
    perSite: number;
    windowMs: number;
}

/**
 * In-memory counters (express-rate-limit's MemoryStore): Redis was removed from the stack and the
 * API runs as a single instance. A second API instance would need a shared store.
 */
export const DEFAULT_PUBLISHED_FORM_SUBMIT_LIMITS: PublishedFormSubmitLimits = {
    perIp: 20,
    perSite: 300,
    windowMs: 10 * 60_000,
};

const MESSAGES: Record<FormSubmissionErrorCode, string> = {
    FORM_SITE_NOT_FOUND: "Not found",
    FORM_SITE_SUSPENDED: "This site is unavailable",
    FORM_SITE_HOST_REFUSED: "Form submissions are not accepted on this host",
    FORM_ORIGIN_REFUSED: "Cross-origin form submissions are not accepted",
    FORM_CAPTURE_DISABLED: "This form does not accept submissions",
    FORM_NOT_FOUND: "Form not found",
    FORM_SUBMISSION_INVALID: "Invalid form submission",
    FORM_SUBMISSION_TOO_LARGE: "Form submission too large",
    FORM_SUBMISSION_UNSUPPORTED_MEDIA_TYPE: "Form submissions must be application/json",
    FORM_RATE_LIMITED: "Too many submissions, try again later",
    FORM_QUOTA_EXCEEDED: "This form is not accepting submissions at the moment",
    FORM_TEMPORARILY_UNAVAILABLE: "Temporarily unavailable",
};

function refuse(req: Request, res: Response, status: number, code: FormSubmissionErrorCode, issues?: FormSubmissionIssue[]) {
    console.warn("[form-capture] refused", {
        publishId: String(req.params.publishId ?? "").slice(0, 16),
        formId: String(req.params.formId ?? "").slice(0, 48),
        status,
        code,
    });
    const body: FormSubmissionErrorResponse = { ok: false, error: MESSAGES[code], code, ...(issues ? { issues } : {}) };
    res.status(status).setHeader("Cache-Control", "no-store").json(body);
}

/** Origin, else Referer, must name the host the request arrived on. Absent both: not a browser form post. */
export function sameOriginAsRequest(req: Request): boolean {
    const host = (req.hostname ?? "").toLowerCase();
    const origin = req.get("origin");
    const referer = req.get("referer");
    const claimed = origin ?? referer;
    if (claimed === undefined) return true;
    try {
        const url = new URL(claimed);
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        return url.hostname.toLowerCase() === host;
    } catch {
        // "null" (sandboxed or opaque origins) and malformed values are refused.
        return false;
    }
}

export function createPublishedFormSubmitRouter(deps: {
    submitForm: Pick<SubmitPublishedForm, "execute">;
    /** True when the request's host may serve this site (the decideSiteRequest rule). */
    isSiteHost: (req: Request, publishId: string) => Promise<boolean>;
    limits?: PublishedFormSubmitLimits;
}): Router {
    const router = Router();
    const limits = deps.limits ?? DEFAULT_PUBLISHED_FORM_SUBMIT_LIMITS;

    const perIpLimiter = rateLimit({
        windowMs: limits.windowMs,
        limit: limits.perIp,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => refuse(req, res, 429, "FORM_RATE_LIMITED"),
    });
    const perSiteLimiter = rateLimit({
        windowMs: limits.windowMs,
        limit: limits.perSite,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `site:${String(req.params.publishId ?? "").slice(0, 16)}`,
        handler: (req, res) => refuse(req, res, 429, "FORM_RATE_LIMITED"),
    });
    const parseJson = express.json({ limit: FORM_SUBMISSION_MAX_BYTES, type: "application/json", strict: true });

    function requireJson(req: Request, res: Response, next: NextFunction) {
        if (!req.is("application/json")) {
            refuse(req, res, 415, "FORM_SUBMISSION_UNSUPPORTED_MEDIA_TYPE");
            return;
        }
        next();
    }

    async function requireSiteHost(req: Request, res: Response, next: NextFunction) {
        try {
            // A POST is never redirected: on an app host (or any host that is not the site's),
            // it is refused, exactly where page content would be redirected or refused.
            if (!(await deps.isSiteHost(req, String(req.params.publishId ?? "")))) {
                refuse(req, res, 403, "FORM_SITE_HOST_REFUSED");
                return;
            }
            next();
        } catch {
            refuse(req, res, 503, "FORM_TEMPORARILY_UNAVAILABLE");
        }
    }

    function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
        if (!sameOriginAsRequest(req)) {
            refuse(req, res, 403, "FORM_ORIGIN_REFUSED");
            return;
        }
        next();
    }

    /** body-parser errors carry parts of the body in their message: they are mapped, never forwarded. */
    function parseBody(req: Request, res: Response, next: NextFunction) {
        parseJson(req, res, (error?: unknown) => {
            if (error) {
                const type = (error as { type?: string }).type;
                if (type === "entity.too.large") refuse(req, res, 413, "FORM_SUBMISSION_TOO_LARGE");
                else refuse(req, res, 400, "FORM_SUBMISSION_INVALID");
                return;
            }
            next();
        });
    }

    router.post(
        "/:publishId/_pf/forms/:formId/submit",
        perIpLimiter,
        perSiteLimiter,
        requireJson,
        requireSiteHost,
        requireSameOrigin,
        parseBody,
        async (req: Request, res: Response) => {
            const envelope = formSubmissionRequestSchema.safeParse(req.body);
            if (!envelope.success) {
                refuse(req, res, 400, "FORM_SUBMISSION_INVALID");
                return;
            }
            // Honeypot filled: answer like an accepted submission and store nothing.
            if (envelope.data.hp) {
                console.warn("[form-capture] honeypot", { publishId: String(req.params.publishId).slice(0, 16), formId: String(req.params.formId).slice(0, 48) });
                res.status(202).setHeader("Cache-Control", "no-store").json({ ok: true });
                return;
            }
            try {
                const result = await deps.submitForm.execute({
                    publishId: String(req.params.publishId),
                    formId: String(req.params.formId),
                    fields: envelope.data.fields,
                    ip: req.ip ?? "",
                });
                if (result.outcome === "refused") {
                    refuse(req, res, result.status, result.code, result.issues);
                    return;
                }
                res.status(201).setHeader("Cache-Control", "no-store").json({ ok: true });
            } catch (error) {
                // Only the error's name: a driver message could quote the document being written.
                console.error("[form-capture] submit failed", {
                    publishId: String(req.params.publishId).slice(0, 16),
                    formId: String(req.params.formId).slice(0, 48),
                    error: error instanceof Error ? error.name : "unknown",
                });
                refuse(req, res, 503, "FORM_TEMPORARILY_UNAVAILABLE");
            }
        },
    );

    return router;
}
