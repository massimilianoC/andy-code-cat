import { createHash } from "crypto";
import { PROMPT_TASK_REGISTRY, type PromptTaskRouting } from "../../prompting/taskPromptRegistry";
import {
    DEFAULT_PRODUCT_ATTACHMENT_POLICY,
    DEFAULT_PRODUCT_DOCUMENT_CONTEXT_POLICY,
} from "../../../domain/entities/PlatformConfig";

export interface PromptSlotDescriptorDto {
    id: string;
    key: string;
    label: string;
    description: string;
    editableBy: string;
    store: string;
}

export interface PromptTaskDescriptorDto {
    key: string;
    label: string;
    group: string;
    operatorSlotId?: string;
    defaultText: string;
    defaultTextHash: string;
    slots: PromptSlotDescriptorDto[];
    routing: PromptTaskRouting;
}

export interface AdminPromptRegistryDto {
    tasks: PromptTaskDescriptorDto[];
    policyDefaults: {
        attachmentPolicy: typeof DEFAULT_PRODUCT_ATTACHMENT_POLICY;
        documentContextPolicy: typeof DEFAULT_PRODUCT_DOCUMENT_CONTEXT_POLICY;
    };
}

function hashDefaultText(text: string): string {
    return `sha256:${createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16)}`;
}

export class GetPromptRegistry {
    async execute(): Promise<AdminPromptRegistryDto> {
        const tasks: PromptTaskDescriptorDto[] = PROMPT_TASK_REGISTRY.map((task) => {
            const defaultText = task.defaultText();
            return {
                key: task.key,
                label: task.label,
                group: task.group,
                operatorSlotId: task.operatorSlotId,
                defaultText,
                defaultTextHash: hashDefaultText(defaultText),
                slots: task.slots.map((slot) => ({
                    id: slot.id,
                    key: slot.key,
                    label: slot.label,
                    description: slot.description,
                    editableBy: slot.editableBy,
                    store: slot.store,
                })),
                routing: task.routing,
            };
        });

        return {
            tasks,
            policyDefaults: {
                attachmentPolicy: DEFAULT_PRODUCT_ATTACHMENT_POLICY,
                documentContextPolicy: DEFAULT_PRODUCT_DOCUMENT_CONTEXT_POLICY,
            },
        };
    }
}
