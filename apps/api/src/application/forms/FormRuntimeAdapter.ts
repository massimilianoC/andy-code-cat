import type { ProjectFormSettingsInput, RuntimePlanV1, ServiceManifestV1 } from "@andy-code-cat/contracts";

export interface FormRuntimeArtifacts {
    html: string;
    css: string;
    js: string;
}

export interface FormRuntimeCompileResult {
    artifacts: FormRuntimeArtifacts;
    compiledFormIds: string[];
    runtimePlan?: RuntimePlanV1;
    runtimeFiles: Record<string, string>;
}

export type PlatformRuntimeDelivery = "inline-preview" | "external-files";

export interface FormRuntimeMarkupResult {
    artifacts: FormRuntimeArtifacts;
    compiledFormIds: string[];
    runtimeModuleIds: string[];
    publicConfig: Record<string, unknown>;
}

/**
 * Application boundary for artifact-side form delivery modes. Future modes
 * must implement this interface and be registered explicitly; generated code
 * never selects an arbitrary endpoint or adapter.
 */
export interface FormRuntimeAdapter<TSettings extends { mode: string } = ProjectFormSettingsInput> {
    readonly mode: TSettings["mode"];
    compileMarkup(
        artifacts: FormRuntimeArtifacts,
        manifest: ServiceManifestV1 | undefined,
        settings: TSettings,
    ): FormRuntimeMarkupResult;
}
