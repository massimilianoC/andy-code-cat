import { call } from "./call";

export function healthCheck() {
    return call<{ status: string; service: string }>("GET", "/health");
}
