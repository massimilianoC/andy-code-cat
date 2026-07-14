import type { ProjectFormSettingsInput, ServiceManifestV1 } from "@andy-code-cat/contracts";

export interface FormRuntimeArtifacts {
    html: string;
    css: string;
    js: string;
}

export interface FormRuntimeCompileResult {
    artifacts: FormRuntimeArtifacts;
    compiledFormIds: string[];
}

/**
 * Application boundary for artifact-side form delivery modes. Future modes
 * must implement this interface and be registered explicitly; generated code
 * never selects an arbitrary endpoint or adapter.
 */
export interface FormRuntimeAdapter<TSettings extends { mode: string } = ProjectFormSettingsInput> {
    readonly mode: TSettings["mode"];
    compile(
        artifacts: FormRuntimeArtifacts,
        manifest: ServiceManifestV1 | undefined,
        settings: TSettings,
    ): FormRuntimeCompileResult;
}
