import { describe, expect, it } from "vitest";
import type { SiteDeploymentDto } from "../../../../../lib/api";
import { resolvePublicDeploymentUrl } from "../publishUrl";

const deployment: SiteDeploymentDto = {
    id: "deployment-1",
    publishId: "f74d7bf6",
    projectId: "project-1",
    status: "live",
    url: "/p/f74d7bf6",
    publicUrl: "/p/f74d7bf6/",
    customSlug: null,
    filesDeployed: ["index.html", "style.css", "script.js"],
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
};

describe("workspace public deployment URL", () => {
    it("uses the nginx front-door for a local compose API", () => {
        expect(resolvePublicDeploymentUrl(deployment, {
            apiBaseUrl: "http://localhost:4000",
            browserUrl: "http://localhost:8081/workspace/project-1",
        })).toBe("http://localhost/p/f74d7bf6/");
    });

    it("uses the browser host when local compose is opened from the LAN", () => {
        expect(resolvePublicDeploymentUrl(deployment, {
            apiBaseUrl: "http://localhost:4000",
            browserUrl: "http://192.168.1.25:8081/workspace/project-1",
        })).toBe("http://192.168.1.25/p/f74d7bf6/");
    });

    it("uses the configured API origin outside local compose", () => {
        expect(resolvePublicDeploymentUrl(deployment, {
            apiBaseUrl: "https://api.example.test",
            browserUrl: "https://app.example.test/workspace/project-1",
        })).toBe("https://api.example.test/p/f74d7bf6/");
    });

    it("resolves a path-mode slug address against the API origin", () => {
        expect(resolvePublicDeploymentUrl({
            ...deployment,
            customSlug: "antares",
            publicUrl: "/antares/",
        }, {
            apiBaseUrl: "https://andy.camillucci.com:8443",
            browserUrl: "https://andy.camillucci.com:8443/workspace/project-1",
        })).toBe("https://andy.camillucci.com:8443/antares/");
    });

    it("uses an absolute subdomain-mode address as it is", () => {
        expect(resolvePublicDeploymentUrl({
            ...deployment,
            publicUrl: "https://school.example.test",
        }, {
            apiBaseUrl: "http://localhost:4000",
            browserUrl: "http://localhost:8081/workspace/project-1",
        })).toBe("https://school.example.test");
    });
});
