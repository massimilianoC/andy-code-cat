import type { ProjectFormSettingsInput, ServiceManifestV1 } from "@andy-code-cat/contracts";
import type { FormRuntimeArtifacts, PlatformRuntimeDelivery } from "../forms/FormRuntimeAdapter";
import { compileConfiguredForms } from "../forms/FormRuntimeCompiler";

/**
 * Single deterministic boundary shared by preview, capture, publish and ZIP.
 * It resolves declarative capabilities into allowlisted platform assets without
 * mutating the generated JavaScript artifact.
 */
export function prepareArtifactServices(input: {
    artifacts: FormRuntimeArtifacts;
    serviceManifest?: ServiceManifestV1;
    formSettings?: ProjectFormSettingsInput;
    delivery: PlatformRuntimeDelivery;
    /**
     * Set by publish only: the site's publishId, from which capture forms get their same-origin
     * submit path. Preview and ZIP have no backend and pass none (FORMS_CAPTURE.md).
     */
    publishId?: string;
}) {
    return compileConfiguredForms(
        input.artifacts,
        input.serviceManifest,
        input.formSettings,
        { delivery: input.delivery, publishId: input.publishId },
    );
}
