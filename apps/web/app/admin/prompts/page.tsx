"use client";

import { Suspense } from "react";
import { AdminPageHeader, AdminTabs, useTabParam } from "@/components/admin/AdminUi";
import { GovernanceEditor } from "@/components/admin/governance/GovernanceEditor";
import { PipelineTasksEditor } from "@/components/admin/prompts/PipelineTasksEditor";

const SECTIONS = ["tasks", "system", "attachments"] as const;
type Section = (typeof SECTIONS)[number];

function PromptsContent() {
    const [section, setSection] = useTabParam<Section>(SECTIONS, "tasks");
    return (
        <>
            <AdminPageHeader
                eyebrow="AI"
                title="Prompts"
                description="What reaches the model at each stage: the model and budget of every pipeline task, the system prompts layered on top of them, and the attachment limits that bound the document context."
            />
            <AdminTabs<Section>
                tabs={[
                    { id: "tasks", label: "Pipeline tasks" },
                    { id: "system", label: "System prompts" },
                    { id: "attachments", label: "Attachments & context" },
                ]}
                value={section}
                onChange={setSection}
            />
            {section === "tasks" && <PipelineTasksEditor />}
            {section === "system" && <GovernanceEditor tabs={["prompts"]} scope="prompts" />}
            {section === "attachments" && <GovernanceEditor tabs={["runtime"]} scope="readonly" />}
        </>
    );
}

export default function AdminPromptsPage() {
    return (
        <Suspense fallback={null}>
            <PromptsContent />
        </Suspense>
    );
}
