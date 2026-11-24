"use client";

import { AdminPageHeader, NotEnforcedNotice } from "@/components/admin/AdminUi";
import { GovernanceEditor } from "@/components/admin/governance/GovernanceEditor";

export default function AdminPublishingPage() {
    return (
        <>
            <AdminPageHeader
                eyebrow="Advanced"
                title="Publishing"
                description="What is added to every published site: analytics tags, HTML and JavaScript injections, the cookie banner and the legal pages."
            />
            <div className="mb-5">
                <NotEnforcedNotice label="To do">
                    Cookie banner and legal pages are kept as they are. To be reviewed for GDPR compliance (consent
                    before any tracking tag, records of consent) together with the superadmin inspections of user
                    projects — see the TODO list in SUPER_ADMIN_SPEC.md.
                </NotEnforcedNotice>
            </div>
            <GovernanceEditor tabs={["analytics", "html", "scripts", "legal"]} scope="publishing" />
        </>
    );
}
