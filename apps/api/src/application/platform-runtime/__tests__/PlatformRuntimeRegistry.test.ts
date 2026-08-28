import { describe, expect, it } from "vitest";
import { assertInlineScriptContent } from "../PlatformRuntimeRegistry";

describe("assertInlineScriptContent", () => {
    it("returns platform-owned JavaScript that cannot terminate its script element", () => {
        expect(assertInlineScriptContent("window.PageForgeRuntime = {};"))
            .toBe("window.PageForgeRuntime = {};");
    });

    it("refuses a closing script tag instead of attempting partial sanitization", () => {
        expect(() => assertInlineScriptContent("const value = '</script><script>alert(1)</script>';"))
            .toThrowError("Platform runtime module contains a closing script tag");
    });
});
