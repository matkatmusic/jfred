// Shows the Docker problem at page load, so the user learns it before the first commit.

import type { WireDockerReadiness } from "../../layer1-wire-script-replay.ts";

export async function showDockerNoticeWhenDockerIsMissing(): Promise<void> {
    const response = await fetch("/api/layer1-docker-readiness");
    if (!response.ok)
        throw new Error(`/api/layer1-docker-readiness -> ${response.status}: ${await response.text()}`);
    const readiness: WireDockerReadiness = await response.json();
    if (readiness.problem) {
        if (!readiness.problemText)
            throw new Error(`/api/layer1-docker-readiness named problem ${readiness.problem} without problemText`);
        const notice = document.createElement("div");
        notice.id = "dockerNotice";
        notice.className = "dockerNotice";
        notice.setAttribute("role", "alert");
        notice.textContent = readiness.problemText;
        document.body.prepend(notice);
    }
}
