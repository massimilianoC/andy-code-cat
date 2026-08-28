"use client";

import { useEffect, useState } from "react";

/**
 * Shows the release version this build was cut from, next to the brand mark.
 *
 * The version comes from `RELEASE_VERSION` at the repository root — the SSOT for the
 * publication version per CLAUDE.md, calendar notation YYYY.MM.DD.N, deliberately distinct
 * from the SemVer in package.json which exists only for npm tooling. It is baked into both
 * images at build time from that one file, so neither service can report a version it is not
 * actually running.
 *
 * The badge also answers the question the version alone cannot: are the two halves the same
 * build? It asks the API what version IT is running and, when the answers differ, says so.
 * A web bundle talking to an older API is the failure mode that produces "it works locally"
 * bug reports, and it is invisible unless something looks for it.
 */

const WEB_VERSION = process.env.NEXT_PUBLIC_RELEASE_VERSION ?? "unknown";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type VersionState =
    | { kind: "checking" }
    | { kind: "aligned"; version: string }
    | { kind: "mismatch"; web: string; api: string }
    | { kind: "unreachable"; web: string };

export function VersionBadge({ className }: { className?: string }) {
    const [state, setState] = useState<VersionState>({ kind: "checking" });

    useEffect(() => {
        let cancelled = false;

        // Mounted at the app root, not under /v1 — every /v1 router applies auth middleware.
        fetch(`${API_URL}/version`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((body: { version?: string }) => {
                if (cancelled) return;
                const apiVersion = body.version ?? "unknown";
                setState(
                    apiVersion === WEB_VERSION
                        ? { kind: "aligned", version: WEB_VERSION }
                        : { kind: "mismatch", web: WEB_VERSION, api: apiVersion },
                );
            })
            .catch(() => {
                if (!cancelled) setState({ kind: "unreachable", web: WEB_VERSION });
            });

        return () => { cancelled = true; };
    }, []);

    // While checking, show the web version rather than a spinner or nothing: it is already
    // known and correct, and a badge that flickers on every page load is worse than one that
    // settles.
    const label = state.kind === "mismatch" ? `${state.web} ≠ api ${state.api}` : WEB_VERSION;

    const tone =
        state.kind === "mismatch"
            ? "border-destructive/50 text-destructive"
            : state.kind === "unreachable"
                ? "border-border text-muted-foreground opacity-60"
                : "border-border text-muted-foreground";

    const title =
        state.kind === "mismatch"
            ? `Version mismatch — this page is ${state.web} but the API is running ${state.api}. One of the two was not redeployed.`
            : state.kind === "unreachable"
                ? `Release ${WEB_VERSION}. The API did not answer the version check.`
                : `Release ${WEB_VERSION} — web and API are on the same build.`;

    return (
        <span
            title={title}
            className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-tight ${tone} ${className ?? ""}`}
        >
            {label}
        </span>
    );
}
