/**
 * Last-resort handlers for errors that escaped every request and job handler.
 *
 * - `unhandledRejection`: logged with its stack and the process keeps running. On Node 22 the
 *   default is to exit, which turns one forgotten `catch` into an outage for every user.
 * - `uncaughtException`: logged with its stack, then the process exits with code 1. After an
 *   uncaught exception the process state is unknown; the container's restart policy brings up a
 *   clean one. Request input must never reach this point — handlers catch their own errors.
 */
interface ProcessLike {
    on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
    on(event: "uncaughtException", listener: (error: Error) => void): unknown;
    exit(code: number): never | void;
}

function describeFailure(value: unknown): string {
    if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function installProcessSafetyNet(label: string, target: ProcessLike = process): void {
    target.on("unhandledRejection", (reason) => {
        console.error(`[${label}] unhandled promise rejection (process continues)`, describeFailure(reason));
    });
    target.on("uncaughtException", (error) => {
        console.error(`[${label}] uncaught exception, exiting`, describeFailure(error));
        target.exit(1);
    });
}
