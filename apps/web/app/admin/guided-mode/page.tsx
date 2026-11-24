"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Moved into the Prompts section (SUPER_ADMIN_SPEC.md, "Information architecture"); kept so old links still land. */
export default function MovedAdminPage() {
    const router = useRouter();
    useEffect(() => {
        router.replace("/admin/prompts");
    }, [router]);
    return null;
}
