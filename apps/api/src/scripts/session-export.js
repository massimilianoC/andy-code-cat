/**
 * session-export.js — dumps everything the database holds about one work session into a single
 * JSON file, so a run can be inspected without a Mongo client.
 *
 * This is the read half of the replay harness in
 * docs/specs/SESSION_TRACING_EXECUTION_PLAN.md WP6: if a session cannot be exported completely, it
 * cannot be replayed either, and the gap is in the journal rather than in the harness.
 *
 * Runs inside the mongo container, because that is where the database is reachable:
 *   docker exec -i andy-code-cat-mongodb mongosh --quiet --file /dev/stdin < session-export.js
 *
 * Select the session with one of, checked in this order:
 *   WS=<workSessionId>   an explicit session
 *   PROJECT=<projectId>  the session belonging to that project
 *   (neither)            the most recently created session
 */

const db = db.getSiblingDB("andy-code-cat");

const wsArg = typeof WS !== "undefined" ? WS : null;
const projectArg = typeof PROJECT !== "undefined" ? PROJECT : null;

let session = null;
if (wsArg) {
    session = db.work_sessions.findOne({ _id: wsArg });
} else if (projectArg) {
    session = db.work_sessions.find({ projectId: projectArg }).sort({ $natural: -1 }).limit(1).toArray()[0] ?? null;
} else {
    session = db.work_sessions.find({}).sort({ $natural: -1 }).limit(1).toArray()[0] ?? null;
}

if (!session) {
    print(JSON.stringify({ error: "no work session found for the given selector" }));
    quit(1);
}

const ws = session._id;
const projectId = session.projectId ?? projectArg;

// Historical rows predate the session id, so anything project-scoped is also matched by projectId.
// Reporting which join found a row is the point: a row reachable only by projectId is a row the
// certificate cannot claim, and saying so is more useful than silently widening the query.
const bySession = { workSessionId: ws };
const byProject = projectId ? { projectId } : { _id: null };
const either = { $or: [bySession, byProject] };

function collect(collection, filter) {
    return db.getCollection(collection).find(filter).sort({ $natural: 1 }).toArray();
}

const promptLogs = collect("prompt_execution_logs", either);
const pipelineRuns = collect("pipeline_runs", either);

const out = {
    exportedAt: new Date().toISOString(),
    selector: { workSessionId: ws, projectId: projectId ?? null },

    // How much of this export the session id alone could reach. The difference between these two
    // numbers is exactly what a replay would be missing.
    coverage: {
        promptExecutionLogs: {
            total: promptLogs.length,
            reachableByWorkSessionId: promptLogs.filter((d) => d.workSessionId === ws).length,
        },
        pipelineRuns: {
            total: pipelineRuns.length,
            reachableByWorkSessionId: pipelineRuns.filter((d) => d.workSessionId === ws).length,
        },
    },

    workSession: session,
    // projects._id is an ObjectId while every reference to it is stored as a string, so the
    // lookup has to convert rather than match — a plain findOne({_id: projectId}) silently
    // returns null, which is how this export first reported "project: None" for a project that
    // plainly existed.
    project: projectId ? db.projects.findOne({ _id: ObjectId(projectId) }) : null,
    vibeIntakes: collect("vibe_intakes", either),
    zeroEffortFormProposals: collect("zero_effort_form_proposals", either),
    pipelineRuns,
    promptExecutionLogs: promptLogs,
    conversations: projectId ? collect("conversations", { projectId }) : [],
    previewSnapshots: projectId ? collect("preview_snapshots", { projectId }) : [],
    projectAssets: projectId ? collect("project_assets", { projectId }) : [],
    costTransactions: collect("cost_transactions", {
        $or: [{ "sourceRef.workSessionId": ws }, byProject],
    }),
};

print(JSON.stringify(out, null, 2));
