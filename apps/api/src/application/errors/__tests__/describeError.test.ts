import { describe, expect, it } from "vitest";
import { describeError } from "../describeError";

/**
 * Pinned against the real failure, not a synthetic one.
 *
 * On 2026-09-07 SiliconFlow's certificate for api.siliconflow.com expired at 10:12:23 GMT. From
 * 10:51 every didactic generation returned 500 and the API logged, in full, `fetch failed`. The
 * chain reproduced below is exactly what Node threw, read off the running container:
 *
 *     0 | name=TypeError | code=-               | msg=fetch failed
 *     1 | name=Error     | code=CERT_HAS_EXPIRED | msg=certificate has expired
 */
function undiciFetchFailure(): Error {
    const cause = Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });
    return new TypeError("fetch failed", { cause });
}

describe("describeError", () => {
    it("keeps the reason a bare message throws away", () => {
        expect(describeError(undiciFetchFailure())).toBe("fetch failed <- CERT_HAS_EXPIRED: certificate has expired");
    });

    it("leaves an ordinary error exactly as it reads", () => {
        // No cause, no code: the output must not grow decoration around the common case.
        expect(describeError(new Error("Failed to parse didactic knowledge JSON")))
            .toBe("Failed to parse didactic knowledge JSON");
    });

    it("does not repeat a cause that says the same thing as its parent", () => {
        const inner = new Error("boom");
        expect(describeError(new Error("boom", { cause: inner }))).toBe("boom");
    });

    it("walks more than one link, outermost first", () => {
        const root = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        const middle = new Error("socket hang up", { cause: root });
        expect(describeError(new TypeError("fetch failed", { cause: middle })))
            .toBe("fetch failed <- socket hang up <- ECONNREFUSED: connect ECONNREFUSED");
    });

    it("terminates on a circular cause chain", () => {
        // A guard, not a policy: a log line is not where you want to discover a cycle.
        const a: Error & { cause?: unknown } = new Error("a");
        const b: Error & { cause?: unknown } = new Error("b");
        a.cause = b;
        b.cause = a;
        expect(describeError(a)).toBe("a <- b <- a <- b");
    });

    it("describes what is thrown even when it is not an Error", () => {
        expect(describeError("plain string")).toBe("plain string");
        expect(describeError(undefined)).toBe("Unknown error");
        expect(describeError(null)).toBe("Unknown error");
    });
});
