import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installProcessSafetyNet } from "../processSafetyNet";

function fakeProcess() {
    const emitter = new EventEmitter();
    const exit = vi.fn();
    return { emitter, exit, target: { on: emitter.on.bind(emitter), exit } as Parameters<typeof installProcessSafetyNet>[1] };
}

describe("installProcessSafetyNet", () => {
    afterEach(() => vi.restoreAllMocks());

    it("logs an unhandled rejection with its stack and keeps the process running", () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { emitter, exit, target } = fakeProcess();
        installProcessSafetyNet("api", target);

        emitter.emit("unhandledRejection", new Error("lost promise"));

        expect(exit).not.toHaveBeenCalled();
        expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("[api] unhandled promise rejection"), expect.stringContaining("lost promise"));
    });

    it("logs an uncaught exception and exits with code 1", () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { emitter, exit, target } = fakeProcess();
        installProcessSafetyNet("worker", target);

        emitter.emit("uncaughtException", new Error("boom"));

        expect(exit).toHaveBeenCalledWith(1);
        expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("[worker] uncaught exception"), expect.stringContaining("boom"));
    });

    it("describes a non-Error rejection reason", () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { emitter, target } = fakeProcess();
        installProcessSafetyNet("api", target);

        emitter.emit("unhandledRejection", { code: 42 });

        expect(errorLog).toHaveBeenCalledWith(expect.any(String), "{\"code\":42}");
    });
});
